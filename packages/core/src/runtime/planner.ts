import { createDiagnostic } from '../diagnostics/index.js'
import type {
  ContextAgentIntegration,
  ContextGraph,
  ContextNode,
  ContextPack,
  ContextPluginDefinition,
  ContextProviderPolicy,
  ContextRuntimeCapability,
  ContextRuntimeConfig,
  ContextRuntimeEvidence,
  ContextRuntimePlan,
  ContextRuntimeProvider,
  ContextSkillDefinition,
  ContextToolDefinition,
  Diagnostic
} from '../contracts/index.js'
import { CONTEXT_RUNTIME_PLAN_SCHEMA_VERSION } from './schema.js'

const AGENTS = ['codex', 'claude', 'cursor']

/** Infer the complete runtime capability plan from compiled project evidence. */
export function buildContextRuntimePlan(
  graph: ContextGraph,
  packs: ContextPack[],
  diagnostics: Diagnostic[] = graph.diagnostics
): ContextRuntimePlan {
  const views = packs.filter((pack) => pack.kind === 'context-view')
  const providers = inferProviders(graph)
  const tools = inferProjectTools(graph, views)
  const skills = inferSkills(graph, views)
  const agents = inferAgentIntegrations(graph, views)
  const plugins = inferPlugins(graph)
  const runtimeConfig: Required<ContextRuntimeConfig> = { providers, tools, skills, agents, plugins }
  const mcpTools = inferMcpTools(graph, views, runtimeConfig)
  const capabilities = [
    ...providers.map((provider) => capability(provider.id, 'provider', provider.title ?? provider.id, AGENTS, provider.evidence ?? [])),
    ...mcpTools.map((tool) => capability(tool.id, 'mcp-tool', tool.title, AGENTS, tool.evidence ?? [])),
    ...tools.map((tool) => capability(tool.id, 'project-tool', tool.title, AGENTS, tool.evidence ?? [])),
    ...skills.map((skill) => capability(skill.id, 'skill', skill.title, AGENTS, skill.evidence ?? [])),
    ...agents.map((agent) => capability(agent.id, 'agent-integration', agent.title, [agent.id], agent.evidence ?? [])),
    ...plugins.map((plugin) => capability(plugin.id, 'plugin', plugin.title, AGENTS, plugin.evidence ?? []))
  ]

  return {
    schemaVersion: CONTEXT_RUNTIME_PLAN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    providers,
    mcpTools,
    tools,
    skills,
    agents,
    plugins,
    capabilities,
    diagnostics: [...diagnostics, ...capabilityGapDiagnostics(graph, views)]
  }
}

function inferProviders(graph: ContextGraph): ContextRuntimeProvider[] {
  const providers = new Map<string, ContextRuntimeProvider>()
  for (const node of graph.nodes.filter((candidate) => candidate.type === 'runtime_signal')) {
    const providerId = stringMeta(node.metadata, 'providerId')
    if (!providerId || providers.has(providerId)) {
      continue
    }
    providers.set(providerId, {
      id: providerId,
      kind: 'static',
      title: node.title,
      description: node.content,
      value: {
        nodeId: node.id,
        source: node.source.uri,
        metadata: node.metadata
      },
      policy: policyFromMetadata(node.metadata),
      evidence: [nodeEvidence(node, 'runtime_signal node declares providerId')],
      metadata: { generated: true }
    })
  }
  return [...providers.values()].sort(byId)
}

function inferProjectTools(graph: ContextGraph, views: ContextPack[]): ContextToolDefinition[] {
  const projectEvidence = graph.nodes.slice(0, 3).map((node) => nodeEvidence(node, 'compiled project graph exists'))
  const tools: ContextToolDefinition[] = [
    {
      id: 'context-compile',
      title: 'Compile project context',
      kind: 'command',
      command: 'pnpm',
      args: ['context', 'compile'],
      description: 'Regenerate the project-level .context runtime workspace.',
      evidence: projectEvidence
    },
    {
      id: 'context-doctor',
      title: 'Inspect context health',
      kind: 'validation',
      command: 'pnpm',
      args: ['context', 'doctor'],
      description: 'Inspect generated context health and graph diagnostics.',
      evidence: projectEvidence
    }
  ]

  if (hasView(views, 'implementation') && hasAnyNode(graph, ['requirement', 'api_contract', 'code_symbol'])) {
    tools.push({
      id: 'context-task-implementation',
      title: 'Generate implementation task context',
      kind: 'query',
      description: 'Generate focused implementation context from linked requirements, APIs, code symbols, tests, and diagnostics.',
      evidence: evidenceForTypes(graph, ['requirement', 'api_contract', 'code_symbol'], 'implementation graph evidence')
    })
  }

  if (hasView(views, 'testing') && hasAnyNode(graph, ['acceptance_criteria', 'test_case', 'bug'])) {
    tools.push({
      id: 'context-task-testing',
      title: 'Generate testing task context',
      kind: 'query',
      description: 'Generate focused testing context from acceptance criteria, test cases, bugs, and risks.',
      evidence: evidenceForTypes(graph, ['acceptance_criteria', 'test_case', 'bug'], 'testing graph evidence')
    })
  }

  if (hasView(views, 'review') || graph.diagnostics.length > 0) {
    tools.push({
      id: 'context-review',
      title: 'Inspect review context',
      kind: 'validation',
      description: 'Inspect review context, graph diagnostics, linked source evidence, and runtime health.',
      evidence: graph.diagnostics.length > 0 ? [] : projectEvidence
    })
  }

  return tools
}

