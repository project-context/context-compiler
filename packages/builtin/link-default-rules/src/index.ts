import { createContextEdge, defineComponent, evidenceFromSource, nodeStringArrayProperty, nodeStringProperty, type ContextComponent, type ContextEdge, type ContextNode, type EvidenceType, type SourceRef } from '@context-compiler/core/sdk'

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

      for (const criterion of nodes.filter((node) => node.type === 'AcceptanceCriteria')) {
        const requirementId = nodeStringProperty(criterion, 'requirementId')
        if (requirementId && nodes.some((node) => node.id === requirementId)) {
          edges.push(edge(requirementId, criterion.id, 'has_acceptance_criteria', criterion.sourceRefs, 'explicit_reference'))
        }
      }

      for (const requirement of nodes.filter((node) => node.type === 'Requirement')) {
        for (const apiRef of nodeStringArrayProperty(requirement, 'relatedApis')) {
          for (const api of nodes.filter((node) => node.type === 'APIEndpoint' && apiMatches(node, apiRef))) {
            edges.push(edge(requirement.id, api.id, 'exposed_as', requirement.sourceRefs, 'api_match', `Requirement references API "${apiRef}".`))
          }
        }
      }

      for (const test of nodes.filter((node) => node.type === 'TestCase')) {
        for (const requirementId of nodeStringArrayProperty(test, 'requirementIds')) {
          if (nodes.some((node) => node.id === requirementId)) {
            edges.push(edge(requirementId, test.id, 'verified_by', test.sourceRefs, 'test_match'))
          }
        }
      }

      for (const api of nodes.filter((node) => node.type === 'APIEndpoint')) {
        const operationId = nodeStringProperty(api, 'operationId')
        if (!operationId) {
          continue
        }
        const normalizedOperation = normalize(operationId)
        for (const symbol of nodes.filter((node) => node.type === 'CodeSymbol')) {
          if (normalize(symbol.name).includes(normalizedOperation.replace(/order$/, '')) || normalizedOperation.includes(normalize(symbol.name))) {
            edges.push(
              edge(
                api.id,
                symbol.id,
                'implemented_by',
                api.sourceRefs,
                'name_match',
                `API operationId "${operationId}" matches symbol "${symbol.name}".`,
                'inferred'
              )
            )
          }
        }
      }

      return { edges }
    }
  })
}

function edge(
  from: string,
  to: string,
  type: string,
  sourceRefs: SourceRef[],
  evidenceType: EvidenceType,
  description = `${to} provides ${type} evidence.`,
  status: ContextEdge['status'] = 'confirmed'
): ContextEdge {
  return createContextEdge({
    id: `EDGE-${from}-${type}-${to}`.replace(/[^A-Za-z0-9_.:-]+/g, '-'),
    from,
    to,
    type,
    evidence: [evidenceFromSource(evidenceType, description, sourceRefs)],
    linker: 'DefaultRulesLinker',
    status
  })
}

function apiMatches(api: ContextNode, reference: string): boolean {
  return normalize(api.name).includes(normalize(reference)) || normalize(reference).includes(normalize(api.name))
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/{}.-]+/g, '')
}
