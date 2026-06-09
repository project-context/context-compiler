import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  ContextEdge,
  ContextGraph,
  ContextGraphAdapterRef,
  ContextGraphScope,
  ContextGraphScopeManifest,
  ContextNode,
  Diagnostic,
  EvidenceFinding,
  EvidenceReport,
  GraphPatch,
  GraphDrillMode,
  GraphDrillNextAction,
  GraphRevision,
  RehomeProposal
} from '../contracts/graph.js'
import type {
  SourceRef
} from '../contracts/config.js'
import type {
  ContextBuildUnitView,
  ContextCorrectionProposal,
  ContextPackageCorrectionSummary,
  ContextPackageExpansion,
  ContextPackageList,
  ContextPackageSearch,
  ContextPackageStats,
  ContextPackageSummary,
  ContextPackageView,
  ContextSourceCorrectionDecision
} from '../contracts/corrections.js'
import type {
  ContextPackageBuildUnit,
  ContextPackageRecord,
  ContextSourceGroupRecord,
  ContextSourceInventoryEntry
} from '../contracts/sources.js'
import { loadGraphFiles } from '../graph/index.js'
import { scopeDirName, scopeIdForPackage, scopeIdForSourceGroup } from '../graph/scopes.js'
import { buildContextCorrectionProposals } from './corrections.js'
import { buildContextSourceCorrectionDecisionViews } from './source-corrections.js'
import { searchContextIndex } from './search-index.js'

export interface ListContextPackagesOptions {
  outputDir: string
}

export interface GetContextPackageOptions {
  outputDir: string
  packageRef: string
}

export interface ExpandContextPackageOptions {
  outputDir: string
  packageRef: string
  mode?: GraphDrillMode
}

export interface SearchContextPackageOptions {
  outputDir: string
  query: string
  packageRef?: string
  limit?: number
}

interface PackageRuntimeFiles {
  graph: ContextGraph
  manifest: ContextGraphScopeManifest | undefined
  packages: ContextPackageRecord[]
  groups: ContextSourceGroupRecord[]
  buildUnits: ContextPackageBuildUnit[]
  entries: ContextSourceInventoryEntry[]
  evidenceReports: EvidenceReport[]
  rehomeProposals: RehomeProposal[]
  sourceCorrectionDecisions: ContextSourceCorrectionDecision[]
  overlayProposals: ContextCorrectionProposal[]
  ledgerPatches: GraphPatch[]
  submittedPatches: GraphPatch[]
  revisions: GraphRevision[]
}

const STRUCTURAL_NODE_TYPES = new Set(['Package', 'SourceGroup', 'Source', 'SourceSnapshot', 'File'])

export async function listContextPackages(options: ListContextPackagesOptions): Promise<ContextPackageList> {
  const runtime = await readPackageRuntime(options.outputDir)
  return {
    schemaVersion: 'context-package-list.v1',
    packages: runtime.packages.map((record) => packageSummary(record, runtime)),
    diagnostics: runtime.graph.diagnostics
  }
}

export async function getContextPackage(options: GetContextPackageOptions): Promise<ContextPackageView> {
  const runtime = await readPackageRuntime(options.outputDir)
  const record = resolvePackageRef(runtime.packages, options.packageRef)
  const summary = packageSummary(record, runtime)
  return {
    schemaVersion: 'context-package-view.v1',
    package: summary.package,
    scope: summary.scope,
    buildUnits: summary.buildUnits,
    adapterSelections: summary.adapterSelections,
    sourceGroups: summary.sourceGroups,
    stats: summary.stats,
    corrections: summary.corrections,
    nextActions: summary.nextActions,
    diagnostics: summary.diagnostics
  }
}

export async function expandContextPackage(options: ExpandContextPackageOptions): Promise<ContextPackageExpansion> {
  const runtime = await readPackageRuntime(options.outputDir)
  const record = resolvePackageRef(runtime.packages, options.packageRef)
  const summary = packageSummary(record, runtime)
  const mode = options.mode ?? 'summary'
  const childScopes = sourceGroupScopesForPackage(record, runtime)

  if (mode !== 'full') {
    return {
      schemaVersion: 'context-package-expansion.v1',
      mode,
      package: record,
      scope: summary.scope,
      buildUnits: summary.buildUnits,
      adapterSelections: summary.adapterSelections,
      sourceGroups: summary.sourceGroups,
      childScopes,
      files: [],
      facts: [],
      edges: [],
      corrections: summary.corrections,
      nextActions: summary.nextActions,
      diagnostics: summary.diagnostics
    }
  }

  const scopedGraphs = await readPackageScopeGraphs(options.outputDir, record, runtime)
  const nodes = uniqueNodes(scopedGraphs.flatMap((graph) => graph.nodes))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const files = uniqueNodes(nodes.filter((node) => node.type === 'File'))
  const facts = uniqueNodes(nodes.filter((node) => !STRUCTURAL_NODE_TYPES.has(node.type)))
  const edges = uniqueEdges(scopedGraphs.flatMap((graph) => graph.edges).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)))
  const diagnostics = uniqueDiagnostics([...summary.diagnostics, ...scopedGraphs.flatMap((graph) => graph.diagnostics)])

  return {
    schemaVersion: 'context-package-expansion.v1',
    mode,
    package: record,
    scope: summary.scope,
    buildUnits: summary.buildUnits,
    adapterSelections: summary.adapterSelections,
    sourceGroups: summary.sourceGroups,
    childScopes,
    files,
    facts,
    edges,
    corrections: summary.corrections,
    nextActions: summary.nextActions,
    diagnostics
  }
}

