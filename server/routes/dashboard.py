"""Dashboard analytics routes with context and date filters."""

from fastapi import APIRouter, Query
from typing import Optional
from server.database import execute_query

router = APIRouter()


def _build_where(context_name: Optional[str], upload_from: Optional[str], upload_to: Optional[str]):
    """Build WHERE conditions and params for video-based filters."""
    conds = []
    params = {}
    if context_name:
        conds.append("v.context_name = %(ctx)s")
        params["ctx"] = context_name
    if upload_from:
        conds.append("v.upload_timestamp >= %(uf)s::timestamp")
        params["uf"] = upload_from
    if upload_to:
        conds.append("v.upload_timestamp <= %(ut)s::timestamp + interval '1 day'")
        params["ut"] = upload_to
    return (" AND " + " AND ".join(conds)) if conds else "", params


@router.get("/summary")
async def summary(
    context_name: Optional[str] = None,
    upload_from: Optional[str] = None,
    upload_to: Optional[str] = None,
):
    where_v, params = _build_where(context_name, upload_from, upload_to)
    # For detection queries, join through videos
    det_join = f"FROM detections d JOIN videos v ON d.video_id = v.video_id WHERE 1=1 {where_v}"
    ar_join = f"FROM analysis_results ar JOIN videos v ON ar.video_id = v.video_id WHERE 1=1 {where_v}"
    v_where = f"FROM videos v WHERE 1=1 {where_v}"

    videos = execute_query(f"SELECT COUNT(*) as cnt {v_where}", params)
    completed = execute_query(f"SELECT COUNT(*) as cnt {v_where} AND v.status = 'COMPLETED'", params)
    detections = execute_query(f"SELECT COUNT(*) as cnt {det_join}", params)
    pending = execute_query(f"SELECT COUNT(*) as cnt {det_join} AND d.review_status = 'PENDING'", params)
    confirmed = execute_query(f"SELECT COUNT(*) as cnt {det_join} AND d.review_status = 'CONFIRMED'", params)
    rejected = execute_query(f"SELECT COUNT(*) as cnt {det_join} AND d.review_status = 'REJECTED'", params)
    avg_risk = execute_query(f"SELECT COALESCE(AVG(ar.overall_risk), 0) as avg_risk {ar_join}", params)

    return {
        "total_videos": videos[0]["cnt"] if videos else 0,
        "completed_videos": completed[0]["cnt"] if completed else 0,
        "total_detections": detections[0]["cnt"] if detections else 0,
        "pending_reviews": pending[0]["cnt"] if pending else 0,
        "confirmed_detections": confirmed[0]["cnt"] if confirmed else 0,
        "rejected_detections": rejected[0]["cnt"] if rejected else 0,
        "avg_risk_score": round(float(avg_risk[0]["avg_risk"]), 1) if avg_risk else 0,
    }


@router.get("/by-category")
async def detections_by_category(
    context_name: Optional[str] = None,
    upload_from: Optional[str] = None,
    upload_to: Optional[str] = None,
):
    where_v, params = _build_where(context_name, upload_from, upload_to)
    return execute_query(f"""
        SELECT d.category, COUNT(*) as cnt, AVG(d.score) as avg_score
        FROM detections d JOIN videos v ON d.video_id = v.video_id
        WHERE 1=1 {where_v}
        GROUP BY d.category ORDER BY cnt DESC
    """, params)


@router.get("/recent")
async def recent_videos(
    context_name: Optional[str] = None,
    upload_from: Optional[str] = None,
    upload_to: Optional[str] = None,
):
    where_v, params = _build_where(context_name, upload_from, upload_to)
    return execute_query(f"""
        SELECT v.video_id, v.filename, v.status, v.progress_pct,
               v.upload_timestamp, v.duration_seconds, v.context_name,
               ar.overall_risk, ar.total_detections
        FROM videos v LEFT JOIN analysis_results ar ON v.video_id = ar.video_id
        WHERE 1=1 {where_v}
        ORDER BY v.upload_timestamp DESC LIMIT 20
    """, params)


@router.get("/risk-distribution")
async def risk_distribution(
    context_name: Optional[str] = None,
    upload_from: Optional[str] = None,
    upload_to: Optional[str] = None,
):
    where_v, params = _build_where(context_name, upload_from, upload_to)
    return execute_query(f"""
        SELECT
            CASE
                WHEN d.score <= 3 THEN 'Baixo (0-3)'
                WHEN d.score <= 6 THEN 'Medio (4-6)'
                WHEN d.score <= 8 THEN 'Alto (7-8)'
                ELSE 'Critico (9-10)'
            END as risk_level,
            COUNT(*) as cnt
        FROM detections d JOIN videos v ON d.video_id = v.video_id
        WHERE 1=1 {where_v}
        GROUP BY 1 ORDER BY 1
    """, params)
