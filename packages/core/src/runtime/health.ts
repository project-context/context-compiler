import type { ContextGraph, Diagnostic } from '../contracts/graph.js'
import type { ContextRuntimeConfig, ContextRuntimeHealth } from '../contracts/runtime.js'
import type { ContextIndexes } from './indexes.js'
import { CONTEXT_RUNTIME_SCHEMA_VERSION } from './schema.js'

export function buildContextRuntimeHealth(
  graph: ContextGraph,
  viewCount: number,
  indexes: ContextIndexes,
  runtimeConfig: Required<ContextRuntimeConfig>,
  runtimeDiagnostics: Diagnostic[] = []
): ContextRuntimeHealth {
  const diagnosticsBySeverity = {
    info: graph.diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length,
    warning: graph.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    error: graph.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  }
  const issueCount = diagnosticsBySeverity.warning + diagnosticsBySeverity.error
  const capabilityGaps = runtimeDiagnostics
    .filter((diagnostic) => diagnostic.type === 'runtime.capability.not-generated')
    .map((diagnostic) => ({
      id: String(diagnostic.properties.capability ?? diagnostic.type),
      diagnosticType: diagnostic.type,
      message: diagnostic.message,
      evidence: []
    }))
  return {
    schemaVersion: CONTEXT_RUNTIME_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: issueCount === 0 ? 'healthy' : 'issues',
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      diagnostics: graph.diagnostics.length,
      views: viewCount,
      indexes: Object.keys(indexes.manifest.files).length,
      providers: runtimeConfig.providers.length,
      tools: runtimeConfig.tools.length,
      skills: runtimeConfig.skills.length
    },
    diagnosticsBySeverity,
    capabilityGaps
  }
}
