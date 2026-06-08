import { defineComponent, type ContextComponent } from '@context-compiler/core/sdk'

/** Create a placeholder task-context compressor for configured future task packs. */
export function createTaskContextCompressComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'compress.task-context',
      stage: 'compress',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph'],
      outputs: ['context-pack:task-context'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process() {
      return {}
    }
  })
}