export async function searchContextPackage(options: SearchContextPackageOptions): Promise<ContextPackageSearch> {
  const runtime = await readPackageRuntime(options.outputDir)
  const record = options.packageRef ? resolvePackageRef(runtime.packages, options.packageRef) : undefined
  const scope = record ? packageScopeFor(record, runtime) : undefined
  const search = await searchContextIndex({
    outputDir: options.outputDir,
    graph: runtime.graph,
    query: options.query,
    limit: options.limit
  })
  const packageResults = record ? search.results.filter((node) => nodeWithinPackage(node, record, runtime.groups)) : search.results
  return {
    schemaVersion: 'context-package-search.v1',
    query: options.query,
    package: record,
    scope,
    engine: search.engine,
    indexPath: search.indexPath,
    results: packageResults.slice(0, options.limit ?? 20),
    diagnostics: search.diagnostics
  }
}

async function readPackageRuntime(outputDir: string): Promise<PackageRuntimeFiles> {
  const [graph, manifest, packages, groups, buildUnits, entries, evidenceReports, rehomeProposals, sourceCorrectionDecisions, overlayProposals, ledgerPatches, submittedPatches, revisions] = await Promise.all([
    loadGraphFiles(outputDir),
    readScopeManifest(outputDir),
    readJsonlOptional<ContextPackageRecord>(resolve(outputDir, 'model', 'packages.jsonl')),
    readJsonlOptional<ContextSourceGroupRecord>(resolve(outputDir, 'model', 'groups.jsonl')),
    readJsonlOptional<ContextPackageBuildUnit>(resolve(outputDir, 'model', 'build-units.jsonl')),
    readJsonlOptional<ContextSourceInventoryEntry>(resolve(outputDir, 'model', 'source-inventory.jsonl')),
    readJsonlOptional<EvidenceReport>(resolve(outputDir, 'graph', 'evidence-reports.jsonl')),
    readJsonlOptional<RehomeProposal>(resolve(outputDir, 'state', 'rehome-proposals.jsonl')),
    readJsonlOptional<ContextSourceCorrectionDecision>(resolve(outputDir, 'state', 'source-correction-decisions.jsonl')),
    readJsonlOptional<ContextCorrectionProposal>(resolve(outputDir, 'state', 'corrections.jsonl')),
    readJsonlOptional<GraphPatch>(resolve(outputDir, 'graph', 'patches.jsonl')),
    readJsonlOptional<GraphPatch>(resolve(outputDir, 'graph', 'submitted-patches.jsonl')),
    readJsonlOptional<GraphRevision>(resolve(outputDir, 'graph', 'revisions.jsonl'))
  ])
  const graphGroups = sourceGroupsFromGraph(graph)
  const sourceGroups = groups.length > 0 ? groups : graphGroups.length > 0 ? graphGroups : sourceGroupsFromEntries(entries)
  const graphPackages = packagesFromGraph(graph, sourceGroups)
  const packageRecords = packages.length > 0 ? packages : graphPackages.length > 0 ? graphPackages : packagesFromSourceGroups(sourceGroups)
  return {
    graph,
    manifest,
    packages: packageRecords.map((record) => ({
      ...record,
      buildUnits: buildUnitsForPackage(record, buildUnits.length > 0 ? buildUnits : record.buildUnits)
    })),
    groups: sourceGroups,
    buildUnits,
    entries,
    evidenceReports,
    rehomeProposals,
    sourceCorrectionDecisions,
    overlayProposals,
    ledgerPatches,
    submittedPatches,
    revisions
  }
}

function packageSummary(record: ContextPackageRecord, runtime: PackageRuntimeFiles): ContextPackageSummary {
  const sourceGroups = sourceGroupsForPackage(record, runtime)
  const scope = packageScopeFor(record, runtime)
  const buildUnits = buildUnitViews(record, runtime)
  const adapterSelections = uniqueAdapterRefs(buildUnits.map((unit) => unit.adapterSelection))
  const corrections = packageCorrections(record, runtime, scope, sourceGroups)
  return {
    package: {
      ...record,
      buildUnits
    },
    scope,
    buildUnits,
    adapterSelections,
    sourceGroups,
    stats: packageStats(record, runtime, scope, buildUnits, sourceGroups),
    corrections,
    nextActions: packageNextActions(record, scope, sourceGroups, runtime, corrections),
    diagnostics: packageDiagnostics(record, runtime)
  }
}

function buildUnitViews(record: ContextPackageRecord, runtime: PackageRuntimeFiles): ContextBuildUnitView[] {
  const groups = sourceGroupsForPackage(record, runtime)
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  return buildUnitsForPackage(record, runtime.buildUnits.length > 0 ? runtime.buildUnits : record.buildUnits).map((unit) => ({
    ...unit,
    inventoryOnly: isInventoryOnlyBuildUnit(unit),
    sourceGroups: unit.sourceGroupIds.map((id) => groupsById.get(id)).filter((group): group is ContextSourceGroupRecord => Boolean(group))
  }))
}

function buildUnitsForPackage(record: ContextPackageRecord, buildUnits: ContextPackageBuildUnit[]): ContextPackageBuildUnit[] {
  const groupIds = new Set(record.sourceGroupIds)
  const fromFlatFile = buildUnits.filter((unit) => unit.sourceGroupIds.some((id) => groupIds.has(id)) || (unit.path !== undefined && normalizePath(unit.path) === normalizePath(record.path)))
  const selected = fromFlatFile.length > 0 ? fromFlatFile : record.buildUnits
  return selected.map((unit) => ({
    ...unit,
    adapterSelection: unit.adapterSelection ?? {
      adapterId: unit.adapterId,
      role: unit.standardKind === 'repository' ? 'code-graph-builder' : unit.standardKind === 'inventory' ? 'inventory' : 'semantic-graph-builder'
    }
  }))
}

function isInventoryOnlyBuildUnit(unit: ContextPackageBuildUnit): boolean {
  return unit.standardKind === 'inventory' || unit.adapterId === 'builtin.source-inventory' || unit.adapterSelection.role === 'inventory'
}

function sourceGroupsForPackage(record: ContextPackageRecord, runtime: PackageRuntimeFiles): ContextSourceGroupRecord[] {
  const groupIds = new Set(record.sourceGroupIds)
  return runtime.groups.filter((group) => groupIds.has(group.id) || pathWithin(group.path, record.path))
}

