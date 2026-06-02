import type { CompilerContext, ValidatorPlugin } from './plugins.js'
import type { ContextGraph, ContextNode, Diagnostic } from './schemas.js'
import { apiMatches, metadataStringArray } from './linker.js'

export function createDefaultValidator(): ValidatorPlugin {
  return {
    name: 'validator-default-context-quality',
    async validate(graph: ContextGraph, _context: CompilerContext): Promise<Diagnostic[]> {
      const diagnostics: Diagnostic[] = []
      const requirements = graph.nodes.filter((node) => node.type === 'requirement')
      const apis = graph.nodes.filter((node) => node.type === 'api_contract')

      for (const requirement of requirements) {
        if (!hasOutgoingEdge(graph, requirement.id, 'has_acceptance_criteria')) {
          diagnostics.push(
            diagnostic(
              'warning',
              'requirement.missing_acceptance_criteria',
              requirement,
              `Requirement ${requirement.id} has no acceptance criteria.`
            )
          )
        }

        if (!hasOutgoingEdge(graph, requirement.id, 'verified_by')) {
          diagnostics.push(
            diagnostic(
              'warning',
              'requirement.missing_test_coverage',
              requirement,
              `Requirement ${requirement.id} has no linked test case.`
            )
          )
        }

        for (const relatedApi of metadataStringArray(requirement, 'relatedApis')) {
          if (!apis.some((api) => apiMatches(api, relatedApi))) {
            diagnostics.push(
              diagnostic(
                'error',
                'requirement.api_not_found',
                requirement,
                `Requirement ${requirement.id} references missing API: ${relatedApi}.`,
                { relatedApi }
              )
            )
          }
        }
      }

      for (const api of apis) {
        if (!hasIncomingEdge(graph, api.id, 'relates_to')) {
          diagnostics.push(
            diagnostic(
              'warning',
              'api.missing_requirement',
              api,
              `API ${api.title} is not linked to any requirement.`
            )
          )
        }
      }

      return diagnostics
    }
  }
}

function hasOutgoingEdge(graph: ContextGraph, from: string, type: string): boolean {
  return graph.edges.some((edge) => edge.from === from && edge.type === type)
}

function hasIncomingEdge(graph: ContextGraph, to: string, type: string): boolean {
  return graph.edges.some((edge) => edge.to === to && edge.type === type)
}

function diagnostic(
  severity: Diagnostic['severity'],
  code: string,
  node: ContextNode,
  message: string,
  metadata: Record<string, unknown> = {}
): Diagnostic {
  return {
    id: `DIAG-${code}-${node.id}`.replace(/[^A-Za-z0-9_.-]/g, '-'),
    severity,
    code,
    message,
    nodeId: node.id,
    source: node.source,
    metadata
  }
}

