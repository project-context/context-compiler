import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ContextEdge, ContextGraph, ContextNode, Diagnostic } from '../contracts/index.js'

/** Resolve `.context` or another configured output directory from a project root. */
export function resolveOutputDir(rootDir: string, outputDir = '.context'): string {
  return resolve(rootDir, outputDir)
}

/** Persist flat and partitioned graph files as JSON Lines. */
export async function writeGraphFiles(graph: ContextGraph, outputDir: string): Promise<void> {
  const graphDir = join(outputDir, 'graph')
  await mkdir(graphDir, { recursive: true })
  await Promise.all([
    writeJsonl(join(graphDir, 'nodes.jsonl'), graph.nodes),
    writeJsonl(join(graphDir, 'edges.jsonl'), graph.edges),
    writeJsonl(join(graphDir, 'diagnostics.jsonl'), graph.diagnostics)
  ])
}

/** Read graph files from `.context/graph`. */
export async function loadGraphFiles(outputDir: string): Promise<ContextGraph> {
  const graphDir = join(outputDir, 'graph')
  const [nodes, edges, diagnostics] = await Promise.all([
    readJsonl<ContextNode>(join(graphDir, 'nodes.jsonl')),
    readJsonl<ContextEdge>(join(graphDir, 'edges.jsonl')),
    readJsonl<Diagnostic>(join(graphDir, 'diagnostics.jsonl'))
  ])
  return { nodes, edges, diagnostics }
}

/** Search graph nodes with a deterministic lightweight token score. */
export function queryGraph(graph: ContextGraph, query: string, limit = 20): ContextNode[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9_\-\u4e00-\u9fff]+/i).filter(Boolean)
  if (tokens.length === 0) {
    return []
  }
  return graph.nodes
    .map((node) => ({ node, score: scoreNode(node, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, limit)
    .map((entry) => entry.node)
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

async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8')
  if (content.trim().length === 0) {
    return []
  }
  return content.trim().split('\n').map((line) => JSON.parse(line) as T)
}

function scoreNode(node: ContextNode, tokens: string[]): number {
  const text = [
    node.id,
    node.title,
    node.content,
    ...node.tags,
    ...Object.values(node.metadata).map((value) => JSON.stringify(value))
  ].join(' ').toLowerCase()
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0)
}
