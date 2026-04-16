# Databricks notebook source
# MAGIC %md
# MAGIC # Databricks Scenic Crawler AI - Deploy Completo
# MAGIC
# MAGIC Este notebook provisiona **toda a infraestrutura** e faz o deploy da app Scenic Crawler AI em qualquer workspace Databricks.
# MAGIC
# MAGIC | Etapa | Descricao |
# MAGIC |-------|-----------|
# MAGIC | **1. Configuracao** | Define parametros via widgets interativos |
# MAGIC | **2. Lakebase** | Cria ou reutiliza um projeto Lakebase (PostgreSQL gerenciado) |
# MAGIC | **3. Database** | Cria o banco de dados e as tabelas |
# MAGIC | **4. Unity Catalog** | Cria catalog, schema e volumes para armazenamento |
# MAGIC | **5. Databricks App** | Cria a app e configura o service principal |
# MAGIC | **6. Deploy** | Faz o deploy e valida que tudo funciona |
# MAGIC
# MAGIC ### Pre-requisitos:
# MAGIC - Workspace com **Databricks Apps** e **Lakebase** habilitados
# MAGIC - Acesso a **Unity Catalog**
# MAGIC - Serving endpoint com modelo de visao (ex: `databricks-llama-4-maverick`)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Configuracao

# COMMAND ----------

dbutils.widgets.text("lakebase_project", "scenic-crawler", "1. Nome do Projeto Lakebase")
dbutils.widgets.text("database_name", "scenic_crawler", "2. Nome do Database")
dbutils.widgets.text("catalog_name", "", "3. Catalog (Unity Catalog)")
dbutils.widgets.text("schema_name", "scenic_crawler", "4. Schema")
dbutils.widgets.text("app_name", "scenic-crawler-ai", "5. Nome da App")
dbutils.widgets.text("vision_model", "databricks-llama-4-maverick", "6. Modelo de Visao (endpoint)")
dbutils.widgets.text("git_repo_url", "https://github.com/juliandrof/Databricks-Scenic-Crawler-AI.git", "7. URL do Repo Git")
dbutils.widgets.text("db_password", "scenic-crawler-2026", "8. Senha PG para o Service Principal")

# COMMAND ----------

import re, time, json

LAKEBASE_PROJECT = dbutils.widgets.get("lakebase_project").strip()
DATABASE_NAME = dbutils.widgets.get("database_name").strip()
CATALOG_NAME = dbutils.widgets.get("catalog_name").strip()
SCHEMA_NAME = dbutils.widgets.get("schema_name").strip()
APP_NAME = dbutils.widgets.get("app_name").strip()
VISION_MODEL = dbutils.widgets.get("vision_model").strip()
GIT_REPO_URL = dbutils.widgets.get("git_repo_url").strip()
DB_PASSWORD = dbutils.widgets.get("db_password").strip()

current_user = spark.sql("SELECT current_user()").collect()[0][0]
workspace_url = spark.conf.get("spark.databricks.workspaceUrl", "")

if not CATALOG_NAME:
    try:
        default_cat = spark.sql("SELECT current_catalog()").collect()[0][0]
        if default_cat and default_cat not in ("hive_metastore", "system", "samples"):
            CATALOG_NAME = default_cat
        else:
            CATALOG_NAME = re.sub(r'[^a-zA-Z0-9_]', '_', current_user.split('@')[0]) + "_scenic"
    except Exception:
        CATALOG_NAME = re.sub(r'[^a-zA-Z0-9_]', '_', current_user.split('@')[0]) + "_scenic"

VIDEO_VOLUME_PATH = f"/Volumes/{CATALOG_NAME}/{SCHEMA_NAME}/uploaded_videos"
THUMBNAIL_VOLUME_PATH = f"/Volumes/{CATALOG_NAME}/{SCHEMA_NAME}/thumbnails"

print("=" * 60)
print("CONFIGURACAO DO DEPLOY")
print("=" * 60)
print(f"  Usuario:          {current_user}")
print(f"  Workspace:        {workspace_url}")
print(f"  Lakebase Project: {LAKEBASE_PROJECT}")
print(f"  Database:         {DATABASE_NAME}")
print(f"  Catalog:          {CATALOG_NAME}")
print(f"  Schema:           {SCHEMA_NAME}")
print(f"  App:              {APP_NAME}")
print(f"  Modelo Visao:     {VISION_MODEL}")
print(f"  Video Volume:     {VIDEO_VOLUME_PATH}")
print(f"  Thumbnail Volume: {THUMBNAIL_VOLUME_PATH}")
print("=" * 60)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Lakebase - Projeto PostgreSQL

