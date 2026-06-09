import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type ContextGraph,
  type EvidenceReport,
  type GraphPatch,
  type GraphRevision,
  type PlanningCycle,
  type RehomeProposal
} from '../contracts/graph.js'
import type { ContextProjectConfig } from '../contracts/config.js'
import type { ContextPack } from '../contracts/runtime.js'
import type { ContextSourceGroupRecord, ContextSourceInventory, ContextSourceInventoryEntry } from '../contracts/sources.js'
import { inferContextViews, renderContextView } from '../context/index.js'
import { loadGraphFiles, resolveOutputDir, writeGraphFiles } from '../graph/index.js'
import { fingerprintValue } from '../graph/model.js'
import { createGraphRevision } from '../graph/revisions.js'
import { applyGraphPatchBatch, buildPlanningPack, reconcileEvidenceReports } from '../kernel/index.js'
import { buildContextRuntimePlan } from './planner.js'
import { buildContextRuntimeWorkspace, type ContextGraphKernelWorkspace } from './workspace.js'
import { writeContextRuntimeWorkspace } from './writer.js'

export interface ApplySubmittedGraphPatchesOptions {
  config: ContextProjectConfig
  dryRun?: boolean
  generatedAt?: string
}

export interface ApplySubmittedGraphPatchesResult {
  dryRun: boolean
  baseRevision: GraphRevision
  newRevision?: GraphRevision
  appliedPatches: GraphPatch[]
  rejectedPatches: GraphPatch[]
  inboxPatches: GraphPatch[]
  evidencePatches: GraphPatch[]
  evidenceReports: EvidenceReport[]
  ledgerPatches: GraphPatch[]
  diagnostics: ContextGraph['diagnostics']
  graph: {
    nodes: number
    edges: number
    diagnostics: number
  }
}

export interface EvidenceReportListingResult {
  reports: EvidenceReport[]
  derivedPatches: Array<GraphPatch & { processed: boolean; ledgerStatus?: GraphPatch['status'] }>
  counts: {
    reports: number
    findings: number
    derivedPatches: number
    processedPatches: number
    pendingPatches: number
  }
  diagnostics: ContextGraph['diagnostics']
}

/** Apply submitted graph patches through the kernel and rematerialize the runtime workspace. */
export async function applySubmittedGraphPatches(options: ApplySubmittedGraphPatchesOptions): Promise<ApplySubmittedGraphPatchesResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const outputDir = resolveOutputDir(options.config.workspace.rootDir, options.config.outputDir ?? '.context')
  const graph = await loadGraphFiles(outputDir)
  const sourceInventory = await readSourceInventory(outputDir)
  const revisions = await readGraphRevisions(outputDir)
  const baseRevision = revisions.at(-1) ?? createGraphRevision(graph, {
    reason: 'materialized compile graph',
    status: 'materialized',
    createdAt: generatedAt
  })
  const ledgerPatches = await readGraphPatchLedger(outputDir)
  const inboxPatches = await readGraphPatchInbox(outputDir)
  const evidenceReports = await readEvidenceReports(outputDir)
  const evidence = deriveEvidenceGraphPatches(graph, baseRevision, evidenceReports, ledgerPatches)
  const batch = applyGraphPatchBatch(graph, baseRevision, [...inboxPatches, ...evidence.evidencePatches])
  const nextRevisions = revisions.length > 0 ? [...revisions] : [baseRevision]
  if (batch.revision) {
    nextRevisions.push(batch.revision)
  }
  const nextLedger = [...ledgerPatches, ...batch.appliedPatches, ...batch.rejectedPatches]
  const existingProposals = await readRehomeProposals(outputDir)
  const nextProposals = [...existingProposals, ...batch.rehomeProposals]
  const nextGraph = batch.graph

  if (!options.dryRun) {
    const packs = buildViewPacks(nextGraph, options.config)
    const plan = buildContextRuntimePlan(nextGraph, packs)
    const graphKernel = buildGraphKernelWorkspace({
      graph: nextGraph,
      sourceInventory,
      revisions: nextRevisions,
      patches: nextLedger,
      evidenceReports,
      rehomeProposals: nextProposals,
      generatedAt,
      baseRevision,
      newRevision: batch.revision,
      diagnostics: batch.diagnostics
    })
    await writeGraphFiles(nextGraph, outputDir, { sourceInventory })
    await writeContextRuntimeWorkspace(
      outputDir,
      buildContextRuntimeWorkspace(nextGraph, options.config, packs, {
        compiledAt: generatedAt,
        plan,
        sourceInventory,
        graphKernel
      })
    )
    await writeJsonl(join(outputDir, 'graph', 'submitted-patches.jsonl'), [])
  }

  return {
    dryRun: Boolean(options.dryRun),
    baseRevision,
    newRevision: batch.revision,
    appliedPatches: batch.appliedPatches,
    rejectedPatches: batch.rejectedPatches,
    inboxPatches,
    evidencePatches: evidence.evidencePatches,
    evidenceReports,
    ledgerPatches: nextLedger,
    diagnostics: batch.diagnostics,
    graph: {
      nodes: nextGraph.nodes.length,
      edges: nextGraph.edges.length,
      diagnostics: nextGraph.diagnostics.length
    }
  }
}

