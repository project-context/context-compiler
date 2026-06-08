import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeGraphAdapterManifest, createCodeGraphAdapter, managedCodeGraphWorkerSource, type EmbeddedCodeGraphApi, type EmbeddedCodeGraphInstance } from './index.js'
import { type GraphBuildInput, type RawArtifact } from '@context-compiler/core/sdk'

const sourceRef = {
  sourceId: 'workspace:src-services-benefitManage-index-ts',
  uri: 'file://sources/mjsbt-manage-fe/src/services/benefitManage/index.ts',
  location: { path: 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts' }
}

async function buildInput(rootDir: string, content: string): Promise<GraphBuildInput> {
  const rawArtifact: RawArtifact = {
    id: 'raw:workspace:sources/mjsbt-manage-fe/src/services/benefitManage/index.ts',
    kind: 'raw',
    mediaType: 'text/typescript',
    content,
    source: sourceRef,
    metadata: { route: 'code', sourceGroupId: 'SOURCE-GROUP-repo' }
  }
  return {
    scope: {
      id: 'scope:source-group:SOURCE-GROUP-repo',
      kind: 'source_group',
      sourceGroupId: 'SOURCE-GROUP-repo',
      path: 'sources/mjsbt-manage-fe',
      title: 'mjsbt-manage-fe',
      adapterRefs: [],
      stats: { nodes: 0, edges: 0, diagnostics: 0, files: 1, groups: 1 },
      freshness: { status: 'fresh' },
      indexRefs: {}
    },
    graph: { nodes: [], edges: [], diagnostics: [] },
    rawArtifacts: [rawArtifact],
    sourceEntries: [
      {
        id: 'source-entry-benefit',
        sourceName: 'workspace',
        root: './sources',
        path: 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts',
        uri: sourceRef.uri,
        mediaType: 'text/typescript',
        sizeBytes: content.length,
        hash: 'abc123',
        route: 'code',
        status: 'routed',
        sourceRef
      }
    ],
    rootDir,
    artifactDir: '.context/extensions/codegraph.graph-adapter/artifacts/scope-source-group-SOURCE-GROUP-repo'
  }
}

describe('CodeGraph extension adapter', () => {
  it('worker creates the output directory before writing worker output', () => {
    const source = managedCodeGraphWorkerSource()

    expect(source).toContain("await fs.mkdir(path.dirname(process.argv[3]), { recursive: true })")
    expect(source).toContain('await fs.writeFile(process.argv[3]')
  })

  it('uses embedded CodeGraph API, isolates the index under .context, and maps output to canonical facts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-codegraph-'))
    const initPaths: string[] = []
    const fakeInstance: EmbeddedCodeGraphInstance = {
      async indexAll() {},
      searchNodes(query) {
        expect(query).toBe('uploadFileAPI')
        return [
          {
            node: {
              id: 'cg-upload',
              name: 'uploadFileAPI',
              kind: 'function',
              file: 'src/services/benefitManage/index.ts',
              signature: 'export async function uploadFileAPI(data)'
            }
          }
        ]
      },
      getCallers(id) {
        expect(id).toBe('cg-upload')
        return []
      },
      getCallees(id) {
        expect(id).toBe('cg-upload')
        return [
          { node: { id: 'cg-request', name: 'request', kind: 'function', file: 'src/utils/request.ts' }, edge: { kind: 'calls' } }
        ]
      },
      getImpactRadius(id, depth) {
        expect(id).toBe('cg-upload')
        expect(depth).toBe(2)
        return []
      },
      async buildContext(task, options) {
        expect(task).toContain('uploadFileAPI')
        expect(options).toMatchObject({ format: 'json' })
        return {
          nodes: [
            { id: 'cg-upload', name: 'uploadFileAPI', kind: 'function', file: 'src/services/benefitManage/index.ts' },
            { id: 'cg-request', name: 'request', kind: 'function', file: 'src/utils/request.ts' }
          ],
          edges: [{ from: 'cg-upload', to: 'cg-request', kind: 'calls' }]
        }
      },
      close() {}
    }
    const fakeApi: EmbeddedCodeGraphApi = {
      async init(projectPath) {
        initPaths.push(projectPath)
        return fakeInstance
      }
    }
    const adapter = createCodeGraphAdapter({ codeGraphApi: fakeApi })
    const input = await buildInput(rootDir, 'export async function uploadFileAPI(data) { return request("/config/uploadFile") }')

    const result = await adapter.build(input)

    expect(adapter.manifest).toMatchObject({
      id: 'codegraph.graph-adapter',
      runtime: {
        mode: 'dependency',
        ecosystem: 'node',
        packageName: '@colbymchenry/codegraph'
      },
      metadata: expect.objectContaining({ backend: 'colbymchenry-codegraph-api' })
    })
    expect(codeGraphAdapterManifest.metadata).toMatchObject({ backend: 'colbymchenry-codegraph-api' })
    expect(initPaths).toHaveLength(1)
    expect(initPaths[0]).toContain(join(rootDir, '.context', 'extensions', 'codegraph.graph-adapter', 'data', 'scope-source-group-SOURCE-GROUP-repo', 'staging'))
    await expect(access(join(rootDir, 'sources', 'mjsbt-manage-fe', '.codegraph'))).rejects.toThrow()
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'SYM-index-ts-uploadFileAPI',
          type: 'CodeSymbol',
          name: 'uploadFileAPI',
          sourceRefs: [sourceRef],
          properties: expect.objectContaining({
            backend: 'colbymchenry-codegraph-api',
            codeGraphId: 'cg-upload',
            requestCalls: [expect.objectContaining({ path: '/config/uploadFile' })]
          })
        }),
        expect.objectContaining({ id: 'SYM-request-ts-request', type: 'CodeSymbol', name: 'request' })
      ])
    )
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'calls', from: 'SYM-index-ts-uploadFileAPI', to: 'SYM-request-ts-request' })
      ])
    )
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codegraph-summary-scope-source-group-SOURCE-GROUP-repo',
          path: '.context/extensions/codegraph.graph-adapter/artifacts/scope-source-group-SOURCE-GROUP-repo/summary.json'
        })
      ])
    )
  })
})
