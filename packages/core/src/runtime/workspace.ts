import type {
  ContextAgentInstallPlan,
  ContextAgentIntegration,
  ContextGraph,
  ContextPack,
  ContextPluginDefinition,
  ContextProjectConfig,
  ContextRuntimeConfig,
  ContextRuntimeHealth,
  ContextRuntimeManifest,
  ContextRuntimePlan,
  ContextRuntimeProvider,
  ContextSkillDefinition,
  ContextToolDefinition
} from '../contracts/index.js'
import { buildContextAgentInstallPlan } from './agent-integration.js'
import { buildContextRuntimeHealth } from './health.js'
import { buildContextIndexes, type ContextIndexes } from './indexes.js'
import { buildContextRuntimePlan } from './planner.js'

export interface ContextRuntimeWorkspace {
  manifest: ContextRuntimeManifest
  indexes: ContextIndexes
  plan: ContextRuntimePlan
  runtimeConfig: Required<ContextRuntimeConfig>
  mcpTools: ContextToolDefinition[]
  tools: ContextToolDefinition[]
  skills: ContextSkillDefinition[]
  agents: ContextAgentIntegration[]
  plugins: ContextPluginDefinition[]
  providers: ContextRuntimeProvider[]
  agentInstallPlan: ContextAgentInstallPlan
  health: ContextRuntimeHealth
}

/** Build all generated runtime records before the file emitter writes them. */
export function buildContextRuntimeWorkspace(
  graph: ContextGraph,
  config: ContextProjectConfig,
  packs: ContextPack[],
  options: { compiledAt?: string; compilerVersion?: string; pipelineId?: string; plan?: ContextRuntimePlan } = {}
): ContextRuntimeWorkspace {
  const compiledAt = options.compiledAt ?? new Date().toISOString()
  const indexes = buildContextIndexes(graph)
  const views = packs.filter((pack) => pack.kind === 'context-view')
  const plan = options.plan ?? buildContextRuntimePlan(graph, packs)
  const runtimeConfig: Required<ContextRuntimeConfig> = {
    providers: plan.providers,
    tools: plan.tools,
    skills: plan.skills,
    agents: plan.agents,
    plugins: plan.plugins
  }
  const agentInstallPlan = buildContextAgentInstallPlan(config, runtimeConfig, {
    target: 'all',
    generatedAt: compiledAt
  })
  const health = buildContextRuntimeHealth(graph, views.length, indexes, runtimeConfig, plan.diagnostics)

  return {
    manifest: {
      schemaVersion: 'context-runtime.v1',
      workspace: config.workspace,
      compiledAt,
      compilerVersion: options.compilerVersion ?? '0.1.0',
      pipeline: options.pipelineId ?? 'compile',
      graph: {
        nodes: '.context/graph/nodes.jsonl',
        edges: '.context/graph/edges.jsonl',
        diagnostics: '.context/graph/diagnostics.jsonl'
      },
      indexes: {
        symbols: indexes.manifest.files.symbols,
        apis: indexes.manifest.files.apis,
        search: indexes.manifest.files.search
      },
      packs: packs.map((pack) => ({ id: pack.id, kind: pack.kind, view: pack.view, task: pack.task })),
      runtime: {
        plan: '.context/runtime/runtime-plan.json',
        config: '.context/runtime/runtime.config.json',
        trace: '.context/runtime/trace.jsonl',
        runSummary: '.context/runtime/run-summary.json',
        agentInstallPlan: '.context/runtime/agent-install-plan.json',
        freshness: { status: 'fresh', checkedAt: compiledAt },
        installStatus: { codex: 'planned', claude: 'planned' },
        capabilitySurfaces: {
          codex: ['AGENTS.md', '.codex/config.toml', '.agents/skills', '.codex/agents'],
          claude: ['CLAUDE.md', '.mcp.json', '.claude/skills', '.claude/settings.json']
        },
        providers: runtimeConfig.providers.map((provider) => provider.id),
        tools: runtimeConfig.tools.map((tool) => tool.id),
        skills: runtimeConfig.skills.map((skill) => skill.id),
        agents: runtimeConfig.agents.map((agent) => agent.id),
        plugins: runtimeConfig.plugins.map((plugin) => plugin.id),
        mcp: {
          serverConfig: '.context/mcp/server.config.json',
          tools: '.context/mcp/tools.json'
        }
      },
      diagnostics: {
        health: '.context/diagnostics/context-health.json',
        graph: '.context/graph/diagnostics.jsonl'
      }
    },
    indexes,
    plan,
    runtimeConfig,
    mcpTools: plan.mcpTools,
    tools: plan.tools,
    skills: plan.skills,
    agents: plan.agents,
    plugins: plan.plugins,
    providers: plan.providers,
    agentInstallPlan,
    health
  }
}
