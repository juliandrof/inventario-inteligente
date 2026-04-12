-- DBXSC AI - PostgreSQL (Lakebase) Schema
-- Run this against the Lakebase database

CREATE TABLE IF NOT EXISTS videos (
    video_id        BIGINT PRIMARY KEY,
    filename        VARCHAR(500) NOT NULL,
    volume_path     VARCHAR(1000) NOT NULL,
    file_size_bytes BIGINT,
    duration_seconds DOUBLE PRECISION,
    fps             DOUBLE PRECISION,
    resolution      VARCHAR(50),
    upload_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    progress_pct    DOUBLE PRECISION DEFAULT 0,
    source          VARCHAR(20),
    uploaded_by     VARCHAR(200),
    error_message   TEXT
);

CREATE TABLE IF NOT EXISTS analysis_results (
    result_id          BIGINT PRIMARY KEY,
    video_id           BIGINT NOT NULL REFERENCES videos(video_id),
    analysis_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    scores_json        TEXT NOT NULL,
    overall_risk       DOUBLE PRECISION,
    total_detections   INTEGER,
    scan_fps           DOUBLE PRECISION,
    detail_fps         DOUBLE PRECISION,
    model_used         VARCHAR(200),
    config_snapshot    TEXT
);

CREATE TABLE IF NOT EXISTS detections (
    detection_id   BIGINT PRIMARY KEY,
    video_id       BIGINT NOT NULL REFERENCES videos(video_id),
    result_id      BIGINT NOT NULL REFERENCES analysis_results(result_id),
    timestamp_sec  DOUBLE PRECISION NOT NULL,
    category       VARCHAR(100) NOT NULL,
    score          INTEGER NOT NULL,
    confidence     DOUBLE PRECISION,
    ai_description TEXT,
    thumbnail_path VARCHAR(500),
    frame_index    BIGINT,
    review_status  VARCHAR(20) DEFAULT 'PENDING',
    reviewed_by    VARCHAR(200),
    reviewed_at    TIMESTAMP,
    reviewer_notes TEXT
);

CREATE TABLE IF NOT EXISTS processing_log (
    log_id              BIGINT PRIMARY KEY,
    video_id            BIGINT NOT NULL REFERENCES videos(video_id),
    volume_path         VARCHAR(1000) NOT NULL,
    file_hash           VARCHAR(64),
    processed_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    status              VARCHAR(20) NOT NULL,
    processing_time_sec DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS configurations (
    config_id    BIGINT PRIMARY KEY,
    config_key   VARCHAR(200) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    description  TEXT,
    updated_at   TIMESTAMP DEFAULT NOW(),
    updated_by   VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS branding (
    setting_id    BIGINT PRIMARY KEY,
    setting_key   VARCHAR(200) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_log (
    review_log_id    BIGINT PRIMARY KEY,
    detection_id     BIGINT NOT NULL REFERENCES detections(detection_id),
    video_id         BIGINT NOT NULL REFERENCES videos(video_id),
    action           VARCHAR(20) NOT NULL,
    previous_status  VARCHAR(20),
    reviewer         VARCHAR(200) NOT NULL,
    notes            TEXT,
    action_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_detections_video ON detections(video_id);
CREATE INDEX IF NOT EXISTS idx_detections_review ON detections(review_status);
CREATE INDEX IF NOT EXISTS idx_analysis_video ON analysis_results(video_id);
CREATE INDEX IF NOT EXISTS idx_processing_log_path ON processing_log(volume_path);
