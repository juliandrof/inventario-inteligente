# Deployment Guide — Databricks Scenic Crawler AI

Deploy this app to any Databricks workspace using the UI. No CLI required.

---

## Prerequisites

Before deploying, ensure your target workspace has:

- **Databricks Apps** enabled
- **Lakebase** (managed PostgreSQL) or access to create one
- **Unity Catalog** with a catalog/schema for Volumes
- A **Serving Endpoint** with a vision-capable model (e.g., `databricks-llama-4-maverick`)

---

## Step 1 — Connect GitHub to the Workspace

Navigate to your user settings to link your GitHub account.

```
Workspace UI > Settings > Linked accounts > Git integration
```

| Setting | Value |
|---------|-------|
| Git provider | GitHub |
| Auth method | Personal Access Token (PAT) or OAuth |

> **Tip:** To create a PAT, go to GitHub > Settings > Developer settings > Personal access tokens > Generate new token. Grant `repo` scope.

```
┌─────────────────────────────────────────┐
│  Settings > Linked accounts             │
│                                         │
│  Git provider:  [GitHub          v]     │
│  Token:         [ghp_xxxxxxxxxxxx ]     │
│                                         │
│              [Save]                     │
└─────────────────────────────────────────┘
```

---

## Step 2 — Clone the Repository

Import the Git repo into your workspace.

```
Workspace UI > Workspace (sidebar) > Add > Git folder
```

| Field | Value |
|-------|-------|
| Git repository URL | `https://github.com/juliandrof/Databricks-Scenic-Crawler-AI.git` |
| Branch | `main` |
| Git folder name | `Databricks-Scenic-Crawler-AI` |

```
┌─────────────────────────────────────────────────────────────┐
│  Add Git folder                                             │
│                                                             │
│  Git repository URL:                                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ https://github.com/juliandrof/Databricks-Scenic-... │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Git provider:   GitHub                                     │
│  Git folder name: Databricks-Scenic-Crawler-AI              │
│  Branch:         main                                       │
│                                                             │
│                    [Create Git folder]                       │
└─────────────────────────────────────────────────────────────┘
```

After creation, you'll see the full project structure in the workspace file browser:

```
Workspace/
  └── Users/
       └── your.email@company.com/
            └── Databricks-Scenic-Crawler-AI/
                 ├── app.py
                 ├── app.yaml
                 ├── requirements.txt
                 ├── server/
                 ├── frontend/
                 └── ...
```

---

## Step 3 — Create Infrastructure Resources

Before deploying the app, create the required backend resources.

### 3a. Create a Lakebase Project

```
Workspace UI > SQL > Lakebase > Create Project
```

| Setting | Recommended Value |
|---------|-------------------|
| Project name | `scenic-crawler` |
| Branch | `production` (auto-created) |
| Endpoint | `primary` (auto-created) |

After creation, note the **endpoint host** — you'll need it for the environment variables.

```
┌─────────────────────────────────────────────────┐
│  Lakebase > scenic-crawler                      │
│                                                 │
│  Branch: production         State: READY        │
│  Endpoint: primary          State: ACTIVE       │
│                                                 │
│  Host: scenic-crawler-xxxxx.databricks.com      │
│  Port: 5432                                     │
└─────────────────────────────────────────────────┘
```

> **Important:** Create a database inside the project. Connect via SQL editor or psql and run:
> ```sql
> CREATE DATABASE scenic_crawler;
> ```

### 3b. Create a PostgreSQL User (for the App)

Connect to the Lakebase endpoint and create a role for the app's service principal:

```sql
CREATE ROLE app_user WITH LOGIN PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE scenic_crawler TO app_user;
```

> Tables are auto-created on first app startup — no need to run DDL manually.

### 3c. Create Volumes for Storage

```
Workspace UI > Catalog > your_catalog > your_schema > Create Volume
```

Create two volumes:

| Volume Name | Purpose |
|-------------|---------|
| `uploaded_videos` | Stores uploaded and batch video files |
| `thumbnails` | Stores detection thumbnail images |

Note the full paths:
- `/Volumes/your_catalog/your_schema/uploaded_videos`
- `/Volumes/your_catalog/your_schema/thumbnails`

### 3d. Verify Serving Endpoint

```
Workspace UI > Serving > Endpoints
```

Ensure a vision-capable model endpoint exists. Common options:

| Endpoint Name | Model |
|---------------|-------|
| `databricks-llama-4-maverick` | Llama 4 Maverick (default) |
| `databricks-claude-sonnet-4` | Claude Sonnet 4 |
| `databricks-meta-llama-3-2-11b-vision-instruct` | Llama 3.2 Vision |

---

## Step 4 — Create and Configure the App

> **Note:** The `app.yaml` file is not in the repository (it contains credentials). A template is provided at `app.yaml.template`. If deploying via CLI instead of UI, copy it to `app.yaml` and fill in the placeholders before deploying.

```
Workspace UI > Compute > Apps > Create App
```

### 4a. Basic Settings

| Field | Value |
|-------|-------|
| App name | `scenic-crawler-ai` |
| Source path | `/Workspace/Users/your.email/Databricks-Scenic-Crawler-AI` |

### 4b. Environment Variables

