import { describe, expect, it } from 'vitest'
import { createContextEdge, createContextNode, createGraphRevision, type ContextGraph } from '@context-compiler/core'
import { buildScopeFeedbackEvidenceReports, createScopeFeedbackEvidenceComponent } from './index.js'

const productRef = { sourceId: 'workspace', uri: 'file://sources/product/refund.md', location: { path: 'sources/product/refund.md' } }
const codeRef = { sourceId: 'workspace', uri: 'file://sources/app/refund.ts', location: { path: 'sources/app/refund.ts' } }

const graph: ContextGraph = {
  nodes: [
    createContextNode({
      id: 'SOURCE-GROUP-product',
      type: 'SourceGroup',
      name: 'Product docs',
      status: 'hypothesis',
      sourceRefs: [productRef],
      properties: { kind: 'doc_bundle', path: 'sources/product' }
    }),
    createContextNode({
      id: 'SOURCE-GROUP-app',
      type: 'SourceGroup',
      name: 'App repository',
      status: 'hypothesis',
      sourceRefs: [codeRef],
      properties: { kind: 'repository', path: 'sources/app' }
    }),
    createContextNode({
      id: 'API-refund',
      type: 'APIEndpoint',
      name: 'POST /refund',
      sourceRefs: [productRef]
    }),
    createContextNode({
      id: 'SYM-RefundService',
      type: 'CodeSymbol',
      name: 'RefundService',
      sourceRefs: [codeRef]
    })
  ],
  edges: [
    createContextEdge({
      id: 'EDGE-api-impl',
      from: 'API-refund',
      to: 'SYM-RefundService',
      type: 'implemented_by',
      linker: 'test',
      evidence: [{ type: 'name_match', description: 'API matches symbol', sourceRefs: [productRef, codeRef] }]
    })
  ],
  diagnostics: []
}

