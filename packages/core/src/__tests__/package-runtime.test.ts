import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandContextPackage, getContextPackage, listContextPackages, searchContextPackage } from '@context-compiler/core/runtime'
import { scopeIdForPackage, scopeIdForSourceGroup, writeGraphFiles } from '@context-compiler/core/graph'
import { createContextEdge, createContextNode, type ContextGraph, type ContextPackageRecord, type ContextSourceGroupRecord, type ContextSourceInventory } from '@context-compiler/core/sdk'

const docRef = { sourceId: 'workspace', uri: 'file://sources/product-docs/product.md', location: { path: 'sources/product-docs/product.md' } }
const codeRef = { sourceId: 'workspace', uri: 'file://sources/repo/src/upload.ts', location: { path: 'sources/repo/src/upload.ts' } }
const unknownRef = { sourceId: 'workspace', uri: 'file://sources/misc/readme.txt', location: { path: 'sources/misc/readme.txt' } }

describe('package-first runtime', () => {
  it('lists, resolves, expands, and searches packages from emitted runtime files', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'context-package-runtime-'))
    const inventory = seedInventory()
    await writeGraphFiles(seedGraph(), outputDir, { sourceInventory: inventory })
    await writeSources(outputDir, inventory)
    await writeCorrections(outputDir)

    const list = await listContextPackages({ outputDir })
    expect(list).toMatchObject({
      schemaVersion: 'context-package-list.v1',
      packages: expect.arrayContaining([
        expect.objectContaining({
          package: expect.objectContaining({ id: 'PACKAGE-docs', path: 'sources/product-docs', kind: 'product_docs' }),
          scope: expect.objectContaining({ id: scopeIdForPackage('PACKAGE-docs'), kind: 'package' }),
          buildUnits: [expect.objectContaining({ standardKind: 'semantic_corpus', adapterId: 'microsoft-graphrag.graph-adapter' })],
          sourceGroups: [expect.objectContaining({ id: 'SOURCE-GROUP-docs', kind: 'doc_bundle' })]
        }),
        expect.objectContaining({
          package: expect.objectContaining({ id: 'PACKAGE-misc', kind: 'unknown' }),
          buildUnits: [expect.objectContaining({ standardKind: 'inventory', inventoryOnly: true })]
        })
      ])
    })

    const docs = await getContextPackage({ outputDir, packageRef: 'sources/product-docs' })
    expect(docs).toMatchObject({
      schemaVersion: 'context-package-view.v1',
      package: expect.objectContaining({ id: 'PACKAGE-docs' }),
      scope: expect.objectContaining({ id: scopeIdForPackage('PACKAGE-docs') }),
      buildUnits: [expect.objectContaining({
        adapterSelection: expect.objectContaining({
          adapterId: 'microsoft-graphrag.graph-adapter',
          selectionReason: expect.stringContaining('doc_bundle')
        })
      })],
      nextActions: expect.arrayContaining([
        expect.objectContaining({ type: 'expand_package', targetId: 'PACKAGE-docs' }),
        expect.objectContaining({ type: 'open_scope', targetId: scopeIdForSourceGroup('SOURCE-GROUP-docs') }),
        expect.objectContaining({ type: 'review_corrections', targetId: 'PACKAGE-docs' })
      ]),
      corrections: expect.objectContaining({
        counts: expect.objectContaining({
          evidenceReports: 1,
          findings: 2,
          proposedPatches: 1,
          rehomeProposals: 1,
          byFindingType: expect.objectContaining({
            relabel_group: 1,
            misplaced_source: 1
          })
        }),
        proposalCounts: expect.objectContaining({
          total: 3,
          blocked: 1,
          conflicted: 3,
          byRiskLevel: expect.objectContaining({ low: 1, medium: 2 })
        }),
        pendingProposalIds: expect.arrayContaining([expect.stringMatching(/^CORRECTION-relabel-/)]),
        nextRecommendedProposalId: expect.stringMatching(/^CORRECTION-/),
        evidenceReports: [expect.objectContaining({ id: 'evidence:docs-correction' })],
        rehomeProposals: [expect.objectContaining({ id: 'rehome:docs-guide' })]
      })
    })

    const summaryExpansion = await expandContextPackage({ outputDir, packageRef: 'Product Docs' })
    expect(summaryExpansion).toMatchObject({
      schemaVersion: 'context-package-expansion.v1',
      mode: 'summary',
      package: expect.objectContaining({ id: 'PACKAGE-docs' }),
      sourceGroups: [expect.objectContaining({ id: 'SOURCE-GROUP-docs' })],
      files: [],
      facts: []
    })

    const fullExpansion = await expandContextPackage({ outputDir, packageRef: 'PACKAGE-docs', mode: 'full' })
    expect(fullExpansion.files).toEqual(expect.arrayContaining([expect.objectContaining({ properties: expect.objectContaining({ path: 'sources/product-docs/product.md' }) })]))
    expect(fullExpansion.facts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'REQ-doc-upload' })]))

    const unknown = await getContextPackage({ outputDir, packageRef: 'sources/misc' })
    expect(unknown).toMatchObject({
      package: expect.objectContaining({ id: 'PACKAGE-misc', kind: 'unknown' }),
      buildUnits: [expect.objectContaining({ adapterId: 'builtin.source-inventory', inventoryOnly: true })],
      corrections: expect.objectContaining({
        counts: expect.objectContaining({ evidenceReports: 0, rehomeProposals: 0 })
      })
    })

    const scopedSearch = await searchContextPackage({ outputDir, query: 'uploadFileAPI', packageRef: 'sources/repo' })
    expect(scopedSearch).toMatchObject({
      schemaVersion: 'context-package-search.v1',
      package: expect.objectContaining({ id: 'PACKAGE-repo' }),
      results: [expect.objectContaining({ id: 'SYM-uploadFileAPI', type: 'CodeSymbol' })]
    })
    expect(scopedSearch.results).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'REQ-doc-upload' })]))
  })
})