function packageScopeFor(record: ContextPackageRecord, runtime: PackageRuntimeFiles): ContextGraphScope | undefined {
  const expectedId = scopeIdForPackage(record.id)
  return runtime.manifest?.scopes.find((scope) =>
    scope.id === expectedId ||
    scope.packageId === record.id ||
    scope.rootNodeId === record.id ||
    (scope.kind === 'package' && normalizePath(scope.path) === normalizePath(record.path))
  )
}

function sourceGroupScopesForPackage(record: ContextPackageRecord, runtime: PackageRuntimeFiles): ContextGraphScope[] {
  const packageScope = packageScopeFor(record, runtime)
  const sourceGroupIds = new Set(record.sourceGroupIds)
  return (runtime.manifest?.scopes ?? []).filter((scope) =>
    scope.kind === 'source_group' &&
    (sourceGroupIds.has(scope.sourceGroupId ?? '') || scope.parentScopeId === packageScope?.id || pathWithin(scope.path ?? '', record.path))
  )
}

function packageStats(
  record: ContextPackageRecord,
  runtime: PackageRuntimeFiles,
  scope: ContextGraphScope | undefined,
  buildUnits: ContextBuildUnitView[],
  sourceGroups: ContextSourceGroupRecord[]
): ContextPackageStats {
  if (scope) {
    return {
      nodes: scope.stats.nodes,
      edges: scope.stats.edges,
      diagnostics: scope.stats.diagnostics,
      files: scope.stats.files,
      groups: sourceGroups.length,
      buildUnits: buildUnits.length,
      inventoryOnlyBuildUnits: buildUnits.filter((unit) => unit.inventoryOnly).length
    }
  }
  const nodes = runtime.graph.nodes.filter((node) => nodeWithinPackage(node, record, runtime.groups))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = runtime.graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  return {
    nodes: nodes.length,
    edges: edges.length,
    diagnostics: packageDiagnostics(record, runtime).length,
    files: runtime.entries.filter((entry) => pathWithin(entry.path, record.path)).length,
    groups: sourceGroups.length,
    buildUnits: buildUnits.length,
    inventoryOnlyBuildUnits: buildUnits.filter((unit) => unit.inventoryOnly).length
  }
}

function packageNextActions(
  record: ContextPackageRecord,
  scope: ContextGraphScope | undefined,
  sourceGroups: ContextSourceGroupRecord[],
  runtime: PackageRuntimeFiles,
  corrections: ContextPackageCorrectionSummary
): GraphDrillNextAction[] {
  const actions: GraphDrillNextAction[] = [
    {
      type: 'expand_package',
      targetId: record.id,
      label: `Expand ${record.title}`,
      reason: 'Open the L1 source groups under this package.',
      scopeId: scope?.id
    }
  ]
  if (scope) {
    actions.push({
      type: 'open_scope',
      targetId: scope.id,
      label: `Open ${scope.title} graph scope`,
      reason: 'Inspect the low-level package graph scope.',
      scopeId: scope.id
    })
  }
  const scopes = sourceGroupScopesForPackage(record, runtime)
  for (const group of sourceGroups) {
    const groupScope = scopes.find((candidate) => candidate.sourceGroupId === group.id) ?? runtime.manifest?.scopes.find((candidate) => candidate.id === scopeIdForSourceGroup(group.id))
    if (!groupScope) {
      continue
    }
    actions.push({
      type: 'open_scope',
      targetId: groupScope.id,
      label: `Open ${group.title}`,
      reason: 'Drill down into the L1 source group scope.',
      scopeId: groupScope.id
    })
  }
  actions.push({
    type: 'search_package',
    targetId: record.id,
    label: `Search ${record.title}`,
    reason: 'Search only within this package boundary.',
    scopeId: scope?.id
  })
  if (corrections.decisionCounts.total > 0 || corrections.proposalCounts.total > 0 || corrections.counts.findings > 0 || corrections.counts.proposedPatches > 0 || corrections.counts.rehomeProposals > 0) {
    actions.push({
      type: 'review_corrections',
      targetId: record.id,
      label: `Review corrections for ${record.title}`,
      reason: `Review correction decisions with context package correction decisions ${record.path}, then inspect package correction proposals before using low-level graph patch tools.`,
      scopeId: scope?.id
    })
  }
  return dedupeActions(actions)
}

