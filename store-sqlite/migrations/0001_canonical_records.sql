CREATE TABLE IF NOT EXISTS canonical_records (
    record_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    revision TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (record_kind, entity_id, revision)
);

CREATE INDEX IF NOT EXISTS canonical_records_kind_idx
    ON canonical_records(record_kind, entity_id);

CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
    entity_id UNINDEXED,
    revision UNINDEXED,
    statement,
    tokenize = 'unicode61'
);

