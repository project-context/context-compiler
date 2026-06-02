import { describe, expect, it } from 'vitest'
import {
  type ContextGraph,
  createDefaultLinker,
  createDefaultValidator
} from '../index.js'

const source = {
  uri: 'file://docs/product/refund.md',
  type: 'markdown',
  name: 'product-docs',
  updatedAt: '2026-06-02T00:00:00.000Z'
}

describe('default linker and validator', () => {
  it('links requirements to acceptance criteria, APIs, and test cases', async () => {
    const graph: ContextGraph = {
      nodes: [
        {
          id: 'REQ-ORDER-REFUND-001',
          type: 'requirement',
          title: 'Support partial refund',
          tags: [],
          source,
          metadata: {
            relatedApis: ['POST /api/orders/{id}/refund']
          }
        },
        {
          id: 'REQ-ORDER-REFUND-001-AC-1',
          type: 'acceptance_criteria',
          title: 'Refund amount is bounded',
          tags: [],
          source,
          metadata: {
            requirementId: 'REQ-ORDER-REFUND-001'
          }
        },
        {
          id: 'API-POST-api-orders-id-refund',
          type: 'api_contract',
          title: 'POST /api/orders/{id}/refund',
          tags: [],
          source: { ...source, type: 'openapi', uri: 'file://openapi.yaml' },
          metadata: {
            method: 'POST',
            path: '/api/orders/{id}/refund',
            operationId: 'refundOrder'
          }
        },
        {
          id: 'TC-REFUND-001',
          type: 'test_case',
          title: 'supports partial refund',
          tags: [],
          source,
          metadata: {
            requirementIds: ['REQ-ORDER-REFUND-001']
          }
        }
      ],
      edges: [],
      diagnostics: []
    }

    const linked = await createDefaultLinker().link(graph, {
      rootDir: process.cwd(),
      outputDir: '.context'
    })

    expect(linked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'REQ-ORDER-REFUND-001',
          to: 'REQ-ORDER-REFUND-001-AC-1',
          type: 'has_acceptance_criteria'
        }),
        expect.objectContaining({
          from: 'REQ-ORDER-REFUND-001',
          to: 'API-POST-api-orders-id-refund',
          type: 'relates_to'
        }),
        expect.objectContaining({
          from: 'REQ-ORDER-REFUND-001',
          to: 'TC-REFUND-001',
          type: 'verified_by'
        })
      ])
    )
  })

  it('reports context quality diagnostics', async () => {
    const graph: ContextGraph = {
      nodes: [
        {
          id: 'REQ-ORDER-REFUND-002',
          type: 'requirement',
          title: 'Support full refund',
          tags: [],
          source,
          metadata: {
            relatedApis: ['POST /api/orders/{id}/full-refund']
          }
        },
        {
          id: 'API-POST-api-orders-id-refund',
          type: 'api_contract',
          title: 'POST /api/orders/{id}/refund',
          tags: [],
          source: { ...source, type: 'openapi', uri: 'file://openapi.yaml' },
          metadata: {
            method: 'POST',
            path: '/api/orders/{id}/refund'
          }
        }
      ],
      edges: [],
      diagnostics: []
    }

    const diagnostics = await createDefaultValidator().validate(graph, {
      rootDir: process.cwd(),
      outputDir: '.context'
    })

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'requirement.missing_acceptance_criteria',
        'requirement.missing_test_coverage',
        'requirement.api_not_found',
        'api.missing_requirement'
      ])
    )
  })
})
