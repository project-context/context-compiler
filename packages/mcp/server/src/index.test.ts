import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { callContextMcpTool } from './index.js'

describe('context MCP graph scopes', () => {
  it('lists, reads, expands, and searches graph scopes from emitted .context files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-scopes-'))
    const outputDir = join(rootDir, '.context')
    const packageScopeId = 'scope:package:docs'
    const groupScopeId = 'scope:source-group:docs'
    await mkdir(join(outputDir, 'graph', 'global'), { recursive: true })
    await mkdir(join(outputDir, 'graph', 'scopes', 'scope-package-docs'), { recursive: true })
    await mkdir(join(outputDir, 'graph', 'scopes', 'scope-source-group-docs'), { recursive: true })
    await mkdir(join(outputDir, 'runtime'), { recursive: true })
    await mkdir(join(outputDir, 'mcp'), { recursive: true })
    await mkdir(join(outputDir, 'diagnostics'), { recursive: true })
    await mkdir(join(outputDir, 'sources'), { recursive: true })
    await writeFile(join(rootDir, 'context.config.json'), `${JSON.stringify({ sources: [{ name: 'workspace', path: './sources' }] }, null, 2)}\n`)

    const packageNode = {
      id: 'PACKAGE-docs',
      type: 'Package',
      name: 'Product Docs',
      sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/docs', location: { path: 'sources/docs' } }],
      status: 'active',
      authority: 'source_of_truth',
      confidence: 0.9,
      tags: [],
      properties: { path: 'sources/docs', packageKind: 'product_docs', sourceGroupIds: ['SOURCE-GROUP-docs'] },
      fingerprint: 'package'
    }
    const groupNode = {
      id: 'SOURCE-GROUP-docs',
      type: 'SourceGroup',
      name: 'Docs',
      sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/docs', location: { path: 'sources/docs' } }],
      status: 'active',
      authority: 'source_of_truth',
      confidence: 0.9,
      tags: [],
      properties: { path: 'sources/docs', kind: 'doc_bundle' },
      fingerprint: 'group'
    }
    const requirement = {
      id: 'REQ-docs-checkout',
      type: 'Requirement',
      name: 'Checkout docs',
      scopeId: groupScopeId,
      sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/docs/checkout.md', location: { path: 'sources/docs/checkout.md' } }],
      status: 'active',
      authority: 'source_of_truth',
      confidence: 0.9,
      tags: [],
      properties: { content: 'Checkout requirement' },
      fingerprint: 'req'
    }
    const scopeManifest = {
      schemaVersion: 'context-graph-scopes.v1',
      generatedAt: '2026-06-04T00:00:00.000Z',
      scopes: [
        {
          id: packageScopeId,
          kind: 'package',
          parentScopeId: 'scope:project',
          rootNodeId: 'PACKAGE-docs',
          packageId: 'PACKAGE-docs',
          path: 'sources/docs',
          title: 'Product Docs',
          adapterRefs: [{ adapterId: 'microsoft-graphrag.graph-adapter', role: 'semantic-graph-builder' }],
          stats: { nodes: 2, edges: 1, diagnostics: 0, files: 1, groups: 1 },
          freshness: { status: 'fresh' },
          indexRefs: {},
          nodes: '.context/graph/scopes/scope-package-docs/nodes.jsonl',
          edges: '.context/graph/scopes/scope-package-docs/edges.jsonl',
          summary: '.context/graph/scopes/scope-package-docs/summary.json'
        },
        {
          id: groupScopeId,
          kind: 'source_group',
          parentScopeId: packageScopeId,
          packageId: 'PACKAGE-docs',
          rootNodeId: 'SOURCE-GROUP-docs',
          sourceGroupId: 'SOURCE-GROUP-docs',
          path: 'sources/docs',
          title: 'Docs',
          adapterRefs: [{ adapterId: 'builtin.markdown-text', role: 'semantic-graph-builder' }],
          stats: { nodes: 2, edges: 0, diagnostics: 0, files: 1, groups: 1 },
          freshness: { status: 'fresh' },
          indexRefs: {},
          nodes: '.context/graph/scopes/scope-source-group-docs/nodes.jsonl',
          edges: '.context/graph/scopes/scope-source-group-docs/edges.jsonl',
          summary: '.context/graph/scopes/scope-source-group-docs/summary.json'
        }
      ],
      adapters: []
    }

    const packageEdge = {
      id: 'EDGE-PACKAGE-docs-SOURCE-GROUP-docs',
      from: 'PACKAGE-docs',
      to: 'SOURCE-GROUP-docs',
      type: 'contains_source_group',
      confidence: 1,
      evidence: [],
      status: 'confirmed',
      properties: {},
      fingerprint: 'package-edge'
    }
    const groupRecord = {
      id: 'SOURCE-GROUP-docs',
      sourceName: 'workspace',
      path: 'sources/docs',
      title: 'Docs',
      kind: 'doc_bundle',
      boundaryMode: 'collapsed',
      summary: 'Docs',
      confidence: 0.9,
      decisionSource: 'agent',
      sourceRef: { sourceId: 'workspace', uri: 'file://sources/docs', location: { path: 'sources/docs' } }
    }
    const buildUnit = {
      id: 'unit:PACKAGE-docs',
      kind: 'graphrag_corpus',
      standardKind: 'semantic_corpus',
      title: 'Product Docs',
      sourceGroupIds: ['SOURCE-GROUP-docs'],
      adapterId: 'microsoft-graphrag.graph-adapter',
      adapterSelection: {
        adapterId: 'microsoft-graphrag.graph-adapter',
        role: 'semantic-graph-builder',
        selectionSource: 'default',
        selectionReason: 'Default semantic corpus adapter for doc_bundle source groups.',
        candidateAdapterIds: ['microsoft-graphrag.graph-adapter']
      },
      path: 'sources/docs'
    }
    const packageRecord = {
      id: 'PACKAGE-docs',
      sourceName: 'workspace',
      path: 'sources/docs',
      title: 'Product Docs',
      kind: 'product_docs',
      summary: 'Docs package',
      sourceGroupIds: ['SOURCE-GROUP-docs'],
      buildUnits: [buildUnit],
      confidence: 0.9,
      decisionSource: 'agent',
      sourceRef: { sourceId: 'workspace', uri: 'file://sources/docs', location: { path: 'sources/docs' } }
    }
    const inventoryEntry = {
      id: 'INV-doc',
      sourceName: 'workspace',
      root: './sources',
      path: 'sources/docs/checkout.md',
      uri: 'file://sources/docs/checkout.md',
      mediaType: 'text/markdown',
      sizeBytes: 64,
      hash: 'inv-doc',
      route: 'markdown',
      status: 'routed',
      sourceRef: { sourceId: 'workspace', uri: 'file://sources/docs/checkout.md', location: { path: 'sources/docs/checkout.md' } }
    }

    await writeJsonl(join(outputDir, 'graph', 'global', 'nodes.jsonl'), [packageNode, groupNode, requirement])
    await writeJsonl(join(outputDir, 'graph', 'global', 'edges.jsonl'), [packageEdge])
    await writeJsonl(join(outputDir, 'graph', 'global', 'diagnostics.jsonl'), [])
    await writeJsonl(join(outputDir, 'graph', 'scopes', 'scope-package-docs', 'nodes.jsonl'), [packageNode, groupNode])
    await writeJsonl(join(outputDir, 'graph', 'scopes', 'scope-package-docs', 'edges.jsonl'), [packageEdge])
    await writeFile(join(outputDir, 'graph', 'scopes', 'scope-package-docs', 'summary.json'), `${JSON.stringify({ scope: scopeManifest.scopes[0] }, null, 2)}\n`)
    await writeJsonl(join(outputDir, 'graph', 'scopes', 'scope-source-group-docs', 'nodes.jsonl'), [groupNode, requirement])
    await writeJsonl(join(outputDir, 'graph', 'scopes', 'scope-source-group-docs', 'edges.jsonl'), [])
    await writeFile(join(outputDir, 'graph', 'scopes', 'scope-source-group-docs', 'summary.json'), `${JSON.stringify({ scope: scopeManifest.scopes[1] }, null, 2)}\n`)
    await writeFile(join(outputDir, 'graph', 'scopes', 'manifest.json'), `${JSON.stringify(scopeManifest, null, 2)}\n`)
    await writeJsonl(join(outputDir, 'sources', 'inventory.jsonl'), [inventoryEntry])
    await writeJsonl(join(outputDir, 'sources', 'groups.jsonl'), [groupRecord])
    await writeJsonl(join(outputDir, 'sources', 'packages.jsonl'), [packageRecord])
    await writeJsonl(join(outputDir, 'sources', 'build-units.jsonl'), [buildUnit])
    await writeFile(join(outputDir, 'sources', 'summary.json'), `${JSON.stringify({ roots: 1, files: 1, packages: 1, groups: 1, routed: 1, inventoryOnly: 0, unsupported: 0, skipped: 0 }, null, 2)}\n`)
    await writeFile(join(outputDir, 'runtime', 'runtime.config.json'), `${JSON.stringify({ tools: [] }, null, 2)}\n`)
    await writeFile(
      join(outputDir, 'mcp', 'tools.json'),
      `${JSON.stringify(
        [
          { name: 'list_context_packages', description: 'List packages', safety: 'read_only' },
          { name: 'get_context_package', description: 'Get package', safety: 'read_only' },
          { name: 'expand_context_package', description: 'Expand package', safety: 'read_only' },
          { name: 'search_context_package', description: 'Search package', safety: 'read_only' },
          { name: 'list_graph_scopes', description: 'List scopes', safety: 'read_only' },
          { name: 'get_graph_scope', description: 'Get scope', safety: 'read_only' },
          { name: 'expand_graph_scope', description: 'Expand scope', safety: 'read_only' },
          { name: 'expand_graph_target', description: 'Expand target', safety: 'read_only' },
          { name: 'search_context', description: 'Search', safety: 'read_only' }
        ],
        null,
        2
      )}\n`
    )
    await writeFile(join(outputDir, 'runtime', 'run-summary.json'), `${JSON.stringify({ freshness: { status: 'fresh' } }, null, 2)}\n`)
    await writeFile(join(outputDir, 'diagnostics', 'context-health.json'), `${JSON.stringify({ status: 'healthy' }, null, 2)}\n`)

    const scopes = await callContextMcpTool(rootDir, 'list_graph_scopes')
    expect(scopes).toMatchObject({ data: { scopes: expect.arrayContaining([expect.objectContaining({ id: groupScopeId, kind: 'source_group' })]) } })

    const packages = await callContextMcpTool(rootDir, 'list_context_packages')
    expect(packages).toMatchObject({
      data: {
        schemaVersion: 'context-package-list.v1',
        packages: [expect.objectContaining({ package: expect.objectContaining({ id: 'PACKAGE-docs' }) })]
      }
    })

    const packageView = await callContextMcpTool(rootDir, 'get_context_package', { packageRef: 'sources/docs' })
    expect(packageView).toMatchObject({
      data: {
        schemaVersion: 'context-package-view.v1',
        scope: expect.objectContaining({ id: packageScopeId }),
        buildUnits: [expect.objectContaining({ adapterId: 'microsoft-graphrag.graph-adapter', inventoryOnly: false })]
      }
    })

    const packageExpansion = await callContextMcpTool(rootDir, 'expand_context_package', { packageRef: 'PACKAGE-docs', mode: 'full' })
    expect(packageExpansion).toMatchObject({
      data: {
        schemaVersion: 'context-package-expansion.v1',
        facts: expect.arrayContaining([expect.objectContaining({ id: 'REQ-docs-checkout' })])
      }
    })

    const packageSearch = await callContextMcpTool(rootDir, 'search_context_package', { packageRef: 'Product Docs', query: 'checkout' })
    expect(packageSearch).toMatchObject({
      data: {
        schemaVersion: 'context-package-search.v1',
        results: [expect.objectContaining({ id: 'REQ-docs-checkout' })]
      }
    })

    const scope = await callContextMcpTool(rootDir, 'get_graph_scope', { scopeId: groupScopeId })
    expect(scope).toMatchObject({ data: { scope: expect.objectContaining({ id: groupScopeId, title: 'Docs' }) } })

    const expanded = await callContextMcpTool(rootDir, 'expand_graph_scope', { scopeId: groupScopeId })
    expect(expanded).toMatchObject({ data: { nodes: [expect.objectContaining({ id: 'SOURCE-GROUP-docs' }), expect.objectContaining({ id: 'REQ-docs-checkout' })] } })

    const target = await callContextMcpTool(rootDir, 'expand_graph_target', { targetId: 'REQ-docs-checkout' })
    expect(target).toMatchObject({
      data: {
        targetKind: 'node',
        target: expect.objectContaining({ id: 'REQ-docs-checkout' }),
        facts: expect.arrayContaining([expect.objectContaining({ id: 'REQ-docs-checkout' })])
      }
    })

    const search = await callContextMcpTool(rootDir, 'search_context', { query: 'checkout', scopeId: groupScopeId })
    expect(search).toMatchObject({ data: { results: [expect.objectContaining({ id: 'REQ-docs-checkout' })] } })
  })
})

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''))
}
