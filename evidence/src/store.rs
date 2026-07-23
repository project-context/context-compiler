use std::future::Future;
use std::pin::Pin;

use context_protocol::EntityRef;
use context_protocol::RevisionRef;
use thiserror::Error;

use crate::EvidenceBuildOutput;
use crate::EvidenceBuildRecord;
use crate::EvidenceBuildRequest;
use crate::EvidenceRecord;

#[derive(Debug, Error)]
pub enum EvidenceError {
    #[error("evidence build failed: {0}")]
    Build(String),
    #[error("evidence store failed: {0}")]
    Store(String),
}

pub type EvidenceResult<T> = Result<T, EvidenceError>;
pub type EvidenceFuture<'a, T> = Pin<Box<dyn Future<Output = EvidenceResult<T>> + Send + 'a>>;

pub trait EvidenceBuilder: Send + Sync {
    fn build(&self, request: EvidenceBuildRequest) -> EvidenceFuture<'_, EvidenceBuildOutput>;
}

pub trait EvidenceReader: Send + Sync {
    fn get_evidence(
        &self,
        revision_ref: &RevisionRef,
    ) -> EvidenceFuture<'_, Option<EvidenceRecord>>;
    fn list_evidence(&self) -> EvidenceFuture<'_, Vec<EvidenceRecord>>;
    fn list_evidence_for_structure(
        &self,
        structure_ref: &RevisionRef,
    ) -> EvidenceFuture<'_, Vec<EvidenceRecord>>;
    fn get_evidence_build(
        &self,
        entity_ref: &EntityRef,
    ) -> EvidenceFuture<'_, Option<EvidenceBuildRecord>>;
}

pub trait EvidenceStore: EvidenceReader {
    fn put_evidence_build(&self, build: EvidenceBuildRecord) -> EvidenceFuture<'_, ()>;
    fn put_evidence(&self, evidence: Vec<EvidenceRecord>) -> EvidenceFuture<'_, ()>;
}
