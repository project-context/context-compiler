import type {
  ContextAgentInstallFile,
  ContextAgentInstallPlan,
  ContextAgentTarget,
  ContextProjectConfig,
  ContextRuntimeConfig,
  ContextSkillDefinition
} from '../contracts/index.js'

const DEFAULT_SKILLS: ContextSkillDefinition[] = [
  {
    id: 'implementation',
    title: 'Implementation',
    content: 'Use implementation context when changing code.'
  },
  {
    id: 'review',
    title: 'Review',
    content: 'Use review context when reviewing changes.'
  },
  {
    id: 'testing',
    title: 'Testing',
    content: 'Use testing context when planning or validating coverage.'
  }
]

/** Build the explicit install plan for repo-native Codex and Claude Code integration files. */
export function buildContextAgentInstallPlan(
  config: ContextProjectConfig,
  runtimeConfig: ContextRuntimeConfig = {},
  options: { target?: ContextAgentTarget; generatedAt?: string } = {}
): ContextAgentInstallPlan {
  const targetAgents = targetAgentsFor(options.target ?? 'all')
  const skills = normalizeSkills(runtimeConfig.skills)
  const files: ContextAgentInstallFile[] = []

  if (targetAgents.includes('codex')) {
    files.push(
      managedFile('codex', 'AGENTS.md', 'context-compiler:codex', renderAgentsInstructions(config)),
      managedFile('codex', '.codex/config.toml', 'context-compiler:codex-mcp', renderCodexMcpConfig()),
      generatedFile('codex', '.codex/agents/context-explorer.toml', renderCodexExplorerAgent()),
      ...skills.map((skill) => generatedFile('codex', `.agents/skills/context-${safeId(skill.id)}/SKILL.md`, renderSkill(skill)))
    )
  }

  if (targetAgents.includes('claude')) {
    files.push(
      managedFile('claude', 'CLAUDE.md', 'context-compiler:claude', renderClaudeInstructions()),
      mergeJsonFile('claude', '.mcp.json', renderClaudeMcpJson()),
      mergeJsonFile('claude', '.claude/settings.json', renderClaudeSettingsJson()),
      ...skills.map((skill) => generatedFile('claude', `.claude/skills/context-${safeId(skill.id)}/SKILL.md`, renderSkill(skill)))
    )
  }

  return {
    schemaVersion: 'context-agent-install-plan.v1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    targetAgents,
    files,
    metadata: {
      workspace: config.workspace.name,
      outputDir: config.outputDir ?? '.context'
    }
  }
}

/** Insert or replace a comment-delimited generated block while preserving surrounding content. */
export function applyManagedBlock(existing: string, marker: string, content: string): string {
  const start = `<!-- BEGIN ${marker} -->`
  const end = `<!-- END ${marker} -->`
  const block = `${start}\n${content.trim()}\n${end}`
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`)
  if (pattern.test(existing)) {
    return ensureTrailingNewline(existing.replace(pattern, block))
  }
  const separator = existing.trim().length > 0 ? '\n\n' : ''
  return ensureTrailingNewline(`${existing.trimEnd()}${separator}${block}`)
}

function targetAgentsFor(target: ContextAgentTarget): Array<'codex' | 'claude'> {
  if (target === 'codex') return ['codex']
  if (target === 'claude') return ['claude']
  return ['codex', 'claude']
}

function normalizeSkills(skills: ContextSkillDefinition[] | undefined): ContextSkillDefinition[] {
  return (skills && skills.length > 0 ? skills : DEFAULT_SKILLS).filter((skill) => skill.id !== 'product' && skill.id !== 'design')
}

function managedFile(agent: 'codex' | 'claude', path: string, marker: string, content: string): ContextAgentInstallFile {
  return { agent, path, mode: 'managed-block', marker, content, status: 'planned' }
}

function generatedFile(agent: 'codex' | 'claude', path: string, content: string): ContextAgentInstallFile {
  return { agent, path, mode: 'write-generated', content, status: 'planned' }
}

function mergeJsonFile(agent: 'codex' | 'claude', path: string, content: string): ContextAgentInstallFile {
  return { agent, path, mode: 'merge-json', content, status: 'planned' }
}

function renderAgentsInstructions(config: ContextProjectConfig): string {
  const outputDir = config.outputDir ?? '.context'
  return [
    '## Context Compiler',
    '',
    `- Treat \`${outputDir}/\` as the generated local context runtime workspace.`,
    '- Prefer the Context Compiler MCP server over manually scanning generated context files.',
    '- Start by calling `get_context_health` and `get_context_manifest` when project context matters.',
    `- Use \`${outputDir}/views/project.md\` only as a short human-readable orientation snapshot.`,
    '- For implementation work, call `get_task_context` or run `context task "<task>" --focus implementation` when task context matters.',
    '- Run `context doctor` before handoff when context quality or freshness matters.',
    `- Use MCP config from \`${outputDir}/mcp/server.config.json\` when an agent-native MCP client is available.`
  ].join('\n')
}

