import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getContextCorrectionProposal, getContextPackageCorrectionDecision, listContextPackageCorrectionDecisions, proposeContextPackageCorrectionDecisionRevert, replayContextPackageCorrectionDecisions } from '@context-compiler/core/runtime'
import { scopeIdForPackage, writeGraphFiles } from '@context-compiler/core/graph'
import { createContextEdge, createContextNode, type ContextGraph, type ContextPackageRecord, type ContextSourceCorrectionDecision, type ContextSourceGroupRecord, type ContextSourceInventory, type GraphRevision } from '@context-compiler/core/sdk'

const docRef = { sourceId: 'workspace', uri: 'file://sources/product-docs/product.md', location: { path: 'sources/product-docs/product.md' } }
const codeRef = { sourceId: 'workspace', uri: 'file://sources/repo/src/upload.ts', location: { path: 'sources/repo/src/upload.ts' } }
const miscRef = { sourceId: 'workspace', uri: 'file://sources/misc/readme.txt', location: { path: 'sources/misc/readme.txt' } }

describe('source correction decision memory', () => {
  it('builds effective package-scoped decision views, detects drift, replays, and proposes revert without mutating decisions', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'context-source-correction-memory-'))
    const inventory = seedInventory()
    await writeGraphFiles(seedGraph(), outputDir, { sourceInventory: inventory })
    await writeSources(outputDir, inventory)
    await writeRevision(outputDir)
    await writeSourceCorrections(outputDir, [
      decision('SOURCE-CORRECTION-docs-old', 'relabel:docs', 'applied', '2026-06-01T00:00:00.000Z', {
        packageId: 'PACKAGE-docs',
        sourceGroupId: 'SOURCE-GROUP-docs',
        sourcePath: 'sources/product-docs',
        before: { kind: 'doc_bundle', title: 'Product Docs', summary: 'Product Docs', confidence: 0.9, path: 'sources/product-docs' },
        after: { kind: 'domain_area', title: 'Old Domain', summary: 'Old domain summary.', confidence: 0.72, path: 'sources/product-docs' }
      }),
      decision('SOURCE-CORRECTION-docs-new', 'relabel:docs', 'applied', '2026-06-02T00:00:00.000Z', {
        packageId: 'PACKAGE-docs',
        sourceGroupId: 'SOURCE-GROUP-docs',
        sourcePath: 'sources/product-docs',
        before: { kind: 'doc_bundle', title: 'Product Docs', summary: 'Product Docs', confidence: 0.9, path: 'sources/product-docs' },
        after: { kind: 'analysis_bundle', title: 'Corrected Domain', summary: 'Corrected package memory.', confidence: 0.88, path: 'sources/product-docs' }
      }),
      decision('SOURCE-CORRECTION-misc-temp', 'relabel:misc', 'applied', '2026-06-01T00:00:00.000Z', {
        packageId: 'PACKAGE-misc',
        sourceGroupId: 'SOURCE-GROUP-misc',
        sourcePath: 'sources/misc',
        before: { kind: 'unknown', title: 'Misc', path: 'sources/misc' },
        after: { kind: 'doc_bundle', title: 'Misc Docs', path: 'sources/misc' }
      }),
      decision('SOURCE-CORRECTION-misc-temp', 'relabel:misc', 'reverted', '2026-06-03T00:00:00.000Z', {
        packageId: 'PACKAGE-misc',
        sourceGroupId: 'SOURCE-GROUP-misc',
        sourcePath: 'sources/misc',
        before: { kind: 'unknown', title: 'Misc', path: 'sources/misc' },
        after: { kind: 'doc_bundle', title: 'Misc Docs', path: 'sources/misc' },
        statusReason: 'undo temp relabel'
      }),
      decision('SOURCE-CORRECTION-docs-drift', 'rehome:docs-missing', 'applied', '2026-06-04T00:00:00.000Z', {
        kind: 'rehome',
        packageId: 'PACKAGE-docs',
        sourceGroupId: 'SOURCE-GROUP-docs',
        targetGroupId: 'SOURCE-GROUP-missing',
        sourcePath: 'sources/product-docs/missing.md',
        targetPath: 'sources/product-docs/missing/missing.md',
        before: { sourcePath: 'sources/product-docs/missing.md', sourceGroupId: 'SOURCE-GROUP-docs' },
        after: { targetPath: 'sources/product-docs/missing/missing.md', targetGroupId: 'SOURCE-GROUP-missing' }
      })
    ])

    const docs = await listContextPackageCorrectionDecisions({ outputDir, packageRef: 'sources/product-docs', includeDrift: true })
    expect(docs).toMatchObject({
      schemaVersion: 'context-source-correction-decision-list.v1',
      package: expect.objectContaining({ id: 'PACKAGE-docs' }),
      counts: expect.objectContaining({
        total: 3,
        active: 1,
        applied: 2,
        superseded: 1,
        drifted: 2,
        byKind: expect.objectContaining({ relabel: 2, rehome: 1 }),
        byStatus: expect.objectContaining({ applied: 2, superseded: 1 })
      }),
      decisions: expect.arrayContaining([
        expect.objectContaining({
          decision: expect.objectContaining({ id: 'SOURCE-CORRECTION-docs-new', status: 'applied' }),
          active: true,
          effectiveStatus: 'applied',
          sourceGroup: expect.objectContaining({ id: 'SOURCE-GROUP-docs' }),
          supersedesDecisionIds: ['SOURCE-CORRECTION-docs-old'],
          drifts: []
        }),
        expect.objectContaining({
          decision: expect.objectContaining({ id: 'SOURCE-CORRECTION-docs-old', status: 'superseded' }),
          active: false,
          effectiveStatus: 'superseded',
          supersededByDecisionId: 'SOURCE-CORRECTION-docs-new',
          drifts: expect.arrayContaining([expect.objectContaining({ type: 'superseded_by_newer_decision', severity: 'warning' })])
        }),
        expect.objectContaining({
          decision: expect.objectContaining({ id: 'SOURCE-CORRECTION-docs-drift', status: 'applied' }),
          active: false,
          effectiveStatus: 'applied',
          drifts: expect.arrayContaining([
            expect.objectContaining({ type: 'missing_source_path', severity: 'error' }),
            expect.objectContaining({ type: 'missing_target_group', severity: 'error' })
          ])
        })
      ])
    })

    await expect(listContextPackageCorrectionDecisions({ outputDir, packageRef: 'PACKAGE-docs', status: 'superseded' })).resolves.toMatchObject({
      counts: expect.objectContaining({ total: 1, superseded: 1 }),
      decisions: [expect.objectContaining({ decision: expect.objectContaining({ id: 'SOURCE-CORRECTION-docs-old' }) })]
    })
    await expect(getContextPackageCorrectionDecision({ outputDir, decisionId: 'SOURCE-CORRECTION-docs-drift' })).resolves.toMatchObject({
      decision: expect.objectContaining({ id: 'SOURCE-CORRECTION-docs-drift' }),
      drifts: expect.arrayContaining([expect.objectContaining({ type: 'missing_target_group' })])
    })
    await expect(listContextPackageCorrectionDecisions({ outputDir, packageRef: 'sources/misc' })).resolves.toMatchObject({
      counts: expect.objectContaining({ total: 1, reverted: 1, active: 0 }),
      decisions: [expect.objectContaining({ decision: expect.objectContaining({ id: 'SOURCE-CORRECTION-misc-temp', status: 'reverted' }) })]
    })

    const beforeFile = await readFile(join(outputDir, 'sources', 'correction-decisions.jsonl'), 'utf8')
    const replay = await replayContextPackageCorrectionDecisions({ outputDir, packageRef: 'sources/product-docs' })
    expect(replay).toMatchObject({
      schemaVersion: 'context-source-correction-replay.v1',
      written: false,
      package: expect.objectContaining({ id: 'PACKAGE-docs' }),
      decisions: [expect.objectContaining({ decision: expect.objectContaining({ id: 'SOURCE-CORRECTION-docs-new' }) })],
      after: {
        groups: expect.arrayContaining([
          expect.objectContaining({ id: 'SOURCE-GROUP-docs', kind: 'analysis_bundle', title: 'Corrected Domain', summary: 'Corrected package memory.' })
        ]),
        packages: expect.arrayContaining([
          expect.objectContaining({ id: 'PACKAGE-docs', summary: 'Corrected package memory.' })
        ])
      },
      drifts: expect.arrayContaining([
        expect.objectContaining({ decisionId: 'SOURCE-CORRECTION-docs-drift', type: 'missing_target_group' })
      ])
    })
    await expect(readFile(join(outputDir, 'sources', 'correction-decisions.jsonl'), 'utf8')).resolves.toBe(beforeFile)

    const revert = await proposeContextPackageCorrectionDecisionRevert({
      outputDir,
      decisionId: 'SOURCE-CORRECTION-docs-new',
      actor: { type: 'human', name: 'tester' },
      reason: 'restore original grouping',
      generatedAt: '2026-06-05T00:00:00.000Z'
    })
    expect(revert).toMatchObject({
      schemaVersion: 'context-source-correction-decision-action-result.v1',
      action: 'revert',
      written: true,
      decision: expect.objectContaining({ id: 'SOURCE-CORRECTION-docs-new' }),
      proposal: expect.objectContaining({
        schemaVersion: 'context-correction-proposal.v1',
        kind: 'relabel',
        status: 'proposed',
        derivedFrom: expect.arrayContaining([expect.objectContaining({ kind: 'source_correction_decision', id: 'SOURCE-CORRECTION-docs-new' })]),
        graphPatch: expect.objectContaining({
          operations: [expect.objectContaining({ op: 'relabel_source_group', nodeId: 'SOURCE-GROUP-docs', kind: 'doc_bundle' })]
        })
      })
    })
    await expect(readFile(join(outputDir, 'sources', 'correction-decisions.jsonl'), 'utf8')).resolves.toBe(beforeFile)
    const proposal = revert.proposal
    expect(proposal).toBeDefined()
    if (!proposal) {
      throw new Error('expected revert proposal')
    }
    await expect(getContextCorrectionProposal({ outputDir, proposalId: proposal.id })).resolves.toMatchObject({
      id: proposal.id,
      derivedFrom: expect.arrayContaining([expect.objectContaining({ kind: 'source_correction_decision', id: 'SOURCE-CORRECTION-docs-new' })])
    })
  })
})

