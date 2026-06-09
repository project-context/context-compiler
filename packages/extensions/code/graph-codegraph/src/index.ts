import { execFile } from 'node:child_process'
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { defineContextExtension, resolveAdapterExtensionPaths } from '@context-compiler/core/extensions'
import { createContextEdge, createContextNode, type ContextEdge, type ContextGraphIndexHint, type ContextNode, type Evidence, type GraphAdapter, type GraphAdapterArtifact, type GraphAdapterManifest, type GraphBuildInput, type GraphBuildResult, type RawArtifact } from '@context-compiler/core/sdk'

const execFileAsync = promisify(execFile)
const requireFromHere = createRequire(import.meta.url)
type SourceRef = RawArtifact['source']

export interface EmbeddedCodeGraphSearchResult {
  node: EmbeddedCodeGraphNode
  edge?: EmbeddedCodeGraphEdge
}

export interface EmbeddedCodeGraphNode {
  id: string
  name?: string
  kind?: string
  type?: string
  file?: string
  path?: string
  filePath?: string
  qualifiedName?: string
  language?: string
  startLine?: number
  endLine?: number
  startColumn?: number
  endColumn?: number
  signature?: string
  text?: string
  route?: string
  docstring?: string
  isExported?: boolean
  isAsync?: boolean
  metadata?: Record<string, unknown>
}

export interface EmbeddedCodeGraphEdge {
  from?: string
  to?: string
  source?: string
  target?: string
  kind?: string
  type?: string
  provenance?: string
  line?: number
  column?: number
  metadata?: Record<string, unknown>
}

export interface EmbeddedCodeGraphSubgraph {
  nodes?: Map<string, EmbeddedCodeGraphNode> | Record<string, EmbeddedCodeGraphNode> | EmbeddedCodeGraphNode[]
  edges?: EmbeddedCodeGraphEdge[]
}

export interface EmbeddedCodeGraphInstance {
  indexAll(options?: { onProgress?: (progress: unknown) => void }): Promise<unknown> | unknown
  sync?(): Promise<unknown> | unknown
  searchNodes(query: string): EmbeddedCodeGraphSearchResult[] | Promise<EmbeddedCodeGraphSearchResult[]>
  getCallers(id: string): EmbeddedCodeGraphSearchResult[] | Promise<EmbeddedCodeGraphSearchResult[]>
  getCallees(id: string): EmbeddedCodeGraphSearchResult[] | Promise<EmbeddedCodeGraphSearchResult[]>
  getImpactRadius(id: string, depth: number): EmbeddedCodeGraphSearchResult[] | EmbeddedCodeGraphSubgraph | Promise<EmbeddedCodeGraphSearchResult[] | EmbeddedCodeGraphSubgraph>
  buildContext(task: string, options: Record<string, unknown>): Promise<unknown> | unknown
  close?(): void | Promise<void>
}

export interface EmbeddedCodeGraphApi {
  init(path: string): Promise<EmbeddedCodeGraphInstance> | EmbeddedCodeGraphInstance
  open?(path: string): Promise<EmbeddedCodeGraphInstance> | EmbeddedCodeGraphInstance
}

export interface CodeGraphAdapterOptions {
  codeGraphApi?: EmbeddedCodeGraphApi
}

export const codeGraphAdapterManifest: GraphAdapterManifest = {
  id: 'codegraph.graph-adapter',
  title: 'CodeGraph graph adapter',
  version: '0.1.0',
  scopeKinds: ['source_group', 'file', 'content'],
  sourceGroupKinds: ['repository'],
  inputs: ['RawArtifact:code'],
  outputs: ['CodeSymbol', 'Module', 'Route', 'File', 'ContextEdge', 'ContextGraphIndexHint', 'GraphAdapterArtifact'],
  deterministic: true,
  requiresNetwork: false,
  stability: 'development',
  externalProjects: ['CodeGraph', 'Tree-sitter', 'SCIP'],
  runtime: {
    mode: 'dependency',
    ecosystem: 'node',
    packageName: '@colbymchenry/codegraph'
  },
  metadata: { backend: 'colbymchenry-codegraph-api' }
}