function seedGraph(): ContextGraph {
  return {
    nodes: [
      createContextNode({ id: 'PROJECT-demo', type: 'Project', name: 'Demo' }),
      createContextNode({ id: 'PACKAGE-docs', type: 'Package', name: '产品资料包: Product Docs', sourceRefs: [docRef], properties: { packageKind: 'product_docs', path: 'sources/product-docs', sourceGroupIds: ['SOURCE-GROUP-docs'] } }),
      createContextNode({ id: 'PACKAGE-repo', type: 'Package', name: '代码仓库包: Repo', sourceRefs: [codeRef], properties: { packageKind: 'code_repository', path: 'sources/repo', sourceGroupIds: ['SOURCE-GROUP-repo'] } }),
      createContextNode({ id: 'PACKAGE-misc', type: 'Package', name: '未知包: Misc', sourceRefs: [unknownRef], properties: { packageKind: 'unknown', path: 'sources/misc', sourceGroupIds: ['SOURCE-GROUP-misc'] } }),
      createContextNode({ id: 'SOURCE-GROUP-docs', type: 'SourceGroup', name: 'Product Docs', sourceRefs: [docRef], properties: { kind: 'doc_bundle', path: 'sources/product-docs' } }),
      createContextNode({ id: 'SOURCE-GROUP-repo', type: 'SourceGroup', name: 'Repo', sourceRefs: [codeRef], properties: { kind: 'repository', path: 'sources/repo' } }),
      createContextNode({ id: 'SOURCE-GROUP-misc', type: 'SourceGroup', name: 'Misc', sourceRefs: [unknownRef], properties: { kind: 'unknown', path: 'sources/misc' } }),
      createContextNode({ id: 'REQ-doc-upload', type: 'Requirement', name: 'Upload docs', content: 'Upload evidence from product docs.', sourceRefs: [docRef] }),
      createContextNode({ id: 'SYM-uploadFileAPI', type: 'CodeSymbol', name: 'uploadFileAPI', content: 'uploadFileAPI posts files.', sourceRefs: [codeRef] })
    ],
    edges: [
      createContextEdge({ from: 'PROJECT-demo', to: 'PACKAGE-docs', type: 'contains_package', linker: 'test' }),
      createContextEdge({ from: 'PROJECT-demo', to: 'PACKAGE-repo', type: 'contains_package', linker: 'test' }),
      createContextEdge({ from: 'PROJECT-demo', to: 'PACKAGE-misc', type: 'contains_package', linker: 'test' }),
      createContextEdge({ from: 'PACKAGE-docs', to: 'SOURCE-GROUP-docs', type: 'contains_source_group', linker: 'test' }),
      createContextEdge({ from: 'PACKAGE-repo', to: 'SOURCE-GROUP-repo', type: 'contains_source_group', linker: 'test' }),
      createContextEdge({ from: 'PACKAGE-misc', to: 'SOURCE-GROUP-misc', type: 'contains_source_group', linker: 'test' })
    ],
    diagnostics: []
  }
}

