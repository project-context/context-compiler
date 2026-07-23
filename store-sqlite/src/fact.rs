use context_fact::FactBuildRecord;
use context_fact::FactCatalogReader;
use context_fact::FactError;
use context_fact::FactFuture;
use context_fact::FactQuery;
use context_fact::FactReader;
use context_fact::FactRevision;
use context_fact::FactStore;
use context_protocol::EntityRef;
use context_protocol::RevisionRef;

use crate::SqliteStore;

impl FactCatalogReader for SqliteStore {
    fn page_facts(&self, query: FactQuery) -> FactFuture<'_, context_protocol::Page<FactRevision>> {
        Box::pin(async move {
            if let Some(evidence_ref) = query.evidence_ref {
                let mut values: Vec<FactRevision> =
                    self.list_records("fact_revision").await.map_err(error)?;
                values.retain(|value| {
                    value
                        .evidence
                        .iter()
                        .any(|link| link.evidence_ref == evidence_ref)
                });
                return Ok(context_protocol::page_by_key(
                    values,
                    &query.page,
                    |value| {
                        format!(
                            "{}@{}",
                            value.revision_ref.entity.id, value.revision_ref.revision
                        )
                    },
                ));
            }
            let mut equals = Vec::new();
            let freshness = query.freshness.or((query.revision_mode
                == context_protocol::RevisionMode::Current)
                .then_some(context_protocol::Freshness::Current));
            if let Some(value) = freshness {
                equals.push(("freshness".to_owned(), json_string(value).map_err(error)?));
            }
            if let Some(value) = query.kind {
                equals.push(("kind".to_owned(), json_string(value).map_err(error)?));
            }
            self.page_records(
                "fact_revision",
                &query.page,
                true,
                equals,
                query
                    .text
                    .map(|value| (vec!["statement".to_owned()], value)),
            )
            .await
            .map_err(error)
        })
    }
}

fn json_string(value: impl serde::Serialize) -> Result<String, serde_json::Error> {
    Ok(serde_json::to_value(value)?
        .as_str()
        .unwrap_or_default()
        .to_owned())
}

fn error(value: impl std::fmt::Display) -> FactError {
    FactError::Store(value.to_string())
}

impl FactReader for SqliteStore {
    fn get_fact(&self, revision_ref: &RevisionRef) -> FactFuture<'_, Option<FactRevision>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            self.get_record(
                "fact_revision",
                &revision_ref.entity.id,
                &revision_ref.revision,
            )
            .await
            .map_err(error)
        })
    }

    fn list_facts(&self) -> FactFuture<'_, Vec<FactRevision>> {
        Box::pin(async move { self.list_records("fact_revision").await.map_err(error) })
    }

    fn list_facts_for_evidence(
        &self,
        evidence_ref: &RevisionRef,
    ) -> FactFuture<'_, Vec<FactRevision>> {
        let evidence_ref = evidence_ref.clone();
        Box::pin(async move {
            let values: Vec<FactRevision> =
                self.list_records("fact_revision").await.map_err(error)?;
            Ok(values
                .into_iter()
                .filter(|fact| {
                    fact.evidence
                        .iter()
                        .any(|link| link.evidence_ref == evidence_ref)
                })
                .collect())
        })
    }

    fn get_fact_build(&self, entity_ref: &EntityRef) -> FactFuture<'_, Option<FactBuildRecord>> {
        let id = entity_ref.id.clone();
        Box::pin(async move { self.get_record("fact_build", &id, "").await.map_err(error) })
    }
}

impl FactStore for SqliteStore {
    fn put_fact_build(&self, build: FactBuildRecord) -> FactFuture<'_, ()> {
        Box::pin(async move {
            self.put_record("fact_build", &build.entity_ref.id, "", &build)
                .await
                .map_err(error)
        })
    }

    fn put_facts(&self, facts: Vec<FactRevision>) -> FactFuture<'_, ()> {
        Box::pin(async move {
            let mut transaction = self.pool.begin().await.map_err(error)?;
            for fact in facts {
                let payload = serde_json::to_string(&fact).map_err(error)?;
                sqlx::query(
                    "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) \
                     VALUES ('fact_revision', ?1, ?2, ?3) \
                     ON CONFLICT(record_kind, entity_id, revision) DO UPDATE SET \
                     payload = excluded.payload, updated_at = CURRENT_TIMESTAMP",
                )
                .bind(&fact.revision_ref.entity.id)
                .bind(&fact.revision_ref.revision)
                .bind(payload)
                .execute(&mut *transaction)
                .await
                .map_err(error)?;
                sqlx::query("DELETE FROM facts_fts WHERE entity_id = ?1 AND revision = ?2")
                    .bind(&fact.revision_ref.entity.id)
                    .bind(&fact.revision_ref.revision)
                    .execute(&mut *transaction)
                    .await
                    .map_err(error)?;
                sqlx::query(
                    "INSERT INTO facts_fts (entity_id, revision, statement) VALUES (?1, ?2, ?3)",
                )
                .bind(&fact.revision_ref.entity.id)
                .bind(&fact.revision_ref.revision)
                .bind(&fact.statement)
                .execute(&mut *transaction)
                .await
                .map_err(error)?;
            }
            transaction.commit().await.map_err(error)?;
            Ok(())
        })
    }
}
