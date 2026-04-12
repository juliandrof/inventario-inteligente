# Databricks Scenic Crawler AI

A generic, multi-tenant Databricks App for AI-powered video analysis, backed by **Lakebase** (managed PostgreSQL).

## Why "Scenic Crawler AI"?

The name reflects the technical and functional essence of the tool:

- **Scenic** — Refers to the deep understanding of visual content. Unlike metadata-based searches, our AI analyzes the scene, objects, and visual context within every frame.
- **Crawler** — A classic computing term for bots that systematically browse through large amounts of data. The app acts as an "intelligent indexer," scouting every second of video to find exactly what you're looking for.
- **AI** — The core of the project. We leverage advanced computer vision models to interpret natural language and locate specific elements with semantic precision.

## Overview

Databricks Scenic Crawler AI extracts frames from video files and sends them to a vision model (via Databricks FMAPI) for analysis. It scores each frame against user-defined detection categories, generates AI descriptions, saves thumbnails at detection moments, and provides a full review workflow with confirm/reject actions.

The app is **fully configurable through the UI**:
- **Contexts** — Named analysis profiles with their own categories, prompts, and thresholds (e.g., "Driver Safety", "Workplace Compliance", "Quality Inspection")
- **Detection categories** — Custom scoring dimensions per context (0-10 scale)
- **Prompts** — Natural language instructions sent to the vision model
- **Branding** — Logo and color palette customizable per deployment
- **Multi-language** — UI available in English, Portuguese, and Spanish

## Architecture

```
+--------------------------------------------------+
|              Browser (React SPA)                  |
|   Dashboard | Upload | Batch | Review | Reports  |
+--------------------------------------------------+
              | REST API + SSE
              v
+--------------------------------------------------+
|          FastAPI Backend (Python)                  |
|  OpenCV frame extraction -> FMAPI vision analysis |
|  Background workers + real-time progress          |
+--------------------------------------------------+
       |              |              |
       v              v              v
+------------+  +------------+  +------------+
| Lakebase   |  | FMAPI      |  | Volumes    |
| PostgreSQL |  | (config-   |  | videos/    |
| (8 tables) |  |  urable)   |  | thumbnails |
+------------+  +------------+  +------------+
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Context-based analysis** | Multiple named profiles with independent categories, prompts, and thresholds |
| **Unified "Process Videos"** | Single wizard: select context -> choose method (local upload or batch from Databricks Volume) |
| **Unity Catalog browser** | Navigate catalogs, schemas, and volumes to select batch source |
| **Skip already processed** | Processing log prevents re-analysis of previously processed videos |
| **Review workflow** | Video player with clickable thumbnails at detection moments, confirm/reject per detection |
| **AI descriptions** | Natural language explanation of detected signals (configurable language) |
| **Flexible scoring** | 0-10 score per category, stored as JSON for dynamic schema |
| **Paginated reports** | Filter by context, date range (30/60/90 days or custom), search by filename |
| **Dashboard with filters** | KPIs, category charts, score distribution, filtered by context and date |
| **Configurable AI model** | Vision model endpoint selectable via Settings (Llama 4, Claude, GPT, Gemini, etc.) |
| **Batch with SSE progress** | Real-time progress streaming, video preview, skip already processed |
| **Unified Settings** | Single page with tabs: Contexts, AI Model, Branding |
| **Customizable branding** | Upload logo, set color palette, live preview |
| **Multi-language UI** | English, Portuguese, Spanish — switchable in sidebar |
| **Auto-refresh progress** | Review page polls every 3 seconds during processing |

## Technologies

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| Python | 3.11+ | Backend language |
| FastAPI | >= 0.115 | Async REST API framework |
| Uvicorn | >= 0.30 | ASGI server |
| psycopg2 | >= 2.9 | PostgreSQL driver (Lakebase) |
| Databricks SDK | >= 0.30 | Auth, Volumes, credential generation |
| OpenCV (headless) | >= 4.9 | Video frame extraction |
| Pillow | >= 10.0 | Image manipulation (thumbnails) |

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.2 | UI framework (SPA) |
| Vite | 8.0 | Build tool and dev server |
| CSS custom properties | - | Dynamic theming from branding settings |
| HTML5 Video | - | Native player with timestamp seeking |
| Server-Sent Events | - | Real-time batch progress streaming |
| i18n (custom) | - | Multi-language support (PT/EN/ES) |

### AI / Vision
| Technology | Purpose |
|-----------|---------|
| Databricks FMAPI | Pay-per-token vision model inference |
| Configurable model | Default: Llama 4 Maverick. Changeable via Settings to any vision-capable endpoint (Claude, GPT, Gemini, etc.) |

### Infrastructure
| Resource | Purpose |
|---------|---------|
| **Databricks Lakebase** | Managed PostgreSQL database (scales to zero) |
| Databricks Apps | App hosting (managed container) |
| Databricks Volumes | Video and thumbnail file storage |
| Unity Catalog | Catalog/schema/volume navigation |
| Serving Endpoints | FMAPI model access |
| Service Principal | Automatic app authentication |

## Configuration (Environment Variables)

All names are parameterizable via `app.yaml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DBXSC_AI_DB_HOST` | (auto-discovered) | Lakebase endpoint host |
| `DBXSC_AI_DB_PORT` | 5432 | PostgreSQL port |
| `DBXSC_AI_DB_NAME` | dbxsc_ai | Database name |
| `DBXSC_AI_DB_SCHEMA` | public | PostgreSQL schema |
| `DBXSC_AI_LAKEBASE_PROJECT` | dbxsc-ai | Lakebase project ID |
| `DBXSC_AI_LAKEBASE_BRANCH` | production | Lakebase branch |
| `DBXSC_AI_LAKEBASE_ENDPOINT` | primary | Lakebase endpoint |
| `DBXSC_AI_DB_USER` | (auto from SP) | PostgreSQL username |
| `DBXSC_AI_DB_PASSWORD` | (auto from OAuth) | PostgreSQL password |
| `FMAPI_MODEL` | databricks-llama-4-maverick | Vision model endpoint |
| `VIDEO_VOLUME` | /Volumes/.../uploaded_videos | Video storage path |
| `THUMBNAIL_VOLUME` | /Volumes/.../thumbnails | Thumbnail storage path |

## Database Schema (PostgreSQL / Lakebase)

| Table | Purpose |
|-------|---------|
| `videos` | Video metadata, processing status, progress, context reference |
| `analysis_results` | Aggregated scores per video (flexible JSON schema) |
| `detections` | Individual detection events with timestamps, thumbnails, review status |
| `processing_log` | Tracks processed videos for skip-on-rerun deduplication |
| `contexts` | Named analysis profiles with categories, prompts, thresholds |
| `configurations` | Legacy key-value configurations |
| `branding` | Logo path, color palette settings |
| `review_log` | Audit trail for confirm/reject actions |

All tables use standard PostgreSQL types with proper foreign keys and indexes. Tables and seed data are auto-created on first startup.

## Setup

### 1. Create Lakebase Project

```bash
databricks postgres create-project scenic-crawler \
  --json '{"spec": {"display_name": "Scenic Crawler AI"}}' \
  -p PROFILE
