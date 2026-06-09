import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyPipelineState } from '@context-compiler/core/kernel'
import { createContextNode, type GraphAdapter, type GraphBuildInput, type GraphBuildResult, type PipelineExecutionContext, type RawArtifact } from '@context-compiler/core/sdk'
import { createScopeAdaptersEnrichComponent } from './index.js'

const sourceRef = {
  sourceId: 'workspace:src-index-ts',
  uri: 'file://sources/repo/src/index.ts',
  location: { path: 'sources/repo/src/index.ts' }
}

const docSourceRef = {
  sourceId: 'workspace:product-docs-product-md',
  uri: 'file://sources/product-docs/product.md',
  location: { path: 'sources/product-docs/product.md' }
}

describe('scope adapter enrichment', () => {
  it('runs matching graph adapters for repository source group scopes and merges canonical output', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-scope-adapters-'))
    const context: PipelineExecutionContext = {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: {
        workspace: { rootDir, name: 'repo' },
        sources: []
      },
      pipelineId: 'compile',
      stage: 'enrich'
    }
    const rawArtifact: RawArtifact = {
      id: 'raw:workspace:sources/repo/src/index.ts',
      kind: 'raw',
      mediaType: 'text/typescript',
      content: 'export const uploadFileAPI = () => request("/config/uploadFile")',
      source: sourceRef,
      metadata: { route: 'code', sourceGroupId: 'SOURCE-GROUP-repo' }
    }
    const adapterCalls: GraphBuildInput[] = []
    const adapter: GraphAdapter = {
      manifest: {
        id: 'test.codegraph',
        title: 'Test codegraph',
        version: '0.1.0',
        scopeKinds: ['source_group'],
        sourceGroupKinds: ['repository'],
        inputs: ['RawArtifact:code'],
        outputs: ['CodeSymbol'],
        deterministic: true,
        requiresNetwork: false,
        stability: 'development'
      },
      async build(input): Promise<GraphBuildResult> {
        adapterCalls.push(input)
        return {
          nodes: [
            createContextNode({
              id: 'SYM-index-ts-uploadFileAPI',
              type: 'code_symbol',
              name: 'uploadFileAPI',
              sourceRefs: [sourceRef]
            })
          ],
          edges: [],
          artifacts: [
            {
              id: 'test-summary',
              path: `${input.artifactDir}/summary.json`,
              mediaType: 'application/json'
            }
          ]
        }
      }
    }

    const component = createScopeAdaptersEnrichComponent({ graphAdapters: [adapter] })
    const result = await component.process({
      ...emptyPipelineState(),
      rawArtifacts: [rawArtifact],
      facts: [
        createContextNode({
          id: 'SOURCE-GROUP-repo',
          type: 'SourceGroup',
          name: 'repo',
          sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/repo', location: { path: 'sources/repo' } }],
          properties: { kind: 'repository', path: 'sources/repo' }
        })
      ],
      artifacts: {
        sourceInventory: {
          schemaVersion: 'context-source-inventory.v1',
          entries: [
            {
              id: 'entry-index',
              sourceName: 'workspace',
              root: './sources',
              path: 'sources/repo/src/index.ts',
              uri: sourceRef.uri,
              mediaType: 'text/typescript',
              sizeBytes: rawArtifact.content.length,
              hash: 'abc',
              route: 'code',
              status: 'routed',
              sourceRef
            }
          ],
          groups: [
            {
              id: 'SOURCE-GROUP-repo',
              sourceName: 'workspace',
              path: 'sources/repo',
              title: 'repo',
              kind: 'repository',
              boundaryMode: 'repository',
              summary: 'repo',
              confidence: 0.9,
              decisionSource: 'agent',
              sourceRef: { sourceId: 'workspace', uri: 'file://sources/repo', location: { path: 'sources/repo' } }
            }
          ],
          summary: { roots: 1, files: 1, routed: 1, inventoryOnly: 0, unsupported: 0, skipped: 0 }
        }
      }
    }, context)

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]).toMatchObject({
      scope: expect.objectContaining({ id: 'scope:source-group:SOURCE-GROUP-repo' }),
      sourceEntries: [expect.objectContaining({ id: 'entry-index' })],
      rawArtifacts: [expect.objectContaining({ id: rawArtifact.id })],
      artifactDir: '.context/extensions/test.codegraph/artifacts/scope-source-group-SOURCE-GROUP-repo'
    })
    expect(result.facts).toEqual([
      expect.objectContaining({
        id: 'SYM-index-ts-uploadFileAPI',
        type: 'CodeSymbol',
        scopeId: 'scope:source-group:SOURCE-GROUP-repo',
        properties: expect.objectContaining({ adapterId: 'test.codegraph' })
      })
    ])
    expect(result.artifacts).toMatchObject({
      graphAdapterArtifacts: [expect.objectContaining({ id: 'test-summary' })],
      graphAdapterRuntimeStatuses: [expect.objectContaining({ adapterId: 'test.codegraph', state: 'not-required' })]
    })
  })

  it('routes markdown document bundles to semantic graph adapters', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-scope-doc-adapters-'))
    const context: PipelineExecutionContext = {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: {
        workspace: { rootDir, name: 'docs' },
        sources: []
      },
      pipelineId: 'compile',
      stage: 'enrich'
    }
    const rawArtifact: RawArtifact = {
      id: 'raw:workspace:sources/product-docs/product.md',
      kind: 'raw',
      mediaType: 'text/markdown',
      content: '# 商保通产品资料',
      source: docSourceRef,
      metadata: { route: 'markdown', sourceGroupId: 'SOURCE-GROUP-docs' }
    }
    const adapterCalls: GraphBuildInput[] = []
    const adapter: GraphAdapter = {
      manifest: {
        id: 'test.graphrag',
        title: 'Test GraphRAG',
        version: '0.1.0',
        scopeKinds: ['source_group'],
        sourceGroupKinds: ['doc_bundle'],
        inputs: ['RawArtifact:text/markdown'],
        outputs: ['Document'],
        deterministic: false,
        requiresNetwork: true,
        stability: 'development'
      },
      async build(input): Promise<GraphBuildResult> {
        adapterCalls.push(input)
        return {
          nodes: [
            createContextNode({
              id: 'GRAPHRAG-DOC-product',
              type: 'Document',
              name: '商保通产品资料',
              sourceRefs: [docSourceRef]
            })
          ],
          edges: []
        }
      }
    }

    const component = createScopeAdaptersEnrichComponent({ graphAdapters: [adapter] })
    const result = await component.process({
      ...emptyPipelineState(),
      rawArtifacts: [rawArtifact],
      artifacts: {
        sourceInventory: {
          schemaVersion: 'context-source-inventory.v1',
          entries: [
            {
              id: 'entry-product',
              sourceName: 'workspace',
              root: './sources',
              path: 'sources/product-docs/product.md',
              uri: docSourceRef.uri,
              mediaType: 'text/markdown',
              sizeBytes: rawArtifact.content.length,
              hash: 'abc',
              route: 'markdown',
              status: 'routed',
              sourceRef: docSourceRef
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
              summary: 'docs',
              confidence: 0.9,
              decisionSource: 'agent',
              sourceRef: { sourceId: 'workspace', uri: 'file://sources/product-docs', location: { path: 'sources/product-docs' } }
            }
          ],
          summary: { roots: 1, files: 1, routed: 1, inventoryOnly: 0, unsupported: 0, skipped: 0 }
        }
      }
    }, context)

    expect(adapterCalls).toHaveLength(1)
    expect(adapterCalls[0]).toMatchObject({
      scope: expect.objectContaining({ id: 'scope:source-group:SOURCE-GROUP-docs' }),
      sourceEntries: [expect.objectContaining({ id: 'entry-product' })],
      rawArtifacts: [expect.objectContaining({ id: rawArtifact.id })]
    })
    expect(result.facts).toEqual([
      expect.objectContaining({ id: 'GRAPHRAG-DOC-product', type: 'Document' })
    ])
  })

  it('automatically installs a missing managed graph adapter runtime before executing the adapter', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-scope-adapters-runtime-'))
    const context: PipelineExecutionContext = {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: {
        workspace: { rootDir, name: 'docs' },
        sources: []
      },
      pipelineId: 'compile',
      stage: 'enrich'
    }
    const rawArtifact: RawArtifact = {
      id: 'raw:workspace:sources/product-docs/product.md',
      kind: 'raw',
      mediaType: 'text/markdown',
      content: '# 商保通产品资料',
      source: docSourceRef,
      metadata: { route: 'markdown', sourceGroupId: 'SOURCE-GROUP-docs' }
    }
    const adapterCalls: GraphBuildInput[] = []
    const adapter: GraphAdapter = {
      manifest: {
        id: 'microsoft-graphrag.graph-adapter',
        title: 'Microsoft GraphRAG',
        version: '0.1.0',
        scopeKinds: ['source_group'],
        sourceGroupKinds: ['doc_bundle'],
        inputs: ['RawArtifact:text/markdown'],
        outputs: ['Document'],
        deterministic: false,
        requiresNetwork: true,
        stability: 'development',
        runtime: {
          mode: 'managed-runtime',
          ecosystem: 'custom',
          packageName: 'fake-graphrag',
          executable: 'fake-graphrag',
          installCommands: [
            { command: process.execPath, args: ['-e', ''] }
          ]
        }
      },
      async build(input): Promise<GraphBuildResult> {
        adapterCalls.push(input)
        return { nodes: [], edges: [] }
      }
    }

    const component = createScopeAdaptersEnrichComponent({ graphAdapters: [adapter] })
    const result = await component.process({
      ...emptyPipelineState(),
      rawArtifacts: [rawArtifact],
      artifacts: {
        sourceInventory: {
          schemaVersion: 'context-source-inventory.v1',
          entries: [
            {
              id: 'entry-product',
              sourceName: 'workspace',
              root: './sources',
              path: 'sources/product-docs/product.md',
              uri: docSourceRef.uri,
              mediaType: 'text/markdown',
              sizeBytes: rawArtifact.content.length,
              hash: 'abc',
              route: 'markdown',
              status: 'routed',
              sourceRef: docSourceRef
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
              summary: 'docs',
              confidence: 0.9,
              decisionSource: 'agent',
              sourceRef: { sourceId: 'workspace', uri: 'file://sources/product-docs', location: { path: 'sources/product-docs' } }
            }
          ],
          summary: { roots: 1, files: 1, routed: 1, inventoryOnly: 0, unsupported: 0, skipped: 0 }
        }
      }
    }, context)

    expect(adapterCalls).toHaveLength(1)
    expect(result.diagnostics ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'adapter.runtime.missing' })
      ])
    )
    expect(result.artifacts).toMatchObject({
      graphAdapterRuntimeStatuses: [expect.objectContaining({ adapterId: 'microsoft-graphrag.graph-adapter', state: 'installed' })]
    })
    await expect(readFile(join(rootDir, '.context', 'extensions', 'microsoft-graphrag.graph-adapter', 'status.json'), 'utf8')).resolves.toContain(
      'microsoft-graphrag.graph-adapter'
    )
  })
})
