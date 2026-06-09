import type { ContextEdge, ContextGraph, ContextNode } from '../contracts/graph.js'
import type { PipelineState } from '../contracts/pipeline.js'

/** Create an empty state object for a fresh pipeline run. */
export function emptyPipelineState(): PipelineState {
  return {
    rawArtifacts: [],
    parsedArtifacts: [],
    normalizedRecords: [],
    facts: [],
    edges: [],
    graph: { nodes: [], edges: [], diagnostics: [] },
    packs: [],
    outputArtifacts: [],
    diagnostics: [],
    artifacts: {}
  }
}

/** Rebuild graph nodes and diagnostics from the current pipeline state. */
export function graphFromState(state: PipelineState): ContextGraph {
  return {
    nodes: dedupeNodes(state.facts),
    edges: dedupeEdges(state.edges),
    diagnostics: dedupeDiagnostics(state.diagnostics)
  }
}

/** Merge a component result into existing pipeline state. */
export function mergePipelineState(state: PipelineState, patch: Partial<PipelineState>): PipelineState {
  const next: PipelineState = {
    rawArtifacts: [...state.rawArtifacts, ...(patch.rawArtifacts ?? [])],
    parsedArtifacts: [...state.parsedArtifacts, ...(patch.parsedArtifacts ?? [])],
    normalizedRecords: [...state.normalizedRecords, ...(patch.normalizedRecords ?? [])],
    facts: dedupeNodes([...state.facts, ...(patch.facts ?? [])]),
    edges: dedupeEdges([...state.edges, ...(patch.edges ?? [])]),
    graph: patch.graph ?? state.graph,
    packs: [...state.packs, ...(patch.packs ?? [])],
    outputArtifacts: [...state.outputArtifacts, ...(patch.outputArtifacts ?? [])],
    diagnostics: dedupeDiagnostics([...state.diagnostics, ...(patch.diagnostics ?? [])]),
    artifacts: { ...state.artifacts, ...(patch.artifacts ?? {}) }
  }

  next.graph = patch.graph ?? graphFromState(next)
  return next
}

/** Remove duplicate nodes by stable id. Later entries win. */
export function dedupeNodes(nodes: ContextNode[]): ContextNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()]
}

/** Remove duplicate edges by stable id. Later entries win. */
export function dedupeEdges(edges: ContextEdge[]): ContextEdge[] {
  return [...new Map(edges.map((edge) => [edge.id, edge])).values()]
}

function dedupeDiagnostics<T extends { id: string }>(diagnostics: T[]): T[] {
  return [...new Map(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic])).values()]
}
