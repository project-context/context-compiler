import { describe, expect, it } from 'vitest'
import {
  buildSourceFirstPlans,
  createContextNode,
  defineContextProject,
  type ContextGraph,
  type ContextSourceInventory
} from '@context-compiler/core'

const inventory: ContextSourceInventory = {
  schemaVersion: 'context-source-inventory.v1',
  entries: [
    {
      id: 'source-entry:product',
      sourceName: 'workspace',
      root: './sources',
      path: 'sources/product-docs/product.md',
      uri: 'file://sources/product-docs/product.md',
      mediaType: 'text/markdown',
      sizeBytes: 128,
      hash: 'a'.repeat(64),
      route: 'markdown',
      status: 'routed',
      sourceRef: {
        sourceId: 'workspace',
        uri: 'file://sources/product-docs/product.md',
        location: { path: 'sources/product-docs/product.md' }
      }
    },
    {
      id: 'source-entry:favicon',
      sourceName: 'workspace',
      root: './sources',
      path: 'sources/repo/public/favicon.ico',
      uri: 'file://sources/repo/public/favicon.ico',
      mediaType: 'image/x-icon',
      sizeBytes: 64,
      hash: 'b'.repeat(64),
      route: 'unsupported',
      status: 'unsupported',
      unsupportedReason: 'adapter-not-configured',
      sourceRef: {
        sourceId: 'workspace',
        uri: 'file://sources/repo/public/favicon.ico',
        location: { path: 'sources/repo/public/favicon.ico' }
      }
    }
  ],
  groups: [
    {
      id: 'SOURCE-GROUP-docs',
      sourceName: 'workspace',
      path: 'sources/product-docs',
      title: 'Product docs',
      kind: 'doc_bundle',
      boundaryMode: 'collapsed',
      summary: 'Product documents',
      childrenPolicy: 'promote_routed',
      confidence: 0.9,
      decisionSource: 'agent',
      sourceRef: { sourceId: 'workspace', uri: 'file://sources/product-docs', location: { path: 'sources/product-docs' } }
    }
  ],
  packages: [
    {
      id: 'PACKAGE-docs',
      sourceName: 'workspace',
      path: 'sources/product-docs',
      title: '产品资料包: Product docs',
      kind: 'product_docs',
      summary: 'Product documents',
      sourceGroupIds: ['SOURCE-GROUP-docs'],
      buildUnits: [
        {
          id: 'unit:docs',
          kind: 'graphrag_corpus',
          standardKind: 'semantic_corpus',
          title: 'Product docs',
          sourceGroupIds: ['SOURCE-GROUP-docs'],
          adapterId: 'microsoft-graphrag.graph-adapter',
          adapterSelection: {
            adapterId: 'microsoft-graphrag.graph-adapter',
            role: 'semantic-graph-builder',
            selectionSource: 'default',
            selectionReason: 'Default semantic corpus adapter for doc_bundle source groups.',
            priority: 0
          },
          path: 'sources/product-docs',
          summary: 'Product documents'
        }
      ],
      confidence: 0.9,
      decisionSource: 'agent',
      sourceRef: { sourceId: 'workspace', uri: 'file://sources/product-docs', location: { path: 'sources/product-docs' } }
    }
  ],
  summary: { roots: 1, files: 2, packages: 1, groups: 1, routed: 1, inventoryOnly: 0, unsupported: 1, skipped: 0 }
}

const graph: ContextGraph = {
  nodes: [
    createContextNode({
      id: 'SOURCE-GROUP-docs',
      type: 'SourceGroup',
      name: 'Product docs',
      sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/product-docs', location: { path: 'sources/product-docs' } }],
      properties: { kind: 'doc_bundle', path: 'sources/product-docs', boundaryMode: 'collapsed' }
    }),
    createContextNode({
      id: 'REQ-product',
      type: 'Requirement',
      name: 'Product requirement',
      content: 'Requirement from product docs.',
      sourceRefs: [inventory.entries[0].sourceRef]
    })
  ],
  edges: [],
  diagnostics: []
}

describe('source-first workspace plans', () => {
  it('builds triage, group, workspace graph, scope build, and adapter plans from evidence-backed source data', () => {
    const plans = buildSourceFirstPlans({
      graph,
      sourceInventory: inventory,
      config: defineContextProject({ sources: [{ name: 'workspace', path: './sources' }] }, { rootDir: '/workspace' })
    })

    expect(plans.triage).toMatchObject({
      schemaVersion: 'context-source-triage.v1',
      summary: {
        routed: 1,
        unsupported: 1,
        adapterNeeded: 1
      }
    })
    expect(plans.sourceGroups.groups).toEqual([
      expect.objectContaining({
        id: 'SOURCE-GROUP-docs',
        kind: 'doc_bundle',
        boundaryMode: 'collapsed',
        adapterPlan: expect.arrayContaining([
          expect.objectContaining({
            adapterId: 'microsoft-graphrag.graph-adapter',
            role: 'semantic-graph-builder',
            selectionSource: 'default',
            selectionReason: expect.stringContaining('doc_bundle'),
            priority: 0
          })
        ])
      })
    ])
    expect(plans.workspaceGraph.scopeDAG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scopeId: 'scope:project', kind: 'project' }),
        expect.objectContaining({ scopeId: 'scope:package:PACKAGE-docs', kind: 'package', parentScopeId: 'scope:project' }),
        expect.objectContaining({ scopeId: 'scope:source-group:SOURCE-GROUP-docs', kind: 'source_group', parentScopeId: 'scope:package:PACKAGE-docs' })
      ])
    )
    expect(plans.scopeBuild.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeId: 'scope:package:PACKAGE-docs',
          adapters: expect.arrayContaining([expect.objectContaining({ adapterId: 'microsoft-graphrag.graph-adapter', selectionSource: 'default' })])
        }),
        expect.objectContaining({
          scopeId: 'scope:source-group:SOURCE-GROUP-docs',
          adapters: expect.arrayContaining([expect.objectContaining({ adapterId: 'microsoft-graphrag.graph-adapter', selectionSource: 'default' })])
        })
      ])
    )
    expect(plans.adapterPlan.adapters.map((adapter) => adapter.adapterId)).toEqual(
      expect.arrayContaining(['builtin.source-inventory', 'microsoft-graphrag.graph-adapter'])
    )
  })
})
