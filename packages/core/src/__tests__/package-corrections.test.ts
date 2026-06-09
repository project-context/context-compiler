import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approveContextCorrectionProposal, applyContextCorrectionProposal, getContextCorrectionProposal, listContextPackageCorrections, previewContextCorrectionProposal, rejectContextCorrectionProposal } from '@context-compiler/core/runtime'
import { scopeIdForPackage, writeGraphFiles } from '@context-compiler/core/graph'
import { type EvidenceReport, type GraphPatch, type GraphRevision } from '@context-compiler/core/graph'
import { createContextEdge, createContextNode, type ContextGraph, type ContextPackageRecord, type ContextSourceGroupRecord, type ContextSourceInventory } from '@context-compiler/core/sdk'

const docRef = { sourceId: 'workspace', uri: 'file://sources/product-docs/product.md', location: { path: 'sources/product-docs/product.md' } }
const codeRef = { sourceId: 'workspace', uri: 'file://sources/repo/src/upload.ts', location: { path: 'sources/repo/src/upload.ts' } }
const unknownRef = { sourceId: 'workspace', uri: 'file://sources/misc/readme.txt', location: { path: 'sources/misc/readme.txt' } }

describe('package correction proposal runtime', () => {
  it('normalizes package-scoped evidence and rehome inputs into canonical proposals with lifecycle overlay', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'context-package-corrections-'))
    const inventory = seedInventory()
    await writeGraphFiles(seedGraph(), outputDir, { sourceInventory: inventory })
    await writeSources(outputDir, inventory)
    await writeGraphKernelFiles(outputDir)

    const docsInbox = await listContextPackageCorrections({ outputDir, packageRef: 'sources/product-docs' })
    expect(docsInbox).toMatchObject({
      schemaVersion: 'context-package-correction-inbox.v1',
      package: expect.objectContaining({ id: 'PACKAGE-docs' }),
      counts: expect.objectContaining({
        total: 2,
        blocked: 1,
        conflicted: 2,
        proposed: 2,
        approved: 0,
        rejected: 0,
        applied: 0,
        byKind: expect.objectContaining({ relabel: 1, rehome: 1 }),
        byRiskLevel: expect.objectContaining({ low: 1, medium: 1 })
      }),
      proposals: expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^CORRECTION-relabel-/),
          dedupeKey: expect.stringContaining('relabel'),
          kind: 'relabel',
          status: 'proposed',
          blocked: false,
          packageId: 'PACKAGE-docs',
          sourceGroupIds: ['SOURCE-GROUP-docs'],
          affectedNodeIds: ['SOURCE-GROUP-docs'],
          graphPatchIds: ['patch:docs-relabel'],
          evidenceReportIds: ['evidence:docs-correction'],
          impact: expect.objectContaining({
            operationCount: 1,
            relabels: 1,
            riskLevel: 'medium'
          }),
          operationPlan: expect.objectContaining({
            schemaVersion: 'context-correction-operation-plan.v1',
            kind: 'relabel',
            sourceEffects: expect.arrayContaining([
              expect.objectContaining({
                kind: 'source_group_relabel',
                targetId: 'SOURCE-GROUP-docs',
                persistent: true
              })
            ]),
            graphEffects: expect.arrayContaining([
              expect.objectContaining({
                kind: 'graph_patch_operation',
                operation: 'relabel_source_group',
                targetId: 'SOURCE-GROUP-docs'
              })
            ])
          }),
          conflicts: expect.arrayContaining([
            expect.objectContaining({ type: 'stale_revision', severity: 'warning' })
          ])
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^CORRECTION-rehome-/),
          kind: 'rehome',
          status: 'proposed',
          blocked: true,
          packageId: 'PACKAGE-docs',
          sourcePaths: expect.arrayContaining(['sources/product-docs/guide.md']),
          rehomeProposalIds: ['rehome:docs-guide'],
          impact: expect.objectContaining({
            operationCount: 0,
            rehomes: 1,
            riskLevel: 'low'
          }),
          conflicts: expect.arrayContaining([
            expect.objectContaining({ type: 'missing_graph_patch', severity: 'error' })
          ])
        })
      ])
    })
    expect(docsInbox.nextRecommendedProposalId).toBe(docsInbox.proposals[0]?.id)

    const repoInbox = await listContextPackageCorrections({ outputDir, packageRef: 'sources/repo' })
    expect(repoInbox.proposals).toEqual([])

    const unknownInbox = await listContextPackageCorrections({ outputDir, packageRef: 'sources/misc' })
    expect(unknownInbox).toMatchObject({
      package: expect.objectContaining({ id: 'PACKAGE-misc' }),
      counts: expect.objectContaining({ total: 0 })
    })

    const relabel = docsInbox.proposals.find((proposal) => proposal.kind === 'relabel')
    expect(relabel).toBeDefined()
    if (!relabel) {
      throw new Error('expected relabel proposal')
    }

    await expect(getContextCorrectionProposal({ outputDir, proposalId: relabel.id })).resolves.toMatchObject({
      schemaVersion: 'context-correction-proposal.v1',
      id: relabel.id,
      packageId: 'PACKAGE-docs',
      impact: expect.objectContaining({ relabels: 1 }),
      operationPlan: expect.objectContaining({
        kind: 'relabel',
        sourceDecisions: expect.arrayContaining([
          expect.objectContaining({
            schemaVersion: 'context-source-correction-decision.v1',
            kind: 'relabel',
            proposalId: relabel.id,
            sourceGroupId: 'SOURCE-GROUP-docs',
            after: expect.objectContaining({ kind: 'domain_area', confidence: 0.74 })
          })
        ])
      }),
      conflicts: expect.arrayContaining([expect.objectContaining({ type: 'stale_revision' })])
    })

    const proposedApply = await applyContextCorrectionProposal({ outputDir, proposalId: relabel.id })
    expect(proposedApply).toMatchObject({
      action: 'apply',
      submitted: false,
      proposal: expect.objectContaining({ id: relabel.id, status: 'proposed' }),
      diagnostics: expect.arrayContaining([expect.objectContaining({ type: 'correction.proposal.requires-approval' })])
    })

    const approved = await approveContextCorrectionProposal({
      outputDir,
      proposalId: relabel.id,
      actor: { type: 'human', name: 'tester' },
      reason: 'looks right',
      generatedAt: '2026-06-07T00:00:00.000Z'
    })
    expect(approved).toMatchObject({
      schemaVersion: 'context-correction-action-result.v1',
      action: 'approve',
      dryRun: false,
      proposal: expect.objectContaining({ id: relabel.id, status: 'approved', statusReason: 'looks right' }),
      diagnostics: []
    })

    const approvedInbox = await listContextPackageCorrections({ outputDir, packageRef: 'PACKAGE-docs', status: 'approved' })
    expect(approvedInbox.proposals).toEqual([expect.objectContaining({ id: relabel.id, status: 'approved' })])

    const sourceDecisionsBefore = await readFile(join(outputDir, 'state', 'source-correction-decisions.jsonl'), 'utf8').catch(() => '')
    const preview = await previewContextCorrectionProposal({ outputDir, proposalId: relabel.id })
    expect(preview).toMatchObject({
      schemaVersion: 'context-correction-preview.v1',
      proposal: expect.objectContaining({ id: relabel.id, status: 'approved' }),
      operationPlan: expect.objectContaining({
        id: expect.stringContaining(relabel.id),
        kind: 'relabel',
        persistent: true,
        sourceEffects: expect.arrayContaining([
          expect.objectContaining({
            kind: 'source_group_relabel',
            targetId: 'SOURCE-GROUP-docs',
            before: expect.objectContaining({ kind: 'doc_bundle', title: 'Product Docs' }),
            after: expect.objectContaining({ kind: 'domain_area', title: 'Product Docs', confidence: 0.74 }),
            persistent: true
          })
        ]),
        graphPatchIds: ['patch:docs-relabel']
      }),
      revisionSummary: expect.objectContaining({
        appliedPatchIds: ['patch:docs-relabel'],
        sourceDecisionIds: expect.arrayContaining([expect.stringContaining(relabel.id)])
      })
    })
    await expect(readFile(join(outputDir, 'state', 'source-correction-decisions.jsonl'), 'utf8').catch(() => '')).resolves.toBe(sourceDecisionsBefore)

    const dryRun = await applyContextCorrectionProposal({ outputDir, proposalId: relabel.id, dryRun: true })
    expect(dryRun).toMatchObject({
      action: 'apply',
      dryRun: true,
      written: false,
      submitted: false,
      proposal: expect.objectContaining({ id: relabel.id, status: 'approved' }),
      graphPatch: expect.objectContaining({ id: 'patch:docs-relabel' }),
      preview: expect.objectContaining({ schemaVersion: 'context-correction-preview.v1' }),
      operationPlan: expect.objectContaining({ id: preview.operationPlan.id }),
      diagnostics: expect.arrayContaining([expect.objectContaining({ type: 'correction.proposal.conflict.warning' })])
    })
    await expect(readFile(join(outputDir, 'graph', 'patches.jsonl'), 'utf8')).resolves.not.toContain('patch:docs-relabel')
    await expect(readFile(join(outputDir, 'state', 'source-correction-decisions.jsonl'), 'utf8').catch(() => '')).resolves.toBe(sourceDecisionsBefore)

    const applied = await applyContextCorrectionProposal({ outputDir, proposalId: relabel.id, actor: { type: 'human', name: 'tester' }, generatedAt: '2026-06-07T00:00:04.000Z' })
    expect(applied).toMatchObject({
      action: 'apply',
      dryRun: false,
      written: true,
      submitted: true,
      proposal: expect.objectContaining({ id: relabel.id, status: 'approved' }),
      operationPlan: expect.objectContaining({ kind: 'relabel' }),
      revisionSummary: expect.objectContaining({
        appliedPatchIds: ['patch:docs-relabel'],
        sourceDecisionIds: expect.arrayContaining([expect.stringContaining(relabel.id)])
      })
    })
    const sourceDecisions = await readFile(join(outputDir, 'state', 'source-correction-decisions.jsonl'), 'utf8')
    expect(sourceDecisions).toContain(relabel.id)
    expect(sourceDecisions).toContain('"kind":"relabel"')

    const rehome = docsInbox.proposals.find((proposal) => proposal.kind === 'rehome')
    expect(rehome).toBeDefined()
    if (!rehome) {
      throw new Error('expected rehome proposal')
    }
    const rejected = await rejectContextCorrectionProposal({
      outputDir,
      proposalId: rehome.id,
      actor: { type: 'human', name: 'tester' },
      reason: 'keep current location',
      generatedAt: '2026-06-07T00:00:01.000Z'
    })
    expect(rejected).toMatchObject({
      action: 'reject',
      proposal: expect.objectContaining({ id: rehome.id, status: 'rejected', statusReason: 'keep current location' })
    })

    const rejectedInbox = await listContextPackageCorrections({ outputDir, packageRef: 'PACKAGE-docs', kind: 'rehome', status: 'rejected' })
    expect(rejectedInbox.proposals).toEqual([expect.objectContaining({ id: rehome.id, kind: 'rehome', status: 'rejected' })])
  })

  it('dedupes duplicate correction sources, detects blocking conflicts, and preserves dry-run writes', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'context-package-corrections-trust-'))
    const inventory = seedInventory()
    await writeGraphFiles(seedGraph(), outputDir, { sourceInventory: inventory })
    await writeSources(outputDir, inventory)
    await writeGraphKernelFiles(outputDir, { includeDuplicateRelabel: true, includeMissingTarget: true, includeOverlap: true })

    const docsInbox = await listContextPackageCorrections({ outputDir, packageRef: 'sources/product-docs' })
    const relabels = docsInbox.proposals.filter((proposal) => proposal.kind === 'relabel')
    expect(relabels).toHaveLength(1)
    expect(relabels[0]).toMatchObject({
      graphPatchIds: expect.arrayContaining(['patch:docs-relabel', 'patch:docs-relabel-duplicate', 'patch:docs-relabel-overlap']),
      evidenceReportIds: expect.arrayContaining(['evidence:docs-correction', 'evidence:docs-duplicate', 'evidence:docs-overlap']),
      supersedesProposalIds: expect.arrayContaining([
        expect.stringMatching(/^CORRECTION-relabel-/)
      ]),
      conflicts: expect.arrayContaining([
        expect.objectContaining({ type: 'patch_overlap', severity: 'warning' })
      ])
    })

    const missing = docsInbox.proposals.find((proposal) => proposal.kind === 'confirm_relation')
    expect(missing).toBeDefined()
    if (!missing) {
      throw new Error('expected missing-target proposal')
    }
    expect(missing).toMatchObject({
      blocked: true,
      impact: expect.objectContaining({ updates: 1, riskLevel: 'medium' }),
      conflicts: expect.arrayContaining([
        expect.objectContaining({ type: 'missing_target', severity: 'error', nodeId: 'MISSING-doc-node' })
      ])
    })

    const missingApproved = await approveContextCorrectionProposal({
      outputDir,
      proposalId: missing.id,
      actor: { type: 'human', name: 'tester' },
      generatedAt: '2026-06-07T00:00:02.000Z'
    })
    expect(missingApproved.proposal.status).toBe('approved')
    const blockedApply = await applyContextCorrectionProposal({ outputDir, proposalId: missing.id })
    expect(blockedApply).toMatchObject({
      action: 'apply',
      submitted: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ type: 'correction.proposal.blocked' })])
    })

    const relabel = relabels[0]
    const approved = await approveContextCorrectionProposal({
      outputDir,
      proposalId: relabel.id,
      actor: { type: 'human', name: 'tester' },
      generatedAt: '2026-06-07T00:00:03.000Z'
    })
    expect(approved.proposal.status).toBe('approved')
    const overlayBefore = await readFile(join(outputDir, 'state', 'corrections.jsonl'), 'utf8')
    const submittedBefore = await readFile(join(outputDir, 'graph', 'submitted-patches.jsonl'), 'utf8').catch(() => '')
    const dryRun = await applyContextCorrectionProposal({ outputDir, proposalId: relabel.id, dryRun: true })
    expect(dryRun).toMatchObject({
      action: 'apply',
      dryRun: true,
      written: false,
      submitted: false,
      proposal: expect.objectContaining({ status: 'approved' }),
      graphPatch: expect.objectContaining({ id: 'patch:docs-relabel' }),
      operationPlan: expect.objectContaining({ kind: 'relabel' }),
      diagnostics: expect.arrayContaining([expect.objectContaining({ type: 'correction.proposal.conflict.warning' })])
    })
    await expect(readFile(join(outputDir, 'state', 'corrections.jsonl'), 'utf8')).resolves.toBe(overlayBefore)
    await expect(readFile(join(outputDir, 'graph', 'submitted-patches.jsonl'), 'utf8').catch(() => '')).resolves.toBe(submittedBefore)
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
      createContextNode({ id: 'SOURCE-GROUP-misc', type: 'SourceGroup', name: 'Misc', sourceRefs: [unknownRef], properties: { kind: 'unknown', path: 'sources/misc' } })
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
    pkg('PACKAGE-docs', 'sources/product-docs', 'Product Docs', 'product_docs', ['SOURCE-GROUP-docs'], docRef),
    pkg('PACKAGE-repo', 'sources/repo', 'Repo', 'code_repository', ['SOURCE-GROUP-repo'], codeRef),
    pkg('PACKAGE-misc', 'sources/misc', 'Misc', 'unknown', ['SOURCE-GROUP-misc'], unknownRef)
  ]
  return {
    schemaVersion: 'context-source-inventory.v1',
    entries: [],
    packages,
    groups,
    summary: { roots: 1, files: 0, packages: 3, groups: 3, routed: 0, inventoryOnly: 0, unsupported: 0, skipped: 0 }
  }
}