function inferSkills(graph: ContextGraph, views: ContextPack[]): ContextSkillDefinition[] {
  const skills: ContextSkillDefinition[] = []
  if (hasView(views, 'implementation') && hasAnyNode(graph, ['requirement', 'api_contract', 'code_symbol'])) {
    skills.push({
      id: 'implementation',
      title: 'Implementation',
      content: 'Use implementation context when changing code. Check linked requirements, APIs, code symbols, test cases, and recommended checks before editing.',
      evidence: evidenceForTypes(graph, ['requirement', 'api_contract', 'code_symbol'], 'implementation context is supported')
    })
  }
  if (hasView(views, 'testing') && hasAnyNode(graph, ['acceptance_criteria', 'test_case', 'bug'])) {
    skills.push({
      id: 'testing',
      title: 'Testing',
      content: 'Use testing context to map requirements and acceptance criteria to executable regression coverage.',
      evidence: evidenceForTypes(graph, ['acceptance_criteria', 'test_case', 'bug'], 'testing context is supported')
    })
  }
  if (hasView(views, 'review') || graph.diagnostics.length > 0) {
    skills.push({
      id: 'review',
      title: 'Review',
      content: 'Use review context to check changed behavior against requirements, APIs, tests, diagnostics, and historical risks.',
      evidence: graph.nodes.slice(0, 3).map((node) => nodeEvidence(node, 'review context is available'))
    })
  }
  if (hasView(views, 'product') && hasAnyNode(graph, ['requirement', 'business_rule', 'acceptance_criteria'])) {
    skills.push({
      id: 'product',
      title: 'Product context',
      content: 'Use product context to inspect requirements, business rules, acceptance criteria, decisions, and risks.',
      evidence: evidenceForTypes(graph, ['requirement', 'business_rule', 'acceptance_criteria'], 'product context is supported')
    })
  }
  if (hasView(views, 'design') && hasAnyNode(graph, ['design_spec', 'page', 'ui_component'])) {
    skills.push({
      id: 'design',
      title: 'Design context',
      content: 'Use design context to inspect screens, pages, UI components, and design-linked requirements.',
      evidence: evidenceForTypes(graph, ['design_spec', 'page', 'ui_component'], 'design context is supported')
    })
  }
  return dedupeById(skills)
}

function inferAgentIntegrations(graph: ContextGraph, views: ContextPack[]): ContextAgentIntegration[] {
  const generatedViews = views.map((view) => view.view).filter((view): view is string => typeof view === 'string')
  const hasTaskTools = hasAnyNode(graph, ['requirement', 'api_contract', 'code_symbol', 'test_case'])
  const evidence = graph.nodes.slice(0, 3).map((node) => nodeEvidence(node, 'agent instructions generated from compiled context'))
  return [
    {
      id: 'codex',
      title: 'Codex agent instructions',
      path: 'agents/codex/AGENTS.generated.md',
      content: [
        '# Generated Context Runtime Instructions',
        '',
        '- Start with `.context/views/project.md` for workspace orientation.',
        generatedViews.includes('implementation') ? '- Use `.context/views/implementation.md` for coding work.' : undefined,
        hasTaskTools ? '- Use `context task "<task>" --focus implementation` for focused task context.' : undefined,
        '- Run `context doctor` before handoff when context quality matters.',
        ''
      ].filter(Boolean).join('\n'),
      evidence
    },
    {
      id: 'claude',
      title: 'Claude Code instructions',
      path: 'agents/claude/CLAUDE.generated.md',
      content: [
        '# Generated Context Runtime Instructions',
        '',
        '- Treat `.context/` as the project-level context runtime workspace.',
        '- Prefer generated context views and MCP tools before asking humans to repeat project background.',
        '- Check `.context/diagnostics/context-health.json` when context looks stale or incomplete.',
        ''
      ].join('\n'),
      evidence
    },
    {
      id: 'cursor',
      title: 'Cursor rules',
      path: 'agents/cursor/rules/context.generated.md',
      content: [
        '# Context Runtime Rule',
        '',
        'Use `.context/views/*.md`, `.context/tasks/*.md`, and `.context/mcp/tools.json` as the compiled project context layer.',
        ''
      ].join('\n'),
      evidence
    }
  ]
}

