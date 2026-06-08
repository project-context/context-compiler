/**
 * Stable pipeline stages supported by the compiler kernel.
 *
 * `resolve` is intentionally absent because resolution is a kernel concern:
 * the kernel loads config, validates components, and builds an execution plan
 * before any replaceable component runs.
 */
export const PIPELINE_STAGES = [
  'ingest',
  'parse',
  'normalize',
  'classify',
  'enrich',
  'link',
  'validate',
  'govern',
  'compress',
  'emit'
] as const

/** A replaceable compiler lifecycle stage. */
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

/** Public stability labels for components and distributions. */
export type ComponentStability = 'development' | 'alpha' | 'beta' | 'stable' | 'deprecated'

/** Component metadata used by the kernel for planning, validation, and docs. */
export interface ComponentManifest {
  id: string
  stage: PipelineStage
  version: string
  apiVersion: 'v1'
  stability: ComponentStability
  inputs: string[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  cacheable: boolean
}

/** A human work source declared by a workspace config. */
export interface SourceConfig {
  type?: string
  name: string
  path: string
  parser?: string
  mediaType?: string
  include?: string[]
  exclude?: string[]
  maxFileBytes?: number
  includeDotfiles?: boolean
  [key: string]: unknown
}

/** Workspace metadata inferred by the config loader or compiler entrypoint. */
export interface WorkspaceMetadata {
  rootDir: string
  name: string
  configPath?: string
}

/** Semantic class of dynamic runtime data exposed to agents through MCP. */
export type ContextRuntimeProviderKind = 'db-schema' | 'metrics' | 'feature-flags' | 'ci' | 'logs' | 'config' | 'static'

/** Execution transport used by a runtime provider. */
export type ContextRuntimeProviderTransport = 'static' | 'command' | 'http'

/** Runtime data provider declaration emitted under `.context/runtime/providers`. */
export interface ContextRuntimeProvider {
  name: string
  kind: ContextRuntimeProviderKind
  transport: ContextRuntimeProviderTransport
  title?: string
  description?: string
  value?: unknown
  path?: string
  mediaType?: string
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  cacheTtlMs?: number
  policy?: ContextProviderPolicy
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Evidence explaining why a generated runtime capability exists. */
export interface ContextRuntimeEvidence {
  nodeId?: string
  edgeId?: string
  sourceRefs?: SourceRef[]
  reason: string
  confidence: number
}

/** Project-specific tool declaration surfaced to agents. */
export interface ContextToolDefinition {
  name: string
  command?: string
  args?: string[]
  description: string
  argsSchema?: ContextJsonSchema
  inputSchema?: ContextJsonSchema
  cwd?: string
  timeoutMs?: number
  safety: 'read_only' | 'test_only' | 'local_write' | 'dangerous'
  outputParser?: string
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Project-specific skill or instruction pack surfaced to agents. */
export interface ContextSkillDefinition {
  id: string
  title: string
  content: string
  description?: string
  path?: string
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Generated integration file for a coding agent. */
export interface ContextAgentIntegration {
  id: 'codex' | 'claude' | 'cursor' | string
  title: string
  path: string
  content: string
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Project-level plugin or adapter declaration. */
export interface ContextPluginDefinition {
  id: string
  title: string
  version?: string
  description?: string
  components?: string[]
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Generated runtime config emitted under `.context/runtime`. */
export interface ContextRuntimeConfig {
  providers?: ContextRuntimeProvider[]
  tools?: ContextToolDefinition[]
  skills?: ContextSkillDefinition[]
  agents?: ContextAgentIntegration[]
  plugins?: ContextPluginDefinition[]
}

export type ContextRuntimeCapabilityKind =
  | 'provider'
  | 'mcp-tool'
  | 'project-tool'
  | 'skill'
  | 'agent-integration'
  | 'plugin'

export type ContextAgentInstallStatus = 'not-installed' | 'planned' | 'installed' | 'stale' | 'conflict'

/** Generated runtime capability plan emitted before serialization. */
export interface ContextRuntimeCapability {
  id: string
  kind: ContextRuntimeCapabilityKind
  title: string
  targetAgents: string[]
  agentSurfaces?: string[]
  entrypoints?: string[]
  freshness?: ContextRuntimeFreshness
  installStatus?: ContextAgentInstallStatus
  policy?: ContextProviderPolicy
  evidence: ContextRuntimeEvidence[]
  confidence: number
  metadata: Record<string, unknown>
}

export interface ContextJsonSchema {
  type?: string
  properties?: Record<string, ContextJsonSchema>
  required?: string[]
  additionalProperties?: boolean | ContextJsonSchema
  enum?: unknown[]
  description?: string
  items?: ContextJsonSchema
  [key: string]: unknown
}

export interface ContextRuntimeFreshness {
  status: 'fresh' | 'stale' | 'unknown'
  checkedAt?: string
  sourceFingerprintIds?: string[]
}

export interface ContextProviderPolicy {
  allowedAgents?: string[]
  requiresApproval?: boolean
  timeoutMs?: number
  cacheTtlMs?: number
  redactionLevel?: 'none' | 'standard' | 'strict'
  allowNetwork?: boolean
}

export interface ContextSourceFingerprint {
  id: string
  source: SourceRef
  algorithm: 'sha256'
  hash: string
  sizeBytes: number
  updatedAt?: string
}

export interface ContextRuntimeTraceEvent {
  schemaVersion: 'context-runtime-trace.v1'
  id: string
  event: 'compile'
  generatedAt: string
  pipeline: string
  components: string[]
  sourceFingerprints: ContextSourceFingerprint[]
  diagnostics: Diagnostic[]
  emittedArtifacts: string[]
  metadata: Record<string, unknown>
}

export type ContextAgentTarget = 'codex' | 'claude' | 'all'

export interface ContextAgentInstallFile {
  path: string
  agent: 'codex' | 'claude'
  mode: 'managed-block' | 'write-generated' | 'merge-json'
  marker?: string
  content: string
  status?: ContextAgentInstallStatus
  detected?: ContextAgentInstallDetection
  conflict?: ContextAgentInstallConflict
  metadata?: Record<string, unknown>
}

export interface ContextAgentInstallDetection {
  exists: boolean
  hasManagedBlock?: boolean
  contentMatches?: boolean
}

export interface ContextAgentInstallConflict {
  code: string
  message: string
}

export interface ContextAgentInstallPlan {
  schemaVersion: 'context-agent-install-plan.v1'
  generatedAt: string
  targetAgents: Array<'codex' | 'claude'>
  files: ContextAgentInstallFile[]
  metadata: Record<string, unknown>
}

/** Generated runtime plan emitted under `.context/runtime/runtime-plan.json`. */
export interface ContextRuntimePlan {
  schemaVersion: 'context-runtime-plan.v1'
  generatedAt: string
  providers: ContextRuntimeProvider[]
  mcpTools: ContextToolDefinition[]
  tools: ContextToolDefinition[]
  skills: ContextSkillDefinition[]
  agents: ContextAgentIntegration[]
  plugins: ContextPluginDefinition[]
  capabilities: ContextRuntimeCapability[]
  diagnostics: Diagnostic[]
}

/** User-authored config. It describes input boundaries, not project conclusions. */
export interface ContextConfigInput {
  sources?: SourceConfig[]
  components?: Record<string, unknown>
  pipelines?: Record<string, PipelineDefinition>
  policies?: Record<string, unknown>
  outputDir?: string
}

/** Normalized compiler configuration consumed by kernel pipelines. */
export interface ContextProjectConfig {
  workspace: WorkspaceMetadata
  sources: SourceConfig[]
  components?: Record<string, unknown>
  pipelines?: Record<string, PipelineDefinition>
  policies?: Record<string, unknown>
  outputDir?: string
}

/** A configured workspace pipeline. Values are component ids enabled per stage. */
export interface PipelineDefinition {
  id: string
  stages: Partial<Record<PipelineStage, string[]>>
}

/** Source location attached to source references and evidence. */
export interface SourceLocation {
  path?: string
  lineStart?: number
  lineEnd?: number
  section?: string
  page?: number
  nodeId?: string
}

/** Source provenance attached to every artifact, node, edge, and diagnostic. */
export interface SourceRef {
  sourceId: string
  uri: string
  title?: string
  location?: SourceLocation
}

export type ContextSourceRoute = 'markdown' | 'code' | 'openapi' | 'inventory' | 'unsupported'
export type ContextSourceInventoryStatus = 'routed' | 'inventory_only' | 'unsupported' | 'skipped'
export type ContextSourceGroupKind =
  | 'repository'
  | 'doc_bundle'
  | 'asset_bundle'
  | 'analysis_bundle'
  | 'domain_area'
  | 'data_bundle'
  | 'api_bundle'
  | 'design_bundle'
  | 'test_bundle'
  | 'config_bundle'
  | 'runtime_bundle'
  | 'vendor_bundle'
  | 'generated_bundle'
  | 'archive'
  | 'unknown'
export type ContextSourceGroupBoundaryMode = 'expanded' | 'collapsed' | 'repository'

export interface ContextSourceGroupCandidate {
  path: string
  title: string
  fileCount: number
  directoryCount: number
  extensionCounts: Record<string, number>
  markers: string[]
  representativeFiles: string[]
  suggestedKind: ContextSourceGroupKind
  suggestedBoundaryMode: ContextSourceGroupBoundaryMode
  confidence: number
}

export interface ContextSourceGroupingRequest {
  schemaVersion: 'context-source-grouping-request.v1'
  generatedAt: string
  sources: Array<{
    sourceName: string
    root: string
    candidates: ContextSourceGroupCandidate[]
  }>
}

export interface ContextSourceGroupingDecision {
  path: string
  kind: ContextSourceGroupKind
  boundaryMode: ContextSourceGroupBoundaryMode
  title: string
  summary: string
  childrenPolicy?: 'promote_routed' | 'promote_none' | 'promote_all' | string
  confidence: number
}

export interface ContextSourceGroupingDecisions {
  schemaVersion: 'context-source-grouping-decisions.v1'
  decisions: ContextSourceGroupingDecision[]
  generatedAt?: string
  agent?: string
}

export interface ContextSourceGroupRecord {
  id: string
  sourceName: string
  path: string
  title: string
  kind: ContextSourceGroupKind
  boundaryMode: ContextSourceGroupBoundaryMode
  summary: string
  childrenPolicy?: string
  confidence: number
  decisionSource: 'agent' | 'typed-source' | 'inferred'
  sourceRef: SourceRef
  metadata?: Record<string, unknown>
}

export type ContextPackageKind =
  | 'product_docs'
  | 'code_repository'
  | 'analysis'
  | 'design'
  | 'data'
  | 'runtime'
  | 'asset'
  | 'unknown'

export type ContextPackageBuildUnitKind = 'repository' | 'graphrag_corpus' | 'api_contracts' | 'inventory'
export type ContextPackageBuildUnitStandardKind = 'repository' | 'semantic_corpus' | 'api_contracts' | 'inventory'

export interface ContextPackageBuildUnit {
  id: string
  kind: ContextPackageBuildUnitKind
  standardKind: ContextPackageBuildUnitStandardKind
  title: string
  sourceGroupIds: string[]
  adapterId: string
  adapterSelection: ContextGraphAdapterRef
  path?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export interface ContextPackageRecord {
  id: string
  sourceName: string
  path: string
  title: string
  kind: ContextPackageKind
  summary: string
  sourceGroupIds: string[]
  buildUnits: ContextPackageBuildUnit[]
  confidence: number
  decisionSource: 'agent' | 'typed-source' | 'inferred'
  sourceRef: SourceRef
  metadata?: Record<string, unknown>
}

export interface ContextSourceInventoryEntry {
  id: string
  sourceName: string
  root: string
  path: string
  uri: string
  mediaType: string
  sizeBytes: number
  hash: string
  route: ContextSourceRoute
  status: ContextSourceInventoryStatus
  unsupportedReason?: string
  sourceRef: SourceRef
  metadata?: Record<string, unknown>
}

export interface ContextSourceInventory {
  schemaVersion: 'context-source-inventory.v1'
  entries: ContextSourceInventoryEntry[]
  packages?: ContextPackageRecord[]
  groups?: ContextSourceGroupRecord[]
  groupingRequest?: ContextSourceGroupingRequest
  summary: {
    roots: number
    files: number
    packages?: number
    groups?: number
    routed: number
    inventoryOnly: number
    unsupported: number
    skipped: number
  }
}

export interface ContextSourceTriageResult {
  schemaVersion: 'context-source-triage.v1'
  generatedAt: string
  summary: {
    files: number
    routed: number
    inventoryOnly: number
    unsupported: number
    skipped: number
    adapterNeeded: number
  }
  entries: Array<{
    sourceInventoryId: string
    path: string
    route: ContextSourceRoute
    status: ContextSourceInventoryStatus
    action: 'route' | 'inventory' | 'skip' | 'needs-adapter'
    adapterNeeded?: boolean
    unsupportedReason?: string
    mediaType: string
  }>
  diagnostics: Diagnostic[]
}

export interface ContextSourceGroupPlan {
  schemaVersion: 'context-source-group-plan.v1'
  generatedAt: string
  groups: Array<{
    id: string
    sourceName: string
    path: string
    title: string
    kind: ContextSourceGroupKind
    boundaryMode: ContextSourceGroupBoundaryMode
    summary: string
    decisionSource: ContextSourceGroupRecord['decisionSource']
    confidence: number
    adapterPlan: ContextGraphAdapterRef[]
  }>
}

export interface ContextWorkspaceGraphPlan {
  schemaVersion: 'context-workspace-graph-plan.v1'
  generatedAt: string
  rootScopeId: string
  scopeDAG: Array<{
    scopeId: string
    kind: ContextGraphScopeKind
    parentScopeId?: string
    rootNodeId?: string
    sourceGroupId?: string
    path?: string
    title: string
    boundaryMode?: ContextSourceGroupBoundaryMode
    adapters: ContextGraphAdapterRef[]
  }>
  skeletonNodes: Array<Pick<ContextNode, 'id' | 'type' | 'name' | 'scopeId' | 'subgraphRef' | 'properties'>>
  weakRelations: Array<Pick<ContextEdge, 'id' | 'from' | 'to' | 'type' | 'confidence' | 'evidence' | 'properties'>>
}

export interface ContextScopeBuildPlan {
  schemaVersion: 'context-scope-build-plan.v1'
  generatedAt: string
  scopes: Array<{
    scopeId: string
    kind: ContextGraphScopeKind
    parentScopeId?: string
    sourceGroupId?: string
    path?: string
    boundaryMode?: ContextSourceGroupBoundaryMode
    adapters: ContextGraphAdapterRef[]
    inputs: string[]
    outputs: string[]
    cacheKey: string
    freshness: ContextRuntimeFreshness
  }>
}

export interface ContextAdapterPlan {
  schemaVersion: 'context-adapter-plan.v1'
  generatedAt: string
  adapters: Array<ContextGraphAdapterRef & {
    scopeIds: string[]
    inputs: string[]
    outputs: string[]
  }>
}

export interface ContextSourceFirstPlans {
  triage: ContextSourceTriageResult
  sourceGroups: ContextSourceGroupPlan
  workspaceGraph: ContextWorkspaceGraphPlan
  scopeBuild: ContextScopeBuildPlan
  adapterPlan: ContextAdapterPlan
}

export type ExpandPolicy = 'collapsed' | 'expand_on_demand' | 'expanded' | 'terminal'

export interface GraphRevision {
  schemaVersion: 'context-graph-revision.v1'
  id: string
  parentRevisionId?: string
  createdAt: string
  graphFingerprint: string
  reason: string
  status: 'seed' | 'materialized' | 'superseded'
  patchIds: string[]
  evidenceReportIds: string[]
}

export interface GraphPatchAuthor {
  type: 'kernel' | 'agent' | 'adapter' | 'human'
  name: string
}

export type GraphFactKind = 'node' | 'edge'
export type GraphFactProvenanceStatus = 'seed' | 'proposed' | 'applied' | 'superseded' | 'rejected'

export interface GraphFactProvenance {
  schemaVersion: 'context-graph-fact-provenance.v1'
  id: string
  factKind: GraphFactKind
  factId: string
  revisionId: string
  previousRevisionId?: string
  patchId?: string
  operation?: PatchOperation['op'] | 'compile_seed'
  operationIndex?: number
  author?: GraphPatchAuthor
  evidenceReportIds: string[]
  findingTypes: EvidenceFinding['type'][]
  evidence: Evidence[]
  sourceRefs: SourceRef[]
  status: GraphFactProvenanceStatus
  createdAt: string
}

export type PatchOperation =
  | { op: 'add_node'; node: ContextNode }
  | { op: 'update_node'; nodeId: string; name?: string; status?: ContextNodeStatus; confidence?: number; properties?: Record<string, unknown> }
  | { op: 'add_edge'; edge: ContextEdge }
  | { op: 'deprecate_node'; nodeId: string; supersededBy?: string; reason?: string }
  | { op: 'deprecate_edge'; edgeId: string; supersededBy?: string; reason?: string }
  | { op: 'restore_node_snapshot'; node: ContextNode; reason?: string }
  | {
      op: 'relabel_source_group'
      nodeId: string
      kind: ContextSourceGroupKind
      title?: string
      summary?: string
      confidence?: number
    }
  | { op: 'reparent_node'; nodeId: string; parentScopeId?: string; sourceGroupId?: string }
  | { op: 'link'; edge: ContextEdge }
  | { op: 'rehome_proposal'; proposal: RehomeProposal }

export interface GraphPatchApplicationResult {
  schemaVersion: 'context-graph-patch-application-result.v1'
  patchId: string
  operationIndex: number
  operation: PatchOperation['op']
  factKind?: GraphFactKind
  factId?: string
  previousNode?: ContextNode
  nextNode?: ContextNode
  previousEdge?: ContextEdge
  nextEdge?: ContextEdge
}

export interface GraphPatch {
  schemaVersion: 'context-graph-patch.v1'
  id: string
  revisionId: string
  author: GraphPatchAuthor
  status: 'proposed' | 'applied' | 'rejected'
  createdAt: string
  appliedAt?: string
  appliedRevisionId?: string
  evidence: Evidence[]
  evidenceReportIds?: string[]
  operations: PatchOperation[]
  applicationResults?: GraphPatchApplicationResult[]
}

export interface EvidenceNewSourceGroup {
  id?: string
  path: string
  title: string
  kind: ContextSourceGroupKind
  boundaryMode: ContextSourceGroupBoundaryMode
  summary: string
  childrenPolicy?: string
  confidence?: number
}

export interface EvidenceFinding {
  type: 'misplaced_source' | 'relabel_group' | 'split_group' | 'merge_group' | 'link_groups' | 'confirm_fact'
  nodeId?: string
  targetGroupId?: string
  affectedNodeIds?: string[]
  relationType?: string
  newGroup?: EvidenceNewSourceGroup
  sourcePath?: string
  suggestedKind?: ContextSourceGroupKind
  suggestedPath?: string
  confidence: number
  evidence: Evidence[]
  evidenceRefs?: SourceRef[]
  properties?: Record<string, unknown>
}

export interface EvidenceReport {
  schemaVersion: 'context-evidence-report.v1'
  id: string
  revisionId: string
  scopeId: string
  generatedAt: string
  summary: string
  findings: EvidenceFinding[]
  proposedPatches: GraphPatch[]
  rehomeProposals: RehomeProposal[]
}

export interface RehomeProposal {
  schemaVersion: 'context-rehome-proposal.v1'
  id: string
  sourcePath: string
  fromGroupId?: string
  toGroupId?: string
  suggestedPath?: string
  action: 'move' | 'copy' | 'link' | 'keep'
  reason: string
  confidence: number
  evidence: Evidence[]
  status: 'proposed' | 'approved' | 'rejected' | 'applied'
  createdAt: string
}

export type ContextCorrectionProposalKind = 'relabel' | 'split' | 'merge' | 'rehome' | 'confirm_relation' | 'reject_relation'
export type ContextCorrectionProposalStatus = 'proposed' | 'approved' | 'rejected' | 'applied'
export type ContextCorrectionAction = 'approve' | 'reject' | 'apply' | 'preview'
export type ContextCorrectionRiskLevel = 'low' | 'medium' | 'high'
export type ContextCorrectionConflictSeverity = 'warning' | 'error'
export type ContextCorrectionConflictType = 'missing_target' | 'stale_revision' | 'patch_overlap' | 'already_applied' | 'missing_graph_patch'
export type ContextCorrectionOperationLayer = 'source' | 'graph' | 'revision'
export type ContextCorrectionOperationEffectKind =
  | 'source_group_relabel'
  | 'source_group_split'
  | 'source_group_merge'
  | 'source_path_rehome'
  | 'graph_patch_operation'
  | 'relation_confirm'
  | 'relation_reject'

export interface ContextCorrectionOperationEffect {
  id: string
  layer: ContextCorrectionOperationLayer
  kind: ContextCorrectionOperationEffectKind
  operation: ContextCorrectionProposalKind | PatchOperation['op']
  targetKind: 'package' | 'source_group' | 'source_path' | 'node' | 'edge' | 'graph_patch'
  targetId?: string
  path?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  summary: string
  persistent: boolean
}

export interface ContextSourceCorrectionDecision {
  schemaVersion: 'context-source-correction-decision.v1'
  id: string
  proposalId: string
  kind: ContextCorrectionProposalKind
  action: ContextCorrectionProposalKind
  status: 'applied'
  packageId?: string
  sourceGroupId?: string
  targetGroupId?: string
  sourcePath?: string
  targetPath?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  createdAt: string
  appliedRevisionId?: string
}

export interface ContextCorrectionRevisionSummary {
  baseRevisionId?: string
  newRevisionId?: string
  appliedPatchIds: string[]
  rejectedPatchIds: string[]
  sourceDecisionIds: string[]
}

export interface ContextCorrectionOperationPlan {
  schemaVersion: 'context-correction-operation-plan.v1'
  id: string
  proposalId: string
  kind: ContextCorrectionProposalKind
  effects: ContextCorrectionOperationEffect[]
  sourceEffects: ContextCorrectionOperationEffect[]
  graphEffects: ContextCorrectionOperationEffect[]
  sourceDecisions: ContextSourceCorrectionDecision[]
  graphPatchIds: string[]
  persistent: boolean
  requiresSourcePersistence: boolean
  unsupportedSourcePersistence: boolean
  diagnostics: Diagnostic[]
}

export interface ContextCorrectionPreview {
  schemaVersion: 'context-correction-preview.v1'
  proposal: ContextCorrectionProposal
  operationPlan: ContextCorrectionOperationPlan
  graphPatch?: GraphPatch
  revisionSummary?: ContextCorrectionRevisionSummary
  diagnostics: Diagnostic[]
}

export interface ContextCorrectionProposalSource {
  kind: 'evidence_report' | 'graph_patch' | 'rehome_proposal' | 'status_overlay'
  id: string
}

export interface ContextCorrectionImpact {
  operationCount: number
  affectedNodeIds: string[]
  affectedEdgeIds: string[]
  sourcePaths: string[]
  creates: number
  updates: number
  deprecates: number
  reparents: number
  relabels: number
  rehomes: number
  riskLevel: ContextCorrectionRiskLevel
}

export interface ContextCorrectionConflict {
  type: ContextCorrectionConflictType
  severity: ContextCorrectionConflictSeverity
  message: string
  proposalId?: string
  relatedProposalId?: string
  patchId?: string
  nodeId?: string
  edgeId?: string
  sourcePath?: string
}

export interface ContextCorrectionProposal {
  schemaVersion: 'context-correction-proposal.v1'
  id: string
  dedupeKey: string
  kind: ContextCorrectionProposalKind
  status: ContextCorrectionProposalStatus
  title: string
  summary: string
  packageId?: string
  packagePath?: string
  sourceGroupIds: string[]
  affectedNodeIds: string[]
  sourcePaths: string[]
  confidence: number
  evidence: Evidence[]
  evidenceReportIds: string[]
  graphPatchIds: string[]
  rehomeProposalIds: string[]
  derivedFrom: ContextCorrectionProposalSource[]
  supersedesProposalIds: string[]
  supersededByProposalId?: string
  impact: ContextCorrectionImpact
  operationPlan?: ContextCorrectionOperationPlan
  conflicts: ContextCorrectionConflict[]
  blocked: boolean
  graphPatch?: GraphPatch
  rehomeProposal?: RehomeProposal
  actor?: GraphPatchAuthor
  statusReason?: string
  appliedRevisionId?: string
  createdAt: string
  updatedAt?: string
}

export interface ContextCorrectionProposalCounts {
  total: number
  proposed: number
  approved: number
  rejected: number
  applied: number
  blocked: number
  conflicted: number
  byKind: Partial<Record<ContextCorrectionProposalKind, number>>
  byStatus: Partial<Record<ContextCorrectionProposalStatus, number>>
  byRiskLevel: Partial<Record<ContextCorrectionRiskLevel, number>>
}

export interface ContextPackageCorrectionInbox {
  schemaVersion: 'context-package-correction-inbox.v1'
  package?: ContextPackageRecord
  scope?: ContextGraphScope
  proposals: ContextCorrectionProposal[]
  counts: ContextCorrectionProposalCounts
  nextRecommendedProposalId?: string
  diagnostics: Diagnostic[]
}

export interface ContextCorrectionActionResult {
  schemaVersion: 'context-correction-action-result.v1'
  action: ContextCorrectionAction
  dryRun: boolean
  submitted: boolean
  written: boolean
  proposal: ContextCorrectionProposal
  graphPatch?: GraphPatch
  preview?: ContextCorrectionPreview
  operationPlan?: ContextCorrectionOperationPlan
  revisionSummary?: ContextCorrectionRevisionSummary
  path?: string
  diagnostics: Diagnostic[]
}

export type GraphFactExplainMode = 'summary' | 'full'

export interface GraphFactExplainBudget {
  mode: GraphFactExplainMode
  sources?: number
  evidence?: number
  relations?: number
  provenance?: number
}

export interface GraphFactExplainOmitted {
  sourceRefs: number
  evidence: number
  relations: number
  provenance: number
}

export interface GraphFactExplanation {
  schemaVersion: 'context-graph-fact-explanation.v1'
  factId: string
  factKind: GraphFactKind
  node?: ContextNode
  edge?: ContextEdge
  relatedEdges: ContextEdge[]
  relatedNodes: ContextNode[]
  provenance: GraphFactProvenance[]
  revisions: GraphRevision[]
  patches: GraphPatch[]
  evidenceReports: EvidenceReport[]
  sourceRefs: SourceRef[]
  budget: GraphFactExplainBudget
  omitted: GraphFactExplainOmitted
  diagnostics: Diagnostic[]
}

export interface GraphFactHistoryItem {
  revisionId: string
  previousRevisionId?: string
  patchId?: string
  operation?: PatchOperation['op'] | 'compile_seed'
  operationIndex?: number
  findingTypes: EvidenceFinding['type'][]
  evidenceReportIds: string[]
  sourceRefCount: number
  status: GraphFactProvenanceStatus
  createdAt: string
}

export interface GraphFactHistory {
  schemaVersion: 'context-graph-fact-history.v1'
  factId: string
  factKind: GraphFactKind
  timeline: GraphFactHistoryItem[]
  revisions: GraphRevision[]
  patches: GraphPatch[]
  evidenceReports: EvidenceReport[]
  diagnostics: Diagnostic[]
}

export interface PlanningCycle {
  schemaVersion: 'context-planning-cycle.v1'
  id: string
  generatedAt: string
  status: 'requested' | 'planned' | 'patched' | 'reconciled' | 'failed'
  agent?: string
  planningPackRef: string
  requestRef?: string
  patchIds: string[]
  revisionIds: string[]
  diagnostics: Diagnostic[]
}

export interface PlanningPackCandidate {
  path: string
  title: string
  fileCount: number
  routeCounts: Record<string, number>
  extensionCounts: Record<string, number>
  markers: string[]
  representativeFiles: string[]
  uncertainty: 'low' | 'medium' | 'high'
}

export interface PlanningPack {
  schemaVersion: 'context-planning-pack.v1'
  generatedAt: string
  summary: {
    files: number
    routed: number
    inventoryOnly: number
    unsupported: number
    skipped: number
  }
  budget: {
    maxCandidates: number
    maxRepresentativeFiles: number
  }
  candidates: PlanningPackCandidate[]
  uncertaintyHotspots: Array<{ path: string; reason: string; confidence: number }>
  drillDownTools: string[]
}

export type ContextGraphScopeKind = 'project' | 'package' | 'source_group' | 'file' | 'content'

export type ContextGraphAdapterRole =
  | 'inventory'
  | 'parser'
  | 'semantic-graph-builder'
  | 'code-graph-builder'
  | 'runtime-provider'
  | 'indexer'

export interface ContextGraphAdapterRef {
  adapterId: string
  role: ContextGraphAdapterRole
  version?: string
  artifactPath?: string
  selectionSource?: 'default' | 'agent' | 'typed-source' | 'inferred' | 'configured' | 'registry' | string
  selectionReason?: string
  priority?: number
  candidateAdapterIds?: string[]
}

export interface ContextGraphScopeStats {
  nodes: number
  edges: number
  diagnostics: number
  files: number
  groups: number
}

export interface ContextGraphScope {
  id: string
  kind: ContextGraphScopeKind
  parentScopeId?: string
  rootNodeId?: string
  packageId?: string
  sourceGroupId?: string
  path?: string
  title: string
  summary?: string
  boundaryMode?: ContextSourceGroupBoundaryMode
  adapterRefs: ContextGraphAdapterRef[]
  stats: ContextGraphScopeStats
  freshness: ContextRuntimeFreshness
  indexRefs: Record<string, string>
}

export interface ContextGraphScopeManifest {
  schemaVersion: 'context-graph-scopes.v1'
  generatedAt: string
  scopes: Array<ContextGraphScope & {
    nodes: string
    edges: string
    summary: string
  }>
  adapters: GraphAdapterManifest[]
}

export type GraphDrillMode = 'summary' | 'full'
export type GraphExpansionDirection = 'up' | 'down' | 'around'
export type GraphExpansionTargetKind = 'scope' | 'node' | 'edge'

export interface GraphDrillBudget {
  mode: GraphDrillMode
  nodes?: number
  edges?: number
  childScopes?: number
  sourceRefs?: number
  evidence?: number
  depth?: number
}

export interface GraphDrillOmitted {
  nodes: number
  edges: number
  childScopes: number
  sourceRefs: number
  evidence: number
}

export interface GraphDrillNextAction {
  type: 'open_scope' | 'expand_target' | 'trace_source' | 'search_scope' | 'expand_package' | 'search_package' | 'review_corrections'
  targetId: string
  label: string
  reason: string
  scopeId?: string
}

export interface GraphScopeView {
  schemaVersion: 'context-graph-scope-view.v1'
  scope: ContextGraphScope
  rootNode?: ContextNode
  nodes: ContextNode[]
  edges: ContextEdge[]
  childScopes: ContextGraphScope[]
  relatedScopes: ContextGraphScope[]
  entrypoints: ContextNode[]
  nextActions: GraphDrillNextAction[]
  budget: GraphDrillBudget
  omitted: GraphDrillOmitted
  diagnostics: Diagnostic[]
}

export interface LayeredSourceTrace {
  schemaVersion: 'context-layered-source-trace.v1'
  factId: string
  fact?: ContextNode
  edge?: ContextEdge
  sourceGroups: ContextNode[]
  scopes: ContextGraphScope[]
  files: ContextNode[]
  contentNodes: ContextNode[]
  sourceRefs: SourceRef[]
  evidence: Evidence[]
  budget: GraphDrillBudget
  omitted: GraphDrillOmitted
  diagnostics: Diagnostic[]
}

export interface GraphExpansionTarget {
  id: string
  kind: GraphExpansionTargetKind
  node?: ContextNode
  edge?: ContextEdge
  scope?: ContextGraphScope
}

export interface GraphExpansion {
  schemaVersion: 'context-graph-expansion.v1'
  target: GraphExpansionTarget
  targetKind: GraphExpansionTargetKind
  scopePath: ContextGraphScope[]
  facts: ContextNode[]
  edges: ContextEdge[]
  sourceTrace?: LayeredSourceTrace
  nextActions: GraphDrillNextAction[]
  budget: GraphDrillBudget
  omitted: GraphDrillOmitted
  diagnostics: Diagnostic[]
}

export interface ContextBuildUnitView extends ContextPackageBuildUnit {
  inventoryOnly: boolean
  sourceGroups: ContextSourceGroupRecord[]
}

export interface ContextPackageStats {
  nodes: number
  edges: number
  diagnostics: number
  files: number
  groups: number
  buildUnits: number
  inventoryOnlyBuildUnits: number
}

export interface ContextPackageCorrectionCounts {
  evidenceReports: number
  findings: number
  proposedPatches: number
  rehomeProposals: number
  byFindingType: Partial<Record<EvidenceFinding['type'], number>>
}

export interface ContextPackageCorrectionSummary {
  counts: ContextPackageCorrectionCounts
  proposalCounts: ContextCorrectionProposalCounts
  pendingProposalIds: string[]
  approvedProposalIds: string[]
  appliedProposalIds: string[]
  rejectedProposalIds: string[]
  nextRecommendedProposalId?: string
  evidenceReports: EvidenceReport[]
  proposedPatches: GraphPatch[]
  rehomeProposals: RehomeProposal[]
}

export interface ContextPackageSummary {
  package: ContextPackageRecord
  scope?: ContextGraphScope
  buildUnits: ContextBuildUnitView[]
  adapterSelections: ContextGraphAdapterRef[]
  sourceGroups: ContextSourceGroupRecord[]
  stats: ContextPackageStats
  corrections: ContextPackageCorrectionSummary
  nextActions: GraphDrillNextAction[]
  diagnostics: Diagnostic[]
}

export interface ContextPackageList {
  schemaVersion: 'context-package-list.v1'
  packages: ContextPackageSummary[]
  diagnostics: Diagnostic[]
}

export interface ContextPackageView {
  schemaVersion: 'context-package-view.v1'
  package: ContextPackageRecord
  scope?: ContextGraphScope
  buildUnits: ContextBuildUnitView[]
  adapterSelections: ContextGraphAdapterRef[]
  sourceGroups: ContextSourceGroupRecord[]
  stats: ContextPackageStats
  corrections: ContextPackageCorrectionSummary
  nextActions: GraphDrillNextAction[]
  diagnostics: Diagnostic[]
}

export interface ContextPackageExpansion {
  schemaVersion: 'context-package-expansion.v1'
  mode: GraphDrillMode
  package: ContextPackageRecord
  scope?: ContextGraphScope
  buildUnits: ContextBuildUnitView[]
  adapterSelections: ContextGraphAdapterRef[]
  sourceGroups: ContextSourceGroupRecord[]
  childScopes: ContextGraphScope[]
  files: ContextNode[]
  facts: ContextNode[]
  edges: ContextEdge[]
  corrections: ContextPackageCorrectionSummary
  nextActions: GraphDrillNextAction[]
  diagnostics: Diagnostic[]
}

export interface ContextPackageSearch {
  schemaVersion: 'context-package-search.v1'
  query: string
  package?: ContextPackageRecord
  scope?: ContextGraphScope
  engine: 'sqlite' | 'sqlite-empty-fallback' | 'memory-fallback'
  indexPath: string
  results: ContextNode[]
  diagnostics: Diagnostic[]
}

export interface GraphViewerStyleHints {
  color: string
  shape: string
  size: number
  lineStyle?: string
}

export interface GraphViewerRawRef {
  factKind: 'node' | 'edge' | 'scope'
  factId: string
  scopeId?: string
}

export interface GraphViewerElement {
  id: string
  kind: 'node' | 'edge'
  type: string
  label: string
  scopeId?: string
  status?: string
  source?: string
  target?: string
  metrics: Record<string, number>
  styleHints: GraphViewerStyleHints
  rawRef: GraphViewerRawRef
  data?: Record<string, unknown>
}

export interface GraphViewerOverview {
  schemaVersion: 'context-graph-viewer-overview.v1'
  scopeId?: string
  elements: {
    nodes: GraphViewerElement[]
    edges: GraphViewerElement[]
  }
  stats: {
    totalNodes: number
    totalEdges: number
    visibleNodes: number
    visibleEdges: number
  }
  budget: GraphDrillBudget
  omitted: GraphDrillOmitted
  diagnostics: Diagnostic[]
}

export interface GraphViewerInspectResult {
  schemaVersion: 'context-graph-viewer-inspect.v1'
  targetId: string
  targetKind: GraphExpansionTargetKind
  target?: GraphViewerElement
  expansion?: GraphExpansion
  trace?: LayeredSourceTrace
  explanation?: GraphFactExplanation
  diagnostics: Diagnostic[]
}

export interface GraphViewerSearchResult {
  schemaVersion: 'context-graph-viewer-search.v1'
  engine: 'sqlite' | 'sqlite-empty-fallback' | 'memory-fallback'
  indexPath: string
  scopeId?: string
  results: GraphViewerElement[]
  diagnostics: Diagnostic[]
}

export type AdapterRuntimeMode = 'dependency' | 'managed-runtime' | 'configured-runtime'
export type AdapterRuntimeEcosystem = 'node' | 'python' | 'custom'
export type AdapterRuntimeState = 'available' | 'installed' | 'missing' | 'install-failed' | 'not-required'

export interface AdapterRuntimeCommand {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface AdapterRuntimePythonRequirement {
  candidates?: string[]
  minVersion?: string
  maxVersionExclusive?: string
}

export interface AdapterRuntimeRequirement {
  mode: AdapterRuntimeMode
  ecosystem?: AdapterRuntimeEcosystem
  packageName?: string
  version?: string
  executable?: string
  runtimeDir?: string
  python?: AdapterRuntimePythonRequirement
  installCommands?: AdapterRuntimeCommand[]
  configuredEnvVar?: string
  metadata?: Record<string, unknown>
}

export interface AdapterRuntimeInstallPlan {
  schemaVersion: 'context-adapter-runtime-install-plan.v1'
  adapterId: string
  mode: 'managed-runtime'
  ecosystem: AdapterRuntimeEcosystem
  packageName?: string
  runtimeDir: string
  markerPath: string
  commands: AdapterRuntimeCommand[]
  metadata?: Record<string, unknown>
}

export interface AdapterRuntimeStatus {
  schemaVersion: 'context-adapter-runtime-status.v1'
  adapterId: string
  mode: AdapterRuntimeMode
  state: AdapterRuntimeState
  requirement: AdapterRuntimeRequirement
  packageName?: string
  runtimeDir?: string
  markerPath?: string
  installedAt?: string
  installPlan?: AdapterRuntimeInstallPlan
  diagnostics: Diagnostic[]
  metadata?: Record<string, unknown>
}

export type ContextProgressStream = 'stdout' | 'stderr'

export interface ContextProgressInfo {
  phaseId?: string
  phaseLabel?: string
  unitId?: string
  unitLabel?: string
  percent?: number
  current?: number
  total?: number
  indeterminate?: boolean
}

export interface ContextProgressEvent {
  schemaVersion: 'context-progress-event.v1'
  type: string
  message: string
  timestamp: string
  stage?: PipelineStage
  componentId?: string
  adapterId?: string
  command?: AdapterRuntimeCommand
  stream?: ContextProgressStream
  progress?: ContextProgressInfo
  metadata?: Record<string, unknown>
}

export type ContextProgressReporter = (event: ContextProgressEvent) => void

export interface GraphAdapterManifest {
  id: string
  title: string
  version: string
  scopeKinds: ContextGraphScopeKind[]
  sourceGroupKinds?: ContextSourceGroupKind[]
  inputs: string[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  stability: ComponentStability
  externalProjects?: string[]
  runtime?: AdapterRuntimeRequirement
  metadata?: Record<string, unknown>
}

export interface GraphBuildInput {
  scope: ContextGraphScope
  graph: ContextGraph
  scopeGraph?: ContextGraph
  sourceInventory?: ContextSourceInventory
  sourceEntries?: ContextSourceInventoryEntry[]
  rawArtifacts?: RawArtifact[]
  parsedArtifacts?: ParsedArtifact[]
  normalizedRecords?: NormalizedRecord[]
  config?: ContextProjectConfig
  rootDir?: string
  outputDir?: string
  artifactDir?: string
  adapterConfig?: Record<string, unknown>
  artifacts?: Record<string, unknown>
}

export interface GraphAdapterArtifact {
  id: string
  path: string
  mediaType: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface ContextGraphIndexHint {
  nodeId?: string
  edgeId?: string
  scopeId?: string
  index: string
  text?: string
  metadata?: Record<string, unknown>
}

export type GraphBuildNodePatch = Omit<ContextNode, 'type'> & { type: string }

export interface GraphBuildResult {
  nodes: GraphBuildNodePatch[]
  edges: ContextEdge[]
  diagnostics?: Diagnostic[]
  indexHints?: ContextGraphIndexHint[]
  artifacts?: GraphAdapterArtifact[]
  adapterRefs?: ContextGraphAdapterRef[]
}

export type ContextExtensionCategory = 'document' | 'knowledge' | 'code' | 'runtime' | 'source' | 'custom'
export type ContextExtensionAdapterKind = 'source-parser' | 'document-extractor' | 'graph-adapter'

export interface SourceParserAdapterManifest {
  id: string
  title: string
  version: string
  mediaTypes: string[]
  routes: ContextSourceRoute[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  stability: ComponentStability
  externalProjects?: string[]
  metadata?: Record<string, unknown>
}

export interface DocumentExtractorAdapterManifest {
  id: string
  title: string
  version: string
  mediaTypes: string[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  stability: ComponentStability
  externalProjects?: string[]
  runtime?: AdapterRuntimeRequirement
  metadata?: Record<string, unknown>
}

export type ContextExtensionAdapterManifest = SourceParserAdapterManifest | DocumentExtractorAdapterManifest | GraphAdapterManifest

export interface ContextExtensionAdapterBinding {
  kind: ContextExtensionAdapterKind
  manifest: ContextExtensionAdapterManifest
}

export interface ContextExtensionManifest {
  schemaVersion: 'context-extension.v1'
  id: string
  title: string
  version: string
  category: ContextExtensionCategory
  stability: ComponentStability
  adapters: ContextExtensionAdapterBinding[]
  externalProjects?: string[]
  metadata?: Record<string, unknown>
}

export interface SourceParserInput {
  entry: ContextSourceInventoryEntry
  bytes?: Uint8Array
  text?: string
  rootDir?: string
  outputDir?: string
  metadata?: Record<string, unknown>
}

export interface SourceParserResult {
  rawArtifacts?: RawArtifact[]
  parsedArtifacts?: ParsedArtifact[]
  diagnostics?: Diagnostic[]
  artifacts?: GraphAdapterArtifact[]
  metadata?: Record<string, unknown>
}

export interface DocumentExtractionInput {
  entry: ContextSourceInventoryEntry
  bytes?: Uint8Array
  text?: string
  scope?: ContextGraphScope
  rootDir?: string
  outputDir?: string
  metadata?: Record<string, unknown>
}

export interface DocumentExtractionResult {
  parsedArtifacts?: ParsedArtifact[]
  normalizedRecords?: NormalizedRecord[]
  diagnostics?: Diagnostic[]
  artifacts?: GraphAdapterArtifact[]
  metadata?: Record<string, unknown>
}

export interface SourceParserAdapter {
  manifest: SourceParserAdapterManifest
  parse(input: SourceParserInput): Promise<SourceParserResult>
}

export interface DocumentExtractorAdapter {
  manifest: DocumentExtractorAdapterManifest
  extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult>
}

export interface GraphAdapter {
  manifest: GraphAdapterManifest
  build(input: GraphBuildInput): Promise<GraphBuildResult>
}

/** Raw data collected by ingest components. */
export interface RawArtifact {
  id: string
  kind: 'raw'
  mediaType: string
  content: string
  source: SourceRef
  metadata?: Record<string, unknown>
}

/** Parsed source-specific structure emitted by parse components. */
export interface ParsedArtifact {
  id: string
  kind: 'parsed'
  parser: string
  source: SourceRef
  data: unknown
  metadata?: Record<string, unknown>
}

/** Unified intermediate record emitted by normalize components. */
export interface NormalizedRecord {
  id: string
  semanticType: string
  title: string
  content?: string
  domain?: string
  tags?: string[]
  source: SourceRef
  metadata?: Record<string, unknown>
}

/** Supported typed property graph node types. */
export type ContextNodeType =
  | 'Source'
  | 'SourceGroup'
  | 'SourceSnapshot'
  | 'Document'
  | 'Section'
  | 'Requirement'
  | 'BusinessRule'
  | 'AcceptanceCriteria'
  | 'Decision'
  | 'Risk'
  | 'ChangeLog'
  | 'GlossaryTerm'
  | 'Procedure'
  | 'RunbookStep'
  | 'UIFile'
  | 'UIPage'
  | 'UIFrame'
  | 'UserFlow'
  | 'UIState'
  | 'UIComponent'
  | 'Interaction'
  | 'Route'
  | 'Repository'
  | 'Module'
  | 'Package'
  | 'Class'
  | 'Interface'
  | 'Enum'
  | 'Method'
  | 'Field'
  | 'Annotation'
  | 'Bean'
  | 'Config'
  | 'Dependency'
  | 'ControllerMethod'
  | 'ServiceMethod'
  | 'RepositoryMethod'
  | 'Entity'
  | 'DTO'
  | 'Mapper'
  | 'ScheduledJob'
  | 'EventListener'
  | 'MessageConsumer'
  | 'CodeSymbol'
  | 'File'
  | 'BuildTarget'
  | 'EntryPoint'
  | 'APIEndpoint'
  | 'RequestDTO'
  | 'ResponseDTO'
  | 'ErrorCode'
  | 'ExternalAPI'
  | 'MessageTopic'
  | 'EventContract'
  | 'AuthRequirement'
  | 'TestPlan'
  | 'TestCase'
  | 'TestSuite'
  | 'TestMethod'
  | 'Fixture'
  | 'TestData'
  | 'Assertion'
  | 'CIRun'
  | 'CIJob'
  | 'Environment'
  | 'RuntimeConfig'
  | 'ConfigItem'
  | 'FeatureFlag'
  | 'DatabaseSchema'
  | 'DatabaseTable'
  | 'Metric'
  | 'LogPattern'
  | 'TraceSpan'
  | 'Deployment'
  | 'Release'
  | 'Incident'
  | 'Diagnostic'
  | 'Conflict'
  | 'Deprecation'
  | 'ManualOverride'
  | 'ContextPolicy'
  | 'ContextHealth'
  | 'Project'
  | 'Domain'

export type ContextNodeStatus =
  | 'hypothesis'
  | 'provisional'
  | 'confirmed'
  | 'active'
  | 'draft'
  | 'deprecated'
  | 'superseded'
  | 'conflicting'
  | 'unknown'

export type ContextAuthority = 'source_of_truth' | 'approved' | 'reference' | 'draft' | 'inferred'

export type ContextEdgeStatus = 'confirmed' | 'inferred' | 'rejected' | 'deprecated'

export type EvidenceType =
  | 'explicit_reference'
  | 'path_match'
  | 'name_match'
  | 'api_match'
  | 'test_match'
  | 'semantic_match'
  | 'manual'

export interface Evidence {
  type: EvidenceType
  description: string
  sourceRefs: SourceRef[]
}

/** A stable semantic fact represented as a graph node. */
export interface ContextNode {
  id: string
  type: ContextNodeType
  name: string
  scopeId?: string
  subgraphRef?: string
  parentScopeId?: string
  domain?: string
  module?: string
  sourceRefs: SourceRef[]
  status: ContextNodeStatus
  authority: ContextAuthority
  confidence: number
  tags: string[]
  properties: Record<string, unknown>
  provenance: GraphFactProvenance[]
  createdAt?: string
  updatedAt?: string
  fingerprint: string
}

/** A stable relationship between two context graph nodes. */
export interface ContextEdge {
  id: string
  from: string
  to: string
  type: string
  scopeId?: string
  confidence: number
  evidence: Evidence[]
  linker: string
  status: ContextEdgeStatus
  properties: Record<string, unknown>
  provenance: GraphFactProvenance[]
  createdAt?: string
  updatedAt?: string
  fingerprint: string
}

/** Diagnostic severity emitted by components or the kernel. */
export type DiagnosticSeverity = 'info' | 'warning' | 'error'

/** Context quality, planning, validation, or execution issue. */
export interface Diagnostic {
  id: string
  type: string
  severity: DiagnosticSeverity
  message: string
  relatedNodes: string[]
  evidence: Evidence[]
  suggestedAction?: string
  createdAt: string
  properties: Record<string, unknown>
}

/** The compiled project knowledge graph. */
export interface ContextGraph {
  nodes: ContextNode[]
  edges: ContextEdge[]
  diagnostics: Diagnostic[]
}

/** Role, task, agent, or report-oriented context package. */
export interface ContextPack {
  id: string
  kind: 'context-view' | 'task-context' | 'agent-pack' | 'report'
  title: string
  content: string
  view?: string
  task?: string
  metadata: Record<string, unknown>
}

/** File, MCP-ready record, or generated report emitted by output components. */
export interface OutputArtifact {
  id: string
  kind: 'output'
  path?: string
  mediaType: string
  content?: string
  metadata: Record<string, unknown>
}

/** JSON index manifest emitted into `.context/indexes`. */
export interface ContextIndexManifest {
  schemaVersion: string
  files: {
    graph: string
    symbols: string
    apis: string
    docs: string
    tests: string
    runtime: string
    fts: string
    fingerprints: string
    scopes: string
  }
  counts: {
    graph: number
    symbols: number
    apis: number
    docs: number
    tests: number
    runtime: number
    fts: number
    fingerprints: number
    scopes: number
  }
}

/** Expanded `.context/manifest.json` runtime entrypoint. */
export interface ContextRuntimeManifest {
  schemaVersion: string
  version: string
  project: {
    name: string
    language: string
    root: string
  }
  compiledAt: string
  compiler: {
    name: string
    version: string
    pipeline: string
  }
  scale: Record<string, number>
  graph: {
    model: 'typed-property-graph'
    storage: 'jsonl+sqlite'
    nodes: string
    edges: string
    subgraphs: string
    scopes: string
    partitions: string
    revisions: string
    patches: string
    evidenceReports: string
  }
  indexes: {
    graph: string
    symbols: string
    apis: string
    docs: string
    tests: string
    runtime: string
    fts: string
    fingerprints: string
    scopes: string
  }
  plans: {
    planningPack: string
    planningCycles: string
    sourceTriage: string
    sourceGroups: string
    workspaceGraph: string
    scopeBuild: string
    adapterPlan: string
  }
  proposals: {
    rehome: string
    corrections: string
  }
  artifacts: {
    projectBrief: string
    domains: string
    tasks: string
    reports: string
  }
  sources: {
    inventory: string
    routes: string
    unsupported: string
    summary: string
    groups: string
    packages: string
    buildUnits: string
    groupingRequest: string
    groupingDecisions: string
    correctionDecisions: string
  }
  packs: Array<{ id: string; kind: ContextPack['kind']; view?: string; task?: string }>
  runtime: {
    providers: string
    mcp: string
    tools: string
    plan: string
    config: string
    trace: string
    runSummary: string
    agentInstallPlan: string
    freshness: ContextRuntimeFreshness
    installStatus: Record<'codex' | 'claude', ContextAgentInstallStatus>
    capabilitySurfaces: Record<string, string[]>
    skills: string[]
    agents: string[]
    plugins: string[]
  }
  agents: {
    claude: string
    codex: string
    cursor: string
  }
  diagnostics: {
    health: string
    latest: string
    report: string
  }
}

/** Runtime health report used by `context doctor`. */
export interface ContextRuntimeHealth {
  schemaVersion: string
  generatedAt: string
  status: 'healthy' | 'issues'
  counts: {
    nodes: number
    edges: number
    diagnostics: number
    views: number
    indexes: number
    providers: number
    tools: number
    skills: number
  }
  diagnosticsBySeverity: Record<DiagnosticSeverity, number>
  capabilityGaps?: Array<{ id: string; diagnosticType?: string; message: string; evidence: ContextRuntimeEvidence[] }>
}

/** Mutable state exchanged between replaceable pipeline components. */
export interface PipelineState {
  rawArtifacts: RawArtifact[]
  parsedArtifacts: ParsedArtifact[]
  normalizedRecords: NormalizedRecord[]
  facts: ContextNode[]
  edges: ContextEdge[]
  graph: ContextGraph
  packs: ContextPack[]
  outputArtifacts: OutputArtifact[]
  diagnostics: Diagnostic[]
  artifacts: Record<string, unknown>
}

/** Shared execution context supplied to every component invocation. */
export interface PipelineExecutionContext {
  rootDir: string
  outputDir: string
  config: ContextProjectConfig
  pipelineId: string
  stage: PipelineStage
  onProgress?: ContextProgressReporter
}

/** Partial state mutation returned by a component. */
export type ComponentResult = Partial<PipelineState>

/** A replaceable compiler component implementation. */
export interface ContextComponent {
  manifest: ComponentManifest
  setup?(context: PipelineExecutionContext): Promise<void> | void
  start?(context: PipelineExecutionContext): Promise<void> | void
  process(state: PipelineState, context: PipelineExecutionContext): Promise<ComponentResult> | ComponentResult
  flush?(context: PipelineExecutionContext): Promise<ComponentResult | void> | ComponentResult | void
  shutdown?(context: PipelineExecutionContext): Promise<void> | void
}

/** A bundle of default components and pipelines. */
export interface ContextDistribution {
  id: string
  version: string
  components: ContextComponent[]
  pipelines: Record<string, PipelineDefinition>
  sourceParsers?: SourceParserAdapter[]
  documentExtractors?: DocumentExtractorAdapter[]
  graphAdapters?: GraphAdapter[]
  extensions?: ContextExtensionManifest[]
  planPipeline?(config: ContextProjectConfig, pipelineId: string): PipelineDefinition | undefined
  metadata?: Record<string, unknown>
}

/** Options for compiling a workspace through a configured distribution. */
export interface CompileProjectOptions {
  rootDir: string
  config: ContextProjectConfig | ContextConfigInput
  distribution: ContextDistribution
  pipelineId?: string
  outputDir?: string
  initialDiagnostics?: Diagnostic[]
  onProgress?: ContextProgressReporter
}

/** Compile result returned by the public SDK. */
export interface CompileProjectResult {
  graph: ContextGraph
  state: PipelineState
  diagnostics: Diagnostic[]
  config: ContextProjectConfig
}
