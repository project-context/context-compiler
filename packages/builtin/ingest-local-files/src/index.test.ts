import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineContextProject } from '@context-compiler/core/config'
import { emptyPipelineState } from '@context-compiler/core/kernel'
import { type ContextSourceInventory } from '@context-compiler/core/sdk'
import { createLocalFilesIngestComponent } from './index.js'

async function writeFixture(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, 'sources', 'src'), { recursive: true })
  await mkdir(join(rootDir, 'sources', 'public'), { recursive: true })
  await mkdir(join(rootDir, 'sources', '.git'), { recursive: true })
  await mkdir(join(rootDir, 'sources', 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(rootDir, 'sources', 'product.md'), '# Product\n')
  await writeFile(join(rootDir, 'sources', 'src', 'app.tsx'), 'export function App() { return null }\n')
  await writeFile(join(rootDir, 'sources', '.umirc.ts'), 'export default {}\n')
  await writeFile(join(rootDir, 'sources', '.env'), 'TOKEN=secret\n')
  await writeFile(join(rootDir, 'sources', 'package.json'), '{"name":"demo"}\n')
  await writeFile(join(rootDir, 'sources', 'openapi.yaml'), 'openapi: 3.0.3\npaths: {}\n')
  await writeFile(join(rootDir, 'sources', 'ordinary.yaml'), 'name: not-openapi\n')
  await writeFile(join(rootDir, 'sources', 'public', 'favicon.ico'), Buffer.from([0, 1, 2, 3]))
  await writeFile(join(rootDir, 'sources', 'bundle.zip'), Buffer.from([0x50, 0x4b, 3, 4]))
  await writeFile(join(rootDir, 'sources', '.git', 'config'), '[core]\n')
  await writeFile(join(rootDir, 'sources', 'node_modules', 'pkg', 'index.ts'), 'export const ignored = true\n')
}

async function writeGroupingDecisions(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, '.context', 'state'), { recursive: true })
  await writeFile(
    join(rootDir, '.context', 'state', 'grouping-decisions.json'),
    `${JSON.stringify(
      {
        schemaVersion: 'context-source-grouping-decisions.v1',
        decisions: [
          {
            path: 'sources',
            kind: 'doc_bundle',
            boundaryMode: 'collapsed',
            title: 'Mixed source bundle',
            summary: 'A mixed source bundle used by tests.',
            childrenPolicy: 'promote_routed',
            confidence: 0.9
          }
        ]
      },
      null,
      2
    )}\n`
  )
}

async function writeSourceCorrectionDecisions(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, '.context', 'state'), { recursive: true })
  await writeFile(
    join(rootDir, '.context', 'state', 'source-correction-decisions.jsonl'),
    [
      {
        schemaVersion: 'context-source-correction-decision.v1',
        id: 'SOURCE-CORRECTION-relabel-old',
        dedupeKey: 'relabel:workspace:sources',
        proposalId: 'CORRECTION-relabel-old',
        kind: 'relabel',
        action: 'relabel',
        status: 'applied',
        packageId: 'PACKAGE-workspace-sources',
        sourceGroupId: 'SOURCE-GROUP-workspace-sources',
        sourcePath: 'sources',
        before: { kind: 'doc_bundle', title: 'Mixed source bundle', path: 'sources' },
        after: { kind: 'domain_area', title: 'Old Corrected Domain', path: 'sources' },
        createdAt: '2026-06-06T00:00:00.000Z'
      },
      {
        schemaVersion: 'context-source-correction-decision.v1',
        id: 'SOURCE-CORRECTION-relabel-test',
        dedupeKey: 'relabel:workspace:sources',
        proposalId: 'CORRECTION-relabel-test',
        kind: 'relabel',
        action: 'relabel',
        status: 'applied',
        packageId: 'PACKAGE-workspace-sources',
        sourceGroupId: 'SOURCE-GROUP-workspace-sources',
        sourcePath: 'sources',
        before: { kind: 'doc_bundle', title: 'Mixed source bundle', path: 'sources' },
        after: {
          kind: 'domain_area',
          title: 'Corrected Domain',
          summary: 'A corrected source group inherited from the package correction inbox.',
          confidence: 0.88,
          path: 'sources'
        },
        createdAt: '2026-06-07T00:00:00.000Z',
        appliedRevisionId: 'REV-correction-test'
      },
      {
        schemaVersion: 'context-source-correction-decision.v1',
        id: 'SOURCE-CORRECTION-reverted-test',
        dedupeKey: 'relabel:workspace:reverted',
        proposalId: 'CORRECTION-reverted-test',
        kind: 'relabel',
        action: 'relabel',
        status: 'reverted',
        packageId: 'PACKAGE-workspace-sources',
        sourceGroupId: 'SOURCE-GROUP-workspace-sources',
        sourcePath: 'sources',
        before: { kind: 'doc_bundle', title: 'Mixed source bundle', path: 'sources' },
        after: { kind: 'analysis_bundle', title: 'Should Not Apply', path: 'sources' },
        createdAt: '2026-06-08T00:00:00.000Z'
      }
    ].map((row) => JSON.stringify(row)).join('\n') + '\n'
  )
}