function packageCorrections(
  record: ContextPackageRecord,
  runtime: PackageRuntimeFiles,
  scope: ContextGraphScope | undefined,
  sourceGroups: ContextSourceGroupRecord[]
): ContextPackageCorrectionSummary {
  const context = packageCorrectionContext(record, runtime, scope, sourceGroups)
  const evidenceReports = runtime.evidenceReports.flatMap((report) => packageEvidenceReport(report, context))
  const reportProposals = evidenceReports.flatMap((report) => report.rehomeProposals)
  const rehomeProposals = uniqueById([...reportProposals, ...runtime.rehomeProposals.filter((proposal) => rehomeProposalWithinPackage(proposal, context))])
  const proposedPatches = uniqueById(evidenceReports.flatMap((report) => report.proposedPatches))
  const findings = evidenceReports.flatMap((report) => report.findings)
  const proposals = buildContextCorrectionProposals({
    graph: runtime.graph,
    manifest: runtime.manifest,
    packages: runtime.packages,
    groups: runtime.groups,
    entries: runtime.entries,
    evidenceReports: runtime.evidenceReports,
    rehomeProposals: runtime.rehomeProposals,
    overlayProposals: runtime.overlayProposals,
    ledgerPatches: runtime.ledgerPatches,
    submittedPatches: runtime.submittedPatches,
    revisions: runtime.revisions
  }).filter((proposal) => proposal.packageId === record.id)
  const decisionViews = buildContextSourceCorrectionDecisionViews({
    packages: runtime.packages,
    groups: runtime.groups,
    entries: runtime.entries,
    decisions: runtime.sourceCorrectionDecisions
  }).filter((view) => view.package?.id === record.id || sourceCorrectionDecisionWithinPackage(view.decision, record))
  return {
    counts: {
      evidenceReports: evidenceReports.length,
      findings: findings.length,
      proposedPatches: proposedPatches.length,
      rehomeProposals: rehomeProposals.length,
      byFindingType: findingCounts(findings)
    },
    proposalCounts: correctionProposalCounts(proposals),
    decisionCounts: sourceCorrectionDecisionCounts(decisionViews),
    pendingProposalIds: proposals.filter((proposal) => proposal.status === 'proposed' && !proposal.blocked).map((proposal) => proposal.id),
    approvedProposalIds: proposals.filter((proposal) => proposal.status === 'approved').map((proposal) => proposal.id),
    appliedProposalIds: proposals.filter((proposal) => proposal.status === 'applied').map((proposal) => proposal.id),
    rejectedProposalIds: proposals.filter((proposal) => proposal.status === 'rejected').map((proposal) => proposal.id),
    activeDecisionIds: decisionViews.filter((view) => view.active).map((view) => view.decision.id),
    driftedDecisionIds: decisionViews.filter((view) => view.drifts.length > 0).map((view) => view.decision.id),
    nextRecommendedProposalId: nextRecommendedCorrectionProposalId(proposals),
    evidenceReports,
    proposedPatches,
    rehomeProposals
  }
}

function sourceCorrectionDecisionCounts(decisions: ReturnType<typeof buildContextSourceCorrectionDecisionViews>): ContextPackageCorrectionSummary['decisionCounts'] {
  const byKind: ContextPackageCorrectionSummary['decisionCounts']['byKind'] = {}
  const byStatus: ContextPackageCorrectionSummary['decisionCounts']['byStatus'] = {}
  for (const view of decisions) {
    byKind[view.decision.kind] = (byKind[view.decision.kind] ?? 0) + 1
    byStatus[view.effectiveStatus] = (byStatus[view.effectiveStatus] ?? 0) + 1
  }
  return {
    total: decisions.length,
    active: decisions.filter((view) => view.active).length,
    applied: byStatus.applied ?? 0,
    superseded: byStatus.superseded ?? 0,
    reverted: byStatus.reverted ?? 0,
    invalid: byStatus.invalid ?? 0,
    drifted: decisions.filter((view) => view.drifts.length > 0).length,
    byKind,
    byStatus
  }
}

function correctionProposalCounts(proposals: ContextCorrectionProposal[]): ContextPackageCorrectionSummary['proposalCounts'] {
  const byKind: ContextPackageCorrectionSummary['proposalCounts']['byKind'] = {}
  const byStatus: ContextPackageCorrectionSummary['proposalCounts']['byStatus'] = {}
  const byRiskLevel: ContextPackageCorrectionSummary['proposalCounts']['byRiskLevel'] = {}
  for (const proposal of proposals) {
    byKind[proposal.kind] = (byKind[proposal.kind] ?? 0) + 1
    byStatus[proposal.status] = (byStatus[proposal.status] ?? 0) + 1
    byRiskLevel[proposal.impact.riskLevel] = (byRiskLevel[proposal.impact.riskLevel] ?? 0) + 1
  }
  return {
    total: proposals.length,
    proposed: byStatus.proposed ?? 0,
    approved: byStatus.approved ?? 0,
    rejected: byStatus.rejected ?? 0,
    applied: byStatus.applied ?? 0,
    blocked: proposals.filter((proposal) => proposal.blocked).length,
    conflicted: proposals.filter((proposal) => proposal.conflicts.length > 0).length,
    byKind,
    byStatus,
    byRiskLevel
  }
}

function nextRecommendedCorrectionProposalId(proposals: ContextCorrectionProposal[]): string | undefined {
  return proposals.find((proposal) => proposal.status === 'approved' && !proposal.blocked)?.id ??
    proposals.find((proposal) => proposal.status === 'proposed' && !proposal.blocked)?.id ??
    [...proposals]
      .filter((proposal) => proposal.conflicts.every((conflict) => conflict.severity === 'warning'))
      .sort((left, right) => right.confidence - left.confidence)[0]?.id
}

interface PackageCorrectionContext {
  record: ContextPackageRecord
  groupIds: Set<string>
  nodeIds: Set<string>
  scopeIds: Set<string>
}

function packageCorrectionContext(
  record: ContextPackageRecord,
  runtime: PackageRuntimeFiles,
  scope: ContextGraphScope | undefined,
  sourceGroups: ContextSourceGroupRecord[]
): PackageCorrectionContext {
  const groupIds = new Set(record.sourceGroupIds)
  for (const group of sourceGroups) {
    groupIds.add(group.id)
  }
  const nodeIds = new Set(runtime.graph.nodes.filter((node) => nodeWithinPackage(node, record, runtime.groups)).map((node) => node.id))
  nodeIds.add(record.id)
  for (const groupId of groupIds) {
    nodeIds.add(groupId)
  }
  const scopeIds = new Set<string>([
    scopeIdForPackage(record.id),
    ...[...groupIds].map((groupId) => scopeIdForSourceGroup(groupId))
  ])
  if (scope) {
    scopeIds.add(scope.id)
  }
  for (const childScope of sourceGroupScopesForPackage(record, runtime)) {
    scopeIds.add(childScope.id)
  }
  return { record, groupIds, nodeIds, scopeIds }
}

