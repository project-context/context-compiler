import { defineComponent, type ContextComponent, type NormalizedRecord } from '@context-compiler/core'

/** Create the OpenAPI contract normalizer. */
export function createOpenApiContractNormalizeComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'normalize.openapi-contract',
      stage: 'normalize',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['parsed-artifact:openapi'],
      outputs: ['normalized-record:api_contract'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const normalizedRecords: NormalizedRecord[] = state.parsedArtifacts
        .filter((artifact) => artifact.parser === 'openapi')
        .map((artifact) => {
          const operation = artifact.data as { method: string; path: string; operationId?: string; summary?: string }
          return {
            id: `API-${operation.method}-${operation.path.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
            semanticType: 'api_contract',
            title: `${operation.method} ${operation.path}`,
            content: operation.summary,
            tags: [],
            source: artifact.source,
            metadata: operation
          }
        })
      return { normalizedRecords }
    }
  })
}
