"""Streaming video processing routes."""

import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from server.database import execute_query
from server.stream_worker import StreamManager

logger = logging.getLogger(__name__)
router = APIRouter()


class StreamStartRequest(BaseModel):
    name: str = ""
    stream_url: str
    context_id: int
    window_seconds: int = 60
    username: str = ""
    password: str = ""


class StreamUpdateRequest(BaseModel):
    name: Optional[str] = None
    stream_url: Optional[str] = None
    window_seconds: Optional[int] = None


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
        "dedup_window": ctx.get("dedup_window", 5),
        "window_seconds": req.window_seconds,
    }

    # Inject credentials into RTSP URL if provided
    url = req.stream_url.strip()
    if req.username and url.lower().startswith("rtsp://"):
        cred = req.username
        if req.password:
            cred += f":{req.password}"
        url = url.replace("rtsp://", f"rtsp://{cred}@", 1)

    name = req.name.strip() or f"Stream #{url.split('/')[-1] or 'live'}"

    manager = StreamManager()
    info = manager.start_stream(name, url, config, req.context_id, ctx["name"])
    return info


@router.post("/{stream_id}/restart")
async def restart_stream(stream_id: int):
    manager = StreamManager()
    result = manager.restart_stream(stream_id)
    if not result:
        raise HTTPException(404, "Stream not found")
    return result


@router.put("/{stream_id}")
async def update_stream(stream_id: int, req: StreamUpdateRequest):
    manager = StreamManager()
    result = manager.update_stream(stream_id, name=req.name, stream_url=req.stream_url, window_seconds=req.window_seconds)
    if not result:
        raise HTTPException(404, "Stream not found")
    return result


@router.delete("/{stream_id}")
async def delete_stream(stream_id: int):
    manager = StreamManager()
    if not manager.delete_stream(stream_id):
        raise HTTPException(404, "Stream not found")
    return {"deleted": True}


@router.get("/{stream_id}")
async def get_stream(stream_id: int):
    manager = StreamManager()
    s = manager.get_stream(stream_id)
    if not s:
        raise HTTPException(404, "Stream not found")
    return s


@router.get("/{stream_id}/logs")
async def get_stream_logs(stream_id: int):
    manager = StreamManager()
    logs = manager.get_logs(stream_id)
    return logs


@router.get("/{stream_id}/live")
async def live_preview(stream_id: int):
    """MJPEG stream for live preview in browser."""
    import asyncio
    manager = StreamManager()

    async def mjpeg_stream():
        while True:
            s = manager.get_stream(stream_id)
            if not s or s["status"] not in ("RUNNING", "CONNECTING"):
                break
            frame = manager.get_last_frame(stream_id)
            if frame:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                )
            await asyncio.sleep(0.5)

    return StreamingResponse(
        mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/{stream_id}/progress")
async def stream_progress(stream_id: int):
    import asyncio
    manager = StreamManager()

    async def event_stream():
        while True:
            s = manager.get_stream(stream_id)
            if not s:
                break
            data = json.dumps(s)
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
    return manager.list_streams()
