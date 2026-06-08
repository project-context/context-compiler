import { describe, expect, it } from 'vitest'
import { createContextNode, type GraphBuildInput, type RawArtifact } from '@context-compiler/core/sdk'
import { createMicrosoftGraphRagAdapter, MicrosoftGraphRagRuntimeMissingError } from './index.js'

const sourceRef = {
  sourceId: 'workspace:product-docs-product-md',
  uri: 'file://sources/product-docs/product.md',
  location: { path: 'sources/product-docs/product.md' }
}

function buildInput(): GraphBuildInput {
  const rawArtifact: RawArtifact = {
    id: 'raw:workspace:sources/product-docs/product.md',
    kind: 'raw',
    mediaType: 'text/markdown',
    content: '# 商保通产品资料\n\n上传医院、保险和权益配置。',
    source: sourceRef,
    metadata: { route: 'markdown', sourceGroupId: 'SOURCE-GROUP-docs' }
  }
  return {
    scope: {
      id: 'scope:source-group:SOURCE-GROUP-docs',
      kind: 'source_group',
      sourceGroupId: 'SOURCE-GROUP-docs',
      path: 'sources/product-docs',
      title: '产品资料包',
      adapterRefs: [],
      stats: { nodes: 0, edges: 0, diagnostics: 0, files: 1, groups: 1 },
      freshness: { status: 'fresh' },
      indexRefs: {}
    },
    graph: { nodes: [], edges: [], diagnostics: [] },
    rawArtifacts: [rawArtifact],
    sourceEntries: [
      {
        id: 'source-entry-product',
        sourceName: 'workspace',
        root: './sources',
        path: 'sources/product-docs/product.md',
        uri: sourceRef.uri,
        mediaType: 'text/markdown',
        sizeBytes: rawArtifact.content.length,
        hash: 'abc123',
        route: 'markdown',
        status: 'routed',
        sourceRef
      }
    ],
    rootDir: '/tmp/context-graphrag',
    artifactDir: '.context/extensions/microsoft-graphrag.graph-adapter/artifacts/scope-source-group-SOURCE-GROUP-docs'
  }
}

describe('Microsoft GraphRAG extension adapter', () => {
  it('fails fast when a required GraphRAG runtime is not configured', async () => {
    const adapter = createMicrosoftGraphRagAdapter()

    expect(adapter.manifest.runtime).toMatchObject({
      mode: 'managed-runtime',
      ecosystem: 'python',
      packageName: 'graphrag',
      executable: 'graphrag',
      python: {
        minVersion: '3.11',
        maxVersionExclusive: '3.14'
      }
    })
    await expect(adapter.build(buildInput())).rejects.toMatchObject({
      name: 'MicrosoftGraphRagRuntimeMissingError',
      code: 'adapter.runtime.missing',
      installCommand: 'context adapters install microsoft-graphrag.graph-adapter',
      runtimeDir: expect.stringContaining('.context/extensions/microsoft-graphrag.graph-adapter/runtime')
    })
    await expect(adapter.build(buildInput())).rejects.toBeInstanceOf(MicrosoftGraphRagRuntimeMissingError)
  })

  it('delegates to an explicit runtime and returns canonical graph facts', async () => {
    const adapter = createMicrosoftGraphRagAdapter({
      runtime: {
        async build() {
          return {
            nodes: [
              createContextNode({
                id: 'GRAPHRAG-DOC-product',
                type: 'Document',
                name: '商保通产品资料',
                sourceRefs: [sourceRef]
              })
            ],
            edges: [],
            diagnostics: []
          }
        }
      }
    })

    expect(adapter.manifest.runtime).toBeUndefined()
    const result = await adapter.build(buildInput())

    expect(result.nodes).toEqual([
      expect.objectContaining({
        id: 'GRAPHRAG-DOC-product',
        type: 'Document',
        sourceRefs: [sourceRef]
      })
    ])
  })

  it('uses installed managed runtime status as the default GraphRAG build boundary', async () => {
    const adapter = createMicrosoftGraphRagAdapter()
    const result = await adapter.build({
      ...buildInput(),
      adapterConfig: {
        runtimeStatus: {
          schemaVersion: 'context-adapter-runtime-status.v1',
          adapterId: 'microsoft-graphrag.graph-adapter',
          mode: 'managed-runtime',
          state: 'installed',
          requirement: adapter.manifest.runtime!,
          packageName: 'graphrag',
          runtimeDir: '/tmp/context-graphrag/.context/extensions/microsoft-graphrag.graph-adapter/runtime',
          markerPath: '/tmp/context-graphrag/.context/extensions/microsoft-graphrag.graph-adapter/status.json',
          installedAt: '2026-06-05T00:00:00.000Z',
          diagnostics: []
        }
      }
    })

    expect(result.nodes).toEqual([
      expect.objectContaining({
        id: 'GRAPHRAG-DOC-sources-product-docs-product.md',
        type: 'Document',
        properties: expect.objectContaining({
          adapterId: 'microsoft-graphrag.graph-adapter',
          runtimeDir: '/tmp/context-graphrag/.context/extensions/microsoft-graphrag.graph-adapter/runtime'
        })
      })
    ])
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        path: '.context/extensions/microsoft-graphrag.graph-adapter/artifacts/scope-source-group-SOURCE-GROUP-docs/managed-graphrag-summary.json'
      })
    ])
  })
})
