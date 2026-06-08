import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineContextProject, emptyPipelineState, type ContextSourceInventory } from '@context-compiler/core'
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
  await mkdir(join(rootDir, '.context', 'sources'), { recursive: true })
  await writeFile(
    join(rootDir, '.context', 'sources', 'grouping-decisions.json'),
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
  await mkdir(join(rootDir, '.context', 'sources'), { recursive: true })
  await writeFile(
    join(rootDir, '.context', 'sources', 'correction-decisions.jsonl'),
    `${JSON.stringify({
      schemaVersion: 'context-source-correction-decision.v1',
      id: 'SOURCE-CORRECTION-relabel-test',
      proposalId: 'CORRECTION-relabel-test',
      kind: 'relabel',
      action: 'relabel',
      status: 'applied',
      packageId: 'PACKAGE-workspace-sources',
      sourceGroupId: 'SOURCE-GROUP-workspace-sources',
      sourcePath: 'sources',
      before: {
        kind: 'doc_bundle',
        title: 'Mixed source bundle'
      },
      after: {
        kind: 'domain_area',
        title: 'Corrected Domain',
        summary: 'A corrected source group inherited from the package correction inbox.',
        confidence: 0.88
      },
      createdAt: '2026-06-07T00:00:00.000Z',
      appliedRevisionId: 'REV-correction-test'
    })}\n`
  )
}

describe('local file source-first ingest', () => {
  it('falls back to an inferred unknown package when auto grouping decisions are unavailable', async () => {
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

    const request = JSON.parse(await readFile(join(rootDir, '.context', 'sources', 'grouping-request.json'), 'utf8')) as {
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

    const decisions = JSON.parse(await readFile(join(rootDir, '.context', 'sources', 'grouping-decisions.json'), 'utf8')) as {
      schemaVersion: string
      agent?: string
      decisions: Array<{ path: string; kind: string; title: string }>
    }
    expect(decisions).toMatchObject({
      schemaVersion: 'context-source-grouping-decisions.v1',
      agent: 'inferred',
      decisions: [expect.objectContaining({ path: 'sources', kind: 'unknown', title: '未知资料包' })]
    })

    const inventory = result?.artifacts?.sourceInventory as ContextSourceInventory
    expect(inventory.summary.packages).toBe(1)
    expect(inventory.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sources',
          kind: 'unknown',
          boundaryMode: 'collapsed',
          title: '未知资料包',
          decisionSource: 'inferred'
        })
      ])
    )
    expect(inventory.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sources',
          kind: 'unknown',
          buildUnits: [
            expect.objectContaining({
              standardKind: 'inventory',
              adapterId: 'builtin.source-inventory',
              adapterSelection: expect.objectContaining({
                adapterId: 'builtin.source-inventory',
                selectionSource: 'default',
                priority: 0
              })
            })
          ]
        })
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
      const decisions = JSON.parse(await readFile(join(rootDir, '.context', 'sources', 'grouping-decisions.json'), 'utf8')) as {
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

    const request = JSON.parse(await readFile(join(rootDir, '.context', 'sources', 'grouping-request.json'), 'utf8')) as {
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

  it('does not require grouping decisions for typed legacy sources', async () => {
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

    expect(result?.rawArtifacts?.map((artifact) => artifact.source.location?.path)).toEqual(['sources/product.md'])
    expect(result?.facts?.some((node) => node.type === 'SourceGroup')).toBe(false)
  })
})
