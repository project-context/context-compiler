import type { ContextRuntimeFreshness } from './runtime.js'
import type { ContextGraphAdapterRef, ContextGraphScopeKind } from './graph.js'
import type { ContextEdge, ContextNode, Diagnostic } from './graph.js'
import type { SourceRef } from './config.js'
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
