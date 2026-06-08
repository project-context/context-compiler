import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createContextEdge,
  createContextNode,
  writeGraphFiles,
  type ContextGraph,
  type ContextPackageRecord,
  type ContextSourceGroupRecord,
  type ContextSourceInventory
} from '@context-compiler/core'
import { runCli } from './index.js'

const docRef = { sourceId: 'workspace', uri: 'file://sources/product-docs/product.md', location: { path: 'sources/product-docs/product.md' } }
const codeRef = { sourceId: 'workspace', uri: 'file://sources/repo/src/upload.ts', location: { path: 'sources/repo/src/upload.ts' } }
const unknownRef = { sourceId: 'workspace', uri: 'file://sources/misc/readme.txt', location: { path: 'sources/misc/readme.txt' } }

describe('package CLI options', () => {
  it('lists, shows, expands, and searches package-first runtime views', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context-package-cli-'))
    await writeFile(join(cwd, 'context.config.json'), JSON.stringify({ sources: [{ name: 'workspace', path: './sources' }] }, null, 2))
    const inventory = seedInventory()
    await writeGraphFiles(seedGraph(), join(cwd, '.context'), { sourceInventory: inventory })
    await writeSources(join(cwd, '.context'), inventory)
    await writeCorrections(join(cwd, '.context'))

    const list = await runCli(['package', 'list'], { cwd })
    expect(list.exitCode).toBe(0)
    expect(list.stdout).toContain('Packages:')
    expect(list.stdout).toContain('PACKAGE-docs')
    expect(list.stdout).toContain('builtin.source-inventory')

    const show = await runCli(['package', 'show', 'sources/product-docs', '--json'], { cwd })
    expect(show.exitCode).toBe(0)
    expect(JSON.parse(show.stdout)).toMatchObject({
      schemaVersion: 'context-package-view.v1',
      package: { id: 'PACKAGE-docs' },
      buildUnits: [expect.objectContaining({ adapterId: 'microsoft-graphrag.graph-adapter' })],
      corrections: expect.objectContaining({
        counts: expect.objectContaining({ evidenceReports: 1, proposedPatches: 1, rehomeProposals: 1 })
      })
    })

    const showText = await runCli(['package', 'show', 'sources/product-docs'], { cwd })
    expect(showText.exitCode).toBe(0)
    expect(showText.stdout).toContain('Corrections:')
    expect(showText.stdout).toContain('evidenceReports=1')
    expect(showText.stdout).toContain('rehomeProposals=1')

    const corrections = await runCli(['package', 'corrections', 'sources/product-docs', '--json'], { cwd })
    expect(corrections.exitCode).toBe(0)
    const inbox = JSON.parse(corrections.stdout) as {
      proposals: Array<{ id: string; kind: string; status: string; blocked: boolean; impact: { riskLevel: string }; conflicts: unknown[] }>
      counts: { total: number; proposed: number; blocked: number; conflicted: number }
    }
    expect(inbox).toMatchObject({
      schemaVersion: 'context-package-correction-inbox.v1',
      counts: expect.objectContaining({ total: 2, proposed: 2, blocked: 1, conflicted: 2 }),
      proposals: expect.arrayContaining([
        expect.objectContaining({ kind: 'relabel', status: 'proposed', blocked: false, impact: expect.objectContaining({ riskLevel: 'medium' }) }),
        expect.objectContaining({ kind: 'rehome', status: 'proposed' })
      ])
    })
    const correctionsText = await runCli(['package', 'corrections', 'sources/product-docs'], { cwd })
    expect(correctionsText.exitCode).toBe(0)
    expect(correctionsText.stdout).toContain('Blocked:')
    expect(correctionsText.stdout).toContain('Risk:')
    expect(correctionsText.stdout).toContain('Conflicts:')
    expect(correctionsText.stdout).toContain('Recommended:')
    const relabelId = inbox.proposals.find((proposal) => proposal.kind === 'relabel')?.id
    const rehomeId = inbox.proposals.find((proposal) => proposal.kind === 'rehome')?.id
    expect(relabelId).toBeDefined()
    expect(rehomeId).toBeDefined()
    if (!relabelId || !rehomeId) {
      throw new Error('expected correction proposal ids')
    }

    const proposal = await runCli(['package', 'correction', 'show', relabelId, '--json'], { cwd })
    expect(proposal.exitCode).toBe(0)
    expect(JSON.parse(proposal.stdout)).toMatchObject({
      schemaVersion: 'context-correction-proposal.v1',
      id: relabelId,
      packageId: 'PACKAGE-docs',
      graphPatchIds: ['patch:docs-relabel'],
      dedupeKey: expect.any(String),
      operationPlan: expect.objectContaining({
        schemaVersion: 'context-correction-operation-plan.v1',
        kind: 'relabel'
      }),
      impact: expect.objectContaining({ relabels: 1, riskLevel: 'medium' }),
      conflicts: expect.any(Array)
    })
    const proposalText = await runCli(['package', 'correction', 'show', relabelId], { cwd })
    expect(proposalText.exitCode).toBe(0)
    expect(proposalText.stdout).toContain('Risk: medium')
    expect(proposalText.stdout).toContain('Blocked: false')
    expect(proposalText.stdout).toContain('Conflicts:')
    expect(proposalText.stdout).toContain('Impact:')
    expect(proposalText.stdout).toContain('Preview: context package correction preview')

    const preview = await runCli(['package', 'correction', 'preview', relabelId, '--json'], { cwd })
    expect(preview.exitCode).toBe(0)
    expect(JSON.parse(preview.stdout)).toMatchObject({
      schemaVersion: 'context-correction-preview.v1',
      proposal: expect.objectContaining({ id: relabelId }),
      operationPlan: expect.objectContaining({
        schemaVersion: 'context-correction-operation-plan.v1',
        kind: 'relabel',
        sourceEffects: expect.arrayContaining([
          expect.objectContaining({ kind: 'source_group_relabel', targetId: 'SOURCE-GROUP-docs' })
        ]),
        graphPatchIds: ['patch:docs-relabel']
      }),
      revisionSummary: expect.objectContaining({
        appliedPatchIds: ['patch:docs-relabel']
      })
    })
    const previewText = await runCli(['package', 'correction', 'preview', relabelId], { cwd })
    expect(previewText.exitCode).toBe(0)
    expect(previewText.stdout).toContain('Correction preview:')
    expect(previewText.stdout).toContain('Source effects:')
    expect(previewText.stdout).toContain('Graph effects:')

    const applyProposed = await runCli(['package', 'correction', 'apply', relabelId, '--json'], { cwd })
    expect(applyProposed.exitCode).toBe(1)
    expect(JSON.parse(applyProposed.stdout)).toMatchObject({
      action: 'apply',
      submitted: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ type: 'correction.proposal.requires-approval' })])
    })

    const approve = await runCli(['package', 'correction', 'approve', relabelId, '--reason', 'looks right', '--json'], { cwd })
    expect(approve.exitCode).toBe(0)
    expect(JSON.parse(approve.stdout)).toMatchObject({
      schemaVersion: 'context-correction-action-result.v1',
      action: 'approve',
      proposal: expect.objectContaining({ id: relabelId, status: 'approved', statusReason: 'looks right' })
    })

    const applyDryRun = await runCli(['package', 'correction', 'apply', relabelId, '--dry-run', '--json'], { cwd })
    expect(applyDryRun.exitCode).toBe(0)
    expect(JSON.parse(applyDryRun.stdout)).toMatchObject({
      action: 'apply',
      dryRun: true,
      written: false,
      submitted: false,
      proposal: expect.objectContaining({ id: relabelId, status: 'approved' }),
      graphPatch: expect.objectContaining({ id: 'patch:docs-relabel' }),
      preview: expect.objectContaining({ schemaVersion: 'context-correction-preview.v1' }),
      operationPlan: expect.objectContaining({ kind: 'relabel' }),
      diagnostics: expect.any(Array)
    })

    const reject = await runCli(['package', 'correction', 'reject', rehomeId, '--reason', 'not now', '--json'], { cwd })
    expect(reject.exitCode).toBe(0)
    expect(JSON.parse(reject.stdout)).toMatchObject({
      action: 'reject',
      proposal: expect.objectContaining({ id: rehomeId, status: 'rejected', statusReason: 'not now' })
    })

    const rejected = await runCli(['package', 'corrections', 'sources/product-docs', '--status', 'rejected', '--json'], { cwd })
    expect(rejected.exitCode).toBe(0)
    expect(JSON.parse(rejected.stdout).proposals).toEqual([expect.objectContaining({ id: rehomeId, status: 'rejected' })])

    const unknownCorrections = await runCli(['package', 'corrections', 'sources/misc', '--json'], { cwd })
    expect(unknownCorrections.exitCode).toBe(0)
    expect(JSON.parse(unknownCorrections.stdout)).toMatchObject({
      package: { id: 'PACKAGE-misc' },
      counts: expect.objectContaining({ total: 0 })
    })

    const fullExpansion = await runCli(['package', 'expand', 'PACKAGE-docs', '--full'], { cwd })
    expect(fullExpansion.exitCode).toBe(0)
    expect(fullExpansion.stdout).toContain('REQ-doc-upload')
    expect(fullExpansion.stdout).toContain('sources/product-docs/product.md')

    const search = await runCli(['package', 'search', 'uploadFileAPI', '--package', 'sources/repo'], { cwd })
    expect(search.exitCode).toBe(0)
    expect(search.stdout).toContain('SYM-uploadFileAPI')
    expect(search.stdout).not.toContain('REQ-doc-upload')
  })
})

