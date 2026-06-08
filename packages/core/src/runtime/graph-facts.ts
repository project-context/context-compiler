import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  ContextGraph,
  Diagnostic,
  Evidence,
  EvidenceReport,
  GraphFactExplainBudget,
  GraphFactExplanation,
  GraphFactExplainMode,
  GraphFactHistory,
  GraphPatch,
  GraphRevision,
  PatchOperation,
  SourceRef
} from '../contracts/index.js'
import { createDiagnostic } from '../diagnostics/index.js'
import { loadGraphFiles } from '../graph/index.js'
import { fingerprintValue, slug } from '../graph/model.js'
import { createGraphRevision } from '../kernel/index.js'

export interface ExplainGraphFactOptions {
  outputDir: string
  factId: string
  mode?: GraphFactExplainMode
  limitSources?: number
  limitEvidence?: number
  limitRelations?: number
  limitProvenance?: number
}

export interface BuildGraphFactHistoryOptions {
  outputDir: string
  factId: string
}

export interface RevertGraphPatchOptions {
  outputDir: string
  patchId: string
  dryRun?: boolean
  generatedAt?: string
}

export interface RevertGraphPatchResult {
  dryRun: boolean
  patchId: string
  reversePatch?: GraphPatch
  submitted: boolean
  path?: string
  diagnostics: Diagnostic[]
}

const DEFAULT_SUMMARY_BUDGET = {
  sources: 10,
  evidence: 8,
  relations: 12,
  provenance: 12
}

export async function explainGraphFact(options: ExplainGraphFactOptions): Promise<GraphFactExplanation> {
  const explanation = await hydrateGraphFactExplanation(options.outputDir, options.factId)
  return applyExplainBudget(explanation, budgetFromOptions(options))
}

