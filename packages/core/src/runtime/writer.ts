import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ContextSkillDefinition } from '../contracts/index.js'
import type { ContextRuntimeWorkspace } from './workspace.js'
import { CONTEXT_RUNTIME_SCHEMA_VERSION } from './schema.js'

/** Write generated runtime workspace files. */
export async function writeContextRuntimeWorkspace(outputDir: string, workspace: ContextRuntimeWorkspace): Promise<void> {
  await Promise.all(
    ['indexes', 'runtime', 'mcp', 'tools', 'skills', 'agents', 'plugins', 'diagnostics'].map((dir) =>
      rm(join(outputDir, dir), { recursive: true, force: true })
    )
  )

  await writeJson(join(outputDir, 'indexes', 'manifest.json'), workspace.indexes.manifest)
  await writeJson(join(outputDir, 'indexes', 'symbols.json'), workspace.indexes.symbols)
  await writeJson(join(outputDir, 'indexes', 'apis.json'), workspace.indexes.apis)
  await writeJson(join(outputDir, 'indexes', 'search.json'), workspace.indexes.search)

  await writeJson(join(outputDir, 'runtime', 'runtime-plan.json'), workspace.plan)
  await writeJson(join(outputDir, 'runtime', 'runtime.config.json'), workspace.runtimeConfig)
  await writeJson(join(outputDir, 'runtime', 'agent-install-plan.json'), workspace.agentInstallPlan)
  for (const provider of workspace.runtimeConfig.providers) {
    await writeJson(join(outputDir, 'runtime', 'providers', `${safeFileName(provider.id)}.json`), provider)
  }

  await writeJson(join(outputDir, 'mcp', 'server.config.json'), {
    schemaVersion: CONTEXT_RUNTIME_SCHEMA_VERSION,
    transport: 'stdio',
    manifest: '.context/context-manifest.json',
    tools: '.context/mcp/tools.json'
  })
  await writeJson(join(outputDir, 'mcp', 'tools.json'), workspace.mcpTools)

  for (const tool of workspace.tools) {
    await writeJson(join(outputDir, 'tools', `${safeFileName(tool.id)}.json`), tool)
  }
  for (const skill of workspace.skills) {
    await writeText(join(outputDir, 'skills', `${safeFileName(skill.id)}.md`), renderSkill(skill))
  }
  for (const agent of workspace.agents) {
    await writeText(join(outputDir, agent.path), agent.content)
  }
  for (const plugin of workspace.plugins) {
    await writeJson(join(outputDir, 'plugins', `${safeFileName(plugin.id)}.json`), plugin)
  }

  await writeJson(join(outputDir, 'diagnostics', 'context-health.json'), workspace.health)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value.endsWith('\n') ? value : `${value}\n`)
}

function renderSkill(skill: ContextSkillDefinition): string {
  return [`# ${skill.title}`, '', skill.description, skill.content, ''].filter(Boolean).join('\n')
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-|-$/g, '') || 'item'
}