```

### 2. Create Database

```bash
HOST=$(databricks postgres list-endpoints projects/scenic-crawler/branches/production \
  -p PROFILE -o json | jq -r '.[0].status.hosts.host')
TOKEN=$(databricks postgres generate-database-credential \
  projects/scenic-crawler/branches/production/endpoints/primary \
  -p PROFILE -o json | jq -r '.token')
EMAIL=$(databricks current-user me -p PROFILE -o json | jq -r '.userName')

PGPASSWORD=$TOKEN psql "host=$HOST port=5432 dbname=postgres user=$EMAIL sslmode=require" \
  -c "CREATE DATABASE scenic_crawler;"
```

### 3. Build Frontend

```bash
cd frontend && npm install && npm run build
```

### 4. Deploy

```bash
databricks apps create dbxsc-ai
databricks sync . /Workspace/Users/<email>/dbxsc-ai -p PROFILE
databricks apps deploy dbxsc-ai /Workspace/Users/<email>/dbxsc-ai SNAPSHOT
```

Tables and seed data are auto-created on first startup. Configure the `app.yaml` environment variables for your Lakebase instance.

## Deploying to Another Workspace (UI)

For a complete step-by-step guide to deploy this app to any Databricks workspace using only the UI (no CLI required), see:

**[Deployment Guide](DEPLOYMENT_GUIDE.md)**

Covers: GitHub integration, Git folder setup, Lakebase creation, environment variables, app deployment, and updating.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/videos/upload` | Upload video with context (multipart) |
| GET | `/api/videos` | List all videos |
| GET | `/api/videos/{id}/stream` | Stream video file (MP4) |
| DELETE | `/api/videos/{id}` | Delete video and all related data |
| POST | `/api/batch/start` | Start batch processing (volume + context) |
| GET | `/api/batch/{id}/progress` | SSE progress stream |
| GET | `/api/contexts` | List analysis contexts |
| POST | `/api/contexts` | Create new context |
| PUT | `/api/contexts/{id}` | Update context |
| DELETE | `/api/contexts/{id}` | Delete context |
| POST | `/api/review/{id}/confirm` | Confirm detection |
| POST | `/api/review/{id}/reject` | Reject detection |
| GET | `/api/review/pending-videos` | Videos with pending reviews |
| GET | `/api/reports/videos` | Paginated report with filters |
| GET | `/api/dashboard/summary` | Dashboard KPIs (filterable) |
| GET | `/api/dashboard/by-category` | Detections by category |
| GET | `/api/dashboard/recent` | Recent videos |
| GET | `/api/dashboard/risk-distribution` | Score distribution |
| GET | `/api/branding` | Get branding settings |
| PUT | `/api/branding/{key}` | Update color |
| POST | `/api/branding/logo` | Upload custom logo |
| GET | `/api/catalog/catalogs` | List Unity Catalog catalogs |
| GET | `/api/catalog/schemas/{catalog}` | List schemas |
| GET | `/api/catalog/volumes/{catalog}/{schema}` | List volumes |
| GET | `/api/debug/logs` | App logs (troubleshooting) |

