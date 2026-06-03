import { describe, expect, it } from 'vitest'
import {
  applyManagedBlock,
  buildContextAgentInstallPlan,
  defineContextProject,
  type ContextRuntimeConfig
} from '@context-compiler/core'

const runtimeConfig: ContextRuntimeConfig = {
  skills: [
    {
      id: 'implementation',
      title: 'Implementation',
      content: 'Use implementation context before editing code.'
    },
    {
      id: 'review',
      title: 'Review',
      content: 'Use review context before approving changes.'
    }
  ]
}

describe('agent integration install planning', () => {
  it('plans native Codex and Claude files without requiring user-authored runtime config', () => {
    const config = defineContextProject(
      {
        sources: [{ type: 'markdown', name: 'product-docs', path: './docs/product' }]
      },
      { rootDir: '/repo/local-shop' }
    )

    const plan = buildContextAgentInstallPlan(config, runtimeConfig, { target: 'all' })
    const paths = plan.files.map((file) => file.path)

    expect(plan.schemaVersion).toBe('context-agent-install-plan.v1')
    expect(plan.targetAgents).toEqual(['codex', 'claude'])
    expect(paths).toEqual(
      expect.arrayContaining([
        'AGENTS.md',
        'CLAUDE.md',
        '.codex/config.toml',
        '.codex/agents/context-explorer.toml',
        '.mcp.json',
        '.claude/settings.json',
        '.agents/skills/context-implementation/SKILL.md',
        '.claude/skills/context-implementation/SKILL.md',
        '.agents/skills/context-review/SKILL.md',
        '.claude/skills/context-review/SKILL.md'
      ])
    )
    expect(plan.files.every((file) => file.status === 'planned')).toBe(true)

    const codexSkill = plan.files.find((file) => file.path === '.agents/skills/context-implementation/SKILL.md')
    expect(codexSkill?.content).toContain('name: context-implementation')
    expect(codexSkill?.content).toContain('context task "$ARGUMENTS" --focus implementation')
    expect(codexSkill?.content).toContain('Do not scan the full `.context/` tree')

    const codexExplorer = plan.files.find((file) => file.path === '.codex/agents/context-explorer.toml')
    expect(codexExplorer?.content).toContain('name = "context-explorer"')
    expect(codexExplorer?.content).toContain('get_context_health')

    const claudeInstructions = plan.files.find((file) => file.path === 'CLAUDE.md')
    expect(claudeInstructions?.content).toContain('@AGENTS.md')
    expect(claudeInstructions?.content).toContain('.context/diagnostics/context-health.json')

    const claudeSettings = plan.files.find((file) => file.path === '.claude/settings.json')
    expect(claudeSettings?.content).toContain('mcp__contextCompiler__query_runtime_provider')
  })

  it('updates managed blocks idempotently without deleting user content', () => {
    const original = '# Existing instructions\n\nKeep this human-authored section.\n'
    const first = applyManagedBlock(original, 'context-compiler:codex', 'Use `.context/views/project.md` first.')
    const second = applyManagedBlock(first, 'context-compiler:codex', 'Use `context doctor` before handoff.')

    expect(second).toContain('# Existing instructions')
    expect(second).toContain('Keep this human-authored section.')
    expect(second).not.toContain('Use `.context/views/project.md` first.')
    expect(second).toContain('Use `context doctor` before handoff.')
    expect(second.match(/BEGIN context-compiler:codex/g)).toHaveLength(1)
    expect(second.match(/END context-compiler:codex/g)).toHaveLength(1)
  })
})
