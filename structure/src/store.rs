use std::future::Future;
use std::pin::Pin;

use context_protocol::EntityRef;
use context_protocol::Page;
use context_protocol::PageRequest;
use context_protocol::RevisionRef;
use context_protocol::page_by_key;
use context_source::FormatId;
use thiserror::Error;

use crate::StructureBuildOutput;
use crate::StructureBuildRecord;
use crate::StructureBuildRequest;
use crate::StructureCommit;
use crate::StructureRelationRecord;
use crate::StructureUnit;

#[derive(Debug, Error)]
pub enum StructureError {
    #[error("structure revision not found: {0}@{1}")]
    RevisionNotFound(String, String),
    #[error("unsupported source kind")]
    UnsupportedSource,
    #[error("structure build failed: {0}")]
    Build(String),
    #[error("structure store failed: {0}")]
    Store(String),
}

pub type StructureResult<T> = Result<T, StructureError>;
pub type StructureFuture<'a, T> = Pin<Box<dyn Future<Output = StructureResult<T>> + Send + 'a>>;

/// Processor-facing boundary that may create new Structure revisions.
pub trait StructureBuilder: Send + Sync {
    fn normalized_format(&self) -> FormatId;
    fn build(&self, request: StructureBuildRequest) -> StructureFuture<'_, StructureBuildOutput>;
}

/// Read-only Structure layer boundary.
pub trait StructureReader: Send + Sync {
    fn get_structure(
        &self,
        revision_ref: &RevisionRef,
    ) -> StructureFuture<'_, Option<StructureUnit>>;
    fn find_structure(
        &self,
        kind: Option<&str>,
        local_id: &str,
    ) -> StructureFuture<'_, Option<StructureUnit>>;
    fn list_structures(&self) -> StructureFuture<'_, Vec<StructureUnit>>;
    fn list_structures_for_source(
        &self,
        source: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureUnit>>;
    fn get_structure_build(
        &self,
        entity_ref: &EntityRef,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>>;
    fn get_structure_build_for_normalized(
        &self,
        normalized: &RevisionRef,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>>;
    fn get_structure_build_by_ref(
        &self,
        reference: &str,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>>;
    fn list_structure_units_for_build(
        &self,
        build: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureUnit>>;
    fn list_structure_relations_for_build(
        &self,
        build: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureRelationRecord>>;
    fn page_structure_units_for_build(
        &self,
        build: &RevisionRef,
        page: PageRequest,
        text: Option<String>,
    ) -> StructureFuture<'_, Page<StructureUnit>> {
        let build = build.clone();
        Box::pin(async move {
            let mut values = self.list_structure_units_for_build(&build).await?;
            if let Some(text) = text {
                let text = text.to_lowercase();
                values.retain(|unit| {
                    unit.label.to_lowercase().contains(&text)
                        || unit.text.to_lowercase().contains(&text)
                });
            }
            Ok(page_by_key(values, &page, |unit| {
                format!(
                    "{}@{}",
                    unit.revision_ref.entity.id, unit.revision_ref.revision
                )
            }))
        })
    }
    fn page_structure_relations_for_build(
        &self,
        build: &RevisionRef,
        page: PageRequest,
    ) -> StructureFuture<'_, Page<StructureRelationRecord>> {
        let build = build.clone();
        Box::pin(async move {
            let values = self.list_structure_relations_for_build(&build).await?;
            Ok(page_by_key(values, &page, |relation| {
                format!(
                    "{}@{}",
                    relation.revision_ref.entity.id, relation.revision_ref.revision
                )
            }))
        })
    }
}

/// Canonical Structure layer persistence boundary.
pub trait StructureStore: StructureReader {
    fn put_structure_build(&self, build: StructureBuildRecord) -> StructureFuture<'_, ()>;
    fn put_structures(&self, structures: Vec<StructureUnit>) -> StructureFuture<'_, ()>;
    fn put_structure_relations(
        &self,
        relations: Vec<StructureRelationRecord>,
    ) -> StructureFuture<'_, ()>;
    fn commit_structure(&self, commit: StructureCommit) -> StructureFuture<'_, ()>;
    fn structure_rebuild_required(&self) -> StructureFuture<'_, bool>;
    fn mark_structure_rebuild_complete(&self) -> StructureFuture<'_, ()>;
}
