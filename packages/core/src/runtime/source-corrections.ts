import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  ContextCorrectionOperationEffect,
  ContextCorrectionProposal,
  ContextCorrectionProposalKind,
  ContextSourceCorrectionDecision,
  ContextSourceCorrectionDecisionActionResult,
  ContextSourceCorrectionDecisionCounts,
  ContextSourceCorrectionDecisionList,
  ContextSourceCorrectionDecisionStatus,
  ContextSourceCorrectionDecisionView,
  ContextSourceCorrectionDrift,
  ContextSourceCorrectionReplayResult
} from '../contracts/corrections.js'
import type {
  ContextGraph,
  Diagnostic,
  GraphPatch,
  GraphPatchAuthor,
  GraphRevision
} from '../contracts/graph.js'
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
import { createGraphRevision } from '../graph/revisions.js'
import { buildContextCorrectionOperationPlan } from './corrections.js'

export interface ListContextPackageCorrectionDecisionsOptions {
  outputDir: string
  packageRef?: string
  kind?: ContextCorrectionProposalKind
  status?: ContextSourceCorrectionDecisionStatus
  includeDrift?: boolean
}

export interface GetContextPackageCorrectionDecisionOptions {
  outputDir: string
  decisionId: string
}

export interface ReplayContextPackageCorrectionDecisionsOptions {
  outputDir: string
  decisionId?: string
  packageRef?: string
  dryRun?: boolean
}

export interface ProposeContextPackageCorrectionDecisionRevertOptions {
  outputDir: string
  decisionId: string
  actor: GraphPatchAuthor
  reason?: string
  generatedAt?: string
  config?: ContextProjectConfig
}

interface SourceCorrectionRuntimeFiles {
  graph: ContextGraph
  packages: ContextPackageRecord[]
  groups: ContextSourceGroupRecord[]
  entries: ContextSourceInventoryEntry[]
  decisions: ContextSourceCorrectionDecision[]
  revisions: GraphRevision[]
}

interface BuildDecisionViewsInput {
  packages: ContextPackageRecord[]
  groups: ContextSourceGroupRecord[]
  entries: ContextSourceInventoryEntry[]
  decisions: ContextSourceCorrectionDecision[]
}

/** List source-level correction decisions as an effective package-scoped memory view. */
export async function listContextPackageCorrectionDecisions(options: ListContextPackageCorrectionDecisionsOptions): Promise<ContextSourceCorrectionDecisionList> {
  const runtime = await readSourceCorrectionRuntime(options.outputDir)
  const packageRecord = options.packageRef ? resolvePackageRefOptional(runtime.packages, options.packageRef) : undefined
  const packagePathRef = options.packageRef && !packageRecord ? options.packageRef : undefined
  const views = buildContextSourceCorrectionDecisionViews(runtime)
    .filter((view) =>
      (!packageRecord && !packagePathRef) ||
      (packageRecord !== undefined && (view.package?.id === packageRecord.id || decisionWithinPackage(view.decision, packageRecord))) ||
      (packagePathRef !== undefined && decisionWithinPathRef(view.decision, view.package, packagePathRef))
    )
    .filter((view) => !options.kind || view.decision.kind === options.kind)
    .filter((view) => !options.status || view.effectiveStatus === options.status)
  return {
    schemaVersion: 'context-source-correction-decision-list.v1',
    package: packageRecord,
    decisions: views,
    counts: decisionCounts(views),
    diagnostics: []
  }
}

/** Get one source correction decision view by id. */
export async function getContextPackageCorrectionDecision(options: GetContextPackageCorrectionDecisionOptions): Promise<ContextSourceCorrectionDecisionView> {
  const runtime = await readSourceCorrectionRuntime(options.outputDir)
  const view = buildContextSourceCorrectionDecisionViews(runtime).find((candidate) => candidate.decision.id === options.decisionId)
  if (!view) {
    throw new Error(`Context source correction decision not found: ${options.decisionId}`)
  }
  return view
}