function packageEvidenceReport(report: EvidenceReport, context: PackageCorrectionContext): EvidenceReport[] {
  const findings = report.findings.filter((finding) => findingWithinPackage(finding, context))
  const proposedPatches = report.proposedPatches.filter((patch) => patchWithinPackage(patch, context))
  const rehomeProposals = report.rehomeProposals.filter((proposal) => rehomeProposalWithinPackage(proposal, context))
  const scopeMatches = context.scopeIds.has(report.scopeId)
  if (!scopeMatches && findings.length === 0 && proposedPatches.length === 0 && rehomeProposals.length === 0) {
    return []
  }
  return [{
    ...report,
    findings: scopeMatches && findings.length === 0 ? report.findings.filter((finding) => findingWithinPackage(finding, context)) : findings,
    proposedPatches: scopeMatches && proposedPatches.length === 0 ? report.proposedPatches.filter((patch) => patchWithinPackage(patch, context)) : proposedPatches,
    rehomeProposals
  }]
}

function findingWithinPackage(finding: EvidenceFinding, context: PackageCorrectionContext): boolean {
  return Boolean(
    idWithinPackage(finding.nodeId, context) ||
    idWithinPackage(finding.targetGroupId, context) ||
    (finding.affectedNodeIds ?? []).some((nodeId) => idWithinPackage(nodeId, context)) ||
    pathWithinPackage(finding.sourcePath, context) ||
    pathWithinPackage(finding.suggestedPath, context) ||
    sourceRefsWithinPackage(finding.evidenceRefs ?? [], context) ||
    sourceRefsWithinPackage(finding.evidence.flatMap((item) => item.sourceRefs), context)
  )
}

function patchWithinPackage(patch: GraphPatch, context: PackageCorrectionContext): boolean {
  return Boolean(
    sourceRefsWithinPackage(patch.evidence.flatMap((item) => item.sourceRefs), context) ||
    patch.operations.some((operation) => {
      switch (operation.op) {
        case 'add_node':
        case 'restore_node_snapshot':
          return nodeIdOrRefsWithinPackage(operation.node.id, operation.node.sourceRefs, context)
        case 'update_node':
        case 'deprecate_node':
          return idWithinPackage(operation.nodeId, context)
        case 'relabel_source_group':
          return idWithinPackage(operation.nodeId, context)
        case 'reparent_node':
          return idWithinPackage(operation.nodeId, context) || idWithinPackage(operation.sourceGroupId, context)
        case 'add_edge':
        case 'link':
          return edgeWithinPackage(operation.edge.from, operation.edge.to, context)
        case 'deprecate_edge':
          return false
        case 'rehome_proposal':
          return rehomeProposalWithinPackage(operation.proposal, context)
      }
    })
  )
}

function rehomeProposalWithinPackage(proposal: RehomeProposal, context: PackageCorrectionContext): boolean {
  return Boolean(
    idWithinPackage(proposal.fromGroupId, context) ||
    idWithinPackage(proposal.toGroupId, context) ||
    pathWithinPackage(proposal.sourcePath, context) ||
    pathWithinPackage(proposal.suggestedPath, context) ||
    sourceRefsWithinPackage(proposal.evidence.flatMap((item) => item.sourceRefs), context)
  )
}

function nodeIdOrRefsWithinPackage(nodeId: string, refs: SourceRef[], context: PackageCorrectionContext): boolean {
  return idWithinPackage(nodeId, context) || sourceRefsWithinPackage(refs, context)
}

function edgeWithinPackage(from: string, to: string, context: PackageCorrectionContext): boolean {
  return idWithinPackage(from, context) || idWithinPackage(to, context)
}

function idWithinPackage(id: string | undefined, context: PackageCorrectionContext): boolean {
  return typeof id === 'string' && (context.nodeIds.has(id) || context.groupIds.has(id) || id === context.record.id)
}

function pathWithinPackage(path: string | undefined, context: PackageCorrectionContext): boolean {
  return typeof path === 'string' && pathWithin(path, context.record.path)
}

function sourceCorrectionDecisionWithinPackage(decision: ContextSourceCorrectionDecision, record: ContextPackageRecord): boolean {
  return Boolean(
    decision.packageId === record.id ||
    (decision.sourceGroupId && record.sourceGroupIds.includes(decision.sourceGroupId)) ||
    (decision.targetGroupId && record.sourceGroupIds.includes(decision.targetGroupId)) ||
    (decision.sourcePath && pathWithin(decision.sourcePath, record.path)) ||
    (decision.targetPath && pathWithin(decision.targetPath, record.path))
  )
}

function sourceRefsWithinPackage(sourceRefs: SourceRef[], context: PackageCorrectionContext): boolean {
  return sourceRefs.some((sourceRef) => sourceRef.location?.path && pathWithinPackage(sourceRef.location.path, context))
}

function findingCounts(findings: EvidenceFinding[]): Partial<Record<EvidenceFinding['type'], number>> {
  const counts: Partial<Record<EvidenceFinding['type'], number>> = {}
  for (const finding of findings) {
    counts[finding.type] = (counts[finding.type] ?? 0) + 1
  }
  return counts
}

function packageDiagnostics(record: ContextPackageRecord, runtime: PackageRuntimeFiles): Diagnostic[] {
  const nodeIds = new Set(runtime.graph.nodes.filter((node) => nodeWithinPackage(node, record, runtime.groups)).map((node) => node.id))
  return runtime.graph.diagnostics.filter((diagnostic) => diagnostic.relatedNodes.some((nodeId) => nodeIds.has(nodeId)))
}

async function readPackageScopeGraphs(outputDir: string, record: ContextPackageRecord, runtime: PackageRuntimeFiles): Promise<ContextGraph[]> {
  const packageScope = packageScopeFor(record, runtime)
  const scopes = packageScope
    ? descendantsOfScope(runtime.manifest, packageScope.id, true)
    : sourceGroupScopesForPackage(record, runtime)
  const scopedGraphs = await Promise.all(scopes.map((scope) => readScopeGraph(outputDir, scope).catch(() => emptyGraph())))
  if (scopedGraphs.length > 0) {
    return scopedGraphs
  }
  return [{
    nodes: runtime.graph.nodes.filter((node) => nodeWithinPackage(node, record, runtime.groups)),
    edges: runtime.graph.edges,
    diagnostics: packageDiagnostics(record, runtime)
  }]
}

