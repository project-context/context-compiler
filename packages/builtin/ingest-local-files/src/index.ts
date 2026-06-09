import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { type SourceConfig } from '@context-compiler/core/config'
import { createContextEdge, createContextNode, defineComponent, type ContextPackageRecord, type ContextComponent, type ContextEdge, type ContextNode, type ContextSourceGroupCandidate, type ContextSourceGroupingDecision, type ContextSourceGroupingDecisions, type ContextSourceGroupingRequest, type ContextSourceGroupRecord, type ContextSourceInventory, type ContextSourceInventoryEntry, type ContextSourceRoute, type RawArtifact } from '@context-compiler/core/sdk'
import {
  applySourceCorrectionDecisions,
  buildInferredUnknownGroupingDecision,
  buildTypedSourceGroupingDecision,
  buildL0Packages,
  buildSourceModelSeedGraph,
  type ContextSourceCorrectionDecision,
  decisionPath,
  effectiveSourceCorrectionDecisionRows,
  groupingDecisionToSourceGroupRecord,
  pathWithin,
  sourceRefFor,
  sourceRootNode
} from '@context-compiler/core/source-model'

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024
const execFileAsync = promisify(execFile)
const DEFAULT_SKIPPED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.vite'
])

/** Create the default local file ingest component. */
export function createLocalFilesIngestComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'ingest.local-files',
      stage: 'ingest',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['source-config'],
      outputs: ['raw-artifact', 'source-inventory', 'context-fact:source'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(_state, context) {
      const rawArtifacts: RawArtifact[] = []
      const entries: ContextSourceInventoryEntry[] = []
      const groups: ContextSourceGroupRecord[] = []
      const packages: ContextPackageRecord[] = []
      const sourceNodes: ContextNode[] = []
      const sourceEdges: ContextEdge[] = []
      let groupingRequest: ContextSourceGroupingRequest | undefined

      for (const source of context.config.sources) {
        const result = await readSource(source, context.rootDir, context.outputDir)
        rawArtifacts.push(...result.rawArtifacts)
        entries.push(...result.entries)
        groups.push(...result.groups)
        packages.push(...result.packages)
        sourceNodes.push(...result.nodes)
        sourceEdges.push(...result.edges)
        groupingRequest = mergeGroupingRequests(groupingRequest, result.groupingRequest)
      }

      return {
        rawArtifacts,
        facts: sourceNodes,
        edges: sourceEdges,
        artifacts: {
          sourceInventory: buildInventory(entries, context.config.sources.length, groups, packages, groupingRequest)
        }
      }
    }
  })
}

interface ReadSourceResult {
  rawArtifacts: RawArtifact[]
  entries: ContextSourceInventoryEntry[]
  groups: ContextSourceGroupRecord[]
  packages: ContextPackageRecord[]
  groupingRequest?: ContextSourceGroupingRequest
  nodes: ContextNode[]
  edges: ContextEdge[]
}

interface FileRoute {
  mediaType: string
  route: ContextSourceRoute
  unsupportedReason?: string
}

interface FileInventoryRecord {
  bytes: Buffer
  entry: ContextSourceInventoryEntry
}

type GroupingAgentMode = 'none' | 'auto' | 'claude'

