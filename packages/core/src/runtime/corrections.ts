import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  ContextCorrectionActionResult,
  ContextCorrectionConflict,
  ContextCorrectionProposal,
  ContextCorrectionProposalKind,
  ContextCorrectionRiskLevel,
  ContextCorrectionProposalStatus,
  ContextCorrectionImpact,
  ContextCorrectionOperationEffect,
  ContextCorrectionOperationPlan,
  ContextCorrectionPreview,
  ContextCorrectionRevisionSummary,
} from '../contracts/corrections.js'
import type {
  ContextGraph,
  ContextGraphScope,
  ContextGraphScopeManifest,
  Diagnostic,
  Evidence,
  EvidenceFinding,
  EvidenceReport,
  GraphPatch,
  GraphPatchAuthor,
  GraphRevision,
  PatchOperation,
  RehomeProposal
} from '../contracts/graph.js'
import type {
  ContextPackageCorrectionInbox,
  ContextSourceCorrectionDecision
} from '../contracts/corrections.js'
import type {
  ContextPackageRecord,
  ContextSourceGroupRecord,
  ContextSourceInventoryEntry
} from '../contracts/sources.js'
import type {
  ContextProjectConfig,
  SourceRef
} from '../contracts/config.js'
import { createDiagnostic } from '../diagnostics/index.js'
import { loadGraphFiles } from '../graph/index.js'
import { fingerprintValue } from '../graph/model.js'
import { scopeIdForPackage, scopeIdForSourceGroup } from '../graph/scopes.js'
import { reconcileEvidenceReports } from '../kernel/index.js'
import { createGraphRevision } from '../graph/revisions.js'
import { applySubmittedGraphPatches } from './patch-cycle.js'

export interface ListContextPackageCorrectionsOptions {
  outputDir: string
  packageRef?: string
  status?: ContextCorrectionProposalStatus
  kind?: ContextCorrectionProposalKind
}

export interface GetContextCorrectionProposalOptions {
  outputDir: string
  proposalId: string
}

export interface PreviewContextCorrectionProposalOptions {
  outputDir: string
  proposalId: string
}

export interface UpdateContextCorrectionProposalOptions {
  outputDir: string
  proposalId: string
  actor: GraphPatchAuthor
  reason?: string
  generatedAt?: string
}

export interface ApplyContextCorrectionProposalOptions {
  outputDir: string
  proposalId: string
  dryRun?: boolean
  actor?: GraphPatchAuthor
  reason?: string
  generatedAt?: string
  config?: ContextProjectConfig
}

interface CorrectionRuntimeFiles {
  graph: ContextGraph
  manifest?: ContextGraphScopeManifest
  packages: ContextPackageRecord[]
  groups: ContextSourceGroupRecord[]
  entries: ContextSourceInventoryEntry[]
  evidenceReports: EvidenceReport[]
  rehomeProposals: RehomeProposal[]
  overlayProposals: ContextCorrectionProposal[]
  ledgerPatches: GraphPatch[]
  submittedPatches: GraphPatch[]
  revisions: GraphRevision[]
}

export interface BuildContextCorrectionProposalsInput {
  graph: ContextGraph
  manifest?: ContextGraphScopeManifest
  packages: ContextPackageRecord[]
  groups: ContextSourceGroupRecord[]
  entries?: ContextSourceInventoryEntry[]
  evidenceReports?: EvidenceReport[]
  rehomeProposals?: RehomeProposal[]
  overlayProposals?: ContextCorrectionProposal[]
  ledgerPatches?: GraphPatch[]
  submittedPatches?: GraphPatch[]
  revisions?: GraphRevision[]
}

export interface BuildContextCorrectionOperationPlanInput {
  graph: ContextGraph
  packages: ContextPackageRecord[]
  groups: ContextSourceGroupRecord[]
  proposal: ContextCorrectionProposal
  generatedAt?: string
}

interface PackageContext {
  record: ContextPackageRecord
  scope?: ContextGraphScope
  groupIds: Set<string>
  nodeIds: Set<string>
  scopeIds: Set<string>
}

interface ProposalSeed {
  report?: EvidenceReport
  finding?: EvidenceFinding
  patch?: GraphPatch
  rehomeProposal?: RehomeProposal
}

interface ProposalTarget {
  key: string
  nodeId?: string
  edgeId?: string
  sourcePath?: string
}

export async function listContextPackageCorrections(options: ListContextPackageCorrectionsOptions): Promise<ContextPackageCorrectionInbox> {
  const runtime = await readCorrectionRuntime(options.outputDir)
  const packageContext = options.packageRef ? resolvePackageContext(runtime, options.packageRef) : undefined
  const proposals = buildCorrectionProposals(runtime)
    .filter((proposal) => !packageContext || proposal.packageId === packageContext.record.id)
    .filter((proposal) => !options.status || proposal.status === options.status)
    .filter((proposal) => !options.kind || proposal.kind === options.kind)
  return {
    schemaVersion: 'context-package-correction-inbox.v1',
    package: packageContext?.record,
    scope: packageContext?.scope,
    proposals,
    counts: proposalCounts(proposals),
    nextRecommendedProposalId: nextRecommendedProposalId(proposals),
    diagnostics: []
  }
}

export async function getContextCorrectionProposal(options: GetContextCorrectionProposalOptions): Promise<ContextCorrectionProposal> {
  const runtime = await readCorrectionRuntime(options.outputDir)
  const proposal = buildCorrectionProposals(runtime).find((candidate) => candidate.id === options.proposalId)
  if (!proposal) {
    throw new Error(`Context correction proposal not found: ${options.proposalId}`)
  }
  return proposal
}

export async function previewContextCorrectionProposal(options: PreviewContextCorrectionProposalOptions): Promise<ContextCorrectionPreview> {
  const runtime = await readCorrectionRuntime(options.outputDir)
  const proposal = buildCorrectionProposals(runtime).find((candidate) => candidate.id === options.proposalId)
  if (!proposal) {
    throw new Error(`Context correction proposal not found: ${options.proposalId}`)
  }
  return buildCorrectionPreview(runtime, proposal)
}

export async function approveContextCorrectionProposal(options: UpdateContextCorrectionProposalOptions): Promise<ContextCorrectionActionResult> {
  return updateContextCorrectionProposalStatus('approve', 'approved', options)
}

export async function rejectContextCorrectionProposal(options: UpdateContextCorrectionProposalOptions): Promise<ContextCorrectionActionResult> {
  const proposal = await getContextCorrectionProposal(options)
  if (proposal.status === 'applied') {
    return {
      schemaVersion: 'context-correction-action-result.v1',
      action: 'reject',
      dryRun: false,
      submitted: false,
      written: false,
      proposal,
      diagnostics: [correctionDiagnostic('correction.proposal.already-applied', proposal.id, `Correction proposal ${proposal.id} is already applied and cannot be rejected.`)]
    }
  }
  return updateContextCorrectionProposalStatus('reject', 'rejected', options)
}