export async function buildGraphFactHistory(options: BuildGraphFactHistoryOptions): Promise<GraphFactHistory> {
  const explanation = await hydrateGraphFactExplanation(options.outputDir, options.factId)
  const revisionIds = new Set(explanation.provenance.map((item) => item.revisionId))
  const patchIds = new Set(explanation.provenance.map((item) => item.patchId).filter((id): id is string => Boolean(id)))
  const evidenceReportIds = new Set(explanation.provenance.flatMap((item) => item.evidenceReportIds))
  const diagnostics = [...explanation.diagnostics]
  if (patchIds.size > 0 && explanation.patches.length === 0) {
    diagnostics.push(createDiagnostic({
      severity: 'warning',
      code: 'graph.history.missing-patch-ledger',
      message: `Graph fact ${options.factId} references patch ids but no matching patch ledger entries were found.`,
      nodeId: explanation.node?.id
    }))
  }
  return {
    schemaVersion: 'context-graph-fact-history.v1',
    factId: explanation.factId,
    factKind: explanation.factKind,
    timeline: explanation.provenance
      .map((item) => ({
        revisionId: item.revisionId,
        previousRevisionId: item.previousRevisionId,
        patchId: item.patchId,
        operation: item.operation,
        operationIndex: item.operationIndex,
        findingTypes: item.findingTypes,
        evidenceReportIds: item.evidenceReportIds,
        sourceRefCount: item.sourceRefs.length,
        status: item.status,
        createdAt: item.createdAt
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.revisionId.localeCompare(right.revisionId)),
    revisions: explanation.revisions.filter((revision) => revisionIds.has(revision.id)),
    patches: explanation.patches.filter((patch) => patchIds.has(patch.id)),
    evidenceReports: explanation.evidenceReports.filter((report) => evidenceReportIds.has(report.id)),
    diagnostics
  }
}

export function applyExplainBudget(explanation: GraphFactExplanation, budget: GraphFactExplainBudget): GraphFactExplanation {
  if (budget.mode === 'full') {
    return {
      ...explanation,
      budget: { mode: 'full' },
      omitted: { sourceRefs: 0, evidence: 0, relations: 0, provenance: 0 }
    }
  }

  const sourceLimit = budget.sources ?? DEFAULT_SUMMARY_BUDGET.sources
  const evidenceLimit = budget.evidence ?? DEFAULT_SUMMARY_BUDGET.evidence
  const relationLimit = budget.relations ?? DEFAULT_SUMMARY_BUDGET.relations
  const provenanceLimit = budget.provenance ?? DEFAULT_SUMMARY_BUDGET.provenance
  const sourceRefs = explanation.sourceRefs.slice(0, sourceLimit)
  const relatedEdges = explanation.relatedEdges.slice(0, relationLimit).map((edge) => budgetEdge(edge, sourceLimit, evidenceLimit))
  const relatedNodeIds = new Set(relatedEdges.flatMap((edge) => [edge.from, edge.to]).filter((id) => id !== explanation.node?.id))
  const provenance = explanation.provenance.slice(0, provenanceLimit).map((item) => ({
    ...item,
    evidence: budgetEvidence(item.evidence.slice(0, evidenceLimit), sourceLimit),
    sourceRefs: item.sourceRefs.slice(0, sourceLimit)
  }))
  const totalEvidence = explanation.provenance.reduce((count, item) => count + item.evidence.length, 0)
  const retainedEvidence = provenance.reduce((count, item) => count + item.evidence.length, 0)

  return {
    ...explanation,
    node: explanation.node ? budgetNode(explanation.node, sourceLimit, evidenceLimit) : undefined,
    edge: explanation.edge ? budgetEdge(explanation.edge, sourceLimit, evidenceLimit) : undefined,
    relatedEdges,
    relatedNodes: explanation.node
      ? explanation.relatedNodes.filter((node) => relatedNodeIds.has(node.id)).map((node) => budgetNode(node, sourceLimit, evidenceLimit))
      : explanation.relatedNodes.map((node) => budgetNode(node, sourceLimit, evidenceLimit)),
    provenance,
    sourceRefs,
    patches: explanation.patches.map((patch) => budgetPatch(patch, sourceLimit, evidenceLimit)),
    evidenceReports: explanation.evidenceReports.map((report) => budgetEvidenceReport(report, sourceLimit, evidenceLimit)),
    budget: {
      mode: 'summary',
      sources: sourceLimit,
      evidence: evidenceLimit,
      relations: relationLimit,
      provenance: provenanceLimit
    },
    omitted: {
      sourceRefs: Math.max(0, explanation.sourceRefs.length - sourceRefs.length),
      evidence: Math.max(0, totalEvidence - retainedEvidence),
      relations: Math.max(0, explanation.relatedEdges.length - relatedEdges.length),
      provenance: Math.max(0, explanation.provenance.length - provenance.length)
    }
  }
}

function budgetNode(node: ContextGraph['nodes'][number], sourceLimit: number, evidenceLimit: number): ContextGraph['nodes'][number] {
  const properties = { ...node.properties }
  const content = properties.content
  const contentPreviewLimit = 240
  if (typeof content === 'string' && content.length > contentPreviewLimit) {
    properties.contentPreview = content.slice(0, contentPreviewLimit)
    properties.contentOmittedChars = content.length - contentPreviewLimit
    delete properties.content
  }
  return {
    ...node,
    sourceRefs: node.sourceRefs.slice(0, sourceLimit),
    provenance: [],
    properties
  }
}

function budgetEdge(edge: ContextGraph['edges'][number], sourceLimit: number, evidenceLimit: number): ContextGraph['edges'][number] {
  return {
    ...edge,
    evidence: budgetEvidence(edge.evidence.slice(0, evidenceLimit), sourceLimit),
    provenance: []
  }
}

function budgetPatch(patch: GraphPatch, sourceLimit: number, evidenceLimit: number): GraphPatch {
  return {
    ...patch,
    evidence: budgetEvidence(patch.evidence.slice(0, evidenceLimit), sourceLimit),
    operations: patch.operations.map((operation) => {
      switch (operation.op) {
        case 'add_node':
          return { ...operation, node: budgetNode(operation.node, sourceLimit, evidenceLimit) }
        case 'add_edge':
        case 'link':
          return { ...operation, edge: budgetEdge(operation.edge, sourceLimit, evidenceLimit) }
        case 'restore_node_snapshot':
          return { ...operation, node: budgetNode(operation.node, sourceLimit, evidenceLimit) }
        default:
          return operation
      }
    }),
    applicationResults: patch.applicationResults?.map((result) => ({
      schemaVersion: result.schemaVersion,
      patchId: result.patchId,
      operationIndex: result.operationIndex,
      operation: result.operation,
      factKind: result.factKind,
      factId: result.factId
    }))
  }
}

function budgetEvidenceReport(report: EvidenceReport, sourceLimit: number, evidenceLimit: number): EvidenceReport {
  return {
    ...report,
    findings: report.findings.slice(0, evidenceLimit).map((finding) => ({
      ...finding,
      evidence: budgetEvidence(finding.evidence.slice(0, evidenceLimit), sourceLimit),
      evidenceRefs: finding.evidenceRefs?.slice(0, sourceLimit)
    })),
    proposedPatches: report.proposedPatches.map((patch) => budgetPatch(patch, sourceLimit, evidenceLimit))
  }
}

function budgetEvidence(evidence: Evidence[], sourceLimit: number): Evidence[] {
  return evidence.map((item) => ({
    ...item,
    sourceRefs: item.sourceRefs.slice(0, sourceLimit)
  }))
}

async function hydrateGraphFactExplanation(outputDir: string, factId: string): Promise<GraphFactExplanation> {
  const [graph, patches, revisions, reports] = await Promise.all([
    loadGraphFiles(outputDir),
    readGraphPatchLedger(outputDir),
    readGraphRevisions(outputDir),
    readEvidenceReports(outputDir)
  ])
  const node = graph.nodes.find((candidate) => candidate.id === factId)
  const edge = graph.edges.find((candidate) => candidate.id === factId)
  if (!node && !edge) {
    throw new Error(`Graph fact not found: ${factId}`)
  }

  const provenance = node?.provenance ?? edge?.provenance ?? []
  const patchIds = new Set(provenance.map((item) => item.patchId).filter((id): id is string => Boolean(id)))
  const evidenceReportIds = new Set(provenance.flatMap((item) => item.evidenceReportIds))
  const relatedEdges = node ? graph.edges.filter((candidate) => candidate.from === node.id || candidate.to === node.id) : edge ? [edge] : []
  const relatedNodeIds = new Set(
    node
      ? relatedEdges.flatMap((candidate) => [candidate.from, candidate.to]).filter((id) => id !== node.id)
      : edge
        ? [edge.from, edge.to]
        : []
  )
  const selectedPatches = patches.filter((patch) => patchIds.has(patch.id))
  for (const patch of selectedPatches) {
    for (const reportId of patch.evidenceReportIds ?? []) {
      evidenceReportIds.add(reportId)
    }
  }
  const selectedReports = reports.filter((report) => evidenceReportIds.has(report.id))
  const revisionIds = new Set(provenance.map((item) => item.revisionId))
  for (const patch of selectedPatches) {
    if (patch.appliedRevisionId) {
      revisionIds.add(patch.appliedRevisionId)
    }
    revisionIds.add(patch.revisionId)
  }

  const diagnostics: Diagnostic[] = []
  if (provenance.length === 0) {
    diagnostics.push(createDiagnostic({
      severity: 'warning',
      code: 'graph.fact.missing-provenance',
      message: `Graph fact ${factId} has no provenance entries.`,
      nodeId: node?.id
    }))
  }

  return {
    schemaVersion: 'context-graph-fact-explanation.v1',
    factId,
    factKind: node ? 'node' : 'edge',
    node,
    edge,
    relatedEdges,
    relatedNodes: graph.nodes.filter((candidate) => relatedNodeIds.has(candidate.id)),
    provenance,
    revisions: revisions.filter((revision) => revisionIds.has(revision.id)),
    patches: selectedPatches,
    evidenceReports: selectedReports,
    sourceRefs: uniqueSourceRefs([
      ...(node?.sourceRefs ?? []),
      ...sourceRefsForEvidence(edge?.evidence ?? []),
      ...provenance.flatMap((item) => item.sourceRefs),
      ...provenance.flatMap((item) => sourceRefsForEvidence(item.evidence))
    ]),
    budget: { mode: 'full' },
    omitted: { sourceRefs: 0, evidence: 0, relations: 0, provenance: 0 },
    diagnostics
  }
}

export async function revertGraphPatch(options: RevertGraphPatchOptions): Promise<RevertGraphPatchResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const [graph, ledger, revisions] = await Promise.all([
    loadGraphFiles(options.outputDir),
    readGraphPatchLedger(options.outputDir),
    readGraphRevisions(options.outputDir)
  ])
  const patch = ledger.find((candidate) => candidate.id === options.patchId)
  const diagnostics: Diagnostic[] = []
  if (!patch) {
    diagnostics.push(revertDiagnostic('graph.revert.missing-patch', options.patchId, `Applied graph patch not found: ${options.patchId}`))
    return { dryRun: Boolean(options.dryRun), patchId: options.patchId, submitted: false, diagnostics }
  }
  if (patch.status !== 'applied') {
    diagnostics.push(revertDiagnostic('graph.revert.patch-not-applied', options.patchId, `Graph patch ${options.patchId} is ${patch.status}, not applied.`))
    return { dryRun: Boolean(options.dryRun), patchId: options.patchId, submitted: false, diagnostics }
  }
  if (!patch.applicationResults || patch.applicationResults.length === 0) {
    diagnostics.push(revertDiagnostic('graph.revert.missing-application-results', options.patchId, `Graph patch ${options.patchId} has no application results to reverse.`))
    return { dryRun: Boolean(options.dryRun), patchId: options.patchId, submitted: false, diagnostics }
  }

  const latestRevision = revisions.at(-1) ?? createGraphRevision(graph, { reason: 'materialized compile graph', status: 'materialized' })
  diagnostics.push(...detectRevertConflicts(graph, revisions, patch))
  const operations = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? []
    : reverseOperationsForPatch(patch, diagnostics)
  if (operations.length === 0) {
    return { dryRun: Boolean(options.dryRun), patchId: options.patchId, submitted: false, diagnostics }
  }

  const reversePatch: GraphPatch = {
    schemaVersion: 'context-graph-patch.v1',
    id: `PATCH-revert-${slug(`${patch.id}-${latestRevision.id}`)}`,
    revisionId: latestRevision.id,
    author: { type: 'kernel', name: 'graph-kernel' },
    status: 'proposed',
    createdAt: generatedAt,
    evidence: [
      {
        type: 'manual',
        description: `Reverse graph patch ${patch.id}`,
        sourceRefs: []
      }
    ],
    evidenceReportIds: patch.evidenceReportIds ?? [],
    operations
  }

  if (!options.dryRun) {
    const inboxPath = join(options.outputDir, 'graph', 'patches', 'submitted.jsonl')
    await mkdir(dirname(inboxPath), { recursive: true })
    await appendFile(inboxPath, `${JSON.stringify(reversePatch)}\n`, 'utf8')
    return { dryRun: false, patchId: options.patchId, reversePatch, submitted: true, path: '.context/graph/patches/submitted.jsonl', diagnostics }
  }

  return { dryRun: true, patchId: options.patchId, reversePatch, submitted: false, diagnostics }
}

async function readGraphPatchLedger(outputDir: string): Promise<GraphPatch[]> {
  return readOptionalJsonl<GraphPatch>(join(outputDir, 'graph', 'patches', 'patches.jsonl'))
}

async function readGraphRevisions(outputDir: string): Promise<GraphRevision[]> {
  return readOptionalJsonl<GraphRevision>(join(outputDir, 'graph', 'revisions', 'revisions.jsonl'))
}

async function readEvidenceReports(outputDir: string): Promise<EvidenceReport[]> {
  return readOptionalJsonl<EvidenceReport>(join(outputDir, 'graph', 'evidence-reports.jsonl'))
}

async function readOptionalJsonl<T>(path: string): Promise<T[]> {
  try {
    const content = await readFile(path, 'utf8')
    if (content.trim().length === 0) {
      return []
    }
    return content.trim().split('\n').map((line) => JSON.parse(line) as T)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function reverseOperationsForPatch(patch: GraphPatch, diagnostics: Diagnostic[]): PatchOperation[] {
  const operations: PatchOperation[] = []
  for (const result of [...(patch.applicationResults ?? [])].reverse()) {
    switch (result.operation) {
      case 'add_node':
        if (result.factId) {
          operations.push({ op: 'deprecate_node', nodeId: result.factId, reason: `Revert ${patch.id}` })
        }
        break
      case 'add_edge':
      case 'link':
        if (result.factId) {
          operations.push({ op: 'deprecate_edge', edgeId: result.factId, reason: `Revert ${patch.id}` })
        }
        break
      case 'update_node':
      case 'deprecate_node':
      case 'relabel_source_group':
      case 'reparent_node':
      case 'restore_node_snapshot':
        if (result.previousNode) {
          operations.push({ op: 'restore_node_snapshot', node: result.previousNode, reason: `Revert ${patch.id}` })
        } else {
          diagnostics.push(revertDiagnostic('graph.revert.missing-node-snapshot', patch.id, `Patch ${patch.id} operation ${result.operationIndex} has no previous node snapshot.`))
        }
        break
      case 'deprecate_edge':
        diagnostics.push(revertDiagnostic('graph.revert.unsupported-operation', patch.id, `Patch ${patch.id} operation ${result.operationIndex} cannot be reversed without restore_edge_snapshot.`))
        break
      case 'rehome_proposal':
        break
    }
  }
  return operations
}

function detectRevertConflicts(graph: ContextGraph, revisions: GraphRevision[], patch: GraphPatch): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const revisionOrder = new Map(revisions.map((revision, index) => [revision.id, index]))
  const targetRevisionOrder = patch.appliedRevisionId ? revisionOrder.get(patch.appliedRevisionId) : undefined
  if (targetRevisionOrder === undefined) {
    return diagnostics
  }
  for (const result of patch.applicationResults ?? []) {
    if (!result.factId) {
      continue
    }
    const fact = result.factKind === 'node'
      ? graph.nodes.find((node) => node.id === result.factId)
      : graph.edges.find((edge) => edge.id === result.factId)
    const laterProvenance = fact?.provenance?.find((entry) => {
      const entryOrder = revisionOrder.get(entry.revisionId)
      return entry.patchId && entry.patchId !== patch.id && entryOrder !== undefined && entryOrder > targetRevisionOrder
    })
    if (laterProvenance) {
      diagnostics.push(revertDiagnostic(
        'graph.revert.conflict',
        result.factId,
        `Graph fact ${result.factId} was changed by patch ${laterProvenance.patchId} after ${patch.id}.`
      ))
    }
  }
  return diagnostics
}

function sourceRefsForEvidence(evidence: Evidence[]): SourceRef[] {
  return uniqueSourceRefs(evidence.flatMap((item) => item.sourceRefs))
}

function budgetFromOptions(options: ExplainGraphFactOptions): GraphFactExplainBudget {
  const hasLimit = options.limitSources !== undefined || options.limitEvidence !== undefined || options.limitRelations !== undefined || options.limitProvenance !== undefined
  if (options.mode === 'full' && !hasLimit) {
    return { mode: 'full' }
  }
  return {
    mode: options.mode === 'full' && !hasLimit ? 'full' : 'summary',
    sources: options.limitSources ?? DEFAULT_SUMMARY_BUDGET.sources,
    evidence: options.limitEvidence ?? DEFAULT_SUMMARY_BUDGET.evidence,
    relations: options.limitRelations ?? DEFAULT_SUMMARY_BUDGET.relations,
    provenance: options.limitProvenance ?? DEFAULT_SUMMARY_BUDGET.provenance
  }
}

function uniqueSourceRefs(sourceRefs: SourceRef[]): SourceRef[] {
  const refs = new Map<string, SourceRef>()
  for (const ref of sourceRefs) {
    refs.set(`${ref.sourceId}:${ref.uri}:${ref.location?.path ?? ''}`, ref)
  }
  return [...refs.values()]
}

function revertDiagnostic(code: string, target: string, message: string): Diagnostic {
  return createDiagnostic({
    id: `DIAG-${fingerprintValue({ code, target, message }).slice(0, 16)}`,
    severity: 'error',
    code,
    message,
    nodeId: target
  })
}