export const codeGraphExtension = defineContextExtension({
  schemaVersion: 'context-extension.v1',
  id: 'extension.graph-codegraph',
  title: 'CodeGraph graph extension',
  version: '0.1.0',
  category: 'code',
  stability: 'development',
  adapters: [{ kind: 'graph-adapter', manifest: codeGraphAdapterManifest }],
  externalProjects: ['CodeGraph', 'Tree-sitter', 'SCIP'],
  metadata: { backend: 'colbymchenry-codegraph-api' }
})

interface StagedCodebase {
  stagingDir: string
  pathMap: Map<string, SourceRef>
  sourceRefByOriginalPath: Map<string, SourceRef>
  requestCallsBySymbol: Map<string, RequestCall[]>
  symbolQueries: string[]
}

interface RequestCall {
  path: string
  method?: string
  prefix?: string
}

interface CodeGraphExtraction {
  nodes: ContextNode[]
  edges: ContextEdge[]
  indexHints: ContextGraphIndexHint[]
  runtimeMetadata?: Record<string, unknown>
}

interface ManagedCodeGraphWorkerOutput {
  nodes: EmbeddedCodeGraphNode[]
  edges: EmbeddedCodeGraphEdge[]
  context?: unknown
  stats?: unknown
  runtimeMetadata?: Record<string, unknown>
}

export function createCodeGraphAdapter(options: CodeGraphAdapterOptions = {}): GraphAdapter {
  return {
    manifest: codeGraphAdapterManifest,
    async build(input: GraphBuildInput): Promise<GraphBuildResult> {
      const codeArtifacts = (input.rawArtifacts ?? []).filter(isCodeArtifact)
      if (codeArtifacts.length === 0) {
        return { nodes: [], edges: [], diagnostics: [] }
      }
      try {
        const artifactDir = input.artifactDir ?? `.context/extensions/${codeGraphAdapterManifest.id}/artifacts/${safeSegment(input.scope.id)}`
        const absoluteArtifactDir = resolveContextArtifactDir(input, artifactDir)
        const absoluteDataDir = resolveContextDataDir(input)
        const staged = await stageCodebase(input, codeArtifacts, absoluteDataDir)
        const { extraction, context } = await runCodeGraphBuild(options, staged, input.scope.id, absoluteArtifactDir)
        const artifacts = await writeCodeGraphArtifacts(artifactDir, absoluteArtifactDir, input.scope.id, staged, extraction, context)
        return {
          nodes: dedupeNodes(extraction.nodes),
          edges: dedupeEdges(extraction.edges),
          indexHints: extraction.indexHints,
          artifacts
        }
      } catch (error) {
        return {
          nodes: [],
          edges: [],
          diagnostics: [codeGraphDiagnostic('codegraph.adapter.failed', `CodeGraph adapter failed: ${error instanceof Error ? error.message : String(error)}`, input.scope.id)]
        }
      }
    }
  }
}

async function runCodeGraphBuild(
  options: CodeGraphAdapterOptions,
  staged: StagedCodebase,
  scopeId: string,
  absoluteArtifactDir: string
): Promise<{ extraction: CodeGraphExtraction; context: unknown }> {
  if (!options.codeGraphApi && !canUseEmbeddedCodeGraphInCurrentProcess()) {
    const workerOutput = await runManagedCodeGraphWorker(staged, absoluteArtifactDir)
    return {
      extraction: extractFromWorkerOutput(workerOutput, staged, scopeId),
      context: workerOutput.context
    }
  }
  const api = options.codeGraphApi ?? await loadCodeGraphApi()
  try {
    const codeGraph = await api.init(staged.stagingDir)
    await codeGraph.indexAll({ onProgress: () => undefined })
    const extraction = await extractFromCodeGraph(codeGraph, staged, scopeId)
    const context = await codeGraph.buildContext(`Context compiler graph build for ${staged.symbolQueries.slice(0, 12).join(', ')}`, {
      maxNodes: 50,
      includeCode: false,
      format: 'json'
    })
    await codeGraph.close?.()
    return { extraction, context }
  } catch (error) {
    if (!options.codeGraphApi && isMissingNodeSqliteError(error)) {
      const workerOutput = await runManagedCodeGraphWorker(staged, absoluteArtifactDir)
      return {
        extraction: extractFromWorkerOutput(workerOutput, staged, scopeId),
        context: workerOutput.context
      }
    }
    throw error
  }
}

