"""Streaming video processor - captures frames from live streams in configurable windows."""

import os
import re
import time
import base64
import threading
import tempfile
import logging
import json
from collections import deque
from datetime import datetime

import cv2

from server.database import execute_query, execute_update, get_workspace_client, get_timezone
from server.fmapi import analyze_frame
from server.video_processor import save_thumbnail

logger = logging.getLogger(__name__)

THUMBNAIL_VOLUME = os.environ.get("THUMBNAIL_VOLUME", "/Volumes/dbxsc_ai/main/thumbnails")
VIDEO_VOLUME = os.environ.get("VIDEO_VOLUME", "/Volumes/dbxsc_ai/main/uploaded_videos")


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

    def start_stream(self, name: str, stream_url: str, config: dict, context_id: int, context_name: str) -> dict:
        self._counter += 1
        stream_id = self._counter

        stream_info = {
            "stream_id": stream_id,
            "name": name,
            "stream_url": stream_url,
            "context_id": context_id,
            "context_name": context_name,
            "context_color": config.get("context_color", ""),
            "config": config,
            "status": "CONNECTING",
            "windows_processed": 0,
            "total_detections": 0,
            "current_window_sec": 0,
            "started_at": time.time(),
            "stop_requested": False,
            "error": None,
            "videos": [],
            "logs": deque(maxlen=200),
            "last_frame": None,  # latest JPEG bytes for live preview
        }
        self._streams[stream_id] = stream_info
        self._log(stream_id, "INFO", f"Stream '{name}' created. URL: {self._safe_url(stream_url)}")
        self._log(stream_id, "INFO", f"Context: {context_name}, Window: {config.get('window_seconds', 60)}s, Scan FPS: {config.get('scan_fps', 0.2)}")

        thread = threading.Thread(
            target=self._run_stream,
            args=(stream_id, stream_url, config, context_id, context_name),
            daemon=True,
        )
        thread.start()
        return self._serialize(stream_info)

    def restart_stream(self, stream_id: int) -> dict:
        stream = self._streams.get(stream_id)
        if not stream:
            return None
        if stream["status"] in ("RUNNING", "CONNECTING"):
            return self._serialize(stream)

        stream["status"] = "CONNECTING"
        stream["stop_requested"] = False
        stream["error"] = None
        stream["current_window_sec"] = 0
        self._log(stream_id, "INFO", "Restarting stream...")

        thread = threading.Thread(
            target=self._run_stream,
            args=(stream_id, stream["stream_url"], stream["config"], stream["context_id"], stream["context_name"]),
            daemon=True,
        )
        thread.start()
        return self._serialize(stream)

    def update_stream(self, stream_id: int, name: str = None, stream_url: str = None, window_seconds: int = None) -> dict:
        stream = self._streams.get(stream_id)
        if not stream:
            return None
        if name is not None:
            stream["name"] = name
            self._log(stream_id, "INFO", f"Name updated to: {name}")
        if stream_url is not None:
            stream["stream_url"] = stream_url
            self._log(stream_id, "INFO", f"URL updated to: {self._safe_url(stream_url)}")
        if window_seconds is not None:
            stream["config"]["window_seconds"] = window_seconds
            self._log(stream_id, "INFO", f"Window updated to: {window_seconds}s")
        return self._serialize(stream)

    def delete_stream(self, stream_id: int) -> bool:
        stream = self._streams.get(stream_id)
        if not stream:
            return False
        if stream["status"] in ("RUNNING", "CONNECTING"):
            stream["stop_requested"] = True
        del self._streams[stream_id]
        return True

    def get_stream(self, stream_id: int):
        s = self._streams.get(stream_id)
        return self._serialize(s) if s else None

    def stop_stream(self, stream_id: int):
        if stream_id in self._streams:
            self._streams[stream_id]["stop_requested"] = True
            self._log(stream_id, "INFO", "Stop requested by user.")

    def list_streams(self):
        return [self._serialize(s) for s in self._streams.values()]

    def get_logs(self, stream_id: int):
        s = self._streams.get(stream_id)
        if not s:
            return []
        return list(s["logs"])

    def get_last_frame(self, stream_id: int):
        s = self._streams.get(stream_id)
        if s:
            return s.get("last_frame")
        return None

    def _log(self, stream_id: int, level: str, message: str):
        s = self._streams.get(stream_id)
        if s:
            entry = {"ts": time.strftime("%H:%M:%S"), "level": level, "msg": message}
            s["logs"].append(entry)
            logger.info(f"[Stream {stream_id}] {message}")

    def _safe_url(self, url: str) -> str:
        if "@" in url:
            parts = url.split("@", 1)
            proto = parts[0].split("://")[0] if "://" in parts[0] else ""
            return f"{proto}://***@{parts[1]}"
        return url

    def _serialize(self, s: dict) -> dict:
        if not s:
            return None
        return {
            "stream_id": s["stream_id"],
            "name": s["name"],
            "stream_url": self._safe_url(s["stream_url"]),
            "context_id": s["context_id"],
            "context_name": s["context_name"],
            "context_color": s.get("context_color", ""),
            "status": s["status"],
            "windows_processed": s["windows_processed"],
            "total_detections": s["total_detections"],
            "current_window_sec": s["current_window_sec"],
            "error": s.get("error"),
            "videos": s.get("videos", []),
            "window_seconds": s.get("config", {}).get("window_seconds", 60),
        }

    @staticmethod
    def _sanitize_name(name: str) -> str:
        """Sanitize stream name for use in filenames."""
        s = re.sub(r'[^\w\s-]', '', name)
        return re.sub(r'[\s]+', '_', s).strip('_')

    @staticmethod
    def _window_label(stream_name: str, window_start_ts: float) -> str:
        """Generate window label: {sanitized_name}_{yyyyMMddHHmmss} using configured timezone."""
        try:
            from zoneinfo import ZoneInfo
            tz_name = get_timezone()
            tz = ZoneInfo(tz_name)
        except Exception:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo("America/Sao_Paulo")
        dt = datetime.fromtimestamp(window_start_ts, tz=tz)
        safe_name = StreamManager._sanitize_name(stream_name)
        return f"{safe_name}_{dt.strftime('%Y%m%d%H%M%S')}"

    def _run_stream(self, stream_id: int, stream_url: str, config: dict, context_id: int, context_name: str):
        stream = self._streams.get(stream_id)
        if not stream:
            return
        categories = config.get("categories", ["fadiga", "distracao"])
        scan_prompt = config.get("scan_prompt", "Analyze this image.")
        scan_fps = config.get("scan_fps", 0.2)
        threshold = config.get("score_threshold", 4)
        window_seconds = config.get("window_seconds", 60)

        # For mock/simulation: if URL points to a volume file, download it first
        local_path = None
        if stream_url.startswith("/Volumes/"):
            self._log(stream_id, "INFO", "Downloading file from Databricks Volume...")
            try:
                w = get_workspace_client()
                resp = w.files.download(stream_url)
                tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
                for chunk in iter(lambda: resp.contents.read(65536), b""):
                    tmp.write(chunk)
                tmp.close()
                local_path = tmp.name
                stream_url = local_path
                self._log(stream_id, "OK", f"Volume file downloaded ({os.path.getsize(local_path)} bytes)")
            except Exception as e:
                stream["status"] = "FAILED"
                stream["error"] = f"Could not download from volume: {e}"
                self._log(stream_id, "ERROR", stream["error"])
                return

        # Open the stream/video with RTSP-friendly settings
        is_rtsp = stream_url.lower().startswith("rtsp://")
        self._log(stream_id, "INFO", f"Opening connection... (backend: {'FFMPEG/RTSP' if is_rtsp else 'default'})")

        if is_rtsp:
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|analyzeduration;10000000|stimeout;10000000"
            cap = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)
        else:
            cap = cv2.VideoCapture(stream_url)

        if not cap.isOpened():
            self._log(stream_id, "WARN", "First connection attempt failed, retrying with TCP transport...")
            cap.release()
            if is_rtsp:
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
                cap = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)

        if not cap.isOpened():
            stream["status"] = "FAILED"
            safe_url = self._safe_url(stream_url)
            stream["error"] = f"Could not open: {safe_url}. Check URL, credentials, and network."
            self._log(stream_id, "ERROR", stream["error"])
            if local_path:
                os.unlink(local_path)
            return

        video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        stream["status"] = "RUNNING"
        self._log(stream_id, "OK", f"Connected! FPS={video_fps:.1f}, scan_fps={scan_fps}, threshold={threshold}")

        video_frames = []  # all frames at ~5fps for video encoding
        frame_idx = 0
        window_num = 0
        window_start_time = time.time()
        last_video_capture = 0.0
        last_preview_time = 0.0
        video_capture_interval = 0.2  # ~5fps for video file
        preview_interval = 0.5  # update live preview at 2fps
        stream_start_time = time.time()
        is_live = not local_path  # live streams (RTSP/RTMP/HTTP) vs local files
        consecutive_failures = 0
        max_failures = 150  # ~30s of failed reads at 5fps before giving up

        if is_live:
            self._log(stream_id, "INFO", f"Live stream mode: video@5fps, analysis@{scan_fps}fps, window={window_seconds}s")
        else:
            self._log(stream_id, "INFO", f"File mode: video@5fps, analysis@{scan_fps}fps, window={window_seconds}s")

        try:
            while not stream.get("stop_requested"):
                ret, frame = cap.read()
                if not ret:
                    if is_live:
                        # Live streams can drop frames -- retry instead of stopping
                        consecutive_failures += 1
                        if consecutive_failures >= max_failures:
                            self._log(stream_id, "ERROR", f"Lost connection after {consecutive_failures} consecutive failed reads. Attempting reconnect...")
                            cap.release()
                            time.sleep(2)
                            if is_rtsp:
                                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|analyzeduration;10000000|stimeout;10000000"
                                cap = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)
                            else:
                                cap = cv2.VideoCapture(stream_url)
                            if cap.isOpened():
                                self._log(stream_id, "OK", "Reconnected!")
                                consecutive_failures = 0
                            else:
                                self._log(stream_id, "ERROR", "Reconnect failed. Stopping.")
                                break
                        else:
                            time.sleep(0.2)
                        continue
                    else:
                        # File mode: end of file -- process final window
                        if video_frames:
                            window_num += 1
                            window_label = self._window_label(stream["name"], window_start_time)
                            self._log(stream_id, "INFO", f"End of file. Processing final window ({len(video_frames)} frames)...")
                            analysis_frames = self._select_analysis_frames(video_frames, scan_fps)
                            self._process_window(stream_id, stream, video_frames, analysis_frames, window_num,
                                                 window_label, categories, scan_prompt, threshold, config, context_id, context_name)
                        self._log(stream_id, "INFO", "File finished.")
                        break

                consecutive_failures = 0
                now = time.time()
                elapsed_in_window = now - window_start_time
                elapsed_total = now - stream_start_time
                frame_idx += 1

                # Update live preview (~2fps)
                if now - last_preview_time >= preview_interval:
                    last_preview_time = now
                    h_p, w_p = frame.shape[:2]
                    preview = frame
                    if w_p > 640:
                        sc = 640 / w_p
                        preview = cv2.resize(frame, (640, int(h_p * sc)))
                    _, jpg = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 60])
                    stream["last_frame"] = jpg.tobytes()

                # Capture frame at ~5fps for video file
                if now - last_video_capture >= video_capture_interval:
                    last_video_capture = now
                    h, w = frame.shape[:2]
                    small = frame
                    if w > 512:
                        scale = 512 / w
                        small = cv2.resize(frame, (512, int(h * scale)))
                    _, jpeg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    video_frames.append((frame_idx, elapsed_total, jpeg.tobytes()))
                    stream["current_window_sec"] = int(elapsed_in_window)

                # Window complete? Analyze, then persist only if detections
                if elapsed_in_window >= window_seconds and video_frames:
                    window_num += 1
                    window_label = self._window_label(stream["name"], window_start_time)
                    self._log(stream_id, "INFO", f"Window {window_num} complete ({len(video_frames)} video frames, {int(elapsed_in_window)}s). Analyzing...")
                    analysis_frames = self._select_analysis_frames(video_frames, scan_fps)
                    self._process_window(stream_id, stream, video_frames, analysis_frames, window_num,
                                         window_label, categories, scan_prompt, threshold, config, context_id, context_name)
                    video_frames = []
                    window_start_time = time.time()

        except Exception as e:
            stream["error"] = str(e)[:200]
            self._log(stream_id, "ERROR", f"Exception: {stream['error']}")
        finally:
            cap.release()
            if local_path and os.path.exists(local_path):
                os.unlink(local_path)
            if stream.get("status") == "RUNNING":
                stream["status"] = "STOPPED" if stream.get("stop_requested") else "COMPLETED"
            self._log(stream_id, "INFO", f"Finished. Status={stream['status']}, Windows={stream['windows_processed']}, Detections={stream['total_detections']}")

    @staticmethod
    def _deduplicate_detections(detections):
        """Merge consecutive detections of same category within 5s window."""
        if not detections:
            return []
        sorted_dets = sorted(detections, key=lambda d: d["timestamp_sec"])
        merged = []
        current = sorted_dets[0]
        for det in sorted_dets[1:]:
            if det["category"] == current["category"] and det["timestamp_sec"] - current["timestamp_sec"] <= 5.0:
                if det["score"] > current["score"]:
                    current = det
            else:
                merged.append(current)
                current = det
        merged.append(current)
        return merged

    @staticmethod
    def _select_analysis_frames(video_frames, scan_fps):
        """Select frames for AI analysis from video_frames based on scan_fps interval."""
        if not video_frames:
            return []
        analysis_interval = 1.0 / scan_fps if scan_fps > 0 else 5.0
        selected = []
        last_selected_ts = -analysis_interval  # ensure first frame is picked
        for entry in video_frames:
            _, ts, _ = entry
            if ts - last_selected_ts >= analysis_interval:
                selected.append(entry)
                last_selected_ts = ts
        return selected

    def _save_window_video(self, stream_id, frames, window_label):
        """Encode captured frames into a browser-compatible H.264 MP4 and upload to Volume."""
        import subprocess
        import numpy as np
        tmp_avi = tempfile.NamedTemporaryFile(suffix=".avi", delete=False)
        tmp_avi.close()
        tmp_mp4 = tmp_avi.name.replace(".avi", ".mp4")
        try:
            first_img = cv2.imdecode(np.frombuffer(frames[0][2], dtype=np.uint8), cv2.IMREAD_COLOR)
            h, w = first_img.shape[:2]
            fps_out = max(1.0, len(frames) / max(1, frames[-1][1] - frames[0][1])) if len(frames) > 1 else 1.0

            # Write as MJPEG AVI (always works with OpenCV)
            fourcc = cv2.VideoWriter_fourcc(*"MJPG")
            writer = cv2.VideoWriter(tmp_avi.name, fourcc, fps_out, (w, h))
            for _, _, jpeg_bytes in frames:
                img = cv2.imdecode(np.frombuffer(jpeg_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
                if img is not None:
                    writer.write(img)
            writer.release()

            # Find ffmpeg binary (system or imageio-bundled)
            ffmpeg_bin = "ffmpeg"
            try:
                import imageio_ffmpeg
                ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
            except ImportError:
                pass

            # Convert to H.264 MP4 with ffmpeg (browser-compatible)
            result = subprocess.run(
                [ffmpeg_bin, "-y", "-i", tmp_avi.name, "-c:v", "libx264",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                 "-preset", "ultrafast", "-crf", "28", tmp_mp4],
                capture_output=True, timeout=120,
            )
            if result.returncode != 0:
                self._log(stream_id, "WARN", f"ffmpeg failed: {result.stderr.decode()[:100]}")
                return None

            volume_path = f"{VIDEO_VOLUME}/{window_label}.mp4"
            ws = get_workspace_client()
            with open(tmp_mp4, "rb") as f:
                ws.files.upload(volume_path, f, overwrite=True)
            self._log(stream_id, "OK", f"Window video saved: {window_label}.mp4 ({os.path.getsize(tmp_mp4)} bytes)")
            return volume_path
        except Exception as e:
            self._log(stream_id, "WARN", f"Could not save window video: {e}")
            return None
        finally:
            for p in [tmp_avi.name, tmp_mp4]:
                if os.path.exists(p):
                    os.unlink(p)

    def _process_window(self, stream_id, stream, video_frames, analysis_frames, window_num, window_label, categories, scan_prompt, threshold, config, context_id, context_name):
        if not video_frames:
            return

        video_id = int(time.time() * 1000) + window_num

        # Analyze only the selected analysis frames
        detections = []
        for i, (frame_idx, ts, jpeg_bytes) in enumerate(analysis_frames):
            frame_b64 = base64.b64encode(jpeg_bytes).decode()
            try:
                result = analyze_frame(frame_b64, scan_prompt, categories)
            except Exception as ex:
                self._log(stream_id, "WARN", f"Frame {frame_idx} analysis error: {str(ex)[:80]}")
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
                self._log(stream_id, "DETECTION", f"[{max_cat}] score={max_score} at {ts:.1f}s")

        detections = self._deduplicate_detections(detections)

        # If no detections above threshold, discard this window entirely
        if not detections:
            self._log(stream_id, "INFO", f"No detections in window {window_num}, discarding")
            stream["windows_processed"] += 1
            return

        # Detections found -- persist video + DB entries
        start_ts = video_frames[0][1]
        end_ts = video_frames[-1][1]

        volume_path = self._save_window_video(stream_id, video_frames, window_label)
        if not volume_path:
            volume_path = f"stream://{self._safe_url(stream['stream_url'])}#w{window_num}"

        execute_update("""
            INSERT INTO videos (video_id, filename, volume_path, duration_seconds,
                upload_timestamp, status, source, context_id, context_name, context_color)
            VALUES (%(vid)s, %(name)s, %(path)s, %(dur)s, NOW(), 'ANALYZING', 'STREAM', %(cid)s, %(cname)s, %(ccolor)s)
        """, {
            "vid": video_id, "name": window_label,
            "path": volume_path,
            "dur": end_ts - start_ts,
            "cid": context_id or None, "cname": context_name, "ccolor": config.get("context_color"),
        })

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

        execute_update("UPDATE videos SET status = 'COMPLETED', progress_pct = 100 WHERE video_id = %(vid)s", {"vid": video_id})

        stream["windows_processed"] += 1
        stream["total_detections"] += len(detections)
        stream["videos"].append({"video_id": video_id, "window": window_num, "detections": len(detections), "overall": overall})
        self._log(stream_id, "OK", f"Window {window_num} done: {len(detections)} detections, score={overall:.1f}")
