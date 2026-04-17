"""Video upload and management routes."""

import os
import time
import logging
import tempfile

from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import Response

from server.database import execute_query, execute_update, get_workspace_client
from server.video_processor import parse_video_filename, get_video_metadata, ensure_store_exists
from server.background_worker import ProcessingWorker

logger = logging.getLogger(__name__)
router = APIRouter()

VIDEO_VOLUME = os.environ.get("VIDEO_VOLUME", "/Volumes/scenic_crawler/default/uploaded_videos")


@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video. Filename must follow UF_IDLOJA_yyyymmdd.ext"""
    filename = file.filename or "unknown.mp4"

    try:
        parsed = parse_video_filename(filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    ensure_store_exists(parsed["store_id"], parsed["uf"])

    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    try:
        content = await file.read()
        tmp.write(content)
        tmp.close()

        meta = get_video_metadata(tmp.name)
        volume_path = f"{VIDEO_VOLUME}/{filename}"
        try:
            w = get_workspace_client()
            with open(tmp.name, "rb") as fh:
                w.files.upload(volume_path, fh, overwrite=True)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Erro ao salvar no Volume: {str(e)}")

        video_id = int(time.time() * 1000)
        execute_update("""
            INSERT INTO videos
            (video_id, filename, volume_path, uf, store_id, video_date,
             file_size_bytes, duration_seconds, fps, resolution, total_frames,
             upload_timestamp, status)
            VALUES (%(vid)s, %(name)s, %(path)s, %(uf)s, %(sid)s, %(vd)s,
                    %(size)s, %(dur)s, %(fps)s, %(res)s, %(tf)s, NOW(), 'PENDING')
        """, {
            "vid": video_id, "name": filename, "path": volume_path,
            "uf": parsed["uf"], "sid": parsed["store_id"], "vd": parsed["video_date"],
            "size": len(content),
            "dur": meta.get("duration_seconds", 0), "fps": meta.get("fps", 0),
            "res": meta.get("resolution", ""), "tf": meta.get("total_frames", 0),
        })

        worker = ProcessingWorker()
        worker.start_processing(video_id)

        return {
            "video_id": video_id, "filename": filename,
            "uf": parsed["uf"], "store_id": parsed["store_id"],
            "video_date": str(parsed["video_date"]), "status": "PROCESSING",
        }
    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)


@router.get("")
async def list_videos(
    uf: str = Query(None), store_id: str = Query(None),
    status: str = Query(None), limit: int = Query(50), offset: int = Query(0),
):
    conditions = []
    params = {"limit": limit, "offset": offset}

    if uf:
        conditions.append("v.uf = %(uf)s")
        params["uf"] = uf.upper()
    if store_id:
        conditions.append("v.store_id = %(sid)s")
        params["sid"] = store_id
    if status:
        conditions.append("v.status = %(status)s")
        params["status"] = status.upper()

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    videos = execute_query(f"""
        SELECT v.*, s.name as store_name,
            (SELECT COUNT(*) FROM fixtures f WHERE f.video_id = v.video_id) as fixture_count,
            (SELECT jsonb_object_agg(sq.fixture_type, sq.cnt)
             FROM (SELECT fixture_type, COUNT(*) as cnt FROM fixtures WHERE video_id = v.video_id GROUP BY fixture_type) sq
            ) as type_counts
        FROM videos v LEFT JOIN stores s ON v.store_id = s.store_id
        {where} ORDER BY v.upload_timestamp DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """, params)

    total = execute_query(f"SELECT COUNT(*) as cnt FROM videos v {where}", params)
    return {"videos": videos, "total": total[0]["cnt"] if total else 0}


@router.get("/{video_id}")
async def get_video(video_id: int):
    rows = execute_query("""
        SELECT v.*, s.name as store_name
        FROM videos v LEFT JOIN stores s ON v.store_id = s.store_id
        WHERE v.video_id = %(vid)s
    """, {"vid": video_id})
    if not rows:
        raise HTTPException(status_code=404, detail="Video nao encontrado")
    return rows[0]


@router.get("/{video_id}/fixtures")
async def get_video_fixtures(video_id: int):
    fixtures = execute_query(
        "SELECT * FROM fixtures WHERE video_id = %(vid)s ORDER BY fixture_type, tracking_id",
        {"vid": video_id})
    summary = execute_query(
        "SELECT * FROM fixture_summary WHERE video_id = %(vid)s ORDER BY fixture_type",
        {"vid": video_id})
    return {"fixtures": fixtures, "summary": summary}


@router.get("/{video_id}/stream")
async def stream_video(video_id: int):
    rows = execute_query("SELECT volume_path, filename FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    if not rows:
        raise HTTPException(404, "Video not found")
    filename = rows[0]["filename"]
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "mp4"
    mime = {"mp4": "video/mp4", "webm": "video/webm", "avi": "video/x-msvideo"}.get(ext, "video/mp4")
    try:
        w = get_workspace_client()
        resp = w.files.download(rows[0]["volume_path"])
        content = resp.contents.read()
        return Response(content=content, media_type=mime, headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Content-Length": str(len(content)),
        })
    except Exception as e:
        raise HTTPException(500, f"Erro ao transmitir video: {e}")


@router.delete("/{video_id}")
async def delete_video(video_id: int):
    execute_update("DELETE FROM fixtures WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM fixture_summary WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM detections WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM processing_log WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM anomalies WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    return {"deleted": True}


@router.post("/reprocess/{video_id}")
async def reprocess_video(video_id: int):
    video = execute_query("SELECT * FROM videos WHERE video_id = %(vid)s", {"vid": video_id})
    if not video:
        raise HTTPException(status_code=404, detail="Video nao encontrado")
    execute_update("DELETE FROM fixtures WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM fixture_summary WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM detections WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("DELETE FROM anomalies WHERE video_id = %(vid)s", {"vid": video_id})
    execute_update("UPDATE videos SET status='PENDING', progress_pct=0, error_message=NULL WHERE video_id=%(vid)s", {"vid": video_id})
    worker = ProcessingWorker()
    worker.start_processing(video_id)
    return {"status": "REPROCESSING", "video_id": video_id}


@router.post("/batch")
async def start_batch(volume_path: str = VIDEO_VOLUME):
    worker = ProcessingWorker()
    return worker.start_batch(volume_path)


@router.get("/batch/{batch_id}")
async def get_batch_status(batch_id: int):
    worker = ProcessingWorker()
    batch = worker.get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch nao encontrado")
    return batch
