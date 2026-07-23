use context_scope::ScopeAssignment;
use context_scope::ScopeBlock;
use context_scope::ScopeDecision;
use context_scope::ScopeRelation;
use context_semantic::SemanticEdge;
use serde::Serialize;

use crate::SqliteStore;
use crate::SqliteStoreResult;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewAuditRecord {
    pub decision_id: String,
    pub subject_kind: String,
    pub subject_id: String,
    pub expected_status: String,
    pub decided_status: String,
    pub rationale: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReviewBatch {
    pub assignments: Vec<ScopeAssignment>,
    pub blocks: Vec<ScopeBlock>,
    pub relations: Vec<ScopeRelation>,
    pub edges: Vec<SemanticEdge>,
    pub decisions: Vec<ScopeDecision>,
    pub audit: Vec<ReviewAuditRecord>,
}

impl SqliteStore {
    /// Applies a complete review command in one SQLite transaction. Callers
    /// validate expected states before constructing the batch.
    pub async fn apply_review_batch(&self, batch: ReviewBatch) -> SqliteStoreResult<()> {
        let mut transaction = self.pool.begin().await?;
        for value in batch.assignments {
            put(&mut transaction, "scope_assignment", &value.id, &value).await?;
        }
        for value in batch.blocks {
            put(&mut transaction, "scope_block", &value.id, &value).await?;
        }
        for value in batch.relations {
            put(&mut transaction, "scope_relation", &value.id, &value).await?;
        }
        for value in batch.edges {
            put(&mut transaction, "semantic_edge", &value.id, &value).await?;
        }
        for value in batch.decisions {
            put(&mut transaction, "scope_decision", &value.id, &value).await?;
        }
        for value in batch.audit {
            sqlx::query(
                "INSERT INTO review_audit \
                 (decision_id, subject_kind, subject_id, expected_status, decided_status, rationale) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(value.decision_id)
            .bind(value.subject_kind)
            .bind(value.subject_id)
            .bind(value.expected_status)
            .bind(value.decided_status)
            .bind(value.rationale)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }
}

async fn put<T: Serialize>(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    kind: &str,
    id: &str,
    value: &T,
) -> SqliteStoreResult<()> {
    let payload = serde_json::to_string(value)?;
    sqlx::query(
        "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) \
         VALUES (?1, ?2, '', ?3) \
         ON CONFLICT(record_kind, entity_id, revision) DO UPDATE SET \
         payload = excluded.payload, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(kind)
    .bind(id)
    .bind(payload)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}