export async function applyContextCorrectionProposal(options: ApplyContextCorrectionProposalOptions): Promise<ContextCorrectionActionResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const runtime = await readCorrectionRuntime(options.outputDir)
  const proposal = buildCorrectionProposals(runtime).find((candidate) => candidate.id === options.proposalId)
  if (!proposal) {
    throw new Error(`Context correction proposal not found: ${options.proposalId}`)
  }
  const graphPatch = proposal.graphPatch ? prepareGraphPatch(proposal.graphPatch, runtime, generatedAt) : undefined
  const preview = buildCorrectionPreview(runtime, proposal, graphPatch, generatedAt)
  const diagnostics: Diagnostic[] = proposal.conflicts
    .filter((conflict) => conflict.severity === 'warning')
    .map((conflict) => correctionDiagnostic('correction.proposal.conflict.warning', proposal.id, conflict.message))
  diagnostics.push(...preview.operationPlan.diagnostics)
  if (proposal.status === 'rejected') {
    diagnostics.push(correctionDiagnostic('correction.proposal.rejected', proposal.id, `Correction proposal ${proposal.id} is rejected and cannot be applied.`, 'error'))
  }
  if (proposal.status === 'applied') {
    diagnostics.push(correctionDiagnostic('correction.proposal.already-applied', proposal.id, `Correction proposal ${proposal.id} is already applied.`))
  }
  if (!options.dryRun && proposal.status !== 'approved') {
    diagnostics.push(correctionDiagnostic('correction.proposal.requires-approval', proposal.id, `Correction proposal ${proposal.id} must be approved before it can be applied.`, 'error'))
  }
  if (!options.dryRun && proposal.blocked) {
    diagnostics.push(correctionDiagnostic('correction.proposal.blocked', proposal.id, `Correction proposal ${proposal.id} is blocked by error-level conflicts.`, 'error'))
  }
  if (!proposal.graphPatch) {
    diagnostics.push(correctionDiagnostic('correction.proposal.missing-graph-patch', proposal.id, `Correction proposal ${proposal.id} has no executable graph patch.`, 'error'))
  }
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (blockingDiagnostics.length > 0 || !graphPatch) {
    return {
      schemaVersion: 'context-correction-action-result.v1',
      action: 'apply',
      dryRun: Boolean(options.dryRun),
      submitted: false,
      written: false,
      proposal,
      graphPatch,
      preview,
      operationPlan: preview.operationPlan,
      revisionSummary: preview.revisionSummary,
      diagnostics
    }
  }
  if (options.dryRun) {
    return {
      schemaVersion: 'context-correction-action-result.v1',
      action: 'apply',
      dryRun: true,
      submitted: false,
      written: false,
      proposal,
      graphPatch,
      preview,
      operationPlan: preview.operationPlan,
      revisionSummary: preview.revisionSummary,
      diagnostics
    }
  }

  await appendSourceCorrectionDecisions(options.outputDir, preview.operationPlan.sourceDecisions)
  await appendGraphPatch(options.outputDir, graphPatch)
  let revisionSummary = preview.revisionSummary
  let appliedProposal: ContextCorrectionProposal = { ...proposal, status: 'approved', graphPatch, operationPlan: preview.operationPlan, updatedAt: generatedAt }
  let submitted = true
  if (options.config) {
    const result = await applySubmittedGraphPatches({ config: options.config, generatedAt })
    revisionSummary = revisionSummaryFromPatchCycle(result.baseRevision.id, result.newRevision?.id, result.appliedPatches, result.rejectedPatches, preview.operationPlan.sourceDecisions)
    const applied = result.appliedPatches.find((patch) => patch.id === graphPatch.id)
    if (applied) {
      appliedProposal = {
        ...appliedProposal,
        status: 'applied',
        appliedRevisionId: applied.appliedRevisionId ?? result.newRevision?.id,
        graphPatch: applied,
        operationPlan: preview.operationPlan,
        updatedAt: generatedAt
      }
    }
    diagnostics.push(...result.diagnostics)
  }
  await appendCorrectionOverlay(options.outputDir, {
    ...appliedProposal,
    actor: options.actor ?? { type: 'human', name: 'context-cli' },
    statusReason: options.reason ?? appliedProposal.statusReason,
    operationPlan: preview.operationPlan,
    appliedRevisionId: appliedProposal.appliedRevisionId ?? revisionSummary?.newRevisionId,
    derivedFrom: uniqueSources([...appliedProposal.derivedFrom, { kind: 'status_overlay', id: appliedProposal.id }])
  })
  return {
    schemaVersion: 'context-correction-action-result.v1',
    action: 'apply',
    dryRun: false,
    submitted,
    written: true,
    proposal: appliedProposal,
    graphPatch: appliedProposal.graphPatch,
    preview,
    operationPlan: preview.operationPlan,
    revisionSummary,
    path: '.context/state/corrections.jsonl',
    diagnostics
  }
}

export async function summarizeContextPackageCorrections(options: ListContextPackageCorrectionsOptions): Promise<Pick<ContextPackageCorrectionInbox, 'counts' | 'nextRecommendedProposalId' | 'proposals'>> {
  const inbox = await listContextPackageCorrections(options)
  return { counts: inbox.counts, nextRecommendedProposalId: inbox.nextRecommendedProposalId, proposals: inbox.proposals }
}

export function buildContextCorrectionProposals(input: BuildContextCorrectionProposalsInput): ContextCorrectionProposal[] {
  const revisions = input.revisions ?? []
  const evidenceReports = input.evidenceReports ?? []
  const baseRevision = revisions.at(-1) ?? createGraphRevision(input.graph, { reason: 'materialized compile graph', status: 'materialized' })
  const reconciled = reconcileEvidenceReports(input.graph, baseRevision, evidenceReports)
  return buildCorrectionProposals({
    graph: input.graph,
    manifest: input.manifest,
    packages: input.packages,
    groups: input.groups,
    entries: input.entries ?? [],
    evidenceReports,
    rehomeProposals: uniqueById([...(input.rehomeProposals ?? []), ...reconciled.rehomeProposals]),
    overlayProposals: input.overlayProposals ?? [],
    ledgerPatches: uniqueById([...(input.ledgerPatches ?? []), ...(input.submittedPatches ?? []), ...reconciled.patches]),
    submittedPatches: input.submittedPatches ?? [],
    revisions
  })
}

export function buildContextCorrectionOperationPlan(input: BuildContextCorrectionOperationPlanInput): ContextCorrectionOperationPlan {
  const proposal = input.proposal
  const graphPatch = proposal.graphPatch
  const sourceEffects: ContextCorrectionOperationEffect[] = []
  const graphEffects: ContextCorrectionOperationEffect[] = []
  const sourceDecisions: ContextSourceCorrectionDecision[] = []
  const diagnostics: Diagnostic[] = []
  let effectIndex = 0

  const addSourceEffect = (effect: Omit<ContextCorrectionOperationEffect, 'id' | 'layer' | 'persistent'> & { persistent?: boolean }) => {
    sourceEffects.push({
      id: effectId(proposal.id, effectIndex++, effect.kind),
      layer: 'source',
      persistent: effect.persistent ?? true,
      ...effect
    })
  }
  const addGraphEffect = (effect: Omit<ContextCorrectionOperationEffect, 'id' | 'layer' | 'persistent'> & { persistent?: boolean }) => {
    graphEffects.push({
      id: effectId(proposal.id, effectIndex++, effect.kind),
      layer: 'graph',
      persistent: effect.persistent ?? true,
      ...effect
    })
  }
  const addDecision = (decision: Omit<ContextSourceCorrectionDecision, 'schemaVersion' | 'id' | 'proposalId' | 'status' | 'createdAt'>) => {
    sourceDecisions.push({
      schemaVersion: 'context-source-correction-decision.v1',
      id: sourceCorrectionDecisionId(proposal, sourceDecisions.length, decision.kind, decision.sourceGroupId ?? decision.sourcePath ?? decision.targetGroupId),
      proposalId: proposal.id,
      status: 'applied',
      createdAt: input.generatedAt ?? proposal.updatedAt ?? proposal.createdAt,
      ...decision
    })
  }

  for (const operation of graphPatch?.operations ?? []) {
    const target = targetForOperation(operation)
    addGraphEffect({
      kind: graphEffectKindForProposal(proposal.kind, operation),
      operation: operation.op,
      targetKind: target.kind,
      targetId: target.id,
      path: target.path,
      before: beforeForGraphOperation(input.graph, operation),
      after: afterForGraphOperation(input.graph, operation),
      summary: graphOperationSummary(operation),
      persistent: true
    })
    if (operation.op === 'relabel_source_group') {
      const group = sourceGroupForId(input.groups, operation.nodeId)
      const before = group ? sourceGroupSnapshot(group) : beforeForGraphOperation(input.graph, operation)
      const after = {
        ...before,
        kind: operation.kind,
        title: operation.title ?? stringProperty(before, 'title') ?? graphNodeName(input.graph, operation.nodeId),
        summary: operation.summary ?? stringProperty(before, 'summary'),
        confidence: operation.confidence ?? numberProperty(before, 'confidence')
      }
      addSourceEffect({
        kind: 'source_group_relabel',
        operation: 'relabel',
        targetKind: 'source_group',
        targetId: operation.nodeId,
        before,
        after,
        summary: `Relabel source group ${operation.nodeId}.`
      })
      addDecision({
        kind: 'relabel',
        action: 'relabel',
        packageId: proposal.packageId,
        sourceGroupId: operation.nodeId,
        sourcePath: group?.path ?? stringProperty(before, 'path'),
        before,
        after
      })
    }
    if (operation.op === 'add_node' && operation.node.type === 'SourceGroup') {
      const after = nodeSourceGroupSnapshot(operation.node)
      addSourceEffect({
        kind: 'source_group_split',
        operation: 'split',
        targetKind: 'source_group',
        targetId: operation.node.id,
        after,
        summary: `Create split source group ${operation.node.id}.`
      })
      addDecision({
        kind: 'split',
        action: 'split',
        packageId: proposal.packageId,
        sourceGroupId: operation.node.id,
        sourcePath: stringProperty(after, 'path'),
        after
      })
    }
    if (operation.op === 'deprecate_node' && proposal.kind === 'merge') {
      const group = sourceGroupForId(input.groups, operation.nodeId)
      const before = group ? sourceGroupSnapshot(group) : beforeForGraphOperation(input.graph, operation)
      const targetGroupId = operation.supersededBy ?? proposal.sourceGroupIds.find((id) => id !== operation.nodeId)
      const after = { ...before, mergedInto: targetGroupId, deprecated: true, reason: operation.reason }
      addSourceEffect({
        kind: 'source_group_merge',
        operation: 'merge',
        targetKind: 'source_group',
        targetId: operation.nodeId,
        before,
        after,
        summary: `Merge source group ${operation.nodeId}${targetGroupId ? ` into ${targetGroupId}` : ''}.`
      })
      addDecision({
        kind: 'merge',
        action: 'merge',
        packageId: proposal.packageId,
        sourceGroupId: operation.nodeId,
        targetGroupId,
        sourcePath: group?.path ?? stringProperty(before, 'path'),
        before,
        after
      })
    }
    if (operation.op === 'rehome_proposal') {
      appendRehomeSemantics(operation.proposal)
    }
  }

  if (proposal.rehomeProposal && !sourceDecisions.some((decision) => decision.kind === 'rehome')) {
    appendRehomeSemantics(proposal.rehomeProposal)
  }

  const requiresSourcePersistence = ['relabel', 'split', 'merge', 'rehome'].includes(proposal.kind)
  const unsupportedSourcePersistence = requiresSourcePersistence && sourceDecisions.length === 0
  if (unsupportedSourcePersistence) {
    diagnostics.push(correctionDiagnostic('correction.operation.unsupported-source-persistence', proposal.id, `Correction proposal ${proposal.id} requires source-level persistence but no source correction decision could be generated.`, 'error'))
  }
  const effects = [...sourceEffects, ...graphEffects]
  return {
    schemaVersion: 'context-correction-operation-plan.v1',
    id: `OPERATION-${stableId(proposal.id)}`,
    proposalId: proposal.id,
    kind: proposal.kind,
    effects,
    sourceEffects,
    graphEffects,
    sourceDecisions,
    graphPatchIds: graphPatch ? [graphPatch.id] : proposal.graphPatchIds,
    persistent: effects.some((effect) => effect.persistent) || sourceDecisions.length > 0,
    requiresSourcePersistence,
    unsupportedSourcePersistence,
    diagnostics
  }

  function appendRehomeSemantics(rehome: RehomeProposal): void {
    const before = {
      sourcePath: normalizePath(rehome.sourcePath),
      sourceGroupId: rehome.fromGroupId,
      action: rehome.action
    }
    const after = {
      sourcePath: normalizePath(rehome.sourcePath),
      targetPath: normalizePath(rehome.suggestedPath),
      sourceGroupId: rehome.fromGroupId,
      targetGroupId: rehome.toGroupId,
      action: rehome.action
    }
    addSourceEffect({
      kind: 'source_path_rehome',
      operation: 'rehome',
      targetKind: 'source_path',
      targetId: normalizePath(rehome.sourcePath),
      path: normalizePath(rehome.sourcePath),
      before,
      after,
      summary: `Rehome source path ${rehome.sourcePath}${rehome.suggestedPath ? ` to ${rehome.suggestedPath}` : ''}.`
    })
    addDecision({
      kind: 'rehome',
      action: 'rehome',
      packageId: proposal.packageId,
      sourceGroupId: rehome.fromGroupId,
      targetGroupId: rehome.toGroupId,
      sourcePath: normalizePath(rehome.sourcePath),
      targetPath: normalizePath(rehome.suggestedPath),
      before,
      after
    })
  }
}

