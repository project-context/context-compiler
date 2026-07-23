CREATE TABLE IF NOT EXISTS build_jobs (
    job_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS build_jobs_workspace_created_idx
    ON build_jobs(workspace_id, created_at_ms DESC, job_id);

CREATE TABLE IF NOT EXISTS build_job_events (
    job_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    workspace_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY(job_id, sequence),
    FOREIGN KEY(job_id) REFERENCES build_jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS build_job_events_replay_idx
    ON build_job_events(job_id, sequence);

CREATE TABLE IF NOT EXISTS review_audit (
    decision_id TEXT PRIMARY KEY NOT NULL,
    subject_kind TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    expected_status TEXT NOT NULL,
    decided_status TEXT NOT NULL,
    rationale TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(
    entity_id UNINDEXED,
    title,
    uri,
    tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS derived_text_fts USING fts5(
    record_kind UNINDEXED,
    entity_id UNINDEXED,
    revision UNINDEXED,
    content,
    tokenize = 'unicode61'
);
