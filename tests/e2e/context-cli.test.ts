import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'

let workspace: string | undefined

afterEach(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  }
})

async function writeExampleShop(rootDir: string) {
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await mkdir(join(rootDir, 'docs', 'tests'), { recursive: true })
  await mkdir(join(rootDir, 'src'), { recursive: true })

  await writeFile(
    join(rootDir, 'context.config.ts'),
    `import { defineContextProject } from '@context-compiler/core'

export default defineContextProject({
  project: {
    name: 'example-shop',
    domains: ['order'],
    defaultLanguage: 'zh-CN'
  },
  sources: [
    { type: 'markdown', name: 'product-docs', path: './docs/product' },
    { type: 'markdown', name: 'test-cases', path: './docs/tests' },
    { type: 'openapi', name: 'api-spec', path: './openapi.yaml' },
    { type: 'git', name: 'source', path: './src' }
  ],
  roles: {
    backend: { include: ['requirement', 'api_contract', 'code_symbol', 'test_case', 'bug'] },
    reviewer: { include: ['*'], diagnostics: true }
  }
})
`
  )

  await writeFile(
    join(rootDir, 'docs', 'product', 'refund.md'),
    `---
id: REQ-ORDER-REFUND-001
type: requirement
domain: order
status: active
owner: product
updatedAt: 2026-06-02T00:00:00.000Z
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
status: active
owner: tester
updatedAt: 2026-06-02T00:00:00.000Z
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
info:
  title: Example Shop
  version: 1.0.0
paths:
  /api/orders/{id}/refund:
    post:
      operationId: refundOrder
      summary: Refund an order
      responses:
        '200':
          description: ok
`
  )

  await writeFile(
    join(rootDir, 'src', 'refund-service.ts'),
    `export class RefundService {
  refundOrder(orderId: string) {
    return orderId
  }
}
`
  )
}

describe('context CLI', () => {
  it('initializes a project config', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-cli-init-'))

    const result = await runCli(['init'], { cwd: workspace })

    expect(result.exitCode).toBe(0)
    await expect(readFile(join(workspace, 'context.config.ts'), 'utf8')).resolves.toContain(
      'defineContextProject'
    )
  })

  it('compiles local project context, prints role views, and explains node provenance', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-cli-compile-'))
    await writeExampleShop(workspace)

    const compile = await runCli(['compile'], { cwd: workspace })
    expect(compile.exitCode).toBe(0)
    expect(compile.stdout).toContain('Compiled 5 nodes')

    await expect(readFile(join(workspace, '.context', 'graph', 'nodes.jsonl'), 'utf8')).resolves.toContain(
      'REQ-ORDER-REFUND-001'
    )
    await expect(
      readFile(join(workspace, '.context', 'context-manifest.json'), 'utf8')
    ).resolves.toContain('example-shop')

    const view = await runCli(['view', 'backend'], { cwd: workspace })
    expect(view.exitCode).toBe(0)
    expect(view.stdout).toContain('Backend Role Context')
    expect(view.stdout).toContain('REQ-ORDER-REFUND-001')

    const explain = await runCli(['explain', 'REQ-ORDER-REFUND-001'], { cwd: workspace })
    expect(explain.exitCode).toBe(0)
    expect(explain.stdout).toContain('feishu://doc/refund')
    expect(explain.stdout).toContain('relates_to')
  })

  it('generates task context markdown from the compiled graph', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-cli-task-'))
    await writeExampleShop(workspace)

    const compile = await runCli(['compile'], { cwd: workspace })
    expect(compile.exitCode).toBe(0)

    const task = await runCli(['task', '支持订单部分退款', '--role', 'backend'], { cwd: workspace })
    expect(task.exitCode).toBe(0)
    expect(task.stdout).toContain('REQ-ORDER-REFUND-001')
    expect(task.stdout).toContain('POST /api/orders/{id}/refund')
    expect(task.stdout).toContain('TC-REFUND-001')

    await expect(
      readFile(join(workspace, '.context', 'tasks', 'support-partial-refund.backend.md'), 'utf8')
    ).resolves.toContain('Task Context: 支持订单部分退款')
  })

  it('prints a clear empty task context for unknown tasks', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-cli-task-empty-'))
    await writeExampleShop(workspace)

    const compile = await runCli(['compile'], { cwd: workspace })
    expect(compile.exitCode).toBe(0)

    const task = await runCli(['task', 'unknown checkout coupon', '--role', 'backend'], {
      cwd: workspace
    })
    expect(task.exitCode).toBe(0)
    expect(task.stdout).toContain('No directly related context found.')
  })
})