function seedGraph(): ContextGraph {
  return {
    nodes: [
      createContextNode({ id: 'PROJECT-demo', type: 'Project', name: 'Demo' }),
      createContextNode({ id: 'PACKAGE-docs', type: 'Package', name: 'Product Docs', sourceRefs: [docRef], properties: { packageKind: 'product_docs', path: 'sources/product-docs', sourceGroupIds: ['SOURCE-GROUP-docs'] } }),
      createContextNode({ id: 'PACKAGE-repo', type: 'Package', name: 'Repo', sourceRefs: [codeRef], properties: { packageKind: 'code_repository', path: 'sources/repo', sourceGroupIds: ['SOURCE-GROUP-repo'] } }),
      createContextNode({ id: 'PACKAGE-misc', type: 'Package', name: 'Misc', sourceRefs: [miscRef], properties: { packageKind: 'unknown', path: 'sources/misc', sourceGroupIds: ['SOURCE-GROUP-misc'] } }),
      createContextNode({ id: 'SOURCE-GROUP-docs', type: 'SourceGroup', name: 'Product Docs', sourceRefs: [docRef], properties: { kind: 'doc_bundle', path: 'sources/product-docs', summary: 'Product Docs' } }),
      createContextNode({ id: 'SOURCE-GROUP-repo', type: 'SourceGroup', name: 'Repo', sourceRefs: [codeRef], properties: { kind: 'repository', path: 'sources/repo' } }),
      createContextNode({ id: 'SOURCE-GROUP-misc', type: 'SourceGroup', name: 'Misc', sourceRefs: [miscRef], properties: { kind: 'unknown', path: 'sources/misc' } })
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
    group('SOURCE-GROUP-misc', 'sources/misc', 'Misc', 'unknown', miscRef)
  ]
  const packages: ContextPackageRecord[] = [
    pkg('PACKAGE-docs', 'sources/product-docs', 'Product Docs', 'product_docs', ['SOURCE-GROUP-docs'], docRef),
    pkg('PACKAGE-repo', 'sources/repo', 'Repo', 'code_repository', ['SOURCE-GROUP-repo'], codeRef),
    pkg('PACKAGE-misc', 'sources/misc', 'Misc', 'unknown', ['SOURCE-GROUP-misc'], miscRef)
  ]
  return {
    schemaVersion: 'context-source-inventory.v1',
    entries: [
      entry('INV-doc', 'sources/product-docs/product.md', 'markdown', docRef),
      entry('INV-code', 'sources/repo/src/upload.ts', 'code', codeRef),
      entry('INV-misc', 'sources/misc/readme.txt', 'inventory', miscRef)
    ],
    packages,
    groups,
    summary: { roots: 1, files: 3, packages: 3, groups: 3, routed: 2, inventoryOnly: 1, unsupported: 0, skipped: 0 }
  }
}

function group(id: string, path: string, title: string, kind: ContextSourceGroupRecord['kind'], sourceRef: typeof docRef): ContextSourceGroupRecord {
  return { id, sourceName: 'workspace', path, title, kind, boundaryMode: kind === 'repository' ? 'repository' : 'collapsed', summary: title, confidence: 0.9, decisionSource: kind === 'unknown' ? 'inferred' : 'agent', sourceRef }
}

function pkg(id: string, path: string, title: string, kind: ContextPackageRecord['kind'], sourceGroupIds: string[], sourceRef: typeof docRef): ContextPackageRecord {
  return { id, sourceName: 'workspace', path, title, kind, summary: title, sourceGroupIds, buildUnits: [], confidence: 0.9, decisionSource: kind === 'unknown' ? 'inferred' : 'agent', sourceRef }
}

function entry(id: string, path: string, route: ContextSourceInventory['entries'][number]['route'], sourceRef: typeof docRef): ContextSourceInventory['entries'][number] {
  return { id, sourceName: 'workspace', root: './sources', path, uri: sourceRef.uri, mediaType: 'text/plain', sizeBytes: 64, hash: id.padEnd(64, '0'), route, status: route === 'inventory' ? 'inventory_only' : 'routed', sourceRef }
}

function decision(
  id: string,
  dedupeKey: string,
  status: ContextSourceCorrectionDecision['status'],
  createdAt: string,
  options: Partial<ContextSourceCorrectionDecision> = {}
): ContextSourceCorrectionDecision {
  return {
    schemaVersion: 'context-source-correction-decision.v1',
    id,
    dedupeKey,
    proposalId: `CORRECTION-${id}`,
    kind: options.kind ?? 'relabel',
    action: options.action ?? options.kind ?? 'relabel',
    status,
    createdAt,
    updatedAt: createdAt,
    before: options.before,
    after: options.after,
    packageId: options.packageId,
    sourceGroupId: options.sourceGroupId,
    targetGroupId: options.targetGroupId,
    sourcePath: options.sourcePath,
    targetPath: options.targetPath,
    statusReason: options.statusReason
  }
}

async function writeSources(outputDir: string, inventory: ContextSourceInventory): Promise<void> {
  await mkdir(join(outputDir, 'sources'), { recursive: true })
  await writeJsonl(join(outputDir, 'sources', 'inventory.jsonl'), inventory.entries)
  await writeJsonl(join(outputDir, 'sources', 'groups.jsonl'), inventory.groups ?? [])
  await writeJsonl(join(outputDir, 'sources', 'packages.jsonl'), inventory.packages ?? [])
  await writeJsonl(join(outputDir, 'sources', 'build-units.jsonl'), [])
  await writeFile(join(outputDir, 'sources', 'summary.json'), `${JSON.stringify(inventory.summary, null, 2)}\n`)
}

async function writeRevision(outputDir: string): Promise<void> {
  const revision: GraphRevision = {
    schemaVersion: 'context-graph-revision.v1',
    id: 'REV-docs',
    createdAt: '2026-06-01T00:00:00.000Z',
    graphFingerprint: 'seed',
    reason: 'seed',
    status: 'materialized',
    patchIds: [],
    evidenceReportIds: []
  }
  await mkdir(join(outputDir, 'graph', 'revisions'), { recursive: true })
  await writeJsonl(join(outputDir, 'graph', 'revisions', 'revisions.jsonl'), [revision])
}

async function writeSourceCorrections(outputDir: string, rows: ContextSourceCorrectionDecision[]): Promise<void> {
  await mkdir(join(outputDir, 'sources'), { recursive: true })
  await writeJsonl(join(outputDir, 'sources', 'correction-decisions.jsonl'), rows)
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''))
}
