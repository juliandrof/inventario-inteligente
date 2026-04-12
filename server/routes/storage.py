"""Storage management routes."""

import time
import logging
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from server.database import execute_query, execute_update, get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()


class CleanupRequest(BaseModel):
    older_than_days: int = 30
    source: str = "ALL"


@router.get("/summary")
async def storage_summary():
    total = execute_query("SELECT COUNT(*) AS cnt FROM videos")
    total_count = total[0]["cnt"] if total else 0

    by_source = execute_query("""
        SELECT COALESCE(source, 'UNKNOWN') AS source, COUNT(*) AS cnt
        FROM videos GROUP BY COALESCE(source, 'UNKNOWN') ORDER BY cnt DESC
    """)

    size = execute_query("SELECT COALESCE(SUM(file_size_bytes), 0) AS total_bytes FROM videos")
    total_bytes = size[0]["total_bytes"] if size else 0

    return {
        "total_videos": total_count,
        "total_size_estimate": total_bytes,
        "by_source": {r["source"]: r["cnt"] for r in by_source},
    }


@router.post("/cleanup")
async def cleanup_storage(req: CleanupRequest):
    source_clause = ""
    params = {"days": req.older_than_days}
    if req.source != "ALL":
        source_clause = "AND source = %(source)s"
        params["source"] = req.source

    # Get videos to delete (for physical file cleanup)
    vids = execute_query(f"""
        SELECT video_id, volume_path FROM videos
        WHERE upload_timestamp < NOW() - INTERVAL '%(days)s days' {source_clause}
    """.replace("%(days)s", str(int(req.older_than_days))), params if req.source != "ALL" else None)

    if not vids:
        return {"deleted": 0, "message": "No matching videos found"}

    video_ids = [v["video_id"] for v in vids]
    id_list = ",".join(str(i) for i in video_ids)

    # Delete related data first
    execute_update(f"DELETE FROM review_log WHERE video_id IN ({id_list})")
    execute_update(f"DELETE FROM detections WHERE video_id IN ({id_list})")
    execute_update(f"DELETE FROM analysis_results WHERE video_id IN ({id_list})")
    execute_update(f"DELETE FROM processing_log WHERE video_id IN ({id_list})")
    deleted = execute_update(f"DELETE FROM videos WHERE video_id IN ({id_list})")

    # Try to delete physical files
    deleted_files = 0
    try:
        ws = get_workspace_client()
        for v in vids:
            path = v.get("volume_path", "")
            if path and path.startswith("/Volumes/"):
                try:
                    ws.files.delete(path)
                    deleted_files += 1
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"Could not delete physical files: {e}")

    return {"deleted": deleted, "files_deleted": deleted_files}


@router.post("/clear-all")
async def clear_all_data():
    execute_update("DELETE FROM review_log")
    execute_update("DELETE FROM detections")
    execute_update("DELETE FROM analysis_results")
    execute_update("DELETE FROM processing_log")
    execute_update("DELETE FROM videos")
    return {"cleared": True, "message": "All video data cleared"}
