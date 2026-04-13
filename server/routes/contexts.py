"""Context management routes - named configuration profiles."""

import json
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from server.database import execute_query, execute_update

router = APIRouter()


class ContextCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    categories: list[str]
    scan_prompt: str
    scan_fps: Optional[float] = 0.2
    detail_fps: Optional[float] = 1.0
    score_threshold: Optional[int] = 4
    color: Optional[str] = "#2563EB"
    dedup_window: Optional[int] = 5


class ContextUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    categories: Optional[list[str]] = None
    scan_prompt: Optional[str] = None
    scan_fps: Optional[float] = None
    detail_fps: Optional[float] = None
    score_threshold: Optional[int] = None
    color: Optional[str] = None
    dedup_window: Optional[int] = None


@router.get("")
async def list_contexts():
    return execute_query("SELECT * FROM contexts ORDER BY name")


@router.get("/{context_id}")
async def get_context(context_id: int):
    rows = execute_query("SELECT * FROM contexts WHERE context_id = %(id)s", {"id": context_id})
    if not rows:
        raise HTTPException(404, "Context not found")
    return rows[0]


@router.post("")
async def create_context(req: ContextCreate):
    cid = int(time.time() * 1000)
    execute_update("""
        INSERT INTO contexts (context_id, name, description, categories, scan_prompt, scan_fps, detail_fps, score_threshold, color, dedup_window, created_at, updated_at)
        VALUES (%(id)s, %(name)s, %(desc)s, %(cats)s, %(prompt)s, %(sfps)s, %(dfps)s, %(thresh)s, %(color)s, %(dedup)s, NOW(), NOW())
    """, {
        "id": cid, "name": req.name, "desc": req.description,
        "cats": json.dumps(req.categories), "prompt": req.scan_prompt,
        "sfps": req.scan_fps, "dfps": req.detail_fps, "thresh": req.score_threshold,
        "color": req.color or "#2563EB", "dedup": req.dedup_window or 5,
    })
    return {"context_id": cid, "name": req.name}


@router.put("/{context_id}")
async def update_context(context_id: int, req: ContextUpdate):
    existing = execute_query("SELECT * FROM contexts WHERE context_id = %(id)s", {"id": context_id})
    if not existing:
        raise HTTPException(404, "Context not found")

    updates = []
    params = {"id": context_id}
    if req.name is not None:
        updates.append("name = %(name)s"); params["name"] = req.name
    if req.description is not None:
        updates.append("description = %(desc)s"); params["desc"] = req.description
    if req.categories is not None:
        updates.append("categories = %(cats)s"); params["cats"] = json.dumps(req.categories)
    if req.scan_prompt is not None:
        updates.append("scan_prompt = %(prompt)s"); params["prompt"] = req.scan_prompt
    if req.scan_fps is not None:
        updates.append("scan_fps = %(sfps)s"); params["sfps"] = req.scan_fps
    if req.detail_fps is not None:
        updates.append("detail_fps = %(dfps)s"); params["dfps"] = req.detail_fps
    if req.score_threshold is not None:
        updates.append("score_threshold = %(thresh)s"); params["thresh"] = req.score_threshold
    if req.color is not None:
        updates.append("color = %(color)s"); params["color"] = req.color
    if req.dedup_window is not None:
        updates.append("dedup_window = %(dedup)s"); params["dedup"] = req.dedup_window

    if updates:
        updates.append("updated_at = NOW()")
        execute_update(f"UPDATE contexts SET {', '.join(updates)} WHERE context_id = %(id)s", params)

    return {"context_id": context_id, "updated": True}


@router.delete("/{context_id}")
async def delete_context(context_id: int):
    execute_update("DELETE FROM contexts WHERE context_id = %(id)s", {"id": context_id})
    return {"deleted": True}
