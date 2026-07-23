use std::future::Future;
use std::pin::Pin;

use context_protocol::EntityRef;
use context_protocol::RevisionRef;
use thiserror::Error;

use crate::NormalizedSource;
use crate::SourceRecord;
use crate::SourceSnapshot;

#[derive(Debug, Error)]
pub enum SourceError {
    #[error("source record not found: {0}")]
    RecordNotFound(String),
    #[error("source revision not found: {0}@{1}")]
    RevisionNotFound(String, String),
    #[error("source I/O failed: {0}")]
    Io(String),
    #[error("source store failed: {0}")]
    Store(String),
    #[error("unsupported source: {0}")]
    Unsupported(String),
    #[error("source decoding failed: {0}")]
    Decode(String),
    #[error("source normalization failed: {0}")]
    Normalization(String),
    #[error("source normalization configuration is invalid: {0}")]
    Configuration(String),
    #[error("source normalization was cancelled")]
    Cancelled,
}

pub type SourceResult<T> = Result<T, SourceError>;
pub type SourceFuture<'a, T> = Pin<Box<dyn Future<Output = SourceResult<T>> + Send + 'a>>;

/// Read-only Source layer boundary used by later layers and query runtime.
pub trait SourceReader: Send + Sync {
    fn get_source(&self, entity_ref: &EntityRef) -> SourceFuture<'_, Option<SourceRecord>>;
    fn get_snapshot(&self, revision_ref: &RevisionRef) -> SourceFuture<'_, Option<SourceSnapshot>>;
    fn get_normalized(
        &self,
        revision_ref: &RevisionRef,
    ) -> SourceFuture<'_, Option<NormalizedSource>>;
    fn list_sources(&self) -> SourceFuture<'_, Vec<SourceRecord>>;
    fn list_snapshots(&self) -> SourceFuture<'_, Vec<SourceSnapshot>>;
    fn list_normalized(&self) -> SourceFuture<'_, Vec<NormalizedSource>>;
}

/// Canonical Source layer persistence boundary.
pub trait SourceStore: SourceReader {
    fn put_source(&self, source: SourceRecord) -> SourceFuture<'_, ()>;
    fn put_snapshot(&self, snapshot: SourceSnapshot) -> SourceFuture<'_, ()>;
    fn put_normalized(&self, normalized: NormalizedSource) -> SourceFuture<'_, ()>;
    /// Atomically publishes one completed normalization boundary. Implementors
    /// must not make a partial Source/Snapshot/NormalizedSource set visible.
    fn commit_normalization(
        &self,
        source: SourceRecord,
        snapshot: SourceSnapshot,
        normalized: NormalizedSource,
    ) -> SourceFuture<'_, ()>;
    fn normalizer_rebuild_required(&self) -> SourceFuture<'_, bool>;
    fn mark_normalizer_rebuild_complete(&self) -> SourceFuture<'_, ()>;
}