function seedInventory(): ContextSourceInventory {
  const groups: ContextSourceGroupRecord[] = [
    group('SOURCE-GROUP-docs', 'sources/product-docs', 'Product Docs', 'doc_bundle', docRef),
    group('SOURCE-GROUP-repo', 'sources/repo', 'Repo', 'repository', codeRef),
    group('SOURCE-GROUP-misc', 'sources/misc', 'Misc', 'unknown', unknownRef)
  ]
  const packages: ContextPackageRecord[] = [
    pkg('PACKAGE-docs', 'sources/product-docs', '产品资料包: Product Docs', 'product_docs', ['SOURCE-GROUP-docs'], 'graphrag_corpus', 'semantic_corpus', 'microsoft-graphrag.graph-adapter', 'semantic-graph-builder', 'Default semantic corpus adapter for doc_bundle source groups.', docRef),
    pkg('PACKAGE-repo', 'sources/repo', '代码仓库包: Repo', 'code_repository', ['SOURCE-GROUP-repo'], 'repository', 'repository', 'codegraph.graph-adapter', 'code-graph-builder', 'Default code graph adapter for repository source groups.', codeRef),
    pkg('PACKAGE-misc', 'sources/misc', '未知包: Misc', 'unknown', ['SOURCE-GROUP-misc'], 'inventory', 'inventory', 'builtin.source-inventory', 'inventory', 'Default inventory-only adapter for unknown source groups.', unknownRef)
  ]
  return {
    schemaVersion: 'context-source-inventory.v1',
    entries: [
      entry('INV-doc', 'sources/product-docs/product.md', 'markdown', 'text/markdown', docRef),
      entry('INV-code', 'sources/repo/src/upload.ts', 'code', 'text/typescript', codeRef),
      entry('INV-misc', 'sources/misc/readme.txt', 'inventory', 'text/plain', unknownRef)
    ],
    packages,
    groups,
    summary: { roots: 1, files: 3, packages: 3, groups: 3, routed: 2, inventoryOnly: 1, unsupported: 0, skipped: 0 }
  }
}

function group(id: string, path: string, title: string, kind: ContextSourceGroupRecord['kind'], sourceRef: typeof docRef): ContextSourceGroupRecord {
  return { id, sourceName: 'workspace', path, title, kind, boundaryMode: kind === 'repository' ? 'repository' : 'collapsed', summary: title, confidence: 0.9, decisionSource: kind === 'unknown' ? 'inferred' : 'agent', sourceRef }
}

function pkg(
  id: string,
  path: string,
  title: string,
  kind: ContextPackageRecord['kind'],
  sourceGroupIds: string[],
  unitKind: ContextPackageRecord['buildUnits'][number]['kind'],
  standardKind: ContextPackageRecord['buildUnits'][number]['standardKind'],
  adapterId: string,
  role: ContextPackageRecord['buildUnits'][number]['adapterSelection']['role'],
  selectionReason: string,
  sourceRef: typeof docRef
): ContextPackageRecord {
  return {
    id,
    sourceName: 'workspace',
    path,
    title,
    kind,
    summary: title,
    sourceGroupIds,
    buildUnits: [{
      id: `unit:${id}`,
      kind: unitKind,
      standardKind,
      title,
      sourceGroupIds,
      adapterId,
      adapterSelection: { adapterId, role, selectionSource: 'default', selectionReason, priority: 0 },
      path,
      summary: title
    }],
    confidence: kind === 'unknown' ? 0.35 : 0.9,
    decisionSource: kind === 'unknown' ? 'inferred' : 'agent',
    sourceRef
  }
}

