# Databricks notebook source
# MAGIC %md
# MAGIC # Databricks Scenic Crawler AI - Deploy Completo
# MAGIC
# MAGIC Este notebook provisiona **toda a infraestrutura** e faz o deploy da app Scenic Crawler AI em qualquer workspace Databricks.
# MAGIC
# MAGIC ### O que este notebook faz:
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
# MAGIC - Workspace com **Databricks Apps** habilitado
# MAGIC - Workspace com **Lakebase** habilitado
# MAGIC - Acesso a **Unity Catalog**
# MAGIC - Serving endpoint com modelo de visao (ex: `databricks-llama-4-maverick`)
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ### Arquitetura
# MAGIC
# MAGIC ```
# MAGIC  Browser (React SPA)
# MAGIC       |
# MAGIC       v  REST API + SSE
# MAGIC  FastAPI Backend (Python)
# MAGIC       |         |         |
# MAGIC       v         v         v
# MAGIC   Lakebase    FMAPI    Volumes
# MAGIC  PostgreSQL   Vision   Videos/
# MAGIC  (8 tabelas)  Model   Thumbnails
# MAGIC ```

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Configuracao
# MAGIC
# MAGIC Preencha os parametros abaixo. Valores padrao sao sugeridos mas podem ser alterados.
# MAGIC
# MAGIC > **Dica:** Se voce ja tem um projeto Lakebase, coloque o mesmo nome. O notebook vai detectar e reutilizar.

# COMMAND ----------

# Widgets de configuracao
dbutils.widgets.text("lakebase_project", "scenic-crawler", "1. Nome do Projeto Lakebase")
dbutils.widgets.text("database_name", "scenic_crawler", "2. Nome do Database")
dbutils.widgets.text("catalog_name", "", "3. Catalog (Unity Catalog)")
dbutils.widgets.text("schema_name", "scenic_crawler", "4. Schema")
dbutils.widgets.text("app_name", "scenic-crawler-ai", "5. Nome da App")
dbutils.widgets.text("vision_model", "databricks-llama-4-maverick", "6. Modelo de Visao (endpoint)")
dbutils.widgets.text("git_repo_url", "https://github.com/juliandrof/Databricks-Scenic-Crawler-AI.git", "7. URL do Repo Git")
dbutils.widgets.text("db_password", "scenic-crawler-2026", "8. Senha PG para o Service Principal")

# COMMAND ----------

# Ler parametros
LAKEBASE_PROJECT = dbutils.widgets.get("lakebase_project").strip()
DATABASE_NAME = dbutils.widgets.get("database_name").strip()
CATALOG_NAME = dbutils.widgets.get("catalog_name").strip()
SCHEMA_NAME = dbutils.widgets.get("schema_name").strip()
APP_NAME = dbutils.widgets.get("app_name").strip()
VISION_MODEL = dbutils.widgets.get("vision_model").strip()
GIT_REPO_URL = dbutils.widgets.get("git_repo_url").strip()
DB_PASSWORD = dbutils.widgets.get("db_password").strip()

# Derivar valores
import re
current_user = spark.sql("SELECT current_user()").collect()[0][0]
workspace_url = spark.conf.get("spark.databricks.workspaceUrl", "")

# Se catalog nao foi especificado, detectar o default do workspace
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
# MAGIC ---
# MAGIC ## 2. Lakebase - Projeto PostgreSQL
# MAGIC
# MAGIC O Lakebase e o PostgreSQL gerenciado do Databricks. Ele escala a zero quando nao esta em uso e acorda automaticamente.
# MAGIC
# MAGIC Esta etapa:
# MAGIC - Verifica se o projeto ja existe
# MAGIC - Se nao existir, cria um novo
# MAGIC - Aguarda o endpoint ficar **ACTIVE**
# MAGIC - Retorna o hostname para conexao

# COMMAND ----------

# MAGIC %md
# MAGIC ### 2a. Diagnostico de conectividade
# MAGIC
# MAGIC Testa qual metodo de chamada API funciona neste ambiente antes de prosseguir.

# COMMAND ----------

import time
import json
from databricks.sdk import WorkspaceClient

_token = dbutils.notebook.entry_point.getDbutils().notebook().getContext().apiToken().get()
_ws_url = spark.conf.get("spark.databricks.workspaceUrl", "")

print("=" * 60)
print("DIAGNOSTICO DE CONECTIVIDADE")
print("=" * 60)

# Teste 1: SDK default
w1 = WorkspaceClient()
print(f"\n1. SDK default -> host: {w1.config.host}")
try:
    r = w1.api_client.do("GET", "/api/2.0/postgres/projects")
    print(f"   OK: {json.dumps(r)[:200]}")
    _sdk_mode = "default"
except Exception as e:
    print(f"   FALHOU: {e}")
    _sdk_mode = None

# Teste 2: SDK com host explicito
w2 = WorkspaceClient(host=f"https://{_ws_url}", token=_token)
print(f"\n2. SDK explicit -> host: {w2.config.host}")
try:
    r = w2.api_client.do("GET", "/api/2.0/postgres/projects")
    print(f"   OK: {json.dumps(r)[:200]}")
    if not _sdk_mode:
        _sdk_mode = "explicit"
