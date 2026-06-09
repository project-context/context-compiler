import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildGraphFactHistory, explainGraphFact, revertGraphPatch } from '@context-compiler/core/runtime'
import { applyGraphPatchBatch } from '@context-compiler/core/kernel'
import { writeGraphFiles } from '@context-compiler/core/graph'
import { type GraphPatch } from '@context-compiler/core/graph'
import { createContextEdge, createContextNode, type ContextGraph } from '@context-compiler/core/sdk'
import { createGraphRevision } from '@context-compiler/core/graph'

const sourceRef = {
  sourceId: 'workspace',
  uri: 'file://sources/docs/product.md',
  location: { path: 'sources/docs/product.md' }
}
const codeSourceRef = {
  sourceId: 'workspace',
  uri: 'file://sources/code/upload.ts',
  location: { path: 'sources/code/upload.ts' }
}

function seedGraph(): ContextGraph {
  return {
    nodes: [
      createContextNode({
        id: 'SOURCE-GROUP-docs',
        type: 'SourceGroup',
        name: 'Docs',
        status: 'hypothesis',
        authority: 'inferred',
        confidence: 0.6,
        sourceRefs: [sourceRef],
        properties: { kind: 'doc_bundle', path: 'sources/docs' }
      }),
      createContextNode({
        id: 'SOURCE-GROUP-code',
        type: 'SourceGroup',
        name: 'Code',
        status: 'hypothesis',
        authority: 'inferred',
        confidence: 0.6,
        sourceRefs: [],
        properties: { kind: 'repository', path: 'sources/code' }
      })
    ],
    edges: [],
    diagnostics: []
  }
}

describe('graph fact runtime explain and revert', () => {
  it('hydrates graph facts from provenance, patch ledger, revisions, and evidence reports', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'context-graph-facts-'))
    const graph = seedGraph()
    const baseRevision = createGraphRevision(graph, { reason: 'seed graph', createdAt: '2026-06-04T00:00:00.000Z' })
    const patch: GraphPatch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'PATCH-link-docs-code',
      revisionId: baseRevision.id,
      author: { type: 'kernel', name: 'graph-kernel' },
      status: 'proposed',
      createdAt: baseRevision.createdAt,
      evidence: [{ type: 'semantic_match', description: 'Shared upload terminology', sourceRefs: [sourceRef, codeSourceRef] }],
      evidenceReportIds: ['REPORT-scope-feedback'],
      operations: [
        {
          op: 'link',
          edge: createContextEdge({
            id: 'EDGE-docs-code',
            from: 'SOURCE-GROUP-docs',
            to: 'SOURCE-GROUP-code',
            type: 'related_to_group',
            linker: 'graph-kernel',
            evidence: [{ type: 'semantic_match', description: 'Shared upload terminology', sourceRefs: [sourceRef, codeSourceRef] }]
          })
        }
      ]
    }
    const applied = applyGraphPatchBatch(graph, baseRevision, [patch])
    const nextRevision = applied.revision
    expect(nextRevision).toBeDefined()
    if (!nextRevision) {
      throw new Error('Expected patch batch to create a revision.')
    }

    await writeGraphFiles(applied.graph, outputDir)
    await mkdir(join(outputDir, 'graph'), { recursive: true })
    await writeFile(join(outputDir, 'graph', 'revisions.jsonl'), `${JSON.stringify(baseRevision)}\n${JSON.stringify(nextRevision)}\n`)
    await writeFile(join(outputDir, 'graph', 'patches.jsonl'), `${JSON.stringify(applied.appliedPatches[0])}\n`)
    await writeFile(
      join(outputDir, 'graph', 'evidence-reports.jsonl'),
      `${JSON.stringify({
        schemaVersion: 'context-evidence-report.v1',
        id: 'REPORT-scope-feedback',
        revisionId: baseRevision.id,
        scopeId: 'scope:source-group:docs',
        generatedAt: baseRevision.createdAt,
        summary: 'Docs and code share upload terminology.',
        findings: [
          {
            type: 'link_groups',
            nodeId: 'SOURCE-GROUP-docs',
            targetGroupId: 'SOURCE-GROUP-code',
            relationType: 'related_to_group',
            confidence: 0.8,
            evidence: [{ type: 'semantic_match', description: 'Shared upload terminology', sourceRefs: [sourceRef, codeSourceRef] }]
          }
        ],
        proposedPatches: [],
        rehomeProposals: []
      })}\n`
    )

    const explanation = await explainGraphFact({ outputDir, factId: 'EDGE-docs-code' })

    expect(explanation).toMatchObject({
      factKind: 'edge',
      patches: [expect.objectContaining({ id: 'PATCH-link-docs-code', status: 'applied' })],
      evidenceReports: [expect.objectContaining({ id: 'REPORT-scope-feedback' })],
      provenance: [expect.objectContaining({ patchId: 'PATCH-link-docs-code', operation: 'link', findingTypes: ['link_groups'] })]
    })
    expect(explanation.sourceRefs).toEqual(expect.arrayContaining([sourceRef]))

    const summary = await explainGraphFact({ outputDir, factId: 'EDGE-docs-code', limitSources: 1, limitEvidence: 1, limitRelations: 0, limitProvenance: 1 })
    expect(summary).toMatchObject({
      budget: { mode: 'summary', sources: 1, evidence: 1, relations: 0, provenance: 1 },
      omitted: expect.objectContaining({ sourceRefs: 1, evidence: 1, relations: 1, provenance: 0 })
    })
    expect(summary.sourceRefs).toHaveLength(1)
    expect(summary.relatedEdges).toHaveLength(0)
    expect(summary.provenance[0].evidence).toHaveLength(1)

    const full = await explainGraphFact({ outputDir, factId: 'EDGE-docs-code', mode: 'full' })
    expect(full.omitted).toEqual({ sourceRefs: 0, evidence: 0, relations: 0, provenance: 0 })
    expect(full.sourceRefs).toEqual(expect.arrayContaining([sourceRef, codeSourceRef]))

    const history = await buildGraphFactHistory({ outputDir, factId: 'EDGE-docs-code' })
    expect(history).toMatchObject({
      factKind: 'edge',
      timeline: [
        expect.objectContaining({
          revisionId: nextRevision.id,
          patchId: 'PATCH-link-docs-code',
          operation: 'link',
          findingTypes: ['link_groups'],
          sourceRefCount: 2
        })
      ],
      patches: [expect.objectContaining({ id: 'PATCH-link-docs-code' })],
      evidenceReports: [expect.objectContaining({ id: 'REPORT-scope-feedback' })]
    })

    const dryRun = await revertGraphPatch({ outputDir, patchId: 'PATCH-link-docs-code', dryRun: true })
    expect(dryRun).toMatchObject({
      dryRun: true,
      submitted: false,
      reversePatch: expect.objectContaining({
        operations: [expect.objectContaining({ op: 'deprecate_edge', edgeId: 'EDGE-docs-code' })]
      })
    })

    const submitted = await revertGraphPatch({ outputDir, patchId: 'PATCH-link-docs-code' })
    expect(submitted.submitted).toBe(true)
    expect(await readFile(join(outputDir, 'graph', 'submitted-patches.jsonl'), 'utf8')).toContain('deprecate_edge')
  })
})