async function readSource(source: SourceConfig, rootDir: string, outputDir: string): Promise<ReadSourceResult> {
  const sourcePath = resolve(rootDir, source.path)
  const files = await listFiles(sourcePath, source, rootDir)
  const rootNode = sourceRootNode({ source, rootDir, sourcePath, configuredPath: source.path })
  const nodes: ContextNode[] = []
  const entries: ContextSourceInventoryEntry[] = []
  const fileRecords: FileInventoryRecord[] = []
  const rawArtifacts: RawArtifact[] = []
  const edges: ContextEdge[] = []

  for (const file of files) {
    const bytes = await readFile(file)
    const relativePath = normalizePath(relative(rootDir, file))
    const route =
      bytes.byteLength > (source.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)
        ? { mediaType: 'application/octet-stream', route: 'unsupported' as const, unsupportedReason: 'max-file-size-exceeded' }
        : routeFile(source, file, bytes)
    const sourceRef = sourceRefFor(source.name, rootDir, file, relativePath)
    const entry: ContextSourceInventoryEntry = {
      id: `source-entry:${sha256(`${source.name}:${relativePath}`).slice(0, 16)}`,
      sourceName: source.name,
      root: source.path,
      path: relativePath,
      uri: sourceRef.uri,
      mediaType: route.mediaType,
      sizeBytes: bytes.byteLength,
      hash: sha256(bytes),
      route: route.route,
      status: route.route === 'unsupported' ? 'unsupported' : route.route === 'inventory' ? 'inventory_only' : 'routed',
      unsupportedReason: route.unsupportedReason,
      sourceRef,
      metadata: {
        sourceType: source.type ?? 'auto'
      }
    }
    entries.push(entry)
    fileRecords.push({ bytes, entry })
  }

  const grouping = await resolveSourceGrouping(source, rootDir, outputDir, sourcePath, entries)
  const packages = buildL0Packages(source.name, grouping.groups)
  const seedGraph = buildSourceModelSeedGraph({ sourceNode: rootNode, packages, groups: grouping.groups })
  nodes.push(...seedGraph.nodes)
  edges.push(...seedGraph.edges)

  for (const record of fileRecords) {
    const entry = record.entry
    const group = groupForEntry(entry, grouping.groups)
    if (shouldPromoteSnapshot(entry, group, source)) {
      const snapshotNodeId = `SNAPSHOT-${entry.hash.slice(0, 16)}`
      nodes.push(
        createContextNode({
          id: snapshotNodeId,
          type: 'SourceSnapshot',
          name: entry.path,
          sourceRefs: [entry.sourceRef],
          properties: {
            sourceName: source.name,
            root: source.path,
            path: entry.path,
            mediaType: entry.mediaType,
            sizeBytes: entry.sizeBytes,
            hash: entry.hash,
            route: entry.route,
            status: entry.status,
            unsupportedReason: entry.unsupportedReason,
            sourceGroupId: group?.id
          }
        })
      )
      edges.push(
        createContextEdge({
          id: `EDGE-${group?.id ?? rootNode.id}-contains-snapshot-${snapshotNodeId}`,
          from: group?.id ?? rootNode.id,
          to: snapshotNodeId,
          type: group ? 'contains_snapshot' : 'contains',
          linker: 'ingest.local-files',
          status: 'confirmed',
          evidence: []
        })
      )
    }

    if (entry.status === 'routed' && routeAllowedBySourceHint(entry.route, source)) {
      rawArtifacts.push({
        id: `raw:${source.name}:${entry.path}`,
        kind: 'raw',
        mediaType: entry.mediaType,
        content: record.bytes.toString('utf8'),
        source: entry.sourceRef,
        metadata: {
          sourceName: source.name,
          sourceType: source.type ?? 'auto',
          path: source.path,
          route: entry.route,
          sourceInventoryId: entry.id,
          sourceGroupId: group?.id
        }
      })
    }
  }

  return { rawArtifacts, entries, groups: grouping.groups, packages, groupingRequest: grouping.request, nodes, edges }
}

async function resolveSourceGrouping(
  source: SourceConfig,
  rootDir: string,
  outputDir: string,
  sourcePath: string,
  entries: ContextSourceInventoryEntry[]
): Promise<{ groups: ContextSourceGroupRecord[]; request?: ContextSourceGroupingRequest }> {
  const sourceRootPath = normalizePath(relative(rootDir, sourcePath))
  const correctionDecisions = await readSourceCorrectionDecisions(outputDir)
  const applyCorrections = (groups: ContextSourceGroupRecord[]) =>
    applySourceCorrectionDecisions({ groups, decisions: correctionDecisions, sourceRootPath, source, rootDir })
  if (!isAutoSource(source)) {
    const decision = buildTypedSourceGroupingDecision(source, sourceRootPath, entries)
    return {
      groups: applyCorrections([groupingDecisionToSourceGroupRecord({ source, rootDir, decision, decisionSource: 'typed-source' })])
    }
  }
  const decisions = await readGroupingDecisions(outputDir)
  const sourceDecisions = decisions?.decisions.filter((decision) => pathWithin(decisionPath(decision), sourceRootPath)) ?? []
  if (decisions?.agent === 'inferred' && sourceDecisions.length > 0) {
    const request = buildGroupingRequest(source, sourceRootPath, entries)
    await writeGroupingRequest(outputDir, request)
    const inferredDecisions = buildInferredGroupingDecisions(sourceRootPath, entries, request)
    await replaceGroupingDecisionsForSource(outputDir, decisions, sourceRootPath, inferredDecisions, 'inferred')
    return {
      groups: applyCorrections(inferredDecisions.map((decision) => groupingDecisionToSourceGroupRecord({ source, rootDir, decision, decisionSource: 'inferred' }))),
      request
    }
  }
  if (sourceDecisions.length === 0) {
    const request = buildGroupingRequest(source, sourceRootPath, entries)
    await writeGroupingRequest(outputDir, request)
    const agentDecisions = await resolveGroupingDecisionsWithAgent(source, rootDir, outputDir, sourceRootPath, request)
    if (agentDecisions.length > 0) {
      return {
        groups: applyCorrections(agentDecisions.map((decision) => groupingDecisionToSourceGroupRecord({ source, rootDir, decision, decisionSource: 'agent' }))),
        request
      }
    }
    const waitedDecisions = await waitForGroupingDecisions(outputDir, sourceRootPath, groupingWaitMs(source))
    if (waitedDecisions.length > 0) {
      return {
        groups: applyCorrections(waitedDecisions.map((decision) => groupingDecisionToSourceGroupRecord({ source, rootDir, decision, decisionSource: 'agent' }))),
        request
      }
    }
    const fallbackDecisions = buildInferredGroupingDecisions(sourceRootPath, entries, request)
    await replaceGroupingDecisionsForSource(outputDir, decisions, sourceRootPath, fallbackDecisions, 'inferred')
    return {
      groups: applyCorrections(fallbackDecisions.map((decision) => groupingDecisionToSourceGroupRecord({ source, rootDir, decision, decisionSource: 'inferred' }))),
      request
    }
  }
  const completeDecisions = withUncoveredUnknownDecisions(sourceRootPath, entries, sourceDecisions)
  if (completeDecisions.length > sourceDecisions.length) {
    await writeGroupingDecisions(outputDir, {
      schemaVersion: 'context-source-grouping-decisions.v1',
      generatedAt: new Date().toISOString(),
      agent: decisions?.agent ?? 'inferred',
      decisions: completeDecisions
    })
  }
  const originalDecisionPaths = new Set(sourceDecisions.map((decision) => decisionPath(decision)))
  return {
    groups: applyCorrections(completeDecisions.map((decision) => {
      const decisionSource = originalDecisionPaths.has(decisionPath(decision))
        ? decisions?.agent === 'inferred' ? 'inferred' : 'agent'
        : 'inferred'
      return groupingDecisionToSourceGroupRecord({ source, rootDir, decision, decisionSource })
    })),
    request: undefined
  }
}

