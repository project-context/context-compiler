use std::path::Path;
use std::path::PathBuf;

use context_admin_backend::ArtifactPreview;
use context_admin_backend::ArtifactPreviewRequest;
use context_admin_backend::BuildEvent;
use context_admin_backend::BuildJob;
use context_admin_backend::JobTaskResult;
use context_admin_backend::LayerQuery;
use context_admin_backend::NormalizationPreview;
use context_admin_backend::NormalizationPreviewRequest;
use context_admin_backend::NormalizationResolveRequest;
use context_admin_backend::NormalizerCatalogEntry;
use context_admin_backend::RegisteredWorkspace;
use context_admin_backend::ReviewCommand;
use context_admin_backend::StructureConfigView;
use context_admin_backend::StructureParserCatalogEntry;
use context_compiler::BuildOptions;
use context_compiler::CompileSummary;
use context_config::ContextConfig;
use context_evidence::EvidenceBuildOutput;
use context_evidence::EvidenceRecord;
use context_fact::FactBuildOutput;
use context_fact::FactRevision;
use context_protocol::BuildResult;
use context_protocol::Diagnostic;
use context_protocol::EntityRef;
use context_protocol::Locator;
use context_protocol::PageRequest;
use context_protocol::RevisionRef;
use context_protocol::Trace;
use context_query::ContextRequest;
use context_query::ContextResult;
use context_scope::EffectiveScope;
use context_scope::ScopeAssignment;
use context_scope::ScopeBlock;
use context_scope::ScopeRelation;
use context_semantic::SemanticEdge;
use context_source::NormalizationConfig;
use context_source::NormalizedSource;
use context_source::NormalizerDescriptor;
use context_source::SourceRecord;
use context_source::SourceSnapshot;
use context_structure::StructureBuildOutput;
use context_structure::StructureParseReport;
use context_structure::StructureParserDescriptor;
use context_structure::StructureRelationRecord;
use context_structure::StructureUnit;
use context_workspace::WorkspaceConfig;
use schemars::JsonSchema;
use schemars::schema_for;
use serde_json::Value;

use crate::TestSupportResult;

#[allow(dead_code)]
#[derive(JsonSchema)]
struct ProtocolSchema {
    entity: EntityRef,
    revision: RevisionRef,
    locator: Locator,
    trace: Trace,
    diagnostic: Diagnostic,
    build: BuildResult,
    page: PageRequest,
}

#[allow(dead_code)]
#[derive(JsonSchema)]
struct AdminSchema {
    workspace: RegisteredWorkspace,
    job: BuildJob,
    job_result: JobTaskResult,
    event: BuildEvent,
    layer_query: LayerQuery,
    normalizer: NormalizerCatalogEntry,
    preview_request: NormalizationPreviewRequest,
    preview: NormalizationPreview,
    artifact_preview_request: ArtifactPreviewRequest,
    artifact_preview: ArtifactPreview,
    resolve: NormalizationResolveRequest,
    review: ReviewCommand,
    structure_config: StructureConfigView,
    structure_parser: StructureParserCatalogEntry,
}

#[allow(dead_code)]
#[derive(JsonSchema)]
struct SourceSchema {
    record: SourceRecord,
    snapshot: SourceSnapshot,
    normalized: NormalizedSource,
    descriptor: NormalizerDescriptor,
    config: NormalizationConfig,
}

#[allow(dead_code)]
#[derive(JsonSchema)]
struct StructureSchema {
    unit: StructureUnit,
    relation: StructureRelationRecord,
    output: StructureBuildOutput,
    parser: StructureParserDescriptor,
    parse_report: StructureParseReport,
}

#[allow(dead_code)]
#[derive(JsonSchema)]
struct EvidenceSchema {
    record: EvidenceRecord,
    output: EvidenceBuildOutput,
}

#[allow(dead_code)]
#[derive(JsonSchema)]
struct FactSchema {
    record: FactRevision,
    output: FactBuildOutput,
}

#[allow(dead_code)]
#[derive(JsonSchema)]
struct ScopeSchema {
    assignment: ScopeAssignment,
    block: ScopeBlock,
    relation: ScopeRelation,
    effective: EffectiveScope,
}

#[allow(dead_code)]
#[derive(JsonSchema)]
struct QuerySchema {
    request: ContextRequest,
    result: ContextResult,
}

#[allow(dead_code)]
#[derive(JsonSchema)]
struct CompilerSchema {
    options: BuildOptions,
    summary: CompileSummary,
}

pub fn schema_documents() -> Result<Vec<(PathBuf, Value)>, serde_json::Error> {
    [
        (
            "protocol/schema/protocol.v1.schema.json",
            schema_for!(ProtocolSchema),
        ),
        (
            "source/schema/source.v1.schema.json",
            schema_for!(SourceSchema),
        ),
        (
            "structure/schema/structure.v2.schema.json",
            schema_for!(StructureSchema),
        ),
        (
            "evidence/schema/evidence.v1.schema.json",
            schema_for!(EvidenceSchema),
        ),
        ("fact/schema/fact.v1.schema.json", schema_for!(FactSchema)),
        (
            "scope/schema/scope.v1.schema.json",
            schema_for!(ScopeSchema),
        ),
        (
            "semantic/schema/semantic.v1.schema.json",
            schema_for!(SemanticEdge),
        ),
        (
            "workspace/schema/workspace.v1.schema.json",
            schema_for!(WorkspaceConfig),
        ),
        (
            "query/schema/query.v1.schema.json",
            schema_for!(QuerySchema),
        ),
        (
            "compiler/schema/compiler.v1.schema.json",
            schema_for!(CompilerSchema),
        ),
        (
            "config/schema/config.v1.schema.json",
            schema_for!(ContextConfig),
        ),
        (
            "admin-backend/schema/admin.v1.schema.json",
            schema_for!(AdminSchema),
        ),
    ]
    .into_iter()
    .map(|(path, schema)| Ok((PathBuf::from(path), serde_json::to_value(schema)?)))
    .collect()
}

pub fn write_schemas(root: impl AsRef<Path>) -> TestSupportResult<()> {
    let root = root.as_ref();
    for (relative, schema) in schema_documents().map_err(std::io::Error::other)? {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&schema).map_err(std::io::Error::other)?;
        std::fs::write(path, format!("{json}\n"))?;
    }
    Ok(())
}
