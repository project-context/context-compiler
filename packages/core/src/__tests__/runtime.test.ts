import { describe, expect, it } from 'vitest'
import {
  buildContextIndexes,
  buildContextRuntimeWorkspace,
  defineContextProject,
  type ContextGraph
} from '@context-compiler/core'

const graph: ContextGraph = {
  nodes: [
    {
      id: 'API-POST-api-orders-id-refund',
      type: 'api_contract',
      title: 'POST /api/orders/{id}/refund',
      content: 'Refund an order',
      tags: [],
      source: { uri: 'file://openapi.yaml', type: 'openapi' },
      metadata: { method: 'POST', path: '/api/orders/{id}/refund', operationId: 'refundOrder' }
    },
    {
      id: 'SYM-refund-service-ts-RefundService',
      type: 'code_symbol',
      title: 'RefundService',
      content: 'class RefundService',
      tags: ['class'],
      source: { uri: 'file://src/refund-service.ts', type: 'code' },
      metadata: { kind: 'class', file: 'src/refund-service.ts', language: 'typescript' }
    },
    {
      id: 'RUNTIME-refund-error-rate',
      type: 'runtime_signal',
      title: 'Refund API error rate',
      content: '24h error rate for refund API',
      tags: ['metrics'],
      source: { uri: 'runtime://metrics/refund', type: 'runtime' },
      metadata: { providerId: 'refund-metrics' }
    },
    {
      id: 'TEST-ORDER-REFUND',
      type: 'test_case',
      title: 'Refund regression test',
      content: 'TC-REFUND-001: supports partial refund',
      tags: [],
      source: { uri: 'file://docs/tests/refund.md', type: 'markdown' },
      metadata: { requirementIds: ['REQ-ORDER-REFUND-001'] }
    }
  ],
  edges: [
    {
      id: 'EDGE-API-implemented-by-SYM',
      from: 'API-POST-api-orders-id-refund',
      to: 'SYM-refund-service-ts-RefundService',
      type: 'implemented_by',
      metadata: {}
    }
  ],
  diagnostics: [
    {
      id: 'DIAG-runtime-warning',
      severity: 'warning',
      code: 'runtime.provider.unverified',
      message: 'Runtime provider is declared but not verified.',
      metadata: {}
    }
  ]
}

describe('context runtime workspace', () => {
  it('builds deterministic JSON indexes from graph nodes', () => {
    const indexes = buildContextIndexes(graph)

    expect(indexes.manifest.schemaVersion).toBe('context-runtime.v1')
    expect(indexes.manifest.files.symbols).toBe('.context/indexes/symbols.json')
    expect(indexes.symbols).toEqual([
      {
        id: 'SYM-refund-service-ts-RefundService',
        name: 'RefundService',
        kind: 'class',
        file: 'src/refund-service.ts',
        language: 'typescript',
        source: 'file://src/refund-service.ts'
      }
    ])
    expect(indexes.apis[0]).toMatchObject({
      id: 'API-POST-api-orders-id-refund',
      method: 'POST',
      path: '/api/orders/{id}/refund'
    })
    expect(indexes.search.map((entry) => entry.id)).toEqual([
      'API-POST-api-orders-id-refund',
      'RUNTIME-refund-error-rate',
      'SYM-refund-service-ts-RefundService',
      'TEST-ORDER-REFUND'
    ])
  })

  it('infers runtime tools and skills from compiled graph and packs without user runtime config', () => {
    const config = defineContextProject(
      {
        sources: [{ type: 'markdown', name: 'product-docs', path: './docs/product' }]
      },
      { rootDir: '/repo/local-shop' }
    )

    const workspace = buildContextRuntimeWorkspace(graph, config, [
      {
        id: 'context-view:implementation',
        kind: 'context-view',
        title: 'Implementation Context',
        view: 'implementation',
        content: '# Implementation Context\n',
        metadata: {}
      },
      {
        id: 'context-view:testing',
        kind: 'context-view',
        title: 'Testing Context',
        view: 'testing',
        content: '# Testing Context\n',
        metadata: {}
      }
    ])

    expect(workspace.manifest.schemaVersion).toBe('context-runtime.v1')
    expect(workspace.plan.schemaVersion).toBe('context-runtime-plan.v1')
    expect(workspace.manifest.runtime.providers).toEqual(['refund-metrics'])
    expect(workspace.manifest.indexes.search).toBe('.context/indexes/search.json')
    expect(workspace.runtimeConfig.providers[0]).toMatchObject({
      id: 'refund-metrics',
      kind: 'static',
      title: 'Refund API error rate'
    })
    expect(workspace.tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        'context-compile',
        'context-doctor',
        'context-task-implementation',
        'context-task-testing',
        'context-review'
      ])
    )
    expect(workspace.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(['implementation', 'testing', 'review'])
    )
    expect(workspace.agents.map((agent) => agent.id)).toEqual(['codex', 'claude', 'cursor'])
    expect(workspace.plugins.map((plugin) => plugin.id)).toEqual(['context-compiler-local'])
    expect(workspace.plan.capabilities.find((capability) => capability.id === 'context-task-implementation')).toMatchObject({
      kind: 'project-tool',
      targetAgents: ['codex', 'claude', 'cursor'],
      evidence: expect.arrayContaining([expect.objectContaining({ nodeId: 'API-POST-api-orders-id-refund' })])
    })
    expect(workspace.plan.capabilities.find((capability) => capability.id === 'refund-metrics')).toMatchObject({
      kind: 'provider',
      evidence: expect.arrayContaining([expect.objectContaining({ nodeId: 'RUNTIME-refund-error-rate' })])
    })
    expect(workspace.health.status).toBe('issues')
    expect(workspace.health.counts).toMatchObject({
      nodes: 4,
      edges: 1,
      diagnostics: 1,
      views: 2,
      indexes: 3,
      providers: 1,
      tools: 5,
      skills: 3
    })
  })
})
