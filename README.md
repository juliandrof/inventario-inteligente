# DBXSC AI

Generic Databricks App for AI-powered video analysis and driver safety monitoring, backed by **Lakebase** (managed PostgreSQL).

## Overview

DBXSC AI analyzes cabin camera videos to detect signs of **fatigue**, **distraction**, and other configurable risk behaviors in drivers. It uses Databricks Foundation Model API (FMAPI) with vision models for frame-by-frame analysis, stores results in Lakebase (PostgreSQL), and provides a full review workflow.

The app is **fully configurable** — detection categories, analysis prompts, scoring thresholds, branding (logo and colors) are all editable through the UI. It can be deployed for any client with their own Lakebase instance, database name, and visual identity.

## Architecture

```
+--------------------------------------------------+
|              Browser (React SPA)                  |
|   Dashboard | Upload | Batch | Review | Config   |
+--------------------------------------------------+
              | REST API + SSE
              v
+--------------------------------------------------+
|          FastAPI Backend (Python)                  |
|  OpenCV frame extraction -> FMAPI vision analysis |
|  Background workers + progress streaming          |
+--------------------------------------------------+
       |              |              |
       v              v              v
+------------+  +------------+  +------------+
| Lakebase   |  | FMAPI      |  | Volumes    |
| PostgreSQL |  | Llama 4    |  | videos/    |
| (7 tables) |  | Maverick   |  | thumbnails |
+------------+  +------------+  +------------+
```

## Technologies

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| Python | 3.11+ | Backend language |
| FastAPI | >= 0.115 | Async REST API framework |
| Uvicorn | >= 0.30 | ASGI server |
| **psycopg2** | >= 2.9 | **PostgreSQL driver (Lakebase)** |
| Databricks SDK | >= 0.30 | Auth, Volumes, FMAPI credentials |
| OpenCV (headless) | >= 4.9 | Video frame extraction |
| Pillow | >= 10.0 | Image manipulation |

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.2 | UI framework (SPA) |
| Vite | 8.0 | Build tool |
| CSS custom properties | - | Dynamic theming |
| HTML5 Video | - | Native player with timestamp seek |
| Server-Sent Events | - | Real-time batch progress |

### AI / Vision
| Technology | Purpose |
|-----------|---------|
| Databricks FMAPI | Pay-per-token vision model inference |
| Meta Llama 4 Maverick | Multimodal model for frame analysis |

### Infrastructure
| Resource | Purpose |
|---------|---------|
| **Databricks Lakebase** | **Managed PostgreSQL database** |
| Databricks Apps | App hosting (managed container) |
| Databricks Volumes | Video and thumbnail file storage |
| Serving Endpoints | FMAPI model access |
| Service Principal | Automatic app authentication |

## Configuration (Environment Variables)

All names are parameterizable via `app.yaml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DBXSC_AI_DB_HOST` | (auto-discovered) | Lakebase endpoint host |
| `DBXSC_AI_DB_PORT` | 5432 | PostgreSQL port |
| `DBXSC_AI_DB_NAME` | dbxsc | Database name |
| `DBXSC_AI_DB_SCHEMA` | public | PostgreSQL schema |
| `DBXSC_AI_LAKEBASE_PROJECT` | dbxsc | Lakebase project ID |
| `DBXSC_AI_LAKEBASE_BRANCH` | production | Lakebase branch |
| `DBXSC_AI_LAKEBASE_ENDPOINT` | primary | Lakebase endpoint |
| `FMAPI_MODEL` | databricks-llama-4-maverick | Vision model endpoint |
| `VIDEO_VOLUME` | /Volumes/dbxsc/main/uploaded_videos | Video storage path |
| `THUMBNAIL_VOLUME` | /Volumes/dbxsc/main/thumbnails | Thumbnail storage path |

## Database Schema (PostgreSQL)

| Table | Purpose |
|-------|---------|
| `videos` | Video metadata, processing status, progress |
| `analysis_results` | Aggregated scores per video (JSON flexible schema) |
| `detections` | Individual detection events with timestamps, thumbnails |
| `processing_log` | Tracks processed videos for skip-on-rerun |
| `configurations` | Detection categories, prompts, thresholds |
| `branding` | Logo path, color palette |
| `review_log` | Audit trail for confirm/reject actions |

