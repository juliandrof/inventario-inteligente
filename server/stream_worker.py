"""Streaming video processor - captures frames from live streams in 1-minute windows."""

import os
import time
import base64
import threading
import tempfile
import logging

import cv2

from server.database import execute_query, execute_update, get_workspace_client
from server.fmapi import analyze_frame
from server.video_processor import save_thumbnail

logger = logging.getLogger(__name__)

THUMBNAIL_VOLUME = os.environ.get("THUMBNAIL_VOLUME", "/Volumes/dbxsc_ai/main/thumbnails")


class StreamManager:
    """Singleton manager for active streams."""
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._streams = {}
                    cls._instance._counter = 0
        return cls._instance

    def start_stream(self, stream_url: str, config: dict, context_id: int, context_name: str) -> dict:
        self._counter += 1
        stream_id = self._counter

        stream_info = {
            "stream_id": stream_id,
            "stream_url": stream_url,
            "context_name": context_name,
            "status": "CONNECTING",
            "windows_processed": 0,
            "total_detections": 0,
            "current_window_sec": 0,
            "started_at": time.time(),
            "stop_requested": False,
            "error": None,
            "videos": [],  # list of video_ids created (one per window)
        }
        self._streams[stream_id] = stream_info

        thread = threading.Thread(
            target=self._run_stream,
            args=(stream_id, stream_url, config, context_id, context_name),
            daemon=True,
        )
        thread.start()
        return stream_info

    def get_stream(self, stream_id: int):
        return self._streams.get(stream_id)

    def stop_stream(self, stream_id: int):
        if stream_id in self._streams:
            self._streams[stream_id]["stop_requested"] = True

    def list_streams(self):
        return list(self._streams.values())

    def _run_stream(self, stream_id: int, stream_url: str, config: dict, context_id: int, context_name: str):
        stream = self._streams[stream_id]
        categories = config.get("categories", ["fadiga", "distracao"])
        scan_prompt = config.get("scan_prompt", "Analyze this image.")
        scan_fps = config.get("scan_fps", 0.2)
        threshold = config.get("score_threshold", 4)
        window_seconds = 60  # 1-minute windows

        # For mock/simulation: if URL points to a volume file, download it first
        local_path = None
        if stream_url.startswith("/Volumes/"):
            try:
                w = get_workspace_client()
                resp = w.files.download(stream_url)
                tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
                for chunk in iter(lambda: resp.contents.read(65536), b""):
                    tmp.write(chunk)
                tmp.close()
                local_path = tmp.name
                stream_url = local_path
                logger.info(f"[Stream {stream_id}] Downloaded volume file to {local_path}")
            except Exception as e:
                stream["status"] = "FAILED"
                stream["error"] = f"Could not download from volume: {e}"
                return

        # Open the stream/video
        cap = cv2.VideoCapture(stream_url)
        if not cap.isOpened():
            stream["status"] = "FAILED"
            stream["error"] = f"Could not open stream: {stream_url}"
            if local_path:
                os.unlink(local_path)
            return

        video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_interval = max(1, int(video_fps / scan_fps))
        stream["status"] = "RUNNING"
        logger.info(f"[Stream {stream_id}] Connected. FPS={video_fps}, interval={frame_interval}")

        window_frames = []
        window_start = time.time()
        frame_idx = 0
        window_num = 0

        try:
            while not stream["stop_requested"]:
                ret, frame = cap.read()
                if not ret:
                    # End of file/stream
                    if window_frames:
                        self._process_window(stream_id, stream, window_frames, window_num,
                                             categories, scan_prompt, threshold, config, context_id, context_name)
                    break

                if frame_idx % frame_interval == 0:
                    timestamp = frame_idx / video_fps
                    h, w = frame.shape[:2]
                    if w > 512:
                        scale = 512 / w
                        frame = cv2.resize(frame, (512, int(h * scale)))
                    _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    window_frames.append((frame_idx, timestamp, jpeg.tobytes()))
                    stream["current_window_sec"] = int(timestamp % window_seconds)

                # Check if window is complete (every 60 seconds of video)
                video_time = frame_idx / video_fps
                if video_time > 0 and int(video_time) % window_seconds == 0 and int(video_time) // window_seconds > window_num:
                    window_num = int(video_time) // window_seconds
                    self._process_window(stream_id, stream, window_frames, window_num,
                                         categories, scan_prompt, threshold, config, context_id, context_name)
                    window_frames = []

                frame_idx += 1

        except Exception as e:
            logger.error(f"[Stream {stream_id}] Error: {e}")
            stream["error"] = str(e)[:200]
        finally:
            cap.release()
            if local_path and os.path.exists(local_path):
                os.unlink(local_path)
            if stream["status"] == "RUNNING":
                stream["status"] = "STOPPED" if stream["stop_requested"] else "COMPLETED"
            logger.info(f"[Stream {stream_id}] Finished. Windows={stream['windows_processed']}, Detections={stream['total_detections']}")

    def _process_window(self, stream_id, stream, frames, window_num, categories, scan_prompt, threshold, config, context_id, context_name):
        """Analyze a 1-minute window of frames."""
        if not frames:
            return

        logger.info(f"[Stream {stream_id}] Processing window {window_num} ({len(frames)} frames)")

        # Create a video entry for this window
        video_id = int(time.time() * 1000) + window_num
        start_ts = frames[0][1]
        end_ts = frames[-1][1]
        window_label = f"stream_{stream_id}_w{window_num}_{int(start_ts)}s-{int(end_ts)}s"

        execute_update("""
            INSERT INTO videos (video_id, filename, volume_path, duration_seconds,
                upload_timestamp, status, source, context_id, context_name, context_color)
            VALUES (%(vid)s, %(name)s, %(path)s, %(dur)s, NOW(), 'ANALYZING', 'STREAM', %(cid)s, %(cname)s, %(ccolor)s)
        """, {
            "vid": video_id, "name": window_label,
            "path": f"stream://{stream['stream_url']}#w{window_num}",
            "dur": end_ts - start_ts,
            "cid": context_id or None, "cname": context_name, "ccolor": config.get("context_color"),
        })

        # Analyze frames
        detections = []
        for frame_idx, ts, jpeg_bytes in frames:
            frame_b64 = base64.b64encode(jpeg_bytes).decode()
            try:
                result = analyze_frame(frame_b64, scan_prompt, categories)
            except Exception:
                result = {c: 0 for c in categories}
                result["description"] = "Analysis error"
                result["confidence"] = 0.0

            max_score = max(result.get(c, 0) for c in categories)
            max_cat = max(categories, key=lambda c: result.get(c, 0))

            if max_score >= threshold:
                thumb = save_thumbnail(video_id, jpeg_bytes, ts)
                detections.append({
                    "video_id": video_id, "timestamp_sec": ts, "category": max_cat,
                    "score": max_score, "confidence": result.get("confidence", 0.5),
                    "ai_description": result.get("description", ""),
                    "thumbnail_path": thumb, "frame_index": frame_idx,
                    "scores_detail": {c: result.get(c, 0) for c in categories},
                })

        # Save results
        import json
        scores = {}
        for cat in categories:
            cat_scores = [d["scores_detail"].get(cat, 0) for d in detections if d["scores_detail"].get(cat, 0) > 0]
            scores[cat] = max(cat_scores) if cat_scores else 0
        overall = sum(scores.values()) / len(scores) if scores else 0

        result_id = int(time.time() * 1000) + window_num + 500
        execute_update("""
            INSERT INTO analysis_results (result_id, video_id, analysis_timestamp, scores_json,
                overall_risk, total_detections, scan_fps, model_used, config_snapshot)
            VALUES (%(rid)s, %(vid)s, NOW(), %(scores)s, %(risk)s, %(total)s, %(sfps)s, %(model)s, %(cfg)s)
        """, {
            "rid": result_id, "vid": video_id, "scores": json.dumps(scores),
            "risk": overall, "total": len(detections), "sfps": config.get("scan_fps", 0.2),
            "model": os.environ.get("FMAPI_MODEL", "configurable"), "cfg": json.dumps(config, default=str),
        })

        for i, det in enumerate(detections):
            det_id = int(time.time() * 1000) + window_num + i + 1000
            execute_update("""
                INSERT INTO detections (detection_id, video_id, result_id, timestamp_sec, category,
                    score, confidence, ai_description, thumbnail_path, frame_index, review_status)
                VALUES (%(did)s, %(vid)s, %(rid)s, %(ts)s, %(cat)s, %(score)s, %(conf)s, %(desc)s, %(thumb)s, %(fidx)s, 'PENDING')
            """, {
                "did": det_id, "vid": video_id, "rid": result_id, "ts": det["timestamp_sec"],
                "cat": det["category"], "score": det["score"], "conf": det["confidence"],
                "desc": det["ai_description"], "thumb": det["thumbnail_path"], "fidx": det["frame_index"],
            })

        # Mark video complete
        execute_update("UPDATE videos SET status = 'COMPLETED', progress_pct = 100 WHERE video_id = %(vid)s", {"vid": video_id})

        # Update stream stats
        stream["windows_processed"] += 1
        stream["total_detections"] += len(detections)
        stream["videos"].append({"video_id": video_id, "window": window_num, "detections": len(detections), "overall": overall})
        logger.info(f"[Stream {stream_id}] Window {window_num}: {len(detections)} detections, overall={overall:.1f}")
