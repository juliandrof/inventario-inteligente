"""Video upload and management routes."""

import os
import json
import threading
import tempfile
import time
import logging

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
from server.database import execute_query, execute_update, get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()

VIDEO_VOLUME = os.environ.get("VIDEO_VOLUME", "/Volumes/dbxsc/main/uploaded_videos")


def _get_config() -> dict:
    try:
        rows = execute_query("SELECT config_key, config_value FROM configurations")
        cfg = {r["config_key"]: r["config_value"] for r in rows}
        return {
            "categories": json.loads(cfg.get("detection_categories", '["fadiga", "distracao"]')),
            "scan_prompt": cfg.get("scan_prompt", "Analyze this truck driver image for signs of fatigue and distraction."),
            "detail_prompt": cfg.get("detail_prompt", "Analyze this truck driver image in detail for safety concerns."),
            "scan_fps": float(cfg.get("scan_fps", "0.2")),
            "detail_fps": float(cfg.get("detail_fps", "1.0")),
            "score_threshold": int(cfg.get("score_threshold", "4")),
        }
    except Exception:
        return {
            "categories": ["fadiga", "distracao"],
            "scan_prompt": "Analyze this truck driver image for signs of fatigue and distraction.",
            "detail_prompt": "Analyze this truck driver image in detail for safety concerns.",
            "scan_fps": 0.2, "detail_fps": 1.0, "score_threshold": 4,
        }


@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No file provided")
    allowed = ('.mp4', '.avi', '.mov', '.mkv', '.webm')
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed:
        raise HTTPException(400, f"Invalid format. Allowed: {', '.join(allowed)}")

    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    content = await file.read()
    tmp.write(content)
    tmp.close()

    volume_path = f"{VIDEO_VOLUME}/{file.filename}"
    try:
        w = get_workspace_client()
        with open(tmp.name, "rb") as f:
            w.files.upload(volume_path, f, overwrite=True)
    except Exception as e:
        os.unlink(tmp.name)
        raise HTTPException(500, f"Failed to upload to volume: {e}")

    from server.video_processor import get_video_metadata, process_video
    meta = get_video_metadata(tmp.name)
    video_id = int(time.time() * 1000)

    execute_update("""
        INSERT INTO videos (video_id, filename, volume_path, file_size_bytes, duration_seconds,
            fps, resolution, upload_timestamp, status, source)
        VALUES (%(vid)s, %(name)s, %(path)s, %(size)s, %(dur)s, %(fps)s, %(res)s, NOW(), 'PENDING', 'UPLOAD')
    """, {
        "vid": video_id, "name": file.filename, "path": volume_path,
        "size": len(content), "dur": meta.get("duration_seconds", 0),
        "fps": meta.get("fps", 0), "res": meta.get("resolution", ""),
    })

    config = _get_config()
    thread = threading.Thread(target=process_video, args=(video_id, tmp.name, config), daemon=True)
    thread.start()
    return {"video_id": video_id, "filename": file.filename, "status": "PENDING"}


@router.get("")
async def list_videos():
    return execute_query("""
        SELECT v.*, ar.scores_json, ar.overall_risk, ar.total_detections
        FROM videos v LEFT JOIN analysis_results ar ON v.video_id = ar.video_id
        ORDER BY v.upload_timestamp DESC
    """)


@router.get("/{video_id}")
async def get_video(video_id: int):
    rows = execute_query("""
        SELECT v.*, ar.scores_json, ar.overall_risk, ar.total_detections,
               ar.result_id, ar.analysis_timestamp, ar.config_snapshot
        FROM videos v LEFT JOIN analysis_results ar ON v.video_id = ar.video_id
        WHERE v.video_id = %(vid)s
    """, {"vid": video_id})
    if not rows:
        raise HTTPException(404, "Video not found")
    return rows[0]


@router.get("/{video_id}/stream")
async def stream_video(video_id: int):
    rows = execute_query("SELECT volume_path, filename FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    if not rows:
        raise HTTPException(404, "Video not found")
    filename = rows[0]["filename"]
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "mp4"
    mime = {"mp4": "video/mp4", "webm": "video/webm", "avi": "video/x-msvideo", "mov": "video/quicktime"}.get(ext, "video/mp4")
    try:
        w = get_workspace_client()
        resp = w.files.download(rows[0]["volume_path"])
        content = resp.contents.read()
        return Response(content=content, media_type=mime, headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Accept-Ranges": "bytes", "Content-Length": str(len(content)),
        })
    except Exception as e:
        raise HTTPException(500, f"Failed to stream video: {e}")


@router.delete("/{video_id}")
async def delete_video(video_id: int):
    execute_update("DELETE FROM detections WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM analysis_results WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM review_log WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    return {"deleted": True}