/** Replay active source correction decisions in memory without writing files. */
export async function replayContextPackageCorrectionDecisions(options: ReplayContextPackageCorrectionDecisionsOptions): Promise<ContextSourceCorrectionReplayResult> {
  const runtime = await readSourceCorrectionRuntime(options.outputDir)
  const packageRecord = options.packageRef ? resolvePackageRefOptional(runtime.packages, options.packageRef) : undefined
  const packagePathRef = options.packageRef && !packageRecord ? options.packageRef : undefined
  const allViews = buildContextSourceCorrectionDecisionViews(runtime)
  const selected = options.decisionId
    ? allViews.filter((view) => view.decision.id === options.decisionId)
    : allViews.filter((view) =>
      view.active &&
      (
        (!packageRecord && !packagePathRef) ||
        (packageRecord !== undefined && (view.package?.id === packageRecord.id || decisionWithinPackage(view.decision, packageRecord))) ||
        (packagePathRef !== undefined && decisionWithinPathRef(view.decision, view.package, packagePathRef))
      )
    )
  const pathScopedPackages = packagePathRef ? runtime.packages.filter((record) => pathWithin(record.path, packagePathRef) || pathWithin(packagePathRef, record.path)) : []
  const pathScopedGroups = packagePathRef ? runtime.groups.filter((group) => pathWithin(group.path, packagePathRef) || pathWithin(packagePathRef, group.path)) : []
  const replayFallbackGroups = uniqueGroups([
    ...selected.map((view) => view.sourceGroup).filter((group): group is ContextSourceGroupRecord => Boolean(group)),
    ...selected.map((view) => syntheticGroupFromDecision(view.decision)).filter((group): group is ContextSourceGroupRecord => Boolean(group))
  ])
  const before = {
    packages: packageRecord ? runtime.packages.filter((record) => record.id === packageRecord.id) : packagePathRef ? pathScopedPackages : runtime.packages,
    groups: packageRecord ? runtime.groups.filter((group) => pathWithin(group.path, packageRecord.path) || packageRecord.sourceGroupIds.includes(group.id)) : packagePathRef ? (pathScopedGroups.length > 0 ? pathScopedGroups : replayFallbackGroups) : runtime.groups
  }
  const afterGroups = before.groups.map((group) => ({ ...group, metadata: group.metadata ? { ...group.metadata } : undefined }))
  const afterPackages = before.packages.map((record) => ({ ...record, metadata: record.metadata ? { ...record.metadata } : undefined }))
  const effects: ContextCorrectionOperationEffect[] = []
  let effectIndex = 0

  for (const view of selected.filter((candidate) => candidate.active)) {
    const effect = applyDecisionToReplay(view.decision, afterGroups, afterPackages, effectIndex)
    if (effect) {
      effects.push(effect)
      effectIndex += 1
    }
  }

  return {
    schemaVersion: 'context-source-correction-replay.v1',
    written: false,
    package: packageRecord,
    decisionId: options.decisionId,
    decisions: selected.filter((view) => view.active),
    before,
    after: {
      packages: afterPackages,
      groups: afterGroups
    },
    effects,
    drifts: allViews.flatMap((view) => view.drifts),
    diagnostics: []
  }
}

/** Create a canonical correction proposal that reverses a source correction decision. */
export async function proposeContextPackageCorrectionDecisionRevert(options: ProposeContextPackageCorrectionDecisionRevertOptions): Promise<ContextSourceCorrectionDecisionActionResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const runtime = await readSourceCorrectionRuntime(options.outputDir)
  const view = buildContextSourceCorrectionDecisionViews(runtime).find((candidate) => candidate.decision.id === options.decisionId)
  if (!view) {
    throw new Error(`Context source correction decision not found: ${options.decisionId}`)
  }
  const proposal = revertProposalForDecision(runtime, view, options.actor, options.reason, generatedAt)
  await appendCorrectionOverlay(options.outputDir, proposal)
  return {
    schemaVersion: 'context-source-correction-decision-action-result.v1',
    action: 'revert',
    written: true,
    decision: view.decision,
    proposal,
    path: '.context/state/corrections.jsonl',
    diagnostics: []
  }
}