function seedGraph(): ContextGraph {
  return {
    nodes: [
      createContextNode({ id: 'PROJECT-demo', type: 'Project', name: 'Demo' }),
      createContextNode({ id: 'PACKAGE-docs', type: 'Package', name: 'Product Docs', sourceRefs: [docRef], properties: { packageKind: 'product_docs', path: 'sources/product-docs', sourceGroupIds: ['SOURCE-GROUP-docs'] } }),
      createContextNode({ id: 'PACKAGE-repo', type: 'Package', name: 'Repo', sourceRefs: [codeRef], properties: { packageKind: 'code_repository', path: 'sources/repo', sourceGroupIds: ['SOURCE-GROUP-repo'] } }),
      createContextNode({ id: 'PACKAGE-misc', type: 'Package', name: 'Misc', sourceRefs: [unknownRef], properties: { packageKind: 'unknown', path: 'sources/misc', sourceGroupIds: ['SOURCE-GROUP-misc'] } }),
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
    pkg('PACKAGE-docs', 'sources/product-docs', 'Product Docs', 'product_docs', ['SOURCE-GROUP-docs'], 'graphrag_corpus', 'semantic_corpus', 'microsoft-graphrag.graph-adapter', 'semantic-graph-builder', 'Default semantic corpus adapter for doc_bundle source groups.', docRef),
    pkg('PACKAGE-repo', 'sources/repo', 'Repo', 'code_repository', ['SOURCE-GROUP-repo'], 'repository', 'repository', 'codegraph.graph-adapter', 'code-graph-builder', 'Default code graph adapter for repository source groups.', codeRef),
    pkg('PACKAGE-misc', 'sources/misc', 'Misc', 'unknown', ['SOURCE-GROUP-misc'], 'inventory', 'inventory', 'builtin.source-inventory', 'inventory', 'Default inventory-only adapter for unknown source groups.', unknownRef)
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
  await mkdir(join(outputDir, 'sources'), { recursive: true })
  await writeJsonl(join(outputDir, 'sources', 'inventory.jsonl'), inventory.entries)
  await writeJsonl(join(outputDir, 'sources', 'groups.jsonl'), inventory.groups ?? [])
  await writeJsonl(join(outputDir, 'sources', 'packages.jsonl'), inventory.packages ?? [])
  await writeJsonl(join(outputDir, 'sources', 'build-units.jsonl'), inventory.packages?.flatMap((record) => record.buildUnits) ?? [])
  await writeFile(join(outputDir, 'sources', 'summary.json'), `${JSON.stringify(inventory.summary, null, 2)}\n`)
}

async function writeCorrections(outputDir: string): Promise<void> {
  await mkdir(join(outputDir, 'graph'), { recursive: true })
  await mkdir(join(outputDir, 'proposals'), { recursive: true })
  await writeJsonl(join(outputDir, 'graph', 'evidence-reports.jsonl'), [{
    schemaVersion: 'context-evidence-report.v1',
    id: 'evidence:docs-correction',
    revisionId: 'REV-docs',
    scopeId: 'scope:package:PACKAGE-docs',
    generatedAt: '2026-06-07T00:00:00.000Z',
    summary: 'Docs package needs correction review.',
    findings: [{
      type: 'relabel_group',
      nodeId: 'SOURCE-GROUP-docs',
      suggestedKind: 'domain_area',
      confidence: 0.74,
      evidence: [{ type: 'explicit_reference', description: 'Docs read like a domain area.', sourceRefs: [docRef] }]
    }],
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
  await writeJsonl(join(outputDir, 'proposals', 'rehome-proposals.jsonl'), [{
    schemaVersion: 'context-rehome-proposal.v1',
    id: 'rehome:docs-guide',
    sourcePath: 'sources/product-docs/guide.md',
    fromGroupId: 'SOURCE-GROUP-docs',
    toGroupId: 'SOURCE-GROUP-docs',
    suggestedPath: 'sources/product-docs/guides/guide.md',
    action: 'move',
    reason: 'Guide file should stay in the docs package.',
    confidence: 0.7,
    evidence: [{ type: 'explicit_reference', description: 'Guide file belongs with product docs.', sourceRefs: [docRef] }],
    status: 'proposed',
    createdAt: '2026-06-07T00:00:00.000Z'
  }])
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''))
}
