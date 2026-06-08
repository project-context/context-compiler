import { describe, expect, it } from 'vitest'
import { applyGraphPatch, applyGraphPatchBatch, buildPlanningPack, createGraphRevision, reconcileEvidenceReports, validateGraphPatch } from '@context-compiler/core/kernel'
import { createContextEdge, createContextNode, type ContextGraph, type ContextSourceInventory, type GraphPatch, type EvidenceReport } from '@context-compiler/core/sdk'

const sourceRef = {
  sourceId: 'workspace',
  uri: 'file://sources/docs/product.md',
  location: { path: 'sources/docs/product.md' }
}

const graph: ContextGraph = {
  nodes: [
    createContextNode({
      id: 'SOURCE-GROUP-workspace-sources-docs',
      type: 'SourceGroup',
      name: 'Docs',
      status: 'hypothesis',
      confidence: 0.55,
      sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/docs', location: { path: 'sources/docs' } }],
      properties: {
        kind: 'doc_bundle',
        path: 'sources/docs',
        decisionSource: 'agent'
      }
    }),
    createContextNode({
      id: 'SOURCE-GROUP-workspace-sources-code',
      type: 'SourceGroup',
      name: 'Code',
      status: 'hypothesis',
      confidence: 0.5,
      sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/code', location: { path: 'sources/code' } }],
      properties: {
        kind: 'repository',
        path: 'sources/code',
        decisionSource: 'agent'
      }
    }),
    createContextNode({
      id: 'REQ-docs-product',
      type: 'Requirement',
      name: 'Product requirement',
      status: 'provisional',
      confidence: 0.7,
      sourceRefs: [sourceRef],
      properties: {
        sourceGroupId: 'SOURCE-GROUP-workspace-sources-docs'
      }
    }),
    createContextNode({
      id: 'API-docs-product',
      type: 'APIEndpoint',
      name: 'POST /api/product',
      status: 'hypothesis',
      confidence: 0.62,
      sourceRefs: [sourceRef],
      properties: {
        sourceGroupId: 'SOURCE-GROUP-workspace-sources-docs'
      }
    })
  ],
  edges: [],
  diagnostics: []
}

const inventory: ContextSourceInventory = {
  schemaVersion: 'context-source-inventory.v1',
  entries: Array.from({ length: 8 }, (_, index) => ({
    id: `entry:${index}`,
    sourceName: 'workspace',
    root: './sources',
    path: `sources/docs/file-${index}.md`,
    uri: `file://sources/docs/file-${index}.md`,
    mediaType: 'text/markdown',
    sizeBytes: 10 + index,
    hash: `${index}`.repeat(64).slice(0, 64),
    route: 'markdown',
    status: 'routed',
    sourceRef: {
      sourceId: 'workspace',
      uri: `file://sources/docs/file-${index}.md`,
      location: { path: `sources/docs/file-${index}.md` }
    }
  })),
  summary: { roots: 1, files: 8, groups: 0, routed: 8, inventoryOnly: 0, unsupported: 0, skipped: 0 }
}

