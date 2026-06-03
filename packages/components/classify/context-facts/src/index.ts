import { defineComponent, type ContextComponent, type ContextNode, type ContextNodeType } from '@context-compiler/core'

/** Create the deterministic classifier that turns normalized records into graph facts. */
export function createContextFactsClassifyComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'classify.context-facts',
      stage: 'classify',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['normalized-record'],
      outputs: ['context-fact'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const facts: ContextNode[] = state.normalizedRecords.map((record) => ({
        id: record.id,
        type: toNodeType(record.semanticType),
        title: record.title,
        content: record.content,
        domain: record.domain,
        tags: record.tags ?? [],
        source: record.source,
        metadata: record.metadata ?? {}
      }))
      return { facts }
    }
  })
}

function toNodeType(value: string): ContextNodeType {
  const allowed = new Set([
    'requirement',
    'business_rule',
    'acceptance_criteria',
    'design_spec',
    'api_contract',
    'test_case',
    'bug',
    'decision',
    'risk',
    'code_symbol',
    'repository',
    'module',
    'package',
    'file',
    'build_target',
    'dependency',
    'entry_point',
    'route',
    'config_item',
    'runtime_signal',
    'project',
    'domain',
    'page',
    'ui_component',
    'database',
    'diagnostic'
  ])
  return (allowed.has(value) ? value : 'requirement') as ContextNodeType
}