function withUncoveredUnknownDecisions(
  sourceRootPath: string,
  entries: ContextSourceInventoryEntry[],
  decisions: ContextSourceGroupingDecision[]
): ContextSourceGroupingDecision[] {
  const uncoveredEntries = entries.filter((entry) => !decisions.some((decision) => pathWithin(entry.path, decisionPath(decision))))
  if (uncoveredEntries.length === 0) {
    return decisions
  }
  const existingPaths = new Set(decisions.map((decision) => decisionPath(decision)))
  const fallbackPaths = new Set(uncoveredEntries.map((entry) => uncoveredFallbackPath(sourceRootPath, entry.path)))
  const fallbackDecisions = [...fallbackPaths]
    .filter((path) => !existingPaths.has(path))
    .sort((left, right) => left.localeCompare(right))
    .map((path) => buildInferredUnknownGroupingDecision(path))
  return [...decisions, ...fallbackDecisions]
}

function uncoveredFallbackPath(sourceRootPath: string, entryPath: string): string {
  const normalizedRoot = normalizeConfiguredPath(sourceRootPath)
  const normalizedEntry = normalizeConfiguredPath(entryPath)
  if (normalizedEntry === normalizedRoot || !normalizedEntry.startsWith(`${normalizedRoot}/`)) {
    return normalizedRoot
  }
  const relativePath = normalizedEntry.slice(normalizedRoot.length + 1)
  const [firstSegment] = relativePath.split('/').filter(Boolean)
  return firstSegment ? `${normalizedRoot}/${firstSegment}` : normalizedRoot
}

function buildInferredGroupingDecisions(
  sourceRootPath: string,
  entries: ContextSourceInventoryEntry[],
  request: ContextSourceGroupingRequest
): ContextSourceGroupingDecision[] {
  const candidates = request.sources.flatMap((source) => source.candidates)
  const rootCandidate = candidates.find((candidate) => normalizeConfiguredPath(candidate.path) === normalizeConfiguredPath(sourceRootPath))
  const childCandidates = candidates
    .filter((candidate) => isImmediateChildCandidate(candidate.path, sourceRootPath))
    .filter((candidate) => candidate.suggestedKind !== 'unknown')
    .sort((left, right) => left.path.localeCompare(right.path))
  const hasDirectRootEntries = entries.some((entry) => normalizeConfiguredPath(dirname(entry.path)) === normalizeConfiguredPath(sourceRootPath) || normalizeConfiguredPath(entry.path) === normalizeConfiguredPath(sourceRootPath))

  if (!hasDirectRootEntries && childCandidates.length > 0) {
    return childCandidates.map(candidateToInferredDecision)
  }
  if (rootCandidate) {
    return [candidateToInferredDecision(rootCandidate)]
  }
  return [buildInferredUnknownGroupingDecision(sourceRootPath)]
}

function candidateToInferredDecision(candidate: ContextSourceGroupCandidate): ContextSourceGroupingDecision {
  return {
    path: candidate.path,
    kind: candidate.suggestedKind,
    boundaryMode: candidate.suggestedBoundaryMode,
    title: candidate.title,
    summary: `Inferred ${candidate.suggestedKind.replace(/_/g, ' ')} source group from ${candidate.fileCount} file${candidate.fileCount === 1 ? '' : 's'}.`,
    childrenPolicy: candidate.suggestedKind === 'repository' || candidate.suggestedKind === 'doc_bundle' || candidate.suggestedKind === 'api_bundle' || candidate.suggestedKind === 'test_bundle' ? 'promote_routed' : 'promote_none',
    confidence: candidate.confidence
  }
}

function isImmediateChildCandidate(path: string, rootPath: string): boolean {
  const normalizedPath = normalizeConfiguredPath(path)
  const normalizedRoot = normalizeConfiguredPath(rootPath)
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return false
  }
  return normalizedPath.slice(normalizedRoot.length + 1).split('/').filter(Boolean).length === 1
}

