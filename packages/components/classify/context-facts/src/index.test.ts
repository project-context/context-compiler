import { describe, expect, it } from 'vitest'
import { createContextFactsClassifyComponent } from './index.js'
import { defineContextProject, emptyPipelineState } from '@context-compiler/core'

describe('context facts classifier', () => {
  it('preserves runtime and infrastructure node types declared by the core contract', async () => {
    const component = createContextFactsClassifyComponent()
    const result = await component.process(
      {
        ...emptyPipelineState(),
        normalizedRecords: [
          {
            id: 'RUNTIME-refund-error-rate',
            semanticType: 'runtime_signal',
            title: 'Refund API error rate',
            source: { uri: 'runtime://metrics/refund', type: 'runtime' }
          },
          {
            id: 'CONFIG-refund-service',
            semanticType: 'config_item',
            title: 'Refund service configuration',
            source: { uri: 'runtime://config/refund', type: 'runtime' }
          },
          {
            id: 'DB-orders',
            semanticType: 'database',
            title: 'Orders database',
            source: { uri: 'db://orders', type: 'runtime' }
          }
        ]
      },
      {
        rootDir: process.cwd(),
        outputDir: '.context',
        config: defineContextProject({ sources: [] }, { rootDir: process.cwd() }),
        pipelineId: 'compile',
        stage: 'classify'
      }
    )

    expect(result.facts?.map((fact) => fact.type)).toEqual(['runtime_signal', 'config_item', 'database'])
  })
})
