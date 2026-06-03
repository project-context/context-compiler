import { explainTrace, type ContextGraph, type ContextNode, type ContextRuntimeHealth, type Diagnostic } from '@context-compiler/core'

/** Format query results for terminal output. */
export function formatNodes(nodes: ContextNode[]): string {
  if (nodes.length === 0) {
    return 'No matching context nodes found.\n'
  }
  return nodes.map((node) => `${node.id}\t${node.type}\t${node.title}`).join('\n') + '\n'
}

/** Format diagnostics for terminal output. */
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'No diagnostics.\n'
  }
  return diagnostics.map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`).join('\n') + '\n'
}

/** Format one graph trace for terminal output. */
export function formatExplanation(graph: ContextGraph, nodeId: string): string {
  const trace = explainTrace(graph, nodeId)
  const lines = [
    `${trace.node.id}: ${trace.node.title}`,
    `Type: ${trace.node.type}`,
    `Source: ${trace.node.source.uri}`,
    ''
  ]
  if (trace.relatedEdges.length > 0) {
    lines.push('Relations:')
    for (const edge of trace.relatedEdges) {
      lines.push(`- ${edge.from} -[${edge.type}]-> ${edge.to}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** Format runtime health for `context doctor`. */
export function formatRuntimeHealth(
  health: ContextRuntimeHealth,
  diagnostics: Diagnostic[],
  freshness?: { status: 'fresh' | 'stale' | 'unknown'; staleSources: string[] }
): string {
  const lines = [
    `Context runtime: ${health.status}`,
    ...(freshness ? [`Context freshness: ${freshness.status}`] : []),
    `Nodes: ${health.counts.nodes}`,
    `Edges: ${health.counts.edges}`,
    `Diagnostics: ${health.counts.diagnostics}`,
    `Views: ${health.counts.views}`,
    `Indexes: ${health.counts.indexes}`,
    `Providers: ${health.counts.providers}`,
    `Tools: ${health.counts.tools}`,
    `Skills: ${health.counts.skills}`,
    ''
  ]

  if (freshness?.staleSources.length) {
    lines.push('Stale sources:')
    for (const source of freshness.staleSources) {
      lines.push(`- ${source}`)
    }
    lines.push('')
  }

  if (diagnostics.length > 0) {
    lines.push('Graph diagnostics:')
    for (const diagnostic of diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
    }
    lines.push('')
  }

  if (health.capabilityGaps && health.capabilityGaps.length > 0) {
    lines.push('Capability gaps:')
    for (const gap of health.capabilityGaps) {
      lines.push(`- ${gap.id}: ${gap.message}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
