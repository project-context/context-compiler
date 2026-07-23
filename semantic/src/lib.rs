//! Semantic relations between canonical Facts.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod catalog;
mod memory;
mod model;
mod policy;
mod store;

pub use catalog::SemanticCatalogReader;
pub use catalog::SemanticQuery;
pub use memory::MemorySemanticStore;
pub use model::SemanticEdge;
pub use model::SemanticRelation;
pub use policy::RelationPolicy;
pub use store::SemanticError;
pub use store::SemanticFuture;
pub use store::SemanticReader;
pub use store::SemanticResult;
pub use store::SemanticStore;

#[cfg(test)]
#[path = "semantic_tests.rs"]
mod tests;