function canUseEmbeddedCodeGraphInCurrentProcess(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split('.').map((part) => Number.parseInt(part, 10))
  return major > 22 || (major === 22 && minor >= 5)
}

function isMissingNodeSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('node:sqlite') || message.includes('No such built-in module')
}

async function loadCodeGraphApi(): Promise<EmbeddedCodeGraphApi> {
  const mod = await import('@colbymchenry/codegraph')
  const candidates = collectCodeGraphApiCandidates(mod)
  const api = candidates.find(hasInit)
  if (!api) {
    throw new Error('The @colbymchenry/codegraph module did not expose CodeGraph.init.')
  }
  return api
}

function collectCodeGraphApiCandidates(value: unknown, seen = new Set<unknown>()): unknown[] {
  if (!value || seen.has(value)) {
    return []
  }
  seen.add(value)
  if (typeof value !== 'object' && typeof value !== 'function') {
    return []
  }
  const exports = value as { default?: unknown; CodeGraph?: unknown }
  return [
    value,
    ...collectCodeGraphApiCandidates(exports.CodeGraph, seen),
    ...collectCodeGraphApiCandidates(exports.default, seen)
  ]
}

function hasInit(value: unknown): value is EmbeddedCodeGraphApi {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { init?: unknown }).init === 'function')
}

