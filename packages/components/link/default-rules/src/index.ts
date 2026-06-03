import { defineComponent, type ContextComponent, type ContextEdge, type ContextNode } from '@context-compiler/core'

/** Create deterministic local graph linking rules. */
export function createDefaultRulesLinkComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'link.default-rules',
      stage: 'link',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph'],
      outputs: ['context-edge'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const nodes = state.graph.nodes
      const edges: ContextEdge[] = []

      for (const criterion of nodes.filter((node) => node.type === 'acceptance_criteria')) {
        const requirementId = stringMeta(criterion, 'requirementId')
        if (requirementId && nodes.some((node) => node.id === requirementId)) {
          edges.push(edge(requirementId, criterion.id, 'has_acceptance_criteria', criterion.source))
        }
      }

      for (const requirement of nodes.filter((node) => node.type === 'requirement')) {
        for (const apiRef of stringArrayMeta(requirement, 'relatedApis')) {
          for (const api of nodes.filter((node) => node.type === 'api_contract' && apiMatches(node, apiRef))) {
            edges.push(edge(requirement.id, api.id, 'relates_to', requirement.source))
          }
        }
      }

      for (const test of nodes.filter((node) => node.type === 'test_case')) {
        for (const requirementId of stringArrayMeta(test, 'requirementIds')) {
          if (nodes.some((node) => node.id === requirementId)) {
            edges.push(edge(requirementId, test.id, 'verified_by', test.source))
          }
        }
      }

      for (const api of nodes.filter((node) => node.type === 'api_contract')) {
        const operationId = stringMeta(api, 'operationId')
        if (!operationId) {
          continue
        }
        const normalizedOperation = normalize(operationId)
        for (const symbol of nodes.filter((node) => node.type === 'code_symbol')) {
          if (normalize(symbol.title).includes(normalizedOperation.replace(/order$/, '')) || normalizedOperation.includes(normalize(symbol.title))) {
            edges.push(edge(api.id, symbol.id, 'implemented_by', api.source))
          }
        }
      }

      return { edges }
    }
  })
}

function edge(from: string, to: string, type: string, source: ContextEdge['source']): ContextEdge {
  return {
    id: `EDGE-${from}-${type}-${to}`.replace(/[^A-Za-z0-9_.:-]+/g, '-'),
    from,
    to,
    type,
    source,
    metadata: {}
  }
}

function apiMatches(api: ContextNode, reference: string): boolean {
  return normalize(api.title).includes(normalize(reference)) || normalize(reference).includes(normalize(api.title))
}

function stringMeta(node: ContextNode, key: string): string | undefined {
  const value = node.metadata[key]
  return typeof value === 'string' ? value : undefined
}

function stringArrayMeta(node: ContextNode, key: string): string[] {
  const value = node.metadata[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/{}.-]+/g, '')
}
