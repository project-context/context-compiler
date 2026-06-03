import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadContextConfig } from '@context-compiler/core'

describe('context config loading', () => {
  it('infers workspace metadata from the config file directory without project config', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-config-workspace-'))
    const workspaceDir = join(rootDir, 'shop-workspace')
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(
      join(workspaceDir, 'context.config.json'),
      JSON.stringify({
        sources: [{ type: 'markdown', name: 'product-docs', path: './sources/product-docs' }]
      })
    )

    const loaded = await loadContextConfig(workspaceDir)

    expect(loaded.config.workspace.rootDir).toBe(workspaceDir)
    expect(loaded.config.workspace.name).toBe('shop-workspace')
    expect(loaded.config.sources).toEqual([{ type: 'markdown', name: 'product-docs', path: './sources/product-docs' }])
    expect('project' in loaded.config).toBe(false)
    expect('roles' in loaded.config).toBe(false)
  })

  it('silently ignores generated runtime workspace controls in user config', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-config-runtime-'))
    await writeFile(
      join(rootDir, 'context.config.json'),
      JSON.stringify({
        sources: [{ type: 'markdown', name: 'product-docs', path: './docs/product' }],
        runtime: {
          tools: [{ id: 'manual-tool', title: 'Manual tool', kind: 'query' }]
        }
      })
    )

    const loaded = await loadContextConfig(rootDir)

    expect('runtime' in loaded.config).toBe(false)
    expect(loaded.diagnostics).toEqual([])
  })
})