async function resolveGroupingDecisionsWithAgent(
  source: SourceConfig,
  rootDir: string,
  outputDir: string,
  sourceRootPath: string,
  request: ContextSourceGroupingRequest
): Promise<ContextSourceGroupingDecision[]> {
  const mode = groupingAgentMode(source)
  if (mode === 'none') {
    return []
  }
  if (mode !== 'auto' && mode !== 'claude') {
    return []
  }

  const decisions = await callClaudeGroupingAgent(source, rootDir, outputDir, request)
  if (!decisions) {
    return []
  }
  await writeGroupingDecisions(outputDir, decisions)
  return decisions.decisions.filter((decision) => pathWithin(decisionPath(decision), sourceRootPath))
}

async function callClaudeGroupingAgent(
  source: SourceConfig,
  rootDir: string,
  outputDir: string,
  request: ContextSourceGroupingRequest
): Promise<ContextSourceGroupingDecisions | undefined> {
  const command = typeof source.groupingAgentCommand === 'string' ? source.groupingAgentCommand : process.env.CONTEXT_SOURCE_GROUPING_AGENT_COMMAND ?? 'claude'
  const timeoutMs = groupingAgentTimeoutMs(source)
  try {
    const result = await execFileAsync(command, ['-p', groupingPrompt(request)], {
      cwd: rootDir,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    })
    const fileDecisions = await readGroupingDecisions(outputDir)
    if (fileDecisions) {
      return fileDecisions
    }
    return parseGroupingDecisions(result.stdout)
  } catch (error) {
    await writeGroupingAgentStatus(outputDir, {
      schemaVersion: 'context-source-grouping-agent-status.v1',
      provider: 'claude',
      command,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      generatedAt: new Date().toISOString()
    })
    return undefined
  }
}

function groupingPrompt(request: ContextSourceGroupingRequest): string {
  return [
    'You are Context Compiler source grouping planner.',
    'Given a source inventory grouping request, decide which directories are local wholes for a Graph-of-Graphs workspace.',
    'Return only valid JSON. Do not include markdown fences, commentary, or prose.',
    '',
    'Required JSON schema:',
    JSON.stringify(
      {
        schemaVersion: 'context-source-grouping-decisions.v1',
        agent: 'claude | codex | inferred | custom-agent-name',
        decisions: [
          {
            path: 'candidate path from the request',
            kind: 'repository | doc_bundle | asset_bundle | analysis_bundle | domain_area | data_bundle | api_bundle | design_bundle | test_bundle | config_bundle | runtime_bundle | vendor_bundle | generated_bundle | archive | unknown',
            boundaryMode: 'expanded | collapsed | repository',
            title: 'short human title',
            summary: 'one sentence summary',
            childrenPolicy: 'promote_routed | promote_none | promote_all',
            confidence: 0.8
          }
        ]
      },
      null,
      2
    ),
    '',
    'Rules:',
    '- Prefer repository for source-code repo roots with package.json, tsconfig, src, or lockfiles.',
    '- Prefer doc_bundle for product/documentation folders.',
    '- Prefer analysis_bundle for PDF, PPT, Excel, reports, research, and analysis folders.',
    '- Prefer asset_bundle for image/media/static asset folders.',
    '- Prefer domain_area when a folder is clearly a business domain containing mixed materials.',
    '- Use collapsed for document, analysis, asset, domain, data, runtime, vendor, generated, archive, and unknown bundles.',
    '- Use repository boundaryMode for repository groups.',
    '- Pick useful local wholes; avoid returning every leaf directory unless it is an independent bundle.',
    '',
    'Grouping request JSON:',
    JSON.stringify(request, null, 2)
  ].join('\n')
}

function parseGroupingDecisions(output: string): ContextSourceGroupingDecisions | undefined {
  const trimmed = output.trim()
  const candidates = [trimmed, stripJsonFence(trimmed), jsonObjectSlice(trimmed)].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ContextSourceGroupingDecisions
      if (isGroupingDecisions(parsed)) {
        return parsed
      }
    } catch {
      // Try the next candidate form.
    }
  }
  return undefined
}

function stripJsonFence(value: string): string | undefined {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value)
  return match?.[1]?.trim()
}

function jsonObjectSlice(value: string): string | undefined {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  return start >= 0 && end > start ? value.slice(start, end + 1) : undefined
}

function isGroupingDecisions(value: ContextSourceGroupingDecisions): value is ContextSourceGroupingDecisions {
  return value?.schemaVersion === 'context-source-grouping-decisions.v1' && Array.isArray(value.decisions)
}

async function writeGroupingDecisions(outputDir: string, decisions: ContextSourceGroupingDecisions): Promise<void> {
  const existing = await readGroupingDecisions(outputDir)
  const merged: ContextSourceGroupingDecisions = {
    schemaVersion: 'context-source-grouping-decisions.v1',
    generatedAt: decisions.generatedAt ?? new Date().toISOString(),
    agent: decisions.agent ?? 'claude',
    decisions: mergeDecisions(existing?.decisions ?? [], decisions.decisions)
  }
  await mkdir(join(outputDir, 'state'), { recursive: true })
  await writeFile(join(outputDir, 'state', 'grouping-decisions.json'), `${JSON.stringify(merged, null, 2)}\n`)
}