function buildCorrectionPreview(
  runtime: CorrectionRuntimeFiles,
  proposal: ContextCorrectionProposal,
  graphPatch: GraphPatch | undefined = proposal.graphPatch,
  generatedAt?: string
): ContextCorrectionPreview {
  const proposalForPlan = graphPatch ? { ...proposal, graphPatch } : proposal
  const operationPlan = buildContextCorrectionOperationPlan({
    graph: runtime.graph,
    packages: runtime.packages,
    groups: runtime.groups,
    proposal: proposalForPlan,
    generatedAt
  })
  const revision = runtime.revisions.at(-1)
  return {
    schemaVersion: 'context-correction-preview.v1',
    proposal: {
      ...proposalForPlan,
      operationPlan
    },
    operationPlan,
    graphPatch,
    revisionSummary: revisionSummaryFromPatchCycle(revision?.id, undefined, graphPatch ? [graphPatch] : [], [], operationPlan.sourceDecisions),
    diagnostics: operationPlan.diagnostics
  }
}

function revisionSummaryFromPatchCycle(
  baseRevisionId: string | undefined,
  newRevisionId: string | undefined,
  appliedPatches: GraphPatch[],
  rejectedPatches: GraphPatch[],
  sourceDecisions: ContextSourceCorrectionDecision[]
): ContextCorrectionRevisionSummary {
  return {
    baseRevisionId,
    newRevisionId,
    appliedPatchIds: appliedPatches.map((patch) => patch.id),
    rejectedPatchIds: rejectedPatches.map((patch) => patch.id),
    sourceDecisionIds: sourceDecisions.map((decision) => decision.id)
  }
}

async function updateContextCorrectionProposalStatus(
  action: 'approve' | 'reject',
  status: ContextCorrectionProposalStatus,
  options: UpdateContextCorrectionProposalOptions
): Promise<ContextCorrectionActionResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const proposal = await getContextCorrectionProposal(options)
  const updated: ContextCorrectionProposal = {
    ...proposal,
    status,
    actor: options.actor,
    statusReason: options.reason,
    updatedAt: generatedAt,
    derivedFrom: uniqueSources([...proposal.derivedFrom, { kind: 'status_overlay', id: proposal.id }])
  }
  await appendCorrectionOverlay(options.outputDir, updated)
  return { schemaVersion: 'context-correction-action-result.v1', action, dryRun: false, submitted: false, written: true, proposal: updated, graphPatch: updated.graphPatch, path: '.context/state/corrections.jsonl', diagnostics: [] }
}

async function readCorrectionRuntime(outputDir: string): Promise<CorrectionRuntimeFiles> {
  const [graph, manifest, packages, groups, entries, evidenceReports, storedRehome, overlayProposals, ledgerPatches, submittedPatches, revisions] = await Promise.all([
    loadGraphFiles(outputDir),
    readScopeManifest(outputDir),
    readJsonlOptional<ContextPackageRecord>(join(outputDir, 'model', 'packages.jsonl')),
    readJsonlOptional<ContextSourceGroupRecord>(join(outputDir, 'model', 'groups.jsonl')),
    readJsonlOptional<ContextSourceInventoryEntry>(join(outputDir, 'model', 'source-inventory.jsonl')),
    readJsonlOptional<EvidenceReport>(join(outputDir, 'graph', 'evidence-reports.jsonl')),
    readJsonlOptional<RehomeProposal>(join(outputDir, 'state', 'rehome-proposals.jsonl')),
    readJsonlOptional<ContextCorrectionProposal>(join(outputDir, 'state', 'corrections.jsonl')),
    readJsonlOptional<GraphPatch>(join(outputDir, 'graph', 'patches.jsonl')),
    readJsonlOptional<GraphPatch>(join(outputDir, 'graph', 'submitted-patches.jsonl')),
    readJsonlOptional<GraphRevision>(join(outputDir, 'graph', 'revisions.jsonl'))
  ])
  const baseRevision = revisions.at(-1) ?? createGraphRevision(graph, { reason: 'materialized compile graph', status: 'materialized' })
  const reconciled = reconcileEvidenceReports(graph, baseRevision, evidenceReports)
  const graphGroups = sourceGroupsFromGraph(graph)
  const sourceGroups = groups.length > 0 ? groups : graphGroups.length > 0 ? graphGroups : sourceGroupsFromEntries(entries)
  const graphPackages = packagesFromGraph(graph, sourceGroups)
  const packageRecords = packages.length > 0 ? packages : graphPackages.length > 0 ? graphPackages : packagesFromSourceGroups(sourceGroups)
  return {
    graph,
    manifest,
    packages: packageRecords,
    groups: sourceGroups,
    entries,
    evidenceReports,
    rehomeProposals: uniqueById([...storedRehome, ...reconciled.rehomeProposals]),
    overlayProposals,
    ledgerPatches: uniqueById([...ledgerPatches, ...submittedPatches, ...reconciled.patches]),
    submittedPatches,
    revisions
  }
}

