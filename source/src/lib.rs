//! Source registration, immutable snapshots, and readable normalized projections.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod catalog;
mod local;
mod memory;
mod model;
mod registry;
mod store;

pub use agent_file_normalizer::AgentFileProfile;
pub use agent_file_normalizer::ArtifactRole;
pub use agent_file_normalizer::FormatId;
pub use agent_file_normalizer::NormalizationDiagnostic;
pub use agent_file_normalizer::NormalizationDiagnosticLevel;
pub use agent_file_normalizer::NormalizerDescriptor;
pub use agent_file_normalizer::NormalizerError;
pub use agent_file_normalizer::NormalizerFactory as SourceNormalizerFactory;
pub use agent_file_normalizer::NormalizerFuture;
pub use agent_file_normalizer::NormalizerIdentity;
pub use agent_file_normalizer::RetrievalProfile;
pub use agent_file_normalizer::ToolSupport;
pub use agent_file_normalizer::ToolSupportLevel;
pub use catalog::NormalizedSourceQuery;
pub use catalog::SnapshotQuery;
pub use catalog::SourceCatalogReader;
pub use catalog::SourceQuery;
pub use local::CapturedSource;
pub use local::LocalSourceConnector;
pub use memory::MemorySourceStore;
pub use model::NormalizedArtifact;
pub use model::NormalizedSource;
pub use model::ProjectionPolicy;
pub use model::SourceRecord;
pub use model::SourceSnapshot;
pub use registry::NormalizationCandidate;
pub use registry::NormalizationConfig;
pub use registry::NormalizationRule;
pub use registry::NormalizerRegistry;
pub use registry::ResolvedNormalization;
pub use registry::SelectedNormalization;
pub use store::SourceError;
pub use store::SourceFuture;
pub use store::SourceReader;
pub use store::SourceResult;
pub use store::SourceStore;
