CREATE TABLE IF NOT EXISTS compiler_state (
    state_key TEXT PRIMARY KEY NOT NULL,
    state_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS archived_canonical_records (
    protocol_generation TEXT NOT NULL,
    record_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    payload TEXT NOT NULL,
    archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (protocol_generation, record_kind, entity_id, revision)
);

INSERT INTO compiler_state (state_key, state_value)
SELECT 'normalizer_protocol_v1_rebuild_required', 'true'
WHERE EXISTS (
    SELECT 1 FROM canonical_records
    WHERE record_kind = 'normalized_source'
      AND json_type(payload, '$.content') IS NOT NULL
)
ON CONFLICT(state_key) DO UPDATE SET
    state_value = excluded.state_value,
    updated_at = CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO archived_canonical_records (
    protocol_generation, record_kind, entity_id, revision, payload
)
SELECT 'normalizer_v0', record_kind, entity_id, revision, payload
FROM canonical_records
WHERE EXISTS (
    SELECT 1 FROM canonical_records AS normalized
    WHERE normalized.record_kind = 'normalized_source'
      AND json_type(normalized.payload, '$.content') IS NOT NULL
)
AND record_kind IN (
    'normalized_source',
    'structure_build',
    'structure_unit',
    'evidence_build',
    'evidence_record',
    'fact_build',
    'fact_revision',
    'semantic_edge'
);

DELETE FROM canonical_records
WHERE record_kind IN (
    'normalized_source',
    'structure_build',
    'structure_unit',
    'evidence_build',
    'evidence_record',
    'fact_build',
    'fact_revision',
    'semantic_edge'
)
AND EXISTS (
    SELECT 1 FROM compiler_state
    WHERE state_key = 'normalizer_protocol_v1_rebuild_required'
      AND state_value = 'true'
);

DELETE FROM facts_fts;
DELETE FROM derived_text_fts;
