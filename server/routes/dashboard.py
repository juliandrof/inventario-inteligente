"""Dashboard analytics routes."""

from fastapi import APIRouter
from server.database import execute_query

router = APIRouter()


@router.get("/summary")
async def summary():
    """Dashboard summary stats."""
    videos = execute_query(f"SELECT COUNT(*) as cnt FROM videos")
    completed = execute_query(f"SELECT COUNT(*) as cnt FROM videos WHERE status = 'COMPLETED'")
    detections = execute_query(f"SELECT COUNT(*) as cnt FROM detections")
    pending_reviews = execute_query(f"""
        SELECT COUNT(*) as cnt FROM detections WHERE review_status = 'PENDING'
    """)
    confirmed = execute_query(f"""
        SELECT COUNT(*) as cnt FROM detections WHERE review_status = 'CONFIRMED'
    """)
    rejected = execute_query(f"""
        SELECT COUNT(*) as cnt FROM detections WHERE review_status = 'REJECTED'
    """)
    avg_risk = execute_query(f"""
        SELECT COALESCE(AVG(overall_risk), 0) as avg_risk FROM analysis_results
    """)

    return {
        "total_videos": videos[0]["cnt"] if videos else 0,
        "completed_videos": completed[0]["cnt"] if completed else 0,
        "total_detections": detections[0]["cnt"] if detections else 0,
        "pending_reviews": pending_reviews[0]["cnt"] if pending_reviews else 0,
        "confirmed_detections": confirmed[0]["cnt"] if confirmed else 0,
        "rejected_detections": rejected[0]["cnt"] if rejected else 0,
        "avg_risk_score": round(float(avg_risk[0]["avg_risk"]), 1) if avg_risk else 0,
    }


@router.get("/by-category")
async def detections_by_category():
    """Detections count by category."""
    rows = execute_query(f"""
        SELECT category, COUNT(*) as cnt, AVG(score) as avg_score
        FROM detections
        GROUP BY category
        ORDER BY cnt DESC
    """)
    return rows


@router.get("/recent")
async def recent_videos():
    """Recent videos with status."""
    rows = execute_query(f"""
        SELECT v.video_id, v.filename, v.status, v.progress_pct,
               v.upload_timestamp, v.duration_seconds,
               ar.overall_risk, ar.total_detections
        FROM videos v
        LEFT JOIN analysis_results ar ON v.video_id = ar.video_id
        ORDER BY v.upload_timestamp DESC
        LIMIT 20
    """)
    return rows


@router.get("/risk-distribution")
async def risk_distribution():
    """Risk score distribution histogram."""
    rows = execute_query(f"""
        SELECT
            CASE
                WHEN score <= 3 THEN 'Baixo (1-3)'
                WHEN score <= 6 THEN 'Medio (4-6)'
                WHEN score <= 8 THEN 'Alto (7-8)'
                ELSE 'Critico (9-10)'
            END as risk_level,
            COUNT(*) as cnt
        FROM detections
        GROUP BY 1
        ORDER BY 1
    """)
    return rows