async function replaceGroupingDecisionsForSource(
  outputDir: string,
  existing: ContextSourceGroupingDecisions | undefined,
  sourceRootPath: string,
  incoming: ContextSourceGroupingDecision[],
  agent: string
): Promise<void> {
  const retainedDecisions = (existing?.decisions ?? []).filter((decision) => !pathWithin(decisionPath(decision), sourceRootPath))
  const next: ContextSourceGroupingDecisions = {
    schemaVersion: 'context-source-grouping-decisions.v1',
    generatedAt: new Date().toISOString(),
    agent,
    decisions: mergeDecisions(retainedDecisions, incoming)
  }
  await mkdir(join(outputDir, 'state'), { recursive: true })
  await writeFile(join(outputDir, 'state', 'grouping-decisions.json'), `${JSON.stringify(next, null, 2)}\n`)
}

function mergeDecisions(
  existing: ContextSourceGroupingDecision[],
  incoming: ContextSourceGroupingDecision[]
): ContextSourceGroupingDecision[] {
  const byPath = new Map(existing.map((decision) => [decisionPath(decision), decision]))
  for (const decision of incoming) {
    byPath.set(decisionPath(decision), decision)
  }
  return [...byPath.values()].sort((left, right) => decisionPath(left).localeCompare(decisionPath(right)))
}

async function writeGroupingAgentStatus(outputDir: string, status: Record<string, unknown>): Promise<void> {
  await mkdir(join(outputDir, 'state'), { recursive: true })
  await writeFile(join(outputDir, 'state', 'grouping-agent-status.json'), `${JSON.stringify(status, null, 2)}\n`)
}

function groupingAgentMode(source: SourceConfig): GroupingAgentMode {
  const configured = typeof source.groupingAgent === 'string' ? source.groupingAgent : process.env.CONTEXT_SOURCE_GROUPING_AGENT
  if (configured === 'none' || configured === 'off' || configured === 'false') {
    return 'none'
  }
  if (configured === 'claude') {
    return 'claude'
  }
  if (configured === 'auto') {
    return 'auto'
  }
  return process.stdin.isTTY && process.stdout.isTTY && process.env.CI !== 'true' ? 'auto' : 'none'
}

function groupingAgentTimeoutMs(source: SourceConfig): number {
  if (typeof source.groupingAgentTimeoutMs === 'number' && Number.isFinite(source.groupingAgentTimeoutMs)) {
    return Math.max(1000, source.groupingAgentTimeoutMs)
  }
  const envTimeout = process.env.CONTEXT_SOURCE_GROUPING_AGENT_TIMEOUT_MS
  if (envTimeout && Number.isFinite(Number(envTimeout))) {
    return Math.max(1000, Number(envTimeout))
  }
  return 2 * 60 * 1000
}

async function readGroupingDecisions(outputDir: string): Promise<ContextSourceGroupingDecisions | undefined> {
  try {
    return JSON.parse(await readFile(join(outputDir, 'state', 'grouping-decisions.json'), 'utf8')) as ContextSourceGroupingDecisions
  } catch {
    try {
      return JSON.parse(await readFile(join(outputDir, 'sources', 'grouping-decisions.json'), 'utf8')) as ContextSourceGroupingDecisions
    } catch {
      return undefined
    }
  }
}

async function readSourceCorrectionDecisions(outputDir: string): Promise<ContextSourceCorrectionDecision[]> {
  try {
    const content = await readFile(join(outputDir, 'state', 'source-correction-decisions.jsonl'), 'utf8').catch(() =>
      readFile(join(outputDir, 'sources', 'correction-decisions.jsonl'), 'utf8')
    )
    const rows = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ContextSourceCorrectionDecision)
      .filter((decision) => decision.schemaVersion === 'context-source-correction-decision.v1')
    return effectiveSourceCorrectionDecisionRows(rows).filter((decision) => decision.status === 'applied')
  } catch {
    return []
  }
}

async function waitForGroupingDecisions(
  outputDir: string,
  sourceRootPath: string,
  timeoutMs: number
): Promise<ContextSourceGroupingDecision[]> {
  if (timeoutMs <= 0) {
    return []
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await delay(1000)
    const decisions = await readGroupingDecisions(outputDir)
    const sourceDecisions = decisions?.decisions.filter((decision) => pathWithin(decisionPath(decision), sourceRootPath)) ?? []
    if (sourceDecisions.length > 0) {
      return sourceDecisions
    }
  }
  return []
}

