import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverProjectInventory, indexCodeProject } from '../index.js'

let workspace: string | undefined

afterEach(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  }
})

async function writeCodeWorkspace(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, 'apps', 'web', 'src'), { recursive: true })
  await mkdir(join(rootDir, 'services', 'api'), { recursive: true })
  await mkdir(join(rootDir, 'services', 'orders'), { recursive: true })
  await mkdir(join(rootDir, 'crates', 'payments', 'src'), { recursive: true })
  await mkdir(join(rootDir, 'native'), { recursive: true })

  await writeFile(join(rootDir, 'apps', 'web', 'package.json'), '{"name":"web"}')
  await writeFile(join(rootDir, 'apps', 'web', 'src', 'app.ts'), 'export function renderRefund() {}')
  await writeFile(join(rootDir, 'services', 'api', 'pyproject.toml'), '[project]\nname = "api"\n')
  await writeFile(join(rootDir, 'services', 'api', 'main.py'), 'def refund_order():\n    pass\n')
  await writeFile(join(rootDir, 'services', 'orders', 'go.mod'), 'module example.com/orders\n')
  await writeFile(join(rootDir, 'services', 'orders', 'order.go'), 'package orders\nfunc RefundOrder() {}\n')
  await writeFile(join(rootDir, 'crates', 'payments', 'Cargo.toml'), '[package]\nname = "payments"\n')
  await writeFile(join(rootDir, 'crates', 'payments', 'src', 'lib.rs'), 'pub fn refund_payment() {}\n')
  await writeFile(join(rootDir, 'native', 'refund.c'), 'void refund_c(void) {}\n')
}

describe('indexCodeProject', () => {
  it('normalizes multi-language symbols and module containment into graph nodes and edges', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-code-index-'))
    await writeCodeWorkspace(workspace)

    const inventory = await discoverProjectInventory({ rootDir: workspace })
    const result = await indexCodeProject({
      rootDir: workspace,
      inventory,
      providerNames: ['tree-sitter']
    })

    expect(result.provider).toBe('tree-sitter')
    expect(result.nodes.map((node) => node.title)).toEqual(
      expect.arrayContaining(['renderRefund', 'refund_order', 'RefundOrder', 'refund_payment', 'refund_c'])
    )
    expect(result.nodes.every((node) => node.type === 'code_symbol' || node.type === 'module')).toBe(true)
    expect(result.edges.map((edge) => edge.type)).toContain('contains')
  })

  it('falls back when the requested provider is unavailable and records a diagnostic', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-code-index-fallback-'))
    await writeCodeWorkspace(workspace)

    const inventory = await discoverProjectInventory({ rootDir: workspace })
    const result = await indexCodeProject({
      rootDir: workspace,
      inventory,
      providerNames: ['scip', 'ctags'],
      fallbackProvider: 'ctags'
    })

    expect(result.provider).toBe('ctags')
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'code_index.provider_unavailable'
    )
    expect(result.nodes.map((node) => node.title)).toContain('refund_payment')
  })
})

