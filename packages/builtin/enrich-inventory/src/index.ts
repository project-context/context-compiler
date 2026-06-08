import { defineComponent, type ContextComponent } from '@context-compiler/core/sdk'

/** Create a lightweight project inventory enrichment component. */
export function createInventoryEnrichComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'enrich.inventory',
      stage: 'enrich',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['raw-artifact'],
      outputs: ['inventory-artifact'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const files = state.rawArtifacts.map((artifact) => artifact.source.uri)
      return {
        artifacts: {
          inventory: {
            files,
            sourceCount: state.rawArtifacts.length
          }
        }
      }
    }
  })
}
