import { inferContextViews, renderContextView } from '@context-compiler/core/runtime'
import { type ContextPack } from '@context-compiler/core/runtime'
import { defineComponent, type ContextComponent } from '@context-compiler/core/sdk'

/** Create the default inferred context-view compression component. */
export function createContextViewCompressComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'compress.context-view',
      stage: 'compress',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph'],
      outputs: ['context-pack:context-view'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state, context) {
      const packs: ContextPack[] = inferContextViews(state.graph).map((view) => ({
        id: `context-view:${view.name}`,
        kind: 'context-view',
        title: view.title,
        view: view.name,
        content: renderContextView(state.graph, context.config, view.name),
        metadata: {
          view
        }
      }))
      return { packs }
    }
  })
}