function descendantsOfScope(manifest: ContextGraphScopeManifest | undefined, scopeId: string, includeSelf: boolean): ContextGraphScope[] {
  if (!manifest) {
    return []
  }
  const selected: ContextGraphScope[] = []
  const queue = includeSelf ? [scopeId] : manifest.scopes.filter((scope) => scope.parentScopeId === scopeId).map((scope) => scope.id)
  const seen = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    const scope = manifest.scopes.find((candidate) => candidate.id === id)
    if (scope) {
      selected.push(scope)
    }
    queue.push(...manifest.scopes.filter((candidate) => candidate.parentScopeId === id).map((candidate) => candidate.id))
  }
  return selected
}

async function readScopeGraph(outputDir: string, scope: ContextGraphScope & { nodes?: string; edges?: string }): Promise<ContextGraph> {
  const nodesPath = scope.nodes ?? `.context/graph/scopes/${scopeDirName(scope.id)}/nodes.jsonl`
  const edgesPath = scope.edges ?? `.context/graph/scopes/${scopeDirName(scope.id)}/edges.jsonl`
  const [nodes, edges] = await Promise.all([
    readJsonlOptional<ContextNode>(resolveContextPath(outputDir, nodesPath)),
    readJsonlOptional<ContextEdge>(resolveContextPath(outputDir, edgesPath))
  ])
  return { nodes, edges, diagnostics: [] }
}

function resolvePackageRef(packages: ContextPackageRecord[], ref: string): ContextPackageRecord {
  const normalizedRef = normalizeRef(ref)
  const exact = packages.find((record) =>
    normalizeRef(record.id) === normalizedRef ||
    normalizeRef(record.path) === normalizedRef ||
    normalizeRef(record.title) === normalizedRef
  )
  if (exact) {
    return exact
  }
  const fuzzy = packages.filter((record) =>
    normalizeRef(record.id).includes(normalizedRef) ||
    normalizeRef(record.path).includes(normalizedRef) ||
    normalizeRef(record.title).includes(normalizedRef)
  )
  if (fuzzy.length === 1) {
    return fuzzy[0] as ContextPackageRecord
  }
  if (fuzzy.length > 1) {
    throw new Error(`Context package reference is ambiguous: ${ref}. Matches: ${fuzzy.map((record) => record.id).join(', ')}`)
  }
  throw new Error(`Context package not found: ${ref}`)
}

function nodeWithinPackage(node: ContextNode, record: ContextPackageRecord, groups: ContextSourceGroupRecord[]): boolean {
  if (node.id === record.id || record.sourceGroupIds.includes(node.id)) {
    return true
  }
  if (record.sourceGroupIds.includes(String(node.properties.sourceGroupId ?? ''))) {
    return true
  }
  const nodePath = pathFromProperties(node.properties)
  if (nodePath && pathWithin(nodePath, record.path)) {
    return true
  }
  if (node.sourceRefs.some((sourceRef) => sourceRef.location?.path && pathWithin(sourceRef.location.path, record.path))) {
    return true
  }
  return groups
    .filter((group) => record.sourceGroupIds.includes(group.id))
    .some((group) => node.sourceRefs.some((sourceRef) => sourceRef.location?.path && pathWithin(sourceRef.location.path, group.path)))
}

function pathFromProperties(properties: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'file', 'sourcePath']) {
    const value = properties[key]
    if (typeof value === 'string') {
      return value
    }
  }
  return undefined
}

function packagesFromGraph(graph: ContextGraph, groups: ContextSourceGroupRecord[]): ContextPackageRecord[] {
  return graph.nodes.filter((node) => node.type === 'Package').map((node) => {
    const path = typeof node.properties.path === 'string' ? node.properties.path : node.sourceRefs[0]?.location?.path ?? node.name
    const sourceGroupIds = Array.isArray(node.properties.sourceGroupIds)
      ? node.properties.sourceGroupIds.filter((id): id is string => typeof id === 'string')
      : groups.filter((group) => pathWithin(group.path, path)).map((group) => group.id)
    return {
      id: node.id,
      sourceName: typeof node.properties.sourceName === 'string' ? node.properties.sourceName : node.sourceRefs[0]?.sourceId ?? 'source',
      path,
      title: node.name,
      kind: packageKind(typeof node.properties.packageKind === 'string' ? node.properties.packageKind : undefined),
      summary: typeof node.properties.summary === 'string' ? node.properties.summary : node.name,
      sourceGroupIds,
      buildUnits: [],
      confidence: node.confidence,
      decisionSource: 'inferred',
      sourceRef: node.sourceRefs[0] ?? { sourceId: 'source', uri: `file://${path}`, location: { path } }
    }
  })
}

function sourceGroupsFromGraph(graph: ContextGraph): ContextSourceGroupRecord[] {
  return graph.nodes.filter((node) => node.type === 'SourceGroup').map((node) => {
    const path = typeof node.properties.path === 'string' ? node.properties.path : node.sourceRefs[0]?.location?.path ?? node.name
    return {
      id: node.id,
      sourceName: typeof node.properties.sourceName === 'string' ? node.properties.sourceName : node.sourceRefs[0]?.sourceId ?? 'source',
      path,
      title: node.name,
      kind: sourceGroupKind(typeof node.properties.kind === 'string' ? node.properties.kind : undefined),
      boundaryMode: 'collapsed',
      summary: typeof node.properties.summary === 'string' ? node.properties.summary : node.name,
      confidence: node.confidence,
      decisionSource: 'inferred',
      sourceRef: node.sourceRefs[0] ?? { sourceId: 'source', uri: `file://${path}`, location: { path } }
    }
  })
}

