import { describe, expect, it } from 'vitest'
import { emptyPipelineState } from '@context-compiler/core/kernel'
import { type PipelineExecutionContext, type RawArtifact } from '@context-compiler/core/sdk'
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

export const pageBaseBenefitAPI = async (data?: any) =>
  request('/pageList', {
    method: 'get',
    params: data,
    prefix: baseBenefitPrefix,
  })

export async function uploadFileAPI(data: FormData) {
  return request('/config/uploadFile', {
    method: 'post',
    data,
    prefix: yhbPrefix,
    headers: {
      'Content-type': 'multipart/form-data',
    },
  })
}
`,
      source: { sourceId: 'source:src/refund-service.ts', uri: 'file://src/refund-service.ts', title: 'source' },
      metadata: {}
    }

    const component = createSymbolIndexEnrichComponent()
    const result = await component.process({ ...emptyPipelineState(), rawArtifacts: [artifact] }, context)
    const facts = result.facts ?? []

    expect(facts.map((node) => node.name)).toEqual(['RefundRequest', 'RefundStatus', 'RefundService', 'refundOrder', 'pageBaseBenefitAPI', 'uploadFileAPI'])
    expect(facts.map((node) => node.type)).toEqual(['CodeSymbol', 'CodeSymbol', 'CodeSymbol', 'CodeSymbol', 'CodeSymbol', 'CodeSymbol'])
    expect(facts.find((node) => node.name === 'RefundRequest')?.properties).toMatchObject({
      kind: 'interface',
      exported: true,
      imports: [{ module: './money', names: ['Money'] }]
    })
    expect(facts.find((node) => node.name === 'RefundStatus')?.properties).toMatchObject({
      kind: 'type',
      exported: true
    })
    expect(facts.find((node) => node.name === 'RefundService')?.properties).toMatchObject({
      kind: 'class',
      exportedDefault: true
    })
    expect(facts.find((node) => node.name === 'refundOrder')?.properties).toMatchObject({
      kind: 'function',
      exported: true,
      signature: expect.stringContaining('refundOrder')
    })
    expect(facts.find((node) => node.name === 'pageBaseBenefitAPI')?.properties).toMatchObject({
      kind: 'function',
      exported: true,
      signature: expect.stringContaining('pageBaseBenefitAPI'),
      requestCalls: [{ path: '/pageList', method: 'get', prefix: 'baseBenefitPrefix' }]
    })
    expect(facts.find((node) => node.name === 'uploadFileAPI')?.properties).toMatchObject({
      kind: 'function',
      exported: true,
      requestCalls: [{ path: '/config/uploadFile', method: 'post', prefix: 'yhbPrefix' }]
    })
    expect(facts[0].sourceRefs[0]).toMatchObject({
      sourceId: 'source:src/refund-service.ts',
      uri: 'file://src/refund-service.ts'
    })
    expect(facts[0].fingerprint).toEqual(expect.any(String))
  })
})