# COMMAND ----------

from databricks.sdk import WorkspaceClient

# Inicializar SDK - tentar default; se falhar para Lakebase API, usar host explicito
_token = dbutils.notebook.entry_point.getDbutils().notebook().getContext().apiToken().get()
w = WorkspaceClient()

# Testar se o SDK default acessa Lakebase API
try:
    w.api_client.do("GET", "/api/2.0/postgres/projects?page_size=1")
    print(f"SDK conectado: {w.config.host}")
except Exception:
    print(f"SDK default nao acessou Lakebase API, usando host explicito...")
    w = WorkspaceClient(host=f"https://{workspace_url}", token=_token)
    print(f"SDK conectado: {w.config.host}")

# --- Verificar se o projeto ja existe ---
print(f"\nVerificando projeto '{LAKEBASE_PROJECT}'...")
project_exists = False
lakebase_host = None

try:
    data = w.api_client.do("GET", "/api/2.0/postgres/projects?page_size=200")
    for p in data.get("projects", []):
        if p.get("name", "") == f"projects/{LAKEBASE_PROJECT}":
            project_exists = True
            print(f"  Projeto encontrado.")
            break
except Exception as e:
    print(f"  Lista indisponivel (transiente): {e}")

# --- Criar se nao existe ---
if not project_exists:
    print(f"Criando projeto Lakebase '{LAKEBASE_PROJECT}'...")
    try:
        w.api_client.do("POST", f"/api/2.0/postgres/projects?project_id={LAKEBASE_PROJECT}",
                         body={"spec": {"display_name": f"Scenic Crawler AI"}})
        print(f"  Projeto criado (async).")
    except Exception as e:
        if "already exists" in str(e).lower():
            print(f"  Projeto ja existe.")
        else:
            raise

# --- Aguardar endpoint ACTIVE ---
print(f"\nAguardando endpoint ficar ACTIVE...")
for attempt in range(60):
    try:
        ep_data = w.api_client.do("GET", f"/api/2.0/postgres/projects/{LAKEBASE_PROJECT}/branches/production/endpoints")
        eps = ep_data.get("endpoints", [])
        if eps:
            state = eps[0].get("status", {}).get("current_state", "")
            host = eps[0].get("status", {}).get("hosts", {}).get("host", "")
            if state == "ACTIVE" and host:
                lakebase_host = host
                print(f"  ACTIVE! Host: {lakebase_host}")
                break
            print(f"  {state} ({attempt+1}/60)")
        else:
            print(f"  Sem endpoints ainda ({attempt+1}/60)")
    except Exception as e:
        print(f"  Provisionando... ({attempt+1}/60)")
    time.sleep(10)

if not lakebase_host:
    raise Exception("Timeout: Lakebase nao ficou ativo em 10 min. Verifique SQL > Lakebase.")

print(f"\n  LAKEBASE PRONTO: {lakebase_host}:5432")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Database e Tabelas

# COMMAND ----------

import subprocess, sys
try:
    import psycopg2
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
    import psycopg2

endpoint_name = f"projects/{LAKEBASE_PROJECT}/branches/production/endpoints/primary"
cred = w.api_client.do("POST", "/api/2.0/postgres/credentials", body={"endpoint": endpoint_name})
db_token = cred["token"]
print(f"Credencial gerada para: {current_user}")

# Criar database
conn = psycopg2.connect(host=lakebase_host, port=5432, database="postgres",
                         user=current_user, password=db_token, sslmode="require")
conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE_NAME,))
if not cur.fetchone():
    cur.execute(f'CREATE DATABASE "{DATABASE_NAME}"')
    print(f"Database '{DATABASE_NAME}' criado!")
else:
    print(f"Database '{DATABASE_NAME}' ja existe.")
cur.close()
conn.close()

# Criar tabelas
conn = psycopg2.connect(host=lakebase_host, port=5432, database=DATABASE_NAME,
                         user=current_user, password=db_token, sslmode="require")
conn.autocommit = True
cur = conn.cursor()