except Exception as e:
    print(f"   FALHOU: {e}")

# Teste 3: query param via query= vs url?=
print(f"\n3. Query param test:")
_w = w1 if _sdk_mode == "default" else w2
try:
    r = _w.api_client.do("GET", "/api/2.0/postgres/projects", query={"page_size": "10"})
    print(f"   query= kwarg: OK")
    _query_mode = "kwarg"
except Exception as e:
    print(f"   query= kwarg: FALHOU ({e})")
    _query_mode = None

try:
    r = _w.api_client.do("GET", "/api/2.0/postgres/projects?page_size=10")
    print(f"   query in URL: OK")
    if not _query_mode:
        _query_mode = "url"
except Exception as e:
    print(f"   query in URL: FALHOU ({e})")

print(f"\n{'=' * 60}")
print(f"  RESULTADO: sdk_mode={_sdk_mode}, query_mode={_query_mode}")
print(f"{'=' * 60}")

if not _sdk_mode:
    raise Exception("Nenhum metodo de API funcionou. Verifique permissoes e conectividade.")

# Usar o SDK que funcionou
w = w1 if _sdk_mode == "default" else w2

# --- Verificar se o projeto ja existe ---
print(f"\nVerificando se o projeto '{LAKEBASE_PROJECT}' ja existe...")

project_exists = False
lakebase_host = None

try:
    if _query_mode == "kwarg":
        projects_data = w.api_client.do("GET", "/api/2.0/postgres/projects", query={"page_size": "200"})
    else:
        projects_data = w.api_client.do("GET", "/api/2.0/postgres/projects?page_size=200")
    for p in projects_data.get("projects", []):
        if p.get("name", "") == f"projects/{LAKEBASE_PROJECT}":
            project_exists = True
            print(f"  Projeto encontrado: {p['name']}")
            break
    if not project_exists:
        print(f"  Projeto nao encontrado na lista.")
except Exception as e:
    print(f"  Erro ao listar projetos (transiente, continuando): {e}")

# --- Criar se nao existe ---
if not project_exists:
    print(f"\nCriando projeto Lakebase '{LAKEBASE_PROJECT}'...")
    try:
        if _query_mode == "kwarg":
            result = w.api_client.do(
                "POST", "/api/2.0/postgres/projects",
                query={"project_id": LAKEBASE_PROJECT},
                body={"spec": {"display_name": f"Scenic Crawler AI - {LAKEBASE_PROJECT}"}}
            )
        else:
            result = w.api_client.do(
                "POST", f"/api/2.0/postgres/projects?project_id={LAKEBASE_PROJECT}",
                body={"spec": {"display_name": f"Scenic Crawler AI - {LAKEBASE_PROJECT}"}}
            )
        print(f"  Projeto criado (operacao async)")
    except Exception as e:
        if "already exists" in str(e).lower():
            print(f"  Projeto ja existe (confirmado via erro)")
            project_exists = True
        else:
            raise Exception(f"Falha ao criar projeto Lakebase: {e}")
else:
    print(f"  Projeto ja existe, reutilizando.")

# --- Aguardar endpoint ficar ativo ---
print(f"\nAguardando Lakebase ficar ACTIVE...")
branch_path = f"projects/{LAKEBASE_PROJECT}/branches/production"

for attempt in range(60):
    try:
        endpoints_data = w.api_client.do("GET", f"/api/2.0/postgres/{branch_path}/endpoints")
        if attempt < 3:
            print(f"  [DEBUG] Resposta (tipo={type(endpoints_data).__name__}): {json.dumps(endpoints_data)[:300]}")
        endpoints = endpoints_data.get("endpoints", [])
        if endpoints:
            ep = endpoints[0]
            state = ep.get("status", {}).get("current_state", "UNKNOWN")
            host = ep.get("status", {}).get("hosts", {}).get("host", "")
            if state == "ACTIVE" and host:
                lakebase_host = host
                print(f"  Endpoint ACTIVE!")
                print(f"  Host: {lakebase_host}")
                break
            else:
                print(f"  Estado: {state} (tentativa {attempt+1}/60)")
        else:
            print(f"  Nenhum endpoint ainda (tentativa {attempt+1}/60)")
    except Exception as e:
        err = str(e)
        if attempt < 3:
            print(f"  [DEBUG] Excecao: {type(e).__name__}: {err[:200]}")
        if "not found" in err.lower():
            print(f"  Projeto provisionando... (tentativa {attempt+1}/60)")
        else:
            print(f"  Aguardando... ({err[:100]}) (tentativa {attempt+1}/60)")
    time.sleep(10)

if not lakebase_host:
    raise Exception("Timeout: Lakebase nao ficou ativo em 10 minutos. Verifique no console SQL > Lakebase.")

print(f"\n{'='*60}")
print(f"  LAKEBASE PRONTO")
print(f"  Host: {lakebase_host}")
print(f"  Porta: 5432")
print(f"{'='*60}")

# COMMAND ----------

