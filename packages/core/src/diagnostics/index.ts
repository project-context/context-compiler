import type { SourceRef } from '../contracts/config.js'
import type { Diagnostic, DiagnosticSeverity } from '../contracts/graph.js'

/** Input for constructing a normalized diagnostic record. */
export interface CreateDiagnosticInput {
  id?: string
  severity: DiagnosticSeverity
  code: string
  message: string
  nodeId?: string
  source?: SourceRef
  trace?: string[]
  remediation?: string
  metadata?: Record<string, unknown>
}

/** Create a deterministic diagnostic id from the diagnostic code and target. */
export function createDiagnostic(input: CreateDiagnosticInput): Diagnostic {
  const target = input.nodeId ?? input.source?.uri ?? input.message
  return {
    id: input.id ?? `DIAG-${slug(input.code)}-${slug(target).slice(0, 80)}`,
    type: input.code,
    severity: input.severity,
    message: input.message,
    relatedNodes: input.nodeId ? [input.nodeId] : [],
    evidence: input.source ? [{ type: 'manual', description: input.message, sourceRefs: [input.source] }] : [],
    suggestedAction: input.remediation,
    createdAt: new Date().toISOString(),
    properties: {
      code: input.code,
      ...(input.trace ? { trace: input.trace } : {}),
      ...(input.metadata ?? {})
    }
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'context'
}