async function stageCodebase(input: GraphBuildInput, artifacts: RawArtifact[], absoluteDataDir: string): Promise<StagedCodebase> {
  const stagingDir = join(absoluteDataDir, 'staging')
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })
  const scopePath = normalizePath(input.scope.path ?? commonScopePath(artifacts))
  const pathMap = new Map<string, SourceRef>()
  const sourceRefByOriginalPath = new Map<string, SourceRef>()
  const requestCallsBySymbol = new Map<string, RequestCall[]>()
  const symbolQueries = new Set<string>()
  for (const artifact of artifacts) {
    const originalPath = normalizePath(artifact.source.location?.path ?? artifact.source.uri.replace(/^file:\/\//, ''))
    const stagedRelativePath = stripScopePath(originalPath, scopePath)
    const stagedPath = join(stagingDir, stagedRelativePath)
    await mkdir(dirname(stagedPath), { recursive: true })
    await writeFile(stagedPath, artifact.content)
    pathMap.set(normalizePath(stagedRelativePath), artifact.source)
    pathMap.set(normalizePath(stagedPath), artifact.source)
    sourceRefByOriginalPath.set(originalPath, artifact.source)
    for (const query of extractSymbolQueries(artifact.content)) {
      symbolQueries.add(query)
    }
    for (const [symbol, calls] of extractRequestCallsBySymbol(artifact.content)) {
      requestCallsBySymbol.set(symbol, calls)
    }
  }
  return { stagingDir, pathMap, sourceRefByOriginalPath, requestCallsBySymbol, symbolQueries: [...symbolQueries].sort() }
}

async function extractFromCodeGraph(codeGraph: EmbeddedCodeGraphInstance, staged: StagedCodebase, scopeId: string): Promise<{
  nodes: ContextNode[]
  edges: ContextEdge[]
  indexHints: ContextGraphIndexHint[]
}> {
  const nodes: ContextNode[] = []
  const edges: ContextEdge[] = []
  const indexHints: ContextGraphIndexHint[] = []
  const seenCodeGraphIds = new Set<string>()
  for (const query of staged.symbolQueries) {
    const matches = normalizeRelationResults(await Promise.resolve(codeGraph.searchNodes(query)))
    for (const match of matches) {
      const sourceNode = match.node
      if (seenCodeGraphIds.has(sourceNode.id)) {
        continue
      }
      seenCodeGraphIds.add(sourceNode.id)
      const canonicalNode = codeGraphNodeToContextNode(sourceNode, staged, scopeId)
      nodes.push(canonicalNode)
      indexHints.push({
        nodeId: canonicalNode.id,
        scopeId,
        index: 'fts',
        text: [canonicalNode.id, canonicalNode.name, canonicalNode.type, canonicalNode.properties.signature, canonicalNode.properties.kind].filter(Boolean).join('\n'),
        metadata: { adapterId: codeGraphAdapterManifest.id, backend: 'colbymchenry-codegraph-api' }
      })
      const relationResults = [
        ...normalizeRelationResults(await Promise.resolve(codeGraph.getCallers(sourceNode.id))),
        ...normalizeRelationResults(await Promise.resolve(codeGraph.getCallees(sourceNode.id))),
        ...normalizeRelationResults(await Promise.resolve(codeGraph.getImpactRadius(sourceNode.id, 2)))
      ]
      for (const related of relationResults) {
        const relatedNode = codeGraphNodeToContextNode(related.node, staged, scopeId)
        nodes.push(relatedNode)
        edges.push(codeGraphEdgeToContextEdge(sourceNode, related.node, related.edge, staged, scopeId))
      }
    }
  }
  return { nodes, edges, indexHints }
}

async function runManagedCodeGraphWorker(staged: StagedCodebase, absoluteArtifactDir: string): Promise<ManagedCodeGraphWorkerOutput> {
  const runtime = resolveManagedCodeGraphRuntime()
  const workerPath = join(absoluteArtifactDir, 'codegraph-worker.cjs')
  const inputPath = join(absoluteArtifactDir, 'codegraph-worker-input.json')
  const outputPath = join(absoluteArtifactDir, 'codegraph-worker-output.json')
  await mkdir(absoluteArtifactDir, { recursive: true })
  await writeFile(workerPath, managedCodeGraphWorkerSource())
  await writeFile(inputPath, `${JSON.stringify({
    codeGraphEntry: runtime.codeGraphEntry,
    stagingDir: staged.stagingDir,
    symbolQueries: staged.symbolQueries
  }, null, 2)}\n`)
  await execFileAsync(runtime.nodePath, [workerPath, inputPath, outputPath], { maxBuffer: 128 * 1024 * 1024 })
  return JSON.parse(await readFile(outputPath, 'utf8')) as ManagedCodeGraphWorkerOutput
}

function extractFromWorkerOutput(workerOutput: ManagedCodeGraphWorkerOutput, staged: StagedCodebase, scopeId: string): CodeGraphExtraction {
  const nodeByCodeGraphId = new Map(workerOutput.nodes.map((node) => [node.id, node]))
  const nodes = workerOutput.nodes.map((node) => codeGraphNodeToContextNode(node, staged, scopeId))
  const edges = workerOutput.edges
    .map((edge) => {
      const from = nodeByCodeGraphId.get(edge.source ?? edge.from ?? '')
      const to = nodeByCodeGraphId.get(edge.target ?? edge.to ?? '')
      return from && to ? codeGraphEdgeToContextEdge(from, to, edge, staged, scopeId) : undefined
    })
    .filter((edge): edge is ContextEdge => Boolean(edge))
  const indexHints = nodes.map((node) => ({
    nodeId: node.id,
    scopeId,
    index: 'fts',
    text: [node.id, node.name, node.type, node.properties.signature, node.properties.kind].filter(Boolean).join('\n'),
    metadata: { adapterId: codeGraphAdapterManifest.id, backend: 'colbymchenry-codegraph-api', runtime: 'managed-worker' }
  }))
  return { nodes, edges, indexHints, runtimeMetadata: workerOutput.runtimeMetadata }
}

function resolveManagedCodeGraphRuntime(): { nodePath: string; codeGraphEntry: string } {
  const target = `${process.platform}-${process.arch}`
  const codeGraphPackageJson = requireFromHere.resolve('@colbymchenry/codegraph/package.json')
  const requireFromCodeGraphPackage = createRequire(codeGraphPackageJson)
  const bundlePackageJson = requireFromCodeGraphPackage.resolve(`@colbymchenry/codegraph-${target}/package.json`)
  const bundleDir = dirname(bundlePackageJson)
  return {
    nodePath: join(bundleDir, 'node'),
    codeGraphEntry: join(bundleDir, 'lib', 'dist', 'index.js')
  }
}

export function managedCodeGraphWorkerSource(): string {
  return `'use strict'
const fs = require('fs/promises')
const path = require('path')

async function main() {
  const input = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
  const codegraphModule = require(input.codeGraphEntry)
  const CodeGraph = findCodeGraphApi(codegraphModule)
  const graph = await CodeGraph.init(input.stagingDir)
  try {
    await graph.indexAll({ onProgress: () => undefined })
    const nodes = new Map()
    const edges = new Map()
    function addNode(node) {
      if (node && node.id) nodes.set(node.id, node)
    }
    function edgeKey(edge) {
      return [edge.source || edge.from || '', edge.kind || edge.type || 'references', edge.target || edge.to || '', edge.line || ''].join('|')
    }
    function addEdge(edge) {
      if (edge && (edge.source || edge.from) && (edge.target || edge.to)) edges.set(edgeKey(edge), edge)
    }
    function addNodeEdgePair(pair) {
      if (!pair) return
      addNode(pair.node || pair)
      addEdge(pair.edge)
    }
    function addSubgraph(subgraph) {
      if (!subgraph) return
      if (Array.isArray(subgraph)) {
        for (const item of subgraph) addNodeEdgePair(item)
        return
      }
      const subgraphNodes = subgraph.nodes instanceof Map ? [...subgraph.nodes.values()] : Array.isArray(subgraph.nodes) ? subgraph.nodes : Object.values(subgraph.nodes || {})
      for (const node of subgraphNodes) addNode(node)
      for (const edge of subgraph.edges || []) addEdge(edge)
    }
    for (const query of input.symbolQueries || []) {
      for (const result of graph.searchNodes(query, { limit: 20 }) || []) {
        const node = result.node || result
        addNode(node)
        for (const caller of graph.getCallers(node.id, 1) || []) addNodeEdgePair(caller)
        for (const callee of graph.getCallees(node.id, 1) || []) addNodeEdgePair(callee)
        addSubgraph(graph.getImpactRadius(node.id, 2))
      }
    }
    const context = await graph.buildContext('Context compiler graph build for ' + (input.symbolQueries || []).slice(0, 12).join(', '), {
      maxNodes: 50,
      includeCode: false,
      format: 'json'
    }).catch((error) => ({ error: error && error.message ? error.message : String(error) }))
    const stats = typeof graph.getStats === 'function'
      ? await Promise.resolve().then(() => graph.getStats()).catch((error) => ({ error: error && error.message ? error.message : String(error) }))
      : undefined
    await fs.mkdir(path.dirname(process.argv[3]), { recursive: true })
    await fs.writeFile(process.argv[3], JSON.stringify({
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      context,
      stats,
      runtimeMetadata: {
        mode: 'managed-worker',
        node: process.version,
        backend: 'colbymchenry-codegraph-api'
      }
    }, null, 2))
  } finally {
    if (typeof graph.close === 'function') graph.close()
  }
}

function findCodeGraphApi(value, seen = new Set()) {
  if (!value || seen.has(value)) return undefined
  seen.add(value)
  if ((typeof value === 'object' || typeof value === 'function') && typeof value.init === 'function') return value
  if (typeof value === 'object' || typeof value === 'function') {
    return findCodeGraphApi(value.CodeGraph, seen) || findCodeGraphApi(value.default, seen)
  }
  return undefined
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
`
}

function codeGraphNodeToContextNode(node: EmbeddedCodeGraphNode, staged: StagedCodebase, scopeId: string): ContextNode {
  const name = node.name ?? node.text ?? node.qualifiedName ?? node.id
  const sourceRef = sourceRefForNode(node, staged)
  const type = nodeKindToContextType(node.kind ?? node.type)
  const requestCalls = staged.requestCallsBySymbol.get(name) ?? []
  return createContextNode({
    id: contextNodeId(node),
    type,
    name,
    scopeId,
    sourceRefs: [sourceRef],
    properties: {
      adapterId: codeGraphAdapterManifest.id,
      backend: 'colbymchenry-codegraph-api',
      codeGraphId: node.id,
      kind: node.kind ?? node.type,
      qualifiedName: node.qualifiedName,
      signature: node.signature,
      language: node.language,
      startLine: node.startLine,
      endLine: node.endLine,
      startColumn: node.startColumn,
      endColumn: node.endColumn,
      docstring: node.docstring,
      isExported: node.isExported,
      isAsync: node.isAsync,
      file: sourceRef.location?.path,
      route: node.route,
      requestCalls,
      metadata: node.metadata
    }
  })
}

function codeGraphEdgeToContextEdge(
  from: EmbeddedCodeGraphNode,
  to: EmbeddedCodeGraphNode,
  edge: EmbeddedCodeGraphEdge | undefined,
  staged: StagedCodebase,
  scopeId: string
): ContextEdge {
  const edgeType = edgeKindToContextType(edge?.kind ?? edge?.type)
  const fromId = contextNodeId(from)
  const toId = contextNodeId(to)
  return createContextEdge({
    id: `EDGE-${fromId}-${edgeType}-${toId}`,
    from: fromId,
    to: toId,
    type: edgeType,
    scopeId,
    linker: codeGraphAdapterManifest.id,
    status: edge?.provenance === 'heuristic' ? 'inferred' : 'confirmed',
    evidence: evidenceFor(`CodeGraph ${edgeType} relation from ${from.name ?? from.id} to ${to.name ?? to.id}.`, sourceRefForNode(from, staged)),
    properties: {
      adapterId: codeGraphAdapterManifest.id,
      backend: 'colbymchenry-codegraph-api',
      codeGraphFromId: from.id,
      codeGraphToId: to.id,
      codeGraphKind: edge?.kind ?? edge?.type,
      codeGraphSourceId: edge?.source ?? edge?.from,
      codeGraphTargetId: edge?.target ?? edge?.to,
      provenance: edge?.provenance,
      line: edge?.line,
      column: edge?.column,
      metadata: edge?.metadata
    }
  })
}

async function writeCodeGraphArtifacts(
  artifactDir: string,
  absoluteArtifactDir: string,
  scopeId: string,
  staged: StagedCodebase,
  extraction: CodeGraphExtraction,
  context: unknown
): Promise<GraphAdapterArtifact[]> {
  await mkdir(absoluteArtifactDir, { recursive: true })
  const summary = {
    schemaVersion: 'context-codegraph-adapter-summary.v1',
    adapterId: codeGraphAdapterManifest.id,
    backend: 'colbymchenry-codegraph-api',
    scopeId,
    stagingDir: staged.stagingDir,
    indexedQueries: staged.symbolQueries.length,
    nodes: extraction.nodes.length,
    edges: extraction.edges.length,
    indexHints: extraction.indexHints.length,
    runtime: extraction.runtimeMetadata ?? { mode: 'in-process', node: process.version, backend: 'colbymchenry-codegraph-api' }
  }
  await writeFile(join(absoluteArtifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(join(absoluteArtifactDir, 'context.json'), `${JSON.stringify(context, null, 2)}\n`)
  return [
    {
      id: `codegraph-summary-${safeSegment(scopeId)}`,
      path: `${artifactDir}/summary.json`,
      mediaType: 'application/json',
      description: 'Embedded CodeGraph adapter summary.',
      metadata: summary
    },
    {
      id: `codegraph-context-${safeSegment(scopeId)}`,
      path: `${artifactDir}/context.json`,
      mediaType: 'application/json',
      description: 'Raw CodeGraph buildContext output.',
      metadata: { adapterId: codeGraphAdapterManifest.id, backend: 'colbymchenry-codegraph-api', scopeId }
    }
  ]
}

function sourceRefForNode(node: EmbeddedCodeGraphNode, staged: StagedCodebase): SourceRef {
  const rawPath = normalizePath(node.filePath ?? node.file ?? node.path ?? '')
  return staged.pathMap.get(rawPath) ?? staged.sourceRefByOriginalPath.get(rawPath) ?? {
    sourceId: `codegraph:${safeSegment(rawPath || node.id)}`,
    uri: rawPath ? `file://${rawPath}` : `codegraph://${node.id}`,
    location: rawPath ? { path: rawPath } : undefined
  }
}

function contextNodeId(node: EmbeddedCodeGraphNode): string {
  const sourcePath = normalizePath(node.filePath ?? node.file ?? node.path ?? node.name ?? node.id)
  const fileId = fileIdFromPath(sourcePath)
  const name = node.name ?? node.text ?? node.qualifiedName ?? node.id
  const prefix = nodeKindToContextType(node.kind ?? node.type) === 'Route' ? 'ROUTE' : 'SYM'
  return `${prefix}-${fileId}-${safeSegment(name)}`
}

function normalizeRelationResults(value: EmbeddedCodeGraphSearchResult[] | EmbeddedCodeGraphSubgraph): EmbeddedCodeGraphSearchResult[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is EmbeddedCodeGraphSearchResult => Boolean(item?.node))
  }
  const nodes = nodesFromSubgraph(value.nodes)
  const edges = value.edges ?? []
  return nodes.map((node) => ({
    node,
    edge: edges.find((edge) => edge.source === node.id || edge.target === node.id || edge.from === node.id || edge.to === node.id)
  }))
}

function nodesFromSubgraph(value: EmbeddedCodeGraphSubgraph['nodes']): EmbeddedCodeGraphNode[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value
  }
  if (value instanceof Map) {
    return [...value.values()]
  }
  return Object.values(value)
}