function groupingWaitMs(source: SourceConfig): number {
  if (typeof source.groupingWaitMs === 'number' && Number.isFinite(source.groupingWaitMs)) {
    return Math.max(0, source.groupingWaitMs)
  }
  const envWait = process.env.CONTEXT_SOURCE_GROUPING_WAIT_MS
  if (envWait && Number.isFinite(Number(envWait))) {
    return Math.max(0, Number(envWait))
  }
  return process.stdin.isTTY && process.stdout.isTTY && process.env.CI !== 'true' ? 5 * 60 * 1000 : 0
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function writeGroupingRequest(outputDir: string, request: ContextSourceGroupingRequest): Promise<void> {
  await mkdir(join(outputDir, 'model'), { recursive: true })
  await writeFile(join(outputDir, 'model', 'grouping-request.json'), `${JSON.stringify(request, null, 2)}\n`)
}

function buildGroupingRequest(source: SourceConfig, rootPath: string, entries: ContextSourceInventoryEntry[]): ContextSourceGroupingRequest {
  return {
    schemaVersion: 'context-source-grouping-request.v1',
    generatedAt: new Date().toISOString(),
    sources: [
      {
        sourceName: source.name,
        root: source.path,
        candidates: buildGroupingCandidates(rootPath, entries)
      }
    ]
  }
}

function buildGroupingCandidates(rootPath: string, entries: ContextSourceInventoryEntry[]): ContextSourceGroupCandidate[] {
  const paths = new Set<string>([rootPath])
  for (const entry of entries) {
    for (const ancestor of ancestorDirectories(entry.path, rootPath)) {
      paths.add(ancestor)
    }
  }
  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => candidateForPath(path, entries.filter((entry) => pathWithin(entry.path, path))))
    .filter((candidate) => candidate.fileCount > 0)
}

function candidateForPath(path: string, entries: ContextSourceInventoryEntry[]): ContextSourceGroupCandidate {
  const markerSet = new Set<string>()
  for (const marker of pathMarkers(path)) {
    markerSet.add(marker)
  }
  const extensionCounts: Record<string, number> = {}
  for (const entry of entries) {
    const name = basename(entry.path).toLowerCase()
    const extension = extname(entry.path).toLowerCase() || '[none]'
    extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1
    for (const marker of pathMarkers(entry.path)) {
      markerSet.add(marker)
    }
    if (entry.route === 'code') markerSet.add('code')
    if (entry.route === 'markdown') markerSet.add('markdown')
    if (entry.route === 'openapi') markerSet.add('openapi')
    if (entry.mediaType.startsWith('image/')) markerSet.add('asset')
    if (isDataFile(name, extension)) markerSet.add('data')
    if (isAnalysisFile(extension)) markerSet.add('analysis')
    if (isArchiveFile(extension)) markerSet.add('archive')
    if (name.includes('postman') || name.includes('insomnia')) markerSet.add('api')
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx') || name.endsWith('.spec.ts') || name.endsWith('.spec.tsx')) markerSet.add('test')
    if (name === 'package.json') markerSet.add('package.json')
    if (name === 'tsconfig.json') markerSet.add('tsconfig.json')
    if (name === 'readme.md') markerSet.add('README.md')
    if (name === 'yarn.lock' || name === 'package-lock.json' || name === 'pnpm-lock.yaml') markerSet.add('lockfile')
  }
  if (markerSet.has('package.json') || markerSet.has('tsconfig.json')) {
    markerSet.add('repository')
  }
  const suggestedKind = suggestedKindForMarkers(markerSet)
  return {
    path,
    title: basename(path) || path,
    fileCount: entries.length,
    directoryCount: new Set(entries.map((entry) => dirname(entry.path)).filter((dir) => dir !== path && pathWithin(dir, path))).size,
    extensionCounts,
    markers: [...markerSet].sort(),
    representativeFiles: entries
      .sort((left, right) => routePriority(left.route) - routePriority(right.route) || left.path.localeCompare(right.path))
      .slice(0, 8)
      .map((entry) => entry.path),
    suggestedKind,
    suggestedBoundaryMode: suggestedKind === 'repository' ? 'repository' : 'collapsed',
    confidence: markerSet.size > 0 ? 0.7 : 0.35
  }
}

function suggestedKindForMarkers(markers: Set<string>): ContextSourceGroupRecord['kind'] {
  if (markers.has('generated')) return 'generated_bundle'
  if (markers.has('vendor')) return 'vendor_bundle'
  if (markers.has('repository')) return 'repository'
  if (markers.has('test')) return 'test_bundle'
  if (markers.has('api') || markers.has('openapi')) return 'api_bundle'
  if (markers.has('design')) return 'design_bundle'
  if (markers.has('config')) return 'config_bundle'
  if (markers.has('runtime')) return 'runtime_bundle'
  if (markers.has('domain')) return 'domain_area'
  if (markers.has('data')) return 'data_bundle'
  if (markers.has('analysis')) return 'analysis_bundle'
  if (markers.has('markdown')) return 'doc_bundle'
  if (markers.has('asset')) return 'asset_bundle'
  if (markers.has('code')) return 'repository'
  if (markers.has('archive')) return 'archive'
  return 'unknown'
}

