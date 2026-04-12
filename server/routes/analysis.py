"""Analysis results routes."""

from fastapi import APIRouter, HTTPException
from server.database import execute_query

router = APIRouter()


@router.get("/{video_id}")
async def get_analysis(video_id: int):
    """Get analysis results for a video."""
    rows = execute_query(f"""
        SELECT * FROM analysis_results
        WHERE video_id = %(vid)s
        ORDER BY analysis_timestamp DESC
        LIMIT 1
    """, {"vid": video_id})
    if not rows:
        raise HTTPException(404, "No analysis found for this video")
    return rows[0]


@router.get("/{video_id}/detections")
async def get_detections(video_id: int):
    """List all detections for a video."""
    rows = execute_query(f"""
        SELECT * FROM detections
        WHERE video_id = %(vid)s
        ORDER BY timestamp_sec ASC
    """, {"vid": video_id})
    return rows