tables_sql = """
CREATE TABLE IF NOT EXISTS videos (
    video_id BIGINT PRIMARY KEY, filename VARCHAR(500) NOT NULL, volume_path VARCHAR(1000) NOT NULL,
    file_size_bytes BIGINT, duration_seconds DOUBLE PRECISION, fps DOUBLE PRECISION, resolution VARCHAR(50),
    upload_timestamp TIMESTAMP NOT NULL DEFAULT NOW(), status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    progress_pct DOUBLE PRECISION DEFAULT 0, source VARCHAR(20), uploaded_by VARCHAR(200), error_message TEXT,
    context_id BIGINT, context_name VARCHAR(200), context_color VARCHAR(20));
CREATE TABLE IF NOT EXISTS analysis_results (
    result_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
    analysis_timestamp TIMESTAMP NOT NULL DEFAULT NOW(), scores_json TEXT NOT NULL,
    overall_risk DOUBLE PRECISION, total_detections INTEGER, scan_fps DOUBLE PRECISION,
    detail_fps DOUBLE PRECISION, model_used VARCHAR(200), config_snapshot TEXT);
CREATE TABLE IF NOT EXISTS detections (
    detection_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
    result_id BIGINT NOT NULL REFERENCES analysis_results(result_id),
    timestamp_sec DOUBLE PRECISION NOT NULL, category VARCHAR(100) NOT NULL, score INTEGER NOT NULL,
    confidence DOUBLE PRECISION, ai_description TEXT, thumbnail_path VARCHAR(500), frame_index BIGINT,
    review_status VARCHAR(20) DEFAULT 'PENDING', reviewed_by VARCHAR(200), reviewed_at TIMESTAMP, reviewer_notes TEXT);
CREATE TABLE IF NOT EXISTS processing_log (
    log_id BIGINT PRIMARY KEY, video_id BIGINT NOT NULL REFERENCES videos(video_id),
    volume_path VARCHAR(1000) NOT NULL, file_hash VARCHAR(64), processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL, processing_time_sec DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS contexts (
    context_id BIGINT PRIMARY KEY, name VARCHAR(200) NOT NULL UNIQUE, description TEXT,
    categories TEXT NOT NULL DEFAULT '["fadiga", "distracao"]', scan_prompt TEXT NOT NULL,
    scan_fps DOUBLE PRECISION DEFAULT 0.2, detail_fps DOUBLE PRECISION DEFAULT 1.0,
    score_threshold INTEGER DEFAULT 4, color VARCHAR(20) DEFAULT '#2563EB', dedup_window INTEGER DEFAULT 5,
    created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS configurations (
    config_id BIGINT PRIMARY KEY, config_key VARCHAR(200) NOT NULL UNIQUE, config_value TEXT NOT NULL,
    description TEXT, updated_at TIMESTAMP DEFAULT NOW(), updated_by VARCHAR(200));
CREATE TABLE IF NOT EXISTS branding (
    setting_id BIGINT PRIMARY KEY, setting_key VARCHAR(200) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS review_log (
    review_log_id BIGINT PRIMARY KEY, detection_id BIGINT NOT NULL, video_id BIGINT NOT NULL,
    action VARCHAR(20) NOT NULL, previous_status VARCHAR(20), reviewer VARCHAR(200) NOT NULL,
    notes TEXT, action_timestamp TIMESTAMP NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_context ON videos(context_id);
CREATE INDEX IF NOT EXISTS idx_detections_video ON detections(video_id);
CREATE INDEX IF NOT EXISTS idx_detections_review ON detections(review_status);
CREATE INDEX IF NOT EXISTS idx_analysis_video ON analysis_results(video_id);
CREATE INDEX IF NOT EXISTS idx_processing_log_path ON processing_log(volume_path);
CREATE INDEX IF NOT EXISTS idx_contexts_name ON contexts(name);
"""
cur.execute(tables_sql)
print("8 tabelas + indexes criados.")

# Seed data
cur.execute("SELECT COUNT(*) FROM configurations")
if cur.fetchone()[0] == 0:
    cur.execute("""INSERT INTO configurations (config_id,config_key,config_value,description,updated_at) VALUES
        (1,'detection_categories','["fadiga","distracao"]','Categorias',NOW()),
        (2,'scan_prompt','Analyze this image for fatigue and distraction. Rate each 1-10.','Prompt',NOW()),
        (3,'scan_fps','0.2','FPS scan',NOW()),(4,'detail_fps','1.0','FPS detalhe',NOW()),
        (5,'score_threshold','4','Score minimo',NOW()),(6,'timezone','America/Sao_Paulo','TZ',NOW())""")
    print("Seed: configuracoes inseridas.")

