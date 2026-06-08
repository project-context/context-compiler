import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  buildGraphViewerOverview,
  createContextEdge,
  createContextNode,
  inspectGraphViewerTarget,
  searchGraphViewer,
  writeGraphFiles,
  type ContextGraph,
  type ContextSourceInventory
} from '@context-compiler/core'

const execFileAsync = promisify(execFile)

const docRef = {
  sourceId: 'workspace',
  uri: 'file://sources/product-docs/product.md',
  location: { path: 'sources/product-docs/product.md', lineStart: 1 }
}

const codeRef = {
  sourceId: 'workspace',
  uri: 'file://sources/mjsbt-manage-fe/src/services/benefitManage/index.ts',
  location: { path: 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts', lineStart: 57 }
}

function graphFixture(): ContextGraph {
  return {
    nodes: [
      createContextNode({ id: 'PROJECT-demo', type: 'Project', name: 'Demo Project' }),
      createContextNode({
        id: 'PACKAGE-product-docs',
        type: 'Package',
        name: '产品资料包: product-docs',
        sourceRefs: [docRef],
        properties: { packageKind: 'product_docs', sourceGroupIds: ['SOURCE-GROUP-docs'] }
      }),
      createContextNode({
        id: 'PACKAGE-code-repo',
        type: 'Package',
        name: '代码仓库包: mjsbt-manage-fe',
        sourceRefs: [codeRef],
        properties: { packageKind: 'code_repository', sourceGroupIds: ['SOURCE-GROUP-repo'] }
      }),
      createContextNode({
        id: 'SOURCE-GROUP-docs',
        type: 'SourceGroup',
        name: 'product-docs',
        sourceRefs: [docRef],
        properties: { kind: 'doc_bundle', path: 'sources/product-docs', summary: 'Product docs.' }
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
      }),
      createContextNode({
        id: 'SNAPSHOT-product-md',
        type: 'SourceSnapshot',
        name: 'product.md',
        sourceRefs: [docRef],
        properties: { path: 'sources/product-docs/product.md' }
      })
    ],
    edges: [
      createContextEdge({ id: 'EDGE-project-docs', from: 'PROJECT-demo', to: 'SOURCE-GROUP-docs', type: 'contains_group', linker: 'test' }),
      createContextEdge({ id: 'EDGE-project-repo', from: 'PROJECT-demo', to: 'SOURCE-GROUP-repo', type: 'contains_group', linker: 'test' }),
      createContextEdge({ id: 'EDGE-project-product-package', from: 'PROJECT-demo', to: 'PACKAGE-product-docs', type: 'contains_package', linker: 'test' }),
      createContextEdge({ id: 'EDGE-project-code-package', from: 'PROJECT-demo', to: 'PACKAGE-code-repo', type: 'contains_package', linker: 'test' }),
      createContextEdge({ id: 'EDGE-product-package-docs-group', from: 'PACKAGE-product-docs', to: 'SOURCE-GROUP-docs', type: 'contains_source_group', linker: 'test' }),
      createContextEdge({ id: 'EDGE-code-package-repo-group', from: 'PACKAGE-code-repo', to: 'SOURCE-GROUP-repo', type: 'contains_source_group', linker: 'test' }),
      createContextEdge({
        id: 'EDGE-docs-related-repo',
        from: 'SOURCE-GROUP-docs',
        to: 'SOURCE-GROUP-repo',
        type: 'related_to_group',
        linker: 'test',
        evidence: [{ type: 'semantic_match', description: 'Docs and repo mention upload.', sourceRefs: [docRef, codeRef] }]
      }),
      createContextEdge({
        id: 'EDGE-upload-calls-request',
        from: 'SYM-index-ts-uploadFileAPI',
        to: 'SOURCE-GROUP-repo',
        type: 'calls',
        linker: 'codegraph.graph-adapter',
        evidence: [{ type: 'explicit_reference', description: 'uploadFileAPI calls request.', sourceRefs: [codeRef] }]
      })
    ],
    diagnostics: []
  }
}

function inventoryFixture(): ContextSourceInventory {
  return {
    schemaVersion: 'context-source-inventory.v1',
    entries: [
      {
        id: 'source-entry-product',
        sourceName: 'workspace',
        root: './sources',
        path: 'sources/product-docs/product.md',
        uri: docRef.uri,
        mediaType: 'text/markdown',
        sizeBytes: 80,
        hash: 'a'.repeat(64),
        route: 'markdown',
        status: 'routed',
        sourceRef: docRef
      },
      {
        id: 'source-entry-upload',
        sourceName: 'workspace',
        root: './sources',
        path: 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts',
        uri: codeRef.uri,
        mediaType: 'text/typescript',
        sizeBytes: 120,
        hash: 'b'.repeat(64),
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
        title: 'product-docs',
        kind: 'doc_bundle',
        boundaryMode: 'collapsed',
        summary: 'Product docs.',
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

describe('graph viewer runtime', () => {
  it('builds a level-0 package directory without source-group internals or cross-package links', async () => {
    const outputDir = await createContextOutput()

    const overview = await buildGraphViewerOverview({ outputDir })

    expect(overview.schemaVersion).toBe('context-graph-viewer-overview.v1')
    expect(overview.elements.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'scope:project',
      'PACKAGE-product-docs',
      'PACKAGE-code-repo'
    ]))
    expect(overview.elements.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(['ProjectGraph', 'PackageGraph']))
    expect(overview.elements.nodes.map((node) => node.type)).not.toContain('SourceGroupGraph')
    expect(overview.elements.nodes.map((node) => node.id).some((id) => id.startsWith('viewer-layer:'))).toBe(false)
    expect(overview.elements.nodes.map((node) => node.type)).not.toEqual(expect.arrayContaining([
      'FileGraphLayer',
      'ContentGraphLayer',
      'FactGraphLayer',
      'RuntimeGraphLayer'
    ]))
    expect(overview.elements.nodes.some((node) => node.type === 'SourceSnapshot' || node.type === 'CodeSymbol')).toBe(false)
    expect(overview.elements.edges.some((edge) => edge.type === 'related_to_group')).toBe(false)
    expect(overview.elements.edges).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'EDGE-project-code-package', type: 'contains_package' })]))
    expect(overview.elements.nodes.find((node) => node.id === 'PACKAGE-code-repo')).toMatchObject({
      type: 'PackageGraph',
      label: '代码仓库包: mjsbt-manage-fe',
      styleHints: expect.objectContaining({ color: expect.any(String), shape: expect.any(String) }),
      rawRef: { factKind: 'node', factId: 'PACKAGE-code-repo', scopeId: 'scope:package:PACKAGE-code-repo' }
    })
  })

  it('aggregates expand, trace, and explain data for node inspection', async () => {
    const outputDir = await createContextOutput()

    const inspection = await inspectGraphViewerTarget({ outputDir, targetId: 'SYM-index-ts-uploadFileAPI' })

    expect(inspection).toMatchObject({
      schemaVersion: 'context-graph-viewer-inspect.v1',
      targetId: 'SYM-index-ts-uploadFileAPI',
      targetKind: 'node',
      expansion: expect.objectContaining({
        facts: expect.arrayContaining([expect.objectContaining({ id: 'SYM-index-ts-uploadFileAPI' })])
      }),
      trace: expect.objectContaining({
        sourceRefs: expect.arrayContaining([expect.objectContaining({ uri: codeRef.uri })])
      }),
      explanation: expect.objectContaining({
        factId: 'SYM-index-ts-uploadFileAPI'
      })
    })
  })

  it('searches through SQLite first and maps hydrated results to viewer node elements', async () => {
    const outputDir = await createContextOutput()
    await writeFtsIndex(join(outputDir, 'indexes', 'global', 'fts.sqlite'), [
      { id: 'SYM-index-ts-uploadFileAPI', text: 'uploadFileAPI /config/uploadFile' }
    ])

    const result = await searchGraphViewer({ outputDir, query: 'uploadFileAPI' })

    expect(result.engine).toBe('sqlite')
    expect(result.results).toEqual([
      expect.objectContaining({ id: 'SYM-index-ts-uploadFileAPI', type: 'CodeSymbol', label: 'uploadFileAPI' })
    ])
  })
})

async function createContextOutput(): Promise<string> {
  const outputDir = await mkdtemp(join(tmpdir(), 'context-viewer-runtime-'))
  await writeGraphFiles(graphFixture(), outputDir, { sourceInventory: inventoryFixture() })
  return outputDir
}

async function writeFtsIndex(path: string, rows: Array<{ id: string; text: string }>): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await rm(path, { force: true })
  const inserts = rows.map((row) => `INSERT INTO fts_text (id, text) VALUES (${sql(row.id)}, ${sql(row.text)});`).join('\n')
  await execFileAsync('sqlite3', [
    path,
    [
      'CREATE TABLE fts (id TEXT PRIMARY KEY, data TEXT NOT NULL);',
      'CREATE VIRTUAL TABLE fts_text USING fts5(id, text);',
      inserts
    ].join('\n')
  ])
}

function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
