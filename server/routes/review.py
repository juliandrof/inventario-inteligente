"""Review routes - frame-by-frame AI analysis review."""

from fastapi import APIRouter, Query
from typing import Optional
from server.database import execute_query

router = APIRouter()


@router.get("/videos")
async def review_videos(
    uf: Optional[str] = None, store_id: Optional[str] = None,
    video_date: Optional[str] = None,
):
    """List completed videos available for review."""
    conds, params = ["v.status = 'COMPLETED'"], {}
    if uf:
        conds.append("v.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conds.append("v.store_id = %(sid)s")
        params["sid"] = store_id
    if video_date:
        conds.append("v.video_date = %(vd)s::date")
        params["vd"] = video_date

    return execute_query(f"""
        SELECT v.video_id, v.filename, v.uf, v.store_id, v.video_date,
            v.duration_seconds, v.frames_analyzed, s.name as store_name,
            (SELECT COUNT(*) FROM fixtures f WHERE f.video_id = v.video_id) as fixture_count,
            (SELECT COUNT(DISTINCT d.frame_index) FROM detections d WHERE d.video_id = v.video_id) as frames_with_detections,
            (SELECT COUNT(*) FROM detections d WHERE d.video_id = v.video_id) as total_detections
        FROM videos v
        LEFT JOIN stores s ON v.store_id = s.store_id
        WHERE {' AND '.join(conds)}
        ORDER BY v.upload_timestamp DESC
    """, params)


@router.get("/frames/{video_id}")
async def review_frames(video_id: int):
    """Get all analyzed frames for a video, grouped by frame with detections listed."""

    # Get video info
    video = execute_query("""
        SELECT v.*, s.name as store_name
        FROM videos v LEFT JOIN stores s ON v.store_id = s.store_id
        WHERE v.video_id = %(vid)s
    """, {"vid": video_id})

    if not video:
        return {"error": "Video nao encontrado"}

    # Get all detections grouped by frame
    detections = execute_query("""
        SELECT d.*, ft.display_name, ft.color as type_color
        FROM detections d
        LEFT JOIN fixture_types ft ON d.fixture_type = ft.name
        WHERE d.video_id = %(vid)s
        ORDER BY d.frame_index, d.fixture_type
    """, {"vid": video_id})

    # Group detections by frame
    frames = {}
    for det in detections:
        fi = det["frame_index"]
        if fi not in frames:
            frames[fi] = {
                "frame_index": fi,
                "timestamp_sec": det["timestamp_sec"],
                "thumbnail_path": det.get("thumbnail_path", ""),
                "detections": [],
            }
        frames[fi]["detections"].append({
            "detection_id": det["detection_id"],
            "fixture_type": det["fixture_type"],
            "display_name": det.get("display_name", det["fixture_type"]),
            "type_color": det.get("type_color", "#666"),
            "confidence": det["confidence"],
            "occupancy_level": det.get("occupancy_level", ""),
            "occupancy_pct": det.get("occupancy_pct", 0),
            "ai_description": det.get("ai_description", ""),
            "position": {"x": det.get("bbox_x", 50), "y": det.get("bbox_y", 50)},
        })

    # Get fixture summary for comparison
    summary = execute_query("""
        SELECT fixture_type, total_count, avg_occupancy_pct
        FROM fixture_summary WHERE video_id = %(vid)s ORDER BY fixture_type
    """, {"vid": video_id})

    # Sort frames by timestamp
    sorted_frames = sorted(frames.values(), key=lambda f: f["timestamp_sec"])

    return {
        "video": video[0],
        "frames": sorted_frames,
        "total_frames": len(sorted_frames),
        "total_detections": len(detections),
        "fixture_summary": summary,
    }
