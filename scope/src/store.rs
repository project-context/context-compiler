use std::future::Future;
use std::pin::Pin;

use thiserror::Error;

use crate::Scope;
use crate::ScopeAssignment;
use crate::ScopeBlock;
use crate::ScopeDecision;
use crate::ScopeDimension;
use crate::ScopeRelation;

#[derive(Debug, Error)]
pub enum ScopeError {
    #[error("scope store failed: {0}")]
    Store(String),
}

pub type ScopeResult<T> = Result<T, ScopeError>;
pub type ScopeFuture<'a, T> = Pin<Box<dyn Future<Output = ScopeResult<T>> + Send + 'a>>;

pub trait ScopeReader: Send + Sync {
    fn list_dimensions(&self) -> ScopeFuture<'_, Vec<ScopeDimension>>;
    fn list_scopes(&self) -> ScopeFuture<'_, Vec<Scope>>;
    fn list_assignments(&self) -> ScopeFuture<'_, Vec<ScopeAssignment>>;
    fn list_blocks(&self) -> ScopeFuture<'_, Vec<ScopeBlock>>;
    fn list_relations(&self) -> ScopeFuture<'_, Vec<ScopeRelation>>;
    fn list_decisions(&self) -> ScopeFuture<'_, Vec<ScopeDecision>>;
}

pub trait ScopeStore: ScopeReader {
    fn put_dimensions(&self, values: Vec<ScopeDimension>) -> ScopeFuture<'_, ()>;
    fn put_scopes(&self, values: Vec<Scope>) -> ScopeFuture<'_, ()>;
    fn put_assignments(&self, values: Vec<ScopeAssignment>) -> ScopeFuture<'_, ()>;
    fn put_blocks(&self, values: Vec<ScopeBlock>) -> ScopeFuture<'_, ()>;
    fn put_relations(&self, values: Vec<ScopeRelation>) -> ScopeFuture<'_, ()>;
    fn put_decisions(&self, values: Vec<ScopeDecision>) -> ScopeFuture<'_, ()>;
}
