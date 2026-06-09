import type { ContextProjectConfig } from './config.js'
import type { ContextPackageBuildUnit, ContextPackageRecord, ContextSourceGroupBoundaryMode, ContextSourceGroupKind, ContextSourceGroupRecord, ContextSourceInventory, ContextSourceInventoryEntry } from './sources.js'
import type { ContextRuntimeFreshness } from './runtime.js'
import type { ContextCorrectionProposal, ContextCorrectionProposalCounts, ContextCorrectionProposalKind, ContextCorrectionProposalStatus, ContextSourceCorrectionDecisionCounts } from './corrections.js'
import type { SourceLocation, SourceRef } from './config.js'
import type { ComponentStability } from './pipeline.js'
import type { GraphAdapterManifest } from './adapters.js'
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

export type ContextGraphScopeKind = 'project' | 'package' | 'source_group' | 'build_graph' | 'file' | 'content'

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
  | 'RepositoryGraph'
  | 'SemanticCorpusGraph'
  | 'ApiContractGraph'
  | 'InventoryGraph'
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