function nodeKindToContextType(kind: string | undefined): string {
  switch (kind) {
    case 'file':
      return 'File'
    case 'module':
    case 'import':
    case 'export':
      return 'Module'
    case 'route':
      return 'Route'
    default:
      return 'CodeSymbol'
  }
}

function edgeKindToContextType(kind: string | undefined): string {
  switch (kind) {
    case 'calls':
    case 'imports':
    case 'references':
    case 'contains':
    case 'extends':
    case 'implements':
      return kind
    default:
      return kind ? safeSegment(kind) : 'references'
  }
}

function extractSymbolQueries(content: string): string[] {
  const queries = new Set<string>()
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /\bexport\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /\bexport\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /\bexport\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      queries.add(match[1])
    }
  }
  return [...queries]
}

function extractRequestCallsBySymbol(content: string): Map<string, RequestCall[]> {
  const result = new Map<string, RequestCall[]>()
  const exportPattern = /\bexport\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)[\s\S]*?(?=\n\s*export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+[A-Za-z_$]|\n\s*function\s+[A-Za-z_$]|$)/g
  for (const match of content.matchAll(exportPattern)) {
    const name = match[1]
    const block = match[0]
    const calls = extractRequestCalls(block)
    if (calls.length > 0) {
      result.set(name, calls)
    }
  }
  return result
}

