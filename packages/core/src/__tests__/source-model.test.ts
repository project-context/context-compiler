import { describe, expect, it } from 'vitest'
import {
  applySourceCorrectionDecisions,
  buildInferredUnknownGroupingDecision,
  buildL0Packages,
  buildSourceModelSeedGraph,
  effectiveSourceCorrectionDecisionRows,
  groupingDecisionToSourceGroupRecord,
  sourceRootNode
} from '@context-compiler/core/source-model'
import { type SourceConfig } from '@context-compiler/core/config'
import { type ContextSourceCorrectionDecision } from '@context-compiler/core/source-model'
import { type ContextSourceGroupingDecision } from '@context-compiler/core/sdk'

const source: SourceConfig = { name: 'workspace', path: './sources' }

describe('source-model boundary', () => {
  it('builds L0 packages, L1 groups, seed graph facts, and applies effective source corrections', () => {
    const rootDir = '/repo'
    const decision: ContextSourceGroupingDecision = {
      path: 'sources',
      kind: 'doc_bundle',
      boundaryMode: 'collapsed',
      title: 'Product Docs',
      summary: 'Product documentation bundle.',
      childrenPolicy: 'promote_routed',
      confidence: 0.9
    }
    const originalGroup = groupingDecisionToSourceGroupRecord({ source, rootDir, decision, decisionSource: 'agent' })
    const corrected = applySourceCorrectionDecisions({
      groups: [originalGroup],
      decisions: [
        correctionDecision('SOURCE-CORRECTION-old', '2026-06-01T00:00:00.000Z', {
          kind: 'analysis_bundle',
          title: 'Old Analysis',
          summary: 'Superseded analysis grouping.',
          confidence: 0.7
        }),
        correctionDecision('SOURCE-CORRECTION-new', '2026-06-02T00:00:00.000Z', {
          kind: 'domain_area',
          title: 'Refund Domain',
          summary: 'Corrected domain grouping.',
          confidence: 0.88
        })
      ],
      source,
      rootDir,
      sourceRootPath: 'sources'
    })
    const packages = buildL0Packages('workspace', corrected)
    const seedGraph = buildSourceModelSeedGraph({
      sourceNode: sourceRootNode({ source, rootDir, sourcePath: '/repo/sources', configuredPath: './sources' }),
      packages,
      groups: corrected
    })

    expect(corrected).toEqual([
      expect.objectContaining({
        id: 'SOURCE-GROUP-workspace-sources',
        kind: 'domain_area',
        title: 'Refund Domain',
        metadata: expect.objectContaining({ correctionDecisionIds: ['SOURCE-CORRECTION-new'] })
      })
    ])
    expect(packages).toEqual([
      expect.objectContaining({
        id: 'PACKAGE-workspace-sources',
        kind: 'product_docs',
        buildUnits: [
          expect.objectContaining({
            standardKind: 'semantic_corpus',
            adapterSelection: expect.objectContaining({ adapterId: 'microsoft-graphrag.graph-adapter' })
          })
        ]
      })
    ])
    expect(seedGraph.nodes.map((node) => node.id)).toEqual([
      'PACKAGE-workspace-sources',
      'SOURCE-GROUP-workspace-sources',
      'SOURCE-workspace'
    ])
    expect(seedGraph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'SOURCE-workspace', to: 'PACKAGE-workspace-sources', type: 'contains_package' }),
        expect.objectContaining({ from: 'PACKAGE-workspace-sources', to: 'SOURCE-GROUP-workspace-sources', type: 'contains_source_group' })
      ])
    )
  })

  it('preserves unclassified material as an unknown inventory package', () => {
    const fallback = buildInferredUnknownGroupingDecision('sources/misc')
    const group = groupingDecisionToSourceGroupRecord({ source, rootDir: '/repo', decision: fallback, decisionSource: 'inferred' })
    const [record] = buildL0Packages('workspace', [group])

    expect(group).toMatchObject({
      path: 'sources/misc',
      kind: 'unknown',
      title: '未知资料包',
      decisionSource: 'inferred'
    })
    expect(record).toMatchObject({
      kind: 'unknown',
      buildUnits: [expect.objectContaining({ standardKind: 'inventory', adapterId: 'builtin.source-inventory' })]
    })
  })
})

function correctionDecision(id: string, createdAt: string, after: Record<string, unknown>): ContextSourceCorrectionDecision {
  return {
    schemaVersion: 'context-source-correction-decision.v1',
    id,
    dedupeKey: 'relabel:workspace:sources',
    proposalId: `CORRECTION-${id}`,
    kind: 'relabel',
    action: 'relabel',
    status: 'applied',
    packageId: 'PACKAGE-workspace-sources',
    sourceGroupId: 'SOURCE-GROUP-workspace-sources',
    sourcePath: 'sources',
    before: { kind: 'doc_bundle', title: 'Product Docs', path: 'sources' },
    after,
    createdAt
  }
}

expect(effectiveSourceCorrectionDecisionRows).toBeTypeOf('function')
