"""Database connection module for DBXSC AI - Lakebase (PostgreSQL)."""

import os
import json
import logging
import subprocess
from typing import Optional, Any

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
    """Get Lakebase host, user, and OAuth token."""
    w = _get_workspace_client()

    # Get endpoint host
    endpoint_path = f"projects/{LAKEBASE_PROJECT}/branches/{LAKEBASE_BRANCH}"
    try:
        resp = w.api_client.do("GET", f"/api/2.0/postgres/endpoints?parent={endpoint_path}")
        endpoints = resp.get("endpoints", [])
        host = endpoints[0]["status"]["hosts"]["host"] if endpoints else DB_HOST
    except Exception as e:
        logger.warning(f"Could not get Lakebase endpoint host via API: {e}")
        host = DB_HOST

    if not host:
        raise ValueError("DBXSC_AI_DB_HOST not set and could not discover from Lakebase API")

    # Generate OAuth credential
    cred_path = f"projects/{LAKEBASE_PROJECT}/branches/{LAKEBASE_BRANCH}/endpoints/{LAKEBASE_ENDPOINT}"
    try:
        resp = w.api_client.do("POST", f"/api/2.0/postgres/credentials:generateDatabaseCredential", body={"name": cred_path})
        token = resp.get("token", "")
    except Exception as e:
        logger.warning(f"Could not generate Lakebase credential via API: {e}")
        token = os.environ.get("DBXSC_AI_DB_PASSWORD", "")

    # Get user email
    try:
        me = w.current_user.me()
        user = me.user_name
    except Exception:
        user = os.environ.get("DBXSC_AI_DB_USER", "postgres")

    return host, user, token


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
        get_connection()
        logger.info("Successfully connected to Lakebase PostgreSQL")
    except Exception as e:
        logger.warning(f"Could not connect on startup: {e}")


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