function entry(id: string, path: string, route: ContextSourceInventory['entries'][number]['route'], mediaType: string, sourceRef: typeof docRef): ContextSourceInventory['entries'][number] {
  return { id, sourceName: 'workspace', root: './sources', path, uri: sourceRef.uri, mediaType, sizeBytes: 64, hash: id.padEnd(64, '0'), route, status: route === 'inventory' ? 'inventory_only' : 'routed', sourceRef }
}

async function writeSources(outputDir: string, inventory: ContextSourceInventory): Promise<void> {
  await mkdir(join(outputDir, 'model'), { recursive: true })
  await writeJsonl(join(outputDir, 'model', 'source-inventory.jsonl'), inventory.entries)
  await writeJsonl(join(outputDir, 'model', 'groups.jsonl'), inventory.groups ?? [])
  await writeJsonl(join(outputDir, 'model', 'packages.jsonl'), inventory.packages ?? [])
  await writeJsonl(join(outputDir, 'model', 'build-units.jsonl'), inventory.packages?.flatMap((record) => record.buildUnits) ?? [])
  await writeFile(join(outputDir, 'model', 'source-summary.json'), `${JSON.stringify(inventory.summary, null, 2)}\n`)
}

async function writeCorrections(outputDir: string): Promise<void> {
  await mkdir(join(outputDir, 'graph'), { recursive: true })
  await mkdir(join(outputDir, 'state'), { recursive: true })
  await writeJsonl(join(outputDir, 'graph', 'evidence-reports.jsonl'), [{
    schemaVersion: 'context-evidence-report.v1',
    id: 'evidence:docs-correction',
    revisionId: 'REV-docs',
    scopeId: scopeIdForPackage('PACKAGE-docs'),
    generatedAt: '2026-06-07T00:00:00.000Z',
    summary: 'Docs package needs a package-first correction review.',
    findings: [
      {
        type: 'relabel_group',
        nodeId: 'SOURCE-GROUP-docs',
        suggestedKind: 'domain_area',
        confidence: 0.74,
        evidence: [{ type: 'explicit_reference', description: 'Docs read like a domain area.', sourceRefs: [docRef] }]
      },
      {
        type: 'misplaced_source',
        nodeId: 'SOURCE-GROUP-docs',
        sourcePath: 'sources/product-docs/guide.md',
        suggestedPath: 'sources/product-docs/guides/guide.md',
        confidence: 0.7,
        evidence: [{ type: 'explicit_reference', description: 'Guide file belongs with product docs.', sourceRefs: [docRef] }]
      }
    ],
    proposedPatches: [{
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:docs-relabel',
      revisionId: 'REV-docs',
      author: { type: 'agent', name: 'test' },
      status: 'proposed',
      createdAt: '2026-06-07T00:00:00.000Z',
      evidence: [],
      evidenceReportIds: ['evidence:docs-correction'],
      operations: [{ op: 'relabel_source_group', nodeId: 'SOURCE-GROUP-docs', kind: 'domain_area', confidence: 0.74 }]
    }],
    rehomeProposals: []
  }])
  await writeJsonl(join(outputDir, 'state', 'rehome-proposals.jsonl'), [{
    schemaVersion: 'context-rehome-proposal.v1',
    id: 'rehome:docs-guide',
    sourcePath: 'sources/product-docs/guide.md',
    fromGroupId: 'SOURCE-GROUP-docs',
    toGroupId: 'SOURCE-GROUP-docs',
    suggestedPath: 'sources/product-docs/guides/guide.md',
    action: 'move',
    reason: 'Guide file should stay in the docs package but move under guides.',
    confidence: 0.7,
    evidence: [{ type: 'explicit_reference', description: 'Guide file belongs with product docs.', sourceRefs: [docRef] }],
    status: 'proposed',
    createdAt: '2026-06-07T00:00:00.000Z'
  }])
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''))
}
