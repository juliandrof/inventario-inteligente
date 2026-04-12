"""Batch processing routes."""

import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from server.database import execute_query
from server.background_worker import BatchManager

logger = logging.getLogger(__name__)
router = APIRouter()


class BatchStartRequest(BaseModel):
    volume_path: str


def _get_config() -> dict:
    try:
        rows = execute_query(f"SELECT config_key, config_value FROM configurations")
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
            "scan_fps": 0.2,
            "detail_fps": 1.0,
            "score_threshold": 4,
        }


@router.post("/start")
async def start_batch(req: BatchStartRequest):
    """Start batch processing for all videos in a volume."""
    config = _get_config()
    manager = BatchManager()
    batch_info = manager.start_batch(req.volume_path, config)
    return batch_info


@router.get("/{batch_id}/progress")
async def batch_progress(batch_id: int):
    """Get batch processing progress (SSE stream)."""
    import asyncio
    import time

    manager = BatchManager()
    batch = manager.get_batch(batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    async def event_stream():
        while True:
            b = manager.get_batch(batch_id)
            if not b:
                break
            data = json.dumps({
                "batch_id": b["batch_id"],
                "status": b["status"],
                "total": b["total"],
                "completed": b["completed"],
                "failed": b["failed"],
                "skipped": b["skipped"],
                "current_video": b["current_video"],
                "current_video_id": b.get("current_video_id"),
                "pct": round(b["pct"], 1),
                "estimated_remaining_sec": round(b.get("estimated_remaining_sec", 0)),
                "videos": b.get("videos", []),
            })
            yield f"data: {data}\n\n"
            if b["status"] in ("COMPLETED", "FAILED", "CANCELLED"):
                break
            await asyncio.sleep(2)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{batch_id}/cancel")
async def cancel_batch(batch_id: int):
    """Cancel a running batch."""
    manager = BatchManager()
    manager.cancel_batch(batch_id)
    return {"cancelled": True}


@router.get("")
async def list_batches():
    """List all batch jobs."""
    manager = BatchManager()
    batches = manager.list_batches()
    return [
        {
            "batch_id": b["batch_id"],
            "volume_path": b["volume_path"],
            "status": b["status"],
            "total": b["total"],
            "completed": b["completed"],
            "failed": b["failed"],
            "skipped": b["skipped"],
            "pct": round(b["pct"], 1),
        }
        for b in batches
    ]
