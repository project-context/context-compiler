use context_protocol::EntityRef;
use context_protocol::RevisionRef;
use context_source::NormalizedSource;
use context_source::NormalizedSourceQuery;
use context_source::SnapshotQuery;
use context_source::SourceCatalogReader;
use context_source::SourceError;
use context_source::SourceFuture;
use context_source::SourceQuery;
use context_source::SourceReader;
use context_source::SourceRecord;
use context_source::SourceSnapshot;
use context_source::SourceStore;

use crate::SqliteStore;

impl SourceCatalogReader for SqliteStore {
    fn page_sources(
        &self,
        query: SourceQuery,
    ) -> SourceFuture<'_, context_protocol::Page<SourceRecord>> {
        Box::pin(async move {
            let mut equals = Vec::new();
            if let Some(format) = query.format {
                equals.push(("format".to_owned(), format.as_str().to_owned()));
            }
            if let Some(status) = query.access_status {
                equals.push((
                    "accessStatus".to_owned(),
                    json_string(status).map_err(error)?,
                ));
            }
            self.page_records(
                "source_record",
                &query.page,
                false,
                equals,
                query
                    .text
                    .map(|value| (vec!["title".to_owned(), "uri".to_owned()], value)),
            )
            .await
            .map_err(error)
        })
    }

    fn page_snapshots(
        &self,
        query: SnapshotQuery,
    ) -> SourceFuture<'_, context_protocol::Page<SourceSnapshot>> {
        Box::pin(async move {
            let freshness = query.freshness.or((query.revision_mode
                == context_protocol::RevisionMode::Current)
                .then_some(context_protocol::Freshness::Current));
            let equals = freshness
                .map(|value| {
                    Ok(vec![(
                        "freshness".to_owned(),
                        json_string(value).map_err(error)?,
                    )])
                })
                .transpose()?
                .unwrap_or_default();
            self.page_records("source_snapshot", &query.page, true, equals, None)
                .await
                .map_err(error)
        })
    }

    fn page_normalized(
        &self,
        query: NormalizedSourceQuery,
    ) -> SourceFuture<'_, context_protocol::Page<NormalizedSource>> {
        Box::pin(async move {
            let mut equals = Vec::new();
            let freshness = query.freshness.or((query.revision_mode
                == context_protocol::RevisionMode::Current)
                .then_some(context_protocol::Freshness::Current));
            if let Some(value) = freshness {
                equals.push(("freshness".to_owned(), json_string(value).map_err(error)?));
            }
            if let Some(value) = query.format {
                equals.push(("format".to_owned(), value.as_str().to_owned()));
            }
            if let Some(value) = query.normalizer_id {
                equals.push(("normalizerId".to_owned(), value));
            }
            self.page_records("normalized_source", &query.page, true, equals, None)
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

fn error(value: impl std::fmt::Display) -> SourceError {
    SourceError::Store(value.to_string())
}

impl SourceReader for SqliteStore {
    fn get_source(&self, entity_ref: &EntityRef) -> SourceFuture<'_, Option<SourceRecord>> {
        let id = entity_ref.id.clone();
        Box::pin(async move {
            self.get_record("source_record", &id, "")
                .await
                .map_err(error)
        })
    }

    fn get_snapshot(&self, revision_ref: &RevisionRef) -> SourceFuture<'_, Option<SourceSnapshot>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            self.get_record(
                "source_snapshot",
                &revision_ref.entity.id,
                &revision_ref.revision,
            )
            .await
            .map_err(error)
        })
    }

    fn get_normalized(
        &self,
        revision_ref: &RevisionRef,
    ) -> SourceFuture<'_, Option<NormalizedSource>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            self.get_record(
                "normalized_source",
                &revision_ref.entity.id,
                &revision_ref.revision,
            )
            .await
            .map_err(error)
        })
    }

    fn list_sources(&self) -> SourceFuture<'_, Vec<SourceRecord>> {
        Box::pin(async move { self.list_records("source_record").await.map_err(error) })
    }

    fn list_snapshots(&self) -> SourceFuture<'_, Vec<SourceSnapshot>> {
        Box::pin(async move { self.list_records("source_snapshot").await.map_err(error) })
    }

    fn list_normalized(&self) -> SourceFuture<'_, Vec<NormalizedSource>> {
        Box::pin(async move { self.list_records("normalized_source").await.map_err(error) })
    }
}

impl SourceStore for SqliteStore {
    fn put_source(&self, source: SourceRecord) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            self.put_record("source_record", &source.entity_ref.id, "", &source)
                .await
                .map_err(error)
        })
    }

    fn put_snapshot(&self, snapshot: SourceSnapshot) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            self.put_record(
                "source_snapshot",
                &snapshot.revision_ref.entity.id,
                &snapshot.revision_ref.revision,
                &snapshot,
            )
            .await
            .map_err(error)
        })
    }

    fn put_normalized(&self, normalized: NormalizedSource) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            self.put_record(
                "normalized_source",
                &normalized.revision_ref.entity.id,
                &normalized.revision_ref.revision,
                &normalized,
            )
            .await
            .map_err(error)
        })
    }

    fn commit_normalization(
        &self,
        source: SourceRecord,
        snapshot: SourceSnapshot,
        normalized: NormalizedSource,
    ) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            let mut transaction = self.pool.begin().await.map_err(error)?;
            put_in_transaction(
                &mut transaction,
                "source_record",
                &source.entity_ref.id,
                "",
                &source,
            )
            .await
            .map_err(error)?;
            put_in_transaction(
                &mut transaction,
                "source_snapshot",
                &snapshot.revision_ref.entity.id,
                &snapshot.revision_ref.revision,
                &snapshot,
            )
            .await
            .map_err(error)?;
            put_in_transaction(
                &mut transaction,
                "normalized_source",
                &normalized.revision_ref.entity.id,
                &normalized.revision_ref.revision,
                &normalized,
            )
            .await
            .map_err(error)?;
            transaction.commit().await.map_err(error)?;
            Ok(())
        })
    }

    fn normalizer_rebuild_required(&self) -> SourceFuture<'_, bool> {
        Box::pin(async move {
            let value = sqlx::query_scalar::<_, String>(
                "SELECT state_value FROM compiler_state WHERE state_key = ?1",
            )
            .bind("normalizer_protocol_v1_rebuild_required")
            .fetch_optional(&self.pool)
            .await
            .map_err(error)?;
            Ok(value.as_deref() == Some("true"))
        })
    }

    fn mark_normalizer_rebuild_complete(&self) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            sqlx::query(
                "INSERT INTO compiler_state (state_key, state_value) VALUES (?1, 'false') \
                 ON CONFLICT(state_key) DO UPDATE SET state_value = 'false', \
                 updated_at = CURRENT_TIMESTAMP",
            )
            .bind("normalizer_protocol_v1_rebuild_required")
            .execute(&self.pool)
            .await
            .map_err(error)?;
            Ok(())
        })
    }
}

async fn put_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    kind: &str,
    entity_id: &str,
    revision: &str,
    value: &impl serde::Serialize,
) -> crate::SqliteStoreResult<()> {
    let payload = serde_json::to_string(value)?;
    sqlx::query(
        "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(record_kind, entity_id, revision) DO UPDATE SET \
         payload = excluded.payload, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(kind)
    .bind(entity_id)
    .bind(revision)
    .bind(payload)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}
