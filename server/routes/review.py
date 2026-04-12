"""Review workflow routes."""

import time
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from server.database import execute_query, execute_update

logger = logging.getLogger(__name__)
router = APIRouter()


class ReviewAction(BaseModel):
    notes: Optional[str] = ""


@router.post("/{detection_id}/confirm")
async def confirm_detection(detection_id: int, action: ReviewAction):
    rows = execute_query("SELECT detection_id, video_id, review_status FROM detections WHERE detection_id = %(did)s", {"did": detection_id})
    if not rows:
        raise HTTPException(404, "Detection not found")
    previous, video_id = rows[0]["review_status"], rows[0]["video_id"]
    execute_update("UPDATE detections SET review_status = 'CONFIRMED', reviewer_notes = %(notes)s, reviewed_at = NOW() WHERE detection_id = %(did)s", {"did": detection_id, "notes": action.notes})
    execute_update("INSERT INTO review_log (review_log_id, detection_id, video_id, action, previous_status, reviewer, notes, action_timestamp) VALUES (%(rlid)s, %(did)s, %(vid)s, 'CONFIRMED', %(prev)s, 'user', %(notes)s, NOW())",
        {"rlid": int(time.time() * 1000), "did": detection_id, "vid": video_id, "prev": previous, "notes": action.notes})
    return {"detection_id": detection_id, "status": "CONFIRMED"}


@router.post("/{detection_id}/reject")
async def reject_detection(detection_id: int, action: ReviewAction):
    rows = execute_query("SELECT detection_id, video_id, review_status FROM detections WHERE detection_id = %(did)s", {"did": detection_id})
    if not rows:
        raise HTTPException(404, "Detection not found")
    previous, video_id = rows[0]["review_status"], rows[0]["video_id"]
    execute_update("UPDATE detections SET review_status = 'REJECTED', reviewer_notes = %(notes)s, reviewed_at = NOW() WHERE detection_id = %(did)s", {"did": detection_id, "notes": action.notes})
    execute_update("INSERT INTO review_log (review_log_id, detection_id, video_id, action, previous_status, reviewer, notes, action_timestamp) VALUES (%(rlid)s, %(did)s, %(vid)s, 'REJECTED', %(prev)s, 'user', %(notes)s, NOW())",
        {"rlid": int(time.time() * 1000), "did": detection_id, "vid": video_id, "prev": previous, "notes": action.notes})
    return {"detection_id": detection_id, "status": "REJECTED"}


@router.get("/pending")
async def pending_reviews():
    return execute_query("""
        SELECT d.*, v.filename FROM detections d
        JOIN videos v ON d.video_id = v.video_id
        WHERE d.review_status = 'PENDING' ORDER BY d.score DESC
    """)


@router.get("/pending-videos")
async def pending_videos():
    """Videos that have at least one pending detection (grouped by video)."""
    return execute_query("""
        SELECT v.video_id, v.filename, v.duration_seconds,
               ar.overall_risk, ar.scores_json, ar.total_detections,
               COUNT(d.detection_id) FILTER (WHERE d.review_status = 'PENDING') as pending_count,
               (SELECT d2.thumbnail_path FROM detections d2
                WHERE d2.video_id = v.video_id AND d2.thumbnail_path IS NOT NULL
                ORDER BY d2.score DESC LIMIT 1) as first_thumbnail,
               MAX(d.score) as max_score
        FROM videos v
        JOIN analysis_results ar ON v.video_id = ar.video_id
        JOIN detections d ON v.video_id = d.video_id
        WHERE ar.overall_risk > 0
        GROUP BY v.video_id, v.filename, v.duration_seconds,
                 ar.overall_risk, ar.scores_json, ar.total_detections
        HAVING COUNT(d.detection_id) FILTER (WHERE d.review_status = 'PENDING') > 0
        ORDER BY ar.overall_risk DESC
    """)


@router.get("/log")
async def review_log():
    return execute_query("""
        SELECT rl.*, v.filename, d.category, d.score
        FROM review_log rl JOIN videos v ON rl.video_id = v.video_id
        JOIN detections d ON rl.detection_id = d.detection_id
        ORDER BY rl.action_timestamp DESC LIMIT 100
    """)
