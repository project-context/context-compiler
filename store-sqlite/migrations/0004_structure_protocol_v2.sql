INSERT INTO compiler_state (state_key, state_value)
SELECT 'structure_protocol_v2_rebuild_required', 'true'
WHERE EXISTS (
    SELECT 1 FROM canonical_records
    WHERE record_kind IN ('structure_build', 'structure_unit')
)
ON CONFLICT(state_key) DO UPDATE SET
    state_value = excluded.state_value,
    updated_at = CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO archived_canonical_records (
    protocol_generation, record_kind, entity_id, revision, payload
)
SELECT 'structure_v1', record_kind, entity_id, revision, payload
FROM canonical_records
WHERE record_kind IN (
    'structure_build',
    'structure_unit',
    'structure_relation',
    'evidence_build',
    'evidence_record',
    'fact_build',
    'fact_revision',
    'semantic_edge'
);

DELETE FROM canonical_records
WHERE record_kind IN (
    'structure_build',
    'structure_unit',
    'structure_relation',
    'evidence_build',
    'evidence_record',
    'fact_build',
    'fact_revision',
    'semantic_edge'
);

UPDATE canonical_records
SET payload = json_set(payload, '$.reviewStatus', 'orphaned')
WHERE record_kind IN ('scope_assignment', 'scope_block')
  AND json_extract(payload, '$.reviewStatus') IN ('candidate', 'confirmed')
  AND json_extract(payload, '$.target.entity.layer') IN ('structure', 'evidence', 'fact');

DELETE FROM facts_fts;
DELETE FROM derived_text_fts;

CREATE INDEX IF NOT EXISTS structure_build_normalized_idx
    ON canonical_records(
        json_extract(payload, '$.normalizedSource.entity.id'),
        json_extract(payload, '$.normalizedSource.revision')
    )
    WHERE record_kind = 'structure_build';

CREATE INDEX IF NOT EXISTS structure_unit_build_idx
    ON canonical_records(
        json_extract(payload, '$.buildRef.entity.id'),
        json_extract(payload, '$.buildRef.revision')
    )
    WHERE record_kind = 'structure_unit';

CREATE INDEX IF NOT EXISTS structure_relation_build_idx
    ON canonical_records(
        json_extract(payload, '$.buildRef.entity.id'),
        json_extract(payload, '$.buildRef.revision')
    )
    WHERE record_kind = 'structure_relation';