/** Collapse raw JSONL events into the latest event per id and effective status per dedupe key. */
export function effectiveSourceCorrectionDecisionRows(decisions: ContextSourceCorrectionDecision[]): ContextSourceCorrectionDecision[] {
  const latestById = latestDecisionById(decisions)
  const groups = new Map<string, ContextSourceCorrectionDecision[]>()
  for (const decision of latestById) {
    const key = decision.dedupeKey ?? decisionDedupeKey(decision)
    groups.set(key, [...(groups.get(key) ?? []), { ...decision, dedupeKey: key }])
  }
  const result: ContextSourceCorrectionDecision[] = []
  for (const group of groups.values()) {
    const ordered = group.sort((left, right) => decisionTime(left).localeCompare(decisionTime(right)) || left.id.localeCompare(right.id))
    const latestApplied = [...ordered].reverse().find((decision) => decision.status === 'applied')
    for (const decision of ordered) {
      if (latestApplied && decision.id !== latestApplied.id && decision.status === 'applied') {
        result.push({
          ...decision,
          status: 'superseded',
          supersededByDecisionId: latestApplied.id
        })
      } else if (latestApplied && decision.id === latestApplied.id) {
        result.push({
          ...decision,
          supersedesDecisionIds: ordered.filter((candidate) => candidate.id !== decision.id && candidate.status === 'applied').map((candidate) => candidate.id)
        })
      } else {
        result.push(decision)
      }
    }
  }
  return result.sort((left, right) => decisionTime(left).localeCompare(decisionTime(right)) || left.id.localeCompare(right.id))
}

export function buildContextSourceCorrectionDecisionViews(input: BuildDecisionViewsInput): ContextSourceCorrectionDecisionView[] {
  return effectiveSourceCorrectionDecisionRows(input.decisions).map((decision) => {
    const packageRecord = packageForDecision(decision, input.packages, input.groups)
    const sourceGroup = (decision.sourceGroupId ? input.groups.find((group) => group.id === decision.sourceGroupId) : undefined) ?? groupForDecisionPath(decision.sourcePath, input.groups)
    const targetGroup = decision.targetGroupId ? input.groups.find((group) => group.id === decision.targetGroupId) : groupForDecisionPath(decision.targetPath, input.groups)
    const drifts = decisionDrifts(decision, { packages: input.packages, groups: input.groups, entries: input.entries, packageRecord, sourceGroup, targetGroup })
    const effectiveStatus = decision.status
    const active = effectiveStatus === 'applied' && drifts.every((drift) => drift.severity !== 'error')
    return {
      schemaVersion: 'context-source-correction-decision-view.v1',
      decision,
      package: packageRecord,
      sourceGroup,
      targetGroup,
      active,
      effectiveStatus,
      supersedesDecisionIds: decision.supersedesDecisionIds ?? [],
      supersededByDecisionId: decision.supersededByDecisionId,
      drifts,
      diagnostics: drifts.map((drift) => driftDiagnostic(drift))
    }
  })
}

async function readSourceCorrectionRuntime(outputDir: string): Promise<SourceCorrectionRuntimeFiles> {
  const [graph, packages, groups, entries, decisions, revisions] = await Promise.all([
    loadGraphFilesOptional(outputDir),
    readJsonlOptional<ContextPackageRecord>(resolve(outputDir, 'model', 'packages.jsonl')),
    readJsonlOptional<ContextSourceGroupRecord>(resolve(outputDir, 'model', 'groups.jsonl')),
    readJsonlOptional<ContextSourceInventoryEntry>(resolve(outputDir, 'model', 'source-inventory.jsonl')),
    readJsonlOptional<ContextSourceCorrectionDecision>(resolve(outputDir, 'state', 'source-correction-decisions.jsonl')),
    readJsonlOptional<GraphRevision>(resolve(outputDir, 'graph', 'revisions.jsonl'))
  ])
  return {
    graph,
    packages: packages.length > 0 ? packages : packagesFromGraph(graph, groups),
    groups: groups.length > 0 ? groups : sourceGroupsFromGraph(graph),
    entries,
    decisions,
    revisions
  }
}

async function loadGraphFilesOptional(outputDir: string): Promise<ContextGraph> {
  try {
    return await loadGraphFiles(outputDir)
  } catch {
    return { nodes: [], edges: [], diagnostics: [] }
  }
}

function latestDecisionById(decisions: ContextSourceCorrectionDecision[]): ContextSourceCorrectionDecision[] {
  const byId = new Map<string, ContextSourceCorrectionDecision>()
  for (const decision of decisions) {
    const existing = byId.get(decision.id)
    if (!existing || decisionTime(existing) <= decisionTime(decision)) {
      byId.set(decision.id, decision)
    }
  }
  return [...byId.values()]
}

