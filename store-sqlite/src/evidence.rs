use context_evidence::EvidenceBuildRecord;
use context_evidence::EvidenceCatalogReader;
use context_evidence::EvidenceError;
use context_evidence::EvidenceFuture;
use context_evidence::EvidenceQuery;
use context_evidence::EvidenceReader;
use context_evidence::EvidenceRecord;
use context_evidence::EvidenceStore;
use context_protocol::EntityRef;
use context_protocol::RevisionRef;

use crate::SqliteStore;

impl EvidenceCatalogReader for SqliteStore {
    fn page_evidence(
        &self,
        query: EvidenceQuery,
    ) -> EvidenceFuture<'_, context_protocol::Page<EvidenceRecord>> {
        Box::pin(async move {
            if let Some(structure_ref) = query.structure_ref {
                let mut values: Vec<EvidenceRecord> =
                    self.list_records("evidence_record").await.map_err(error)?;
                values.retain(|value| value.structure_refs.contains(&structure_ref));
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
                "evidence_record",
                &query.page,
                true,
                equals,
                query.text.map(|value| (vec!["excerpt".to_owned()], value)),
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

fn error(value: impl std::fmt::Display) -> EvidenceError {
    EvidenceError::Store(value.to_string())
}

impl EvidenceReader for SqliteStore {
    fn get_evidence(
        &self,
        revision_ref: &RevisionRef,
    ) -> EvidenceFuture<'_, Option<EvidenceRecord>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            self.get_record(
                "evidence_record",
                &revision_ref.entity.id,
                &revision_ref.revision,
            )
            .await
            .map_err(error)
        })
    }

    fn list_evidence(&self) -> EvidenceFuture<'_, Vec<EvidenceRecord>> {
        Box::pin(async move { self.list_records("evidence_record").await.map_err(error) })
    }

    fn list_evidence_for_structure(
        &self,
        structure_ref: &RevisionRef,
    ) -> EvidenceFuture<'_, Vec<EvidenceRecord>> {
        let structure_ref = structure_ref.clone();
        Box::pin(async move {
            let values: Vec<EvidenceRecord> =
                self.list_records("evidence_record").await.map_err(error)?;
            Ok(values
                .into_iter()
                .filter(|value| value.structure_refs.contains(&structure_ref))
                .collect())
        })
    }

    fn get_evidence_build(
        &self,
        entity_ref: &EntityRef,
    ) -> EvidenceFuture<'_, Option<EvidenceBuildRecord>> {
        let id = entity_ref.id.clone();
        Box::pin(async move {
            self.get_record("evidence_build", &id, "")
                .await
                .map_err(error)
        })
    }
}

impl EvidenceStore for SqliteStore {
    fn put_evidence_build(&self, build: EvidenceBuildRecord) -> EvidenceFuture<'_, ()> {
        Box::pin(async move {
            self.put_record("evidence_build", &build.entity_ref.id, "", &build)
                .await
                .map_err(error)
        })
    }

    fn put_evidence(&self, evidence: Vec<EvidenceRecord>) -> EvidenceFuture<'_, ()> {
        Box::pin(async move {
            for item in evidence {
                self.put_record(
                    "evidence_record",
                    &item.revision_ref.entity.id,
                    &item.revision_ref.revision,
                    &item,
                )
                .await
                .map_err(error)?;
            }
            Ok(())
        })
    }
}
