"""Reports endpoint with pagination and date filters."""

from fastapi import APIRouter, Query
from typing import Optional
from server.database import execute_query

router = APIRouter()


@router.get("/videos")
async def report_videos(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    risk_filter: Optional[str] = None,
    context_name: Optional[str] = None,
    upload_from: Optional[str] = None,
    upload_to: Optional[str] = None,
    review_from: Optional[str] = None,
    review_to: Optional[str] = None,
):
    """Paginated video list for reports with date filters."""
    conditions = ["v.status = 'COMPLETED'"]
    params = {}

    if search:
        conditions.append("LOWER(v.filename) LIKE LOWER(%(search)s)")
        params["search"] = f"%{search}%"

    if context_name:
        conditions.append("v.context_name = %(context_name)s")
        params["context_name"] = context_name

    if risk_filter == "WITH_DETECTIONS":
        conditions.append("COALESCE(ar.total_detections, 0) > 0")
    elif risk_filter == "CLEAN":
        conditions.append("COALESCE(ar.total_detections, 0) = 0")
    elif risk_filter == "HIGH_RISK":
        conditions.append("COALESCE(ar.overall_risk, 0) >= 7")

    if upload_from:
        conditions.append("v.upload_timestamp >= %(upload_from)s::timestamp")
        params["upload_from"] = upload_from
    if upload_to:
        conditions.append("v.upload_timestamp <= %(upload_to)s::timestamp + interval '1 day'")
        params["upload_to"] = upload_to

    if review_from or review_to:
        conditions.append("""EXISTS (
            SELECT 1 FROM review_log rl WHERE rl.video_id = v.video_id
            {from_cond} {to_cond}
        )""".format(
            from_cond="AND rl.action_timestamp >= %(review_from)s::timestamp" if review_from else "",
            to_cond="AND rl.action_timestamp <= %(review_to)s::timestamp + interval '1 day'" if review_to else "",
        ))
        if review_from:
            params["review_from"] = review_from
        if review_to:
            params["review_to"] = review_to

    where = " AND ".join(conditions)
    offset = (page - 1) * per_page
    params["limit"] = per_page
    params["offset"] = offset

    # Count total
    count_rows = execute_query(f"""
        SELECT COUNT(*) as total
        FROM videos v
        LEFT JOIN analysis_results ar ON v.video_id = ar.video_id
        WHERE {where}
    """, params)
    total = count_rows[0]["total"] if count_rows else 0

    # Fetch page
    rows = execute_query(f"""
        SELECT v.video_id, v.filename, v.duration_seconds, v.upload_timestamp,
               v.context_name, v.context_color, v.source,
               ar.scores_json, ar.overall_risk, ar.total_detections, ar.analysis_timestamp
        FROM videos v
        LEFT JOIN analysis_results ar ON v.video_id = ar.video_id
        WHERE {where}
        ORDER BY v.upload_timestamp DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, params)

    return {
        "items": rows,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": max(1, (total + per_page - 1) // per_page),
    }