function decisionDrifts(
  decision: ContextSourceCorrectionDecision,
  context: {
    packages: ContextPackageRecord[]
    groups: ContextSourceGroupRecord[]
    entries: ContextSourceInventoryEntry[]
    packageRecord?: ContextPackageRecord
    sourceGroup?: ContextSourceGroupRecord
    targetGroup?: ContextSourceGroupRecord
  }
): ContextSourceCorrectionDrift[] {
  const drifts: ContextSourceCorrectionDrift[] = []
  const add = (drift: Omit<ContextSourceCorrectionDrift, 'decisionId'>) => {
    drifts.push({ decisionId: decision.id, ...drift })
  }
  if (decision.status === 'superseded') {
    add({
      type: 'superseded_by_newer_decision',
      severity: 'warning',
      message: `Source correction decision ${decision.id} is superseded by ${decision.supersededByDecisionId ?? 'a newer decision'}.`,
      packageId: decision.packageId,
      sourceGroupId: decision.sourceGroupId,
      sourcePath: decision.sourcePath
    })
  }
  if (decision.packageId && !context.packageRecord) {
    if (!decision.sourcePath || !sourcePathExists(decision.sourcePath, context.entries, context.groups)) {
      add({
        type: 'missing_package',
        severity: 'error',
        message: `Source correction decision ${decision.id} references missing package ${decision.packageId}.`,
        packageId: decision.packageId
      })
    }
  }
  if (decision.sourceGroupId && !context.sourceGroup) {
    if (!decision.sourcePath || !sourcePathExists(decision.sourcePath, context.entries, context.groups)) {
      add({
        type: 'missing_source_group',
        severity: 'error',
        message: `Source correction decision ${decision.id} references missing source group ${decision.sourceGroupId}.`,
        sourceGroupId: decision.sourceGroupId
      })
    }
  }
  if (decision.targetGroupId && !context.targetGroup) {
    add({
      type: 'missing_target_group',
      severity: 'error',
      message: `Source correction decision ${decision.id} references missing target group ${decision.targetGroupId}.`,
      targetGroupId: decision.targetGroupId
    })
  }
  if (decision.sourcePath && !sourcePathExists(decision.sourcePath, context.entries, context.groups)) {
    add({
      type: 'missing_source_path',
      severity: 'error',
      message: `Source correction decision ${decision.id} references missing source path ${decision.sourcePath}.`,
      sourcePath: decision.sourcePath
    })
  }
  if (decision.kind === 'relabel' && context.sourceGroup && stringValue(decision.before, 'kind') && stringValue(decision.before, 'kind') !== context.sourceGroup.kind) {
    add({
      type: 'grouping_conflict',
      severity: 'warning',
      message: `Source correction decision ${decision.id} expected ${stringValue(decision.before, 'kind')}, but current group kind is ${context.sourceGroup.kind}.`,
      sourceGroupId: context.sourceGroup.id
    })
  }
  return drifts
}

