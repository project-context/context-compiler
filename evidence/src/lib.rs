//! Storage-neutral Evidence layer contracts.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod catalog;
mod memory;
mod model;
mod store;

pub use catalog::EvidenceCatalogReader;
pub use catalog::EvidenceQuery;
pub use memory::MemoryEvidenceStore;
pub use model::EvidenceBuildOutput;
pub use model::EvidenceBuildRecord;
pub use model::EvidenceBuildRequest;
pub use model::EvidenceKind;
pub use model::EvidenceRecord;
pub use store::EvidenceBuilder;
pub use store::EvidenceError;
pub use store::EvidenceFuture;
pub use store::EvidenceReader;
pub use store::EvidenceResult;
pub use store::EvidenceStore;
