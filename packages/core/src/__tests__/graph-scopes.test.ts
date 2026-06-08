import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildContextIndexes } from '@context-compiler/core/runtime'
import { buildGraphScopes, writeGraphFiles } from '@context-compiler/core/graph'
import { createContextNode, type ContextGraph, type ContextSourceInventory } from '@context-compiler/core/sdk'

const sourceRef = {
  sourceId: 'workspace',
  uri: 'file://sources/product-docs/requirements.md',
  title: 'requirements.md',
  location: { path: 'sources/product-docs/requirements.md' }
}

const graph: ContextGraph = {
  nodes: [
    createContextNode({
      id: 'SOURCE-workspace',
      type: 'Source',
      name: 'workspace',
      sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources', location: { path: 'sources' } }],
      properties: { path: './sources', type: 'auto' }
    }),
    createContextNode({
      id: 'SOURCE-GROUP-workspace-sources-product-docs',
      type: 'SourceGroup',
      name: 'Product docs',
      sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/product-docs', location: { path: 'sources/product-docs' } }],
      properties: {
        kind: 'doc_bundle',
        path: 'sources/product-docs',
        boundaryMode: 'collapsed',
        summary: 'Product requirements and analysis notes',
        childrenPolicy: 'promote_routed'
      }
    }),
    createContextNode({
      id: 'REQ-checkout',
      type: 'Requirement',
      name: 'Checkout flow',
      content: 'Users can place orders.',
      sourceRefs: [sourceRef],
      properties: { sourceGroupId: 'SOURCE-GROUP-workspace-sources-product-docs' }
    })
  ],
  edges: [],
  diagnostics: []
}

const inventory: ContextSourceInventory = {
  schemaVersion: 'context-source-inventory.v1',
  entries: [
    {
      id: 'source-entry:req',
      sourceName: 'workspace',
      root: './sources',
      path: 'sources/product-docs/requirements.md',
      uri: 'file://sources/product-docs/requirements.md',
      mediaType: 'text/markdown',
      sizeBytes: 32,
      hash: 'a'.repeat(64),
      route: 'markdown',
      status: 'routed',
      sourceRef
    },
    {
      id: 'source-entry:ppt',
      sourceName: 'workspace',
      root: './sources',
      path: 'sources/product-docs/research.pptx',
      uri: 'file://sources/product-docs/research.pptx',
      mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 1024,
      hash: 'b'.repeat(64),
      route: 'unsupported',
      status: 'unsupported',
      unsupportedReason: 'adapter-not-configured',
      sourceRef: {
        sourceId: 'workspace',
        uri: 'file://sources/product-docs/research.pptx',
        title: 'research.pptx',
        location: { path: 'sources/product-docs/research.pptx' }
      }
    }
  ],
  groups: [
    {
      id: 'SOURCE-GROUP-workspace-sources-product-docs',
      sourceName: 'workspace',
      path: 'sources/product-docs',
      title: 'Product docs',
      kind: 'doc_bundle',
      boundaryMode: 'collapsed',
      summary: 'Product requirements and analysis notes',
      childrenPolicy: 'promote_routed',
      confidence: 0.9,
      decisionSource: 'agent',
      sourceRef: { sourceId: 'workspace', uri: 'file://sources/product-docs', location: { path: 'sources/product-docs' } }
    }
  ],
  summary: { roots: 1, files: 2, groups: 1, routed: 1, inventoryOnly: 0, unsupported: 1, skipped: 0 }
}

