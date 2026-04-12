"""Background worker for async batch video processing."""

import os
import time
import threading
import logging
import tempfile
from typing import Optional

import time as _time
from server.database import execute_query, execute_update, get_workspace_client
from server.video_processor import process_video, compute_file_hash, get_video_metadata

logger = logging.getLogger(__name__)


class BatchManager:
    """Singleton manager for batch processing jobs."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._batches = {}
                    cls._instance._counter = 0
        return cls._instance

    def start_batch(self, volume_path: str, config: dict, user: str = "") -> dict:
        """Start a batch processing job for all videos in a volume."""
        self._counter += 1
        batch_id = self._counter

        batch_info = {
            "batch_id": batch_id,
            "volume_path": volume_path,
            "status": "STARTING",
            "total": 0,
            "completed": 0,
            "failed": 0,
            "skipped": 0,
            "current_video": "",
            "pct": 0,
            "estimated_remaining_sec": 0,
            "started_at": time.time(),
            "videos": [],
            "cancel_requested": False,
        }
        self._batches[batch_id] = batch_info

        thread = threading.Thread(
            target=self._run_batch,
            args=(batch_id, volume_path, config, user),
            daemon=True,
        )
        thread.start()

        return batch_info

    def get_batch(self, batch_id: int) -> Optional[dict]:
        return self._batches.get(batch_id)

    def cancel_batch(self, batch_id: int):
        if batch_id in self._batches:
            self._batches[batch_id]["cancel_requested"] = True

    def list_batches(self) -> list[dict]:
        return list(self._batches.values())

    def _run_batch(self, batch_id: int, volume_path: str, config: dict, user: str):
        batch = self._batches[batch_id]
        try:
            # List files in the volume
            w = get_workspace_client()
            video_files = []
            try:
                entries = w.files.list_directory_contents(volume_path)
                for entry in entries:
                    name = entry.path.split("/")[-1] if hasattr(entry, 'path') else str(entry)
                    if name.lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.webm')):
                        full_path = f"{volume_path}/{name}" if not hasattr(entry, 'path') else entry.path
                        video_files.append({"name": name, "path": full_path})
            except Exception as e:
                logger.error(f"Failed to list volume {volume_path}: {e}")
                batch["status"] = "FAILED"
                batch["error"] = str(e)
                return

            # Check processing log to skip already processed
            already_processed = set()
            try:
                rows = execute_query(f"""
                    SELECT volume_path FROM processing_log
                    WHERE status = 'SUCCESS'
                """)
                already_processed = {r["volume_path"] for r in rows}
            except Exception:
                pass

            to_process = []
            for vf in video_files:
                if vf["path"] in already_processed:
                    batch["skipped"] += 1
                else:
                    to_process.append(vf)

            batch["total"] = len(to_process)
            batch["status"] = "RUNNING"
            batch["videos"] = [{"name": v["name"], "status": "PENDING", "video_id": None} for v in to_process]

            if not to_process:
                batch["status"] = "COMPLETED"
                batch["pct"] = 100
                return

            start_time = time.time()

            for idx, vf in enumerate(to_process):
                if batch["cancel_requested"]:
                    batch["status"] = "CANCELLED"
                    return

                batch["current_video"] = vf["name"]
                batch["current_video_id"] = None
                batch["videos"][idx]["status"] = "PROCESSING"

                try:
                    # Download video to temp file
                    local_path = self._download_video(w, vf["path"])

                    # Register video in DB
                    meta = get_video_metadata(local_path)
                    video_id = int(_time.time() * 1000) + idx
                    execute_update(f"""
                        INSERT INTO videos
                        (video_id, filename, volume_path, file_size_bytes, duration_seconds, fps,
                         resolution, upload_timestamp, status, source, uploaded_by, context_id, context_name)
                        VALUES (%(vid)s, %(name)s, %(path)s, %(size)s, %(dur)s, %(fps)s,
                                %(res)s, NOW(), 'PENDING', 'BATCH', %(user)s, %(cid)s, %(cname)s)
                    """, {
                        "vid": video_id,
                        "name": vf["name"],
                        "path": vf["path"],
                        "size": os.path.getsize(local_path),
                        "dur": meta.get("duration_seconds", 0),
                        "fps": meta.get("fps", 0),
                        "res": meta.get("resolution", ""),
                        "user": user,
                        "cid": config.get("context_id") or None,
                        "cname": config.get("context_name"),
                    })

                    # Track video_id in batch state
                    batch["current_video_id"] = video_id
                    batch["videos"][idx]["video_id"] = video_id

                    # Process
                    def progress_cb(vid, pct):
                        video_pct = (idx + pct / 100) / len(to_process) * 100
                        batch["pct"] = min(99, video_pct)
                        elapsed = time.time() - start_time
                        if batch["pct"] > 0:
                            est_total = elapsed / (batch["pct"] / 100)
                            batch["estimated_remaining_sec"] = max(0, est_total - elapsed)

                    process_video(video_id, local_path, config, progress_callback=progress_cb)

                    batch["completed"] += 1
                    batch["videos"][idx]["status"] = "COMPLETED"

                    # Cleanup temp file
                    os.unlink(local_path)

                except Exception as e:
                    logger.error(f"Batch processing failed for {vf['name']}: {e}")
                    batch["failed"] += 1
                    batch["videos"][idx]["status"] = "FAILED"
                    batch["videos"][idx]["error"] = str(e)[:200]

            batch["status"] = "COMPLETED"
            batch["pct"] = 100
            batch["estimated_remaining_sec"] = 0

        except Exception as e:
            logger.error(f"Batch {batch_id} failed: {e}")
            batch["status"] = "FAILED"
            batch["error"] = str(e)

    def _download_video(self, w, volume_path: str) -> str:
        """Download video from Databricks Volume to a local temp file."""
        suffix = "." + volume_path.split(".")[-1] if "." in volume_path else ".mp4"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        try:
            resp = w.files.download(volume_path)
            for chunk in iter(lambda: resp.contents.read(8192), b""):
                tmp.write(chunk)
            tmp.close()
            return tmp.name
        except Exception:
            tmp.close()
            os.unlink(tmp.name)
            raise
