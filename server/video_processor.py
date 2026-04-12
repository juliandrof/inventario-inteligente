"""Video processing pipeline: frame extraction + FMAPI analysis."""

import os
import io
import base64
import hashlib
import logging
import time
import tempfile

import cv2

from server.database import execute_query, execute_update, get_workspace_client
from server.fmapi import analyze_frame

logger = logging.getLogger(__name__)

THUMBNAIL_VOLUME = os.environ.get("THUMBNAIL_VOLUME", "/Volumes/dbxsc_ai/main/thumbnails")


def compute_file_hash(filepath: str) -> str:
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_video_metadata(video_path: str) -> dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {}
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    return {
        "fps": fps,
        "total_frames": total,
        "duration_seconds": total / fps if fps > 0 else 0,
        "resolution": f"{w}x{h}",
    }


def save_thumbnail(video_id: int, frame_bytes: bytes, timestamp_sec: float) -> str:
    filename = f"v{video_id}_t{timestamp_sec:.1f}.jpg"
    local_dir = tempfile.mkdtemp()
    local_path = os.path.join(local_dir, filename)

    with open(local_path, "wb") as f:
        f.write(frame_bytes)

    volume_path = f"{THUMBNAIL_VOLUME}/{filename}"
    try:
        w = get_workspace_client()
        with open(local_path, "rb") as fh:
            w.files.upload(volume_path, fh, overwrite=True)
        logger.info(f"Thumbnail saved: {filename}")
    except Exception as e:
        logger.error(f"Failed to upload thumbnail: {e}")

    os.unlink(local_path)
    os.rmdir(local_dir)
    return filename


def process_video(video_id: int, local_path: str, config: dict, progress_callback=None):
    """Single-pass analysis pipeline. Extracts frames and analyzes each one."""
    import json

    categories = config.get("categories", ["fadiga", "distracao"])
    scan_prompt = config.get("scan_prompt", "Analyze this truck driver image for signs of fatigue and distraction.")
    scan_fps = config.get("scan_fps", 0.2)
    threshold = config.get("score_threshold", 4)

    logger.info(f"[V{video_id}] Starting processing: {local_path}")
    logger.info(f"[V{video_id}] Config: fps={scan_fps}, threshold={threshold}, categories={categories}")

    # Update status
    execute_update(
        f"UPDATE videos SET status = 'SCANNING', progress_pct = 0 WHERE video_id = %(vid)s",
        {"vid": video_id},
    )

    # Open video
    cap = cv2.VideoCapture(local_path)
    if not cap.isOpened():
        logger.error(f"[V{video_id}] Cannot open video file")
        execute_update(
            f"UPDATE videos SET status = 'FAILED', error_message = 'Cannot open video' WHERE video_id = %(vid)s",
            {"vid": video_id},
        )
        return

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / video_fps if video_fps > 0 else 0
    frame_interval = max(1, int(video_fps / scan_fps)) if scan_fps < video_fps else 1

    # Calculate how many frames we'll actually analyze
    frames_to_analyze = total_frames // frame_interval
    logger.info(f"[V{video_id}] Video: {duration:.1f}s, {video_fps:.1f}fps, {total_frames} total frames, analyzing ~{frames_to_analyze} frames")

    detections = []
    frame_idx = 0
    analyzed_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            timestamp = frame_idx / video_fps

            # Resize for efficiency
            h, w = frame.shape[:2]
            if w > 512:
                scale = 512 / w
                frame = cv2.resize(frame, (512, int(h * scale)))

            _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            jpeg_bytes = jpeg.tobytes()
            frame_b64 = base64.b64encode(jpeg_bytes).decode()

            # Analyze frame
            logger.info(f"[V{video_id}] Analyzing frame {analyzed_count+1}/{frames_to_analyze} at t={timestamp:.1f}s")

            try:
                result = analyze_frame(frame_b64, scan_prompt, categories)
                logger.info(f"[V{video_id}] Result: { {c: result.get(c,1) for c in categories} }")
            except Exception as e:
                logger.error(f"[V{video_id}] Frame analysis error: {e}")
                result = {cat: 1 for cat in categories}
                result["description"] = f"Erro: {str(e)[:100]}"
                result["confidence"] = 0.0

            max_score = max(result.get(c, 0) for c in categories)
            max_cat = max(categories, key=lambda c: result.get(c, 0))

            if max_score >= threshold:
                # Save thumbnail
                thumb = save_thumbnail(video_id, jpeg_bytes, timestamp)
                detections.append({
                    "video_id": video_id,
                    "timestamp_sec": timestamp,
                    "category": max_cat,
                    "score": max_score,
                    "confidence": result.get("confidence", 0.5),
                    "ai_description": result.get("description", ""),
                    "thumbnail_path": thumb,
                    "frame_index": frame_idx,
                    "scores_detail": {c: result.get(c, 0) for c in categories},
                })
                logger.info(f"[V{video_id}] Detection! {max_cat}={max_score} at t={timestamp:.1f}s")

            analyzed_count += 1
            pct = (analyzed_count / max(1, frames_to_analyze)) * 95
            execute_update(
                f"UPDATE videos SET status = 'ANALYZING', progress_pct = %(pct)s WHERE video_id = %(vid)s",
                {"vid": video_id, "pct": pct},
            )
            if progress_callback:
                progress_callback(video_id, pct)

        frame_idx += 1

    cap.release()
    logger.info(f"[V{video_id}] Analysis complete. {len(detections)} detections from {analyzed_count} frames.")

    # Persist results
    _save_results(video_id, detections, categories, config)

    # Mark complete
    execute_update(
        f"UPDATE videos SET status = 'COMPLETED', progress_pct = 100 WHERE video_id = %(vid)s",
        {"vid": video_id},
    )
    if progress_callback:
        progress_callback(video_id, 100)

    logger.info(f"[V{video_id}] Done!")