# MAGIC %md
# MAGIC ---
# MAGIC ## 3. Database e Tabelas
# MAGIC
# MAGIC Agora vamos:
# MAGIC 1. Gerar credenciais temporarias para conectar ao Lakebase
# MAGIC 2. Criar o database (se nao existir)
# MAGIC 3. Criar todas as 8 tabelas da aplicacao
# MAGIC 4. Popular dados iniciais (seed)
# MAGIC
# MAGIC ### Esquema do banco:
# MAGIC
# MAGIC | Tabela | Descricao |
# MAGIC |--------|-----------|
# MAGIC | `videos` | Metadados dos videos, status de processamento |
# MAGIC | `analysis_results` | Scores agregados por video |
# MAGIC | `detections` | Deteccoes individuais com timestamp e thumbnail |
# MAGIC | `processing_log` | Log de videos ja processados (deduplicacao) |
# MAGIC | `contexts` | Perfis de analise (categorias, prompts, thresholds) |
# MAGIC | `configurations` | Configuracoes chave-valor |
# MAGIC | `branding` | Logo e paleta de cores |
# MAGIC | `review_log` | Audit trail de acoes de revisao |

# COMMAND ----------

import subprocess
import sys

# Instalar psycopg2 se necessario
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
    import psycopg2
    import psycopg2.extras

# --- Gerar credenciais ---
print("Gerando credenciais temporarias para Lakebase...")
endpoint_name = f"projects/{LAKEBASE_PROJECT}/branches/production/endpoints/primary"

try:
    cred = w.api_client.do("POST", "/api/2.0/postgres/credentials", body={"endpoint": endpoint_name})
    db_token = cred.get("token", "")
    db_user = current_user
    print(f"  Credencial gerada para: {db_user}")
except Exception as e:
    raise Exception(f"Falha ao gerar credencial Lakebase: {e}. Verifique permissoes do usuario.")

# --- Criar database ---
print(f"\nConectando ao PostgreSQL e criando database '{DATABASE_NAME}'...")

try:
    conn = psycopg2.connect(
        host=lakebase_host, port=5432, database="postgres",
        user=db_user, password=db_token, sslmode="require"
    )
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE_NAME,))
    if cur.fetchone():
        print(f"  Database '{DATABASE_NAME}' ja existe.")
    else:
        cur.execute(f'CREATE DATABASE "{DATABASE_NAME}"')
        print(f"  Database '{DATABASE_NAME}' criado!")

    cur.close()
    conn.close()
except Exception as e:
    raise Exception(f"Falha ao criar database: {e}")

# --- Conectar ao database e criar tabelas ---
print(f"\nCriando tabelas no database '{DATABASE_NAME}'...")

conn = psycopg2.connect(
    host=lakebase_host, port=5432, database=DATABASE_NAME,
    user=db_user, password=db_token, sslmode="require"
)
conn.autocommit = True
cur = conn.cursor()

tables_sql = [
    ("videos", """
        CREATE TABLE IF NOT EXISTS videos (
            video_id BIGINT PRIMARY KEY,
            filename VARCHAR(500) NOT NULL,
            volume_path VARCHAR(1000) NOT NULL,
            file_size_bytes BIGINT,
            duration_seconds DOUBLE PRECISION,
            fps DOUBLE PRECISION,
            resolution VARCHAR(50),
            upload_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            progress_pct DOUBLE PRECISION DEFAULT 0,
            source VARCHAR(20),
            uploaded_by VARCHAR(200),
            error_message TEXT,
            context_id BIGINT,
            context_name VARCHAR(200),
            context_color VARCHAR(20)
        )
    """),
    ("analysis_results", """
        CREATE TABLE IF NOT EXISTS analysis_results (
            result_id BIGINT PRIMARY KEY,
            video_id BIGINT NOT NULL REFERENCES videos(video_id),
            analysis_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
            scores_json TEXT NOT NULL,
            overall_risk DOUBLE PRECISION,
            total_detections INTEGER,
            scan_fps DOUBLE PRECISION,
            detail_fps DOUBLE PRECISION,
            model_used VARCHAR(200),
            config_snapshot TEXT
        )
    """),
    ("detections", """
        CREATE TABLE IF NOT EXISTS detections (
            detection_id BIGINT PRIMARY KEY,
            video_id BIGINT NOT NULL REFERENCES videos(video_id),
            result_id BIGINT NOT NULL REFERENCES analysis_results(result_id),
            timestamp_sec DOUBLE PRECISION NOT NULL,
            category VARCHAR(100) NOT NULL,
            score INTEGER NOT NULL,
            confidence DOUBLE PRECISION,
            ai_description TEXT,
            thumbnail_path VARCHAR(500),
            frame_index BIGINT,
            review_status VARCHAR(20) DEFAULT 'PENDING',
            reviewed_by VARCHAR(200),
            reviewed_at TIMESTAMP,
            reviewer_notes TEXT
        )
    """),
    ("processing_log", """
        CREATE TABLE IF NOT EXISTS processing_log (
            log_id BIGINT PRIMARY KEY,
            video_id BIGINT NOT NULL REFERENCES videos(video_id),
            volume_path VARCHAR(1000) NOT NULL,
            file_hash VARCHAR(64),
            processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
            status VARCHAR(20) NOT NULL,
            processing_time_sec DOUBLE PRECISION
        )
    """),
    ("contexts", """
        CREATE TABLE IF NOT EXISTS contexts (
            context_id BIGINT PRIMARY KEY,
            name VARCHAR(200) NOT NULL UNIQUE,
            description TEXT,
            categories TEXT NOT NULL DEFAULT '["fadiga", "distracao"]',
            scan_prompt TEXT NOT NULL,
            scan_fps DOUBLE PRECISION DEFAULT 0.2,
            detail_fps DOUBLE PRECISION DEFAULT 1.0,
            score_threshold INTEGER DEFAULT 4,
            color VARCHAR(20) DEFAULT '#2563EB',
            dedup_window INTEGER DEFAULT 5,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """),
    ("configurations", """
        CREATE TABLE IF NOT EXISTS configurations (
            config_id BIGINT PRIMARY KEY,
            config_key VARCHAR(200) NOT NULL UNIQUE,
            config_value TEXT NOT NULL,
            description TEXT,
            updated_at TIMESTAMP DEFAULT NOW(),
            updated_by VARCHAR(200)
        )
    """),
    ("branding", """
        CREATE TABLE IF NOT EXISTS branding (
            setting_id BIGINT PRIMARY KEY,
            setting_key VARCHAR(200) NOT NULL UNIQUE,
            setting_value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """),
    ("review_log", """
        CREATE TABLE IF NOT EXISTS review_log (
            review_log_id BIGINT PRIMARY KEY,
            detection_id BIGINT NOT NULL,
            video_id BIGINT NOT NULL,
            action VARCHAR(20) NOT NULL,
            previous_status VARCHAR(20),
            reviewer VARCHAR(200) NOT NULL,
            notes TEXT,
            action_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """),
]

