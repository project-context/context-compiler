//! Storage-neutral Fact layer contracts.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod catalog;
mod memory;
mod model;
mod store;

pub use catalog::FactCatalogReader;
pub use catalog::FactQuery;
pub use memory::MemoryFactStore;
pub use model::EvidenceRole;
pub use model::FactBuildOutput;
pub use model::FactBuildRecord;
pub use model::FactBuildRequest;
pub use model::FactEvidenceLink;
pub use model::FactKind;
pub use model::FactRevision;
pub use store::FactBuilder;
pub use store::FactError;
pub use store::FactFuture;
pub use store::FactReader;
pub use store::FactResult;
pub use store::FactStore;