def _save_results(video_id: int, detections: list[dict], categories: list[str], config: dict):
    import json

    scores = {}
    for cat in categories:
        cat_scores = [d["scores_detail"].get(cat, 0) for d in detections if d["scores_detail"].get(cat, 0) > 0]
        scores[cat] = max(cat_scores) if cat_scores else 0

    overall = sum(scores.values()) / len(scores) if scores else 0

    scores_json = json.dumps(scores)
    config_json = json.dumps(config, default=str)
    result_id = int(time.time() * 1000)

    execute_update(f"""
        INSERT INTO analysis_results
        (result_id, video_id, analysis_timestamp, scores_json, overall_risk, total_detections,
         scan_fps, detail_fps, model_used, config_snapshot)
        VALUES (%(rid)s, %(vid)s, NOW(), %(scores)s, %(risk)s, %(total)s,
                %(sfps)s, %(dfps)s, %(model)s, %(cfg)s)
    """, {
        "rid": result_id,
        "vid": video_id,
        "scores": scores_json,
        "risk": overall,
        "total": len(detections),
        "sfps": config.get("scan_fps", 0.2),
        "dfps": config.get("detail_fps", 1.0),
        "model": os.environ.get("FMAPI_MODEL", "llama-4-maverick"),
        "cfg": config_json,
    })

    for i, det in enumerate(detections):
        det_id = int(time.time() * 1000) + i + 1
        execute_update(f"""
            INSERT INTO detections
            (detection_id, video_id, result_id, timestamp_sec, category, score, confidence,
             ai_description, thumbnail_path, frame_index, review_status)
            VALUES (%(did)s, %(vid)s, %(rid)s, %(ts)s, %(cat)s, %(score)s, %(conf)s,
                    %(desc)s, %(thumb)s, %(fidx)s, 'PENDING')
        """, {
            "did": det_id,
            "vid": det["video_id"],
            "rid": result_id,
            "ts": det["timestamp_sec"],
            "cat": det["category"],
            "score": det["score"],
            "conf": det["confidence"],
            "desc": det["ai_description"],
            "thumb": det["thumbnail_path"],
            "fidx": det["frame_index"],
        })

    # Log processing
    log_id = int(time.time() * 1000) + len(detections) + 100
    execute_update(f"""
        INSERT INTO processing_log
        (log_id, video_id, volume_path, processed_at, status, processing_time_sec)
        SELECT %(lid)s, video_id, volume_path, NOW(), 'SUCCESS', 0
        FROM videos WHERE video_id = %(vid)s
    """, {"lid": log_id, "vid": video_id})

    logger.info(f"[V{video_id}] Saved {len(detections)} detections, overall risk={overall:.1f}")