function applyDecisionToReplay(
  decision: ContextSourceCorrectionDecision,
  groups: ContextSourceGroupRecord[],
  packages: ContextPackageRecord[],
  index: number
): ContextCorrectionOperationEffect | undefined {
  if (decision.kind === 'relabel' && decision.sourceGroupId) {
    const group = groups.find((candidate) => candidate.id === decision.sourceGroupId) ?? groupForDecisionPath(decision.sourcePath, groups)
    if (!group) return undefined
    const before = sourceGroupSnapshot(group)
    group.kind = sourceGroupKind(stringValue(decision.after, 'kind')) ?? group.kind
    group.title = stringValue(decision.after, 'title') ?? group.title
    group.summary = stringValue(decision.after, 'summary') ?? group.summary
    group.confidence = numberValue(decision.after, 'confidence') ?? group.confidence
    group.metadata = {
      ...(group.metadata ?? {}),
      correctionDecisionIds: uniqueStrings([...(Array.isArray(group.metadata?.correctionDecisionIds) ? group.metadata.correctionDecisionIds.filter((id): id is string => typeof id === 'string') : []), decision.id])
    }
    for (const packageRecord of packages.filter((record) => record.sourceGroupIds.includes(group.id) || pathWithin(group.path, record.path))) {
      packageRecord.summary = group.summary
      packageRecord.confidence = group.confidence
      packageRecord.kind = packageKindForSourceGroupKind(group.kind)
      packageRecord.metadata = {
        ...(packageRecord.metadata ?? {}),
        correctionDecisionIds: uniqueStrings([...(Array.isArray(packageRecord.metadata?.correctionDecisionIds) ? packageRecord.metadata.correctionDecisionIds.filter((id): id is string => typeof id === 'string') : []), decision.id])
      }
    }
    return {
      id: `EFFECT-${stableId(`${decision.id}:${index}:relabel`)}`,
      layer: 'source',
      kind: 'source_group_relabel',
      operation: 'relabel',
      targetKind: 'source_group',
      targetId: group.id,
      before,
      after: sourceGroupSnapshot(group),
      summary: `Replay relabel decision ${decision.id}.`,
      persistent: false
    }
  }
  if (decision.kind === 'rehome' && decision.sourceGroupId) {
    const group = groups.find((candidate) => candidate.id === decision.sourceGroupId)
    if (!group) return undefined
    const before = sourceGroupSnapshot(group)
    const overrides = Array.isArray(group.metadata?.sourcePathOverrides) ? group.metadata.sourcePathOverrides : []
    group.metadata = {
      ...(group.metadata ?? {}),
      sourcePathOverrides: [...overrides, { sourcePath: decision.sourcePath, targetPath: decision.targetPath, targetGroupId: decision.targetGroupId }],
      correctionDecisionIds: uniqueStrings([...(Array.isArray(group.metadata?.correctionDecisionIds) ? group.metadata.correctionDecisionIds.filter((id): id is string => typeof id === 'string') : []), decision.id])
    }
    return {
      id: `EFFECT-${stableId(`${decision.id}:${index}:rehome`)}`,
      layer: 'source',
      kind: 'source_path_rehome',
      operation: 'rehome',
      targetKind: 'source_path',
      targetId: decision.sourcePath,
      path: decision.sourcePath,
      before,
      after: sourceGroupSnapshot(group),
      summary: `Replay rehome decision ${decision.id}.`,
      persistent: false
    }
  }
  return undefined
}

function revertProposalForDecision(
  runtime: SourceCorrectionRuntimeFiles,
  view: ContextSourceCorrectionDecisionView,
  actor: GraphPatchAuthor,
  reason: string | undefined,
  generatedAt: string
): ContextCorrectionProposal {
  const decision = view.decision
  const revision = runtime.revisions.at(-1) ?? createGraphRevision(runtime.graph, { reason: 'materialized compile graph', status: 'materialized', createdAt: generatedAt })
  const graphPatch = graphPatchForRevertDecision(decision, actor, revision, generatedAt)
  const proposal: ContextCorrectionProposal = {
    schemaVersion: 'context-correction-proposal.v1',
    id: `CORRECTION-${decision.kind}-${stableId(`revert:${decision.id}`)}`,
    dedupeKey: `revert:${decision.dedupeKey ?? decisionDedupeKey(decision)}`,
    kind: decision.kind,
    status: 'proposed',
    title: `Revert ${decision.id}`,
    summary: reason ?? `Revert source correction decision ${decision.id}.`,
    packageId: view.package?.id ?? decision.packageId,
    packagePath: view.package?.path,
    sourceGroupIds: uniqueStrings([decision.sourceGroupId, decision.targetGroupId]),
    affectedNodeIds: uniqueStrings([decision.sourceGroupId, decision.targetGroupId]),
    sourcePaths: uniqueStrings([decision.sourcePath, decision.targetPath]),
    confidence: 1,
    evidence: [{
      type: 'explicit_reference',
      description: reason ?? `Revert source correction decision ${decision.id}.`,
      sourceRefs: sourceRefsForDecision(decision)
    }],
    evidenceReportIds: [],
    graphPatchIds: graphPatch ? [graphPatch.id] : [],
    rehomeProposalIds: [],
    derivedFrom: [{ kind: 'source_correction_decision', id: decision.id }],
    supersedesProposalIds: [],
    impact: emptyImpact(),
    conflicts: graphPatch ? [] : [{
      type: 'missing_graph_patch',
      severity: 'error',
      message: `Source correction decision ${decision.id} cannot be reverted with an executable graph patch.`,
      proposalId: `CORRECTION-${decision.kind}-${stableId(`revert:${decision.id}`)}`
    }],
    blocked: !graphPatch,
    graphPatch,
    actor,
    statusReason: reason,
    createdAt: generatedAt,
    updatedAt: generatedAt
  }
  return {
    ...proposal,
    operationPlan: buildContextCorrectionOperationPlan({
      graph: runtime.graph,
      packages: runtime.packages,
      groups: runtime.groups,
      proposal
    })
  }
}