function buildCorrectionProposals(runtime: CorrectionRuntimeFiles): ContextCorrectionProposal[] {
  const packageContexts = runtime.packages.map((record) => packageContext(record, runtime))
  const proposals: ContextCorrectionProposal[] = []
  const usedRehomeIds = new Set<string>()
  const usedRehomeKeys = new Set<string>()
  for (const report of runtime.evidenceReports) {
    for (const finding of report.findings) {
      const kind = correctionKindForFinding(finding)
      const context = packageContexts.find((candidate) => findingWithinPackage(finding, candidate, runtime))
      const patch = matchingPatchForFinding(report, finding, runtime.ledgerPatches)
      const rehomeProposal = kind === 'rehome' ? matchingRehomeForFinding(finding, runtime.rehomeProposals) : undefined
      if (rehomeProposal) {
        usedRehomeIds.add(rehomeProposal.id)
        usedRehomeKeys.add(rehomeIdentityKey(rehomeProposal))
      }
      proposals.push(createProposal({ report, finding, patch, rehomeProposal }, kind, context))
    }
  }
  for (const proposal of runtime.rehomeProposals) {
    if (usedRehomeIds.has(proposal.id) || usedRehomeKeys.has(rehomeIdentityKey(proposal))) {
      continue
    }
    const context = packageContexts.find((candidate) => rehomeWithinPackage(proposal, candidate))
    proposals.push(createProposal({ rehomeProposal: proposal }, 'rehome', context))
  }
  for (const patch of runtime.ledgerPatches) {
    if (proposals.some((proposal) => proposal.graphPatchIds.includes(patch.id))) {
      continue
    }
    const patchKind = correctionKindForPatch(patch)
    if (patch.evidenceReportIds?.some((reportId) => proposals.some((proposal) => proposal.kind === patchKind && proposal.evidenceReportIds.includes(reportId)))) {
      continue
    }
    const context = packageContexts.find((candidate) => patchWithinPackage(patch, candidate))
    proposals.push(createProposal({ patch }, patchKind, context))
  }
  for (const overlay of runtime.overlayProposals) {
    if (proposals.some((proposal) => proposal.id === overlay.id)) {
      continue
    }
    if (overlay.derivedFrom.some((source) => source.kind === 'source_correction_decision')) {
      proposals.push(overlay)
    }
  }
  const merged = mergeDuplicateProposals(proposals)
  const overlaid = applyStatusOverlay(merged, runtime.overlayProposals, runtime.ledgerPatches)
  return enrichProposalTrust(overlaid, runtime)
    .sort((left, right) => statusRank(left.status) - statusRank(right.status) || Number(left.blocked) - Number(right.blocked) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id))
}

function rehomeIdentityKey(proposal: RehomeProposal): string {
  return stableId(JSON.stringify({
    sourcePath: normalizePath(proposal.sourcePath),
    suggestedPath: normalizePath(proposal.suggestedPath),
    fromGroupId: proposal.fromGroupId,
    toGroupId: proposal.toGroupId,
    action: proposal.action
  }))
}

function createProposal(seed: ProposalSeed, kind: ContextCorrectionProposalKind, context: PackageContext | undefined): ContextCorrectionProposal {
  const report = seed.report
  const finding = seed.finding
  const patch = seed.patch
  const rehomeProposal = seed.rehomeProposal
  const evidence = uniqueEvidence([
    ...(finding?.evidence ?? []),
    ...(patch?.evidence ?? []),
    ...(rehomeProposal?.evidence ?? [])
  ])
  const affectedNodeIds = uniqueStrings([
    finding?.nodeId,
    finding?.targetGroupId,
    ...(finding?.affectedNodeIds ?? []),
    ...affectedNodeIdsForPatch(patch)
  ])
  const sourceGroupIds = uniqueStrings([
    ...affectedNodeIds.filter((id) => context?.groupIds.has(id)),
    rehomeProposal?.fromGroupId,
    rehomeProposal?.toGroupId
  ])
  const sourcePaths = uniqueStrings([
    finding?.sourcePath,
    finding?.suggestedPath,
    rehomeProposal?.sourcePath,
    rehomeProposal?.suggestedPath,
    ...evidence.flatMap((item) => item.sourceRefs.map((ref) => ref.location?.path))
  ])
  const title = proposalTitle(kind, finding, patch, rehomeProposal)
  const dedupeKey = proposalDedupeKey(kind, context, affectedNodeIds, sourceGroupIds, sourcePaths, patch, rehomeProposal)
  const legacyId = `CORRECTION-${kind}-${stableId([report?.id, finding?.type, finding?.nodeId, finding?.targetGroupId, finding?.sourcePath, patch?.id, rehomeProposal?.id, title].filter(Boolean).join(':'))}`
  return {
    schemaVersion: 'context-correction-proposal.v1',
    id: `CORRECTION-${kind}-${stableId(dedupeKey)}`,
    dedupeKey,
    kind,
    status: statusFromRehome(rehomeProposal),
    title,
    summary: report?.summary ?? rehomeProposal?.reason ?? patch?.id ?? title,
    packageId: context?.record.id,
    packagePath: context?.record.path,
    sourceGroupIds,
    affectedNodeIds,
    sourcePaths,
    confidence: finding?.confidence ?? rehomeProposal?.confidence ?? 0.5,
    evidence,
    evidenceReportIds: uniqueStrings([report?.id, ...(patch?.evidenceReportIds ?? [])]),
    graphPatchIds: patch ? [patch.id] : [],
    rehomeProposalIds: rehomeProposal ? [rehomeProposal.id] : [],
    derivedFrom: uniqueSources([
      ...(report ? [{ kind: 'evidence_report' as const, id: report.id }] : []),
      ...(patch ? [{ kind: 'graph_patch' as const, id: patch.id }] : []),
      ...(rehomeProposal ? [{ kind: 'rehome_proposal' as const, id: rehomeProposal.id }] : [])
    ]),
    supersedesProposalIds: [legacyId],
    impact: emptyImpact(),
    conflicts: [],
    blocked: false,
    graphPatch: patch,
    rehomeProposal,
    createdAt: report?.generatedAt ?? rehomeProposal?.createdAt ?? patch?.createdAt ?? new Date(0).toISOString()
  }
}

function proposalDedupeKey(
  kind: ContextCorrectionProposalKind,
  context: PackageContext | undefined,
  affectedNodeIds: string[],
  sourceGroupIds: string[],
  sourcePaths: string[],
  patch: GraphPatch | undefined,
  rehomeProposal: RehomeProposal | undefined
): string {
  return stableId(JSON.stringify({
    kind,
    packageId: context?.record.id ?? 'unscoped',
    affectedNodeIds: kind === 'rehome' && rehomeProposal ? [] : [...affectedNodeIds].sort(),
    sourceGroupIds: [...sourceGroupIds].sort(),
    sourcePaths: sourcePaths.map(normalizePath).sort(),
    operations: kind === 'rehome' && rehomeProposal ? [] : patch ? patch.operations.map(operationFingerprint).sort() : [],
    rehome: rehomeProposal ? {
      sourcePath: normalizePath(rehomeProposal.sourcePath),
      suggestedPath: normalizePath(rehomeProposal.suggestedPath),
      fromGroupId: rehomeProposal.fromGroupId,
      toGroupId: rehomeProposal.toGroupId,
      action: rehomeProposal.action
    } : undefined
  }))
}

function mergeDuplicateProposals(proposals: ContextCorrectionProposal[]): ContextCorrectionProposal[] {
  const byKey = new Map<string, ContextCorrectionProposal[]>()
  for (const proposal of proposals) {
    byKey.set(proposal.dedupeKey, [...(byKey.get(proposal.dedupeKey) ?? []), proposal])
  }
  return [...byKey.values()].map((duplicates) => mergeProposalGroup(duplicates))
}

function mergeProposalGroup(proposals: ContextCorrectionProposal[]): ContextCorrectionProposal {
  const [first, ...rest] = proposals.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  if (!first) {
    throw new Error('Cannot merge an empty correction proposal group')
  }
  const all = [first, ...rest]
  const graphPatch = all.find((proposal) => proposal.graphPatch)?.graphPatch
  const rehomeProposal = all.find((proposal) => proposal.rehomeProposal)?.rehomeProposal
  return {
    ...first,
    confidence: Math.max(...all.map((proposal) => proposal.confidence)),
    evidence: uniqueEvidence(all.flatMap((proposal) => proposal.evidence)),
    evidenceReportIds: uniqueStrings(all.flatMap((proposal) => proposal.evidenceReportIds)),
    graphPatchIds: uniqueStrings(all.flatMap((proposal) => proposal.graphPatchIds)),
    rehomeProposalIds: uniqueStrings(all.flatMap((proposal) => proposal.rehomeProposalIds)),
    derivedFrom: uniqueSources(all.flatMap((proposal) => proposal.derivedFrom)),
    supersedesProposalIds: uniqueStrings(all.flatMap((proposal) => [proposal.id, ...proposal.supersedesProposalIds])),
    sourceGroupIds: uniqueStrings(all.flatMap((proposal) => proposal.sourceGroupIds)),
    affectedNodeIds: uniqueStrings(all.flatMap((proposal) => proposal.affectedNodeIds)),
    sourcePaths: uniqueStrings(all.flatMap((proposal) => proposal.sourcePaths)),
    graphPatch,
    rehomeProposal,
    createdAt: all.map((proposal) => proposal.createdAt).sort()[0] ?? first.createdAt
  }
}

function enrichProposalTrust(proposals: ContextCorrectionProposal[], runtime: CorrectionRuntimeFiles): ContextCorrectionProposal[] {
  const withImpact = proposals.map((proposal) => ({
    ...proposal,
    impact: correctionImpact(proposal)
  }))
  const conflictsById = proposalConflicts(withImpact, runtime)
  return withImpact.map((proposal) => {
    const conflicts = conflictsById.get(proposal.id) ?? []
    const trusted: ContextCorrectionProposal = {
      ...proposal,
      conflicts,
      blocked: conflicts.some((conflict) => conflict.severity === 'error')
    }
    return {
      ...trusted,
      operationPlan: buildContextCorrectionOperationPlan({
        graph: runtime.graph,
        packages: runtime.packages,
        groups: runtime.groups,
        proposal: trusted
      })
    }
  })
}

