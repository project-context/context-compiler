export type {
  ComponentManifest,
  ComponentResult,
  ComponentStability,
  ContextComponent,
  ContextDistribution,
  PipelineDefinition,
  PipelineExecutionContext,
  PipelineStage,
  PipelineState
} from '../contracts/pipeline.js'
export { PIPELINE_STAGES } from '../contracts/pipeline.js'

export type {
  ContextAuthority,
  ContextEdge,
  ContextEdgeStatus,
  ContextGraph,
  ContextGraphAdapterRef,
  ContextGraphAdapterRole,
  ContextGraphScope,
  ContextGraphScopeKind,
  ContextNode,
  ContextNodeStatus,
  ContextNodeType,
  Diagnostic,
  DiagnosticSeverity,
  Evidence,
  EvidenceType,
  ExpandPolicy
} from '../contracts/graph.js'

export type {
  ContextAdapterPlan,
  ContextPackageBuildUnit,
  ContextPackageBuildUnitKind,
  ContextPackageBuildUnitStandardKind,
  ContextPackageKind,
  ContextPackageRecord,
  ContextScopeBuildPlan,
  ContextSourceFirstPlans,
  ContextSourceGroupBoundaryMode,
  ContextSourceGroupCandidate,
  ContextSourceGroupKind,
  ContextSourceGroupPlan,
  ContextSourceGroupRecord,
  ContextSourceGroupingDecision,
  ContextSourceGroupingDecisions,
  ContextSourceGroupingRequest,
  ContextSourceInventory,
  ContextSourceInventoryEntry,
  ContextSourceInventoryStatus,
  ContextSourceRoute,
  ContextSourceTriageResult,
  ContextWorkspaceGraphPlan
} from '../contracts/sources.js'

export type {
  ContextGraphIndexHint,
  DocumentExtractionInput,
  DocumentExtractionResult,
  DocumentExtractorAdapter,
  DocumentExtractorAdapterManifest,
  GraphAdapter,
  GraphAdapterArtifact,
  GraphAdapterManifest,
  GraphBuildInput,
  GraphBuildResult,
  NormalizedRecord,
  ParsedArtifact,
  RawArtifact,
  SourceParserAdapter,
  SourceParserAdapterManifest,
  SourceParserInput,
  SourceParserResult
} from '../contracts/adapters.js'

export type { ContextProgressEvent, ContextProgressReporter } from '../contracts/adapters.js'

export { createDiagnostic } from '../diagnostics/index.js'
export { normalizeGraphBuildResult, validateGraphAdapterManifest, validateGraphBuildResult } from '../graph/adapters.js'
export {
  createContextEdge,
  createContextNode,
  evidenceFromSource,
  fingerprintValue,
  nodeContent,
  nodeStringArrayProperty,
  nodeStringProperty,
  primarySourceRef,
  slug,
  sourceUri
} from '../graph/model.js'
export { defineComponent } from '../pipeline/registry.js'
