import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'
import { installMockGraphRagRuntimeHooks } from './mock-graphrag.js'

installMockGraphRagRuntimeHooks()

async function writeProject(rootDir: string) {
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await mkdir(join(rootDir, 'docs', 'tests'), { recursive: true })
  await mkdir(join(rootDir, 'src'), { recursive: true })
  await writeFile(
    join(rootDir, 'context.config.json'),
    JSON.stringify(
      {
        sources: [
          { type: 'markdown', name: 'product-docs', path: './docs/product' },
          { type: 'markdown', name: 'test-cases', path: './docs/tests' },
          { type: 'openapi', name: 'api-spec', path: './openapi.yaml' },
          { type: 'code', name: 'source', path: './src' }
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
sourceUri: feishu://doc/refund
---

# 支持订单部分退款

## Acceptance Criteria

- Given a paid order, when a partial refund is requested, then the refunded amount is recorded.

## Related APIs

- POST /api/orders/{id}/refund
`
  )
  await writeFile(
    join(rootDir, 'docs', 'tests', 'refund-tests.md'),
    `---
id: TEST-ORDER-REFUND
type: test_case
domain: order
requirementIds:
  - REQ-ORDER-REFUND-001
---

# 退款测试

## Test Cases

- TC-REFUND-001: supports partial refund
`
  )
  await writeFile(
    join(rootDir, 'openapi.yaml'),
    `openapi: 3.0.3
paths:
  /api/orders/{id}/refund:
    post:
      operationId: refundOrder
      summary: Refund an order
`
  )
  await writeFile(join(rootDir, 'src', 'refund-service.ts'), 'export class RefundService {}\n')
}

describe('context CLI', () => {
  it('cleans the generated .context workspace idempotently', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-compiler-clean-'))
    await mkdir(join(rootDir, '.context', 'graph'), { recursive: true })
    await writeFile(join(rootDir, '.context', 'graph', 'nodes.jsonl'), '{"id":"stale"}\n')

    const clean = await runCli(['clean'], { cwd: rootDir })
    expect(clean.exitCode).toBe(0)
    expect(clean.stdout).toContain('Removed .context')
    await expect(access(join(rootDir, '.context'))).rejects.toThrow()

    const cleanAgain = await runCli(['clean'], { cwd: rootDir })
    expect(cleanAgain.exitCode).toBe(0)
    expect(cleanAgain.stdout).toContain('No .context directory to clean')
  })

  it('initializes, compiles, queries, views, explains, and creates task context', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-compiler-cli-'))
    const init = await runCli(['init'], { cwd: rootDir })
    expect(init.exitCode).toBe(0)
    await expect(readFile(join(rootDir, 'context.config.json'), 'utf8')).resolves.not.toContain('"components"')
    await expect(readFile(join(rootDir, 'context.config.json'), 'utf8')).resolves.not.toContain('"pipelines"')
    await expect(readFile(join(rootDir, 'context.config.json'), 'utf8')).resolves.not.toContain('"project"')
    await expect(readFile(join(rootDir, 'context.config.json'), 'utf8')).resolves.not.toContain('"roles"')

    await writeProject(rootDir)
    const compileChunks: string[] = []
    const compile = await runCli(['compile'], {
      cwd: rootDir,
      progress: true,
      stream: true,
      stdout: (chunk) => compileChunks.push(chunk)
    })
    expect(compile.exitCode).toBe(0)
    expect(compile.stdout).toContain('Compiled')
    expect(compileChunks.join('')).toContain('[compile] started')
    expect(compileChunks.join('')).toContain('[compile] stage ingest started')
    expect(compileChunks.join('')).toContain('[compile] component ingest.local-files started')

    const view = await runCli(['view', 'implementation'], { cwd: rootDir })
    expect(view.stdout).toContain('Implementation Context')
    expect(view.stdout).toContain('REQ-ORDER-REFUND-001')

    const query = await runCli(['query', 'refund'], { cwd: rootDir })
    expect(query.stdout).toContain('REQ-ORDER-REFUND-001')

    const explain = await runCli(['explain', 'REQ-ORDER-REFUND-001'], { cwd: rootDir })
    expect(explain.stdout).toContain('feishu://doc/refund')
    expect(explain.stdout).toContain('exposed_as')

    await mkdir(join(rootDir, '.context', 'tasks'), { recursive: true })
    await writeFile(join(rootDir, '.context', 'tasks', 'stale.md'), 'stale task output\n')
    const task = await runCli(['task', '支持订单部分退款', '--focus', 'implementation', '--module', 'refund'], {
      cwd: rootDir
    })
    expect(task.stdout).toContain('Focus: implementation')
    expect(task.stdout).toContain('TC-REFUND-001')
    await expect(
      readFile(join(rootDir, '.context', 'debug', 'tasks', 'support-partial-refund.implementation.md'), 'utf8')
    ).resolves.toContain('Task Context: 支持订单部分退款')
    await expect(access(join(rootDir, '.context', 'tasks'))).rejects.toThrow()
  })
})