function inferPlugins(graph: ContextGraph): ContextPluginDefinition[] {
  const components = ['graph', 'context-views', 'runtime-workspace']
  if (hasAnyNode(graph, ['requirement', 'business_rule', 'acceptance_criteria'])) components.push('markdown')
  if (hasAnyNode(graph, ['api_contract'])) components.push('openapi')
  if (hasAnyNode(graph, ['code_symbol'])) components.push('source-symbols')
  if (hasAnyNode(graph, ['runtime_signal'])) components.push('runtime-providers')
  return [
    {
      id: 'context-compiler-local',
      title: 'Context Compiler local distribution',
      version: '0.1.0',
      components,
      evidence: graph.nodes.slice(0, 3).map((node) => nodeEvidence(node, 'local distribution inferred from graph contents'))
    }
  ]
}

function inferMcpTools(
  graph: ContextGraph,
  views: ContextPack[],
  runtimeConfig: Required<ContextRuntimeConfig>
): ContextToolDefinition[] {
  const baseEvidence = graph.nodes.slice(0, 3).map((node) => nodeEvidence(node, 'compiled context can be queried through MCP'))
  const tools: ContextToolDefinition[] = [
    mcpTool('get_context_manifest', baseEvidence),
    mcpTool('get_context_health', baseEvidence),
    mcpTool('get_context_view', baseEvidence),
    mcpTool('search_context', baseEvidence),
    mcpTool('get_related_nodes', baseEvidence),
    mcpTool('explain_trace', baseEvidence),
    mcpTool('get_source_trace', baseEvidence),
    mcpTool('get_agent_runtime_plan', baseEvidence),
    mcpTool('explain_capability', baseEvidence),
    mcpTool('refresh_context', baseEvidence),
    mcpTool('get_runtime_config', baseEvidence),
    mcpTool('list_project_tools', baseEvidence),
    mcpTool('list_project_skills', baseEvidence)
  ]

  if (views.length > 0 && graph.nodes.length > 0) tools.push(mcpTool('get_task_context', baseEvidence))
  if (hasAnyNode(graph, ['api_contract'])) tools.push(mcpTool('get_api_context', evidenceForTypes(graph, ['api_contract'], 'API contracts exist')))
  if (hasAnyNode(graph, ['test_case'])) tools.push(mcpTool('get_test_coverage', evidenceForTypes(graph, ['test_case'], 'test cases exist')))
  if (graph.diagnostics.length > 0) tools.push(mcpTool('get_diagnostics', []))
  if (runtimeConfig.providers.length > 0) {
    const providerEvidence = runtimeConfig.providers.flatMap((provider) => provider.evidence ?? [])
    tools.push(mcpTool('list_runtime_providers', providerEvidence), mcpTool('query_runtime_provider', providerEvidence))
  }
  return dedupeById(tools)
}

function mcpTool(id: string, evidence: ContextRuntimeEvidence[]): ContextToolDefinition {
  return {
    id,
    title: id.split('_').map(capitalize).join(' '),
    kind: 'query',
    inputs: inputSchemaForMcpTool(id),
    evidence
  }
}

function inputSchemaForMcpTool(id: string): ContextToolDefinition['inputs'] {
  switch (id) {
    case 'get_context_view':
      return objectSchema({ view: stringSchema('Context view name, such as project, implementation, review, or testing.') })
    case 'get_task_context':
      return objectSchema(
        {
          task: stringSchema('Natural language task description.'),
          focus: stringSchema('Optional context focus.'),
          module: stringSchema('Optional module filter.')
        },
        ['task']
      )
    case 'search_context':
      return objectSchema({ query: stringSchema('Search query.'), limit: numberSchema('Maximum number of results.') }, ['query'])
    case 'get_related_nodes':
    case 'explain_trace':
    case 'get_source_trace':
      return objectSchema({ nodeId: stringSchema('Context graph node id.') }, ['nodeId'])
    case 'get_api_context':
      return objectSchema({
        apiId: stringSchema('API context node id.'),
        path: stringSchema('API path.'),
        method: stringSchema('HTTP method.')
      })
    case 'get_test_coverage':
      return objectSchema({ requirementId: stringSchema('Requirement node id.') })
    case 'query_runtime_provider':
      return objectSchema(
        {
          providerId: stringSchema('Runtime provider id.'),
          agent: stringSchema('Optional calling agent id, such as codex or claude.')
        },
        ['providerId']
      )
    case 'explain_capability':
      return objectSchema({ capabilityId: stringSchema('Runtime capability id.') }, ['capabilityId'])
    default:
      return objectSchema({})
  }
}

