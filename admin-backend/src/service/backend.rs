use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

use agent_file_normalizer::NormalizerDescriptor;
use agent_source_connector::ConnectionTestResult;
use agent_source_connector::ConnectorDescriptor;
use agent_source_connector::DiscoveryResult;
use context_config::ContextConfig;
use context_config::LoadedConfig;
use context_config::StructurePolicy;
use context_protocol::ArtifactRef;
use context_protocol::Freshness;
use context_protocol::ReviewStatus;
use context_protocol::RevisionRef;
use context_query::ContextRequest;
use context_query::ContextResult;
use context_scope::EffectiveScope;
use context_scope::Propagation;
use context_scope::Scope;
use context_scope::ScopeAssignment;
use context_structure::StructureFileFamily;
use context_structure::StructureParserDescriptor;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::AdminResult;
use crate::BuildJob;
use crate::JobManager;
use crate::PipelineRunRequest;
use crate::RegisteredWorkspace;
use crate::ReviewCommand;

pub type AdminFuture<'a, T> = Pin<Box<dyn Future<Output = AdminResult<T>> + Send + 'a>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum LayerCollection {
    Sources,
    Snapshots,
    NormalizedSources,
    Structures,
    Evidence,
    Facts,
    ScopeDimensions,
    Scopes,
    ScopeAssignments,
    ScopeBlocks,
    ScopeRelations,
    ScopeDecisions,
    SemanticEdges,
}

