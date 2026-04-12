# Prompt para recriar o Databricks Scenic Crawler AI

Copie e cole o texto abaixo em uma nova conversa do Claude Code:

---

Crie um Databricks App chamado **Databricks Scenic Crawler AI** — uma aplicacao generica de analise de video por IA que extrai frames e os envia a um modelo de visao (FMAPI) para deteccao configuravel.

## Stack
- **Backend**: Python, FastAPI, Uvicorn, psycopg2 (Lakebase/PostgreSQL), OpenCV-headless, Databricks SDK
- **Frontend**: React 19, Vite 8, CSS puro (variaveis CSS para tema dinamico), sem libs externas
- **IA**: Databricks FMAPI — modelo configuravel (default: databricks-llama-4-maverick). Chamadas HTTP diretas (urllib) ao serving endpoint, nao via SDK
- **DB**: Databricks Lakebase (PostgreSQL gerenciado). Auto-criacao de tabelas no startup
- **Storage**: Databricks Volumes para videos e thumbnails
- **Deploy**: Databricks Apps (app.yaml com env vars prefixadas DBXSC_AI_)

## Conceito central: Contextos
Contextos sao perfis de analise nomeados. Cada um tem: nome, descricao, cor da tag (hex), categorias de deteccao (lista flexivel), prompt de analise (texto livre enviado ao modelo), FPS de scan, FPS de detalhe, threshold (0-10). Exemplos: "Motorista" (fadiga, distracao), "Seguranca do Trabalho" (epi_ausente, postura_inadequada). O contexto e obrigatorio para processar videos.

## Tabelas PostgreSQL (auto-criadas no startup)
- **videos**: video_id (BIGINT PK), filename, volume_path, file_size_bytes, duration_seconds, fps, resolution, upload_timestamp, status (PENDING/SCANNING/ANALYZING/COMPLETED/FAILED), progress_pct, source (UPLOAD/BATCH/STREAM), context_id, context_name, context_color, error_message
- **analysis_results**: result_id PK, video_id FK, analysis_timestamp, scores_json (JSON flexivel com score por categoria), overall_risk, total_detections, scan_fps, model_used, config_snapshot
- **detections**: detection_id PK, video_id FK, result_id FK, timestamp_sec, category, score (0-10), confidence, ai_description (portugues), thumbnail_path, frame_index, review_status (PENDING/CONFIRMED/REJECTED), reviewer_notes
- **processing_log**: log_id PK, video_id FK, volume_path, processed_at, status — para skip de videos ja processados em batch
- **contexts**: context_id PK, name UNIQUE, description, categories (JSON), scan_prompt, scan_fps, detail_fps, score_threshold, color (hex), created_at, updated_at
- **configurations**: config_id PK, config_key UNIQUE, config_value — para modelo de IA e configs legadas
- **branding**: setting_id PK, setting_key UNIQUE, setting_value — cores e logo
- **review_log**: review_log_id PK, detection_id FK, video_id FK, action, previous_status, reviewer, notes, action_timestamp

## Pipeline de analise (single-pass)
1. OpenCV extrai frames na taxa do contexto (scan_fps, default 0.2 = 1 frame/5s)
2. Redimensiona para max 512px largura, encoda JPEG
3. Envia base64 ao FMAPI com o prompt do contexto + lista de categorias
4. Modelo retorna JSON: score 0-10 por categoria + description (PT) + confidence
5. Se max_score >= threshold: salva thumbnail no Volume, cria deteccao
6. Progresso atualizado no banco a cada frame

## 3 metodos de processamento
1. **Upload Local**: wizard (seleciona contexto -> drag-and-drop -> sucesso). Thread em background
2. **Batch**: wizard (seleciona contexto -> navega Unity Catalog ou digita path do Volume -> inicia). BatchManager singleton com threading. SSE para progresso. Skip de ja processados via processing_log
3. **Streaming**: menu separado. Aceita URL (RTSP/RTMP/HTTP/HLS) ou path de Volume (mock). Processa em janelas de N segundos (configuravel, default 60). Cada janela vira um video entry. StreamManager singleton. SSE para progresso. Botao stop

