import { describe, expect, it } from 'vitest'
import {
  buildContextIndexes,
  buildContextRuntimeWorkspace,
  createContextEdge,
  createContextNode,
  defineContextProject,
  type ContextGraph
} from '@context-compiler/core'

const graph: ContextGraph = {
  nodes: [
    createContextNode({
      id: 'API-POST-api-orders-id-refund',
      type: 'api_contract',
      name: 'POST /api/orders/{id}/refund',
      content: 'Refund an order',
      source: { sourceId: 'api-spec:openapi.yaml', uri: 'file://openapi.yaml', title: 'api-spec' },
      properties: { method: 'POST', path: '/api/orders/{id}/refund', operationId: 'refundOrder' }
    }),
    createContextNode({
      id: 'SYM-refund-service-ts-RefundService',
      type: 'code_symbol',
      name: 'RefundService',
      content: 'class RefundService',
      tags: ['class'],
      source: { sourceId: 'source:src/refund-service.ts', uri: 'file://src/refund-service.ts', title: 'source' },
      properties: { kind: 'class', file: 'src/refund-service.ts', language: 'typescript' }
    }),
    createContextNode({
      id: 'RUNTIME-refund-error-rate',
      type: 'runtime_signal',
      name: 'Refund API error rate',
      content: '24h error rate for refund API',
      tags: ['metrics'],
      source: { sourceId: 'runtime:metrics:refund', uri: 'runtime://metrics/refund', title: 'runtime' },
      properties: { providerId: 'refund-metrics' }
    }),
    createContextNode({
      id: 'TEST-ORDER-REFUND',
      type: 'test_case',
      name: 'Refund regression test',
      content: 'TC-REFUND-001: supports partial refund',
      source: { sourceId: 'test-cases:refund.md', uri: 'file://docs/tests/refund.md', title: 'test-cases' },
      properties: { requirementIds: ['REQ-ORDER-REFUND-001'] }
    })
  ],
  edges: [
    createContextEdge({
      id: 'EDGE-API-implemented-by-SYM',
      from: 'API-POST-api-orders-id-refund',
      to: 'SYM-refund-service-ts-RefundService',
      type: 'implemented_by',
      evidence: [],
      linker: 'test'
    })
  ],
  diagnostics: [
    {
      id: 'DIAG-runtime-warning',
      type: 'runtime.provider.unverified',
      severity: 'warning',
      message: 'Runtime provider is declared but not verified.',
      relatedNodes: ['RUNTIME-refund-error-rate'],
      evidence: [],
      createdAt: '2026-06-03T00:00:00.000Z',
      properties: {}
    }
  ]
}

describe('context runtime workspace', () => {
  it('builds deterministic JSON indexes from graph nodes', () => {
    const indexes = buildContextIndexes(graph)

    expect(indexes.manifest.schemaVersion).toBe('context-runtime.v1')
    expect(indexes.manifest.files.symbols).toBe('.context/indexes/global/symbols.sqlite')
    expect(indexes.symbols).toEqual([
      {
        id: 'SYM-refund-service-ts-RefundService',
        name: 'RefundService',
        kind: 'class',
        file: 'src/refund-service.ts',
        language: 'typescript',
        sourceUri: 'file://src/refund-service.ts'
      }
    ])
    expect(indexes.apis[0]).toMatchObject({
      id: 'API-POST-api-orders-id-refund',
      method: 'POST',
      path: '/api/orders/{id}/refund'
    })
    expect(indexes.fts.map((entry) => entry.id)).toEqual([
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
    expect(workspace.manifest.graph.scopes).toBe('.context/graph/scopes/manifest.json')
    expect(workspace.manifest.indexes.scopes).toBe('.context/indexes/scopes')
    expect(workspace.manifest.runtime.providers).toBe('.context/runtime/providers')
    expect(workspace.manifest.indexes.fts).toBe('.context/indexes/global/fts.sqlite')
    expect(workspace.manifest.plans.workspaceGraph).toBe('.context/plans/workspace-graph-plan.json')
    expect(workspace.runtimeConfig.providers[0]).toMatchObject({
      name: 'refund-metrics',
      kind: 'metrics',
      transport: 'static',
      title: 'Refund API error rate'
    })
    expect(workspace.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'context_compile',
        'context_doctor',
        'context_task_implementation',
        'context_task_testing',
        'context_review'
      ])
    )
    expect(workspace.mcpTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['list_graph_scopes', 'get_graph_scope', 'expand_graph_scope', 'expand_graph_target'])
    )
    expect(workspace.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(['implementation', 'testing', 'review'])
    )
    expect(workspace.agents.map((agent) => agent.id)).toEqual(['codex', 'claude', 'cursor'])
    expect(workspace.plugins.map((plugin) => plugin.id)).toEqual(['context-compiler-local'])
    expect(workspace.plan.capabilities.find((capability) => capability.id === 'context_task_implementation')).toMatchObject({
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
      indexes: 9,
      providers: 1,
      tools: 5,
      skills: 3
    })
  })
})
