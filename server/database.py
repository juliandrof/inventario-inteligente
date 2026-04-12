"""Database connection module for DBXSC AI - Lakebase (PostgreSQL)."""

import os
import json
import logging
import subprocess
import ssl
import urllib.request
import urllib.error
from typing import Optional, Any

# Allow self-signed certs in corporate environments
try:
    ssl._create_default_https_context = ssl._create_unverified_context
except Exception:
    pass

import psycopg2
import psycopg2.extras
from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

IS_DATABRICKS_APP = bool(os.environ.get("DATABRICKS_APP_NAME"))

DB_HOST = os.environ.get("DBXSC_AI_DB_HOST", "")
DB_PORT = int(os.environ.get("DBXSC_AI_DB_PORT", "5432"))
DB_NAME = os.environ.get("DBXSC_AI_DB_NAME", "dbxsc")
DB_SCHEMA = os.environ.get("DBXSC_AI_DB_SCHEMA", "public")
LAKEBASE_PROJECT = os.environ.get("DBXSC_AI_LAKEBASE_PROJECT", "dbxsc")
LAKEBASE_BRANCH = os.environ.get("DBXSC_AI_LAKEBASE_BRANCH", "production")
LAKEBASE_ENDPOINT = os.environ.get("DBXSC_AI_LAKEBASE_ENDPOINT", "primary")

_connection = None


def _get_workspace_client() -> WorkspaceClient:
    if IS_DATABRICKS_APP:
        return WorkspaceClient()
    profile = os.environ.get("DATABRICKS_PROFILE")
    return WorkspaceClient(profile=profile) if profile else WorkspaceClient()