function graphPatchForRevertDecision(
  decision: ContextSourceCorrectionDecision,
  actor: GraphPatchAuthor,
  revision: GraphRevision,
  generatedAt: string
): GraphPatch | undefined {
  if (decision.kind === 'relabel' && decision.sourceGroupId) {
    const kind = sourceGroupKind(stringValue(decision.before, 'kind'))
    if (!kind) return undefined
    return {
      schemaVersion: 'context-graph-patch.v1',
      id: `PATCH-${stableId(`revert:${decision.id}`)}`,
      revisionId: revision.id,
      author: actor,
      status: 'proposed',
      createdAt: generatedAt,
      evidence: [{ type: 'explicit_reference', description: `Revert source correction decision ${decision.id}.`, sourceRefs: sourceRefsForDecision(decision) }],
      evidenceReportIds: [],
      operations: [{
        op: 'relabel_source_group',
        nodeId: decision.sourceGroupId,
        kind,
        title: stringValue(decision.before, 'title'),
        summary: stringValue(decision.before, 'summary'),
        confidence: numberValue(decision.before, 'confidence')
      }]
    }
  }
  return undefined
}

async function appendCorrectionOverlay(outputDir: string, proposal: ContextCorrectionProposal): Promise<void> {
  const path = join(outputDir, 'state', 'corrections.jsonl')
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(proposal)}\n`, 'utf8')
}

function decisionCounts(views: ContextSourceCorrectionDecisionView[]): ContextSourceCorrectionDecisionCounts {
  const byKind: ContextSourceCorrectionDecisionCounts['byKind'] = {}
  const byStatus: ContextSourceCorrectionDecisionCounts['byStatus'] = {}
  for (const view of views) {
    byKind[view.decision.kind] = (byKind[view.decision.kind] ?? 0) + 1
    byStatus[view.effectiveStatus] = (byStatus[view.effectiveStatus] ?? 0) + 1
  }
  return {
    total: views.length,
    active: views.filter((view) => view.active).length,
    applied: byStatus.applied ?? 0,
    superseded: byStatus.superseded ?? 0,
    reverted: byStatus.reverted ?? 0,
    invalid: byStatus.invalid ?? 0,
    drifted: views.filter((view) => view.drifts.length > 0).length,
    byKind,
    byStatus
  }
}

function packageForDecision(
  decision: ContextSourceCorrectionDecision,
  packages: ContextPackageRecord[],
  groups: ContextSourceGroupRecord[]
): ContextPackageRecord | undefined {
  if (decision.packageId) {
    const byId = packages.find((record) => record.id === decision.packageId)
    if (byId) return byId
  }
  if (decision.sourceGroupId) {
    const byGroup = packages.find((record) => record.sourceGroupIds.includes(decision.sourceGroupId as string))
    if (byGroup) return byGroup
  }
  const sourcePath = decision.sourcePath ?? groups.find((group) => group.id === decision.sourceGroupId)?.path
  return sourcePath ? packages.find((record) => pathWithin(sourcePath, record.path)) : undefined
}

function groupForDecisionPath(path: string | undefined, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  if (!path) {
    return undefined
  }
  return groups.find((group) => pathWithin(path, group.path) || pathWithin(group.path, path))
}

function syntheticGroupFromDecision(decision: ContextSourceCorrectionDecision): ContextSourceGroupRecord | undefined {
  const path = decision.sourcePath ?? stringValue(decision.before, 'path') ?? stringValue(decision.after, 'path')
  const sourceGroupId = decision.sourceGroupId
  if (!path || !sourceGroupId) {
    return undefined
  }
  const kind = sourceGroupKind(stringValue(decision.before, 'kind')) ?? sourceGroupKind(stringValue(decision.after, 'kind')) ?? 'unknown'
  return {
    id: sourceGroupId,
    sourceName: 'source-correction',
    path,
    title: stringValue(decision.before, 'title') ?? stringValue(decision.after, 'title') ?? path,
    kind,
    boundaryMode: kind === 'repository' ? 'repository' : 'collapsed',
    summary: stringValue(decision.before, 'summary') ?? stringValue(decision.after, 'summary') ?? `Synthetic replay group for ${decision.id}.`,
    confidence: numberValue(decision.before, 'confidence') ?? numberValue(decision.after, 'confidence') ?? 0.5,
    decisionSource: 'inferred',
    sourceRef: { sourceId: 'source-correction', uri: `file://${path}`, location: { path } },
    metadata: { syntheticReplay: true, correctionDecisionIds: [decision.id] }
  }
}