function sourceGroupsFromEntries(entries: ContextSourceInventoryEntry[]): ContextSourceGroupRecord[] {
  const bySource = new Map<string, ContextSourceInventoryEntry[]>()
  for (const entry of entries) {
    bySource.set(entry.sourceName, [...(bySource.get(entry.sourceName) ?? []), entry])
  }
  return [...bySource.entries()].map(([sourceName, sourceEntries]) => {
    const root = sourceRootPath(sourceEntries)
    const first = sourceEntries[0]
    return {
      id: `SOURCE-GROUP-${stableId(sourceName)}-${stableId(root)}`,
      sourceName,
      path: root,
      title: titleFromPath(root, sourceName),
      kind: sourceGroupKindForEntries(sourceEntries),
      boundaryMode: sourceEntries.some((entry) => entry.route === 'code') ? 'repository' : 'collapsed',
      summary: `Source group inferred from ${sourceEntries.length} inventory entr${sourceEntries.length === 1 ? 'y' : 'ies'}.`,
      confidence: 0.5,
      decisionSource: 'inferred',
      sourceRef: first?.sourceRef ?? { sourceId: sourceName, uri: `file://${root}`, location: { path: root } }
    }
  })
}

function packagesFromSourceGroups(groups: ContextSourceGroupRecord[]): ContextPackageRecord[] {
  return groups.map((group) => {
    const standardKind = standardKindForGroup(group.kind)
    const adapterSelection = adapterSelectionForStandardKind(standardKind, group.kind)
    const id = `PACKAGE-${stableId(group.sourceName)}-${stableId(group.path)}`
    return {
      id,
      sourceName: group.sourceName,
      path: group.path,
      title: group.title,
      kind: packageKindForGroup(group.kind),
      summary: group.summary,
      sourceGroupIds: [group.id],
      buildUnits: [{
        id: `unit:${id}`,
        kind: buildUnitKindForStandardKind(standardKind),
        standardKind,
        title: group.title,
        sourceGroupIds: [group.id],
        adapterId: adapterSelection.adapterId,
        adapterSelection,
        path: group.path,
        summary: group.summary
      }],
      confidence: group.confidence,
      decisionSource: group.decisionSource,
      sourceRef: group.sourceRef
    }
  })
}

function sourceRootPath(entries: ContextSourceInventoryEntry[]): string {
  const roots = [...new Set(entries.map((entry) => normalizePath(entry.root)).filter(Boolean))]
  if (roots.length === 1) {
    return roots[0] as string
  }
  return commonPathPrefix(entries.map((entry) => entry.path)) || roots[0] || entries[0]?.path || 'sources'
}

function sourceGroupKindForEntries(entries: ContextSourceInventoryEntry[]): ContextSourceGroupRecord['kind'] {
  if (entries.some((entry) => entry.route === 'code')) {
    return 'repository'
  }
  if (entries.some((entry) => entry.route === 'openapi')) {
    return 'api_bundle'
  }
  if (entries.some((entry) => entry.route === 'markdown')) {
    return 'doc_bundle'
  }
  return entries.some((entry) => entry.route === 'inventory') ? 'unknown' : 'unknown'
}

function packageKindForGroup(kind: ContextSourceGroupRecord['kind']): ContextPackageRecord['kind'] {
  switch (kind) {
    case 'repository':
      return 'code_repository'
    case 'test_bundle':
      return 'test_materials'
    case 'api_bundle':
      return 'api_contracts'
    case 'doc_bundle':
    case 'domain_area':
      return 'product_docs'
    case 'analysis_bundle':
      return 'analysis'
    case 'design_bundle':
      return 'design'
    case 'data_bundle':
      return 'data'
    case 'runtime_bundle':
    case 'config_bundle':
      return 'runtime'
    case 'asset_bundle':
      return 'asset'
    default:
      return 'unknown'
  }
}

function standardKindForGroup(kind: ContextSourceGroupRecord['kind']): ContextPackageBuildUnit['standardKind'] {
  if (kind === 'repository') {
    return 'repository'
  }
  if (kind === 'api_bundle') {
    return 'api_contracts'
  }
  if (kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area' || kind === 'design_bundle' || kind === 'test_bundle') {
    return 'semantic_corpus'
  }
  return 'inventory'
}

function buildUnitKindForStandardKind(kind: ContextPackageBuildUnit['standardKind']): ContextPackageBuildUnit['kind'] {
  switch (kind) {
    case 'repository':
      return 'repository'
    case 'api_contracts':
      return 'api_contracts'
    case 'semantic_corpus':
      return 'graphrag_corpus'
    case 'inventory':
      return 'inventory'
  }
}

function adapterSelectionForStandardKind(
  standardKind: ContextPackageBuildUnit['standardKind'],
  sourceGroupKind: ContextSourceGroupRecord['kind']
): ContextGraphAdapterRef {
  switch (standardKind) {
    case 'repository':
      return {
        adapterId: 'codegraph.graph-adapter',
        role: 'code-graph-builder',
        selectionSource: 'inferred',
        selectionReason: `Inferred repository adapter for ${sourceGroupKind} source groups.`,
        priority: 0,
        candidateAdapterIds: ['codegraph.graph-adapter']
      }
    case 'api_contracts':
      return {
        adapterId: 'builtin.openapi',
        role: 'parser',
        selectionSource: 'inferred',
        selectionReason: `Inferred API contract adapter for ${sourceGroupKind} source groups.`,
        priority: 0,
        candidateAdapterIds: ['builtin.openapi']
      }
    case 'semantic_corpus':
      return {
        adapterId: 'microsoft-graphrag.graph-adapter',
        role: 'semantic-graph-builder',
        selectionSource: 'inferred',
        selectionReason: `Inferred semantic corpus adapter for ${sourceGroupKind} source groups.`,
        priority: 0,
        candidateAdapterIds: ['microsoft-graphrag.graph-adapter']
      }
    case 'inventory':
      return {
        adapterId: 'builtin.source-inventory',
        role: 'inventory',
        selectionSource: 'inferred',
        selectionReason: `Inventory-only package for ${sourceGroupKind} source groups.`,
        priority: 0,
        candidateAdapterIds: ['builtin.source-inventory']
      }
  }
}

