import type { CompilerContext, LinkerPlugin } from './plugins.js'
import type { ContextEdge, ContextGraph, ContextNode } from './schemas.js'

export function createDefaultLinker(): LinkerPlugin {
  return {
    name: 'linker-default-local-context',
    async link(graph: ContextGraph, _context: CompilerContext): Promise<ContextEdge[]> {
      const edges: ContextEdge[] = []
      const requirements = graph.nodes.filter((node) => node.type === 'requirement')
      const acceptanceCriteria = graph.nodes.filter((node) => node.type === 'acceptance_criteria')
      const apis = graph.nodes.filter((node) => node.type === 'api_contract')
      const testCases = graph.nodes.filter((node) => node.type === 'test_case')

      for (const requirement of requirements) {
        for (const criteria of acceptanceCriteria) {
          if (metadataString(criteria, 'requirementId') === requirement.id) {
            edges.push(edge(requirement.id, criteria.id, 'has_acceptance_criteria'))
          }
        }

        for (const relatedApi of metadataStringArray(requirement, 'relatedApis')) {
          const api = apis.find((candidate) => apiMatches(candidate, relatedApi))
          if (api) {
            edges.push(edge(requirement.id, api.id, 'relates_to'))
          }
        }

        for (const testCase of testCases) {
          if (metadataStringArray(testCase, 'requirementIds').includes(requirement.id)) {
            edges.push(edge(requirement.id, testCase.id, 'verified_by'))
          }
          if (metadataStringArray(requirement, 'testCaseIds').includes(testCase.id)) {
            edges.push(edge(requirement.id, testCase.id, 'verified_by'))
          }
        }
      }

      return edges
    }
  }
}

export function apiMatches(api: ContextNode, reference: string): boolean {
  const normalized = reference.trim()
  const method = metadataString(api, 'method')?.toUpperCase()
  const path = metadataString(api, 'path')
  const operationId = metadataString(api, 'operationId')

  if (operationId && operationId === normalized) {
    return true
  }

  if (path && normalized === path) {
    return true
  }

  if (method && path && normalized.toUpperCase() === `${method} ${path}`.toUpperCase()) {
    return true
  }

  return false
}

export function metadataString(node: ContextNode, key: string): string | undefined {
  const value = node.metadata[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function metadataStringArray(node: ContextNode, key: string): string[] {
  const value = node.metadata[key]
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function edge(from: string, to: string, type: string): ContextEdge {
  return {
    id: `${from}--${type}--${to}`,
    from,
    to,
    type,
    metadata: {}
  }
}

