"""DBXSC AI - Video Analysis App for Driver Safety Monitoring (Lakebase Edition)."""

import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from server.database import init_db_pool, close_db_pool
from server.routes import videos, batch, review, analysis, thumbnails, configurations, branding, dashboard, debug

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting DBXSC AI application...")
    await init_db_pool()
    yield
    logger.info("Shutting down DBXSC AI application...")
    await close_db_pool()


app = FastAPI(
    title="DBXSC AI",
    description="Video Analysis for Driver Safety Monitoring - Powered by Lakebase",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(videos.router, prefix="/api/videos", tags=["Videos"])
app.include_router(batch.router, prefix="/api/batch", tags=["Batch Processing"])
app.include_router(review.router, prefix="/api/review", tags=["Review"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["Analysis"])
app.include_router(thumbnails.router, prefix="/api/thumbnails", tags=["Thumbnails"])
app.include_router(configurations.router, prefix="/api/config", tags=["Configurations"])
app.include_router(branding.router, prefix="/api/branding", tags=["Branding"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(debug.router, prefix="/api/debug", tags=["Debug"])

frontend_dist = Path(__file__).parent / "frontend" / "dist"

if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/favicon.ico")
    async def favicon():
        fav = frontend_dist / "favicon.ico"
        if fav.exists():
            return FileResponse(str(fav))
        return FileResponse(str(frontend_dist / "index.html"))

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            return {"error": "Not found"}, 404
        file_path = frontend_dist / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(frontend_dist / "index.html"))
else:
    @app.get("/")
    async def root():
        return {"message": "DBXSC AI API - Frontend not built yet"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