export async function readGraphPatchLedger(outputDir: string): Promise<GraphPatch[]> {
  return readOptionalJsonl<GraphPatch>(join(outputDir, 'graph', 'patches.jsonl'))
}

export async function readGraphPatchInbox(outputDir: string): Promise<GraphPatch[]> {
  return readOptionalJsonl<GraphPatch>(join(outputDir, 'graph', 'submitted-patches.jsonl'))
}

export async function readEvidenceReports(outputDir: string): Promise<EvidenceReport[]> {
  return readOptionalJsonl<EvidenceReport>(join(outputDir, 'graph', 'evidence-reports.jsonl'))
}

export async function readEvidenceReportListing(outputDir: string, options: { scopeId?: string } = {}): Promise<EvidenceReportListingResult> {
  const graph = await loadGraphFiles(outputDir)
  const revisions = await readGraphRevisions(outputDir)
  const baseRevision = revisions.at(-1) ?? createGraphRevision(graph, {
    reason: 'materialized compile graph',
    status: 'materialized'
  })
  const ledgerPatches = await readGraphPatchLedger(outputDir)
  const reports = (await readEvidenceReports(outputDir)).filter((report) => !options.scopeId || report.scopeId === options.scopeId)
  const reconciled = reconcileEvidenceReports(graph, baseRevision, reports)
  const ledgerById = new Map(ledgerPatches.map((patch) => [patch.id, patch]))
  const derivedPatches = reconciled.patches.map((patch) => {
    const ledgerPatch = ledgerById.get(patch.id)
    return {
      ...patch,
      processed: Boolean(ledgerPatch),
      ...(ledgerPatch ? { ledgerStatus: ledgerPatch.status } : {})
    }
  })
  const processedPatches = derivedPatches.filter((patch) => patch.processed).length
  return {
    reports,
    derivedPatches,
    counts: {
      reports: reports.length,
      findings: reports.reduce((count, report) => count + report.findings.length, 0),
      derivedPatches: derivedPatches.length,
      processedPatches,
      pendingPatches: derivedPatches.length - processedPatches
    },
    diagnostics: graph.diagnostics
  }
}

export function deriveEvidenceGraphPatches(
  graph: ContextGraph,
  baseRevision: GraphRevision,
  evidenceReports: EvidenceReport[],
  ledgerPatches: GraphPatch[] = []
): { evidenceReports: EvidenceReport[]; evidencePatches: GraphPatch[]; rehomeProposals: RehomeProposal[] } {
  const reconciled = reconcileEvidenceReports(graph, baseRevision, evidenceReports)
  const processedPatchIds = new Set(ledgerPatches.map((patch) => patch.id))
  return {
    evidenceReports,
    evidencePatches: reconciled.patches.filter((patch) => !processedPatchIds.has(patch.id)),
    rehomeProposals: reconciled.rehomeProposals
  }
}

