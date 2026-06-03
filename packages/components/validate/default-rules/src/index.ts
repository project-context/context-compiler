import { createDiagnostic, defineComponent, type ContextComponent } from '@context-compiler/core'

/** Create default context quality validation rules. */
export function createDefaultRulesValidateComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'validate.default-rules',
      stage: 'validate',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph'],
      outputs: ['diagnostic'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const diagnostics = []
      for (const requirement of state.graph.nodes.filter((node) => node.type === 'requirement')) {
        const hasAcceptance = state.graph.edges.some((edge) => edge.from === requirement.id && edge.type === 'has_acceptance_criteria')
        if (!hasAcceptance) {
          diagnostics.push(createDiagnostic({
            severity: 'warning',
            code: 'requirement.missing_acceptance_criteria',
            message: `Requirement "${requirement.id}" has no acceptance criteria.`,
            nodeId: requirement.id,
            source: requirement.source
          }))
        }
        const hasTest = state.graph.edges.some((edge) => edge.from === requirement.id && edge.type === 'verified_by')
        if (!hasTest) {
          diagnostics.push(createDiagnostic({
            severity: 'warning',
            code: 'requirement.missing_test',
            message: `Requirement "${requirement.id}" has no linked test case.`,
            nodeId: requirement.id,
            source: requirement.source
          }))
        }
      }
      return { diagnostics }
    }
  })
}
