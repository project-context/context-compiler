import { createContextNode, defineComponent, type ContextComponent, type ContextNode } from '@context-compiler/core'

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
      const facts: ContextNode[] = state.normalizedRecords.map((record) => createContextNode({
        id: record.id,
        type: record.semanticType,
        name: record.title,
        content: record.content,
        domain: record.domain,
        tags: record.tags ?? [],
        source: record.source,
        properties: record.metadata ?? {}
      }))
      return { facts }
    }
  })
}