describe('graph kernel', () => {
  it('applies graph patches while preserving revision lineage', () => {
    const revision = createGraphRevision(graph, { reason: 'seed graph' })
    const patch: GraphPatch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:relabel-docs',
      revisionId: revision.id,
      author: { type: 'agent', name: 'claude' },
      status: 'proposed',
      createdAt: revision.createdAt,
      evidence: [],
      operations: [
        {
          op: 'relabel_source_group',
          nodeId: 'SOURCE-GROUP-workspace-sources-docs',
          kind: 'analysis_bundle',
          title: 'Analysis docs',
          summary: 'Mostly analysis material.',
          confidence: 0.82
        }
      ]
    }

    const result = applyGraphPatch(graph, patch, revision)
    const node = result.graph.nodes.find((candidate) => candidate.id === 'SOURCE-GROUP-workspace-sources-docs')

    expect(result.revision).toMatchObject({
      parentRevisionId: revision.id,
      patchIds: ['patch:relabel-docs']
    })
    expect(node?.status).toBe('provisional')
    expect(node?.name).toBe('Analysis docs')
    expect(node?.properties).toMatchObject({
      kind: 'analysis_bundle',
      summary: 'Mostly analysis material.'
    })
    expect(node?.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revisionId: result.revision.id,
          previousRevisionId: revision.id,
          patchId: 'patch:relabel-docs',
          operation: 'relabel_source_group',
          findingTypes: ['relabel_group']
        })
      ])
    )
    expect(result.appliedPatch).toMatchObject({
      status: 'applied',
      revisionId: revision.id,
      appliedRevisionId: result.revision.id,
      applicationResults: [expect.objectContaining({ operation: 'relabel_source_group', factId: 'SOURCE-GROUP-workspace-sources-docs' })]
    })
  })

  it('builds a budgeted planning pack instead of embedding the full inventory', () => {
    const pack = buildPlanningPack(inventory, {
      maxCandidates: 2,
      maxRepresentativeFiles: 3
    })

    expect(pack.schemaVersion).toBe('context-planning-pack.v1')
    expect(pack.candidates.length).toBeLessThanOrEqual(2)
    expect(pack.candidates[0].representativeFiles.length).toBeLessThanOrEqual(3)
    expect(JSON.stringify(pack)).not.toContain('"entries"')
    expect(pack.drillDownTools).toEqual(
      expect.arrayContaining(['inspect_source_candidate', 'search_source_inventory', 'get_source_trace'])
    )
  })

  it('reconciles evidence into graph patches and proposal-only rehome suggestions', () => {
    const revision = createGraphRevision(graph, { reason: 'seed graph' })
    const report: EvidenceReport = {
      schemaVersion: 'context-evidence-report.v1',
      id: 'evidence:api-doc',
      revisionId: revision.id,
      scopeId: 'scope:content:api-doc',
      generatedAt: revision.createdAt,
      summary: 'API contract content was found inside a docs bundle.',
      findings: [
        {
          type: 'misplaced_source',
          nodeId: 'SOURCE-GROUP-workspace-sources-docs',
          sourcePath: 'sources/docs/product.md',
          suggestedKind: 'api_bundle',
          suggestedPath: 'sources/api/product.md',
          confidence: 0.88,
          evidence: [{ type: 'explicit_reference', description: 'OpenAPI markers found', sourceRefs: [sourceRef] }]
        }
      ],
      proposedPatches: [],
      rehomeProposals: []
    }

    const result = reconcileEvidenceReports(graph, revision, [report])

    expect(result.patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revisionId: revision.id,
          operations: expect.arrayContaining([expect.objectContaining({ op: 'relabel_source_group', kind: 'api_bundle' })])
        })
      ])
    )
    expect(result.rehomeProposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'keep',
          sourcePath: 'sources/docs/product.md',
          suggestedPath: 'sources/api/product.md',
          status: 'proposed'
        })
      ])
    )
  })

  it('reconciles split, merge, link, confirm, and reparent evidence into canonical graph patch operations', () => {
    const revision = createGraphRevision(graph, { reason: 'seed graph' })
    const report: EvidenceReport = {
      schemaVersion: 'context-evidence-report.v1',
      id: 'evidence:scope-feedback',
      revisionId: revision.id,
      scopeId: 'scope:source-group:docs',
      generatedAt: revision.createdAt,
      summary: 'Child scope evidence refined the parent source-group graph.',
      findings: [
        {
          type: 'split_group',
          nodeId: 'SOURCE-GROUP-workspace-sources-docs',
          targetGroupId: 'SOURCE-GROUP-workspace-sources-api',
          affectedNodeIds: ['API-docs-product'],
          newGroup: {
            path: 'sources/docs/api',
            title: 'API docs',
            kind: 'api_bundle',
            boundaryMode: 'collapsed',
            summary: 'API material extracted from docs.'
          },
          confidence: 0.9,
          evidence: [{ type: 'explicit_reference', description: 'OpenAPI path found', sourceRefs: [sourceRef] }]
        },
        {
          type: 'merge_group',
          nodeId: 'SOURCE-GROUP-workspace-sources-code',
          targetGroupId: 'SOURCE-GROUP-workspace-sources-docs',
          affectedNodeIds: ['REQ-docs-product'],
          confidence: 0.72,
          evidence: [{ type: 'semantic_match', description: 'Code group was actually docs in this fixture', sourceRefs: [] }]
        },
        {
          type: 'link_groups',
          nodeId: 'SOURCE-GROUP-workspace-sources-docs',
          targetGroupId: 'SOURCE-GROUP-workspace-sources-code',
          relationType: 'related_to_group',
          confidence: 0.8,
          evidence: [{ type: 'semantic_match', description: 'Shared upload product terminology', sourceRefs: [] }]
        },
        {
          type: 'confirm_fact',
          nodeId: 'REQ-docs-product',
          confidence: 0.95,
          evidence: [{ type: 'explicit_reference', description: 'Requirement confirmed by content graph', sourceRefs: [sourceRef] }]
        },
        {
          type: 'misplaced_source',
          nodeId: 'SOURCE-GROUP-workspace-sources-docs',
          targetGroupId: 'SOURCE-GROUP-workspace-sources-api',
          affectedNodeIds: ['API-docs-product'],
          sourcePath: 'sources/docs/product.md',
          suggestedPath: 'sources/docs/api/product.md',
          confidence: 0.86,
          evidence: [{ type: 'explicit_reference', description: 'API fact belongs to API docs group', sourceRefs: [sourceRef] }]
        }
      ],
      proposedPatches: [],
      rehomeProposals: []
    }

    const reconciled = reconcileEvidenceReports(graph, revision, [report])
    const patch = reconciled.patches.find((candidate) => candidate.id === 'PATCH-evidence-scope-feedback')

    expect(patch).toMatchObject({
      revisionId: revision.id,
      author: { type: 'kernel', name: 'graph-kernel' }
    })
    expect(patch?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'add_node', node: expect.objectContaining({ id: 'SOURCE-GROUP-workspace-sources-api', type: 'SourceGroup' }) }),
        expect.objectContaining({ op: 'add_edge', edge: expect.objectContaining({ from: 'SOURCE-GROUP-workspace-sources-docs', to: 'SOURCE-GROUP-workspace-sources-api', type: 'contains_group' }) }),
        expect.objectContaining({ op: 'reparent_node', nodeId: 'API-docs-product', sourceGroupId: 'SOURCE-GROUP-workspace-sources-api' }),
        expect.objectContaining({ op: 'deprecate_node', nodeId: 'SOURCE-GROUP-workspace-sources-code', supersededBy: 'SOURCE-GROUP-workspace-sources-docs' }),
        expect.objectContaining({ op: 'link', edge: expect.objectContaining({ from: 'SOURCE-GROUP-workspace-sources-docs', to: 'SOURCE-GROUP-workspace-sources-code', type: 'related_to_group' }) }),
        expect.objectContaining({ op: 'update_node', nodeId: 'REQ-docs-product', status: 'confirmed', confidence: 0.95 })
      ])
    )
    expect(reconciled.rehomeProposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'keep',
          sourcePath: 'sources/docs/product.md',
          fromGroupId: 'SOURCE-GROUP-workspace-sources-docs',
          toGroupId: 'SOURCE-GROUP-workspace-sources-api',
          suggestedPath: 'sources/docs/api/product.md'
        })
      ])
    )

    const applied = applyGraphPatchBatch(graph, revision, reconciled.patches)

    expect(applied.revision).toMatchObject({
      parentRevisionId: revision.id,
      patchIds: ['PATCH-evidence-scope-feedback'],
      evidenceReportIds: ['evidence:scope-feedback']
    })
    expect(applied.graph.nodes.find((node) => node.id === 'SOURCE-GROUP-workspace-sources-api')).toMatchObject({
      type: 'SourceGroup',
      name: 'API docs',
      status: 'hypothesis',
      properties: expect.objectContaining({ kind: 'api_bundle', path: 'sources/docs/api' })
    })
    expect(applied.graph.nodes.find((node) => node.id === 'SOURCE-GROUP-workspace-sources-code')).toMatchObject({
      status: 'superseded',
      properties: expect.objectContaining({ supersededBy: 'SOURCE-GROUP-workspace-sources-docs' })
    })
    expect(applied.graph.nodes.find((node) => node.id === 'REQ-docs-product')).toMatchObject({ status: 'confirmed', confidence: 0.95 })
    expect(applied.graph.nodes.find((node) => node.id === 'REQ-docs-product')?.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patchId: 'PATCH-evidence-scope-feedback',
          operation: 'update_node',
          evidenceReportIds: ['evidence:scope-feedback'],
          findingTypes: ['confirm_fact'],
          sourceRefs: expect.arrayContaining([sourceRef])
        })
      ])
    )
    expect(applied.graph.edges.find((edge) => edge.type === 'related_to_group')?.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patchId: 'PATCH-evidence-scope-feedback',
          operation: 'link',
          evidenceReportIds: ['evidence:scope-feedback'],
          findingTypes: ['link_groups']
        })
      ])
    )
    expect(applied.graph.nodes.find((node) => node.id === 'API-docs-product')?.properties).toMatchObject({
      sourceGroupId: 'SOURCE-GROUP-workspace-sources-api'
    })
    expect(applied.appliedPatches[0]).toMatchObject({
      appliedRevisionId: applied.revision?.id,
      applicationResults: expect.arrayContaining([
        expect.objectContaining({ operation: 'link', factKind: 'edge' }),
        expect.objectContaining({ operation: 'update_node', factId: 'REQ-docs-product' })
      ])
    })
    expect(applied.rehomeProposals).toEqual(reconciled.rehomeProposals)
  })

  it('validates graph patches before they enter the canonical graph', () => {
    const revision = createGraphRevision(graph, { reason: 'seed graph' })
    const missingNodePatch: GraphPatch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:missing-node',
      revisionId: revision.id,
      author: { type: 'agent', name: 'codex' },
      status: 'proposed',
      createdAt: revision.createdAt,
      evidence: [],
      operations: [{ op: 'update_node', nodeId: 'SOURCE-GROUP-missing', properties: { reviewed: true } }]
    }
    const missingEdgePatch: GraphPatch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:missing-edge-endpoint',
      revisionId: revision.id,
      author: { type: 'agent', name: 'codex' },
      status: 'proposed',
      createdAt: revision.createdAt,
      evidence: [],
      operations: [
        {
          op: 'add_edge',
          edge: createContextEdge({
            id: 'EDGE-missing',
            from: 'SOURCE-GROUP-workspace-sources-docs',
            to: 'SOURCE-GROUP-missing',
            type: 'related_to_group',
            linker: 'test',
            evidence: []
          })
        }
      ]
    }
    const stalePatch = { ...missingNodePatch, id: 'patch:stale', revisionId: 'REV-stale' }
    const noopPatch = { ...missingNodePatch, id: 'patch:noop', operations: [] }
    const missingDeprecatedEdgePatch: GraphPatch = {
      ...missingNodePatch,
      id: 'patch:missing-edge',
      operations: [{ op: 'deprecate_edge', edgeId: 'EDGE-missing', reason: 'test' }]
    }

    expect(validateGraphPatch(graph, revision, missingNodePatch).map((diagnostic) => diagnostic.type)).toContain('graph.patch.missing-node')
    expect(validateGraphPatch(graph, revision, missingEdgePatch).map((diagnostic) => diagnostic.type)).toContain('graph.patch.missing-edge-endpoint')
    expect(validateGraphPatch(graph, revision, missingDeprecatedEdgePatch).map((diagnostic) => diagnostic.type)).toContain('graph.patch.missing-edge')
    expect(validateGraphPatch(graph, revision, stalePatch).map((diagnostic) => diagnostic.type)).toContain('graph.patch.stale-revision')
    expect(validateGraphPatch(graph, revision, noopPatch).map((diagnostic) => diagnostic.type)).toContain('graph.patch.noop')
  })

  it('deprecates edges without deleting them from the canonical graph', () => {
    const edge = createContextEdge({
      id: 'EDGE-docs-code',
      from: 'SOURCE-GROUP-workspace-sources-docs',
      to: 'SOURCE-GROUP-workspace-sources-code',
      type: 'related_to_group',
      linker: 'test',
      evidence: []
    })
    const graphWithEdge: ContextGraph = { ...graph, edges: [edge] }
    const revision = createGraphRevision(graphWithEdge, { reason: 'seed graph' })
    const patch: GraphPatch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:deprecate-edge',
      revisionId: revision.id,
      author: { type: 'agent', name: 'codex' },
      status: 'proposed',
      createdAt: revision.createdAt,
      evidence: [],
      operations: [{ op: 'deprecate_edge', edgeId: 'EDGE-docs-code', reason: 'wrong weak relation' }]
    }

    const result = applyGraphPatchBatch(graphWithEdge, revision, [patch])
    const nextEdge = result.graph.edges.find((candidate) => candidate.id === 'EDGE-docs-code')

    expect(nextEdge).toMatchObject({
      id: 'EDGE-docs-code',
      status: 'deprecated',
      properties: expect.objectContaining({ deprecationReason: 'wrong weak relation' })
    })
    expect(nextEdge?.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ patchId: 'patch:deprecate-edge', operation: 'deprecate_edge', factKind: 'edge' })
      ])
    )
  })

  it('applies valid patch batches in stable order and rejects stale patches', () => {
    const revision = createGraphRevision(graph, { reason: 'seed graph' })
    const first: GraphPatch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:z-second-id',
      revisionId: revision.id,
      author: { type: 'agent', name: 'codex' },
      status: 'proposed',
      createdAt: '2026-06-04T00:00:02.000Z',
      evidence: [],
      operations: [{ op: 'update_node', nodeId: 'SOURCE-GROUP-workspace-sources-docs', properties: { order: ['second'] } }]
    }
    const second: GraphPatch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:a-first-id',
      revisionId: revision.id,
      author: { type: 'agent', name: 'codex' },
      status: 'proposed',
      createdAt: '2026-06-04T00:00:01.000Z',
      evidence: [],
      operations: [{ op: 'update_node', nodeId: 'SOURCE-GROUP-workspace-sources-docs', properties: { order: ['first'] } }]
    }
    const stale: GraphPatch = {
      ...second,
      id: 'patch:stale',
      revisionId: 'REV-stale'
    }

    const result = applyGraphPatchBatch(graph, revision, [first, stale, second])

    expect(result.appliedPatches.map((patch) => patch.id)).toEqual(['patch:a-first-id', 'patch:z-second-id'])
    expect(result.rejectedPatches).toEqual([expect.objectContaining({ id: 'patch:stale', status: 'rejected' })])
    expect(result.revision).toMatchObject({
      parentRevisionId: revision.id,
      patchIds: ['patch:a-first-id', 'patch:z-second-id']
    })
    expect(result.graph.nodes.find((node) => node.id === 'SOURCE-GROUP-workspace-sources-docs')?.properties).toMatchObject({
      order: ['second']
    })
    expect(result.graph.nodes.find((node) => node.id === 'SOURCE-GROUP-workspace-sources-docs')?.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ patchId: 'patch:a-first-id', operation: 'update_node' }),
        expect.objectContaining({ patchId: 'patch:z-second-id', operation: 'update_node' })
      ])
    )
    expect(result.diagnostics.map((diagnostic) => diagnostic.type)).toContain('graph.patch.stale-revision')
  })
})
