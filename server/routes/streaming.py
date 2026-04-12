"""Streaming video processing routes."""

import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from server.database import execute_query
from server.stream_worker import StreamManager

logger = logging.getLogger(__name__)
router = APIRouter()


class StreamStartRequest(BaseModel):
    stream_url: str
    context_id: int
    window_seconds: int = 60
    username: str = ""
    password: str = ""


@router.post("/start")
async def start_stream(req: StreamStartRequest):
    if not req.stream_url.strip():
        raise HTTPException(400, "Stream URL required")
    if not req.context_id:
        raise HTTPException(400, "Context required")

    # Load context config
    rows = execute_query("SELECT * FROM contexts WHERE context_id = %(id)s", {"id": req.context_id})
    if not rows:
        raise HTTPException(404, "Context not found")
    ctx = rows[0]
    cats = ctx["categories"]
    if isinstance(cats, str):
        cats = json.loads(cats)
    config = {
        "categories": cats,
        "scan_prompt": ctx["scan_prompt"],
        "scan_fps": ctx.get("scan_fps", 0.2),
        "detail_fps": ctx.get("detail_fps", 1.0),
        "score_threshold": ctx.get("score_threshold", 4),
        "context_color": ctx.get("color"),
    }

    config["window_seconds"] = req.window_seconds

    # Inject credentials into RTSP URL if provided
    url = req.stream_url.strip()
    if req.username and url.lower().startswith("rtsp://"):
        cred = req.username
        if req.password:
            cred += f":{req.password}"
        url = url.replace("rtsp://", f"rtsp://{cred}@", 1)

    manager = StreamManager()
    info = manager.start_stream(url, config, req.context_id, ctx["name"])
    return info


@router.get("/{stream_id}")
async def get_stream(stream_id: int):
    manager = StreamManager()
    s = manager.get_stream(stream_id)
    if not s:
        raise HTTPException(404, "Stream not found")
    return s


@router.get("/{stream_id}/progress")
async def stream_progress(stream_id: int):
    import asyncio
    manager = StreamManager()

    async def event_stream():
        while True:
            s = manager.get_stream(stream_id)
            if not s:
                break
            data = json.dumps({
                "stream_id": s["stream_id"],
                "status": s["status"],
                "windows_processed": s["windows_processed"],
                "total_detections": s["total_detections"],
                "current_window_sec": s["current_window_sec"],
                "error": s.get("error"),
                "videos": s.get("videos", [])[-10:],
            })
            yield f"data: {data}\n\n"
            if s["status"] in ("COMPLETED", "FAILED", "STOPPED"):
                break
            await asyncio.sleep(3)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{stream_id}/stop")
async def stop_stream(stream_id: int):
    manager = StreamManager()
    manager.stop_stream(stream_id)
    return {"stopped": True}


@router.get("")
async def list_streams():
    manager = StreamManager()
    return [
        {
            "stream_id": s["stream_id"],
            "stream_url": s["stream_url"],
            "context_name": s["context_name"],
            "status": s["status"],
            "windows_processed": s["windows_processed"],
            "total_detections": s["total_detections"],
        }
        for s in manager.list_streams()
    ]