function correctionImpact(proposal: ContextCorrectionProposal): ContextCorrectionImpact {
  const operations = proposal.graphPatch?.operations ?? []
  const affectedNodeIds = uniqueStrings([...proposal.affectedNodeIds, ...operations.flatMap((operation) => affectedNodeIdsForOperation(operation))])
  const affectedEdgeIds = uniqueStrings(operations.flatMap((operation) => affectedEdgeIdsForOperation(operation)))
  const sourcePaths = uniqueStrings([...proposal.sourcePaths, ...proposal.evidence.flatMap((item) => item.sourceRefs.map((ref) => ref.location?.path))])
  const creates = operations.filter((operation) => operation.op === 'add_node' || operation.op === 'add_edge' || operation.op === 'link').length
  const updates = operations.filter((operation) => operation.op === 'update_node' || operation.op === 'restore_node_snapshot').length
  const deprecates = operations.filter((operation) => operation.op === 'deprecate_node' || operation.op === 'deprecate_edge').length
  const reparents = operations.filter((operation) => operation.op === 'reparent_node').length
  const relabels = operations.filter((operation) => operation.op === 'relabel_source_group').length
  const rehomes = operations.filter((operation) => operation.op === 'rehome_proposal').length + (proposal.rehomeProposal && operations.length === 0 ? 1 : 0)
  return {
    operationCount: operations.length,
    affectedNodeIds,
    affectedEdgeIds,
    sourcePaths,
    creates,
    updates,
    deprecates,
    reparents,
    relabels,
    rehomes,
    riskLevel: correctionRiskLevel({ creates, updates, deprecates, reparents, relabels, rehomes, operationCount: operations.length })
  }
}

function correctionRiskLevel(input: {
  operationCount: number
  creates: number
  updates: number
  deprecates: number
  reparents: number
  relabels: number
  rehomes: number
}): ContextCorrectionRiskLevel {
  if (input.deprecates > 0 || input.reparents > 0 || (input.rehomes > 0 && input.operationCount > 0) || input.operationCount > 3) {
    return 'high'
  }
  if (input.creates > 0 || input.updates > 0 || input.relabels > 0 || input.operationCount > 0) {
    return 'medium'
  }
  return 'low'
}

function proposalConflicts(proposals: ContextCorrectionProposal[], runtime: CorrectionRuntimeFiles): Map<string, ContextCorrectionConflict[]> {
  const conflicts = new Map<string, ContextCorrectionConflict[]>()
  const add = (proposal: ContextCorrectionProposal, conflict: ContextCorrectionConflict) => {
    conflicts.set(proposal.id, [...(conflicts.get(proposal.id) ?? []), { proposalId: proposal.id, ...conflict }])
  }
  const currentRevision = runtime.revisions.at(-1)
  const nodeIds = new Set(runtime.graph.nodes.map((node) => node.id))
  const edgeIds = new Set(runtime.graph.edges.map((edge) => edge.id))
  const groupIds = new Set(runtime.groups.map((group) => group.id))
  const ledgerById = new Map(runtime.ledgerPatches.map((patch) => [patch.id, patch]))

  for (const proposal of proposals) {
    if (!proposal.graphPatch) {
      add(proposal, {
        type: 'missing_graph_patch',
        severity: 'error',
        message: `Correction proposal ${proposal.id} has no executable graph patch.`
      })
    }
    if (proposal.graphPatch && currentRevision && proposal.graphPatch.revisionId !== currentRevision.id) {
      add(proposal, {
        type: 'stale_revision',
        severity: 'warning',
        patchId: proposal.graphPatch.id,
        message: `Graph patch ${proposal.graphPatch.id} was created for ${proposal.graphPatch.revisionId}, but the current revision is ${currentRevision.id}.`
      })
    }
    for (const patchId of proposal.graphPatchIds) {
      const ledgerPatch = ledgerById.get(patchId)
      if (ledgerPatch?.status === 'applied') {
        add(proposal, {
          type: 'already_applied',
          severity: 'warning',
          patchId,
          message: `Graph patch ${patchId} is already applied in the graph patch ledger.`
        })
      }
    }
    if (proposal.graphPatchIds.length > 1) {
      add(proposal, {
        type: 'patch_overlap',
        severity: 'warning',
        patchId: proposal.graphPatchIds[0],
        message: `Correction proposal ${proposal.id} merges ${proposal.graphPatchIds.length} graph patches for the same target.`
      })
    }
    for (const operation of proposal.graphPatch?.operations ?? []) {
      for (const conflict of missingTargetConflicts(operation, nodeIds, edgeIds, groupIds, proposal.graphPatch?.id)) {
        add(proposal, conflict)
      }
    }
  }

  const activeTargets = new Map<string, ContextCorrectionProposal[]>()
  for (const proposal of proposals.filter((candidate) => candidate.status !== 'rejected' && candidate.status !== 'applied')) {
    for (const target of proposalTargets(proposal)) {
      activeTargets.set(target.key, [...(activeTargets.get(target.key) ?? []), proposal])
    }
  }
  for (const [target, targetProposals] of activeTargets) {
    const uniqueProposals = uniqueById(targetProposals)
    if (uniqueProposals.length < 2) {
      continue
    }
    for (const proposal of uniqueProposals) {
      add(proposal, {
        type: 'patch_overlap',
        severity: 'warning',
        relatedProposalId: uniqueProposals.find((candidate) => candidate.id !== proposal.id)?.id,
        message: `Multiple active correction proposals affect ${target}.`
      })
    }
  }
  return conflicts
}

function missingTargetConflicts(
  operation: PatchOperation,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
  groupIds: Set<string>,
  patchId: string | undefined
): ContextCorrectionConflict[] {
  const conflicts: ContextCorrectionConflict[] = []
  const addNode = (nodeId: string | undefined, message: string) => {
    if (nodeId && !nodeIds.has(nodeId)) {
      conflicts.push({ type: 'missing_target', severity: 'error', patchId, nodeId, message })
    }
  }
  const addEdge = (edgeId: string | undefined, message: string) => {
    if (edgeId && !edgeIds.has(edgeId)) {
      conflicts.push({ type: 'missing_target', severity: 'error', patchId, edgeId, message })
    }
  }
  const addGroup = (groupId: string | undefined, message: string) => {
    if (groupId && !groupIds.has(groupId) && !nodeIds.has(groupId)) {
      conflicts.push({ type: 'missing_target', severity: 'error', patchId, nodeId: groupId, message })
    }
  }
  switch (operation.op) {
    case 'update_node':
    case 'deprecate_node':
    case 'relabel_source_group':
      addNode(operation.nodeId, `Graph patch ${patchId ?? 'unknown'} references missing node ${operation.nodeId}.`)
      break
    case 'reparent_node':
      addNode(operation.nodeId, `Graph patch ${patchId ?? 'unknown'} references missing node ${operation.nodeId}.`)
      addGroup(operation.sourceGroupId, `Graph patch ${patchId ?? 'unknown'} references missing source group ${operation.sourceGroupId}.`)
      break
    case 'deprecate_edge':
      addEdge(operation.edgeId, `Graph patch ${patchId ?? 'unknown'} references missing edge ${operation.edgeId}.`)
      break
    case 'add_edge':
    case 'link':
      addNode(operation.edge.from, `Graph patch ${patchId ?? 'unknown'} references missing node ${operation.edge.from}.`)
      addNode(operation.edge.to, `Graph patch ${patchId ?? 'unknown'} references missing node ${operation.edge.to}.`)
      break
    case 'rehome_proposal':
      addGroup(operation.proposal.fromGroupId, `Graph patch ${patchId ?? 'unknown'} references missing source group ${operation.proposal.fromGroupId}.`)
      addGroup(operation.proposal.toGroupId, `Graph patch ${patchId ?? 'unknown'} references missing source group ${operation.proposal.toGroupId}.`)
      break
    case 'add_node':
    case 'restore_node_snapshot':
      break
  }
  return conflicts
}

function proposalTargets(proposal: ContextCorrectionProposal): ProposalTarget[] {
  return [
    ...proposal.impact.affectedNodeIds.map((nodeId) => ({ key: `node:${nodeId}`, nodeId })),
    ...proposal.impact.affectedEdgeIds.map((edgeId) => ({ key: `edge:${edgeId}`, edgeId })),
    ...proposal.impact.sourcePaths.map((sourcePath) => ({ key: `path:${normalizePath(sourcePath)}`, sourcePath }))
  ]
}