#[derive(
    Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, utoipa::IntoParams,
)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query, rename_all = "camelCase")]
pub struct LayerQuery {
    pub cursor: Option<String>,
    pub limit: Option<u16>,
    pub text: Option<String>,
    pub kind: Option<String>,
    #[param(value_type = Option<String>)]
    pub freshness: Option<Freshness>,
    #[param(value_type = Option<String>)]
    pub review_status: Option<ReviewStatus>,
    pub source_entity_id: Option<String>,
    pub source_revision: Option<String>,
    #[serde(default)]
    pub all_revisions: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizerCatalogEntry {
    pub mapping: NormalizerDescriptor,
    pub enabled: bool,
    pub processor_installed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParserCatalogEntry {
    pub descriptor: StructureParserDescriptor,
    pub config_schema: serde_json::Value,
    pub installed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureFormatView {
    pub extension: String,
    pub format: String,
    pub file_count: u64,
    pub selected_parser_id: Option<String>,
    pub compatible_parsers: Vec<StructureParserDescriptor>,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureFileFamilyView {
    pub family: StructureFileFamily,
    pub label: String,
    pub file_count: u64,
    pub format_count: u64,
    pub formats: Vec<StructureFormatView>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureConfigView {
    pub etag: String,
    pub policy: StructurePolicy,
    pub families: Vec<StructureFileFamilyView>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationPreviewRequest {
    pub source_id: String,
    pub stable_key: String,
    pub max_chars: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationResolveRequest {
    pub source_id: String,
    pub path: String,
    pub extension: Option<String>,
    pub media_type: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationPreview {
    pub normalizer_id: String,
    pub output_format: String,
    pub media_type: String,
    pub extension: String,
    pub content: String,
    pub truncated: bool,
    pub diagnostics: Vec<agent_file_normalizer::NormalizationDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPreviewRequest {
    pub artifact: ArtifactRef,
    pub max_chars: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPreview {
    pub content: String,
    pub truncated: bool,
    pub characters: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeContextView {
    pub target: RevisionRef,
    pub direct_assignments: Vec<ScopeAssignment>,
    pub effective: EffectiveScope,
    pub scopes: Vec<Scope>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManualScopeAssignmentRequest {
    pub target: RevisionRef,
    pub dimension: String,
    pub scope_key: String,
    pub label: String,
    pub propagation: Propagation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileEntry {
    pub name: String,
    pub path: String,
    pub kind: WorkspaceFileKind,
    pub size_bytes: u64,
    pub modified_at_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceFileKind {
    Directory,
    File,
    Symlink,
    Other,
}

pub trait AdminBackend: Send + Sync {
    fn jobs(&self) -> JobManager;

    fn list_workspaces(&self) -> AdminFuture<'_, Vec<RegisteredWorkspace>>;
    fn register_workspace(&self, root: PathBuf) -> AdminFuture<'_, RegisteredWorkspace>;
    fn unregister_workspace(&self, workspace_id: String) -> AdminFuture<'_, ()>;
    fn doctor(&self, workspace_id: String) -> AdminFuture<'_, serde_json::Value>;
    fn list_workspace_files(
        &self,
        workspace_id: String,
        path: String,
    ) -> AdminFuture<'_, Vec<WorkspaceFileEntry>>;

    fn get_config(&self, workspace_id: String) -> AdminFuture<'_, LoadedConfig>;
    fn save_config(
        &self,
        workspace_id: String,
        config: ContextConfig,
        expected_etag: Option<String>,
    ) -> AdminFuture<'_, String>;

    fn connector_catalog(&self) -> AdminFuture<'_, Vec<ConnectorDescriptor>>;
    fn test_source(
        &self,
        workspace_id: String,
        source_id: String,
    ) -> AdminFuture<'_, ConnectionTestResult>;
    fn discover_source(
        &self,
        workspace_id: String,
        source_id: String,
        cursor: Option<String>,
        limit: Option<u16>,
    ) -> AdminFuture<'_, DiscoveryResult>;

    fn normalizer_catalog(
        &self,
        workspace_id: String,
    ) -> AdminFuture<'_, Vec<NormalizerCatalogEntry>>;
    fn preview_normalization(
        &self,
        workspace_id: String,
        request: NormalizationPreviewRequest,
    ) -> AdminFuture<'_, NormalizationPreview>;
    fn preview_artifact(
        &self,
        workspace_id: String,
        request: ArtifactPreviewRequest,
    ) -> AdminFuture<'_, ArtifactPreview>;
    fn resolve_normalization(
        &self,
        workspace_id: String,
        request: NormalizationResolveRequest,
    ) -> AdminFuture<'_, serde_json::Value>;

    fn structure_parser_catalog(
        &self,
        workspace_id: String,
    ) -> AdminFuture<'_, Vec<StructureParserCatalogEntry>>;
    fn structure_config(&self, workspace_id: String) -> AdminFuture<'_, StructureConfigView>;
    fn save_structure_config(
        &self,
        workspace_id: String,
        policy: StructurePolicy,
        expected_etag: Option<String>,
    ) -> AdminFuture<'_, StructureConfigView>;
    fn structure_build_units(
        &self,
        workspace_id: String,
        build_ref: String,
        query: LayerQuery,
    ) -> AdminFuture<'_, serde_json::Value>;
    fn structure_build_relations(
        &self,
        workspace_id: String,
        build_ref: String,
        query: LayerQuery,
    ) -> AdminFuture<'_, serde_json::Value>;
    fn resolve_structure(
        &self,
        workspace_id: String,
        kind: String,
        local_id: String,
    ) -> AdminFuture<'_, serde_json::Value>;

    fn list_layer(
        &self,
        workspace_id: String,
        collection: LayerCollection,
        query: LayerQuery,
    ) -> AdminFuture<'_, serde_json::Value>;
    fn scope_context(
        &self,
        workspace_id: String,
        target: RevisionRef,
    ) -> AdminFuture<'_, ScopeContextView>;
    fn assign_scope(
        &self,
        workspace_id: String,
        request: ManualScopeAssignmentRequest,
    ) -> AdminFuture<'_, ScopeAssignment>;
    fn lineage(
        &self,
        workspace_id: String,
        entity_id: String,
        revision: String,
    ) -> AdminFuture<'_, serde_json::Value>;

    fn start_build(
        &self,
        workspace_id: String,
        request: PipelineRunRequest,
    ) -> AdminFuture<'_, BuildJob>;
    fn review(
        &self,
        workspace_id: String,
        command: ReviewCommand,
    ) -> AdminFuture<'_, serde_json::Value>;
    fn context(
        &self,
        workspace_id: String,
        request: ContextRequest,
    ) -> AdminFuture<'_, ContextResult>;
}
