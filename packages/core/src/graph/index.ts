import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ContextEdge, ContextGraph, ContextGraphScopeManifest, ContextNode, ContextSourceInventory, Diagnostic, Evidence, GraphFactProvenance, SourceRef } from '../contracts/index.js'
import { fingerprintValue, nodeContent, slug, sourceUri } from './model.js'
import { buildGraphScopes, scopeDirName } from './scopes.js'

export * from './model.js'
export * from './scopes.js'
export * from './adapters.js'

/** Resolve `.context` or another configured output directory from a project root. */
export function resolveOutputDir(rootDir: string, outputDir = '.context'): string {
  return resolve(rootDir, outputDir)
}

export interface WriteGraphFilesOptions {
  sourceInventory?: ContextSourceInventory
}

/** Ensure materialized graph facts carry at least seed provenance for explainability. */
export function ensureGraphFactProvenance(graph: ContextGraph, options: { revisionId?: string; createdAt?: string } = {}): ContextGraph {
  const createdAt = options.createdAt ?? new Date().toISOString()
  const revisionId = options.revisionId ?? 'compile-seed'
  return {
    nodes: graph.nodes.map((node) => {
      const provenance = node.provenance?.length ? node.provenance : [seedProvenance('node', node.id, revisionId, createdAt, [], node.sourceRefs)]
      return { ...node, provenance }
    }),
    edges: graph.edges.map((edge) => {
      const sourceRefs = sourceRefsForEvidence(edge.evidence)
      const provenance = edge.provenance?.length ? edge.provenance : [seedProvenance('edge', edge.id, revisionId, createdAt, edge.evidence, sourceRefs)]
      return { ...edge, provenance }
    }),
    diagnostics: graph.diagnostics
  }
}

/** Persist flat and partitioned graph files as JSON Lines. */
export async function writeGraphFiles(graph: ContextGraph, outputDir: string, options: WriteGraphFilesOptions = {}): Promise<void> {
  const materializedGraph = ensureGraphFactProvenance(graph)
  const submittedPatches = await readOptionalText(join(outputDir, 'graph', 'patches', 'submitted.jsonl'))
  await rm(join(outputDir, 'graph'), { recursive: true, force: true })
  const graphDir = join(outputDir, 'graph', 'global')
  await mkdir(graphDir, { recursive: true })
  await Promise.all([
    writeJsonl(join(graphDir, 'nodes.jsonl'), materializedGraph.nodes),
    writeJsonl(join(graphDir, 'edges.jsonl'), materializedGraph.edges),
    writeJsonl(join(graphDir, 'diagnostics.jsonl'), materializedGraph.diagnostics)
  ])
  await Promise.all([writeSubgraphs(materializedGraph, outputDir), writePartitions(materializedGraph, outputDir), writeScopeGraphs(materializedGraph, outputDir, options.sourceInventory)])
  if (submittedPatches !== undefined) {
    await mkdir(join(outputDir, 'graph', 'patches'), { recursive: true })
    await writeFile(join(outputDir, 'graph', 'patches', 'submitted.jsonl'), submittedPatches)
  }
}

/** Read graph files from `.context/graph`. */
export async function loadGraphFiles(outputDir: string): Promise<ContextGraph> {
  const graphDir = join(outputDir, 'graph')
  const globalGraphDir = join(graphDir, 'global')
  const [nodes, edges, diagnostics] = await Promise.all([
    readJsonlWithFallback<ContextNode>(join(globalGraphDir, 'nodes.jsonl'), join(graphDir, 'nodes.jsonl')),
    readJsonlWithFallback<ContextEdge>(join(globalGraphDir, 'edges.jsonl'), join(graphDir, 'edges.jsonl')),
    readJsonlWithFallback<Diagnostic>(join(globalGraphDir, 'diagnostics.jsonl'), join(graphDir, 'diagnostics.jsonl'))
  ])
  return ensureGraphFactProvenance({ nodes, edges, diagnostics })
}

