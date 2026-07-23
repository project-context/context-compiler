use std::future::Future;
use std::pin::Pin;

use context_protocol::EntityRef;
use thiserror::Error;

use crate::SemanticEdge;

#[derive(Debug, Error)]
pub enum SemanticError {
    #[error("invalid semantic endpoint: {0}")]
    InvalidEndpoint(String),
    #[error("semantic store failed: {0}")]
    Store(String),
}

pub type SemanticResult<T> = Result<T, SemanticError>;
pub type SemanticFuture<'a, T> = Pin<Box<dyn Future<Output = SemanticResult<T>> + Send + 'a>>;

pub trait SemanticReader: Send + Sync {
    fn list_edges(&self) -> SemanticFuture<'_, Vec<SemanticEdge>>;
    fn adjacent(&self, fact_ref: &EntityRef) -> SemanticFuture<'_, Vec<SemanticEdge>>;
}

pub trait SemanticStore: SemanticReader {
    fn put_edges(&self, edges: Vec<SemanticEdge>) -> SemanticFuture<'_, ()>;
    fn mark_edges_stale(&self, fact_ref: &EntityRef) -> SemanticFuture<'_, u64>;
}
