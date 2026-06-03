import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'

async function writeTraceProject(rootDir: string) {
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await mkdir(join(rootDir, 'docs', 'runtime'), { recursive: true })
  await writeFile(
    join(rootDir, 'context.config.json'),
    JSON.stringify(
      {
        sources: [
          { type: 'markdown', name: 'product-docs', path: './docs/product' },
          { type: 'markdown', name: 'runtime-signals', path: './docs/runtime' }
        ]
      },
      null,
      2
    )
  )
  await writeFile(
    join(rootDir, 'docs', 'product', 'refund.md'),
    `---
id: REQ-ORDER-REFUND-001
type: requirement
domain: order
---

# Support partial refund
`
  )
  await writeFile(
    join(rootDir, 'docs', 'runtime', 'refund-metrics.md'),
    `---
id: RUNTIME-refund-error-rate
type: runtime_signal
providerId: refund-metrics
requiresApproval: true
timeoutMs: 2500
redactionLevel: strict
allowedAgents: codex,claude
---

# Refund API error rate

24h error rate for refund API.
`
  )
}

describe('runtime trace and freshness', () => {
  it('emits compile trace, source fingerprints, and provider policy metadata', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-trace-'))
    await writeTraceProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    const traceLine = (await readFile(join(rootDir, '.context', 'runtime', 'trace.jsonl'), 'utf8')).trim()
    const trace = JSON.parse(traceLine) as {
      schemaVersion: string
      event: string
      pipeline: string
      sourceFingerprints: Array<{ id: string; hash: string; source: { uri: string } }>
    }
    expect(trace).toMatchObject({
      schemaVersion: 'context-runtime-trace.v1',
      event: 'compile',
      pipeline: 'compile'
    })
    expect(trace.sourceFingerprints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ uri: expect.stringContaining('docs/product/refund.md') }),
          hash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      ])
    )

    const summary = JSON.parse(await readFile(join(rootDir, '.context', 'runtime', 'run-summary.json'), 'utf8')) as {
      sourceFingerprints: unknown[]
      freshness: { status: string }
    }
    expect(summary.sourceFingerprints.length).toBeGreaterThanOrEqual(2)
    expect(summary.freshness.status).toBe('fresh')

    const runtimeConfig = JSON.parse(await readFile(join(rootDir, '.context', 'runtime', 'runtime.config.json'), 'utf8')) as {
      providers: Array<{ id: string; policy?: Record<string, unknown> }>
    }
    expect(runtimeConfig.providers.find((provider) => provider.id === 'refund-metrics')?.policy).toMatchObject({
      allowedAgents: ['codex', 'claude'],
      requiresApproval: true,
      timeoutMs: 2500,
      redactionLevel: 'strict'
    })
  })

  it('reports stale context when source fingerprints no longer match', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-stale-'))
    await writeTraceProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    await writeFile(
      join(rootDir, 'docs', 'product', 'refund.md'),
      `---
id: REQ-ORDER-REFUND-001
type: requirement
domain: order
---

# Support partial refund

Changed after compile.
`
    )

    const doctor = await runCli(['doctor'], { cwd: rootDir })
    expect(doctor.exitCode).toBe(0)
    expect(doctor.stdout).toContain('Context freshness: stale')
    expect(doctor.stdout).toContain('docs/product/refund.md')
  })
})