function uniqueGroups(groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord[] {
  const byId = new Map<string, ContextSourceGroupRecord>()
  for (const group of groups) {
    byId.set(group.id, group)
  }
  return [...byId.values()]
}

function resolvePackageRef(packages: ContextPackageRecord[], ref: string): ContextPackageRecord {
  const normalizedRef = normalizeRef(ref)
  const exact = packages.find((record) => packageAliases(record).some((alias) => normalizeRef(alias) === normalizedRef))
  if (exact) return exact
  const fuzzy = packages.filter((record) => packageAliases(record).some((alias) => normalizeRef(alias).includes(normalizedRef)))
  if (fuzzy.length === 1) return fuzzy[0] as ContextPackageRecord
  if (fuzzy.length > 1) {
    throw new Error(`Context package reference is ambiguous: ${ref}. Matches: ${fuzzy.map((record) => record.id).join(', ')}`)
  }
  throw new Error(`Context package not found: ${ref}`)
}

function resolvePackageRefOptional(packages: ContextPackageRecord[], ref: string): ContextPackageRecord | undefined {
  try {
    return resolvePackageRef(packages, ref)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Context package not found:')) {
      return undefined
    }
    throw error
  }
}

function packageAliases(record: ContextPackageRecord): string[] {
  return uniqueStrings([record.id, record.path, record.title, record.sourceName, record.sourceRef.location?.path, record.sourceRef.uri])
}

function decisionWithinPathRef(decision: ContextSourceCorrectionDecision, packageRecord: ContextPackageRecord | undefined, ref: string): boolean {
  return Boolean(
    (packageRecord?.path && (pathWithin(packageRecord.path, ref) || pathWithin(ref, packageRecord.path))) ||
    (decision.sourcePath && (pathWithin(decision.sourcePath, ref) || pathWithin(ref, decision.sourcePath))) ||
    (decision.targetPath && (pathWithin(decision.targetPath, ref) || pathWithin(ref, decision.targetPath))) ||
    (stringValue(decision.before, 'path') && pathWithin(stringValue(decision.before, 'path') as string, ref)) ||
    (stringValue(decision.after, 'path') && pathWithin(stringValue(decision.after, 'path') as string, ref))
  )
}

function decisionWithinPackage(decision: ContextSourceCorrectionDecision, record: ContextPackageRecord): boolean {
  return Boolean(
    decision.packageId === record.id ||
    (decision.sourceGroupId && record.sourceGroupIds.includes(decision.sourceGroupId)) ||
    (decision.targetGroupId && record.sourceGroupIds.includes(decision.targetGroupId)) ||
    (decision.sourcePath && pathWithin(decision.sourcePath, record.path)) ||
    (decision.targetPath && pathWithin(decision.targetPath, record.path))
  )
}

function sourcePathExists(path: string, entries: ContextSourceInventoryEntry[], groups: ContextSourceGroupRecord[]): boolean {
  const normalized = normalizePath(path)
  return entries.some((entry) => normalizePath(entry.path) === normalized || pathWithin(entry.path, normalized)) ||
    groups.some((group) => normalizePath(group.path) === normalized)
}

function sourceRefsForDecision(decision: ContextSourceCorrectionDecision): SourceRef[] {
  const path = decision.sourcePath ?? stringValue(decision.before, 'path') ?? stringValue(decision.after, 'path')
  return path ? [{ sourceId: 'source-correction', uri: `file://${path}`, location: { path } }] : []
}

function driftDiagnostic(drift: ContextSourceCorrectionDrift): Diagnostic {
  return createDiagnostic({ severity: drift.severity, code: `source-correction.${drift.type}`, message: drift.message, nodeId: drift.sourceGroupId ?? drift.targetGroupId })
}