## Cost Estimate (FMAPI pay-per-token)

Model: Llama 4 Maverick via Databricks FMAPI

| Volume | FMAPI | Lakebase | Storage | Total/month |
|--------|-------|----------|---------|-------------|
| 10 hours | ~$15 | ~$5 | <$1 | **~$20** |
| 1,000 hours | ~$360 | ~$15 | ~$20 | **~$395** |
| 5,000 hours | ~$1,800 | ~$50 | ~$100 | **~$1,950** |
| 10,000 hours | ~$3,600 | ~$80 | ~$200 | **~$3,880** |
| 20,000 hours | ~$7,200 | ~$120 | ~$400 | **~$7,720** |
| 30,000 hours | ~$10,800 | ~$150 | ~$600 | **~$11,550** |
| 40,000 hours | ~$14,400 | ~$175 | ~$800 | **~$15,375** |
| 50,000 hours | ~$18,000 | ~$200 | ~$1,000 | **~$19,200** |

## Project Structure

```
dbxsc-ai/
  app.py                    # FastAPI entry point + SPA serving
  app.yaml                  # Databricks Apps config (env vars, resources)
  requirements.txt          # Python dependencies
  server/
    database.py             # Lakebase connection (psycopg2, auto-setup)
    fmapi.py                # FMAPI client via HTTP (vision analysis)
    video_processor.py      # Frame extraction + analysis pipeline
    background_worker.py    # Async batch manager (threading + SSE)
    routes/
      videos.py             # Upload, list, stream, delete
      batch.py              # Batch start, cancel, SSE progress
      review.py             # Confirm/reject, pending videos
      analysis.py           # Analysis results and detections
      thumbnails.py         # Serve thumbnail images
      contexts.py           # CRUD for analysis contexts
      configurations.py     # Legacy config CRUD
      branding.py           # Logo and color settings
      dashboard.py          # KPIs with context/date filters
      reports.py            # Paginated reports with filters
      catalog_browser.py    # Unity Catalog navigation
      debug.py              # In-memory log buffer endpoint
  frontend/
    index.html              # HTML base
    package.json            # React 19, Vite 8
    vite.config.js          # Build config + dev proxy
    src/
      main.jsx              # React root with I18nProvider
      App.jsx               # SPA shell: sidebar + routing + language selector
      api.js                # Centralized API client
      i18n.jsx              # Multi-language system (PT/EN/ES, ~200 keys)
      pages/
        Dashboard.jsx       # KPIs, charts, filters
        ProcessVideos.jsx   # Unified wizard: context -> upload/batch -> progress
        VideoList.jsx       # Filterable video table
        VideoReview.jsx     # Player + thumbnails + confirm/reject
        Reports.jsx         # Paginated reports with date/context filters
        Settings.jsx        # Unified settings (Contexts + AI Model + Branding)
  sql/
    01_create_tables.sql    # PostgreSQL DDL (auto-run on startup)
    02_seed_data.sql        # Default configs and branding
```

## License

Internal use only. Built with Databricks Apps + Lakebase + FMAPI.
