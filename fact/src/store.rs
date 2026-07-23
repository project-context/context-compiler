use std::future::Future;
use std::pin::Pin;

use context_protocol::EntityRef;
use context_protocol::RevisionRef;
use thiserror::Error;

use crate::FactBuildOutput;
use crate::FactBuildRecord;
use crate::FactBuildRequest;
use crate::FactRevision;

#[derive(Debug, Error)]
pub enum FactError {
    #[error("fact build failed: {0}")]
    Build(String),
    #[error("fact store failed: {0}")]
    Store(String),
}

pub type FactResult<T> = Result<T, FactError>;
pub type FactFuture<'a, T> = Pin<Box<dyn Future<Output = FactResult<T>> + Send + 'a>>;

pub trait FactBuilder: Send + Sync {
    fn build(&self, request: FactBuildRequest) -> FactFuture<'_, FactBuildOutput>;
}

pub trait FactReader: Send + Sync {
    fn get_fact(&self, revision_ref: &RevisionRef) -> FactFuture<'_, Option<FactRevision>>;
    fn list_facts(&self) -> FactFuture<'_, Vec<FactRevision>>;
    fn list_facts_for_evidence(
        &self,
        evidence_ref: &RevisionRef,
    ) -> FactFuture<'_, Vec<FactRevision>>;
    fn get_fact_build(&self, entity_ref: &EntityRef) -> FactFuture<'_, Option<FactBuildRecord>>;
}

pub trait FactStore: FactReader {
    fn put_fact_build(&self, build: FactBuildRecord) -> FactFuture<'_, ()>;
    fn put_facts(&self, facts: Vec<FactRevision>) -> FactFuture<'_, ()>;
}
