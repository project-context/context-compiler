import { describe, expect, it } from 'vitest'
import { createContextFactsClassifyComponent } from './index.js'
import { defineContextProject } from '@context-compiler/core/config'
import { emptyPipelineState } from '@context-compiler/core/kernel'

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
            content: '24h error rate for refund API',
            source: { sourceId: 'runtime:metrics:refund', uri: 'runtime://metrics/refund', title: 'runtime' },
            metadata: { providerId: 'refund-metrics' }
          },
          {
            id: 'CONFIG-refund-service',
            semanticType: 'config_item',
            title: 'Refund service configuration',
            source: { sourceId: 'runtime:config:refund', uri: 'runtime://config/refund', title: 'runtime' }
          },
          {
            id: 'DB-orders',
            semanticType: 'database',
            title: 'Orders database',
            source: { sourceId: 'db:orders', uri: 'db://orders', title: 'runtime' }
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

    expect(result.facts?.map((fact) => fact.type)).toEqual(['Metric', 'ConfigItem', 'DatabaseSchema'])
    expect(result.facts?.[0]).toMatchObject({
      id: 'RUNTIME-refund-error-rate',
      name: 'Refund API error rate',
      sourceRefs: [{ sourceId: 'runtime:metrics:refund', uri: 'runtime://metrics/refund' }],
      status: 'active',
      authority: 'source_of_truth',
      confidence: 0.85,
      properties: {
        content: '24h error rate for refund API',
        providerId: 'refund-metrics',
        type: 'runtime_signal'
      }
    })
    expect(result.facts?.[0]?.fingerprint).toEqual(expect.any(String))
  })
})