## Paginas do frontend (SPA com routing por estado, key para remount no click do menu)
1. **Dashboard**: KPIs (videos, deteccoes, pendentes, confirmadas, score medio). Graficos de categoria e distribuicao. Filtros: contexto (dropdown) + periodo (30/60/90 dias/personalizar)
2. **Processar Videos**: wizard 3 passos — contexto (cards) -> metodo (upload ou batch) -> execucao
3. **Streaming**: lista de streams com expand por janela + "Novo Streaming" (wizard: contexto -> URL + janela -> start). LIVE indicator pulsante. Stop button
4. **Processamento**: tabela de videos (sem STREAM). Filtros: pesquisa + status + contexto. Colunas: arquivo, contexto (badge colorido), origem, status, duracao, score, deteccoes, acoes
5. **Revisao**: cards de video com thumbnail da maior deteccao, score badge, contexto badge colorido. Filtros: pesquisa + contexto. Detalhe: player HTML5 + thumbnails clicaveis + confirmar/rejeitar por deteccao + notas. Auto-refresh 3s durante processamento
6. **Relatorio**: paginado server-side (20/pagina). Filtros: pesquisa, contexto, score (todos/com deteccoes/limpos/alto score), periodo (30/60/90/custom). Colunas: arquivo, contexto, origem, duracao, score, deteccoes, categorias, data. Detalhe com player + deteccoes revisadas separadas de pendentes
7. **Configuracoes** (3 abas):
   - Contextos: CRUD com editor de categorias (tags), prompt (textarea), parametros com tooltips (i), color picker com preview
   - Modelo de IA: campo de endpoint name, exemplos de modelos, salva em configurations table
   - Visual/Marca: upload de logo, 4 color pickers (primaria, secundaria, destaque, sidebar), preview ao vivo

## i18n
React Context com useI18n() hook. 3 idiomas: PT (default), EN, ES. ~200+ chaves. Seletor no sidebar (botoes PT/EN/ES). Persistido em localStorage (dbxsc_ai_lang). Todas as paginas traduzidas: titulos, labels, botoes, placeholders, tooltips, mensagens vazias

## Componentes reutilizaveis
- **ContextBadge**: renderiza tag com cor do contexto (props: name, color, style)
- **Tooltip**: icone (i) com title text no hover

## Visual
- Sidebar fixa 260px com logo SVG "Databricks Scenic Crawler AI" + menu + seletor de idioma + footer
- CSS variables para tema dinamico (--dbxsc-primary, --dbxsc-dark, --dbxsc-accent, --dbxsc-sidebar)
- Cores default: azul (#2563EB), dark (#1E293B)
- Responsivo (sidebar colapsa em mobile)
- Sem emoji no codigo

## Env vars (app.yaml)
DBXSC_AI_DB_HOST, DBXSC_AI_DB_PORT (5432), DBXSC_AI_DB_NAME, DBXSC_AI_DB_SCHEMA (public), DBXSC_AI_LAKEBASE_PROJECT, DBXSC_AI_LAKEBASE_BRANCH (production), DBXSC_AI_LAKEBASE_ENDPOINT (primary), DBXSC_AI_DB_USER, DBXSC_AI_DB_PASSWORD, FMAPI_MODEL, VIDEO_VOLUME, THUMBNAIL_VOLUME

## Autenticacao Lakebase
Preferir credenciais nativas PG via env vars. Fallback: gerar database credential via REST API POST /api/2.0/postgres/credentials. Auto-criar database e tabelas no startup.

Crie a aplicacao completa, deploy no e2demo, crie um repo privado no GitHub com README em ingles explicando toda a tecnologia.

---