function emptyImpact() {
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
    riskLevel: 'low' as const
  }
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
    confidence: group.confidence,
    decisionSource: group.decisionSource
  }
}

function decisionDedupeKey(decision: ContextSourceCorrectionDecision): string {
  return [
    decision.kind,
    decision.packageId,
    decision.sourceGroupId,
    decision.targetGroupId,
    normalizePath(decision.sourcePath),
    normalizePath(decision.targetPath)
  ].filter(Boolean).join(':')
}

function decisionTime(decision: ContextSourceCorrectionDecision): string {
  return decision.updatedAt ?? decision.createdAt
}

function packagesFromGraph(graph: ContextGraph, groups: ContextSourceGroupRecord[]): ContextPackageRecord[] {
  return graph.nodes.filter((node) => node.type === 'Package').map((node) => {
    const path = typeof node.properties.path === 'string' ? node.properties.path : node.sourceRefs[0]?.location?.path ?? node.name
    return {
      id: node.id,
      sourceName: typeof node.properties.sourceName === 'string' ? node.properties.sourceName : node.sourceRefs[0]?.sourceId ?? 'source',
      path,
      title: node.name,
      kind: packageKind(String(node.properties.packageKind ?? 'unknown')),
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
      kind: sourceGroupKind(String(node.properties.kind ?? 'unknown')) ?? 'unknown',
      boundaryMode: 'collapsed',
      summary: typeof node.properties.summary === 'string' ? node.properties.summary : node.name,
      confidence: node.confidence,
      decisionSource: 'inferred',
      sourceRef: node.sourceRefs[0] ?? { sourceId: 'source', uri: `file://${path}`, location: { path } }
    }
  })
}

function packageKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageRecord['kind'] {
  switch (kind) {
    case 'repository':
      return 'code_repository'
    case 'test_bundle':
      return 'test_materials'
    case 'api_bundle':
      return 'api_contracts'
    case 'doc_bundle':
    case 'domain_area':
    case 'config_bundle':
      return 'product_docs'
    case 'analysis_bundle':
      return 'analysis'
    case 'design_bundle':
      return 'design'
    case 'data_bundle':
      return 'data'
    case 'runtime_bundle':
      return 'runtime'
    case 'asset_bundle':
      return 'asset'
    default:
      return 'unknown'
  }
}

function packageKind(value: string): ContextPackageRecord['kind'] {
  const allowed = new Set<ContextPackageRecord['kind']>(['product_docs', 'code_repository', 'api_contracts', 'test_materials', 'analysis', 'design', 'data', 'runtime', 'asset', 'unknown'])
  return allowed.has(value as ContextPackageRecord['kind']) ? value as ContextPackageRecord['kind'] : 'unknown'
}

function sourceGroupKind(value: string | undefined): ContextSourceGroupRecord['kind'] | undefined {
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
  return allowed.has(value as ContextSourceGroupRecord['kind']) ? value as ContextSourceGroupRecord['kind'] : undefined
}

function stringValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function numberValue(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' ? value : undefined
}

function normalizeRef(value: string): string {
  return normalizePath(value).toLowerCase()
}

function normalizePath(value: string | undefined): string {
  return (value ?? '').trim().replace(/^\.?\//, '').replace(/\/+$/g, '').split('\\').join('/')
}

function pathWithin(path: string, parent: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parent)
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)
}

function stableId(value: string): string {
  return normalizePath(value).replace(/[^A-Za-z0-9_.:-]+/g, '-') || fingerprintValue(value).slice(0, 12)
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

async function readJsonlOptional<T>(path: string): Promise<T[]> {
  try {
    const content = await readFile(path, 'utf8')
    return content.trim().length === 0 ? [] : content.trim().split('\n').map((line) => JSON.parse(line) as T)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
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
    throw error
  }
}

function legacyRuntimePath(path: string): string | undefined {
  return path
    .replace('/model/source-inventory.jsonl', '/sources/inventory.jsonl')
    .replace('/model/groups.jsonl', '/sources/groups.jsonl')
    .replace('/model/packages.jsonl', '/sources/packages.jsonl')
    .replace('/state/source-correction-decisions.jsonl', '/sources/correction-decisions.jsonl')
    .replace('/graph/revisions.jsonl', '/graph/revisions/revisions.jsonl')
}