function applyStatusOverlay(proposals: ContextCorrectionProposal[], overlays: ContextCorrectionProposal[], ledgerPatches: GraphPatch[]): ContextCorrectionProposal[] {
  const overlayById = latestById(overlays)
  const ledgerById = new Map(ledgerPatches.map((patch) => [patch.id, patch]))
  return proposals.map((proposal) => {
    const overlay = overlayById.get(proposal.id)
    let next = overlay ? { ...proposal, ...pickOverlayFields(overlay), derivedFrom: uniqueSources([...proposal.derivedFrom, { kind: 'status_overlay', id: overlay.id }]) } : proposal
    const ledgerPatch = proposal.graphPatchIds.map((id) => ledgerById.get(id)).find((patch): patch is GraphPatch => patch !== undefined && (patch.status === 'applied' || patch.status === 'rejected'))
    if (ledgerPatch?.status === 'applied') {
      next = { ...next, status: 'applied', appliedRevisionId: ledgerPatch.appliedRevisionId, graphPatch: ledgerPatch }
    } else if (ledgerPatch?.status === 'rejected') {
      next = { ...next, status: 'rejected', graphPatch: ledgerPatch }
    }
    return next
  })
}

function pickOverlayFields(overlay: ContextCorrectionProposal): Partial<ContextCorrectionProposal> {
  return {
    status: overlay.status,
    actor: overlay.actor,
    statusReason: overlay.statusReason,
    appliedRevisionId: overlay.appliedRevisionId,
    updatedAt: overlay.updatedAt,
    graphPatch: overlay.graphPatch
  }
}

function packageContext(record: ContextPackageRecord, runtime: CorrectionRuntimeFiles): PackageContext {
  const groupIds = new Set<string>(record.sourceGroupIds)
  for (const group of runtime.groups.filter((candidate) => pathWithin(candidate.path, record.path))) {
    groupIds.add(group.id)
  }
  const nodeIds = new Set(runtime.graph.nodes.filter((node) => nodeWithinPackage(node, record, runtime.groups)).map((node) => node.id))
  nodeIds.add(record.id)
  for (const groupId of groupIds) {
    nodeIds.add(groupId)
  }
  const scope = runtime.manifest?.scopes.find((candidate) => candidate.id === scopeIdForPackage(record.id) || candidate.packageId === record.id)
  const scopeIds = new Set<string>([scopeIdForPackage(record.id), ...[...groupIds].map((id) => scopeIdForSourceGroup(id))])
  if (scope) {
    scopeIds.add(scope.id)
  }
  return { record, scope, groupIds, nodeIds, scopeIds }
}

function resolvePackageContext(runtime: CorrectionRuntimeFiles, ref: string): PackageContext {
  const normalizedRef = normalizeRef(ref)
  const contexts = runtime.packages.map((record) => packageContext(record, runtime))
  const exact = contexts.find((context) => packageContextAliases(context, runtime).some((alias) => normalizeRef(alias) === normalizedRef))
  if (exact) {
    return exact
  }
  const fuzzy = contexts.filter((context) => packageContextAliases(context, runtime).some((alias) => normalizeRef(alias).includes(normalizedRef)))
  if (fuzzy.length === 1) {
    return fuzzy[0] as PackageContext
  }
  if (fuzzy.length > 1) {
    throw new Error(`Context package reference is ambiguous: ${ref}. Matches: ${fuzzy.map((context) => context.record.id).join(', ')}`)
  }
  throw new Error(`Context package not found: ${ref}`)
}

function packageContextAliases(context: PackageContext, runtime: CorrectionRuntimeFiles): string[] {
  const record = context.record
  return uniqueStrings([
    record.id,
    record.path,
    record.title,
    record.sourceName,
    record.sourceRef.location?.path,
    record.sourceRef.uri,
    ...runtime.groups
      .filter((group) => context.groupIds.has(group.id))
      .flatMap((group) => [group.id, group.path, group.title, group.sourceName, group.sourceRef.location?.path, group.sourceRef.uri])
  ])
}

function findingWithinPackage(finding: EvidenceFinding, context: PackageContext, runtime: CorrectionRuntimeFiles): boolean {
  return Boolean(
    idWithinPackage(finding.nodeId, context) ||
    idWithinPackage(finding.targetGroupId, context) ||
    (finding.affectedNodeIds ?? []).some((nodeId) => idWithinPackage(nodeId, context)) ||
    pathWithinPackage(finding.sourcePath, context) ||
    pathWithinPackage(finding.suggestedPath, context) ||
    sourceRefsWithinPackage(finding.evidenceRefs ?? [], context) ||
    sourceRefsWithinPackage(finding.evidence.flatMap((item) => item.sourceRefs), context) ||
    runtime.graph.nodes.some((node) => finding.nodeId === node.id && nodeWithinPackage(node, context.record, runtime.groups))
  )
}

function patchWithinPackage(patch: GraphPatch, context: PackageContext): boolean {
  return sourceRefsWithinPackage(patch.evidence.flatMap((item) => item.sourceRefs), context) || patch.operations.some((operation) => operationWithinPackage(operation, context))
}

function operationWithinPackage(operation: PatchOperation, context: PackageContext): boolean {
  switch (operation.op) {
    case 'add_node':
    case 'restore_node_snapshot':
      return idWithinPackage(operation.node.id, context) || sourceRefsWithinPackage(operation.node.sourceRefs, context)
    case 'update_node':
    case 'deprecate_node':
    case 'relabel_source_group':
      return idWithinPackage(operation.nodeId, context)
    case 'reparent_node':
      return idWithinPackage(operation.nodeId, context) || idWithinPackage(operation.sourceGroupId, context)
    case 'add_edge':
    case 'link':
      return idWithinPackage(operation.edge.from, context) || idWithinPackage(operation.edge.to, context) || sourceRefsWithinPackage(operation.edge.evidence.flatMap((item) => item.sourceRefs), context)
    case 'deprecate_edge':
      return false
    case 'rehome_proposal':
      return rehomeWithinPackage(operation.proposal, context)
  }
}

function rehomeWithinPackage(proposal: RehomeProposal, context: PackageContext): boolean {
  return Boolean(
    idWithinPackage(proposal.fromGroupId, context) ||
    idWithinPackage(proposal.toGroupId, context) ||
    pathWithinPackage(proposal.sourcePath, context) ||
    pathWithinPackage(proposal.suggestedPath, context) ||
    sourceRefsWithinPackage(proposal.evidence.flatMap((item) => item.sourceRefs), context)
  )
}

function matchingPatchForFinding(report: EvidenceReport, finding: EvidenceFinding, patches: GraphPatch[]): GraphPatch | undefined {
  const reportPatches = uniqueById([...report.proposedPatches, ...patches.filter((patch) => patch.evidenceReportIds?.includes(report.id) || patch.id === `PATCH-${stableId(report.id)}`)])
  return reportPatches.find((patch) => patch.operations.some((operation) => operationMatchesFinding(operation, finding))) ?? (report.findings.length === 1 ? reportPatches[0] : undefined)
}

function operationMatchesFinding(operation: PatchOperation, finding: EvidenceFinding): boolean {
  switch (finding.type) {
    case 'relabel_group':
      return operation.op === 'relabel_source_group' && operation.nodeId === finding.nodeId
    case 'confirm_fact':
      return operation.op === 'update_node' && operation.nodeId === finding.nodeId
    case 'split_group':
      return operation.op === 'add_node' || operation.op === 'add_edge'
    case 'merge_group':
    case 'link_groups':
      return operation.op === 'link' || operation.op === 'add_edge'
    case 'misplaced_source':
      return operation.op === 'rehome_proposal' || operation.op === 'relabel_source_group'
  }
}

function matchingRehomeForFinding(finding: EvidenceFinding, proposals: RehomeProposal[]): RehomeProposal | undefined {
  return proposals.find((proposal) =>
    (finding.sourcePath && normalizePath(proposal.sourcePath) === normalizePath(finding.sourcePath)) ||
    (finding.suggestedPath && normalizePath(proposal.suggestedPath) === normalizePath(finding.suggestedPath))
  )
}

function correctionKindForFinding(finding: EvidenceFinding): ContextCorrectionProposalKind {
  switch (finding.type) {
    case 'relabel_group':
      return 'relabel'
    case 'split_group':
      return 'split'
    case 'merge_group':
      return 'merge'
    case 'misplaced_source':
      return 'rehome'
    case 'link_groups':
    case 'confirm_fact':
      return 'confirm_relation'
  }
}

function correctionKindForPatch(patch: GraphPatch): ContextCorrectionProposalKind {
  if (patch.operations.some((operation) => operation.op === 'relabel_source_group')) return 'relabel'
  if (patch.operations.some((operation) => operation.op === 'rehome_proposal' || operation.op === 'reparent_node')) return 'rehome'
  if (patch.operations.some((operation) => operation.op === 'deprecate_edge')) return 'reject_relation'
  if (patch.operations.some((operation) => operation.op === 'add_node')) return 'split'
  if (patch.operations.some((operation) => operation.op === 'link' || operation.op === 'add_edge')) return 'confirm_relation'
  return 'confirm_relation'
}

function prepareGraphPatch(patch: GraphPatch, runtime: CorrectionRuntimeFiles, generatedAt: string): GraphPatch {
  const revision = runtime.revisions.at(-1)
  return {
    ...patch,
    revisionId: revision?.id ?? patch.revisionId,
    status: 'proposed',
    createdAt: patch.createdAt ?? generatedAt
  }
}