created = 0
for name, sql in tables_sql:
    try:
        cur.execute(sql)
        created += 1
        print(f"  [OK] {name}")
    except Exception as e:
        print(f"  [!!] {name}: {e}")

# Indexes
indexes = [
    "CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status)",
    "CREATE INDEX IF NOT EXISTS idx_videos_context ON videos(context_id)",
    "CREATE INDEX IF NOT EXISTS idx_detections_video ON detections(video_id)",
    "CREATE INDEX IF NOT EXISTS idx_detections_review ON detections(review_status)",
    "CREATE INDEX IF NOT EXISTS idx_analysis_video ON analysis_results(video_id)",
    "CREATE INDEX IF NOT EXISTS idx_processing_log_path ON processing_log(volume_path)",
    "CREATE INDEX IF NOT EXISTS idx_contexts_name ON contexts(name)",
]

for idx_sql in indexes:
    try:
        cur.execute(idx_sql)
    except Exception:
        pass

print(f"\n  {created}/8 tabelas criadas/verificadas.")

# --- Seed data ---
print("\nPopulando dados iniciais...")

try:
    cur.execute("SELECT COUNT(*) FROM configurations")
    if cur.fetchone()[0] == 0:
        cur.execute("""
            INSERT INTO configurations (config_id, config_key, config_value, description, updated_at) VALUES
            (1, 'detection_categories', '["fadiga", "distracao"]', 'Categorias de deteccao', NOW()),
            (2, 'scan_prompt', 'Analyze this image. Look for fatigue and distraction. Rate each 1-10.', 'Prompt de analise', NOW()),
            (3, 'scan_fps', '0.2', 'Frames por segundo', NOW()),
            (4, 'detail_fps', '1.0', 'FPS analise detalhada', NOW()),
            (5, 'score_threshold', '4', 'Score minimo', NOW()),
            (6, 'timezone', 'America/Sao_Paulo', 'Timezone', NOW())
        """)
        print("  [OK] Configuracoes iniciais")
    else:
        print("  [--] Configuracoes ja existem")
except Exception as e:
    print(f"  [!!] Configuracoes: {e}")

try:
    cur.execute("SELECT COUNT(*) FROM branding")
    if cur.fetchone()[0] == 0:
        cur.execute("""
            INSERT INTO branding (setting_id, setting_key, setting_value, updated_at) VALUES
            (1, 'primary_color', '#2563EB', NOW()),
            (2, 'secondary_color', '#1E293B', NOW()),
            (3, 'accent_color', '#3B82F6', NOW()),
            (4, 'sidebar_color', '#0F172A', NOW())
        """)
        print("  [OK] Branding padrao")
    else:
        print("  [--] Branding ja existe")
except Exception as e:
    print(f"  [!!] Branding: {e}")

cur.close()
conn.close()

print(f"\n{'='*60}")
print(f"  DATABASE PRONTO: {DATABASE_NAME}")
print(f"  8 tabelas + indexes + seed data")
print(f"{'='*60}")

# COMMAND ----------

