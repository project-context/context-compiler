import { cp, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'
import { installMockGraphRagRuntimeHooks } from './mock-graphrag.js'

installMockGraphRagRuntimeHooks()

const rootDir = process.cwd()

describe('examples', () => {
  it('runs the local-shop example through the default pipeline', async () => {
    const fixtureDir = join(rootDir, 'examples', 'local-shop')
    const cwd = join(await mkdtemp(join(tmpdir(), 'context-local-shop-example-')), 'local-shop')
    await cp(fixtureDir, cwd, {
      recursive: true,
      filter: (path) => basename(path) !== '.context'
    })

    await expect(readFile(join(cwd, 'sources', 'product-docs', 'refund.md'), 'utf8')).resolves.toContain(
      'REQ-ORDER-REFUND-001'
    )
    await expect(readFile(join(cwd, 'sources', 'api-spec', 'openapi.yaml'), 'utf8')).resolves.toContain(
      '/api/orders/{id}/refund'
    )

    const config = JSON.parse(await readFile(join(cwd, 'context.config.json'), 'utf8')) as {
      sources: Array<{ path: string }>
      project?: unknown
      roles?: unknown
      runtime?: unknown
    }
    expect(config.project).toBeUndefined()
    expect(config.roles).toBeUndefined()
    expect(config.runtime).toBeUndefined()
    expect(config.sources.map((source) => source.path)).toEqual(['./sources'])

    const compile = await runCli(['compile'], { cwd })
    expect(compile.exitCode).toBe(0)
    expect(compile.stdout).toContain('Compiled')
    const sourceSummary = JSON.parse(await readFile(join(cwd, '.context', 'model', 'source-summary.json'), 'utf8')) as {
      packages: number
      groups: number
    }
    expect(sourceSummary).toMatchObject({ packages: 4, groups: 4 })

    const query = await runCli(['query', 'refund'], { cwd })
    expect(query.stdout).toContain('REQ-ORDER-REFUND-001')

    const view = await runCli(['view', 'implementation'], { cwd })
    expect(view.stdout).toContain('Implementation Context')

    const task = await runCli(['task', '支持订单部分退款', '--focus', 'implementation', '--module', 'refund'], { cwd })
    expect(task.stdout).toContain('TC-REFUND-001')
  })
})
