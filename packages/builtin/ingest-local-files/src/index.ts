import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  createContextEdge,
  createContextNode,
  defineComponent,
  scopeDirName,
  scopeIdForPackage,
  scopeIdForSourceGroup,
  slug,
  type ContextPackageKind,
  type ContextGraphAdapterRef,
  type ContextPackageRecord,
  type ContextComponent,
  type ContextEdge,
  type ContextNode,
  type ContextSourceCorrectionDecision,
  type ContextSourceGroupCandidate,
  type ContextSourceGroupingDecision,
  type ContextSourceGroupingDecisions,
  type ContextSourceGroupingRequest,
  type ContextSourceGroupRecord,
  type ContextSourceInventory,
  type ContextSourceInventoryEntry,
  type ContextSourceRoute,
  type RawArtifact,
  type SourceConfig,
  type SourceRef
} from '@context-compiler/core'

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
  const rootSourceRef = sourceRefFor(source.name, rootDir, sourcePath, source.path)
  const rootNodeId = `SOURCE-${slug(source.name)}`
  const nodes: ContextNode[] = [
    createContextNode({
      id: rootNodeId,
      type: 'Source',
      name: source.name,
      sourceRefs: [rootSourceRef],
      properties: {
        path: source.path,
        type: source.type ?? 'auto',
        parser: source.parser,
        mediaType: source.mediaType
      }
    })
  ]
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
  nodes.push(...packages.map((record) => l0PackageNode(record)))
  nodes.push(...grouping.groups.map((group) => sourceGroupNode(group)))
  for (const record of packages) {
    const packageScopeId = scopeIdForPackage(record.id)
    edges.push(
      createContextEdge({
        id: `EDGE-${rootNodeId}-contains-package-${record.id}`,
        from: rootNodeId,
        to: record.id,
        type: 'contains_package',
        linker: 'ingest.local-files',
        status: 'confirmed',
        evidence: []
      })
    )
    edges.push(
      createContextEdge({
        id: `EDGE-${record.id}-materializes-subgraph-${slug(packageScopeId)}`,
        from: record.id,
        to: record.id,
        type: 'materializes_subgraph',
        linker: 'ingest.local-files',
        status: 'confirmed',
        evidence: [],
        properties: {
          scopeId: packageScopeId,
          subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`
        }
      })
    )
    for (const groupId of record.sourceGroupIds) {
      edges.push(
        createContextEdge({
          id: `EDGE-${record.id}-contains-source-group-${groupId}`,
          from: record.id,
          to: groupId,
          type: 'contains_source_group',
          linker: 'ingest.local-files',
          status: 'confirmed',
          evidence: []
        })
      )
    }
  }
  for (const group of grouping.groups) {
    const scopeId = scopeIdForSourceGroup(group.id)
    edges.push(
      createContextEdge({
        id: `EDGE-${group.id}-materializes-subgraph-${slug(scopeId)}`,
        from: group.id,
        to: group.id,
        type: 'materializes_subgraph',
        linker: 'ingest.local-files',
        status: 'confirmed',
        evidence: [],
        properties: {
          scopeId,
          subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`
        }
      })
    )
  }
  for (const group of grouping.groups) {
    const parent = parentGroupFor(group, grouping.groups)
    if (!parent) {
      continue
    }
    edges.push(
      createContextEdge({
        id: `EDGE-${parent.id}-has-child-scope-${group.id}`,
        from: parent.id,
        to: group.id,
        type: 'has_child_scope',
        linker: 'ingest.local-files',
        status: 'confirmed',
        evidence: [],
        properties: {
          parentScopeId: scopeIdForSourceGroup(parent.id),
          childScopeId: scopeIdForSourceGroup(group.id)
        }
      })
    )
  }

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
          id: `EDGE-${group?.id ?? rootNodeId}-contains-snapshot-${snapshotNodeId}`,
          from: group?.id ?? rootNodeId,
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