def _get_lakebase_credentials() -> tuple[str, str, str]:
    """Get Lakebase host, user, and database credential token using SDK."""
    w = _get_workspace_client()
    host = DB_HOST
    endpoint_name = f"projects/{LAKEBASE_PROJECT}/branches/{LAKEBASE_BRANCH}/endpoints/{LAKEBASE_ENDPOINT}"

    # Auto-discover host if not set
    if not host:
        try:
            branch_path = f"projects/{LAKEBASE_PROJECT}/branches/{LAKEBASE_BRANCH}"
            endpoints = list(w.postgres.list_endpoints(parent=branch_path))
            if endpoints:
                host = endpoints[0].status.hosts.host
                logger.info(f"Discovered Lakebase host: {host}")
        except Exception as e:
            logger.warning(f"Could not discover Lakebase host via SDK: {e}")
            # Fallback to REST API
            try:
                ws_host = w.config.host.rstrip("/")
                headers = w.config.authenticate()
                ws_token = headers.get("Authorization", "").replace("Bearer ", "") if headers else ""
                url = f"{ws_host}/api/2.0/postgres/projects/{LAKEBASE_PROJECT}/branches/{LAKEBASE_BRANCH}/endpoints"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {ws_token}"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read())
                    eps = data.get("endpoints", [])
                    if eps:
                        host = eps[0]["status"]["hosts"]["host"]
            except Exception as e2:
                logger.warning(f"REST fallback also failed: {e2}")

    if not host:
        raise ValueError("DBXSC_AI_DB_HOST not set and could not discover")

    # Get credentials - prefer env vars (native PG auth), fallback to OAuth
    user = os.environ.get("DBXSC_AI_DB_USER", "")
    password = os.environ.get("DBXSC_AI_DB_PASSWORD", "")

    if user and password:
        logger.info(f"Using native PG credentials: user={user}")
        return host, user, password

    # Fallback: OAuth credential generation
    db_token = ""
    # Method 1: Try SDK
    try:
        credential = w.postgres.generate_database_credential(endpoint=endpoint_name)
        db_token = credential.token
    except Exception as e:
        logger.info(f"SDK unavailable: {e}")

    # Method 2: Generate database credential via REST API
    if not db_token:
        try:
            auth_headers = w.config.authenticate()
            ws_token = auth_headers.get("Authorization", "").replace("Bearer ", "") if auth_headers else ""
            if not ws_token and w.config.token:
                ws_token = w.config.token
            logger.info(f"Method 2: calling REST /api/2.0/postgres/credentials with ws_token_len={len(ws_token)}")

            ws_host = w.config.host.rstrip("/")
            url = f"{ws_host}/api/2.0/postgres/credentials"
            payload = json.dumps({"endpoint": endpoint_name}).encode("utf-8")
            req = urllib.request.Request(url, data=payload,
                headers={"Authorization": f"Bearer {ws_token}", "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                db_token = data.get("token", "")
                logger.info(f"Method 2: DB credential generated, token_len={len(db_token)}")
        except Exception as e:
            logger.error(f"Method 2 (REST credential) failed: {e}")

    # Method 3: Last resort - workspace token directly
    if not db_token:
        try:
            auth_headers = w.config.authenticate()
            db_token = auth_headers.get("Authorization", "").replace("Bearer ", "") if auth_headers else ""
            logger.info(f"Method 3 (raw workspace token fallback): token_len={len(db_token)}")
        except Exception as e:
            logger.error(f"Method 3 failed: {e}")

    # Get user identity for OAuth fallback
    if not user:
        try:
            me = w.current_user.me()
            user = me.user_name
        except Exception:
            user = "postgres"

    logger.info(f"Lakebase (OAuth fallback): host={host}, user={user}")
    return host, user, db_token


def get_connection():
    """Get or create a PostgreSQL connection to Lakebase."""
    global _connection
    try:
        if _connection is not None:
            try:
                cur = _connection.cursor()
                cur.execute("SELECT 1")
                cur.close()
                return _connection
            except Exception:
                try:
                    _connection.close()
                except Exception:
                    pass
                _connection = None

        host, user, password = _get_lakebase_credentials()
        logger.info(f"Connecting to Lakebase: host={host}, db={DB_NAME}, user={user}")

        # First ensure the database exists
        try:
            tmp_conn = psycopg2.connect(
                host=host, port=DB_PORT, database="postgres",
                user=user, password=password, sslmode="require",
            )
            tmp_conn.autocommit = True
            tmp_cur = tmp_conn.cursor()
            tmp_cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DB_NAME,))
            if not tmp_cur.fetchone():
                tmp_cur.execute(f'CREATE DATABASE "{DB_NAME}"')
                logger.info(f"Created database: {DB_NAME}")
            tmp_cur.close()
            tmp_conn.close()
        except Exception as e:
            logger.warning(f"Could not check/create database: {e}")

        _connection = psycopg2.connect(
            host=host,
            port=DB_PORT,
            database=DB_NAME,
            user=user,
            password=password,
            sslmode="require",
            options=f"-c search_path={DB_SCHEMA}",
        )
        _connection.autocommit = True
        return _connection
    except Exception as e:
        logger.error(f"Failed to connect to Lakebase: {e}")
        raise


def get_workspace_client() -> WorkspaceClient:
    return _get_workspace_client()


async def init_db_pool():
    try:
        conn = get_connection()
        logger.info("Successfully connected to Lakebase PostgreSQL")
        _auto_create_tables(conn)
    except Exception as e:
        logger.warning(f"Could not connect on startup: {e}")


