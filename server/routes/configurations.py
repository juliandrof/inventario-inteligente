"""Configuration management routes."""

import json
import time
from fastapi import APIRouter
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


@router.get("/categories")
async def get_categories():
    rows = execute_query("SELECT config_value FROM configurations WHERE config_key = 'detection_categories'")
    return json.loads(rows[0]["config_value"]) if rows else ["fadiga", "distracao"]


@router.put("/{config_key}")
async def update_config(config_key: str, req: ConfigUpdate):
    existing = execute_query("SELECT config_key FROM configurations WHERE config_key = %(key)s", {"key": config_key})
    if existing:
        execute_update("UPDATE configurations SET config_value = %(val)s, description = COALESCE(%(desc)s, description), updated_at = NOW() WHERE config_key = %(key)s",
            {"key": config_key, "val": req.value, "desc": req.description})
    else:
        execute_update("INSERT INTO configurations (config_id, config_key, config_value, description, updated_at) VALUES (%(id)s, %(key)s, %(val)s, %(desc)s, NOW())",
            {"id": int(time.time() * 1000), "key": config_key, "val": req.value, "desc": req.description})
    return {"config_key": config_key, "updated": True}
