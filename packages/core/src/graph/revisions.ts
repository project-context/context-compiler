import type { ContextGraph, GraphRevision } from '../contracts/graph.js'
import { fingerprintValue } from './model.js'

export interface CreateGraphRevisionOptions {
  parentRevisionId?: string
  reason: string
  status?: GraphRevision['status']
  patchIds?: string[]
  evidenceReportIds?: string[]
  createdAt?: string
}

/** Create an immutable revision record for a canonical graph snapshot. */
export function createGraphRevision(graph: ContextGraph, options: CreateGraphRevisionOptions): GraphRevision {
  const createdAt = options.createdAt ?? new Date().toISOString()
  const graphFingerprint = fingerprintValue({
    nodes: graph.nodes.map((node) => node.fingerprint).sort(),
    edges: graph.edges.map((edge) => edge.fingerprint).sort(),
    diagnostics: graph.diagnostics.map((diagnostic) => diagnostic.id).sort()
  })
  return {
    schemaVersion: 'context-graph-revision.v1',
    id: `REV-${graphFingerprint.slice(0, 16)}`,
    parentRevisionId: options.parentRevisionId,
    createdAt,
    graphFingerprint,
    reason: options.reason,
    status: options.status ?? (options.parentRevisionId ? 'materialized' : 'seed'),
    patchIds: options.patchIds ?? [],
    evidenceReportIds: options.evidenceReportIds ?? []
  }
}
