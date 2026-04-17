"""Configuration management routes."""

import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from server.database import execute_query, execute_update

router = APIRouter()


class ConfigUpdate(BaseModel):
    value: str
    description: Optional[str] = None


@router.get("")
async def list_configs():
    return execute_query("SELECT config_key, config_value, description, updated_at FROM configurations ORDER BY config_key")


@router.put("/{config_key}")
async def update_config(config_key: str, req: ConfigUpdate):
    existing = execute_query("SELECT config_key FROM configurations WHERE config_key = %(key)s", {"key": config_key})
    if existing:
        execute_update(
            "UPDATE configurations SET config_value = %(val)s, description = COALESCE(%(desc)s, description), updated_at = NOW() WHERE config_key = %(key)s",
            {"key": config_key, "val": req.value, "desc": req.description})
    else:
        execute_update(
            "INSERT INTO configurations (config_id, config_key, config_value, description, updated_at) VALUES (%(id)s, %(key)s, %(val)s, %(desc)s, NOW())",
            {"id": int(time.time() * 1000), "key": config_key, "val": req.value, "desc": req.description})
    return {"config_key": config_key, "updated": True}


class FixtureTypeCreate(BaseModel):
    name: str
    display_name: str
    description: Optional[str] = ""
    color: Optional[str] = "#666666"


@router.get("/fixture-types")
async def list_fixture_types():
    return execute_query("SELECT * FROM fixture_types ORDER BY name")


@router.post("/fixture-types")
async def create_fixture_type(req: FixtureTypeCreate):
    name = req.name.upper().strip().replace(" ", "_")
    existing = execute_query("SELECT name FROM fixture_types WHERE name = %(n)s", {"n": name})
    if existing:
        raise HTTPException(400, f"Tipo '{name}' ja existe")
    execute_update(
        "INSERT INTO fixture_types (name, display_name, description, color) VALUES (%(n)s, %(dn)s, %(d)s, %(c)s)",
        {"n": name, "dn": req.display_name, "d": req.description, "c": req.color})
    return {"name": name, "created": True}


@router.put("/fixture-types/{name}")
async def update_fixture_type(name: str, req: FixtureTypeCreate):
    execute_update(
        "UPDATE fixture_types SET display_name=%(dn)s, description=%(d)s, color=%(c)s WHERE name=%(n)s",
        {"n": name.upper(), "dn": req.display_name, "d": req.description, "c": req.color})
    return {"name": name, "updated": True}


@router.delete("/fixture-types/{name}")
async def delete_fixture_type(name: str):
    execute_update("DELETE FROM fixture_types WHERE name = %(n)s", {"n": name.upper()})
    return {"name": name, "deleted": True}


@router.post("/clear-all")
async def clear_all_data():
    """Delete all analysis data (videos, fixtures, detections, anomalies, stores)."""
    tables = ["detections", "fixtures", "fixture_summary", "anomalies", "processing_log", "videos", "stores"]
    deleted = {}
    for t in tables:
        rows = execute_update(f"DELETE FROM {t}")
        deleted[t] = rows
    return {"cleared": True, "deleted": deleted}