function extractRequestCalls(content: string): RequestCall[] {
  const calls: RequestCall[] = []
  const stringRequestPattern = /\brequest\s*\(\s*([`'"])([^`'"]+)\1\s*,?\s*(\{[\s\S]*?\})?/g
  for (const match of content.matchAll(stringRequestPattern)) {
    calls.push({
      path: match[2],
      method: extractObjectStringValue(match[3] ?? '', 'method'),
      prefix: extractObjectStringValue(match[3] ?? '', 'prefix')
    })
  }
  const objectRequestPattern = /\brequest\s*\(\s*\{([\s\S]*?)\}\s*\)/g
  for (const match of content.matchAll(objectRequestPattern)) {
    const objectBody = match[1]
    const path = extractObjectStringValue(objectBody, 'url') ?? extractObjectStringValue(objectBody, 'path')
    if (path) {
      calls.push({
        path,
        method: extractObjectStringValue(objectBody, 'method'),
        prefix: extractObjectStringValue(objectBody, 'prefix')
      })
    }
  }
  return calls
}

function extractObjectStringValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`\\b${key}\\s*:\\s*([\\'"\`])([^\\'"\`]+)\\1`, 'i'))
  return match?.[2]
}

function resolveContextArtifactDir(input: GraphBuildInput, artifactDir: string): string {
  const outputDir = input.outputDir ?? (input.rootDir ? join(input.rootDir, '.context') : undefined)
  if (!outputDir) {
    return artifactDir
  }
  return artifactDir.startsWith('.context/') ? join(outputDir, artifactDir.slice('.context/'.length)) : resolve(outputDir, artifactDir)
}