# MAGIC %md
# MAGIC ---
# MAGIC ## 4. Unity Catalog - Volumes
# MAGIC
# MAGIC Os volumes do Unity Catalog sao usados para armazenar:
# MAGIC - **uploaded_videos** -- Videos enviados via upload ou batch
# MAGIC - **thumbnails** -- Imagens de thumbnail geradas nas deteccoes
# MAGIC
# MAGIC Esta etapa cria o catalog, schema e os dois volumes necessarios.

# COMMAND ----------

print(f"Configurando Unity Catalog: {CATALOG_NAME}.{SCHEMA_NAME}")

# --- Catalog ---
try:
    spark.sql(f"CREATE CATALOG IF NOT EXISTS `{CATALOG_NAME}`")
    print(f"  [OK] Catalog '{CATALOG_NAME}'")
except Exception as e:
    if "already exists" in str(e).lower():
        print(f"  [--] Catalog '{CATALOG_NAME}' ja existe")
    elif "storage root" in str(e).lower() or "default storage" in str(e).lower():
        print(f"  [!!] Nao foi possivel criar catalog '{CATALOG_NAME}' (sem storage root).")
        print(f"       Tentando usar o catalog default do workspace...")
        try:
            fallback = spark.sql("SELECT current_catalog()").collect()[0][0]
            if fallback and fallback not in ("hive_metastore", "system", "samples"):
                CATALOG_NAME = fallback
                VIDEO_VOLUME_PATH = f"/Volumes/{CATALOG_NAME}/{SCHEMA_NAME}/uploaded_videos"
                THUMBNAIL_VOLUME_PATH = f"/Volumes/{CATALOG_NAME}/{SCHEMA_NAME}/thumbnails"
                print(f"  [OK] Usando catalog existente: '{CATALOG_NAME}'")
            else:
                raise Exception(f"Catalog default '{fallback}' nao e utilizavel")
        except Exception as e2:
            print(f"  [!!] Fallback falhou: {e2}")
            print(f"       Altere o widget 'catalog_name' para um catalog existente.")
    else:
        print(f"  [!!] Catalog: {e}")
        print(f"       Altere o widget 'catalog_name' para um catalog existente.")

# --- Schema ---
try:
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS `{CATALOG_NAME}`.`{SCHEMA_NAME}`")
    print(f"  [OK] Schema '{CATALOG_NAME}.{SCHEMA_NAME}'")
except Exception as e:
    if "already exists" in str(e).lower():
        print(f"  [--] Schema ja existe")
    else:
        print(f"  [!!] Schema: {e}")

# --- Volumes ---
for vol_name in ["uploaded_videos", "thumbnails"]:
    try:
        spark.sql(f"CREATE VOLUME IF NOT EXISTS `{CATALOG_NAME}`.`{SCHEMA_NAME}`.`{vol_name}`")
        print(f"  [OK] Volume '{vol_name}'")
    except Exception as e:
        if "already exists" in str(e).lower():
            print(f"  [--] Volume '{vol_name}' ja existe")
        else:
            print(f"  [!!] Volume '{vol_name}': {e}")

print(f"\n{'='*60}")
print(f"  VOLUMES PRONTOS")
print(f"  Videos:     {VIDEO_VOLUME_PATH}")
print(f"  Thumbnails: {THUMBNAIL_VOLUME_PATH}")
print(f"{'='*60}")

# COMMAND ----------

# MAGIC %md
# MAGIC ---
# MAGIC ## 5. Databricks App
# MAGIC
# MAGIC Agora vamos:
# MAGIC 1. Clonar o repositorio Git no workspace (se necessario)
# MAGIC 2. Criar a Databricks App
# MAGIC 3. Obter o UUID do Service Principal automatico
# MAGIC 4. Criar o role PostgreSQL para o Service Principal
# MAGIC 5. Gerar e fazer upload do `app.yaml` com todos os valores corretos
# MAGIC
# MAGIC > **Nota:** A Databricks App cria automaticamente um Service Principal dedicado.
# MAGIC > Precisamos dar acesso a esse SP no PostgreSQL para que a app consiga conectar.

# COMMAND ----------

import json

# --- Determinar source path ---
source_path = f"/Workspace/Users/{current_user}/{APP_NAME}-source"

# --- Verificar se o source path ja existe ---
source_exists = False
try:
    w.workspace.get_status(source_path)
    source_exists = True
    print(f"Source path ja existe: {source_path}")
except Exception:
    print(f"Source path nao existe, criando...")

# Se nao existe, clonar o repo
if not source_exists:
    try:
        # Criar diretorio
        w.workspace.mkdirs(source_path)
        print(f"  Diretorio criado: {source_path}")
    except Exception as e:
        print(f"  Nota: {e}")

    # Importar arquivos do repo via Git folder
    print(f"\n  IMPORTANTE: Clone o repositorio manualmente:")
    print(f"  1. Va em Workspace > Add > Git folder")
    print(f"  2. URL: {GIT_REPO_URL}")
    print(f"  3. Nome: {APP_NAME}-source")
    print(f"\n  Ou use o Repos API. Tentando automaticamente...")

    try:
        repo = w.repos.create(
            url=GIT_REPO_URL,
            provider="gitHub",
            path=source_path
        )
        print(f"  [OK] Repo clonado em: {source_path}")
        source_exists = True
    except Exception as e:
        if "already exists" in str(e).lower():
            source_exists = True
            print(f"  [--] Repo ja existe")
        else:
            print(f"  [!!] Falha ao clonar: {e}")
            print(f"\n  Clone manualmente e re-execute esta celula.")