function packageKind(value: string | undefined): ContextPackageRecord['kind'] {
  const allowed = new Set<ContextPackageRecord['kind']>(['product_docs', 'code_repository', 'api_contracts', 'test_materials', 'analysis', 'design', 'data', 'runtime', 'asset', 'unknown'])
  return allowed.has(value as ContextPackageRecord['kind']) ? value as ContextPackageRecord['kind'] : 'unknown'
}

function sourceGroupKind(value: string | undefined): ContextSourceGroupRecord['kind'] {
  const allowed = new Set<ContextSourceGroupRecord['kind']>([
    'repository',
    'doc_bundle',
    'asset_bundle',
    'analysis_bundle',
    'domain_area',
    'data_bundle',
    'api_bundle',
    'design_bundle',
    'test_bundle',
    'config_bundle',
    'runtime_bundle',
    'vendor_bundle',
    'generated_bundle',
    'archive',
    'unknown'
  ])
  return allowed.has(value as ContextSourceGroupRecord['kind']) ? value as ContextSourceGroupRecord['kind'] : 'unknown'
}

async function readScopeManifest(outputDir: string): Promise<ContextGraphScopeManifest | undefined> {
  try {
    return JSON.parse(await readFile(resolve(outputDir, 'graph', 'scopes', 'manifest.json'), 'utf8')) as ContextGraphScopeManifest
  } catch {
    return undefined
  }
}

async function readJsonlOptional<T>(path: string): Promise<T[]> {
  try {
    const content = await readFile(path, 'utf8')
    return content.trim().length === 0 ? [] : content.trim().split('\n').map((line) => JSON.parse(line) as T)
  } catch {
    const legacyPath = legacyRuntimePath(path)
    if (legacyPath && legacyPath !== path) {
      try {
        const content = await readFile(legacyPath, 'utf8')
        return content.trim().length === 0 ? [] : content.trim().split('\n').map((line) => JSON.parse(line) as T)
      } catch {
        return []
      }
    }
    return []
  }
}

function legacyRuntimePath(path: string): string | undefined {
  return path
    .replace('/model/source-inventory.jsonl', '/sources/inventory.jsonl')
    .replace('/model/groups.jsonl', '/sources/groups.jsonl')
    .replace('/model/packages.jsonl', '/sources/packages.jsonl')
    .replace('/model/build-units.jsonl', '/sources/build-units.jsonl')
    .replace('/state/rehome-proposals.jsonl', '/proposals/rehome-proposals.jsonl')
    .replace('/state/source-correction-decisions.jsonl', '/sources/correction-decisions.jsonl')
    .replace('/state/corrections.jsonl', '/proposals/corrections.jsonl')
    .replace('/graph/patches.jsonl', '/graph/patches/patches.jsonl')
    .replace('/graph/submitted-patches.jsonl', '/graph/patches/submitted.jsonl')
    .replace('/graph/revisions.jsonl', '/graph/revisions/revisions.jsonl')
}

function resolveContextPath(outputDir: string, path: string): string {
  if (path.startsWith('.context/')) {
    return resolve(outputDir, path.slice('.context/'.length))
  }
  return resolve(outputDir, path)
}

function normalizeRef(value: string): string {
  return normalizePath(value).toLowerCase()
}

function normalizePath(value: string | undefined): string {
  return (value ?? '').trim().replace(/^\.?\//, '').replace(/\/+$/g, '')
}

function pathWithin(path: string, parent: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parent)
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)
}

function commonPathPrefix(paths: string[]): string | undefined {
  const normalized = paths.map(normalizePath).filter(Boolean)
  if (normalized.length === 0) {
    return undefined
  }
  const [first, ...rest] = normalized.map((path) => path.split('/'))
  const prefix: string[] = []
  for (let index = 0; index < (first?.length ?? 0); index += 1) {
    const part = first?.[index]
    if (!part || rest.some((pathParts) => pathParts[index] !== part)) {
      break
    }
    prefix.push(part)
  }
  if (prefix.length > 1) {
    return prefix.join('/')
  }
  return normalized[0]?.split('/').slice(0, -1).join('/') || normalized[0]
}

function stableId(value: string): string {
  return normalizePath(value).replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-|-$/g, '') || 'source'
}

function titleFromPath(path: string, fallback: string): string {
  const normalized = normalizePath(path)
  return normalized.split('/').filter(Boolean).at(-1) ?? fallback
}

function uniqueAdapterRefs(refs: ContextGraphAdapterRef[]): ContextGraphAdapterRef[] {
  const seen = new Set<string>()
  const unique: ContextGraphAdapterRef[] = []
  for (const ref of refs) {
    const key = `${ref.adapterId}:${ref.role}:${ref.selectionSource ?? ''}:${ref.priority ?? ''}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(ref)
  }
  return unique
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) {
      continue
    }
    seen.add(item.id)
    unique.push(item)
  }
  return unique
}

function uniqueNodes(nodes: ContextNode[]): ContextNode[] {
  const seen = new Set<string>()
  return nodes.filter((node) => {
    if (seen.has(node.id)) {
      return false
    }
    seen.add(node.id)
    return true
  })
}

function uniqueEdges(edges: ContextEdge[]): ContextEdge[] {
  const seen = new Set<string>()
  return edges.filter((edge) => {
    if (seen.has(edge.id)) {
      return false
    }
    seen.add(edge.id)
    return true
  })
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.type}:${diagnostic.message}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function dedupeActions(actions: GraphDrillNextAction[]): GraphDrillNextAction[] {
  const seen = new Set<string>()
  return actions.filter((action) => {
    const key = `${action.type}:${action.targetId}:${action.scopeId ?? ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function emptyGraph(): ContextGraph {
  return { nodes: [], edges: [], diagnostics: [] }
}