/** Search graph nodes with a deterministic lightweight token score. */
export function queryGraph(graph: ContextGraph, query: string, limit = 20): ContextNode[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9_\-\u4e00-\u9fff]+/i).filter(Boolean)
  if (tokens.length === 0) {
    return []
  }
  return graph.nodes
    .filter((node) => !isProvenanceNode(node))
    .map((node) => ({ node, score: scoreNode(node, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, limit)
    .map((entry) => entry.node)
}

function isProvenanceNode(node: ContextNode): boolean {
  return node.type === 'Source' || node.type === 'SourceSnapshot'
}

/** Return one node plus its immediate edges and neighboring nodes. */
export function explainTrace(graph: ContextGraph, nodeId: string): {
  node: ContextNode
  relatedEdges: ContextEdge[]
  relatedNodes: ContextNode[]
} {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new Error(`Context node not found: ${nodeId}`)
  }
  const relatedEdges = graph.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId)
  const relatedNodeIds = new Set(relatedEdges.flatMap((edge) => [edge.from, edge.to]).filter((id) => id !== nodeId))
  return {
    node,
    relatedEdges,
    relatedNodes: graph.nodes.filter((candidate) => relatedNodeIds.has(candidate.id))
  }
}

async function writeJsonl(path: string, records: unknown[]): Promise<void> {
  const content = records.map((record) => JSON.stringify(record)).join('\n')
  await writeFile(path, content.length > 0 ? `${content}\n` : '')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8')
  if (content.trim().length === 0) {
    return []
  }
  return content.trim().split('\n').map((line) => JSON.parse(line) as T)
}

