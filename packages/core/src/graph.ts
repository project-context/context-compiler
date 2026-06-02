import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  ContextEdgeSchema,
  ContextGraphSchema,
  ContextNodeSchema,
  DiagnosticSchema,
  type ContextEdge,
  type ContextGraph,
  type ContextNode,
  type Diagnostic
} from './schemas.js'

export function resolveOutputDir(rootDir: string, outputDir = '.context'): string {
  return resolve(rootDir, outputDir)
}

export async function writeGraphFiles(graph: ContextGraph, outputDir: string): Promise<void> {
  const graphDir = join(outputDir, 'graph')
  await mkdir(graphDir, { recursive: true })
  await Promise.all([
    writeJsonl(join(graphDir, 'nodes.jsonl'), graph.nodes),
    writeJsonl(join(graphDir, 'edges.jsonl'), graph.edges),
    writeJsonl(join(graphDir, 'diagnostics.jsonl'), graph.diagnostics),
    writePartitionedGraphFiles(graph, outputDir)
  ])
}

export async function writePartitionedGraphFiles(
  graph: ContextGraph,
  outputDir: string
): Promise<void> {
  const graphDir = join(outputDir, 'graph')
  await Promise.all([
    writePartitions(join(graphDir, 'nodes'), graph.nodes, (node) => node.type),
    writePartitions(join(graphDir, 'edges'), graph.edges, (edge) => edge.type),
    writePartitions(join(graphDir, 'diagnostics'), graph.diagnostics, (diagnostic) => diagnostic.severity)
  ])
}

export async function readGraphFiles(outputDir: string): Promise<ContextGraph> {
  const graphDir = join(outputDir, 'graph')
  const [nodes, edges, diagnostics] = await Promise.all([
    readJsonl(join(graphDir, 'nodes.jsonl'), ContextNodeSchema.parse),
    readJsonl(join(graphDir, 'edges.jsonl'), ContextEdgeSchema.parse),
    readJsonl(join(graphDir, 'diagnostics.jsonl'), DiagnosticSchema.parse)
  ])

  return ContextGraphSchema.parse({ nodes, edges, diagnostics })
}

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
  const relatedNodeIds = new Set(
    relatedEdges.flatMap((edge) => [edge.from, edge.to]).filter((id) => id !== nodeId)
  )
  const relatedNodes = graph.nodes.filter((candidate) => relatedNodeIds.has(candidate.id))

  return { node, relatedEdges, relatedNodes }
}

export function dedupeNodes(nodes: ContextNode[]): ContextNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()]
}

export function dedupeEdges(edges: ContextEdge[]): ContextEdge[] {
  return [...new Map(edges.map((edge) => [edge.id, edge])).values()]
}

export function queryGraph(graph: ContextGraph, query: string, limit = 20): ContextNode[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_\-\u4e00-\u9fff]+/i)
    .filter((token) => token.length > 0)

  if (tokens.length === 0) {
    return []
  }

  return graph.nodes
    .map((node) => ({
      node,
      score: scoreNode(node, tokens)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, limit)
    .map((entry) => entry.node)
}

async function writeJsonl(path: string, records: unknown[]): Promise<void> {
  const content = records.map((record) => JSON.stringify(record)).join('\n')
  await writeFile(path, content.length > 0 ? `${content}\n` : '')
}

async function writePartitions<T>(
  dir: string,
  records: T[],
  key: (record: T) => string
): Promise<void> {
  await mkdir(dir, { recursive: true })
  const groups = new Map<string, T[]>()
  for (const record of records) {
    const group = safePartitionName(key(record))
    groups.set(group, [...(groups.get(group) ?? []), record])
  }

  await Promise.all(
    [...groups.entries()].map(([group, groupRecords]) => writeJsonl(join(dir, `${group}.jsonl`), groupRecords))
  )
}

function scoreNode(node: ContextNode, tokens: string[]): number {
  const text = [
    node.id,
    node.title,
    node.content,
    ...node.tags,
    ...Object.values(node.metadata).map((value) => JSON.stringify(value))
  ]
    .join(' ')
    .toLowerCase()

  return tokens.reduce((score, token) => score + (text.includes(token.toLowerCase()) ? 1 : 0), 0)
}

function safePartitionName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-')
}

async function readJsonl<T>(path: string, parse: (input: unknown) => T): Promise<T[]> {
  const content = await readFile(path, 'utf8')
  if (content.trim().length === 0) {
    return []
  }

  return content
    .trim()
    .split('\n')
    .map((line) => parse(JSON.parse(line)))
}

export type { ContextGraph, ContextNode, ContextEdge, Diagnostic }