All tables use standard PostgreSQL types with proper foreign keys and indexes.

## Setup

### 1. Create Lakebase Project

```bash
databricks postgres create-project dbxsc \
  --json '{"spec": {"display_name": "DBXSC AI"}}' \
  -p PROFILE
```

### 2. Create Database

```bash
HOST=$(databricks postgres list-endpoints projects/dbxsc/branches/production \
  -p PROFILE -o json | jq -r '.[0].status.hosts.host')
TOKEN=$(databricks postgres generate-database-credential \
  projects/dbxsc/branches/production/endpoints/primary \
  -p PROFILE -o json | jq -r '.token')
EMAIL=$(databricks current-user me -p PROFILE -o json | jq -r '.userName')

PGPASSWORD=$TOKEN psql "host=$HOST port=5432 dbname=postgres user=$EMAIL sslmode=require" \
  -c "CREATE DATABASE dbxsc;"
```

### 3. Create Tables and Seed Data

```bash
PGPASSWORD=$TOKEN psql "host=$HOST port=5432 dbname=dbxsc user=$EMAIL sslmode=require" \
  -f sql/01_create_tables.sql
PGPASSWORD=$TOKEN psql "host=$HOST port=5432 dbname=dbxsc user=$EMAIL sslmode=require" \
  -f sql/02_seed_data.sql
```

### 4. Create Volumes

```sql
-- In Databricks SQL
CREATE VOLUME IF NOT EXISTS dbxsc.main.uploaded_videos;
CREATE VOLUME IF NOT EXISTS dbxsc.main.thumbnails;
```

### 5. Build Frontend

```bash
cd frontend && npm install && npm run build
```

### 6. Deploy

```bash
databricks apps create dbxsc
databricks sync . /Workspace/Users/<email>/dbxsc -p PROFILE
databricks apps deploy dbxsc /Workspace/Users/<email>/dbxsc SNAPSHOT
```

### 7. Update app.yaml with Lakebase host

Set `DBXSC_AI_DB_HOST` to your Lakebase endpoint host, or let the app auto-discover it from the project/branch/endpoint configuration.

## Multi-Client Deployment

To deploy for a different client:

1. Create a new Lakebase project: `databricks postgres create-project <client-name>`
2. Create database and tables using the SQL scripts
3. Update `app.yaml` environment variables:
   - `DBXSC_AI_DB_NAME` = client-specific database
   - `DBXSC_AI_LAKEBASE_PROJECT` = client-specific project
   - `VIDEO_VOLUME` / `THUMBNAIL_VOLUME` = client-specific paths
4. Upload client logo and set colors via the Branding settings page
5. Configure detection categories via the Configurations page

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/videos/upload` | Upload video (multipart) |
| GET | `/api/videos` | List all videos |
| GET | `/api/videos/{id}/stream` | Stream video (MP4) |
| POST | `/api/batch/start` | Start batch processing |
| GET | `/api/batch/{id}/progress` | SSE progress stream |
| POST | `/api/review/{id}/confirm` | Confirm detection |
| POST | `/api/review/{id}/reject` | Reject detection |
| GET | `/api/config` | List configurations |
| PUT | `/api/config/{key}` | Update configuration |
| GET | `/api/branding` | Get branding settings |
| PUT | `/api/branding/{key}` | Update color |
| POST | `/api/branding/logo` | Upload custom logo |
| GET | `/api/dashboard/summary` | Dashboard KPIs |
| GET | `/api/debug/logs` | App logs (troubleshooting) |

## Cost Estimate (FMAPI pay-per-token)

| Volume | FMAPI | Lakebase | Storage | Total/month |
|--------|-------|----------|---------|-------------|
| 10 hours | ~$15 | ~$5 | <$1 | **~$20** |
| 5,000 hours | ~$1,800 | ~$50 | ~$100 | **~$1,950** |
| 100,000 hours | ~$36,000 | ~$200 | ~$2,000 | **~$38,200** |

Lakebase costs significantly less than SQL Warehouse for this workload since it scales to zero when idle.