function objectSchema(properties: NonNullable<ContextToolDefinition['inputs']>['properties'], required: string[] = []): ContextToolDefinition['inputs'] {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
}

function stringSchema(description: string): NonNullable<ContextToolDefinition['inputs']> {
  return { type: 'string', description }
}

function numberSchema(description: string): NonNullable<ContextToolDefinition['inputs']> {
  return { type: 'number', description }
}

function capability(
  id: string,
  kind: ContextRuntimeCapability['kind'],
  title: string,
  targetAgents: string[],
  evidence: ContextRuntimeEvidence[]
): ContextRuntimeCapability {
  return {
    id,
    kind,
    title,
    targetAgents,
    agentSurfaces: targetAgents,
    entrypoints: [],
    freshness: { status: 'unknown' },
    installStatus: 'planned',
    evidence,
    confidence: evidence.length > 0 ? Math.min(...evidence.map((item) => item.confidence)) : 0.6,
    metadata: {}
  }
}

function policyFromMetadata(metadata: Record<string, unknown>): ContextProviderPolicy | undefined {
  const allowedAgents = stringListMeta(metadata, 'allowedAgents')
  const requiresApproval = booleanMeta(metadata, 'requiresApproval')
  const timeoutMs = numberMeta(metadata, 'timeoutMs')
  const cacheTtlMs = numberMeta(metadata, 'cacheTtlMs')
  const redactionLevel = redactionLevelMeta(metadata, 'redactionLevel')
  const allowNetwork = booleanMeta(metadata, 'allowNetwork')
  const policy: ContextProviderPolicy = {}
  if (allowedAgents.length > 0) policy.allowedAgents = allowedAgents
  if (requiresApproval !== undefined) policy.requiresApproval = requiresApproval
  if (timeoutMs !== undefined) policy.timeoutMs = timeoutMs
  if (cacheTtlMs !== undefined) policy.cacheTtlMs = cacheTtlMs
  if (redactionLevel) policy.redactionLevel = redactionLevel
  if (allowNetwork !== undefined) policy.allowNetwork = allowNetwork
  return Object.keys(policy).length > 0 ? policy : undefined
}

function stringListMeta(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key]
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function booleanMeta(metadata: Record<string, unknown>, key: string): boolean | undefined {
  const value = metadata[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase())) {
    return value.toLowerCase() === 'true'
  }
  return undefined
}

function numberMeta(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function redactionLevelMeta(metadata: Record<string, unknown>, key: string): ContextProviderPolicy['redactionLevel'] | undefined {
  const value = metadata[key]
  return value === 'none' || value === 'standard' || value === 'strict' ? value : undefined
}

function capabilityGapDiagnostics(graph: ContextGraph, views: ContextPack[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!hasAnyNode(graph, ['test_case'])) {
    diagnostics.push(createDiagnostic({
      severity: 'info',
      code: 'runtime.capability.not-generated',
      message: 'Test coverage MCP tools were not generated because no test_case nodes were found.',
      metadata: { capability: 'get_test_coverage' }
    }))
  }
  if (!hasAnyNode(graph, ['runtime_signal'])) {
    diagnostics.push(createDiagnostic({
      severity: 'info',
      code: 'runtime.capability.not-generated',
      message: 'Runtime providers were not generated because no runtime_signal nodes were found.',
      metadata: { capability: 'runtime-provider' }
    }))
  }
  if (!hasView(views, 'design')) {
    diagnostics.push(createDiagnostic({
      severity: 'info',
      code: 'runtime.capability.not-generated',
      message: 'Design skills were not generated because no design context view was inferred.',
      metadata: { capability: 'design-skill' }
    }))
  }
  return diagnostics
}

function evidenceForTypes(graph: ContextGraph, types: ContextNode['type'][], reason: string): ContextRuntimeEvidence[] {
  return graph.nodes.filter((node) => types.includes(node.type)).slice(0, 8).map((node) => nodeEvidence(node, reason))
}

function nodeEvidence(node: ContextNode, reason: string): ContextRuntimeEvidence {
  return {
    nodeId: node.id,
    source: node.source,
    reason,
    confidence: node.source.confidence ?? 0.85
  }
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key]
  return typeof value === 'string' ? value : undefined
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function hasAnyNode(graph: ContextGraph, types: ContextNode['type'][]): boolean {
  return graph.nodes.some((node) => types.includes(node.type))
}

function hasView(views: ContextPack[], viewName: string): boolean {
  return views.some((view) => view.view === viewName)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
