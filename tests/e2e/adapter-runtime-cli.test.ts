import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('adapter runtime CLI', () => {
  it('lists registered adapter runtime modes and managed runtime status', async () => {
    const cwd = await localSbtFixture()
    const result = await runCli(['adapters', 'list'], { cwd })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('codegraph.graph-adapter')
    expect(result.stdout).toContain('dependency')
    expect(result.stdout).toContain('@colbymchenry/codegraph')
    expect(result.stdout).toContain('microsoft-graphrag.graph-adapter')
    expect(result.stdout).toContain('managed-runtime')
    expect(result.stdout).toContain('missing')
  }, 90000)

  it('does not try to install dependency runtime adapters', async () => {
    const cwd = await localSbtFixture()
    const result = await runCli(['adapters', 'install', 'codegraph.graph-adapter'], { cwd })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('codegraph.graph-adapter')
    expect(result.stdout).toContain('not-required')
  }, 90000)

  it('emits adapter runtime status into run summary and doctor output', async () => {
    const prior = process.env.CONTEXT_GRAPHRAG_RUNTIME
    const cwd = await localSbtFixture()
    process.env.CONTEXT_GRAPHRAG_RUNTIME = 'mock'
    try {
      const compile = await runCli(['compile'], { cwd })
      expect(compile.exitCode).toBe(0)

      const repoScopeSegment = 'scope-source-group-SOURCE-GROUP-workspace-sources-mjsbt-manage-fe'
      await expect(readFile(join(cwd, '.context', 'extensions', 'codegraph.graph-adapter', 'artifacts', repoScopeSegment, 'summary.json'), 'utf8')).resolves.toContain('context-codegraph-adapter-summary.v1')
      await expect(access(join(cwd, '.context', 'extensions', 'codegraph.graph-adapter', 'data', repoScopeSegment, 'staging'))).resolves.toBeUndefined()
      await expect(access(join(cwd, '.context', 'artifacts', 'adapters', 'codegraph.graph-adapter', repoScopeSegment, 'summary.json'))).rejects.toThrow()

      const summary = JSON.parse(await readFile(join(cwd, '.context', 'runtime', 'run-summary.json'), 'utf8')) as {
        adapterRuntimeStatuses?: Array<{ adapterId: string; state: string }>
      }
      expect(summary.adapterRuntimeStatuses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ adapterId: 'codegraph.graph-adapter', state: 'available' })
        ])
      )

      const doctor = await runCli(['doctor'], { cwd })
      expect(doctor.exitCode).toBe(0)
      expect(doctor.stdout).toContain('Adapter runtimes:')
      expect(doctor.stdout).toContain('codegraph.graph-adapter')
    } finally {
      if (prior === undefined) {
        delete process.env.CONTEXT_GRAPHRAG_RUNTIME
      } else {
        process.env.CONTEXT_GRAPHRAG_RUNTIME = prior
      }
    }
  }, 120000)
})

async function localSbtFixture(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'context-adapter-runtime-cli-'))
  const cwd = join(rootDir, 'local-sbt')
  await mkdir(cwd, { recursive: true })
  await cp(join(process.cwd(), 'examples', 'local-sbt', 'context.config.json'), join(cwd, 'context.config.json'))
  await cp(join(process.cwd(), 'examples', 'local-sbt', 'sources'), join(cwd, 'sources'), { recursive: true })
  await mkdir(join(cwd, '.context', 'state'), { recursive: true })
  await writeFile(join(cwd, '.context', 'state', 'grouping-decisions.json'), `${JSON.stringify({
    schemaVersion: 'context-source-grouping-decisions.v1',
    generatedAt: '2026-06-08T00:00:00.000Z',
    agent: 'fixture',
    decisions: [
      {
        path: 'sources/mjsbt-manage-fe',
        kind: 'repository',
        boundaryMode: 'repository',
        title: 'mjsbt-manage-fe',
        summary: 'Frontend management repository.',
        childrenPolicy: 'promote_routed',
        confidence: 0.95
      },
      {
        path: 'sources/product-docs',
        kind: 'doc_bundle',
        boundaryMode: 'collapsed',
        title: 'Product Documentation',
        summary: 'Product documentation bundle.',
        childrenPolicy: 'promote_routed',
        confidence: 0.95
      }
    ]
  }, null, 2)}\n`)
  return cwd
}