function group(id: string, path: string, title: string, kind: ContextSourceGroupRecord['kind'], sourceRef: typeof docRef): ContextSourceGroupRecord {
  return { id, sourceName: 'workspace', path, title, kind, boundaryMode: kind === 'repository' ? 'repository' : 'collapsed', summary: title, confidence: 0.9, decisionSource: kind === 'unknown' ? 'inferred' : 'agent', sourceRef }
}

function pkg(id: string, path: string, title: string, kind: ContextPackageRecord['kind'], sourceGroupIds: string[], sourceRef: typeof docRef): ContextPackageRecord {
  return {
    id,
    sourceName: 'workspace',
    path,
    title,
    kind,
    summary: title,
    sourceGroupIds,
    buildUnits: [],
    confidence: kind === 'unknown' ? 0.35 : 0.9,
    decisionSource: kind === 'unknown' ? 'inferred' : 'agent',
    sourceRef
  }
}

async function writeSources(outputDir: string, inventory: ContextSourceInventory): Promise<void> {
  await mkdir(join(outputDir, 'model'), { recursive: true })
  await writeJsonl(join(outputDir, 'model', 'source-inventory.jsonl'), inventory.entries)
  await writeJsonl(join(outputDir, 'model', 'groups.jsonl'), inventory.groups ?? [])
  await writeJsonl(join(outputDir, 'model', 'packages.jsonl'), inventory.packages ?? [])
  await writeJsonl(join(outputDir, 'model', 'build-units.jsonl'), [])
  await writeFile(join(outputDir, 'model', 'source-summary.json'), `${JSON.stringify(inventory.summary, null, 2)}\n`)
}

