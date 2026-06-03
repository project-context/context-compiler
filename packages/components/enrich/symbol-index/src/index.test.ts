import { describe, expect, it } from 'vitest'
import { emptyPipelineState, type PipelineExecutionContext, type RawArtifact } from '@context-compiler/core'
import { createSymbolIndexEnrichComponent } from './index.js'

const context: PipelineExecutionContext = {
  rootDir: '/repo',
  outputDir: '/repo/.context',
  config: {
    workspace: { rootDir: '/repo', name: 'repo' },
    sources: []
  },
  pipelineId: 'compile',
  stage: 'enrich'
}

describe('symbol index enrichment', () => {
  it('extracts TypeScript exported declarations with compiler metadata', async () => {
    const artifact: RawArtifact = {
      id: 'raw:source:src/refund-service.ts',
      kind: 'raw',
      mediaType: 'text/typescript',
      content: `
import { Money } from './money'

export interface RefundRequest {
  amount: Money
}

export type RefundStatus = 'pending' | 'completed'

export default class RefundService {}

export function refundOrder(request: RefundRequest): RefundStatus {
  return 'completed'
}
`,
      source: { uri: 'file://src/refund-service.ts', type: 'code', name: 'source' },
      metadata: {}
    }

    const component = createSymbolIndexEnrichComponent()
    const result = await component.process({ ...emptyPipelineState(), rawArtifacts: [artifact] }, context)
    const facts = result.facts ?? []

    expect(facts.map((node) => node.title)).toEqual(['RefundRequest', 'RefundStatus', 'RefundService', 'refundOrder'])
    expect(facts.find((node) => node.title === 'RefundRequest')?.metadata).toMatchObject({
      kind: 'interface',
      exported: true,
      imports: [{ module: './money', names: ['Money'] }]
    })
    expect(facts.find((node) => node.title === 'RefundStatus')?.metadata).toMatchObject({
      kind: 'type',
      exported: true
    })
    expect(facts.find((node) => node.title === 'RefundService')?.metadata).toMatchObject({
      kind: 'class',
      exportedDefault: true
    })
    expect(facts.find((node) => node.title === 'refundOrder')?.metadata).toMatchObject({
      kind: 'function',
      exported: true,
      signature: expect.stringContaining('refundOrder')
    })
  })
})
