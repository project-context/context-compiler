//! Shared, storage-neutral contracts used by every Context Compiler crate.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod build;
mod diagnostic;
mod ids;
mod page;
mod provenance;
mod status;

pub use build::BuildResult;
pub use diagnostic::Diagnostic;
pub use diagnostic::DiagnosticLevel;
pub use ids::AnyLayerRef;
pub use ids::ArtifactRef;
pub use ids::EntityRef;
pub use ids::Layer;
pub use ids::RevisionRef;
pub use page::Page;
pub use page::PageRequest;
pub use page::RevisionMode;
pub use page::page_by_key;
pub use provenance::BasisRef;
pub use provenance::Locator;
pub use provenance::ProducerRef;
pub use provenance::Trace;
pub use status::AccessStatus;
pub use status::Freshness;
pub use status::ReviewStatus;
pub use status::RunStatus;