def _auto_create_tables(conn):
    """Create tables if they don't exist (auto-setup on first deploy)."""
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS videos (
                video_id BIGINT PRIMARY KEY, filename VARCHAR(500) NOT NULL,
                volume_path VARCHAR(1000) NOT NULL, file_size_bytes BIGINT,
                duration_seconds DOUBLE PRECISION, fps DOUBLE PRECISION,
                resolution VARCHAR(50), upload_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
                status VARCHAR(20) NOT NULL DEFAULT 'PENDING', progress_pct DOUBLE PRECISION DEFAULT 0,
                source VARCHAR(20), uploaded_by VARCHAR(200), error_message TEXT);
            CREATE TABLE IF NOT EXISTS analysis_results (
                result_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
                analysis_timestamp TIMESTAMP NOT NULL DEFAULT NOW(), scores_json TEXT NOT NULL,
                overall_risk DOUBLE PRECISION, total_detections INTEGER,
                scan_fps DOUBLE PRECISION, detail_fps DOUBLE PRECISION,
                model_used VARCHAR(200), config_snapshot TEXT);
            CREATE TABLE IF NOT EXISTS detections (
                detection_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
                result_id BIGINT NOT NULL REFERENCES analysis_results(result_id),
                timestamp_sec DOUBLE PRECISION NOT NULL, category VARCHAR(100) NOT NULL,
                score INTEGER NOT NULL, confidence DOUBLE PRECISION, ai_description TEXT,
                thumbnail_path VARCHAR(500), frame_index BIGINT,
                review_status VARCHAR(20) DEFAULT 'PENDING', reviewed_by VARCHAR(200),
                reviewed_at TIMESTAMP, reviewer_notes TEXT);
            CREATE TABLE IF NOT EXISTS processing_log (
                log_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
                volume_path VARCHAR(1000) NOT NULL, file_hash VARCHAR(64),
                processed_at TIMESTAMP NOT NULL DEFAULT NOW(), status VARCHAR(20) NOT NULL,
                processing_time_sec DOUBLE PRECISION);
            CREATE TABLE IF NOT EXISTS configurations (
                config_id BIGINT PRIMARY KEY, config_key VARCHAR(200) NOT NULL UNIQUE,
                config_value TEXT NOT NULL, description TEXT,
                updated_at TIMESTAMP DEFAULT NOW(), updated_by VARCHAR(200));
            CREATE TABLE IF NOT EXISTS branding (
                setting_id BIGINT PRIMARY KEY, setting_key VARCHAR(200) NOT NULL UNIQUE,
                setting_value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE IF NOT EXISTS review_log (
                review_log_id BIGINT PRIMARY KEY, detection_id BIGINT NOT NULL,
                video_id BIGINT NOT NULL, action VARCHAR(20) NOT NULL,
                previous_status VARCHAR(20), reviewer VARCHAR(200) NOT NULL,
                notes TEXT, action_timestamp TIMESTAMP NOT NULL DEFAULT NOW());
        """)
        logger.info("Tables verified/created")

        # Seed defaults if empty
        cur.execute("SELECT COUNT(*) FROM configurations")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO configurations (config_id, config_key, config_value, description, updated_at) VALUES
                (1, 'detection_categories', '["fadiga", "distracao"]', 'Detection categories', NOW()),
                (2, 'scan_prompt', 'Analyze this truck cabin camera image. Look for fatigue and distraction. Rate each 1-10.', 'Analysis prompt', NOW()),
                (3, 'scan_fps', '0.2', 'Frames per second for scanning', NOW()),
                (4, 'detail_fps', '1.0', 'FPS for detailed analysis', NOW()),
                (5, 'score_threshold', '4', 'Minimum score to flag', NOW())
            """)
            logger.info("Default configurations seeded")

        cur.execute("SELECT COUNT(*) FROM branding")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO branding (setting_id, setting_key, setting_value, updated_at) VALUES
                (1, 'primary_color', '#2563EB', NOW()),
                (2, 'secondary_color', '#1E293B', NOW()),
                (3, 'accent_color', '#3B82F6', NOW()),
                (4, 'sidebar_color', '#0F172A', NOW())
            """)
            logger.info("Default branding seeded")
    except Exception as e:
        logger.error(f"Auto-setup failed: {e}")
    finally:
        cur.close()


async def close_db_pool():
    global _connection
    if _connection:
        try:
            _connection.close()
        except Exception:
            pass
        _connection = None


def execute_query(sql: str, params: Optional[dict] = None) -> list[dict[str, Any]]:
    """Execute a query and return results as list of dicts."""
    conn = get_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(sql, params)
        if cur.description:
            return [dict(row) for row in cur.fetchall()]
        return []
    finally:
        cur.close()


def execute_update(sql: str, params: Optional[dict] = None) -> int:
    """Execute an INSERT/UPDATE/DELETE and return affected rows."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return cur.rowcount if cur.rowcount else 0
    finally:
        cur.close()