function pathMarkers(path: string): string[] {
  const segments = normalizeConfiguredPath(path).toLowerCase().split('/').filter(Boolean)
  const markers = new Set<string>()
  for (const segment of segments) {
    const normalized = segment.replace(/[_\s-]+/g, '')
    if (['api', 'apis', 'openapi', 'swagger', 'postman', 'insomnia', 'interface', 'interfaces'].includes(normalized)) markers.add('api')
    if (['asset', 'assets', 'image', 'images', 'icon', 'icons', 'media', 'static', 'public'].includes(normalized)) markers.add('asset')
    if (['analysis', 'analytics', 'report', 'reports', 'research', 'survey', 'surveys'].includes(normalized)) markers.add('analysis')
    if (['data', 'dataset', 'datasets', 'sampledata', 'fixtures', 'seed', 'seeds'].includes(normalized)) markers.add('data')
    if (['design', 'designs', 'ui', 'ux', 'figma', 'wireframe', 'wireframes', 'mockup', 'mockups'].includes(normalized)) markers.add('design')
    if (['test', 'tests', 'testing', 'testcase', 'testcases', 'case', 'cases', 'qa', 'spec', 'specs', 'e2e'].includes(normalized)) markers.add('test')
    if (['code', 'sourcecode', 'src'].includes(normalized)) markers.add('code')
    if (['config', 'configs', 'configuration', 'settings', 'deploy', 'deployment', 'ci', 'ops'].includes(normalized)) markers.add('config')
    if (['runtime', 'metrics', 'metric', 'logs', 'log', 'monitoring', 'observability', 'telemetry'].includes(normalized)) markers.add('runtime')
    if (['vendor', 'vendors', 'thirdparty', 'thirdparties', 'external', 'sdk', 'sdks'].includes(normalized)) markers.add('vendor')
    if (['generated', 'gen', 'dist', 'build', 'out', 'coverage', 'cache'].includes(normalized)) markers.add('generated')
    if (['domain', 'domains', 'business', 'biz', 'module', 'modules', 'area', 'areas'].includes(normalized)) markers.add('domain')
  }
  return [...markers]
}

function isDataFile(name: string, extension: string): boolean {
  return ['.csv', '.tsv', '.sql', '.sqlite', '.db', '.parquet', '.ndjson'].includes(extension) || name.endsWith('.jsonl')
}

function isAnalysisFile(extension: string): boolean {
  return ['.xls', '.xlsx', '.ppt', '.pptx', '.pdf'].includes(extension)
}

function isArchiveFile(extension: string): boolean {
  return ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'].includes(extension)
}

function isAutoSource(source: SourceConfig): boolean {
  return source.type === undefined || source.type === 'auto'
}

function groupForEntry(entry: ContextSourceInventoryEntry, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  return groups
    .filter((group) => pathWithin(entry.path, group.path))
    .sort((left, right) => right.path.length - left.path.length)[0]
}

function shouldPromoteSnapshot(entry: ContextSourceInventoryEntry, group: ContextSourceGroupRecord | undefined, source: SourceConfig): boolean {
  if (!isAutoSource(source)) {
    return true
  }
  if (!group) {
    return false
  }
  if (group.childrenPolicy === 'promote_all' || group.boundaryMode === 'expanded') {
    return true
  }
  if (group.childrenPolicy === 'promote_none') {
    return false
  }
  if (entry.route === 'markdown' || entry.route === 'openapi') {
    return true
  }
  return isImportantInventoryFile(entry)
}

function isImportantInventoryFile(entry: ContextSourceInventoryEntry): boolean {
  const name = basename(entry.path).toLowerCase()
  return name === 'package.json' || name === 'tsconfig.json' || name === 'readme.md'
}

function ancestorDirectories(path: string, rootPath: string): string[] {
  const result: string[] = []
  let current = normalizePath(dirname(path))
  while (pathWithin(current, rootPath)) {
    result.push(current)
    if (current === rootPath || current === '.' || current.length === 0) {
      break
    }
    current = normalizePath(dirname(current))
  }
  return result
}

function routePriority(route: ContextSourceRoute): number {
  if (route === 'markdown') return 0
  if (route === 'openapi') return 1
  if (route === 'code') return 2
  if (route === 'inventory') return 3
  return 4
}

function mergeGroupingRequests(
  left: ContextSourceGroupingRequest | undefined,
  right: ContextSourceGroupingRequest | undefined
): ContextSourceGroupingRequest | undefined {
  if (!left) return right
  if (!right) return left
  return {
    ...left,
    sources: [...left.sources, ...right.sources]
  }
}

async function listFiles(path: string, source: SourceConfig, rootDir: string): Promise<string[]> {
  const entry = await stat(path)
  if (entry.isFile()) {
    return shouldIncludeFile(path, source, rootDir) ? [path] : []
  }
  const children = await readdir(path, { withFileTypes: true })
  const nested = await Promise.all(
    children
      .filter((child) => {
        if (child.isDirectory()) {
          return !shouldSkipDirectory(child.name)
        }
        return true
      })
      .map((child) => listFiles(resolve(path, child.name), source, rootDir))
  )
  return nested.flat()
}

function shouldSkipDirectory(name: string): boolean {
  return DEFAULT_SKIPPED_DIRS.has(name)
}

function shouldIncludeFile(path: string, source: SourceConfig, rootDir: string): boolean {
  const relativePath = normalizePath(relative(rootDir, path))
  if (basename(path).startsWith('.') && source.includeDotfiles === false) {
    return false
  }
  const include = source.include?.map(globToRegExp)
  const exclude = source.exclude?.map(globToRegExp)
  return (include === undefined || include.some((pattern) => pattern.test(relativePath))) && !(exclude?.some((pattern) => pattern.test(relativePath)) ?? false)
}