Configure these in the app settings panel:

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `DBXSC_AI_DB_HOST` | `scenic-crawler-xxxxx.databricks.com` | Lakebase endpoint host |
| `DBXSC_AI_DB_PORT` | `5432` | PostgreSQL port |
| `DBXSC_AI_DB_NAME` | `scenic_crawler` | Database name |
| `DBXSC_AI_DB_SCHEMA` | `public` | PostgreSQL schema |
| `DBXSC_AI_DB_USER` | `app_user` | PostgreSQL username |
| `DBXSC_AI_DB_PASSWORD` | `your-secure-password` | PostgreSQL password |
| `DBXSC_AI_LAKEBASE_PROJECT` | `scenic-crawler` | Lakebase project ID |
| `DBXSC_AI_LAKEBASE_BRANCH` | `production` | Lakebase branch |
| `DBXSC_AI_LAKEBASE_ENDPOINT` | `primary` | Lakebase endpoint |
| `FMAPI_MODEL` | `databricks-llama-4-maverick` | Vision model endpoint name |
| `VIDEO_VOLUME` | `/Volumes/catalog/schema/uploaded_videos` | Video storage path |
| `THUMBNAIL_VOLUME` | `/Volumes/catalog/schema/thumbnails` | Thumbnail storage path |

```
┌─────────────────────────────────────────────────────────────┐
│  App Configuration > Environment Variables                  │
│                                                             │
│  DBXSC_AI_DB_HOST      [scenic-crawler-xxxxx.databricks.. ] │
│  DBXSC_AI_DB_PORT      [5432                              ] │
│  DBXSC_AI_DB_NAME      [scenic_crawler                    ] │
│  DBXSC_AI_DB_USER      [app_user                          ] │
│  DBXSC_AI_DB_PASSWORD   [********                          ] │
│  FMAPI_MODEL           [databricks-llama-4-maverick       ] │
│  VIDEO_VOLUME          [/Volumes/catalog/schema/uploaded.. ] │
│  THUMBNAIL_VOLUME      [/Volumes/catalog/schema/thumbnails ] │
│                                                             │
│  + Add variable                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4c. Resources

Add the serving endpoint as a resource so the app's service principal can access it:

| Resource Type | Resource Name |
|---------------|---------------|
| Serving endpoint | `databricks-llama-4-maverick` |

```
┌─────────────────────────────────────────────────┐
│  App Configuration > Resources                  │
│                                                 │
│  Type               Name                        │
│  [Serving Endpoint] [databricks-llama-4-maver.] │
│                                                 │
│  + Add resource                                 │
└─────────────────────────────────────────────────┘
```

---

## Step 5 — Deploy

Click the **Deploy** button in the app page.

```
┌─────────────────────────────────────────────────┐
│  Apps > scenic-crawler-ai                       │
│                                                 │
│  Status: DEPLOYING...                           │
│  ████████████░░░░░░░░  60%                      │
│                                                 │
│  Source: /Workspace/Users/.../Databricks-Sc...  │
│  Mode: SNAPSHOT                                 │
└─────────────────────────────────────────────────┘
```

Deployment typically takes 2-5 minutes. The app will:

1. Install Python dependencies from `requirements.txt`
2. Start the FastAPI server
3. Auto-create all 8 database tables on first connection
4. Seed default configurations and branding
5. Serve the React frontend

---

## Step 6 — Access and Configure

Once deployed, the app is available at:

```
https://scenic-crawler-ai-<workspace-id>.databricksapps.com
```

### First-time setup in the app UI:

1. **Settings > Contexts** — Create your analysis contexts (categories, prompts, thresholds)
2. **Settings > AI Model** — Verify or change the vision model endpoint
3. **Settings > Branding** — Upload your logo and set color palette
4. **Process Videos** — Upload a test video or start a batch from a Volume

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────┐  ┌──────────────────────────────────────────────┐ │
│  │ Dashboard │  │                                              │ │
│  │ Process   │  │   Welcome to Databricks Scenic Crawler AI    │ │
│  │ Streaming │  │                                              │ │
│  │ Videos    │  │   1. Create a Context in Settings            │ │
│  │ Review    │  │   2. Upload or batch-process videos          │ │
│  │ Reports   │  │   3. Review detections                       │ │
│  │ Settings  │  │                                              │ │
│  │           │  │                                              │ │
│  │ PT EN ES  │  │                                              │ │
│  └──────────┘  └──────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Updating the App

When the GitHub repo is updated:

1. Go to **Workspace > Git folder > Databricks-Scenic-Crawler-AI**
2. Click **Pull** to sync the latest changes
3. Go to **Compute > Apps > scenic-crawler-ai**
4. Click **Deploy** to redeploy with the new code

```
Git folder > Pull latest  →  Apps > Deploy  →  Updated app live
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| App fails to start | Check **Debug Logs** at `/api/debug/logs` — usually a database connection issue |
| Database connection refused | Verify `DBXSC_AI_DB_HOST` and that the Lakebase endpoint is ACTIVE |
| FMAPI errors | Verify the serving endpoint name in Settings > AI Model |
| Videos not uploading | Check that the `VIDEO_VOLUME` path exists and the SP has write access |
| Thumbnails not showing | Check that the `THUMBNAIL_VOLUME` path exists |
| Auth errors | Ensure the app's service principal has access to Lakebase, Volumes, and Serving Endpoint |

---

## Architecture Overview

```
┌──────────────┐     ┌──────────────────────────────┐
│   GitHub     │────>│  Databricks Workspace        │
│   Repo       │pull │                              │
└──────────────┘     │  ┌────────────────────────┐  │
                     │  │  Git Folder (source)   │  │
                     │  └───────────┬────────────┘  │
                     │              │ deploy         │
                     │  ┌───────────v────────────┐  │
                     │  │  Databricks App        │  │
                     │  │  (FastAPI + React)     │  │
                     │  └───┬───────┬───────┬────┘  │
                     │      │       │       │       │
                     │  ┌───v──┐ ┌──v──┐ ┌──v───┐  │
                     │  │Lake- │ │FMAPI│ │Unity │  │
                     │  │base  │ │Model│ │Catalog│  │
                     │  │(PG)  │ │     │ │Volumes│  │
                     │  └──────┘ └─────┘ └──────┘  │
                     └──────────────────────────────┘
```
