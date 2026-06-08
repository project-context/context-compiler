import { buildContextRuntimePlan, defineComponent, type ContextComponent } from '@context-compiler/core'

/** Create the compiler-owned runtime capability planning component. */
export function createRuntimePlanCompressComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'compress.runtime-plan',
      stage: 'compress',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph', 'context-pack'],
      outputs: ['runtime-plan'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const runtimePlan = buildContextRuntimePlan(state.graph, state.packs, state.graph.diagnostics)
      return {
        artifacts: {
          runtimePlan
        }
      }
    }
  })
}
