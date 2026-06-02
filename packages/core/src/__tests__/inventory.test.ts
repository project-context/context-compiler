import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverProjectInventory } from '../index.js'

let workspace: string | undefined

afterEach(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  }
})

async function writePolyglotWorkspace(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, 'apps', 'web', 'src'), { recursive: true })
  await mkdir(join(rootDir, 'services', 'api', 'app'), { recursive: true })
  await mkdir(join(rootDir, 'services', 'api', 'tests'), { recursive: true })
  await mkdir(join(rootDir, 'services', 'orders'), { recursive: true })
  await mkdir(join(rootDir, 'crates', 'payments', 'src'), { recursive: true })
  await mkdir(join(rootDir, 'native', 'src'), { recursive: true })
  await mkdir(join(rootDir, 'docs'), { recursive: true })
  await mkdir(join(rootDir, 'apis'), { recursive: true })

  await writeFile(join(rootDir, 'package.json'), '{"workspaces":["apps/*"]}')
  await writeFile(join(rootDir, 'apps', 'web', 'package.json'), '{"name":"web"}')
  await writeFile(join(rootDir, 'apps', 'web', 'src', 'app.ts'), 'export function renderRefund() {}')
  await writeFile(join(rootDir, 'apps', 'web', 'src', 'app.test.ts'), 'test("refund", () => {})')

  await writeFile(join(rootDir, 'services', 'api', 'pyproject.toml'), '[project]\nname = "api"\n')
  await writeFile(join(rootDir, 'services', 'api', 'app', 'main.py'), 'def refund_order():\n    pass\n')
  await writeFile(join(rootDir, 'services', 'api', 'tests', 'test_main.py'), 'def test_refund_order():\n    pass\n')

  await writeFile(join(rootDir, 'services', 'orders', 'go.mod'), 'module example.com/orders\n')
  await writeFile(join(rootDir, 'services', 'orders', 'order.go'), 'package orders\nfunc RefundOrder() {}\n')
  await writeFile(join(rootDir, 'services', 'orders', 'order_test.go'), 'package orders\nfunc TestRefundOrder() {}\n')

  await writeFile(join(rootDir, 'crates', 'payments', 'Cargo.toml'), '[package]\nname = "payments"\n')
  await writeFile(join(rootDir, 'crates', 'payments', 'src', 'lib.rs'), 'pub fn refund_payment() {}\n')

  await writeFile(join(rootDir, 'native', 'CMakeLists.txt'), 'project(native)\n')
  await writeFile(join(rootDir, 'native', 'src', 'refund.c'), 'void refund_c(void) {}\n')
  await writeFile(join(rootDir, 'native', 'src', 'refund.cpp'), 'void refund_cpp() {}\n')

  await writeFile(join(rootDir, 'docs', 'refund.md'), '# Refund PRD\n')
  await writeFile(join(rootDir, 'apis', 'openapi.yaml'), 'openapi: 3.0.3\npaths: {}\n')
}

describe('discoverProjectInventory', () => {
  it('detects languages, build systems, modules, test paths, docs, and API files', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-inventory-'))
    await writePolyglotWorkspace(workspace)

    const inventory = await discoverProjectInventory({ rootDir: workspace })

    expect(inventory.languages.map((language) => language.name)).toEqual(
      expect.arrayContaining(['typescript', 'python', 'go', 'rust', 'c', 'cpp'])
    )
    expect(inventory.buildSystems.map((buildSystem) => buildSystem.type)).toEqual(
      expect.arrayContaining(['npm', 'python', 'go', 'cargo', 'cmake'])
    )
    expect(inventory.modules.map((module) => module.path)).toEqual(
      expect.arrayContaining([
        '.',
        'apps/web',
        'services/api',
        'services/orders',
        'crates/payments',
        'native'
      ])
    )
    expect(inventory.testPaths.map((testPath) => testPath.path)).toEqual(
      expect.arrayContaining([
        'apps/web/src/app.test.ts',
        'services/api/tests',
        'services/orders/order_test.go'
      ])
    )
    expect(inventory.docPaths.map((docPath) => docPath.path)).toContain('docs')
    expect(inventory.apiFiles.map((apiFile) => apiFile.path)).toContain('apis/openapi.yaml')
  })
})