cur.execute("SELECT COUNT(*) FROM branding")
if cur.fetchone()[0] == 0:
    cur.execute("""INSERT INTO branding (setting_id,setting_key,setting_value,updated_at) VALUES
        (1,'primary_color','#2563EB',NOW()),(2,'secondary_color','#1E293B',NOW()),
        (3,'accent_color','#3B82F6',NOW()),(4,'sidebar_color','#0F172A',NOW())""")
    print("Seed: branding inserido.")

cur.close()
conn.close()
print(f"\n  DATABASE PRONTO: {DATABASE_NAME}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Unity Catalog - Volumes

# COMMAND ----------

print(f"Configurando Unity Catalog: {CATALOG_NAME}.{SCHEMA_NAME}")

try:
    spark.sql(f"CREATE CATALOG IF NOT EXISTS `{CATALOG_NAME}`")
    print(f"  [OK] Catalog '{CATALOG_NAME}'")
except Exception as e:
    if "already exists" in str(e).lower():
        print(f"  Catalog ja existe.")
    elif "storage root" in str(e).lower() or "default storage" in str(e).lower():
        fallback = spark.sql("SELECT current_catalog()").collect()[0][0]
        if fallback and fallback not in ("hive_metastore", "system", "samples"):
            CATALOG_NAME = fallback
            VIDEO_VOLUME_PATH = f"/Volumes/{CATALOG_NAME}/{SCHEMA_NAME}/uploaded_videos"
            THUMBNAIL_VOLUME_PATH = f"/Volumes/{CATALOG_NAME}/{SCHEMA_NAME}/thumbnails"
            print(f"  Usando catalog existente: '{CATALOG_NAME}'")
        else:
            raise Exception(f"Nao ha catalog utilizavel. Preencha o widget catalog_name.")
    else:
        raise

spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{CATALOG_NAME}`.`{SCHEMA_NAME}`")
print(f"  [OK] Schema '{CATALOG_NAME}.{SCHEMA_NAME}'")

for vol in ["uploaded_videos", "thumbnails"]:
    spark.sql(f"CREATE VOLUME IF NOT EXISTS `{CATALOG_NAME}`.`{SCHEMA_NAME}`.`{vol}`")
    print(f"  [OK] Volume '{vol}'")

print(f"\n  Videos:     {VIDEO_VOLUME_PATH}")
print(f"  Thumbnails: {THUMBNAIL_VOLUME_PATH}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Databricks App

# COMMAND ----------

# --- 5a. Clonar repo ---
source_path = f"/Workspace/Users/{current_user}/{APP_NAME}-source"
repo_id = None

try:
    w.workspace.get_status(source_path)
    print(f"Source ja existe: {source_path}")
    # Obter repo_id
    for r in w.repos.list(path_prefix=f"/Workspace/Users/{current_user}"):
        if r.path == source_path:
            repo_id = r.id
            break
except Exception:
    print(f"Clonando repo...")
    try:
        repo = w.repos.create(url=GIT_REPO_URL, provider="gitHub", path=source_path)
        repo_id = repo.id
        print(f"  [OK] Repo clonado (id={repo_id})")
    except Exception as e:
        if "already exists" in str(e).lower():
            print(f"  Repo ja existe.")
            for r in w.repos.list(path_prefix=f"/Workspace/Users/{current_user}"):
                if r.path == source_path:
                    repo_id = r.id
                    break
        else:
            raise

if not repo_id:
    # Fallback: usar object_id do workspace
    repo_id = w.workspace.get_status(source_path).object_id

print(f"  Repo ID: {repo_id}")

# COMMAND ----------

# --- 5b. Criar App ---
print(f"Verificando app '{APP_NAME}'...")

try:
    app_info = w.api_client.do("GET", f"/api/2.0/apps/{APP_NAME}")
    print(f"  App ja existe.")
except Exception:
    print(f"  Criando app...")
    app_info = w.api_client.do("POST", "/api/2.0/apps", body={
        "name": APP_NAME,
        "description": "Databricks Scenic Crawler AI - Video Analysis"
    })
    time.sleep(10)
    app_info = w.api_client.do("GET", f"/api/2.0/apps/{APP_NAME}")

sp_client_id = app_info.get("service_principal_client_id", "")
sp_name = app_info.get("service_principal_name", "")
sp_id = app_info.get("service_principal_id", "")
app_url = app_info.get("url", "")

if not sp_client_id:
    raise Exception("SP da app nao encontrado. Verifique Compute > Apps.")

print(f"  URL: {app_url}")
print(f"  SP: {sp_name} ({sp_client_id})")

# --- 5c. Dar permissao ao SP no repo ---
print(f"\nConcedendo CAN_MANAGE ao SP no repo...")
try:
    # Repos usam /api/2.0/permissions/repos/{id}, nao directories!
    w.api_client.do("PATCH", f"/api/2.0/permissions/repos/{repo_id}", body={
        "access_control_list": [{"service_principal_name": sp_name, "permission_level": "CAN_MANAGE"}]
    })
    print(f"  [OK] Permissao concedida via repos/{repo_id}")
except Exception as e:
    print(f"  Tentativa com repos falhou: {e}")
    print(f"  Tentando com directories...")
    try:
        obj_id = w.workspace.get_status(source_path).object_id
        w.api_client.do("PATCH", f"/api/2.0/permissions/directories/{obj_id}", body={
            "access_control_list": [{"service_principal_name": sp_name, "permission_level": "CAN_MANAGE"}]
        })
        print(f"  [OK] Permissao concedida via directories/{obj_id}")
    except Exception as e2:
        print(f"  [!!] Falha: {e2}")
        print(f"  ACAO MANUAL: Workspace > {source_path} > Permissions > Add '{sp_name}' CAN_MANAGE")

# COMMAND ----------

# --- 5d. Configurar PG role para o SP ---
print(f"Configurando role PostgreSQL para SP: {sp_client_id}")

cred = w.api_client.do("POST", "/api/2.0/postgres/credentials", body={"endpoint": endpoint_name})
db_token = cred["token"]

conn = psycopg2.connect(host=lakebase_host, port=5432, database=DATABASE_NAME,
                         user=current_user, password=db_token, sslmode="require")
conn.autocommit = True
cur = conn.cursor()

cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (sp_client_id,))
if cur.fetchone():
    cur.execute(f'ALTER ROLE "{sp_client_id}" WITH LOGIN PASSWORD %s', (DB_PASSWORD,))
    print(f"  Role atualizado.")
else:
    cur.execute(f'CREATE ROLE "{sp_client_id}" WITH LOGIN PASSWORD %s', (DB_PASSWORD,))
    print(f"  Role criado.")

for g in [
    f'GRANT ALL PRIVILEGES ON DATABASE "{DATABASE_NAME}" TO "{sp_client_id}"',
    f'GRANT ALL PRIVILEGES ON SCHEMA public TO "{sp_client_id}"',
    f'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "{sp_client_id}"',
    f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "{sp_client_id}"',
]:
    try:
        cur.execute(g)
    except Exception:
        pass

# Testar
cur.close()
conn.close()

test_conn = psycopg2.connect(host=lakebase_host, port=5432, database=DATABASE_NAME,
                              user=sp_client_id, password=DB_PASSWORD, sslmode="require")
test_conn.cursor().execute("SELECT 1")
test_conn.close()
print(f"  [OK] Conexao SP testada com sucesso.")

# COMMAND ----------

# --- 5e. Upload app.yaml ---
app_yaml_content = f"""command:
  - uvicorn
  - app:app
  - --host
  - 0.0.0.0
  - --port
  - "8000"
env:
  - name: DBXSC_AI_DB_HOST
    value: "{lakebase_host}"
  - name: DBXSC_AI_DB_PORT
    value: "5432"
  - name: DBXSC_AI_DB_NAME
    value: "{DATABASE_NAME}"
  - name: DBXSC_AI_DB_SCHEMA
    value: "public"
  - name: DBXSC_AI_LAKEBASE_PROJECT
    value: "{LAKEBASE_PROJECT}"
  - name: DBXSC_AI_LAKEBASE_BRANCH
    value: "production"
  - name: DBXSC_AI_LAKEBASE_ENDPOINT
    value: "primary"
  - name: DBXSC_AI_DB_USER
    value: "{sp_client_id}"
  - name: DBXSC_AI_DB_PASSWORD
    value: "{DB_PASSWORD}"
  - name: FMAPI_MODEL
    value: "{VISION_MODEL}"
  - name: VIDEO_VOLUME
    value: "{VIDEO_VOLUME_PATH}"
  - name: THUMBNAIL_VOLUME
    value: "{THUMBNAIL_VOLUME_PATH}"
resources:
  - name: serving-endpoint
    serving_endpoint:
      name: {VISION_MODEL}
      permission: CAN_QUERY
"""

import io
from databricks.sdk.service.workspace import ImportFormat
app_yaml_path = f"{source_path}/app.yaml"
w.workspace.upload(app_yaml_path, io.BytesIO(app_yaml_content.encode("utf-8")), format=ImportFormat.AUTO, overwrite=True)
print(f"app.yaml enviado para: {app_yaml_path}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Deploy

# COMMAND ----------

# --- Aguardar compute ---
print(f"Aguardando compute da app ficar ativo...")
for attempt in range(40):
    try:
        s = w.api_client.do("GET", f"/api/2.0/apps/{APP_NAME}")
        cs = s.get("compute_status", {}).get("state", "")
        if cs == "ACTIVE":
            print(f"  Compute ACTIVE!")
            break
        print(f"  {cs} ({attempt+1}/40)")
    except Exception:
        pass
    time.sleep(15)
else:
    raise Exception("Timeout: compute nao ativou em 10 min.")

# --- Deploy ---
print(f"\nDeploy da app '{APP_NAME}' de {source_path}...")
deploy = w.api_client.do("POST", f"/api/2.0/apps/{APP_NAME}/deployments", body={
    "source_code_path": source_path, "mode": "SNAPSHOT"
})
deploy_id = deploy.get("deployment_id", "")
print(f"  Deploy ID: {deploy_id}")

for attempt in range(40):
    time.sleep(15)
    try:
        st = w.api_client.do("GET", f"/api/2.0/apps/{APP_NAME}/deployments/{deploy_id}")
        state = st.get("status", {}).get("state", "")
        msg = st.get("status", {}).get("message", "")
        if state == "SUCCEEDED":
            print(f"\n  DEPLOY CONCLUIDO! {msg}")
            break
        elif state == "FAILED":
            raise Exception(f"Deploy falhou: {msg}")
        print(f"  {state}: {msg} ({attempt+1}/40)")
    except Exception as e:
        if "falhou" in str(e).lower() or "FAILED" in str(e):
            raise
        print(f"  Verificando... ({attempt+1}/40)")
else:
    print(f"  Timeout. Verifique Compute > Apps > {APP_NAME}")

# COMMAND ----------

# MAGIC %md
# MAGIC ### Validacao

# COMMAND ----------

import urllib.request, ssl

print(f"Validando app em {app_url}...")
_ssl = ssl.create_default_context()
_ssl.check_hostname = False
_ssl.verify_mode = ssl.CERT_NONE
_auth = {"Authorization": f"Bearer {_token}"}

all_ok = True
for ep in ["/api/contexts", "/api/config", "/api/branding"]:
    try:
        req = urllib.request.Request(f"{app_url}{ep}", headers=_auth)
        with urllib.request.urlopen(req, timeout=30, context=_ssl) as r:
            print(f"  [OK] GET {ep} -> {r.status} ({len(r.read())} bytes)")
    except Exception as e:
        print(f"  [!!] GET {ep} -> {e}")
        all_ok = False

# COMMAND ----------

# MAGIC %md
# MAGIC ## Resumo

# COMMAND ----------

print("=" * 60)
print("  DEPLOY COMPLETO - Scenic Crawler AI")
print("=" * 60)
print(f"\n  App URL:          {app_url}")
print(f"  App Name:         {APP_NAME}")
print(f"  Lakebase Host:    {lakebase_host}")
print(f"  Database:         {DATABASE_NAME}")
print(f"  Catalog:          {CATALOG_NAME}.{SCHEMA_NAME}")
print(f"  Video Volume:     {VIDEO_VOLUME_PATH}")
print(f"  Thumbnail Volume: {THUMBNAIL_VOLUME_PATH}")
print(f"  Modelo Visao:     {VISION_MODEL}")
print(f"\n  PROXIMOS PASSOS:")
print(f"  1. Acesse: {app_url}")
print(f"  2. Settings > Contexts > crie um contexto")
print(f"  3. Process Videos > analise um video")
print(f"\n  STATUS: {'TUDO OK!' if all_ok else 'COM AVISOS - veja acima'}")
print("=" * 60)
