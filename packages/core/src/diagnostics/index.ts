import type { Diagnostic, DiagnosticSeverity, SourceRef } from '../contracts/index.js'

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
    severity: input.severity,
    code: input.code,
    message: input.message,
    nodeId: input.nodeId,
    source: input.source,
    trace: input.trace,
    remediation: input.remediation,
    metadata: input.metadata ?? {}
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'context'
}