async function readJsonlWithFallback<T>(primary: string, fallback: string): Promise<T[]> {
  try {
    return await readJsonl<T>(primary)
  } catch {
    return readJsonl<T>(fallback)
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

function scoreNode(node: ContextNode, tokens: string[]): number {
  const text = [
    node.id,
    node.type,
    node.name,
    nodeContent(node),
    sourceUri(node),
    ...node.tags,
    ...Object.values(node.properties).map((value) => JSON.stringify(value))
  ].join(' ').toLowerCase()
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0)
}

function seedProvenance(
  factKind: GraphFactProvenance['factKind'],
  factId: string,
  revisionId: string,
  createdAt: string,
  evidence: Evidence[],
  sourceRefs: SourceRef[]
): GraphFactProvenance {
  return {
    schemaVersion: 'context-graph-fact-provenance.v1',
    id: `PROV-${fingerprintValue({ factKind, factId, revisionId, sourceRefs }).slice(0, 16)}`,
    factKind,
    factId,
    revisionId,
    operation: 'compile_seed',
    evidenceReportIds: [],
    findingTypes: [],
    evidence,
    sourceRefs,
    status: 'seed',
    createdAt
  }
}

function sourceRefsForEvidence(evidence: Evidence[]): SourceRef[] {
  const refs = new Map<string, SourceRef>()
  for (const item of evidence) {
    for (const ref of item.sourceRefs) {
      refs.set(`${ref.sourceId}:${ref.uri}:${ref.location?.path ?? ''}`, ref)
    }
  }
  return [...refs.values()]
}

async function writeSubgraphs(graph: ContextGraph, outputDir: string): Promise<void> {
  const subgraphsDir = join(outputDir, 'graph', 'subgraphs')
  await mkdir(subgraphsDir, { recursive: true })
  const subgraphs = ['document', 'code', 'api', 'test', 'ui', 'runtime', 'governance', 'semantic']
  await Promise.all(
    subgraphs.flatMap((subgraph) => {
      const nodes = graph.nodes.filter((node) => subgraphForNodeType(node.type) === subgraph)
      const nodeIds = new Set(nodes.map((node) => node.id))
      const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      return [
        writeJsonl(join(subgraphsDir, `${subgraph}.nodes.jsonl`), nodes),
        writeJsonl(join(subgraphsDir, `${subgraph}.edges.jsonl`), edges)
      ]
    })
  )
  await writeSourceGroupSubgraphs(graph, subgraphsDir)
}

async function writeScopeGraphs(graph: ContextGraph, outputDir: string, sourceInventory: ContextSourceInventory | undefined): Promise<void> {
  const scopesDir = join(outputDir, 'graph', 'scopes')
  await mkdir(scopesDir, { recursive: true })
  const scopedGraphs = buildGraphScopes(graph, sourceInventory)
  const manifest: ContextGraphScopeManifest = {
    schemaVersion: 'context-graph-scopes.v1',
    generatedAt: new Date().toISOString(),
    scopes: scopedGraphs.graphs.map(({ scope }) => ({
      ...scope,
      nodes: `.context/graph/scopes/${scopeDirName(scope.id)}/nodes.jsonl`,
      edges: `.context/graph/scopes/${scopeDirName(scope.id)}/edges.jsonl`,
      summary: `.context/graph/scopes/${scopeDirName(scope.id)}/summary.json`
    })),
    adapters: scopedGraphs.adapters
  }

  await Promise.all([
    writeJson(join(scopesDir, 'manifest.json'), manifest),
    ...scopedGraphs.graphs.flatMap(({ scope, graph: scopedGraph }) => {
      const dir = join(scopesDir, scopeDirName(scope.id))
      return [
        mkdir(dir, { recursive: true }).then(() => writeJsonl(join(dir, 'nodes.jsonl'), scopedGraph.nodes)),
        mkdir(dir, { recursive: true }).then(() => writeJsonl(join(dir, 'edges.jsonl'), scopedGraph.edges)),
        mkdir(dir, { recursive: true }).then(() =>
          writeJson(join(dir, 'summary.json'), {
            schemaVersion: 'context-graph-scope-summary.v1',
            scope,
            stats: scope.stats,
            adapters: scope.adapterRefs
          })
        )
      ]
    })
  ])
}

async function writeSourceGroupSubgraphs(graph: ContextGraph, subgraphsDir: string): Promise<void> {
  const sourceGroupNodes = graph.nodes.filter((node) => node.type === 'SourceGroup')
  await Promise.all(
    sourceGroupNodes.map(async (group) => {
      const groupPath = typeof group.properties.path === 'string' ? normalizePath(group.properties.path) : undefined
      const nodes = graph.nodes.filter((node) => node.id === group.id || (groupPath ? nodeHasSourcePathWithin(node, groupPath) : false))
      const nodeIds = new Set(nodes.map((node) => node.id))
      const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      const dir = join(subgraphsDir, 'source-groups', slug(group.id))
      await mkdir(dir, { recursive: true })
      await Promise.all([writeJsonl(join(dir, 'nodes.jsonl'), nodes), writeJsonl(join(dir, 'edges.jsonl'), edges)])
    })
  )
}

function nodeHasSourcePathWithin(node: ContextNode, groupPath: string): boolean {
  return node.sourceRefs.some((sourceRef) => {
    const path = sourceRef.location?.path
    return typeof path === 'string' && pathWithin(path, groupPath)
  })
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

async function writePartitions(graph: ContextGraph, outputDir: string): Promise<void> {
  const partitionsDir = join(outputDir, 'graph', 'partitions')
  await Promise.all([
    writePartitionGroup(graph, join(partitionsDir, 'domain'), (node) => node.domain),
    writePartitionGroup(graph, join(partitionsDir, 'module'), (node) => node.module),
    writePartitionGroup(graph, join(partitionsDir, 'source'), (node) => node.sourceRefs[0]?.sourceId)
  ])
}

async function writePartitionGroup(graph: ContextGraph, dir: string, keyFor: (node: ContextNode) => string | undefined): Promise<void> {
  await mkdir(dir, { recursive: true })
  const keys = [...new Set(graph.nodes.map(keyFor).filter((key): key is string => Boolean(key)))].sort()
  await Promise.all(
    keys.flatMap((key) => {
      const nodes = graph.nodes.filter((node) => keyFor(node) === key)
      const nodeIds = new Set(nodes.map((node) => node.id))
      const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      const file = slug(key)
      return [
        writeJsonl(join(dir, `${file}.nodes.jsonl`), nodes),
        writeJsonl(join(dir, `${file}.edges.jsonl`), edges)
      ]
    })
  )
}

function subgraphForNodeType(type: string): string {
  if (type === 'CodeSymbol' || type === 'Class' || type === 'Interface' || type === 'Method' || type === 'File') return 'code'
  if (type === 'APIEndpoint' || type === 'RequestDTO' || type === 'ResponseDTO' || type === 'ExternalAPI') return 'api'
  if (['TestPlan', 'TestCase', 'TestSuite', 'TestMethod', 'Fixture', 'TestData', 'Assertion'].includes(type)) return 'test'
  if (type.startsWith('UI') || type === 'UserFlow' || type === 'Interaction') return 'ui'
  if (
    [
      'Metric',
      'RuntimeConfig',
      'ConfigItem',
      'FeatureFlag',
      'DatabaseSchema',
      'DatabaseTable',
      'LogPattern',
      'TraceSpan',
      'Deployment',
      'Release',
      'Incident',
      'Environment'
    ].includes(type)
  ) {
    return 'runtime'
  }
  if (type === 'Diagnostic' || type === 'ContextPolicy' || type === 'ContextHealth') return 'governance'
  if (
    [
      'Document',
      'Section',
      'Requirement',
      'BusinessRule',
      'AcceptanceCriteria',
      'Decision',
      'Risk',
      'ChangeLog',
      'GlossaryTerm',
      'Procedure',
      'RunbookStep'
    ].includes(type)
  ) {
    return 'document'
  }
  return 'semantic'
}