function targetForOperation(operation: PatchOperation): { kind: ContextCorrectionOperationEffect['targetKind']; id?: string; path?: string } {
  switch (operation.op) {
    case 'add_node':
    case 'restore_node_snapshot':
      return { kind: 'node', id: operation.node.id }
    case 'update_node':
    case 'deprecate_node':
    case 'relabel_source_group':
    case 'reparent_node':
      return { kind: 'node', id: operation.nodeId }
    case 'add_edge':
    case 'link':
      return { kind: 'edge', id: operation.edge.id }
    case 'deprecate_edge':
      return { kind: 'edge', id: operation.edgeId }
    case 'rehome_proposal':
      return { kind: 'source_path', id: normalizePath(operation.proposal.sourcePath), path: normalizePath(operation.proposal.sourcePath) }
  }
}

function graphEffectKindForProposal(
  kind: ContextCorrectionProposalKind,
  operation: PatchOperation
): ContextCorrectionOperationEffect['kind'] {
  if (kind === 'confirm_relation') return 'relation_confirm'
  if (kind === 'reject_relation' || operation.op === 'deprecate_edge') return 'relation_reject'
  return 'graph_patch_operation'
}

function beforeForGraphOperation(graph: ContextGraph, operation: PatchOperation): Record<string, unknown> | undefined {
  switch (operation.op) {
    case 'update_node':
    case 'deprecate_node':
    case 'relabel_source_group':
    case 'reparent_node':
      return nodeSnapshot(graph.nodes.find((node) => node.id === operation.nodeId))
    case 'deprecate_edge':
      return edgeSnapshot(graph.edges.find((edge) => edge.id === operation.edgeId))
    case 'add_edge':
    case 'link':
      return undefined
    case 'add_node':
      return undefined
    case 'restore_node_snapshot':
      return nodeSnapshot(graph.nodes.find((node) => node.id === operation.node.id))
    case 'rehome_proposal':
      return {
        sourcePath: normalizePath(operation.proposal.sourcePath),
        sourceGroupId: operation.proposal.fromGroupId,
        action: operation.proposal.action
      }
  }
}

function afterForGraphOperation(graph: ContextGraph, operation: PatchOperation): Record<string, unknown> | undefined {
  switch (operation.op) {
    case 'add_node':
    case 'restore_node_snapshot':
      return nodeSnapshot(operation.node)
    case 'update_node': {
      const before = nodeSnapshot(graph.nodes.find((node) => node.id === operation.nodeId)) ?? {}
      return {
        ...before,
        name: operation.name ?? before.name,
        status: operation.status ?? before.status,
        confidence: operation.confidence ?? before.confidence,
        properties: { ...(isRecord(before.properties) ? before.properties : {}), ...(operation.properties ?? {}) }
      }
    }
    case 'deprecate_node':
      return { ...beforeForGraphOperation(graph, operation), status: 'deprecated', supersededBy: operation.supersededBy, reason: operation.reason }
    case 'relabel_source_group': {
      const before = beforeForGraphOperation(graph, operation) ?? {}
      return {
        ...before,
        name: operation.title ?? before.name,
        confidence: operation.confidence ?? before.confidence,
        properties: {
          ...(isRecord(before.properties) ? before.properties : {}),
          kind: operation.kind,
          title: operation.title,
          summary: operation.summary,
          confidence: operation.confidence
        }
      }
    }
    case 'reparent_node':
      return { ...beforeForGraphOperation(graph, operation), parentScopeId: operation.parentScopeId, sourceGroupId: operation.sourceGroupId }
    case 'add_edge':
    case 'link':
      return edgeSnapshot(operation.edge)
    case 'deprecate_edge':
      return { ...beforeForGraphOperation(graph, operation), status: 'deprecated', supersededBy: operation.supersededBy, reason: operation.reason }
    case 'rehome_proposal':
      return {
        sourcePath: normalizePath(operation.proposal.sourcePath),
        targetPath: normalizePath(operation.proposal.suggestedPath),
        sourceGroupId: operation.proposal.fromGroupId,
        targetGroupId: operation.proposal.toGroupId,
        action: operation.proposal.action
      }
  }
}

function graphOperationSummary(operation: PatchOperation): string {
  const target = targetForOperation(operation)
  return `${operation.op} ${target.id ?? target.path ?? target.kind}`
}

function sourceGroupForId(groups: ContextSourceGroupRecord[], id: string): ContextSourceGroupRecord | undefined {
  return groups.find((group) => group.id === id)
}

function sourceGroupSnapshot(group: ContextSourceGroupRecord): Record<string, unknown> {
  return {
    id: group.id,
    sourceName: group.sourceName,
    path: group.path,
    title: group.title,
    kind: group.kind,
    boundaryMode: group.boundaryMode,
    summary: group.summary,
    childrenPolicy: group.childrenPolicy,
    confidence: group.confidence,
    decisionSource: group.decisionSource
  }
}

function nodeSourceGroupSnapshot(node: ContextGraph['nodes'][number]): Record<string, unknown> {
  return {
    id: node.id,
    path: stringProperty(node.properties, 'path') ?? node.sourceRefs[0]?.location?.path,
    title: stringProperty(node.properties, 'title') ?? node.name,
    kind: sourceGroupKind(stringProperty(node.properties, 'kind')),
    boundaryMode: stringProperty(node.properties, 'boundaryMode') ?? 'collapsed',
    summary: stringProperty(node.properties, 'summary') ?? node.name,
    confidence: node.confidence ?? numberProperty(node.properties, 'confidence')
  }
}

function nodeSnapshot(node: ContextGraph['nodes'][number] | undefined): Record<string, unknown> | undefined {
  if (!node) return undefined
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    status: node.status,
    confidence: node.confidence,
    properties: node.properties,
    sourceRefs: node.sourceRefs
  }
}

function edgeSnapshot(edge: ContextGraph['edges'][number] | undefined): Record<string, unknown> | undefined {
  if (!edge) return undefined
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    status: edge.status,
    confidence: edge.confidence,
    properties: edge.properties,
    evidence: edge.evidence
  }
}

function graphNodeName(graph: ContextGraph, nodeId: string): string | undefined {
  return graph.nodes.find((node) => node.id === nodeId)?.name
}

function effectId(proposalId: string, index: number, kind: ContextCorrectionOperationEffect['kind']): string {
  return `EFFECT-${stableId(`${proposalId}:${index}:${kind}`)}`
}

function sourceCorrectionDecisionId(
  proposal: ContextCorrectionProposal,
  index: number,
  kind: ContextCorrectionProposalKind,
  target: string | undefined
): string {
  return `SOURCE-CORRECTION-${stableId(`${proposal.id}:${index}:${kind}:${target ?? 'target'}`)}`
}

async function appendGraphPatch(outputDir: string, patch: GraphPatch): Promise<void> {
  const path = join(outputDir, 'graph', 'submitted-patches.jsonl')
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(patch)}\n`, 'utf8')
}

async function appendSourceCorrectionDecisions(outputDir: string, decisions: ContextSourceCorrectionDecision[]): Promise<void> {
  if (decisions.length === 0) {
    return
  }
  const path = join(outputDir, 'state', 'source-correction-decisions.jsonl')
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, decisions.map((decision) => JSON.stringify(decision)).join('\n') + '\n', 'utf8')
}

async function appendCorrectionOverlay(outputDir: string, proposal: ContextCorrectionProposal): Promise<void> {
  const path = join(outputDir, 'state', 'corrections.jsonl')
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(proposal)}\n`, 'utf8')
}