function buildGraphKernelWorkspace(input: {
  graph: ContextGraph
  sourceInventory: ContextSourceInventory
  revisions: GraphRevision[]
  patches: GraphPatch[]
  evidenceReports: EvidenceReport[]
  rehomeProposals: RehomeProposal[]
  generatedAt: string
  baseRevision: GraphRevision
  newRevision?: GraphRevision
  diagnostics: ContextGraph['diagnostics']
}): ContextGraphKernelWorkspace {
  const planningPack = buildPlanningPack(input.sourceInventory, { generatedAt: input.generatedAt })
  const planningCycle: PlanningCycle = {
    schemaVersion: 'context-planning-cycle.v1',
    id: `CYCLE-${fingerprintValue({
      baseRevisionId: input.baseRevision.id,
      newRevisionId: input.newRevision?.id,
      patchIds: input.patches.map((patch) => patch.id),
      generatedAt: input.generatedAt
    }).slice(0, 16)}`,
    generatedAt: input.generatedAt,
    status: input.newRevision ? 'patched' : 'reconciled',
    planningPackRef: '.context/model/plans/planning-pack.json',
    patchIds: input.patches.map((patch) => patch.id),
    revisionIds: input.revisions.map((revision) => revision.id),
    diagnostics: input.diagnostics
  }
  return {
    revisions: input.revisions,
    patches: input.patches,
    evidenceReports: input.evidenceReports,
    planningPack,
    planningCycles: [planningCycle],
    rehomeProposals: input.rehomeProposals
  }
}

function buildViewPacks(graph: ContextGraph, config: ContextProjectConfig): ContextPack[] {
  return inferContextViews(graph).map((view) => ({
    id: `context-view:${view.name}`,
    kind: 'context-view',
    title: view.title,
    content: renderContextView(graph, config, view.name),
    view: view.name,
    metadata: {}
  }))
}

async function readSourceInventory(outputDir: string): Promise<ContextSourceInventory> {
  const entries = await readOptionalJsonl<ContextSourceInventoryEntry>(join(outputDir, 'model', 'source-inventory.jsonl'))
  const groups = await readOptionalJsonl<ContextSourceGroupRecord>(join(outputDir, 'model', 'groups.jsonl'))
  const packages = await readOptionalJsonl<NonNullable<ContextSourceInventory['packages']>[number]>(join(outputDir, 'model', 'packages.jsonl'))
  const summary = await readOptionalJson<ContextSourceInventory['summary']>(join(outputDir, 'model', 'source-summary.json'))
  return {
    schemaVersion: 'context-source-inventory.v1',
    entries,
    groups,
    packages,
    summary: summary ?? {
      roots: new Set(entries.map((entry) => entry.root)).size,
      files: entries.length,
      packages: packages.length,
      groups: groups.length,
      routed: entries.filter((entry) => entry.status === 'routed').length,
      inventoryOnly: entries.filter((entry) => entry.status === 'inventory_only').length,
      unsupported: entries.filter((entry) => entry.status === 'unsupported').length,
      skipped: entries.filter((entry) => entry.status === 'skipped').length
    }
  }
}

async function readGraphRevisions(outputDir: string): Promise<GraphRevision[]> {
  return readOptionalJsonl<GraphRevision>(join(outputDir, 'graph', 'revisions.jsonl'))
}

async function readRehomeProposals(outputDir: string): Promise<RehomeProposal[]> {
  return readOptionalJsonl<RehomeProposal>(join(outputDir, 'state', 'rehome-proposals.jsonl'))
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    const legacyPath = legacyRuntimePath(path)
    if (legacyPath && legacyPath !== path) {
      try {
        return JSON.parse(await readFile(legacyPath, 'utf8')) as T
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

async function readOptionalJsonl<T>(path: string): Promise<T[]> {
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
    .replace('/model/source-summary.json', '/sources/summary.json')
    .replace('/state/rehome-proposals.jsonl', '/proposals/rehome-proposals.jsonl')
    .replace('/graph/patches.jsonl', '/graph/patches/patches.jsonl')
    .replace('/graph/submitted-patches.jsonl', '/graph/patches/submitted.jsonl')
    .replace('/graph/revisions.jsonl', '/graph/revisions/revisions.jsonl')
}

async function writeJsonl(path: string, records: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const content = records.map((record) => JSON.stringify(record)).join('\n')
  await writeFile(path, content.length > 0 ? `${content}\n` : '')
}
