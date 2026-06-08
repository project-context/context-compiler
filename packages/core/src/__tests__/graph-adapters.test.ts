import { describe, expect, it } from 'vitest'
import {
  createAdapterRegistry,
  normalizeGraphBuildResult,
  validateGraphBuildResult,
  validateGraphAdapterManifest,
  createContextNode,
  createContextEdge,
  type GraphAdapterManifest,
  type GraphBuildResult,
  type GraphAdapter,
  type GraphBuildInput
} from '@context-compiler/core'

describe('graph adapter contract', () => {
  it('validates adapter manifests before they can participate in scope graph builds', () => {
    const manifest: GraphAdapterManifest = {
      id: 'adapter.docling',
      title: 'Docling adapter',
      version: '0.1.0',
      scopeKinds: ['source_group', 'file'],
      sourceGroupKinds: ['doc_bundle', 'analysis_bundle'],
      inputs: ['SourceSnapshot:pdf'],
      outputs: ['Document', 'Section'],
      deterministic: true,
      requiresNetwork: false,
      stability: 'development',
      externalProjects: ['Docling']
    }

    expect(validateGraphAdapterManifest(manifest)).toEqual([])
    expect(validateGraphAdapterManifest({ ...manifest, id: '' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'graph-adapter.invalid-manifest' })])
    )
  })

  it('normalizes adapter results into canonical graph patches and preserves raw adapter artifacts', () => {
    const result: GraphBuildResult = {
      nodes: [
        {
          id: 'external-node',
          type: 'requirement',
          name: 'External requirement',
          sourceRefs: [],
          status: 'active',
          authority: 'inferred',
          confidence: 0.7,
          tags: [],
          properties: {},
          provenance: [],
          fingerprint: 'external'
        }
      ],
      edges: [
        {
          id: 'external-edge',
          from: 'external-node',
          to: 'external-node',
          type: 'related_to',
          confidence: 0.6,
          evidence: [],
          linker: 'adapter.docling',
          status: 'inferred',
          properties: {},
          provenance: [],
          fingerprint: 'edge'
        }
      ],
      artifacts: [
        {
          id: 'docling-raw',
          path: '.context/extensions/adapter.docling/artifacts/scope-source-group/report.json',
          mediaType: 'application/json'
        }
      ]
    }

    const normalized = normalizeGraphBuildResult(result, {
      adapterId: 'adapter.docling',
      scopeId: 'scope:source-group:docs'
    })

    expect(normalized.nodes[0]).toMatchObject({
      id: 'external-node',
      type: 'Requirement',
      scopeId: 'scope:source-group:docs',
      properties: { adapterId: 'adapter.docling', type: 'requirement' }
    })
    expect(normalized.edges[0]).toMatchObject({
      linker: 'adapter.docling',
      scopeId: 'scope:source-group:docs',
      properties: { adapterId: 'adapter.docling', scopeId: 'scope:source-group:docs' }
    })
    expect(normalized.artifacts?.[0]?.path).toBe('.context/extensions/adapter.docling/artifacts/scope-source-group/report.json')
  })

  it('registers graph adapters and filters them by scope and source group kind', async () => {
    const adapter: GraphAdapter = {
      manifest: {
        id: 'adapter.repository-code',
        title: 'Repository code adapter',
        version: '0.1.0',
        scopeKinds: ['source_group'],
        sourceGroupKinds: ['repository'],
        inputs: ['RawArtifact:code'],
        outputs: ['CodeSymbol'],
        deterministic: true,
        requiresNetwork: false,
        stability: 'development'
      },
      async build(_input: GraphBuildInput): Promise<GraphBuildResult> {
        return { nodes: [], edges: [] }
      }
    }
    const registry = createAdapterRegistry({ graphAdapters: [adapter] })
    const scope = {
      id: 'scope:source-group:repo',
      kind: 'source_group' as const,
      sourceGroupId: 'SOURCE-GROUP-repo',
      title: 'repo',
      adapterRefs: [],
      stats: { nodes: 0, edges: 0, diagnostics: 0, files: 0, groups: 1 },
      freshness: { status: 'fresh' as const },
      indexRefs: {}
    }
    const sourceInventory = {
      schemaVersion: 'context-source-inventory.v1' as const,
      entries: [],
      groups: [
        {
          id: 'SOURCE-GROUP-repo',
          sourceName: 'workspace',
          path: 'sources/repo',
          title: 'repo',
          kind: 'repository' as const,
          boundaryMode: 'repository' as const,
          summary: 'Repository',
          confidence: 0.9,
          decisionSource: 'agent' as const,
          sourceRef: { sourceId: 'workspace', uri: 'file://sources/repo', location: { path: 'sources/repo' } }
        }
      ],
      summary: { roots: 1, files: 0, routed: 0, inventoryOnly: 0, unsupported: 0, skipped: 0 }
    }

    expect(registry.graphAdaptersForScope(scope, sourceInventory).map((candidate) => candidate.manifest.id)).toEqual(['adapter.repository-code'])
    expect(registry.graphAdaptersForScope({ ...scope, sourceGroupId: undefined }, sourceInventory)).toEqual([])
  })

  it('validates adapter build results before they can enter the canonical graph', () => {
    const manifest: GraphAdapterManifest = {
      id: 'adapter.code',
      title: 'Code adapter',
      version: '0.1.0',
      scopeKinds: ['source_group'],
      sourceGroupKinds: ['repository'],
      inputs: ['RawArtifact:code'],
      outputs: ['CodeSymbol'],
      deterministic: true,
      requiresNetwork: false,
      stability: 'development'
    }
    const input: GraphBuildInput = {
      scope: {
        id: 'scope:source-group:repo',
        kind: 'source_group',
        sourceGroupId: 'SOURCE-GROUP-repo',
        title: 'repo',
        adapterRefs: [],
        stats: { nodes: 0, edges: 0, diagnostics: 0, files: 0, groups: 1 },
        freshness: { status: 'fresh' },
        indexRefs: {}
      },
      graph: {
        nodes: [
          createContextNode({
            id: 'SOURCE-GROUP-repo',
            type: 'SourceGroup',
            name: 'repo',
            sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/repo', location: { path: 'sources/repo' } }],
            properties: { kind: 'repository', path: 'sources/repo' }
          })
        ],
        edges: [],
        diagnostics: []
      },
      artifactDir: '.context/extensions/adapter.code/artifacts/scope-source-group-repo'
    }
    const result: GraphBuildResult = {
      nodes: [
        createContextNode({
          id: 'SYM-good',
          type: 'CodeSymbol',
          name: 'good',
          sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/repo/index.ts', location: { path: 'sources/repo/index.ts' } }]
        }),
        createContextNode({ id: 'SYM-missing-source', type: 'CodeSymbol', name: 'bad' }),
        createContextNode({
          id: 'SYM-good',
          type: 'CodeSymbol',
          name: 'dupe',
          sourceRefs: [{ sourceId: 'workspace', uri: 'file://sources/repo/dupe.ts', location: { path: 'sources/repo/dupe.ts' } }]
        })
      ],
      edges: [
        createContextEdge({ id: 'EDGE-missing-endpoint', from: 'SYM-good', to: 'SYM-unknown', type: 'calls', evidence: [] })
      ],
      artifacts: [
        { id: 'bad-artifact', path: '/tmp/outside.json', mediaType: 'application/json' }
      ]
    }

    expect(validateGraphBuildResult(result, { manifest, input })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'graph-adapter.result.missing-source-refs' }),
        expect.objectContaining({ type: 'graph-adapter.result.duplicate-id' }),
        expect.objectContaining({ type: 'graph-adapter.result.missing-edge-endpoint' }),
        expect.objectContaining({ type: 'graph-adapter.result.invalid-artifact-path' })
      ])
    )
  })

  it('rejects non-canonical adapter node types before normalization', () => {
    const manifest: GraphAdapterManifest = {
      id: 'adapter.code',
      title: 'Code adapter',
      version: '0.1.0',
      scopeKinds: ['source_group'],
      inputs: ['RawArtifact:code'],
      outputs: ['CodeSymbol'],
      deterministic: true,
      requiresNetwork: false,
      stability: 'development'
    }
    const input: GraphBuildInput = {
      scope: {
        id: 'scope:source-group:repo',
        kind: 'source_group',
        sourceGroupId: 'SOURCE-GROUP-repo',
        title: 'repo',
        adapterRefs: [],
        stats: { nodes: 0, edges: 0, diagnostics: 0, files: 1, groups: 1 },
        freshness: { status: 'fresh' },
        indexRefs: {}
      },
      graph: { nodes: [], edges: [], diagnostics: [] },
      artifactDir: '.context/extensions/adapter.code/artifacts/scope-source-group-repo'
    }
    const result: GraphBuildResult = {
      nodes: [
        {
          id: 'SYM-lower',
          type: 'code_symbol',
          name: 'lower',
          sourceRefs: [{ sourceId: 'workspace', uri: 'file://repo/index.ts', location: { path: 'repo/index.ts' } }],
          status: 'active',
          authority: 'inferred',
          confidence: 0.8,
          tags: [],
          properties: {},
          provenance: [],
          fingerprint: 'lower'
        }
      ],
      edges: []
    }

    expect(validateGraphBuildResult(result, { manifest, input })).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'graph-adapter.result.non-canonical-node-type' })])
    )
  })
})
