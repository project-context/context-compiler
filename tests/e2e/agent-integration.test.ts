import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'

async function writeIntegrationProject(rootDir: string) {
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await writeFile(
    join(rootDir, 'context.config.json'),
    JSON.stringify(
      {
        sources: [{ type: 'markdown', name: 'product-docs', path: './docs/product' }]
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
  await writeFile(join(rootDir, 'AGENTS.md'), '# Human guidance\n\nKeep this section.\n')
}

describe('agent integration command', () => {
  it('installs Codex and Claude native project files without overwriting user instructions', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-agent-integration-'))
    await writeIntegrationProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    const first = await runCli(['integrate', 'all'], { cwd: rootDir })
    expect(first.exitCode).toBe(0)
    expect(first.stdout).toContain('Integrated agents: codex, claude')
    expect(first.stdout).toContain('Install status: installed')

    const second = await runCli(['integrate', 'all'], { cwd: rootDir })
    expect(second.exitCode).toBe(0)

    const agents = await readFile(join(rootDir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('# Human guidance')
    expect(agents).toContain('Keep this section.')
    expect(agents).toContain('.context/views/project.md')
    expect(agents.match(/BEGIN context-compiler:codex/g)).toHaveLength(1)

    const claude = await readFile(join(rootDir, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('@AGENTS.md')
    expect(claude.match(/BEGIN context-compiler:claude/g)).toHaveLength(1)

    const codexConfig = await readFile(join(rootDir, '.codex', 'config.toml'), 'utf8')
    expect(codexConfig).toContain('[mcp_servers.context_compiler]')
    expect(codexConfig.match(/BEGIN context-compiler:codex-mcp/g)).toHaveLength(1)

    const codexExplorer = await readFile(join(rootDir, '.codex', 'agents', 'context-explorer.toml'), 'utf8')
    expect(codexExplorer).toContain('name = "context-explorer"')
    expect(codexExplorer).toContain('get_context_health')

    const mcpConfig = JSON.parse(await readFile(join(rootDir, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { type: string; command: string; args: string[] }>
    }
    expect(mcpConfig.mcpServers.contextCompiler).toMatchObject({
      type: 'stdio',
      command: 'pnpm',
      args: ['context', '--cwd', '${CLAUDE_PROJECT_DIR:-.}', 'mcp', 'start']
    })

    const codexSkill = await readFile(join(rootDir, '.agents', 'skills', 'context-implementation', 'SKILL.md'), 'utf8')
    expect(codexSkill).toContain('name: context-implementation')
    expect(codexSkill).toContain('Do not scan the full `.context/` tree')
    const claudeSkill = await readFile(join(rootDir, '.claude', 'skills', 'context-implementation', 'SKILL.md'), 'utf8')
    expect(claudeSkill).toContain('name: context-implementation')

    const claudeSettings = JSON.parse(await readFile(join(rootDir, '.claude', 'settings.json'), 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string }> }
    }
    expect(claudeSettings.hooks.PreToolUse).toEqual(
      expect.arrayContaining([expect.objectContaining({ matcher: 'mcp__contextCompiler__query_runtime_provider' })])
    )

    const installPlan = JSON.parse(await readFile(join(rootDir, '.context', 'runtime', 'agent-install-plan.json'), 'utf8')) as {
      files: Array<{ path: string; status: string; detected?: { exists: boolean } }>
    }
    expect(installPlan.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'AGENTS.md', status: 'installed', detected: expect.objectContaining({ exists: true }) }),
        expect.objectContaining({ path: 'CLAUDE.md', status: 'installed', detected: expect.objectContaining({ exists: true }) })
      ])
    )

    const manifest = JSON.parse(await readFile(join(rootDir, '.context', 'manifest.json'), 'utf8')) as {
      runtime: { installStatus: Record<string, string> }
    }
    expect(manifest.runtime.installStatus).toMatchObject({ codex: 'installed', claude: 'installed' })
  })
})