describe('graph scopes', () => {
  it('builds recursive scope metadata and expands collapsed source groups from source inventory', () => {
    const result = buildGraphScopes(graph, inventory)
    const projectScope = result.scopes.find((scope) => scope.kind === 'project')
    const groupScope = result.scopes.find((scope) => scope.sourceGroupId === 'SOURCE-GROUP-workspace-sources-product-docs')
    const reqFileNodeId = `FILE-${'a'.repeat(16)}`
    const pptFileNodeId = `FILE-${'b'.repeat(16)}`

    expect(projectScope).toMatchObject({
      id: 'scope:project',
      kind: 'project',
      title: 'Project Graph'
    })
    expect(groupScope).toMatchObject({
      kind: 'source_group',
      rootNodeId: 'SOURCE-GROUP-workspace-sources-product-docs',
      path: 'sources/product-docs',
      boundaryMode: 'collapsed',
      adapterRefs: expect.arrayContaining([
        expect.objectContaining({ adapterId: 'microsoft-graphrag.graph-adapter', role: 'semantic-graph-builder' })
      ])
    })

    const groupGraph = result.graphs.find((scopeGraph) => scopeGraph.scope.id === groupScope?.id)
    const fileScope = result.scopes.find((scope) => scope.kind === 'file' && scope.path === 'sources/product-docs/requirements.md')
    const unsupportedFileScope = result.scopes.find((scope) => scope.kind === 'file' && scope.path === 'sources/product-docs/research.pptx')
    const contentScope = result.scopes.find((scope) => scope.kind === 'content' && scope.path === 'sources/product-docs/requirements.md#content')

    expect(fileScope).toMatchObject({
      kind: 'file',
      parentScopeId: groupScope?.id,
      rootNodeId: reqFileNodeId,
      path: 'sources/product-docs/requirements.md'
    })
    expect(unsupportedFileScope).toMatchObject({
      kind: 'file',
      parentScopeId: groupScope?.id,
      rootNodeId: pptFileNodeId,
      path: 'sources/product-docs/research.pptx'
    })
    expect(contentScope).toMatchObject({
      kind: 'content',
      parentScopeId: fileScope?.id,
      path: 'sources/product-docs/requirements.md#content'
    })
    expect(groupGraph?.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['SOURCE-GROUP-workspace-sources-product-docs', 'REQ-checkout', reqFileNodeId, pptFileNodeId])
    )
    expect(groupGraph?.graph.nodes.some((node) => node.type === 'SourceSnapshot')).toBe(false)
    expect(groupGraph?.graph.nodes.find((node) => node.id === pptFileNodeId)).toMatchObject({
      type: 'File',
      scopeId: groupScope?.id,
      subgraphRef: `.context/graph/scopes/scope-file-source-entry-ppt`,
      properties: {
        path: 'sources/product-docs/research.pptx',
        status: 'unsupported',
        unsupportedReason: 'adapter-not-configured',
        fileScopeId: unsupportedFileScope?.id
      }
    })
    expect(groupGraph?.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'has_child_scope',
          from: 'SOURCE-GROUP-workspace-sources-product-docs',
          to: reqFileNodeId,
          properties: expect.objectContaining({ childScopeId: fileScope?.id })
        }),
        expect.objectContaining({
          type: 'has_child_scope',
          from: 'SOURCE-GROUP-workspace-sources-product-docs',
          to: pptFileNodeId,
          properties: expect.objectContaining({ childScopeId: unsupportedFileScope?.id })
        }),
        expect.objectContaining({
          type: 'derived_from',
          from: 'REQ-checkout',
          to: reqFileNodeId,
          evidence: expect.arrayContaining([expect.objectContaining({ type: 'explicit_reference' })])
        })
      ])
    )

    const fileGraph = result.graphs.find((scopeGraph) => scopeGraph.scope.id === fileScope?.id)
    expect(fileGraph?.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([reqFileNodeId, `SNAPSHOT-${'a'.repeat(16)}`, 'REQ-checkout'])
    )
    expect(fileGraph?.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'contains_snapshot',
          from: reqFileNodeId,
          to: `SNAPSHOT-${'a'.repeat(16)}`
        }),
        expect.objectContaining({
          type: 'has_child_scope',
          from: reqFileNodeId,
          properties: expect.objectContaining({ childScopeId: contentScope?.id })
        })
      ])
    )
  })

  it('writes scope graph files and per-scope index projections', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'context-graph-scopes-'))
    await writeGraphFiles(graph, outputDir, { sourceInventory: inventory })

    const manifest = JSON.parse(await readFile(join(outputDir, 'graph', 'scopes', 'manifest.json'), 'utf8')) as {
      scopes: Array<{ id: string; nodes: string; edges: string; summary: string }>
    }
    const groupScope = manifest.scopes.find((scope) => scope.id.includes('source-group'))

    expect(groupScope).toBeDefined()
    expect(groupScope?.nodes).toMatch(/\.context\/graph\/scopes\/.+\/nodes\.jsonl/)
    const nodesPath = join(outputDir, groupScope!.nodes.replace('.context/', ''))
    const nodes = (await readFile(nodesPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { id: string })
    expect(nodes.map((node) => node.id)).toContain(`FILE-${'b'.repeat(16)}`)
    expect(nodes.map((node) => node.id)).not.toContain(`SNAPSHOT-${'b'.repeat(16)}`)

    const indexes = buildContextIndexes(graph, { sourceInventory: inventory })
    const scopedIndex = indexes.scopes.find((scope) => scope.scope.id === groupScope?.id)
    expect(scopedIndex?.indexes.fts.map((entry) => entry.id)).toEqual(expect.arrayContaining(['REQ-checkout']))
    expect(scopedIndex?.indexes.graph.map((entry) => entry.id)).toEqual(expect.arrayContaining([`FILE-${'b'.repeat(16)}`]))
  })

  it('keeps unknown packages drillable with inventory-only adapter refs', () => {
    const unknownInventory: ContextSourceInventory = {
      ...inventory,
      groups: [
        {
          id: 'SOURCE-GROUP-unknown',
          sourceName: 'workspace',
          path: 'sources/misc',
          title: '未知资料包',
          kind: 'unknown',
          boundaryMode: 'collapsed',
          summary: 'Unclassified materials',
          childrenPolicy: 'promote_routed',
          confidence: 0.35,
          decisionSource: 'inferred',
          sourceRef: { sourceId: 'workspace', uri: 'file://sources/misc', location: { path: 'sources/misc' } }
        }
      ],
      packages: [
        {
          id: 'PACKAGE-unknown',
          sourceName: 'workspace',
          path: 'sources/misc',
          title: '未知包: 未知资料包',
          kind: 'unknown',
          summary: 'Unclassified materials',
          sourceGroupIds: ['SOURCE-GROUP-unknown'],
          buildUnits: [
            {
              id: 'unit:unknown',
              kind: 'inventory',
              standardKind: 'inventory',
              title: '未知资料包',
              sourceGroupIds: ['SOURCE-GROUP-unknown'],
              adapterId: 'builtin.source-inventory',
              adapterSelection: {
                adapterId: 'builtin.source-inventory',
                role: 'inventory',
                selectionSource: 'default',
                selectionReason: 'Default inventory-only adapter for unknown source groups.',
                priority: 0
              },
              path: 'sources/misc',
              summary: 'Unclassified materials'
            }
          ],
          confidence: 0.35,
          decisionSource: 'inferred',
          sourceRef: { sourceId: 'workspace', uri: 'file://sources/misc', location: { path: 'sources/misc' } }
        }
      ],
      summary: { ...inventory.summary, packages: 1, groups: 1 }
    }
    const unknownGraph: ContextGraph = {
      nodes: [
        createContextNode({
          id: 'SOURCE-GROUP-unknown',
          type: 'SourceGroup',
          name: '未知资料包',
          sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/misc', location: { path: 'sources/misc' } }],
          properties: { kind: 'unknown', path: 'sources/misc', boundaryMode: 'collapsed' }
        })
      ],
      edges: [],
      diagnostics: []
    }

    const result = buildGraphScopes(unknownGraph, unknownInventory)
    const packageScope = result.scopes.find((scope) => scope.rootNodeId === 'PACKAGE-unknown')
    const groupScope = result.scopes.find((scope) => scope.sourceGroupId === 'SOURCE-GROUP-unknown')

    expect(packageScope).toMatchObject({
      kind: 'package',
      parentScopeId: 'scope:project',
      adapterRefs: [expect.objectContaining({ adapterId: 'builtin.source-inventory', role: 'inventory' })]
    })
    expect(groupScope).toMatchObject({
      kind: 'source_group',
      parentScopeId: packageScope?.id,
      adapterRefs: [expect.objectContaining({ adapterId: 'builtin.source-inventory', role: 'inventory' })]
    })
  })
})