function renderClaudeInstructions(): string {
  return [
    '@AGENTS.md',
    '',
    '## Claude Code',
    '',
    '- Prefer the Context Compiler MCP server before manually scanning generated `.context` files.',
    '- Use `.claude/skills/context-*` skills for implementation, review, and testing workflows.',
    '- Use MCP resources such as `context://manifest`, `context://health`, and `context://views/project` when available.',
    '- Check `.context/diagnostics/context-health.json` when context looks stale or incomplete.'
  ].join('\n')
}

function renderCodexMcpConfig(): string {
  return [
    '[mcp_servers.context_compiler]',
    'command = "pnpm"',
    'args = ["context", "--cwd", ".", "mcp", "start"]',
    'cwd = "."',
    'startup_timeout_sec = 10',
    'tool_timeout_sec = 60',
    'enabled = true'
  ].join('\n')
}

function renderCodexExplorerAgent(): string {
  return [
    'name = "context-explorer"',
    'description = "Read-only Codex subagent for exploring compiled .context runtime evidence before broad repository scans."',
    'developer_instructions = """',
    'Use the context_compiler MCP server first.',
    'Start with get_context_health and get_context_manifest.',
    'Use search_context, get_task_context, get_source_trace, and explain_capability to gather focused evidence.',
    'Do not scan the full .context tree unless MCP is unavailable.',
    'Return concise findings with source node ids, source uris, confidence, freshness, and any diagnostics.',
    '"""'
  ].join('\n')
}

function renderClaudeMcpJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        contextCompiler: {
          type: 'stdio',
          command: 'pnpm',
          args: ['context', '--cwd', '${CLAUDE_PROJECT_DIR:-.}', 'mcp', 'start']
        }
      }
    },
    null,
    2
  )
}

function renderClaudeSettingsJson(): string {
  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: 'mcp__contextCompiler__query_runtime_provider',
            hooks: [
              {
                type: 'command',
                command: 'context doctor'
              }
            ]
          }
        ]
      }
    },
    null,
    2
  )
}

function renderSkill(skill: ContextSkillDefinition): string {
  const id = safeId(skill.id)
  return [
    '---',
    `name: context-${id}`,
    `description: Use when ${skill.title.toLowerCase()} work needs compiled project context, source evidence, diagnostics, or task-focused context.`,
    '---',
    '',
    `# ${skill.title} Context`,
    '',
    'Use this skill when the task needs compiled project context, linked source evidence, diagnostics, or freshness checks.',
    '',
    'Before changing files, inspect the generated context runtime through MCP or the CLI:',
    '',
    '- Do not scan the full `.context/` tree unless MCP is unavailable.',
    '- Start with `get_context_health` and `get_context_manifest`.',
    '- Use `search_context`, `get_task_context`, and `get_source_trace` for focused evidence.',
    '- Run `context doctor` when freshness or diagnostics matter.',
    `- Run \`context task "$ARGUMENTS" --focus ${id}\` for focused task context.`,
    '- Return source node ids, source uris, confidence, freshness, and diagnostics in handoff notes.'
  ].join('\n')
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-|-$/g, '') || 'context'
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
