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

async function writeLargeRepoFixture(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, 'apps', 'web', 'src'), { recursive: true })
  await mkdir(join(rootDir, 'services', 'api'), { recursive: true })
  await mkdir(join(rootDir, 'services', 'orders'), { recursive: true })
  await mkdir(join(rootDir, 'crates', 'payments', 'src'), { recursive: true })
  await mkdir(join(rootDir, 'native'), { recursive: true })
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await mkdir(join(rootDir, 'apis'), { recursive: true })

  await writeFile(
    join(rootDir, 'context.config.ts'),
    `import { defineContextProject } from '@context-compiler/core'

export default defineContextProject({
  project: {
    name: 'large-system',
    domains: ['payments'],
    defaultLanguage: 'zh-CN'
  },
  sources: [
    { type: 'code', name: 'main-repo', path: '.', strategy: 'auto' },
    { type: 'markdown', name: 'business-docs', path: './docs/product' },
    { type: 'openapi', name: 'api-specs', path: './apis' }
  ],
  codeIndex: {
    languages: 'auto',
    providers: ['scip', 'tree-sitter', 'ctags'],
    fallbackProvider: 'ctags',
    deepAnalysisProviders: []
  },
  roles: {
    backend: { include: ['*'], diagnostics: true }
  }
})
`
  )

  await writeFile(join(rootDir, 'apps', 'web', 'package.json'), '{"name":"web"}')
  await writeFile(join(rootDir, 'apps', 'web', 'src', 'app.ts'), 'export function renderRefund() {}')
  await writeFile(join(rootDir, 'services', 'api', 'pyproject.toml'), '[project]\nname = "api"\n')
  await writeFile(join(rootDir, 'services', 'api', 'main.py'), 'def refund_order():\n    pass\n')
  await writeFile(join(rootDir, 'services', 'orders', 'go.mod'), 'module example.com/orders\n')
  await writeFile(join(rootDir, 'services', 'orders', 'order.go'), 'package orders\nfunc RefundOrder() {}\n')
  await writeFile(join(rootDir, 'crates', 'payments', 'Cargo.toml'), '[package]\nname = "payments"\n')
  await writeFile(join(rootDir, 'crates', 'payments', 'src', 'lib.rs'), 'pub fn refund_payment() {}\n')
  await writeFile(join(rootDir, 'native', 'refund.cpp'), 'void refund_cpp() {}\n')

  await writeFile(
    join(rootDir, 'docs', 'product', 'refund.md'),
    `---
id: REQ-PAYMENT-REFUND-001
type: requirement
domain: payments
status: active
owner: product
updatedAt: 2026-06-02T00:00:00.000Z
---

# 支持支付退款

## Acceptance Criteria

- Refund requests persist payment refund records.

## Related APIs

- POST /api/payments/{id}/refund
`
  )

  await writeFile(
    join(rootDir, 'apis', 'openapi.yaml'),
    `openapi: 3.0.3
info:
  title: Large System
  version: 1.0.0
paths:
  /api/payments/{id}/refund:
    post:
      operationId: refundPayment
      summary: Refund a payment
      responses:
        '200':
          description: ok
`
  )
}

describe('language-agnostic large repo context workflow', () => {
  it('discovers inventory, indexes code, partitions graph output, queries context, and scopes task context by module', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-large-repo-'))
    await writeLargeRepoFixture(workspace)

    const inventory = await runCli(['inventory'], { cwd: workspace })
    expect(inventory.exitCode).toBe(0)
    expect(inventory.stdout).toContain('typescript')
    expect(inventory.stdout).toContain('python')
    expect(inventory.stdout).toContain('rust')
    await expect(readFile(join(workspace, '.context', 'inventory.json'), 'utf8')).resolves.toContain(
      'large-system'
    )

    const index = await runCli(['index'], { cwd: workspace })
    expect(index.exitCode).toBe(0)
    expect(index.stdout).toContain('Indexed')
    await expect(
      readFile(join(workspace, '.context', 'indexes', 'code', 'symbols.jsonl'), 'utf8')
    ).resolves.toContain('refund_payment')

    const compile = await runCli(['compile'], { cwd: workspace })
    expect(compile.exitCode).toBe(0)
    await expect(
      readFile(join(workspace, '.context', 'graph', 'nodes', 'code_symbol.jsonl'), 'utf8')
    ).resolves.toContain('refund_payment')

    const query = await runCli(['query', 'refund payment'], { cwd: workspace })
    expect(query.exitCode).toBe(0)
    expect(query.stdout).toContain('REQ-PAYMENT-REFUND-001')
    expect(query.stdout).toContain('refund_payment')

    const task = await runCli(['task', 'refund', '--role', 'backend', '--module', 'payments'], {
      cwd: workspace
    })
    expect(task.exitCode).toBe(0)
    expect(task.stdout).toContain('refund_payment')
    expect(task.stdout).not.toContain('renderRefund')

    const explain = await runCli(
      ['explain', 'CODE-crates-payments-src-lib-refund-payment', '--expand', 'calls'],
      { cwd: workspace }
    )
    expect(explain.exitCode).toBe(0)
    expect(explain.stdout).toContain('Expanded Edge Types: calls')
  })
})
