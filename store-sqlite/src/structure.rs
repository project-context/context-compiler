use context_protocol::EntityRef;
use context_protocol::Page;
use context_protocol::PageRequest;
use context_protocol::RevisionRef;
use context_structure::StructureBuildRecord;
use context_structure::StructureCatalogReader;
use context_structure::StructureCommit;
use context_structure::StructureError;
use context_structure::StructureFuture;
use context_structure::StructureQuery;
use context_structure::StructureReader;
use context_structure::StructureRelationRecord;
use context_structure::StructureStore;
use context_structure::StructureUnit;

use crate::SqliteStore;

impl StructureCatalogReader for SqliteStore {
    fn page_structures(
        &self,
        query: StructureQuery,
    ) -> StructureFuture<'_, context_protocol::Page<StructureUnit>> {
        Box::pin(async move {
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
            if let Some(value) = query.source_snapshot {
                equals.push(("trace.sourceSnapshot.entity.id".to_owned(), value.entity.id));
                equals.push(("trace.sourceSnapshot.revision".to_owned(), value.revision));
            }
            self.page_records(
                "structure_unit",
                &query.page,
                true,
                equals,
                query
                    .text
                    .map(|value| (vec!["label".to_owned(), "text".to_owned()], value)),
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

fn error(value: impl std::fmt::Display) -> StructureError {
    StructureError::Store(value.to_string())
}

impl StructureReader for SqliteStore {
    fn get_structure(
        &self,
        revision_ref: &RevisionRef,
    ) -> StructureFuture<'_, Option<StructureUnit>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            self.get_record(
                "structure_unit",
                &revision_ref.entity.id,
                &revision_ref.revision,
            )
            .await
            .map_err(error)
        })
    }

    fn find_structure(
        &self,
        kind: Option<&str>,
        local_id: &str,
    ) -> StructureFuture<'_, Option<StructureUnit>> {
        let kind = kind.map(str::to_owned);
        let local_id = local_id.to_owned();
        Box::pin(async move {
            let payload = sqlx::query_scalar::<_, String>(
                "SELECT payload FROM canonical_records \
                 WHERE record_kind = 'structure_unit' \
                   AND (?1 IS NULL OR json_extract(payload, '$.kind') = ?1) \
                   AND (entity_id = ?2 OR revision = ?2 OR json_extract(payload, '$.stableKey') = ?2) \
                 ORDER BY updated_at DESC LIMIT 1",
            )
            .bind(kind)
            .bind(local_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(error)?;
            payload
                .map(|payload| serde_json::from_str(&payload).map_err(error))
                .transpose()
        })
    }

