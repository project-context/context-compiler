import type { ContextPackageBuildUnit, ContextPackageRecord, ContextSourceGroupKind, ContextSourceGroupRecord } from './sources.js'
import type { SourceRef } from './config.js'
import type {
  ContextEdge,
  ContextGraph,
  ContextGraphAdapterRef,
  ContextGraphScope,
  ContextNode,
  Diagnostic,
  Evidence,
  EvidenceFinding,
  EvidenceReport,
  GraphDrillMode,
  GraphDrillNextAction,
  GraphPatch,
  GraphPatchAuthor,
  PatchOperation,
  RehomeProposal
} from './graph.js'
export type ContextCorrectionProposalKind = 'relabel' | 'split' | 'merge' | 'rehome' | 'confirm_relation' | 'reject_relation'
export type ContextCorrectionProposalStatus = 'proposed' | 'approved' | 'rejected' | 'applied'
export type ContextCorrectionAction = 'approve' | 'reject' | 'apply' | 'preview'
export type ContextCorrectionRiskLevel = 'low' | 'medium' | 'high'
export type ContextCorrectionConflictSeverity = 'warning' | 'error'
export type ContextCorrectionConflictType = 'missing_target' | 'stale_revision' | 'patch_overlap' | 'already_applied' | 'missing_graph_patch' | 'source_decision_drift'
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
  dedupeKey?: string
  proposalId: string
  kind: ContextCorrectionProposalKind
  action: ContextCorrectionProposalKind
  status: ContextSourceCorrectionDecisionStatus
  packageId?: string
  sourceGroupId?: string
  targetGroupId?: string
  sourcePath?: string
  targetPath?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  actor?: GraphPatchAuthor
  statusReason?: string
  supersedesDecisionIds?: string[]
  supersededByDecisionId?: string
  revertedByProposalId?: string
  revisionSummary?: ContextCorrectionRevisionSummary
  createdAt: string
  updatedAt?: string
  appliedRevisionId?: string
}

export type ContextSourceCorrectionDecisionStatus = 'applied' | 'superseded' | 'reverted' | 'invalid'
export type ContextSourceCorrectionDriftType =
  | 'missing_package'
  | 'missing_source_group'
  | 'missing_source_path'
  | 'missing_target_group'
  | 'grouping_conflict'
  | 'superseded_by_newer_decision'

export interface ContextSourceCorrectionDrift {
  type: ContextSourceCorrectionDriftType
  severity: ContextCorrectionConflictSeverity
  message: string
  decisionId: string
  packageId?: string
  sourceGroupId?: string
  targetGroupId?: string
  sourcePath?: string
}

export interface ContextSourceCorrectionDecisionCounts {
  total: number
  active: number
  applied: number
  superseded: number
  reverted: number
  invalid: number
  drifted: number
  byKind: Partial<Record<ContextCorrectionProposalKind, number>>
  byStatus: Partial<Record<ContextSourceCorrectionDecisionStatus, number>>
}

export interface ContextSourceCorrectionDecisionView {
  schemaVersion: 'context-source-correction-decision-view.v1'
  decision: ContextSourceCorrectionDecision
  package?: ContextPackageRecord
  sourceGroup?: ContextSourceGroupRecord
  targetGroup?: ContextSourceGroupRecord
  active: boolean
  effectiveStatus: ContextSourceCorrectionDecisionStatus
  supersedesDecisionIds: string[]
  supersededByDecisionId?: string
  drifts: ContextSourceCorrectionDrift[]
  diagnostics: Diagnostic[]
}

export interface ContextSourceCorrectionDecisionList {
  schemaVersion: 'context-source-correction-decision-list.v1'
  package?: ContextPackageRecord
  decisions: ContextSourceCorrectionDecisionView[]
  counts: ContextSourceCorrectionDecisionCounts
  diagnostics: Diagnostic[]
}

export interface ContextSourceCorrectionReplayResult {
  schemaVersion: 'context-source-correction-replay.v1'
  written: false
  package?: ContextPackageRecord
  decisionId?: string
  decisions: ContextSourceCorrectionDecisionView[]
  before: {
    packages: ContextPackageRecord[]
    groups: ContextSourceGroupRecord[]
  }
  after: {
    packages: ContextPackageRecord[]
    groups: ContextSourceGroupRecord[]
  }
  effects: ContextCorrectionOperationEffect[]
  drifts: ContextSourceCorrectionDrift[]
  diagnostics: Diagnostic[]
}

export interface ContextSourceCorrectionDecisionActionResult {
  schemaVersion: 'context-source-correction-decision-action-result.v1'
  action: 'revert'
  written: boolean
  decision: ContextSourceCorrectionDecision
  proposal?: ContextCorrectionProposal
  path?: string
  diagnostics: Diagnostic[]
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
  kind: 'evidence_report' | 'graph_patch' | 'rehome_proposal' | 'source_correction_decision' | 'status_overlay'
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
  decisionCounts: ContextSourceCorrectionDecisionCounts
  pendingProposalIds: string[]
  approvedProposalIds: string[]
  appliedProposalIds: string[]
  rejectedProposalIds: string[]
  activeDecisionIds: string[]
  driftedDecisionIds: string[]
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
