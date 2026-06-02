import { describe, expect, it } from 'vitest'
import {
  type ContextGraph,
  type ContextProjectConfig,
  generateTaskContext,
  renderTaskContextMarkdown
} from '../index.js'

const source = {
  uri: 'file://docs/product/refund.md',
  type: 'markdown',
  name: 'product-docs',
  updatedAt: '2026-06-02T00:00:00.000Z'
}

const config: ContextProjectConfig = {
  project: {
    name: 'example-shop',
    domains: ['order'],
    defaultLanguage: 'zh-CN'
  },
  sources: [],
  roles: {
    backend: {
      include: ['requirement', 'api_contract', 'code_symbol', 'test_case', 'bug']
    },
    tester: {
      include: ['requirement', 'acceptance_criteria', 'test_case', 'bug', 'risk']
    }
  }
}

const graph: ContextGraph = {
  nodes: [
    {
      id: 'REQ-ORDER-REFUND-001',
      type: 'requirement',
      title: '支持订单部分退款',
      content: 'Support partial refund for paid orders.',
      domain: 'order',
      tags: ['refund'],
      source,
      metadata: {}
    },
    {
      id: 'REQ-ORDER-REFUND-001-AC-1',
      type: 'acceptance_criteria',
      title: 'Refunded amount is recorded',
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
    },
    {
      id: 'CODE-src-refund-service-RefundService',
      type: 'code_symbol',
      title: 'RefundService',
      tags: [],
      source: { ...source, type: 'git', uri: 'file://src/refund-service.ts' },
      metadata: {
        kind: 'class',
        name: 'RefundService',
        file: 'src/refund-service.ts'
      }
    }
  ],
  edges: [
    {
      id: 'REQ-ORDER-REFUND-001--has_acceptance_criteria--REQ-ORDER-REFUND-001-AC-1',
      from: 'REQ-ORDER-REFUND-001',
      to: 'REQ-ORDER-REFUND-001-AC-1',
      type: 'has_acceptance_criteria',
      metadata: {}
    },
    {
      id: 'REQ-ORDER-REFUND-001--relates_to--API-POST-api-orders-id-refund',
      from: 'REQ-ORDER-REFUND-001',
      to: 'API-POST-api-orders-id-refund',
      type: 'relates_to',
      metadata: {}
    },
    {
      id: 'REQ-ORDER-REFUND-001--verified_by--TC-REFUND-001',
      from: 'REQ-ORDER-REFUND-001',
      to: 'TC-REFUND-001',
      type: 'verified_by',
      metadata: {}
    }
  ],
  diagnostics: [
    {
      id: 'DIAG-api.missing_requirement-API-POST-api-orders-id-refund',
      severity: 'warning',
      code: 'api.missing_requirement',
      message: 'API is not linked to any requirement.',
      nodeId: 'API-POST-api-orders-id-refund',
      source,
      metadata: {}
    }
  ]
}

describe('generateTaskContext', () => {
  it('matches task keywords and expands requirement edges for the requested role', () => {
    const result = generateTaskContext(graph, config, {
      task: '支持订单部分退款',
      role: 'backend'
    })

    expect(result.matchedNodes.map((node) => node.id)).toEqual(['REQ-ORDER-REFUND-001'])
    expect(result.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'REQ-ORDER-REFUND-001',
        'API-POST-api-orders-id-refund',
        'TC-REFUND-001'
      ])
    )
    expect(result.nodes.map((node) => node.id)).not.toContain('REQ-ORDER-REFUND-001-AC-1')
    expect(result.recommendedChecks).toEqual(
      expect.arrayContaining([
        'Review linked requirements, APIs, code symbols, tests, and diagnostics before implementation.',
        'Run or add tests covering the related requirements before shipping changes.'
      ])
    )
  })

  it('renders a stable markdown task context', () => {
    const result = generateTaskContext(graph, config, {
      task: '支持订单部分退款',
      role: 'backend'
    })

    const markdown = renderTaskContextMarkdown(result)

    expect(markdown).toContain('# Task Context: 支持订单部分退款')
    expect(markdown).toContain('## Requirements')
    expect(markdown).toContain('- REQ-ORDER-REFUND-001: 支持订单部分退款')
    expect(markdown).toContain('## APIs')
    expect(markdown).toContain('- API-POST-api-orders-id-refund: POST /api/orders/{id}/refund')
  })

  it('returns an empty result with a clear message when no context matches', () => {
    const result = generateTaskContext(graph, config, {
      task: 'unknown checkout coupon',
      role: 'backend'
    })

    expect(result.nodes).toEqual([])
    expect(renderTaskContextMarkdown(result)).toContain('No directly related context found.')
  })
})

