//! Storage-neutral application services for the local Context Compiler control plane.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod backend;
mod error;
mod job;
mod review;
mod workspace_registry;

pub use backend::AdminBackend;
pub use backend::AdminFuture;
pub use backend::ArtifactPreview;
pub use backend::ArtifactPreviewRequest;
pub use backend::LayerCollection;
pub use backend::LayerQuery;
pub use backend::ManualScopeAssignmentRequest;
pub use backend::NormalizationPreview;
pub use backend::NormalizationPreviewRequest;
pub use backend::NormalizationResolveRequest;
pub use backend::NormalizerCatalogEntry;
pub use backend::ScopeContextView;
pub use backend::StructureConfigView;
pub use backend::StructureFileFamilyView;
pub use backend::StructureFormatView;
pub use backend::StructureParserCatalogEntry;
pub use backend::WorkspaceFileEntry;
pub use backend::WorkspaceFileKind;
pub use error::AdminError;
pub use error::AdminResult;
pub use job::BuildEvent;
pub use job::BuildEventKind;
pub use job::BuildJob;
pub use job::BuildJobStatus;
pub use job::BuildStage;
pub use job::JobManager;
pub use job::JobPersistence;
pub use job::JobPersistenceFuture;
pub use job::JobReporter;
pub use job::JobTaskResult;
pub use job::PipelineRunRequest;
pub use review::ReviewCommand;
pub use review::ReviewDecision;
pub use review::ReviewSubject;
pub use workspace_registry::RegisteredWorkspace;
pub use workspace_registry::WorkspaceRegistry;