describe('local file source-first ingest', () => {
  it('materializes L0 packages and L1 groups for typed source roots', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-typed-source-packages-'))
    await mkdir(join(rootDir, 'sources', 'product-docs'), { recursive: true })
    await mkdir(join(rootDir, 'sources', 'test-cases'), { recursive: true })
    await mkdir(join(rootDir, 'sources', 'api-spec'), { recursive: true })
    await mkdir(join(rootDir, 'sources', 'source-code'), { recursive: true })
    await writeFile(join(rootDir, 'sources', 'product-docs', 'refund.md'), '# 支持订单部分退款\n')
    await writeFile(join(rootDir, 'sources', 'test-cases', 'refund-tests.md'), '# 退款测试用例\n')
    await writeFile(join(rootDir, 'sources', 'api-spec', 'openapi.yaml'), 'openapi: 3.0.3\npaths: {}\n')
    await writeFile(join(rootDir, 'sources', 'source-code', 'refund-service.ts'), 'export function refund() { return true }\n')
    await mkdir(join(rootDir, '.context', 'state'), { recursive: true })
    await writeFile(
      join(rootDir, '.context', 'state', 'grouping-decisions.json'),
      `${JSON.stringify(
        {
          schemaVersion: 'context-source-grouping-decisions.v1',
          generatedAt: '2026-06-08T00:00:00.000Z',
          agent: 'inferred',
          decisions: [
            {
              path: 'sources',
              kind: 'unknown',
              boundaryMode: 'collapsed',
              title: '未知资料包',
              summary: 'Stale inferred fallback from an earlier compile.',
              childrenPolicy: 'promote_routed',
              confidence: 0.35
            }
          ]
        },
        null,
        2
      )}\n`
    )

    const component = createLocalFilesIngestComponent()
    const result = await component.process?.(emptyPipelineState(), {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: defineContextProject({
        sources: [
          { type: 'markdown', name: 'product-docs', path: './sources/product-docs' },
          { type: 'markdown', name: 'test-cases', path: './sources/test-cases' },
          { type: 'openapi', name: 'api-spec', path: './sources/api-spec/openapi.yaml' },
          { type: 'code', name: 'source', path: './sources/source-code' }
        ]
      }, { rootDir }),
      pipelineId: 'compile',
      stage: 'ingest'
    })

    const inventory = result?.artifacts?.sourceInventory as ContextSourceInventory
    expect(inventory.summary.packages).toBe(4)
    expect(inventory.summary.groups).toBe(4)
    expect(inventory.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'PACKAGE-product-docs-sources-product-docs',
          path: 'sources/product-docs',
          kind: 'product_docs',
          decisionSource: 'typed-source'
        }),
        expect.objectContaining({
          id: 'PACKAGE-api-spec-sources-api-spec-openapi.yaml',
          path: 'sources/api-spec/openapi.yaml',
          kind: 'api_contracts',
          decisionSource: 'typed-source',
          buildUnits: [expect.objectContaining({ standardKind: 'api_contracts', adapterId: 'builtin.openapi' })]
        }),
        expect.objectContaining({
          id: 'PACKAGE-test-cases-sources-test-cases',
          path: 'sources/test-cases',
          kind: 'test_materials',
          decisionSource: 'typed-source'
        }),
        expect.objectContaining({
          id: 'PACKAGE-source-sources-source-code',
          path: 'sources/source-code',
          kind: 'code_repository',
          decisionSource: 'typed-source',
          buildUnits: [expect.objectContaining({ standardKind: 'repository', adapterId: 'codegraph.graph-adapter' })]
        })
      ])
    )
    expect(inventory.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sources/product-docs', kind: 'doc_bundle', decisionSource: 'typed-source' }),
        expect.objectContaining({ path: 'sources/test-cases', kind: 'test_bundle', decisionSource: 'typed-source' }),
        expect.objectContaining({ path: 'sources/api-spec/openapi.yaml', kind: 'api_bundle', decisionSource: 'typed-source' }),
        expect.objectContaining({ path: 'sources/source-code', kind: 'repository', decisionSource: 'typed-source' })
      ])
    )
    expect(result?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'PACKAGE-product-docs-sources-product-docs', type: 'Package' }),
        expect.objectContaining({ id: 'SOURCE-GROUP-product-docs-sources-product-docs', type: 'SourceGroup' }),
        expect.objectContaining({ id: 'PACKAGE-test-cases-sources-test-cases', type: 'Package' }),
        expect.objectContaining({ id: 'SOURCE-GROUP-test-cases-sources-test-cases', type: 'SourceGroup' }),
        expect.objectContaining({ id: 'PACKAGE-api-spec-sources-api-spec-openapi.yaml', type: 'Package' }),
        expect.objectContaining({ id: 'SOURCE-GROUP-api-spec-sources-api-spec-openapi.yaml', type: 'SourceGroup' }),
        expect.objectContaining({ id: 'PACKAGE-source-sources-source-code', type: 'Package' }),
        expect.objectContaining({ id: 'SOURCE-GROUP-source-sources-source-code', type: 'SourceGroup' })
      ])
    )
  })

  it('falls back to an inferred repository package when auto grouping decisions are unavailable', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-source-grouping-request-'))
    await writeFixture(rootDir)

    const component = createLocalFilesIngestComponent()
    const result = await component.process?.(emptyPipelineState(), {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: defineContextProject({ sources: [{ name: 'workspace', path: './sources' }] }, { rootDir }),
      pipelineId: 'compile',
      stage: 'ingest'
    })

    const request = JSON.parse(await readFile(join(rootDir, '.context', 'model', 'grouping-request.json'), 'utf8')) as {
      schemaVersion: string
      sources: Array<{ sourceName: string; candidates: Array<{ path: string; fileCount: number; markers: string[] }> }>
    }
    expect(request.schemaVersion).toBe('context-source-grouping-request.v1')
    expect(request.sources[0]).toMatchObject({ sourceName: 'workspace' })
    expect(request.sources[0].candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sources', fileCount: 9 }),
        expect.objectContaining({ path: 'sources/src', markers: expect.arrayContaining(['code']) })
      ])
    )

    const decisions = JSON.parse(await readFile(join(rootDir, '.context', 'state', 'grouping-decisions.json'), 'utf8')) as {
      schemaVersion: string
      agent?: string
      decisions: Array<{ path: string; kind: string; title: string }>
    }
    expect(decisions).toMatchObject({
      schemaVersion: 'context-source-grouping-decisions.v1',
      agent: 'inferred',
      decisions: [expect.objectContaining({ path: 'sources', kind: 'repository', title: 'sources' })]
    })

    const inventory = result?.artifacts?.sourceInventory as ContextSourceInventory
    expect(inventory.summary.packages).toBe(1)
    expect(inventory.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sources',
          kind: 'repository',
          boundaryMode: 'repository',
          title: 'sources',
          decisionSource: 'inferred'
        })
      ])
    )
    expect(inventory.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sources',
          kind: 'code_repository',
          buildUnits: [
            expect.objectContaining({
              standardKind: 'repository',
              adapterId: 'codegraph.graph-adapter',
              adapterSelection: expect.objectContaining({
                adapterId: 'codegraph.graph-adapter',
                selectionSource: 'default',
                priority: 0
              })
            })
          ]
        })
      ])
    )
  })

  it('splits auto workspace roots into inferred top-level L0 packages and L1 groups', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-auto-source-packages-'))
    await mkdir(join(rootDir, 'sources', 'product-docs'), { recursive: true })
    await mkdir(join(rootDir, 'sources', 'test-cases'), { recursive: true })
    await mkdir(join(rootDir, 'sources', 'api-spec'), { recursive: true })
    await mkdir(join(rootDir, 'sources', 'source-code'), { recursive: true })
    await writeFile(join(rootDir, 'sources', 'product-docs', 'refund.md'), '# 支持订单部分退款\n')
    await writeFile(join(rootDir, 'sources', 'test-cases', 'refund-tests.md'), '# 退款测试用例\n')
    await writeFile(join(rootDir, 'sources', 'api-spec', 'openapi.yaml'), 'openapi: 3.0.3\npaths: {}\n')
    await writeFile(join(rootDir, 'sources', 'source-code', 'refund-service.ts'), 'export function refund() { return true }\n')

    const component = createLocalFilesIngestComponent()
    const result = await component.process?.(emptyPipelineState(), {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: defineContextProject({ sources: [{ name: 'workspace', path: './sources' }] }, { rootDir }),
      pipelineId: 'compile',
      stage: 'ingest'
    })

    const decisions = JSON.parse(await readFile(join(rootDir, '.context', 'state', 'grouping-decisions.json'), 'utf8')) as {
      schemaVersion: string
      agent?: string
      decisions: Array<{ path: string; kind: string }>
    }
    expect(decisions).toMatchObject({
      schemaVersion: 'context-source-grouping-decisions.v1',
      agent: 'inferred',
      decisions: expect.arrayContaining([
        expect.objectContaining({ path: 'sources/api-spec', kind: 'api_bundle' }),
        expect.objectContaining({ path: 'sources/product-docs', kind: 'doc_bundle' }),
        expect.objectContaining({ path: 'sources/source-code', kind: 'repository' }),
        expect.objectContaining({ path: 'sources/test-cases', kind: 'test_bundle' })
      ])
    })
    expect(decisions.decisions).toHaveLength(4)

    const inventory = result?.artifacts?.sourceInventory as ContextSourceInventory
    expect(inventory.summary.packages).toBe(4)
    expect(inventory.summary.groups).toBe(4)
    expect(inventory.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sources/api-spec', kind: 'api_contracts', decisionSource: 'inferred' }),
        expect.objectContaining({ path: 'sources/product-docs', kind: 'product_docs', decisionSource: 'inferred' }),
        expect.objectContaining({ path: 'sources/source-code', kind: 'code_repository', decisionSource: 'inferred' }),
        expect.objectContaining({ path: 'sources/test-cases', kind: 'test_materials', decisionSource: 'inferred' })
      ])
    )
    expect(inventory.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sources/api-spec', kind: 'api_bundle', decisionSource: 'inferred' }),
        expect.objectContaining({ path: 'sources/product-docs', kind: 'doc_bundle', decisionSource: 'inferred' }),
        expect.objectContaining({ path: 'sources/source-code', kind: 'repository', decisionSource: 'inferred' }),
        expect.objectContaining({ path: 'sources/test-cases', kind: 'test_bundle', decisionSource: 'inferred' })
      ])
    )
  })

  it('can ask claude -p to generate grouping decisions for auto sources', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-source-grouping-claude-'))
    await writeFixture(rootDir)
    await mkdir(join(rootDir, 'bin'), { recursive: true })
    const callLog = join(rootDir, 'claude-call.json')
    const fakeClaude = join(rootDir, 'bin', 'claude')
    await writeFile(
      fakeClaude,
      `#!/usr/bin/env node
const fs = require('fs')
fs.writeFileSync(${JSON.stringify(callLog)}, JSON.stringify(process.argv.slice(2)))
console.log(JSON.stringify({
  schemaVersion: 'context-source-grouping-decisions.v1',
  agent: 'claude',
  decisions: [
    {
      path: 'sources',
      kind: 'doc_bundle',
      boundaryMode: 'collapsed',
      title: 'Agent grouped sources',
      summary: 'Claude grouped this mixed source root.',
      childrenPolicy: 'promote_routed',
      confidence: 0.91
    }
  ]
}))
`
    )
    await chmod(fakeClaude, 0o755)

    const previousPath = process.env.PATH
    const previousAgent = process.env.CONTEXT_SOURCE_GROUPING_AGENT
    process.env.PATH = `${join(rootDir, 'bin')}:${previousPath ?? ''}`
    process.env.CONTEXT_SOURCE_GROUPING_AGENT = 'claude'
    try {
      const component = createLocalFilesIngestComponent()
      const result = await component.process?.(emptyPipelineState(), {
        rootDir,
        outputDir: join(rootDir, '.context'),
        config: defineContextProject({ sources: [{ name: 'workspace', path: './sources' }] }, { rootDir }),
        pipelineId: 'compile',
        stage: 'ingest'
      })

      const call = JSON.parse(await readFile(callLog, 'utf8')) as string[]
      expect(call[0]).toBe('-p')
      expect(call[1]).toContain('context-source-grouping-request.v1')
      const decisions = JSON.parse(await readFile(join(rootDir, '.context', 'state', 'grouping-decisions.json'), 'utf8')) as {
        schemaVersion: string
        agent?: string
        decisions: Array<{ path: string; title: string }>
      }
      expect(decisions).toMatchObject({
        schemaVersion: 'context-source-grouping-decisions.v1',
        agent: 'claude',
        decisions: [expect.objectContaining({ path: 'sources', title: 'Agent grouped sources' })]
      })
      const inventory = result?.artifacts?.sourceInventory as ContextSourceInventory
      expect(inventory.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'sources',
            title: 'Agent grouped sources',
            kind: 'doc_bundle'
          })
        ])
      )
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = previousPath
      }
      if (previousAgent === undefined) {
        delete process.env.CONTEXT_SOURCE_GROUPING_AGENT
      } else {
        process.env.CONTEXT_SOURCE_GROUPING_AGENT = previousAgent
      }
    }
  })

  it('materializes L0 package nodes while keeping source groups as build boundaries', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-source-packages-'))
    await writeFixture(rootDir)
    await writeGroupingDecisions(rootDir)

    const component = createLocalFilesIngestComponent()
    const result = await component.process?.(emptyPipelineState(), {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: defineContextProject({ sources: [{ name: 'workspace', path: './sources' }] }, { rootDir }),
      pipelineId: 'compile',
      stage: 'ingest'
    })

    expect(result?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'PACKAGE-workspace-sources',
          type: 'Package',
          name: '产品资料包: Mixed source bundle',
          properties: expect.objectContaining({
            packageKind: 'product_docs',
            sourceGroupIds: ['SOURCE-GROUP-workspace-sources'],
            buildUnits: [
              expect.objectContaining({
                standardKind: 'semantic_corpus',
                adapterId: 'microsoft-graphrag.graph-adapter',
                adapterSelection: expect.objectContaining({
                  adapterId: 'microsoft-graphrag.graph-adapter',
                  selectionSource: 'default',
                  selectionReason: expect.stringContaining('doc_bundle'),
                  priority: 0
                })
              })
            ]
          })
        }),
        expect.objectContaining({
          id: 'SOURCE-GROUP-workspace-sources',
          type: 'SourceGroup',
          name: 'Mixed source bundle'
        })
      ])
    )
    expect(result?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'EDGE-SOURCE-workspace-contains-package-PACKAGE-workspace-sources',
          from: 'SOURCE-workspace',
          to: 'PACKAGE-workspace-sources',
          type: 'contains_package'
        }),
        expect.objectContaining({
          id: 'EDGE-PACKAGE-workspace-sources-contains-source-group-SOURCE-GROUP-workspace-sources',
          from: 'PACKAGE-workspace-sources',
          to: 'SOURCE-GROUP-workspace-sources',
          type: 'contains_source_group'
        })
      ])
    )
  })

  it('inherits source correction decisions after grouping decisions are resolved', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-source-correction-decisions-'))
    await writeFixture(rootDir)
    await writeGroupingDecisions(rootDir)
    await writeSourceCorrectionDecisions(rootDir)

    const component = createLocalFilesIngestComponent()
    const result = await component.process?.(emptyPipelineState(), {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: defineContextProject({ sources: [{ name: 'workspace', path: './sources' }] }, { rootDir }),
      pipelineId: 'compile',
      stage: 'ingest'
    })

    const inventory = result?.artifacts?.sourceInventory as ContextSourceInventory
    expect(inventory.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'SOURCE-GROUP-workspace-sources',
          path: 'sources',
          kind: 'domain_area',
          title: 'Corrected Domain',
          summary: 'A corrected source group inherited from the package correction inbox.',
          confidence: 0.88,
          metadata: expect.objectContaining({
            correctionDecisionIds: ['SOURCE-CORRECTION-relabel-test']
          })
        })
      ])
    )
    expect(inventory.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'PACKAGE-workspace-sources',
          title: '产品资料包: Corrected Domain',
          kind: 'product_docs',
          summary: 'A corrected source group inherited from the package correction inbox.',
          metadata: expect.objectContaining({
            correctionDecisionIds: ['SOURCE-CORRECTION-relabel-test']
          })
        })
      ])
    )
    expect(result?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'SOURCE-GROUP-workspace-sources',
          name: 'Corrected Domain',
          properties: expect.objectContaining({
            kind: 'domain_area',
            summary: 'A corrected source group inherited from the package correction inbox.'
          })
        })
      ])
    )
  })

  it('suggests richer source group kinds from directory and file signals', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-source-group-kinds-'))
    const directories = [
      'apis',
      'assets',
      'analysis',
      'data',
      'design',
      'tests',
      'config',
      'runtime',
      'vendor',
      'generated'
    ]
    for (const directory of directories) {
      await mkdir(join(rootDir, 'sources', directory), { recursive: true })
    }
    await writeFile(join(rootDir, 'sources', 'apis', 'openapi.yaml'), 'openapi: 3.0.3\npaths: {}\n')
    await writeFile(join(rootDir, 'sources', 'assets', 'logo.png'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(rootDir, 'sources', 'analysis', 'report.xlsx'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(rootDir, 'sources', 'data', 'customers.csv'), 'id,name\n1,Alice\n')
    await writeFile(join(rootDir, 'sources', 'design', 'wireframe.png'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(rootDir, 'sources', 'tests', 'refund.test.ts'), 'export const ok = true\n')
    await writeFile(join(rootDir, 'sources', 'config', 'deploy.yaml'), 'service: demo\n')
    await writeFile(join(rootDir, 'sources', 'runtime', 'metrics.json'), '{"requests":1}\n')
    await writeFile(join(rootDir, 'sources', 'vendor', 'sdk.js'), 'export const sdk = true\n')
    await writeFile(join(rootDir, 'sources', 'generated', 'api-client.ts'), 'export const client = true\n')

    const component = createLocalFilesIngestComponent()
    await component.process?.(emptyPipelineState(), {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: defineContextProject({ sources: [{ name: 'workspace', path: './sources' }] }, { rootDir }),
      pipelineId: 'compile',
      stage: 'ingest'
    })

    const request = JSON.parse(await readFile(join(rootDir, '.context', 'model', 'grouping-request.json'), 'utf8')) as {
      sources: Array<{ candidates: Array<{ path: string; suggestedKind: string; markers: string[] }> }>
    }
    const candidates = request.sources[0].candidates
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sources/apis', suggestedKind: 'api_bundle' }),
        expect.objectContaining({ path: 'sources/assets', suggestedKind: 'asset_bundle' }),
        expect.objectContaining({ path: 'sources/analysis', suggestedKind: 'analysis_bundle' }),
        expect.objectContaining({ path: 'sources/data', suggestedKind: 'data_bundle' }),
        expect.objectContaining({ path: 'sources/design', suggestedKind: 'design_bundle' }),
        expect.objectContaining({ path: 'sources/tests', suggestedKind: 'test_bundle' }),
        expect.objectContaining({ path: 'sources/config', suggestedKind: 'config_bundle' }),
        expect.objectContaining({ path: 'sources/runtime', suggestedKind: 'runtime_bundle' }),
        expect.objectContaining({ path: 'sources/vendor', suggestedKind: 'vendor_bundle' }),
        expect.objectContaining({ path: 'sources/generated', suggestedKind: 'generated_bundle' })
      ])
    )
  })

  it('auto-discovers source inventory while routing only supported raw artifacts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-source-first-'))
    await writeFixture(rootDir)
    await writeGroupingDecisions(rootDir)

    const component = createLocalFilesIngestComponent()
    const result = await component.process?.(emptyPipelineState(), {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: defineContextProject({ sources: [{ name: 'workspace', path: './sources' }] }, { rootDir }),
      pipelineId: 'compile',
      stage: 'ingest'
    })

    const inventory = result?.artifacts?.sourceInventory as ContextSourceInventory
    expect(inventory.schemaVersion).toBe('context-source-inventory.v1')
    expect(inventory.summary.packages).toBe(1)
    expect(inventory.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sources',
          kind: 'product_docs',
          buildUnits: [
            expect.objectContaining({
              standardKind: 'semantic_corpus',
              adapterSelection: expect.objectContaining({
                adapterId: 'microsoft-graphrag.graph-adapter',
                selectionSource: 'default'
              })
            })
          ]
        })
      ])
    )
    expect(inventory.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sources',
          kind: 'doc_bundle',
          boundaryMode: 'collapsed',
          title: 'Mixed source bundle'
        })
      ])
    )
    expect(inventory.entries.map((entry) => entry.path).sort()).toEqual(
      [
        'sources/.env',
        'sources/.umirc.ts',
        'sources/bundle.zip',
        'sources/openapi.yaml',
        'sources/ordinary.yaml',
        'sources/package.json',
        'sources/product.md',
        'sources/public/favicon.ico',
        'sources/src/app.tsx'
      ].sort()
    )
    expect(inventory.entries.some((entry) => entry.path.includes('node_modules'))).toBe(false)
    expect(inventory.entries.some((entry) => entry.path.includes('.git'))).toBe(false)
    expect(inventory.entries.find((entry) => entry.path === 'sources/product.md')).toMatchObject({
      mediaType: 'text/markdown',
      route: 'markdown',
      status: 'routed'
    })
    expect(inventory.entries.find((entry) => entry.path === 'sources/src/app.tsx')).toMatchObject({
      mediaType: 'text/typescript',
      route: 'code',
      status: 'routed'
    })
    expect(inventory.entries.find((entry) => entry.path === 'sources/openapi.yaml')).toMatchObject({
      mediaType: 'application/openapi',
      route: 'openapi',
      status: 'routed'
    })
    expect(inventory.entries.find((entry) => entry.path === 'sources/ordinary.yaml')).toMatchObject({
      mediaType: 'application/yaml',
      route: 'inventory',
      status: 'inventory_only'
    })
    expect(inventory.entries.find((entry) => entry.path === 'sources/package.json')).toMatchObject({
      mediaType: 'application/json',
      route: 'inventory',
      status: 'inventory_only'
    })
    expect(inventory.entries.find((entry) => entry.path === 'sources/public/favicon.ico')).toMatchObject({
      mediaType: 'image/x-icon',
      route: 'unsupported',
      status: 'unsupported',
      unsupportedReason: 'adapter-not-configured'
    })
    expect(inventory.entries.find((entry) => entry.path === 'sources/bundle.zip')).toMatchObject({
      mediaType: 'application/zip',
      route: 'unsupported',
      status: 'unsupported',
      unsupportedReason: 'adapter-not-configured'
    })

    expect(result?.rawArtifacts?.map((artifact) => artifact.source.location?.path).sort()).toEqual(
      ['sources/.umirc.ts', 'sources/openapi.yaml', 'sources/product.md', 'sources/src/app.tsx'].sort()
    )
    expect(result?.facts?.map((node) => node.type)).toEqual(expect.arrayContaining(['Source', 'Package', 'SourceGroup', 'SourceSnapshot']))
    expect(result?.facts?.find((node) => node.type === 'SourceGroup')).toMatchObject({
      name: 'Mixed source bundle',
      properties: expect.objectContaining({
        kind: 'doc_bundle',
        boundaryMode: 'collapsed',
        path: 'sources',
        decisionSource: 'agent'
      })
    })
    expect(result?.facts?.some((node) => node.type === 'SourceSnapshot' && node.name === 'sources/public/favicon.ico')).toBe(false)
    expect(result?.edges?.map((edge) => edge.type)).toEqual(expect.arrayContaining(['contains_package', 'contains_source_group', 'contains_snapshot']))
    expect(result?.edges?.map((edge) => edge.type)).not.toContain('contains_group')
  })

  it('materializes deterministic L0/L1 for typed legacy sources without grouping decisions', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-source-typed-'))
    await writeFixture(rootDir)

    const component = createLocalFilesIngestComponent()
    const result = await component.process?.(emptyPipelineState(), {
      rootDir,
      outputDir: join(rootDir, '.context'),
      config: defineContextProject({ sources: [{ type: 'markdown', name: 'product-docs', path: './sources' }] }, { rootDir }),
      pipelineId: 'compile',
      stage: 'ingest'
    })

    const inventory = result?.artifacts?.sourceInventory as ContextSourceInventory
    expect(result?.rawArtifacts?.map((artifact) => artifact.source.location?.path)).toEqual(['sources/product.md'])
    expect(inventory.summary).toMatchObject({ packages: 1, groups: 1 })
    expect(inventory.packages).toEqual([
      expect.objectContaining({
        id: 'PACKAGE-product-docs-sources',
        path: 'sources',
        kind: 'product_docs',
        decisionSource: 'typed-source'
      })
    ])
    expect(inventory.groups).toEqual([
      expect.objectContaining({
        id: 'SOURCE-GROUP-product-docs-sources',
        path: 'sources',
        kind: 'doc_bundle',
        decisionSource: 'typed-source'
      })
    ])
    expect(result?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'PACKAGE-product-docs-sources', type: 'Package' }),
        expect.objectContaining({ id: 'SOURCE-GROUP-product-docs-sources', type: 'SourceGroup' })
      ])
    )
    await expect(readFile(join(rootDir, '.context', 'model', 'grouping-request.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(rootDir, '.context', 'state', 'grouping-decisions.json'), 'utf8')).rejects.toThrow()
  })
})
