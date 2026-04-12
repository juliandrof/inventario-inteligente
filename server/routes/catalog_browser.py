"""Unity Catalog browser for volume navigation."""

import logging
from fastapi import APIRouter
from server.database import get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/catalogs")
async def list_catalogs():
    try:
        w = get_workspace_client()
        cats = list(w.catalogs.list())
        return [{"name": c.name} for c in cats]
    except Exception as e:
        return [{"name": "Error", "error": str(e)[:200]}]


@router.get("/schemas/{catalog}")
async def list_schemas(catalog: str):
    try:
        w = get_workspace_client()
        schemas = list(w.schemas.list(catalog_name=catalog))
        return [{"name": s.name, "full_name": s.full_name} for s in schemas]
    except Exception as e:
        return []


@router.get("/volumes/{catalog}/{schema}")
async def list_volumes(catalog: str, schema: str):
    try:
        w = get_workspace_client()
        vols = list(w.volumes.list(catalog_name=catalog, schema_name=schema))
        return [{"name": v.name, "path": f"/Volumes/{catalog}/{schema}/{v.name}", "volume_type": str(v.volume_type)} for v in vols]
    except Exception as e:
        return []


@router.get("/files")
async def list_files(path: str):
    try:
        w = get_workspace_client()
        entries = list(w.files.list_directory_contents(path))
        files = []
        for entry in entries:
            name = entry.path.split("/")[-1] if hasattr(entry, 'path') else str(entry)
            files.append({"name": name, "path": entry.path if hasattr(entry, 'path') else path + "/" + name})
        return files
    except Exception as e:
        return []