function buildL0Packages(sourceName: string, groups: ContextSourceGroupRecord[]): ContextPackageRecord[] {
  const topLevelGroups = groups.filter((group) => !parentGroupFor(group, groups))
  return topLevelGroups.map((group) => {
    const kind = packageKindForSourceGroupKind(group.kind)
    const sourceGroupIds = groups.filter((candidate) => pathWithin(candidate.path, group.path)).map((candidate) => candidate.id).sort()
    const buildUnitKind = buildUnitKindForSourceGroupKind(group.kind)
    const standardKind = standardBuildUnitKindForSourceGroupKind(group.kind)
    const adapterSelection = adapterSelectionForSourceGroupKind(group.kind)
    return {
      id: packageIdForGroup(group),
      sourceName,
      path: group.path,
      title: `${packageKindLabel(kind)}: ${group.title}`,
      kind,
      summary: group.summary,
      sourceGroupIds,
      buildUnits: [
        {
          id: `unit:${slug(`${sourceName}:${group.path}:${buildUnitKind}`)}`,
          kind: buildUnitKind,
          standardKind,
          title: group.title,
          sourceGroupIds,
          adapterId: adapterSelection.adapterId,
          adapterSelection,
          path: group.path,
          summary: group.summary
        }
      ],
      confidence: group.confidence,
      decisionSource: group.decisionSource,
      sourceRef: group.sourceRef,
      metadata: {
        sourceGroupKind: group.kind,
        boundaryMode: group.boundaryMode,
        correctionDecisionIds: Array.isArray(group.metadata?.correctionDecisionIds) ? group.metadata.correctionDecisionIds : undefined
      }
    }
  })
}

function l0PackageNode(record: ContextPackageRecord): ContextNode {
  const packageScopeId = scopeIdForPackage(record.id)
  return createContextNode({
    id: record.id,
    type: 'Package',
    name: record.title,
    status: 'hypothesis',
    scopeId: 'scope:project',
    subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`,
    sourceRefs: [record.sourceRef],
    confidence: record.confidence,
    properties: {
      packageKind: record.kind,
      path: record.path,
      summary: record.summary,
      sourceGroupIds: record.sourceGroupIds,
      buildUnits: record.buildUnits,
      confidence: record.confidence,
      decisionSource: record.decisionSource,
      sourceName: record.sourceName,
      scopeId: packageScopeId,
      subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`
    }
  })
}

function sourceGroupNode(group: ContextSourceGroupRecord): ContextNode {
  const scopeId = scopeIdForSourceGroup(group.id)
  return createContextNode({
    id: group.id,
    type: 'SourceGroup',
    name: group.title,
    status: 'hypothesis',
    scopeId: 'scope:project',
    subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`,
    sourceRefs: [group.sourceRef],
    confidence: group.confidence,
    properties: {
      kind: group.kind,
      path: group.path,
      boundaryMode: group.boundaryMode,
      summary: group.summary,
      childrenPolicy: group.childrenPolicy,
      confidence: group.confidence,
      decisionSource: group.decisionSource,
      sourceName: group.sourceName,
      scopeId,
      subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`
    }
  })
}

function packageIdForGroup(group: ContextSourceGroupRecord): string {
  return `PACKAGE-${slug(`${group.sourceName}-${group.path}`)}`
}

function packageKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageKind {
  switch (kind) {
    case 'repository':
    case 'test_bundle':
      return 'code_repository'
    case 'doc_bundle':
    case 'domain_area':
    case 'api_bundle':
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

function packageKindLabel(kind: ContextPackageKind): string {
  switch (kind) {
    case 'product_docs':
      return '产品资料包'
    case 'code_repository':
      return '代码仓库包'
    case 'analysis':
      return '分析资料包'
    case 'design':
      return '设计资料包'
    case 'data':
      return '数据资料包'
    case 'runtime':
      return '运行时资料包'
    case 'asset':
      return '资产包'
    default:
      return '未知包'
  }
}

function buildUnitKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageRecord['buildUnits'][number]['kind'] {
  if (kind === 'repository' || kind === 'test_bundle') return 'repository'
  if (kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area') return 'graphrag_corpus'
  if (kind === 'api_bundle') return 'api_contracts'
  return 'inventory'
}

function standardBuildUnitKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageRecord['buildUnits'][number]['standardKind'] {
  if (kind === 'repository' || kind === 'test_bundle') return 'repository'
  if (kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area') return 'semantic_corpus'
  if (kind === 'api_bundle') return 'api_contracts'
  return 'inventory'
}

function adapterSelectionForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextGraphAdapterRef {
  switch (kind) {
    case 'repository':
    case 'test_bundle':
      return selectedAdapter('codegraph.graph-adapter', 'code-graph-builder', `Default code graph adapter for ${kind} source groups.`, [
        'tree-sitter',
        'codegraph.graph-adapter'
      ])
    case 'doc_bundle':
    case 'analysis_bundle':
    case 'domain_area':
      return selectedAdapter('microsoft-graphrag.graph-adapter', 'semantic-graph-builder', `Default semantic corpus adapter for ${kind} source groups.`, [
        'microsoft-graphrag.graph-adapter',
        'builtin.markdown-text'
      ])
    case 'api_bundle':
      return selectedAdapter('builtin.openapi', 'semantic-graph-builder', 'Default API contract adapter for api_bundle source groups.', [
        'builtin.openapi'
      ])
    default:
      return selectedAdapter('builtin.source-inventory', 'inventory', `Default inventory-only adapter for ${kind} source groups.`, [
        'builtin.source-inventory'
      ])
  }
}

function selectedAdapter(
  adapterId: string,
  role: ContextGraphAdapterRef['role'],
  selectionReason: string,
  candidateAdapterIds: string[]
): ContextGraphAdapterRef {
  return {
    adapterId,
    role,
    selectionSource: 'default',
    selectionReason,
    priority: 0,
    candidateAdapterIds
  }
}

async function resolveSourceGrouping(
  source: SourceConfig,
  rootDir: string,
  outputDir: string,
  sourcePath: string,
  entries: ContextSourceInventoryEntry[]
): Promise<{ groups: ContextSourceGroupRecord[]; request?: ContextSourceGroupingRequest }> {
  if (!isAutoSource(source)) {
    return { groups: [] }
  }
  const sourceRootPath = normalizePath(relative(rootDir, sourcePath))
  const correctionDecisions = await readSourceCorrectionDecisions(outputDir)
  const applyCorrections = (groups: ContextSourceGroupRecord[]) => applySourceCorrectionDecisions(groups, correctionDecisions, sourceRootPath, source, rootDir)
  const decisions = await readGroupingDecisions(outputDir)
  const sourceDecisions = decisions?.decisions.filter((decision) => pathWithin(decisionPath(decision), sourceRootPath)) ?? []
  if (sourceDecisions.length === 0) {
    const request = buildGroupingRequest(source, sourceRootPath, entries)
    await writeGroupingRequest(outputDir, request)
    const agentDecisions = await resolveGroupingDecisionsWithAgent(source, rootDir, outputDir, sourceRootPath, request)
    if (agentDecisions.length > 0) {
      return {
        groups: applyCorrections(agentDecisions.map((decision) => groupingDecisionToRecord(source, rootDir, decision, 'agent'))),
        request
      }
    }
    const waitedDecisions = await waitForGroupingDecisions(outputDir, sourceRootPath, groupingWaitMs(source))
    if (waitedDecisions.length > 0) {
      return {
        groups: applyCorrections(waitedDecisions.map((decision) => groupingDecisionToRecord(source, rootDir, decision, 'agent'))),
        request
      }
    }
    const fallback = buildInferredUnknownGroupingDecision(sourceRootPath)
    await writeGroupingDecisions(outputDir, {
      schemaVersion: 'context-source-grouping-decisions.v1',
      generatedAt: new Date().toISOString(),
      agent: 'inferred',
      decisions: [fallback]
    })
    return {
      groups: applyCorrections([groupingDecisionToRecord(source, rootDir, fallback, 'inferred')]),
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
      return groupingDecisionToRecord(source, rootDir, decision, decisionSource)
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

function buildInferredUnknownGroupingDecision(sourceRootPath: string): ContextSourceGroupingDecision {
  return {
    path: sourceRootPath,
    kind: 'unknown',
    boundaryMode: 'collapsed',
    title: '未知资料包',
    summary: 'Source materials could not be confidently classified, so they are preserved as an inventory-only unknown package.',
    childrenPolicy: 'promote_routed',
    confidence: 0.35
  }
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
  await mkdir(join(outputDir, 'sources'), { recursive: true })
  await writeFile(join(outputDir, 'sources', 'grouping-decisions.json'), `${JSON.stringify(merged, null, 2)}\n`)
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
  await mkdir(join(outputDir, 'sources'), { recursive: true })
  await writeFile(join(outputDir, 'sources', 'grouping-agent-status.json'), `${JSON.stringify(status, null, 2)}\n`)
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
    return JSON.parse(await readFile(join(outputDir, 'sources', 'grouping-decisions.json'), 'utf8')) as ContextSourceGroupingDecisions
  } catch {
    return undefined
  }
}

async function readSourceCorrectionDecisions(outputDir: string): Promise<ContextSourceCorrectionDecision[]> {
  try {
    return (await readFile(join(outputDir, 'sources', 'correction-decisions.jsonl'), 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ContextSourceCorrectionDecision)
      .filter((decision) => decision.schemaVersion === 'context-source-correction-decision.v1' && decision.status === 'applied')
  } catch {
    return []
  }
}

function applySourceCorrectionDecisions(
  groups: ContextSourceGroupRecord[],
  decisions: ContextSourceCorrectionDecision[],
  sourceRootPath: string,
  source: SourceConfig,
  rootDir: string
): ContextSourceGroupRecord[] {
  if (decisions.length === 0) {
    return groups
  }
  const applicable = decisions.filter((decision) => sourceCorrectionWithinRoot(decision, sourceRootPath))
  if (applicable.length === 0) {
    return groups
  }
  const byId = new Map(groups.map((group) => [group.id, group]))
  const next = groups.map((group) => {
    let current = group
    const groupDecisions = applicable.filter((decision) => correctionAppliesToGroup(decision, current))
    for (const decision of groupDecisions) {
      current = applySourceCorrectionDecisionToGroup(current, decision)
    }
    byId.set(current.id, current)
    return current
  })

  for (const decision of applicable.filter((candidate) => candidate.kind === 'split')) {
    const targetId = decision.sourceGroupId
    const after = decision.after
    const path = stringRecordValue(after, 'path') ?? decision.sourcePath
    if (!targetId || !path || byId.has(targetId)) {
      continue
    }
    const kind = correctedSourceGroupKind(stringRecordValue(after, 'kind'), 'unknown')
    const group: ContextSourceGroupRecord = {
      id: targetId,
      sourceName: source.name,
      path,
      title: stringRecordValue(after, 'title') ?? basename(path),
      kind,
      boundaryMode: correctedBoundaryMode(stringRecordValue(after, 'boundaryMode'), kind === 'repository' ? 'repository' : 'collapsed'),
      summary: stringRecordValue(after, 'summary') ?? `Source group created by correction ${decision.id}.`,
      confidence: numberRecordValue(after, 'confidence') ?? 0.7,
      decisionSource: 'agent',
      sourceRef: sourceRefFor(source.name, rootDir, resolve(rootDir, path), path),
      metadata: { correctionDecisionIds: [decision.id] }
    }
    byId.set(group.id, group)
    next.push(group)
  }
  return next.sort((left, right) => left.path.localeCompare(right.path))
}

function applySourceCorrectionDecisionToGroup(
  group: ContextSourceGroupRecord,
  decision: ContextSourceCorrectionDecision
): ContextSourceGroupRecord {
  const decisionIds = [...new Set([...(Array.isArray(group.metadata?.correctionDecisionIds) ? group.metadata.correctionDecisionIds.filter((id): id is string => typeof id === 'string') : []), decision.id])]
  const metadata = { ...(group.metadata ?? {}), correctionDecisionIds: decisionIds }
  if (decision.kind === 'relabel') {
    return {
      ...group,
      title: stringRecordValue(decision.after, 'title') ?? group.title,
      kind: correctedSourceGroupKind(stringRecordValue(decision.after, 'kind'), group.kind),
      boundaryMode: correctedBoundaryMode(stringRecordValue(decision.after, 'boundaryMode'), group.boundaryMode),
      summary: stringRecordValue(decision.after, 'summary') ?? group.summary,
      confidence: numberRecordValue(decision.after, 'confidence') ?? group.confidence,
      metadata
    }
  }
  if (decision.kind === 'merge') {
    return {
      ...group,
      metadata: {
        ...metadata,
        mergedIntoGroupId: decision.targetGroupId ?? stringRecordValue(decision.after, 'mergedInto')
      }
    }
  }
  if (decision.kind === 'rehome') {
    const overrides = Array.isArray(group.metadata?.sourcePathOverrides) ? group.metadata.sourcePathOverrides : []
    return {
      ...group,
      metadata: {
        ...metadata,
        sourcePathOverrides: [
          ...overrides,
          {
            sourcePath: decision.sourcePath,
            targetPath: decision.targetPath,
            targetGroupId: decision.targetGroupId
          }
        ]
      }
    }
  }
  return { ...group, metadata }
}

function sourceCorrectionWithinRoot(decision: ContextSourceCorrectionDecision, sourceRootPath: string): boolean {
  return [decision.sourcePath, decision.targetPath, stringRecordValue(decision.before, 'path'), stringRecordValue(decision.after, 'path')]
    .filter((path): path is string => typeof path === 'string')
    .some((path) => pathWithin(path, sourceRootPath))
}

function correctionAppliesToGroup(decision: ContextSourceCorrectionDecision, group: ContextSourceGroupRecord): boolean {
  return decision.sourceGroupId === group.id ||
    (decision.sourcePath !== undefined && pathWithin(decision.sourcePath, group.path)) ||
    (stringRecordValue(decision.before, 'path') !== undefined && stringRecordValue(decision.before, 'path') === group.path)
}

function stringRecordValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function numberRecordValue(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' ? value : undefined
}

function correctedSourceGroupKind(value: string | undefined, fallback: ContextSourceGroupRecord['kind']): ContextSourceGroupRecord['kind'] {
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
  return allowed.has(value as ContextSourceGroupRecord['kind']) ? value as ContextSourceGroupRecord['kind'] : fallback
}

function correctedBoundaryMode(value: string | undefined, fallback: ContextSourceGroupRecord['boundaryMode']): ContextSourceGroupRecord['boundaryMode'] {
  if (value === 'expanded' || value === 'collapsed' || value === 'repository') {
    return value
  }
  return fallback
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
  await mkdir(join(outputDir, 'sources'), { recursive: true })
  await writeFile(join(outputDir, 'sources', 'grouping-request.json'), `${JSON.stringify(request, null, 2)}\n`)
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
  if (markers.has('domain')) return 'domain_area'
  if (markers.has('runtime')) return 'runtime_bundle'
  if (markers.has('config')) return 'config_bundle'
  if (markers.has('test')) return 'test_bundle'
  if (markers.has('design')) return 'design_bundle'
  if (markers.has('api') || markers.has('openapi')) return 'api_bundle'
  if (markers.has('data')) return 'data_bundle'
  if (markers.has('analysis')) return 'analysis_bundle'
  if (markers.has('markdown')) return 'doc_bundle'
  if (markers.has('asset')) return 'asset_bundle'
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
    if (['test', 'tests', 'testing', 'qa', 'spec', 'specs', 'e2e'].includes(normalized)) markers.add('test')
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

function groupingDecisionToRecord(
  source: SourceConfig,
  rootDir: string,
  decision: ContextSourceGroupingDecision,
  decisionSource: ContextSourceGroupRecord['decisionSource'] = 'agent'
): ContextSourceGroupRecord {
  const path = decisionPath(decision)
  return {
    id: `SOURCE-GROUP-${slug(`${source.name}-${path}`)}`,
    sourceName: source.name,
    path,
    title: decision.title,
    kind: decision.kind,
    boundaryMode: decision.boundaryMode,
    summary: decision.summary,
    childrenPolicy: decision.childrenPolicy,
    confidence: decision.confidence,
    decisionSource,
    sourceRef: sourceRefFor(source.name, rootDir, resolve(rootDir, path), path)
  }
}

function decisionPath(decision: Pick<ContextSourceGroupingDecision, 'path'>): string {
  return normalizeConfiguredPath(decision.path)
}

function isAutoSource(source: SourceConfig): boolean {
  return source.type === undefined || source.type === 'auto'
}

function groupForEntry(entry: ContextSourceInventoryEntry, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  return groups
    .filter((group) => pathWithin(entry.path, group.path))
    .sort((left, right) => right.path.length - left.path.length)[0]
}

function parentGroupFor(group: ContextSourceGroupRecord, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  return groups
    .filter((candidate) => candidate.id !== group.id && pathWithin(group.path, candidate.path))
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

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizeConfiguredPath(path)
  const normalizedRoot = normalizeConfiguredPath(rootPath)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
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

function sourceRefFor(sourceName: string, rootDir: string, file: string, path: string): SourceRef {
  const relativePath = normalizePath(relative(rootDir, file))
  return {
    sourceId: `${sourceName}:${slug(relativePath)}`,
    uri: `file://${relativePath}`,
    title: sourceName,
    location: { path }
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