    fn list_structures(&self) -> StructureFuture<'_, Vec<StructureUnit>> {
        Box::pin(async move { self.list_records("structure_unit").await.map_err(error) })
    }

    fn list_structures_for_source(
        &self,
        source: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureUnit>> {
        let source = source.clone();
        Box::pin(async move {
            let values: Vec<StructureUnit> =
                self.list_records("structure_unit").await.map_err(error)?;
            Ok(values
                .into_iter()
                .filter(|value| value.trace.source_snapshot == source)
                .collect())
        })
    }

    fn get_structure_build(
        &self,
        entity_ref: &EntityRef,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>> {
        let id = entity_ref.id.clone();
        Box::pin(async move {
            self.get_record("structure_build", &id, "")
                .await
                .map_err(error)
        })
    }

    fn get_structure_build_for_normalized(
        &self,
        normalized: &RevisionRef,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>> {
        let normalized = normalized.clone();
        Box::pin(async move {
            let values: Vec<StructureBuildRecord> =
                self.list_records("structure_build").await.map_err(error)?;
            Ok(values
                .into_iter()
                .find(|build| build.normalized_source == normalized))
        })
    }

    fn get_structure_build_by_ref(
        &self,
        reference: &str,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>> {
        let reference = reference.to_owned();
        Box::pin(async move {
            let payload = sqlx::query_scalar::<_, String>(
                "SELECT payload FROM canonical_records \
                 WHERE record_kind = 'structure_build' \
                   AND (entity_id = ?1 OR json_extract(payload, '$.revisionRef.revision') = ?1) \
                 ORDER BY updated_at DESC LIMIT 1",
            )
            .bind(reference)
            .fetch_optional(&self.pool)
            .await
            .map_err(error)?;
            payload
                .map(|payload| serde_json::from_str(&payload).map_err(error))
                .transpose()
        })
    }

    fn list_structure_units_for_build(
        &self,
        build: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureUnit>> {
        let build = build.clone();
        Box::pin(async move {
            let values: Vec<StructureUnit> =
                self.list_records("structure_unit").await.map_err(error)?;
            Ok(values
                .into_iter()
                .filter(|unit| unit.build_ref == build)
                .collect())
        })
    }

    fn list_structure_relations_for_build(
        &self,
        build: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureRelationRecord>> {
        let build = build.clone();
        Box::pin(async move {
            let values: Vec<StructureRelationRecord> = self
                .list_records("structure_relation")
                .await
                .map_err(error)?;
            Ok(values
                .into_iter()
                .filter(|relation| relation.build_ref == build)
                .collect())
        })
    }

    fn page_structure_units_for_build(
        &self,
        build: &RevisionRef,
        page: PageRequest,
        text: Option<String>,
    ) -> StructureFuture<'_, Page<StructureUnit>> {
        let build = build.clone();
        Box::pin(async move {
            self.page_records(
                "structure_unit",
                &page,
                true,
                vec![
                    ("buildRef.entity.id".to_owned(), build.entity.id),
                    ("buildRef.revision".to_owned(), build.revision),
                ],
                text.map(|value| (vec!["label".to_owned(), "text".to_owned()], value)),
            )
            .await
            .map_err(error)
        })
    }

    fn page_structure_relations_for_build(
        &self,
        build: &RevisionRef,
        page: PageRequest,
    ) -> StructureFuture<'_, Page<StructureRelationRecord>> {
        let build = build.clone();
        Box::pin(async move {
            self.page_records(
                "structure_relation",
                &page,
                true,
                vec![
                    ("buildRef.entity.id".to_owned(), build.entity.id),
                    ("buildRef.revision".to_owned(), build.revision),
                ],
                None,
            )
            .await
            .map_err(error)
        })
    }
}

impl StructureStore for SqliteStore {
    fn put_structure_build(&self, build: StructureBuildRecord) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            self.put_record("structure_build", &build.entity_ref.id, "", &build)
                .await
                .map_err(error)
        })
    }

    fn put_structures(&self, structures: Vec<StructureUnit>) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            for structure in structures {
                self.put_record(
                    "structure_unit",
                    &structure.revision_ref.entity.id,
                    &structure.revision_ref.revision,
                    &structure,
                )
                .await
                .map_err(error)?;
            }
            Ok(())
        })
    }

    fn put_structure_relations(
        &self,
        relations: Vec<StructureRelationRecord>,
    ) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            for relation in relations {
                self.put_record(
                    "structure_relation",
                    &relation.revision_ref.entity.id,
                    &relation.revision_ref.revision,
                    &relation,
                )
                .await
                .map_err(error)?;
            }
            Ok(())
        })
    }

    fn commit_structure(&self, commit: StructureCommit) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            let mut transaction = self.pool.begin().await.map_err(error)?;
            for stale in commit.stale {
                for kind in ["structure_unit", "structure_relation"] {
                    sqlx::query(
                        "UPDATE canonical_records SET payload = json_set(payload, '$.freshness', 'stale'), updated_at = CURRENT_TIMESTAMP WHERE record_kind = ?1 AND entity_id = ?2 AND revision = ?3",
                    )
                    .bind(kind)
                    .bind(&stale.entity.id)
                    .bind(&stale.revision)
                    .execute(&mut *transaction)
                    .await
                    .map_err(error)?;
                }
            }
            let build_payload = serde_json::to_string(&commit.build).map_err(error)?;
            sqlx::query(
                "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) VALUES ('structure_build', ?1, '', ?2) ON CONFLICT(record_kind, entity_id, revision) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP",
            )
            .bind(&commit.build.entity_ref.id)
            .bind(build_payload)
            .execute(&mut *transaction)
            .await
            .map_err(error)?;
            for unit in commit.units {
                let payload = serde_json::to_string(&unit).map_err(error)?;
                sqlx::query(
                    "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) VALUES ('structure_unit', ?1, ?2, ?3) ON CONFLICT(record_kind, entity_id, revision) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP",
                )
                .bind(&unit.revision_ref.entity.id)
                .bind(&unit.revision_ref.revision)
                .bind(payload)
                .execute(&mut *transaction)
                .await
                .map_err(error)?;
            }
            for relation in commit.relations {
                let payload = serde_json::to_string(&relation).map_err(error)?;
                sqlx::query(
                    "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) VALUES ('structure_relation', ?1, ?2, ?3) ON CONFLICT(record_kind, entity_id, revision) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP",
                )
                .bind(&relation.revision_ref.entity.id)
                .bind(&relation.revision_ref.revision)
                .bind(payload)
                .execute(&mut *transaction)
                .await
                .map_err(error)?;
            }
            transaction.commit().await.map_err(error)?;
            Ok(())
        })
    }

    fn structure_rebuild_required(&self) -> StructureFuture<'_, bool> {
        Box::pin(async move {
            let value = sqlx::query_scalar::<_, String>(
                "SELECT state_value FROM compiler_state WHERE state_key = ?1",
            )
            .bind("structure_protocol_v2_rebuild_required")
            .fetch_optional(&self.pool)
            .await
            .map_err(error)?;
            Ok(value.as_deref() == Some("true"))
        })
    }

    fn mark_structure_rebuild_complete(&self) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            sqlx::query(
                "INSERT INTO compiler_state (state_key, state_value) VALUES (?1, 'false') ON CONFLICT(state_key) DO UPDATE SET state_value = 'false', updated_at = CURRENT_TIMESTAMP",
            )
            .bind("structure_protocol_v2_rebuild_required")
            .execute(&self.pool)
            .await
            .map_err(error)?;
            Ok(())
        })
    }
}