# COMMAND ----------

# --- Criar ou obter a App ---
print(f"Verificando app '{APP_NAME}'...")

app_info = None
sp_client_id = None

# Tentar obter app existente
try:
    app_info = w.api_client.do("GET", f"/api/2.0/apps/{APP_NAME}")
    sp_client_id = app_info.get("service_principal_client_id", "")
    print(f"  App ja existe: {APP_NAME}")
    print(f"  URL: {app_info.get('url', 'N/A')}")
    print(f"  SP Client ID: {sp_client_id}")
except Exception:
    print(f"  App nao existe, criando...")
    try:
        app_info = w.api_client.do("POST", "/api/2.0/apps", body={
            "name": APP_NAME,
            "description": "Databricks Scenic Crawler AI - Video Analysis"
        })
        sp_client_id = app_info.get("service_principal_client_id", "")
        print(f"  [OK] App criada: {APP_NAME}")
        print(f"  SP Client ID: {sp_client_id}")

        # Aguardar app ficar pronta
        print(f"  Aguardando app ficar pronta...")
        time.sleep(10)
        app_info = w.api_client.do("GET", f"/api/2.0/apps/{APP_NAME}")
        sp_client_id = app_info.get("service_principal_client_id", "")
    except Exception as e:
        raise Exception(f"Falha ao criar app: {e}")

if not sp_client_id:
    raise Exception("Nao foi possivel obter o Service Principal da app. Verifique no console Compute > Apps.")

app_url = app_info.get("url", f"https://{APP_NAME}-WORKSPACE_ID.aws.databricksapps.com")
sp_id = app_info.get("service_principal_id", "")

print(f"\n  Service Principal UUID: {sp_client_id}")
print(f"  Service Principal ID:   {sp_id}")
print(f"  Este UUID sera usado como usuario PostgreSQL.")

# --- Dar permissao ao SP no source code folder ---
print(f"\nConcedendo permissao de leitura ao SP no source path...")
try:
    obj_status = w.workspace.get_status(source_path)
    obj_id = obj_status.object_id
    w.api_client.do("PUT", f"/api/2.0/permissions/directories/{obj_id}", body={
        "access_control_list": [
            {
                "service_principal_name": app_info.get("service_principal_name", f"app-{APP_NAME}"),
                "all_permissions": [{"permission_level": "CAN_READ"}]
            }
        ]
    })
    print(f"  [OK] Permissao CAN_READ concedida no folder (object_id={obj_id})")
except Exception as e:
    print(f"  [!!] Falha ao dar permissao: {e}")
    print(f"       Tente manualmente: Workspace > {source_path} > Permissions > Add SP")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5b. Configurar acesso PostgreSQL para o Service Principal
# MAGIC
# MAGIC O Service Principal da app precisa de um role no PostgreSQL com:
# MAGIC - Permissao de **LOGIN**
# MAGIC - **Senha** definida (usada no `app.yaml`)
# MAGIC - **GRANT ALL** em todas as tabelas

# COMMAND ----------

# --- Configurar role PG para o Service Principal ---
print(f"Configurando role PostgreSQL para SP: {sp_client_id}")

cred = w.api_client.do("POST", "/api/2.0/postgres/credentials", body={"endpoint": endpoint_name})
db_token = cred.get("token", "")

conn = psycopg2.connect(
    host=lakebase_host, port=5432, database=DATABASE_NAME,
    user=current_user, password=db_token, sslmode="require"
)
conn.autocommit = True
cur = conn.cursor()

# Verificar se role existe
cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (sp_client_id,))
role_exists = cur.fetchone() is not None

if not role_exists:
    cur.execute(f'CREATE ROLE "{sp_client_id}" WITH LOGIN PASSWORD %s', (DB_PASSWORD,))
    print(f"  [OK] Role criado com LOGIN e senha")
else:
    cur.execute(f'ALTER ROLE "{sp_client_id}" WITH LOGIN PASSWORD %s', (DB_PASSWORD,))
    print(f"  [OK] Role atualizado com LOGIN e senha")

# Grants
grants = [
    f'GRANT ALL PRIVILEGES ON DATABASE "{DATABASE_NAME}" TO "{sp_client_id}"',
    f'GRANT ALL PRIVILEGES ON SCHEMA public TO "{sp_client_id}"',
    f'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "{sp_client_id}"',
    f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "{sp_client_id}"',
]

for grant in grants:
    try:
        cur.execute(grant)
    except Exception as e:
        print(f"  [!!] Grant falhou: {e}")

print(f"  [OK] Permissoes concedidas")

# Testar conexao com as credenciais do SP
cur.close()
conn.close()