async function writeGraphKernelFiles(
  outputDir: string,
  options: { includeDuplicateRelabel?: boolean; includeMissingTarget?: boolean; includeOverlap?: boolean } = {}
): Promise<void> {
  const revision: GraphRevision = {
    schemaVersion: 'context-graph-revision.v1',
    id: 'REV-docs',
    createdAt: '2026-06-07T00:00:00.000Z',
    graphFingerprint: 'seed',
    reason: 'seed graph',
    status: 'materialized',
    patchIds: [],
    evidenceReportIds: []
  }
  const patch: GraphPatch = {
    schemaVersion: 'context-graph-patch.v1',
    id: 'patch:docs-relabel',
    revisionId: 'REV-stale',
    author: { type: 'agent', name: 'test' },
    status: 'proposed',
    createdAt: revision.createdAt,
    evidence: [{ type: 'explicit_reference', description: 'Docs read like a domain area.', sourceRefs: [docRef] }],
    evidenceReportIds: ['evidence:docs-correction'],
    operations: [{ op: 'relabel_source_group', nodeId: 'SOURCE-GROUP-docs', kind: 'domain_area', confidence: 0.74 }]
  }
  const duplicatePatch: GraphPatch = {
    ...patch,
    id: 'patch:docs-relabel-duplicate',
    evidenceReportIds: ['evidence:docs-duplicate']
  }
  const overlapPatch: GraphPatch = {
    ...patch,
    id: 'patch:docs-relabel-overlap',
    evidenceReportIds: ['evidence:docs-overlap']
  }
  const missingTargetPatch: GraphPatch = {
    schemaVersion: 'context-graph-patch.v1',
    id: 'patch:docs-missing-target',
    revisionId: revision.id,
    author: { type: 'agent', name: 'test' },
    status: 'proposed',
    createdAt: revision.createdAt,
    evidence: [{ type: 'explicit_reference', description: 'Missing node patch should be blocked.', sourceRefs: [docRef] }],
    evidenceReportIds: ['evidence:docs-missing-target'],
    operations: [{ op: 'update_node', nodeId: 'MISSING-doc-node', properties: { status: 'confirmed' } }]
  }
  await mkdir(join(outputDir, 'graph'), { recursive: true })
  await mkdir(join(outputDir, 'state'), { recursive: true })
  await writeJsonl(join(outputDir, 'graph', 'revisions.jsonl'), [revision])
  await writeJsonl(join(outputDir, 'graph', 'patches.jsonl'), [])
  const reports: EvidenceReport[] = [{
    schemaVersion: 'context-evidence-report.v1',
    id: 'evidence:docs-correction',
    revisionId: revision.id,
    scopeId: scopeIdForPackage('PACKAGE-docs'),
    generatedAt: revision.createdAt,
    summary: 'Docs package needs a package-first correction review.',
    findings: [{
      type: 'relabel_group',
      nodeId: 'SOURCE-GROUP-docs',
      suggestedKind: 'domain_area',
      confidence: 0.74,
      evidence: [{ type: 'explicit_reference', description: 'Docs read like a domain area.', sourceRefs: [docRef] }]
    }],
    proposedPatches: [patch],
    rehomeProposals: []
  }]
  if (options.includeDuplicateRelabel) {
    reports.push({
      schemaVersion: 'context-evidence-report.v1',
      id: 'evidence:docs-duplicate',
      revisionId: revision.id,
      scopeId: scopeIdForPackage('PACKAGE-docs'),
      generatedAt: revision.createdAt,
      summary: 'Duplicate relabel source should merge into the canonical proposal.',
      findings: [{
        type: 'relabel_group',
        nodeId: 'SOURCE-GROUP-docs',
        suggestedKind: 'domain_area',
        confidence: 0.91,
        evidence: [{ type: 'explicit_reference', description: 'Duplicate relabel evidence.', sourceRefs: [docRef] }]
      }],
      proposedPatches: [duplicatePatch],
      rehomeProposals: []
    })
  }
  if (options.includeOverlap) {
    reports.push({
      schemaVersion: 'context-evidence-report.v1',
      id: 'evidence:docs-overlap',
      revisionId: revision.id,
      scopeId: scopeIdForPackage('PACKAGE-docs'),
      generatedAt: revision.createdAt,
      summary: 'Overlapping relabel source should warn.',
      findings: [{
        type: 'relabel_group',
        nodeId: 'SOURCE-GROUP-docs',
        suggestedKind: 'domain_area',
        confidence: 0.82,
        evidence: [{ type: 'explicit_reference', description: 'Overlapping relabel evidence.', sourceRefs: [docRef] }]
      }],
      proposedPatches: [overlapPatch],
      rehomeProposals: []
    })
  }
  if (options.includeMissingTarget) {
    reports.push({
      schemaVersion: 'context-evidence-report.v1',
      id: 'evidence:docs-missing-target',
      revisionId: revision.id,
      scopeId: scopeIdForPackage('PACKAGE-docs'),
      generatedAt: revision.createdAt,
      summary: 'Missing target should block correction apply.',
      findings: [{
        type: 'confirm_fact',
        nodeId: 'MISSING-doc-node',
        confidence: 0.66,
        evidence: [{ type: 'explicit_reference', description: 'Missing node evidence.', sourceRefs: [docRef] }]
      }],
      proposedPatches: [missingTargetPatch],
      rehomeProposals: []
    })
  }
  await writeJsonl(join(outputDir, 'graph', 'evidence-reports.jsonl'), reports)
  await writeJsonl(join(outputDir, 'state', 'rehome-proposals.jsonl'), [{
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
    createdAt: revision.createdAt
  }])
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''))
}
