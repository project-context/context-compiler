//! Scope assignments, inheritance, blocking, and effective-scope evaluation.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod catalog;
mod engine;
mod memory;
mod model;
mod store;

pub use catalog::ScopeCatalogReader;
pub use catalog::ScopeQuery;
pub use engine::ScopeEngine;
pub use memory::MemoryScopeStore;
pub use model::AssignmentPurpose;
pub use model::ContextRole;
pub use model::DimensionCardinality;
pub use model::EffectiveScope;
pub use model::EffectiveScopeConflict;
pub use model::EffectiveScopeValue;
pub use model::Propagation;
pub use model::Scope;
pub use model::ScopeAssignment;
pub use model::ScopeBlock;
pub use model::ScopeDecision;
pub use model::ScopeDimension;
pub use model::ScopeRef;
pub use model::ScopeRelation;
pub use model::ScopeRelationKind;
pub use store::ScopeError;
pub use store::ScopeFuture;
pub use store::ScopeReader;
pub use store::ScopeResult;
pub use store::ScopeStore;

#[cfg(test)]
#[path = "scope_tests.rs"]
mod tests;