function routeFile(source: SourceConfig, file: string, bytes: Buffer): FileRoute {
  if (source.mediaType) {
    return routeFromMediaType(source.mediaType)
  }
  const ext = extname(file).toLowerCase()
  const name = basename(file).toLowerCase()

  if (ext === '.md' || ext === '.mdx') return { mediaType: 'text/markdown', route: 'markdown' }
  if (ext === '.ts' || ext === '.tsx') return { mediaType: 'text/typescript', route: 'code' }
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return { mediaType: 'text/javascript', route: 'code' }
  if ((ext === '.yaml' || ext === '.yml' || ext === '.json') && looksLikeOpenApi(file, bytes)) {
    return { mediaType: 'application/openapi', route: 'openapi' }
  }
  if (ext === '.json') return { mediaType: 'application/json', route: 'inventory', unsupportedReason: 'inventory-only-media-type' }
  if (ext === '.yaml' || ext === '.yml') return { mediaType: 'application/yaml', route: 'inventory', unsupportedReason: 'inventory-only-media-type' }
  if (name.endsWith('.lock') || name === 'yarn.lock' || name === 'package-lock.json' || name === 'pnpm-lock.yaml') {
    return { mediaType: 'text/plain', route: 'inventory', unsupportedReason: 'inventory-only-media-type' }
  }
  if (ext === '.css' || ext === '.less' || ext === '.scss' || ext === '.sass') {
    return { mediaType: 'text/css', route: 'inventory', unsupportedReason: 'inventory-only-media-type' }
  }
  if (name === '.env' || name.startsWith('.env.')) {
    return { mediaType: 'text/plain', route: 'inventory', unsupportedReason: 'inventory-only-media-type' }
  }
  if (ext === '.pdf') return unsupported('application/pdf')
  if (ext === '.doc' || ext === '.docx') return unsupported('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  if (ext === '.xls' || ext === '.xlsx') return unsupported('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  if (ext === '.ppt' || ext === '.pptx') return unsupported('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  if (ext === '.zip') return unsupported('application/zip')
  if (ext === '.rar') return unsupported('application/vnd.rar')
  if (ext === '.7z') return unsupported('application/x-7z-compressed')
  if (ext === '.png') return unsupported('image/png')
  if (ext === '.jpg' || ext === '.jpeg') return unsupported('image/jpeg')
  if (ext === '.gif') return unsupported('image/gif')
  if (ext === '.svg') return { mediaType: 'image/svg+xml', route: 'inventory', unsupportedReason: 'inventory-only-media-type' }
  if (ext === '.ico') return unsupported('image/x-icon')
  return isProbablyBinary(bytes)
    ? unsupported('application/octet-stream')
    : { mediaType: 'text/plain', route: 'inventory', unsupportedReason: 'inventory-only-media-type' }
}

function routeFromMediaType(mediaType: string): FileRoute {
  if (mediaType === 'text/markdown') return { mediaType, route: 'markdown' }
  if (mediaType === 'application/openapi') return { mediaType, route: 'openapi' }
  if (mediaType === 'text/typescript' || mediaType === 'text/javascript') return { mediaType, route: 'code' }
  return { mediaType, route: 'inventory', unsupportedReason: 'inventory-only-media-type' }
}

function unsupported(mediaType: string): FileRoute {
  return { mediaType, route: 'unsupported', unsupportedReason: 'adapter-not-configured' }
}

function looksLikeOpenApi(file: string, bytes: Buffer): boolean {
  const name = basename(file).toLowerCase()
  if (name.includes('openapi') || name.includes('swagger')) {
    return true
  }
  const preview = bytes.subarray(0, 8192).toString('utf8')
  return /(^|\n)\s*openapi\s*[:"]/.test(preview) || /(^|\n)\s*swagger\s*[:"]/.test(preview) || /"openapi"\s*:/.test(preview) || /"swagger"\s*:/.test(preview)
}

function routeAllowedBySourceHint(route: ContextSourceRoute, source: SourceConfig): boolean {
  const hint = source.parser ?? source.type
  if (!hint || hint === 'auto') return route === 'markdown' || route === 'code' || route === 'openapi'
  if (hint === 'markdown') return route === 'markdown'
  if (hint === 'openapi') return route === 'openapi'
  if (hint === 'code' || hint === 'git') return route === 'code'
  return route === 'markdown' || route === 'code' || route === 'openapi'
}

function buildInventory(
  entries: ContextSourceInventoryEntry[],
  rootCount: number,
  groups: ContextSourceGroupRecord[] = [],
  packages: ContextPackageRecord[] = [],
  groupingRequest?: ContextSourceGroupingRequest
): ContextSourceInventory {
  return {
    schemaVersion: 'context-source-inventory.v1',
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
    packages: packages.length > 0 ? packages.sort((left, right) => left.path.localeCompare(right.path)) : undefined,
    groups: groups.length > 0 ? groups.sort((left, right) => left.path.localeCompare(right.path)) : undefined,
    groupingRequest,
    summary: {
      roots: rootCount,
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

function isProbablyBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, Math.min(bytes.length, 512)).includes(0)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

function normalizeConfiguredPath(value: string): string {
  const normalized = normalizePath(value).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalized.length > 0 ? normalized : '.'
}

function globToRegExp(value: string): RegExp {
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}
