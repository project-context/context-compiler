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
    writeJsonl(join(graphDir, 'diagnostics.jsonl'), graph.diagnostics)
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

async function writeJsonl(path: string, records: unknown[]): Promise<void> {
  const content = records.map((record) => JSON.stringify(record)).join('\n')
  await writeFile(path, content.length > 0 ? `${content}\n` : '')
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