describe('scope feedback evidence producer', () => {
  it('emits weak parent-graph evidence reports without mutating graph nodes or edges', async () => {
    const component = createScopeFeedbackEvidenceComponent()
    const revision = createGraphRevision(graph, { reason: 'materialized compile graph' })
    const result = await component.process(
      {
        rawArtifacts: [],
        parsedArtifacts: [],
        normalizedRecords: [],
        facts: graph.nodes,
        edges: graph.edges,
        graph,
        packs: [],
        outputArtifacts: [],
        diagnostics: [],
        artifacts: {}
      },
      {
        rootDir: '/repo',
        outputDir: '/repo/.context',
        config: { workspace: { rootDir: '/repo', name: 'repo' }, sources: [] },
        pipelineId: 'compile',
        stage: 'link'
      }
    )

    expect(result.facts).toBeUndefined()
    expect(result.edges).toBeUndefined()
    expect(result.artifacts?.evidenceReports).toEqual([
      expect.objectContaining({
        schemaVersion: 'context-evidence-report.v1',
        revisionId: revision.id,
        findings: [
          expect.objectContaining({
            type: 'link_groups',
            nodeId: 'SOURCE-GROUP-product',
            targetGroupId: 'SOURCE-GROUP-app',
            relationType: 'related_to_group'
          })
        ]
      })
    ])
  })

  it('matches Chinese product documentation with English code profiles and confirms document facts', () => {
    const docRef = { sourceId: 'workspace', uri: 'file://sources/product-docs/intro.md', location: { path: 'sources/product-docs/intro.md' } }
    const codeRef = { sourceId: 'workspace', uri: 'file://sources/mjsbt-manage-fe/src/services/benefitManage/index.ts', location: { path: 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts' } }
    const feedbackGraph: ContextGraph = {
      nodes: [
        createContextNode({
          id: 'SOURCE-GROUP-workspace-sources-product-docs',
          type: 'SourceGroup',
          name: '商保通产品资料',
          sourceRefs: [docRef],
          properties: { kind: 'doc_bundle', path: 'sources/product-docs' }
        }),
        createContextNode({
          id: 'SOURCE-GROUP-workspace-sources-mjsbt-manage-fe',
          type: 'SourceGroup',
          name: 'mjsbt-manage-fe',
          sourceRefs: [codeRef],
          properties: { kind: 'repository', path: 'sources/mjsbt-manage-fe' }
        }),
        createContextNode({
          id: 'MARKDOWN-DOC',
          type: 'Requirement',
          name: '商保通平台介绍',
          sourceRefs: [docRef],
          properties: {
            content: '商保通平台支持上传身份证影像、合作医院、保险公司、权益配置和理赔协助。'
          }
        }),
        createContextNode({
          id: 'SYM-index-ts-uploadFileAPI',
          type: 'CodeSymbol',
          name: 'uploadFileAPI',
          sourceRefs: [codeRef],
          properties: {
            kind: 'function',
            file: 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts',
            imports: [{ module: '@/utils/config', names: ['yhbPrefix'] }],
            requestCalls: [{ path: '/config/uploadFile', method: 'post', prefix: 'yhbPrefix' }]
          }
        }),
        createContextNode({
          id: 'SYM-index-ts-supportedHospitalOptionsAPI',
          type: 'CodeSymbol',
          name: 'supportedHospitalOptionsAPI',
          sourceRefs: [codeRef],
          properties: {
            kind: 'function',
            file: 'sources/mjsbt-manage-fe/src/services/system/hospital/index.ts',
            requestCalls: [{ path: '/backend/supportedHospitalOptions', method: 'get', prefix: 'operationPrefix' }]
          }
        })
      ],
      edges: [],
      diagnostics: []
    }

    const reports = buildScopeFeedbackEvidenceReports(feedbackGraph)

    expect(reports).toEqual([
      expect.objectContaining({
        schemaVersion: 'context-evidence-report.v1',
        findings: expect.arrayContaining([
          expect.objectContaining({
            type: 'link_groups',
            nodeId: 'SOURCE-GROUP-workspace-sources-product-docs',
            targetGroupId: 'SOURCE-GROUP-workspace-sources-mjsbt-manage-fe',
            relationType: 'related_to_group',
            confidence: expect.any(Number)
          }),
          expect.objectContaining({
            type: 'confirm_fact',
            nodeId: 'MARKDOWN-DOC',
            confidence: expect.any(Number)
          })
        ])
      })
    ])
    expect(JSON.stringify(reports)).toContain('上传')
    expect(JSON.stringify(reports)).toContain('uploadFileAPI')
  })

  it('does not emit profile evidence when document and code groups have no meaningful overlap', () => {
    const docRef = { sourceId: 'workspace', uri: 'file://sources/docs/design.md', location: { path: 'sources/docs/design.md' } }
    const codeRef = { sourceId: 'workspace', uri: 'file://sources/app/src/theme.ts', location: { path: 'sources/app/src/theme.ts' } }
    const unrelatedGraph: ContextGraph = {
      nodes: [
        createContextNode({
          id: 'SOURCE-GROUP-docs',
          type: 'SourceGroup',
          name: 'Docs',
          sourceRefs: [docRef],
          properties: { kind: 'doc_bundle', path: 'sources/docs' }
        }),
        createContextNode({
          id: 'SOURCE-GROUP-app',
          type: 'SourceGroup',
          name: 'App',
          sourceRefs: [codeRef],
          properties: { kind: 'repository', path: 'sources/app' }
        }),
        createContextNode({
          id: 'REQ-design',
          type: 'Requirement',
          name: '品牌视觉规范',
          sourceRefs: [docRef],
          properties: { content: '品牌色、字体、插画风格和营销落地页规范。' }
        }),
        createContextNode({
          id: 'SYM-theme',
          type: 'CodeSymbol',
          name: 'themeColor',
          sourceRefs: [codeRef],
          properties: { kind: 'function', file: 'sources/app/src/theme.ts' }
        })
      ],
      edges: [],
      diagnostics: []
    }

    expect(buildScopeFeedbackEvidenceReports(unrelatedGraph)).toEqual([])
  })
})