function proposalCounts(proposals: ContextCorrectionProposal[]) {
  const byKind: Partial<Record<ContextCorrectionProposalKind, number>> = {}
  const byStatus: Partial<Record<ContextCorrectionProposalStatus, number>> = {}
  const byRiskLevel: Partial<Record<ContextCorrectionRiskLevel, number>> = {}
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

function nextRecommendedProposalId(proposals: ContextCorrectionProposal[]): string | undefined {
  return proposals.find((proposal) => proposal.status === 'approved' && !proposal.blocked)?.id ??
    proposals.find((proposal) => proposal.status === 'proposed' && !proposal.blocked)?.id ??
    [...proposals]
      .filter((proposal) => proposal.conflicts.every((conflict) => conflict.severity === 'warning'))
      .sort((left, right) => right.confidence - left.confidence)[0]?.id
}

function proposalTitle(kind: ContextCorrectionProposalKind, finding?: EvidenceFinding, patch?: GraphPatch, rehomeProposal?: RehomeProposal): string {
  if (rehomeProposal) return `Rehome ${rehomeProposal.sourcePath}`
  if (finding?.nodeId) return `${kind} ${finding.nodeId}`
  if (finding?.sourcePath) return `${kind} ${finding.sourcePath}`
  return patch ? `${kind} ${patch.id}` : kind
}

function statusFromRehome(proposal: RehomeProposal | undefined): ContextCorrectionProposalStatus {
  if (!proposal) return 'proposed'
  if (proposal.status === 'approved' || proposal.status === 'rejected' || proposal.status === 'applied') return proposal.status
  return 'proposed'
}

function affectedNodeIdsForPatch(patch: GraphPatch | undefined): string[] {
  if (!patch) return []
  return patch.operations.flatMap(affectedNodeIdsForOperation)
}

function affectedNodeIdsForOperation(operation: PatchOperation): string[] {
  switch (operation.op) {
    case 'add_node':
    case 'restore_node_snapshot':
      return [operation.node.id]
    case 'update_node':
    case 'deprecate_node':
    case 'relabel_source_group':
    case 'reparent_node':
      return [operation.nodeId]
    case 'add_edge':
    case 'link':
      return [operation.edge.from, operation.edge.to]
    case 'deprecate_edge':
      return []
    case 'rehome_proposal':
      return [operation.proposal.fromGroupId, operation.proposal.toGroupId].filter((id): id is string => typeof id === 'string')
  }
}

function affectedEdgeIdsForOperation(operation: PatchOperation): string[] {
  switch (operation.op) {
    case 'add_edge':
    case 'link':
      return [operation.edge.id]
    case 'deprecate_edge':
      return [operation.edgeId]
    default:
      return []
  }
}

function operationFingerprint(operation: PatchOperation): string {
  switch (operation.op) {
    case 'add_node':
    case 'restore_node_snapshot':
      return stableId(JSON.stringify({ op: operation.op, nodeId: operation.node.id, type: operation.node.type, scopeId: operation.node.scopeId }))
    case 'update_node':
      return stableId(JSON.stringify({ op: operation.op, nodeId: operation.nodeId, properties: operation.properties }))
    case 'deprecate_node':
      return stableId(JSON.stringify({ op: operation.op, nodeId: operation.nodeId, reason: operation.reason }))
    case 'relabel_source_group':
      return stableId(JSON.stringify({ op: operation.op, nodeId: operation.nodeId, kind: operation.kind }))
    case 'reparent_node':
      return stableId(JSON.stringify({ op: operation.op, nodeId: operation.nodeId, parentScopeId: operation.parentScopeId, sourceGroupId: operation.sourceGroupId }))
    case 'add_edge':
    case 'link':
      return stableId(JSON.stringify({ op: operation.op, edgeId: operation.edge.id, from: operation.edge.from, to: operation.edge.to, type: operation.edge.type }))
    case 'deprecate_edge':
      return stableId(JSON.stringify({ op: operation.op, edgeId: operation.edgeId, reason: operation.reason }))
    case 'rehome_proposal':
      return stableId(JSON.stringify({
        op: operation.op,
        sourcePath: normalizePath(operation.proposal.sourcePath),
        suggestedPath: normalizePath(operation.proposal.suggestedPath),
        fromGroupId: operation.proposal.fromGroupId,
        toGroupId: operation.proposal.toGroupId,
        action: operation.proposal.action
      }))
  }
}

function emptyImpact(): ContextCorrectionImpact {
  return {
    operationCount: 0,
    affectedNodeIds: [],
    affectedEdgeIds: [],
    sourcePaths: [],
    creates: 0,
    updates: 0,
    deprecates: 0,
    reparents: 0,
    relabels: 0,
    rehomes: 0,
    riskLevel: 'low'
  }
}

function packagesFromGraph(graph: ContextGraph, groups: ContextSourceGroupRecord[]): ContextPackageRecord[] {
  return graph.nodes.filter((node) => node.type === 'Package').map((node) => {
    const path = typeof node.properties.path === 'string' ? node.properties.path : node.sourceRefs[0]?.location?.path ?? node.name
    return {
      id: node.id,
      sourceName: typeof node.properties.sourceName === 'string' ? node.properties.sourceName : node.sourceRefs[0]?.sourceId ?? 'source',
      path,
      title: node.name,
      kind: packageKind(typeof node.properties.packageKind === 'string' ? node.properties.packageKind : undefined),
      summary: typeof node.properties.summary === 'string' ? node.properties.summary : node.name,
      sourceGroupIds: Array.isArray(node.properties.sourceGroupIds)
        ? node.properties.sourceGroupIds.filter((id): id is string => typeof id === 'string')
        : groups.filter((group) => pathWithin(group.path, path)).map((group) => group.id),
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
  return groups.map((group) => ({
    id: `PACKAGE-${stableId(group.sourceName)}-${stableId(group.path)}`,
    sourceName: group.sourceName,
    path: group.path,
    title: group.title,
    kind: packageKindForGroup(group.kind),
    summary: group.summary,
    sourceGroupIds: [group.id],
    buildUnits: [],
    confidence: group.confidence,
    decisionSource: group.decisionSource,
    sourceRef: group.sourceRef
  }))
}

function sourceRootPath(entries: ContextSourceInventoryEntry[]): string {
  const roots = [...new Set(entries.map((entry) => normalizePath(entry.root)).filter(Boolean))]
  if (roots.length === 1) {
    return roots[0] as string
  }
  return commonPathPrefix(entries.map((entry) => entry.path)) || roots[0] || entries[0]?.path || 'sources'
}

function commonPathPrefix(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined
  }
  const segments = paths.map((path) => normalizePath(path).split('/').filter(Boolean))
  const prefix: string[] = []
  for (let index = 0; index < segments[0]!.length; index += 1) {
    const segment = segments[0]![index]
    if (segments.every((candidate) => candidate[index] === segment)) {
      prefix.push(segment as string)
      continue
    }
    break
  }
  return prefix.length > 0 ? prefix.join('/') : undefined
}

function titleFromPath(path: string, fallback: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? fallback
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
  return 'unknown'
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

function nodeWithinPackage(node: ContextGraph['nodes'][number], record: ContextPackageRecord, groups: ContextSourceGroupRecord[]): boolean {
  if (node.id === record.id || record.sourceGroupIds.includes(node.id)) return true
  if (record.sourceGroupIds.includes(String(node.properties.sourceGroupId ?? ''))) return true
  const nodePath = pathFromProperties(node.properties)
  if (nodePath && pathWithin(nodePath, record.path)) return true
  if (node.sourceRefs.some((sourceRef) => sourceRef.location?.path && pathWithin(sourceRef.location.path, record.path))) return true
  return groups
    .filter((group) => record.sourceGroupIds.includes(group.id))
    .some((group) => node.sourceRefs.some((sourceRef) => sourceRef.location?.path && pathWithin(sourceRef.location.path, group.path)))
}

function idWithinPackage(id: string | undefined, context: PackageContext): boolean {
  return typeof id === 'string' && (context.nodeIds.has(id) || context.groupIds.has(id) || id === context.record.id)
}

function pathWithinPackage(path: string | undefined, context: PackageContext): boolean {
  return typeof path === 'string' && pathWithin(path, context.record.path)
}

function sourceRefsWithinPackage(sourceRefs: SourceRef[], context: PackageContext): boolean {
  return sourceRefs.some((sourceRef) => sourceRef.location?.path && pathWithinPackage(sourceRef.location.path, context))
}

function pathFromProperties(properties: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'file', 'sourcePath']) {
    const value = properties[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function stringProperty(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function numberProperty(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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

function stableId(value: string): string {
  return normalizePath(value).replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-|-$/g, '') || fingerprintValue(value).slice(0, 12)
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

function uniqueEvidence(values: Evidence[]): Evidence[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = `${value.type}:${value.description}:${value.sourceRefs.map((ref) => ref.uri).join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueSources(values: ContextCorrectionProposal['derivedFrom']): ContextCorrectionProposal['derivedFrom'] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = `${value.kind}:${value.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
  }
  return unique
}

function latestById<T extends { id: string }>(items: T[]): Map<string, T> {
  const latest = new Map<string, T>()
  for (const item of items) latest.set(item.id, item)
  return latest
}

function statusRank(status: ContextCorrectionProposalStatus): number {
  return ({ proposed: 0, approved: 1, rejected: 2, applied: 3 })[status]
}

function correctionDiagnostic(type: string, proposalId: string, message: string, severity: 'warning' | 'error' = 'warning'): Diagnostic {
  return createDiagnostic({ severity, code: type, message, nodeId: proposalId })
}

async function readScopeManifest(outputDir: string): Promise<ContextGraphScopeManifest | undefined> {
  try {
    return JSON.parse(await readFile(join(outputDir, 'graph', 'scopes', 'manifest.json'), 'utf8')) as ContextGraphScopeManifest
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
    .replace('/state/rehome-proposals.jsonl', '/proposals/rehome-proposals.jsonl')
    .replace('/state/corrections.jsonl', '/proposals/corrections.jsonl')
    .replace('/graph/patches.jsonl', '/graph/patches/patches.jsonl')
    .replace('/graph/submitted-patches.jsonl', '/graph/patches/submitted.jsonl')
    .replace('/graph/revisions.jsonl', '/graph/revisions/revisions.jsonl')
}