try:
    test_conn = psycopg2.connect(
        host=lakebase_host, port=5432, database=DATABASE_NAME,
        user=sp_client_id, password=DB_PASSWORD, sslmode="require"
    )
    test_cur = test_conn.cursor()
    test_cur.execute("SELECT COUNT(*) FROM contexts")
    count = test_cur.fetchone()[0]
    test_cur.close()
    test_conn.close()
    print(f"  [OK] Teste de conexao com SP bem sucedido! ({count} contextos)")
except Exception as e:
    print(f"  [!!] Teste de conexao falhou: {e}")
    print(f"       A app pode nao conseguir conectar ao banco.")

print(f"\n{'='*60}")
print(f"  SERVICE PRINCIPAL CONFIGURADO")
print(f"  User: {sp_client_id}")
print(f"  Senha: {DB_PASSWORD}")
print(f"{'='*60}")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5c. Gerar e fazer upload do app.yaml
# MAGIC
# MAGIC O `app.yaml` contem todas as variaveis de ambiente da aplicacao.
# MAGIC Vamos gera-lo com os valores corretos e fazer upload para o workspace.

# COMMAND ----------

# --- Gerar app.yaml ---
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

# Upload para o workspace
app_yaml_path = f"{source_path}/app.yaml"
print(f"Fazendo upload do app.yaml para: {app_yaml_path}")

try:
    import io
    w.workspace.upload(
        app_yaml_path,
        io.BytesIO(app_yaml_content.encode("utf-8")),
        format="AUTO",
        overwrite=True
    )
    print(f"  [OK] app.yaml enviado!")
except Exception as e:
    print(f"  [!!] Falha no upload: {e}")
    print(f"\n  Conteudo do app.yaml (copie manualmente se necessario):")
    print(f"  {'='*50}")
    print(app_yaml_content)

print(f"\n  Valores configurados:")
print(f"  DB_HOST:     {lakebase_host}")
print(f"  DB_NAME:     {DATABASE_NAME}")
print(f"  DB_USER:     {sp_client_id}")
print(f"  MODEL:       {VISION_MODEL}")
print(f"  VIDEOS:      {VIDEO_VOLUME_PATH}")
print(f"  THUMBNAILS:  {THUMBNAIL_VOLUME_PATH}")

# COMMAND ----------

# MAGIC %md
# MAGIC ---
# MAGIC ## 6. Deploy
# MAGIC
# MAGIC Ultima etapa! Vamos:
# MAGIC 1. Disparar o deploy da app
# MAGIC 2. Acompanhar o progresso em tempo real
# MAGIC 3. Validar que a app esta respondendo
# MAGIC 4. Testar a criacao de um contexto

# COMMAND ----------

# --- Aguardar app compute ficar ativo ---
print(f"Aguardando compute da app '{APP_NAME}' ficar ativo...")
for attempt in range(40):
    try:
        app_status = w.api_client.do("GET", f"/api/2.0/apps/{APP_NAME}")
        compute_state = app_status.get("compute_status", {}).get("state", "UNKNOWN")
        if compute_state == "ACTIVE":
            print(f"  [OK] Compute ACTIVE!")
            break
        elif compute_state in ("ERROR", "FAILED"):
            raise Exception(f"Compute falhou: {compute_state}")
        else:
            print(f"  Estado: {compute_state} (tentativa {attempt+1}/40)")
    except Exception as e:
        if "falhou" in str(e).lower():
            raise
        print(f"  Verificando... ({e})")
    time.sleep(15)
else:
    raise Exception("Timeout: compute da app nao ficou ativo em 10 minutos.")

# --- Deploy ---
print(f"\nIniciando deploy da app '{APP_NAME}'...")
print(f"  Source: {source_path}")

try:
    deploy = w.api_client.do("POST", f"/api/2.0/apps/{APP_NAME}/deployments", body={
        "source_code_path": source_path,
        "mode": "SNAPSHOT"
    })
    deploy_id = deploy.get("deployment_id", "")
    print(f"  Deploy ID: {deploy_id}")
    print(f"  Status: {deploy.get('status', {}).get('state', 'N/A')}")
except Exception as e:
    raise Exception(f"Falha ao iniciar deploy: {e}")

# --- Acompanhar progresso ---
print(f"\nAcompanhando deploy...")
for attempt in range(40):
    time.sleep(15)
    try:
        status = w.api_client.do("GET", f"/api/2.0/apps/{APP_NAME}/deployments/{deploy_id}")
        state = status.get("status", {}).get("state", "UNKNOWN")
        message = status.get("status", {}).get("message", "")

        if state == "SUCCEEDED":
            print(f"\n  [OK] Deploy CONCLUIDO!")
            print(f"  Mensagem: {message}")
            break
        elif state == "FAILED":
            print(f"\n  [FALHOU] {message}")
            raise Exception(f"Deploy falhou: {message}")
        else:
            print(f"  [{state}] {message} ({attempt+1}/40)")
    except Exception as e:
        if "FALHOU" in str(e) or "falhou" in str(e):
            raise
        print(f"  Verificando... ({attempt+1}/40)")
else:
    print(f"\n  [!!] Timeout apos 10 minutos. Verifique no console: Compute > Apps > {APP_NAME}")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 6b. Validacao

