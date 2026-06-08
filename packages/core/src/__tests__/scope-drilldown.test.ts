import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createContextEdge,
  createContextNode,
  getGraphScopeView,
  expandGraphTarget,
  getLayeredSourceTrace,
  scopeIdForSourceGroup,
  writeGraphFiles,
  type ContextGraph,
  type ContextSourceInventory
} from '@context-compiler/core'

const docRef = {
  sourceId: 'workspace',
  uri: 'file://sources/product-docs/product.md',
  location: { path: 'sources/product-docs/product.md', lineStart: 1 }
}

const codeRef = {
  sourceId: 'workspace',
  uri: 'file://sources/mjsbt-manage-fe/src/services/benefitManage/index.ts',
  location: { path: 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts', lineStart: 12 }
}

function seedGraph(): ContextGraph {
  return {
    nodes: [
      createContextNode({ id: 'PROJECT-demo', type: 'Project', name: 'Demo Project' }),
      createContextNode({
        id: 'SOURCE-GROUP-docs',
        type: 'SourceGroup',
        name: 'Product Docs',
        sourceRefs: [docRef],
        properties: { kind: 'doc_bundle', path: 'sources/product-docs', summary: 'Product documentation bundle.' }
      }),
      createContextNode({
        id: 'SOURCE-GROUP-repo',
        type: 'SourceGroup',
        name: 'mjsbt-manage-fe',
        sourceRefs: [codeRef],
        properties: { kind: 'repository', path: 'sources/mjsbt-manage-fe', summary: 'Frontend repository.' }
      }),
      createContextNode({
        id: 'MARKDOWN-DOC',
        type: 'Requirement',
        name: '商保通产品资料',
        sourceRefs: [docRef],
        properties: { content: '产品资料说明上传医院、保险和权益配置。' }
      }),
      createContextNode({
        id: 'SYM-index-ts-uploadFileAPI',
        type: 'CodeSymbol',
        name: 'uploadFileAPI',
        sourceRefs: [codeRef],
        properties: { kind: 'function', requestCalls: [{ path: '/config/uploadFile', method: 'POST' }] }
      })
    ],
    edges: [
      createContextEdge({
        id: 'EDGE-docs-related-repo',
        from: 'SOURCE-GROUP-docs',
        to: 'SOURCE-GROUP-repo',
        type: 'related_to_group',
        linker: 'test',
        evidence: [{ type: 'semantic_match', description: 'Docs and repo mention upload.', sourceRefs: [docRef, codeRef] }]
      })
    ],
    diagnostics: []
  }
}

function seedInventory(): ContextSourceInventory {
  return {
    schemaVersion: 'context-source-inventory.v1',
    entries: [
      {
        id: 'INV-doc-product',
        sourceName: 'workspace',
        root: './sources',
        path: 'sources/product-docs/product.md',
        uri: docRef.uri,
        mediaType: 'text/markdown',
        sizeBytes: 64,
        hash: '1111111111111111111111111111111111111111111111111111111111111111',
        route: 'markdown',
        status: 'routed',
        sourceRef: docRef
      },
      {
        id: 'INV-code-upload',
        sourceName: 'workspace',
        root: './sources',
        path: 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts',
        uri: codeRef.uri,
        mediaType: 'text/typescript',
        sizeBytes: 128,
        hash: '2222222222222222222222222222222222222222222222222222222222222222',
        route: 'code',
        status: 'routed',
        sourceRef: codeRef
      }
    ],
    groups: [
      {
        id: 'SOURCE-GROUP-docs',
        sourceName: 'workspace',
        path: 'sources/product-docs',
        title: 'Product Docs',
        kind: 'doc_bundle',
        boundaryMode: 'collapsed',
        summary: 'Product documentation bundle.',
        confidence: 0.9,
        decisionSource: 'agent',
        sourceRef: docRef
      },
      {
        id: 'SOURCE-GROUP-repo',
        sourceName: 'workspace',
        path: 'sources/mjsbt-manage-fe',
        title: 'mjsbt-manage-fe',
        kind: 'repository',
        boundaryMode: 'repository',
        summary: 'Frontend repository.',
        confidence: 0.9,
        decisionSource: 'agent',
        sourceRef: codeRef
      }
    ],
    summary: { roots: 1, files: 2, groups: 2, routed: 2, inventoryOnly: 0, unsupported: 0, skipped: 0 }
  }
}

describe('scope drill-down runtime', () => {
  it('hydrates budgeted scope views, expansions, and layered source traces from emitted graph scopes', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'context-scope-drilldown-'))
    await writeGraphFiles(seedGraph(), outputDir, { sourceInventory: seedInventory() })

    const docScopeId = scopeIdForSourceGroup('SOURCE-GROUP-docs')
    const repoScopeId = scopeIdForSourceGroup('SOURCE-GROUP-repo')

    const scope = await getGraphScopeView({ outputDir, scopeId: docScopeId, limitNodes: 3, limitEdges: 4 })
    expect(scope).toMatchObject({
      schemaVersion: 'context-graph-scope-view.v1',
      scope: expect.objectContaining({ id: docScopeId, kind: 'source_group', rootNodeId: 'SOURCE-GROUP-docs' }),
      rootNode: expect.objectContaining({ id: 'SOURCE-GROUP-docs' }),
      budget: expect.objectContaining({ mode: 'summary', nodes: 3, edges: 4 }),
      relatedScopes: expect.arrayContaining([expect.objectContaining({ id: repoScopeId })])
    })
    expect(scope.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(['SourceGroup', 'Requirement', 'File']))
    expect(scope.nodes.some((node) => node.type === 'SourceSnapshot')).toBe(false)
    expect(scope.nextActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'open_scope', targetId: repoScopeId })]))

    const groupExpansion = await expandGraphTarget({ outputDir, targetId: 'SOURCE-GROUP-docs' })
    expect(groupExpansion).toMatchObject({
      schemaVersion: 'context-graph-expansion.v1',
      targetKind: 'node',
      target: { id: 'SOURCE-GROUP-docs' },
      scopePath: expect.arrayContaining([expect.objectContaining({ id: 'scope:project' }), expect.objectContaining({ id: docScopeId })]),
      nextActions: expect.arrayContaining([expect.objectContaining({ type: 'open_scope', targetId: repoScopeId })])
    })
    expect(groupExpansion.edges).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'EDGE-docs-related-repo' })]))

    const symbolExpansion = await expandGraphTarget({ outputDir, targetId: 'SYM-index-ts-uploadFileAPI', depth: 1 })
    expect(symbolExpansion.scopePath).toEqual(expect.arrayContaining([expect.objectContaining({ id: repoScopeId })]))
    expect(symbolExpansion.sourceTrace?.files).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'File' })]))
    expect(symbolExpansion.sourceTrace?.contentNodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'SYM-index-ts-uploadFileAPI' })]))

    const trace = await getLayeredSourceTrace({ outputDir, factId: 'MARKDOWN-DOC', limitSources: 1 })
    expect(trace).toMatchObject({
      schemaVersion: 'context-layered-source-trace.v1',
      fact: expect.objectContaining({ id: 'MARKDOWN-DOC' }),
      sourceGroups: expect.arrayContaining([expect.objectContaining({ id: 'SOURCE-GROUP-docs' })]),
      scopes: expect.arrayContaining([
        expect.objectContaining({ id: docScopeId }),
        expect.objectContaining({ kind: 'file' }),
        expect.objectContaining({ kind: 'content' })
      ]),
      files: expect.arrayContaining([expect.objectContaining({ type: 'File' })]),
      contentNodes: expect.arrayContaining([expect.objectContaining({ id: 'MARKDOWN-DOC' })]),
      sourceRefs: [expect.objectContaining({ uri: docRef.uri })]
    })
    expect(trace.budget).toMatchObject({ mode: 'summary', sourceRefs: 1 })
    expect(trace.omitted.sourceRefs).toBe(0)
  })
})