function resolveContextDataDir(input: GraphBuildInput): string {
  const scopeSegment = safeSegment(input.scope.id)
  const outputDir = input.outputDir ?? (input.rootDir ? join(input.rootDir, '.context') : undefined)
  if (!outputDir) {
    return `.context/extensions/${codeGraphAdapterManifest.id}/data/${scopeSegment}`
  }
  return join(resolveAdapterExtensionPaths({ adapterId: codeGraphAdapterManifest.id, outputDir }).dataDir, scopeSegment)
}

function commonScopePath(artifacts: RawArtifact[]): string {
  const paths = artifacts.map((artifact) => normalizePath(artifact.source.location?.path ?? '')).filter(Boolean)
  if (paths.length === 0) return ''
  const firstParts = paths[0].split('/').slice(0, -1)
  let length = firstParts.length
  for (const path of paths.slice(1)) {
    const parts = path.split('/').slice(0, -1)
    while (length > 0 && firstParts.slice(0, length).join('/') !== parts.slice(0, length).join('/')) {
      length -= 1
    }
  }
  return firstParts.slice(0, length).join('/')
}

function stripScopePath(path: string, scopePath: string): string {
  if (!scopePath) return path
  return path === scopePath ? basename(path) : path.startsWith(`${scopePath}/`) ? path.slice(scopePath.length + 1) : path
}

function fileIdFromPath(path: string): string {
  return safeSegment(basename(path).replace(/\./g, '-'))
}

function isCodeArtifact(artifact: RawArtifact): boolean {
  return artifact.mediaType === 'text/typescript' || artifact.mediaType === 'text/javascript' || /\.(tsx?|jsx?)$/i.test(artifact.source.location?.path ?? artifact.source.uri)
}

function evidenceFor(description: string, sourceRef: SourceRef): Evidence[] {
  return [{ type: 'explicit_reference', description, sourceRefs: [sourceRef] }]
}

function codeGraphDiagnostic(type: string, message: string, scopeId: string) {
  return {
    id: `DIAG-${type}-${safeSegment(scopeId)}`,
    type,
    severity: 'error' as const,
    message,
    relatedNodes: [],
    evidence: [],
    createdAt: new Date().toISOString(),
    properties: { adapterId: codeGraphAdapterManifest.id, scopeId }
  }
}

function dedupeNodes(nodes: ContextNode[]): ContextNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()]
}

function dedupeEdges(edges: ContextEdge[]): ContextEdge[] {
  return [...new Map(edges.map((edge) => [edge.id, edge])).values()]
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-|-$/g, '') || 'item'
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}