# COMMAND ----------

# --- Validacao ---
print(f"Validando app...")
print(f"  URL: {app_url}")

# Testar via API interna (usando token do workspace)
import urllib.request
import ssl

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

headers_dict = w.config.authenticate()
token = headers_dict.get("Authorization", "").replace("Bearer ", "") if headers_dict else ""

tests = [
    ("GET /api/contexts", f"{app_url}/api/contexts"),
    ("GET /api/config", f"{app_url}/api/config"),
    ("GET /api/branding", f"{app_url}/api/branding"),
]

all_ok = True
for test_name, url in tests:
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as resp:
            data = resp.read().decode()
            status_code = resp.status
            print(f"  [OK] {test_name} -> {status_code} ({len(data)} bytes)")
    except Exception as e:
        print(f"  [!!] {test_name} -> {e}")
        all_ok = False

# Testar criacao de contexto
print(f"\n  Testando criacao de contexto...")
try:
    test_payload = json.dumps({
        "name": "__deploy_test__",
        "description": "Contexto de teste do deploy (pode excluir)",
        "categories": ["teste"],
        "scan_prompt": "Teste",
        "scan_fps": 0.2,
        "detail_fps": 1.0,
        "score_threshold": 4,
        "color": "#10B981",
        "dedup_window": 5
    }).encode()

    req = urllib.request.Request(
        f"{app_url}/api/contexts",
        data=test_payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as resp:
        result = json.loads(resp.read().decode())
        ctx_id = result.get("context_id", "")
        print(f"  [OK] Contexto criado! (id={ctx_id})")

    # Limpar contexto de teste
    req = urllib.request.Request(
        f"{app_url}/api/contexts/{ctx_id}",
        headers={"Authorization": f"Bearer {token}"},
        method="DELETE"
    )
    with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as resp:
        print(f"  [OK] Contexto de teste removido.")

except Exception as e:
    print(f"  [!!] Falha ao criar contexto: {e}")
    all_ok = False

# COMMAND ----------

# MAGIC %md
# MAGIC ---
# MAGIC ## Resumo do Deploy

# COMMAND ----------

print("=" * 60)
print("  DEPLOY COMPLETO - Databricks Scenic Crawler AI")
print("=" * 60)
print()
print(f"  App URL:          {app_url}")
print(f"  App Name:         {APP_NAME}")
print()
print(f"  Lakebase Project: {LAKEBASE_PROJECT}")
print(f"  Lakebase Host:    {lakebase_host}")
print(f"  Database:         {DATABASE_NAME}")
print(f"  PG User (SP):     {sp_client_id}")
print(f"  PG Password:      {DB_PASSWORD}")
print()
print(f"  Catalog:          {CATALOG_NAME}")
print(f"  Schema:           {SCHEMA_NAME}")
print(f"  Video Volume:     {VIDEO_VOLUME_PATH}")
print(f"  Thumbnail Volume: {THUMBNAIL_VOLUME_PATH}")
print()
print(f"  Modelo de Visao:  {VISION_MODEL}")
print(f"  Git Repo:         {GIT_REPO_URL}")
print()
print("=" * 60)
print("  PROXIMOS PASSOS:")
print("=" * 60)
print()
print(f"  1. Acesse a app: {app_url}")
print(f"  2. Va em Settings > Contexts e crie seu primeiro contexto")
print(f"  3. Va em Process Videos para analisar um video")
print()
print("  Para atualizar a app no futuro:")
print(f"  - Atualize o Git folder no workspace")
print(f"  - Re-execute o deploy (celula 6)")
print()
if all_ok:
    print("  STATUS: TUDO FUNCIONANDO!")
else:
    print("  STATUS: DEPLOY COM AVISOS - verifique os erros acima")

# COMMAND ----------

# MAGIC %md
# MAGIC ---
# MAGIC ## Troubleshooting
# MAGIC
# MAGIC | Problema | Solucao |
# MAGIC |----------|---------|
# MAGIC | **App nao inicia** | Verifique os logs em Compute > Apps > Logs. Geralmente e problema de conexao com o Lakebase. |
# MAGIC | **"password authentication failed"** | O Service Principal nao tem role no PG. Re-execute a celula 5b. |
# MAGIC | **"column does not exist"** | Tabela desatualizada. Re-execute a celula 3 para adicionar colunas faltantes. |
# MAGIC | **"relation does not exist"** | Tabelas nao foram criadas. Re-execute a celula 3. |
# MAGIC | **Videos nao fazem upload** | Verifique se os Volumes existem e o SP tem acesso. |
# MAGIC | **FMAPI erro** | Verifique se o modelo `databricks-llama-4-maverick` esta disponivel em Serving > Endpoints. |
# MAGIC | **App retorna 401** | Token expirado. Faca login novamente no workspace. |
# MAGIC
# MAGIC ### Para re-deploy apos atualizar o codigo:
# MAGIC
# MAGIC Basta re-executar as celulas 5c (gerar app.yaml) e 6 (deploy).
# MAGIC Os dados no Lakebase e Volumes sao preservados entre deploys.
