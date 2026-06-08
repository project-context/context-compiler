import { createDiagnostic } from '../diagnostics/index.js'
import {
  nodeContent,
  nodeStringProperty,
  primarySourceRef
} from '../graph/model.js'
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
  ContextJsonSchema,
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
    ...providers.map((provider) => capability(provider.name, 'provider', provider.title ?? provider.name, AGENTS, provider.evidence ?? [])),
    ...mcpTools.map((tool) => capability(tool.name, 'mcp-tool', titleFromName(tool.name), AGENTS, tool.evidence ?? [])),
    ...tools.map((tool) => capability(tool.name, 'project-tool', titleFromName(tool.name), AGENTS, tool.evidence ?? [])),
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
  for (const node of graph.nodes.filter((candidate) => RUNTIME_PROVIDER_TYPES.has(candidate.type))) {
    const providerName = nodeStringProperty(node, 'providerId') ?? nodeStringProperty(node, 'providerName')
    if (!providerName || providers.has(providerName)) {
      continue
    }
    providers.set(providerName, {
      name: providerName,
      kind: providerKindFor(node),
      transport: providerTransportFor(node),
      title: node.name,
      description: nodeContent(node),
      value: {
        nodeId: node.id,
        source: primarySourceRef(node)?.uri,
        sourceRefs: node.sourceRefs,
        properties: node.properties
      },
      policy: policyFromProperties(node.properties),
      evidence: [nodeEvidence(node, `${node.type} node declares providerId`)],
      metadata: { generated: true }
    })
  }
  return [...providers.values()].sort(byName)
}

function inferProjectTools(graph: ContextGraph, views: ContextPack[]): ContextToolDefinition[] {
  const projectEvidence = evidenceSeedNodes(graph).map((node) => nodeEvidence(node, 'compiled project graph exists'))
  const tools: ContextToolDefinition[] = [
    {
      name: 'context_compile',
      command: 'pnpm',
      args: ['context', 'compile'],
      description: 'Regenerate the project-level .context runtime workspace.',
      safety: 'local_write',
      evidence: projectEvidence
    },
    {
      name: 'context_doctor',
      command: 'pnpm',
      args: ['context', 'doctor'],
      description: 'Inspect generated context health and graph diagnostics.',
      safety: 'read_only',
      evidence: projectEvidence
    }
  ]

  if (hasView(views, 'implementation') && hasAnyNode(graph, ['Requirement', 'APIEndpoint', 'CodeSymbol'])) {
    tools.push({
      name: 'context_task_implementation',
      description: 'Generate focused implementation context from linked requirements, APIs, code symbols, tests, and diagnostics.',
      safety: 'read_only',
      evidence: evidenceForTypes(graph, ['Requirement', 'APIEndpoint', 'CodeSymbol'], 'implementation graph evidence')
    })
  }

  if (hasView(views, 'testing') && hasAnyNode(graph, ['AcceptanceCriteria', 'TestCase', 'Incident', 'Risk'])) {
    tools.push({
      name: 'context_task_testing',
      description: 'Generate focused testing context from acceptance criteria, test cases, incidents, and risks.',
      safety: 'read_only',
      evidence: evidenceForTypes(graph, ['AcceptanceCriteria', 'TestCase', 'Incident', 'Risk'], 'testing graph evidence')
    })
  }

  if (hasView(views, 'review') || graph.diagnostics.length > 0) {
    tools.push({
      name: 'context_review',
      description: 'Inspect review context, graph diagnostics, linked source evidence, and runtime health.',
      safety: 'read_only',
      evidence: graph.diagnostics.length > 0 ? [] : projectEvidence
    })
  }

  return dedupeByName(tools)
}

function inferSkills(graph: ContextGraph, views: ContextPack[]): ContextSkillDefinition[] {
  const skills: ContextSkillDefinition[] = []
  if (hasView(views, 'implementation') && hasAnyNode(graph, ['Requirement', 'APIEndpoint', 'CodeSymbol'])) {
    skills.push({
      id: 'implementation',
      title: 'Implementation',
      content: 'Use implementation context when changing code. Check linked requirements, APIs, code symbols, test cases, and recommended checks before editing.',
      evidence: evidenceForTypes(graph, ['Requirement', 'APIEndpoint', 'CodeSymbol'], 'implementation context is supported')
    })
  }
  if (hasView(views, 'testing') && hasAnyNode(graph, ['AcceptanceCriteria', 'TestCase', 'Incident', 'Risk'])) {
    skills.push({
      id: 'testing',
      title: 'Testing',
      content: 'Use testing context to map requirements and acceptance criteria to executable regression coverage.',
      evidence: evidenceForTypes(graph, ['AcceptanceCriteria', 'TestCase', 'Incident', 'Risk'], 'testing context is supported')
    })
  }
  if (hasView(views, 'review') || graph.diagnostics.length > 0) {
    skills.push({
      id: 'review',
      title: 'Review',
      content: 'Use review context to check changed behavior against requirements, APIs, tests, diagnostics, and historical risks.',
      evidence: evidenceSeedNodes(graph).map((node) => nodeEvidence(node, 'review context is available'))
    })
  }
  if (hasView(views, 'product') && hasAnyNode(graph, ['Requirement', 'BusinessRule', 'AcceptanceCriteria'])) {
    skills.push({
      id: 'product',
      title: 'Product context',
      content: 'Use product context to inspect requirements, business rules, acceptance criteria, decisions, and risks.',
      evidence: evidenceForTypes(graph, ['Requirement', 'BusinessRule', 'AcceptanceCriteria'], 'product context is supported')
    })
  }
  if (hasView(views, 'design') && hasAnyNode(graph, ['UIPage', 'UIComponent', 'UserFlow'])) {
    skills.push({
      id: 'design',
      title: 'Design context',
      content: 'Use design context to inspect screens, pages, UI components, and design-linked requirements.',
      evidence: evidenceForTypes(graph, ['UIPage', 'UIComponent', 'UserFlow'], 'design context is supported')
    })
  }
  return dedupeById(skills)
}

function inferAgentIntegrations(graph: ContextGraph, views: ContextPack[]): ContextAgentIntegration[] {
  const generatedViews = views.map((view) => view.view).filter((view): view is string => typeof view === 'string')
  const hasTaskTools = hasAnyNode(graph, ['Requirement', 'APIEndpoint', 'CodeSymbol', 'TestCase'])
  const evidence = evidenceSeedNodes(graph).map((node) => nodeEvidence(node, 'agent instructions generated from compiled context'))
  return [
    {
      id: 'codex',
      title: 'Codex agent instructions',
      path: 'agents/codex/AGENTS.generated.md',
      content: [
        '# Generated Context Runtime Instructions',
        '',
        '- Major work should align with `docs/architecture/super-data-network-goal.md`.',
        '- Start with `.context/views/project.md` for workspace orientation.',
        '- Prefer package-first tools: `list_context_packages`, `get_context_package`, `expand_context_package`, and `search_context_package`.',
        '- Review correction memory first with `list_package_correction_decisions`, `get_package_correction_decision`, and `replay_package_correction_decisions`, then inspect proposals with `list_package_corrections`, `get_correction_proposal`, and `preview_correction_proposal`.',
        '- Use graph scope tools only after choosing a package or for low-level runtime debugging.',
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
        '- Major work should align with `docs/architecture/super-data-network-goal.md`.',
        '- Prefer package-first MCP tools before asking humans to repeat project background.',
        '- Start with `list_context_packages`, then drill into `get_context_package` or `expand_context_package`.',
        '- Use package correction decision memory tools before package correction proposal tools, and use both before low-level graph patch tools when evidence suggests relabel, split, merge, rehome, confirm, or reject actions.',
        '- Use graph MCP tools as low-level debug tools after package context is identified.',
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
        'Use `.context/views/*.md`, `.context/tasks/*.md`, `.context/mcp/tools.json`, and package-first MCP tools as the compiled project context layer. Major work should align with `docs/architecture/super-data-network-goal.md`.',
        ''
      ].join('\n'),
      evidence
    }
  ]
}

function inferPlugins(graph: ContextGraph): ContextPluginDefinition[] {
  const components = ['graph', 'context-views', 'runtime-workspace']
  if (hasAnyNode(graph, ['Requirement', 'BusinessRule', 'AcceptanceCriteria'])) components.push('markdown')
  if (hasAnyNode(graph, ['APIEndpoint'])) components.push('openapi')
  if (hasAnyNode(graph, ['CodeSymbol'])) components.push('source-symbols')
  if (hasAnyNode(graph, [...RUNTIME_PROVIDER_TYPES])) components.push('runtime-providers')
  return [
    {
      id: 'context-compiler-local',
      title: 'Context Compiler local distribution',
      version: '0.1.0',
      components,
      evidence: evidenceSeedNodes(graph).map((node) => nodeEvidence(node, 'local distribution inferred from graph contents'))
    }
  ]
}

function inferMcpTools(
  graph: ContextGraph,
  views: ContextPack[],
  runtimeConfig: Required<ContextRuntimeConfig>
): ContextToolDefinition[] {
  const baseEvidence = evidenceSeedNodes(graph).map((node) => nodeEvidence(node, 'compiled context can be queried through MCP'))
  const tools: ContextToolDefinition[] = [
    mcpTool('get_context_manifest', baseEvidence),
    mcpTool('get_context_health', baseEvidence),
    mcpTool('get_context_view', baseEvidence),
    mcpTool('list_context_packages', baseEvidence),
    mcpTool('get_context_package', baseEvidence),
    mcpTool('expand_context_package', baseEvidence),
    mcpTool('search_context_package', baseEvidence),
    mcpTool('list_package_correction_decisions', baseEvidence),
    mcpTool('get_package_correction_decision', baseEvidence),
    mcpTool('replay_package_correction_decisions', baseEvidence),
    mcpTool('propose_package_correction_decision_revert', baseEvidence),
    mcpTool('list_package_corrections', baseEvidence),
    mcpTool('get_correction_proposal', baseEvidence),
    mcpTool('preview_correction_proposal', baseEvidence),
    mcpTool('approve_correction_proposal', baseEvidence),
    mcpTool('reject_correction_proposal', baseEvidence),
    mcpTool('apply_correction_proposal', baseEvidence),
    mcpTool('search_context', baseEvidence),
    mcpTool('list_graph_scopes', baseEvidence),
    mcpTool('get_graph_scope', baseEvidence),
    mcpTool('expand_graph_scope', baseEvidence),
    mcpTool('expand_graph_target', baseEvidence),
    mcpTool('get_planning_pack', baseEvidence),
    mcpTool('inspect_source_candidate', baseEvidence),
    mcpTool('search_source_inventory', baseEvidence),
    mcpTool('simulate_graph_patch', baseEvidence),
    mcpTool('submit_graph_patch', baseEvidence),
    mcpTool('list_graph_patches', baseEvidence),
    mcpTool('list_evidence_reports', baseEvidence),
    mcpTool('explain_graph_fact', baseEvidence),
    mcpTool('get_graph_fact_history', baseEvidence),
    mcpTool('get_rehome_proposals', baseEvidence),
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
  if (hasAnyNode(graph, ['APIEndpoint'])) tools.push(mcpTool('get_api_context', evidenceForTypes(graph, ['APIEndpoint'], 'API contracts exist')))
  if (hasAnyNode(graph, ['TestCase'])) tools.push(mcpTool('get_test_coverage', evidenceForTypes(graph, ['TestCase'], 'test cases exist')))
  if (graph.diagnostics.length > 0) tools.push(mcpTool('get_diagnostics', []))
  if (runtimeConfig.providers.length > 0) {
    const providerEvidence = runtimeConfig.providers.flatMap((provider) => provider.evidence ?? [])
    tools.push(mcpTool('list_runtime_providers', providerEvidence), mcpTool('query_runtime_provider', providerEvidence))
  }
  return dedupeByName(tools)
}

function mcpTool(name: string, evidence: ContextRuntimeEvidence[]): ContextToolDefinition {
  const localWriteTools = new Set(['submit_graph_patch', 'approve_correction_proposal', 'reject_correction_proposal', 'apply_correction_proposal', 'propose_package_correction_decision_revert'])
  return {
    name,
    description: mcpToolDescription(name),
    inputSchema: inputSchemaForMcpTool(name),
    safety: localWriteTools.has(name) ? 'local_write' : 'read_only',
    evidence
  }
}

function mcpToolDescription(name: string): string {
  switch (name) {
    case 'list_context_packages':
      return 'List L0 context packages. Preferred first drill-down entrypoint.'
    case 'get_context_package':
      return 'Get one L0 package view with source groups, build units, adapter selections, stats, and next actions.'
    case 'expand_context_package':
      return 'Expand one L0 package. Summary mode returns L1 source groups; full mode returns files, content facts, and edges.'
    case 'search_context_package':
      return 'Search within one package boundary, or all packages when packageRef is omitted.'
    case 'list_package_correction_decisions':
      return 'List package-scoped source correction decision memory with effective status, drift, and active decision counts.'
    case 'get_package_correction_decision':
      return 'Inspect one source correction decision memory record, including active status, drift, package, and source group bindings.'
    case 'replay_package_correction_decisions':
      return 'Replay active source correction decisions in memory to preview package/source-group effects without writing files.'
    case 'propose_package_correction_decision_revert':
      return 'Create a canonical package correction proposal that reverts a source correction decision; does not directly mutate source decisions.'
    case 'list_package_corrections':
      return 'List the package-first correction inbox with canonical proposals filtered by package, status, or kind.'
    case 'get_correction_proposal':
      return 'Inspect one canonical correction proposal, including evidence, package scope, graph patch, and lifecycle status.'
    case 'preview_correction_proposal':
      return 'Preview a package correction operation plan with source-level effects, graph-level effects, and revision summary without writing files.'
    case 'approve_correction_proposal':
      return 'Approve a package correction proposal as an explicit local write before application.'
    case 'reject_correction_proposal':
      return 'Reject a package correction proposal as an explicit local write without mutating the graph.'
    case 'apply_correction_proposal':
      return 'Apply or dry-run a package correction proposal through the graph patch execution path.'
    case 'list_graph_scopes':
      return 'Low-level Graph-of-Graphs scope listing for debugging after package context is identified.'
    case 'get_graph_scope':
    case 'expand_graph_scope':
    case 'expand_graph_target':
      return `Low-level Graph-of-Graphs debugging tool: ${name}.`
    default:
      return `Context Compiler MCP tool: ${name}`
  }
}

function inputSchemaForMcpTool(name: string): ContextJsonSchema {
  switch (name) {
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
      return objectSchema(
        {
          query: stringSchema('Search query.'),
          limit: numberSchema('Maximum number of results.'),
          scopeId: stringSchema('Optional Graph-of-Graphs scope id.')
        },
        ['query']
      )
    case 'get_context_package':
      return objectSchema({ packageRef: stringSchema('Package id, package path, or package title.') }, ['packageRef'])
    case 'expand_context_package':
      return objectSchema(
        {
          packageRef: stringSchema('Package id, package path, or package title.'),
          mode: stringSchema('Optional expansion mode: summary or full.')
        },
        ['packageRef']
      )
    case 'search_context_package':
      return objectSchema(
        {
          query: stringSchema('Search query.'),
          packageRef: stringSchema('Optional package id, package path, or package title.'),
          limit: numberSchema('Maximum number of package-scoped search results.')
        },
        ['query']
      )
    case 'list_package_corrections':
      return objectSchema({
        packageRef: stringSchema('Optional package id, package path, or package title.'),
        status: stringSchema('Optional correction status: proposed, approved, rejected, or applied.'),
        kind: stringSchema('Optional correction kind: relabel, split, merge, rehome, confirm_relation, or reject_relation.')
      })
    case 'list_package_correction_decisions':
      return objectSchema({
        packageRef: stringSchema('Optional package id, package path, or package title.'),
        status: stringSchema('Optional source correction decision status: applied, superseded, reverted, or invalid.'),
        kind: stringSchema('Optional correction kind: relabel, split, merge, rehome, confirm_relation, or reject_relation.'),
        includeDrift: booleanSchema('When true, include drift details in the returned effective decision views.')
      })
    case 'get_package_correction_decision':
      return objectSchema({ decisionId: stringSchema('Source correction decision id.') }, ['decisionId'])
    case 'replay_package_correction_decisions':
      return objectSchema({
        decisionId: stringSchema('Optional source correction decision id.'),
        packageRef: stringSchema('Optional package id, package path, or package title.'),
        dryRun: booleanSchema('Accepted for compatibility; replay is always read-only.')
      })
    case 'propose_package_correction_decision_revert':
      return objectSchema(
        {
          decisionId: stringSchema('Source correction decision id to revert through a canonical proposal.'),
          actor: stringSchema('Optional actor name recorded in the revert proposal.'),
          reason: stringSchema('Optional human-readable revert reason.')
        },
        ['decisionId']
      )
    case 'get_correction_proposal':
    case 'preview_correction_proposal':
      return objectSchema({ proposalId: stringSchema('Canonical correction proposal id.') }, ['proposalId'])
    case 'approve_correction_proposal':
    case 'reject_correction_proposal':
      return objectSchema(
        {
          proposalId: stringSchema('Canonical correction proposal id.'),
          actor: stringSchema('Optional actor name recorded in the proposal status overlay.'),
          reason: stringSchema('Optional human-readable approval or rejection reason.')
        },
        ['proposalId']
      )
    case 'apply_correction_proposal':
      return objectSchema(
        {
          proposalId: stringSchema('Canonical correction proposal id.'),
          actor: stringSchema('Optional actor name recorded in the proposal status overlay.'),
          reason: stringSchema('Optional human-readable application reason.'),
          dryRun: booleanSchema('When true, returns the graph patch that would be applied without writing proposals, patches, or revisions.')
        },
        ['proposalId']
      )
    case 'get_graph_scope':
    case 'expand_graph_scope':
      return objectSchema(
        {
          scopeId: stringSchema('Graph-of-Graphs scope id.'),
          mode: stringSchema('Optional drill-down mode: summary or full.'),
          limitNodes: numberSchema('Maximum nodes returned in summary mode.'),
          limitEdges: numberSchema('Maximum edges returned in summary mode.'),
          limitChildScopes: numberSchema('Maximum child scopes returned in summary mode.'),
          limitSourceRefs: numberSchema('Maximum source refs returned per fact in summary mode.'),
          limitEvidence: numberSchema('Maximum evidence entries returned per fact in summary mode.')
        },
        ['scopeId']
      )
    case 'expand_graph_target':
      return objectSchema(
        {
          targetId: stringSchema('Graph scope, node, or edge id to expand.'),
          mode: stringSchema('Optional drill-down mode: summary or full.'),
          depth: numberSchema('Neighborhood traversal depth.'),
          direction: stringSchema('Traversal direction: up, down, or around.'),
          limitNodes: numberSchema('Maximum nodes returned in summary mode.'),
          limitEdges: numberSchema('Maximum edges returned in summary mode.'),
          limitChildScopes: numberSchema('Maximum child scopes returned in summary mode.'),
          limitSourceRefs: numberSchema('Maximum source refs returned per fact in summary mode.'),
          limitEvidence: numberSchema('Maximum evidence entries returned per fact in summary mode.')
        },
        ['targetId']
      )
    case 'inspect_source_candidate':
      return objectSchema({ path: stringSchema('Source candidate directory path from the planning pack.') }, ['path'])
    case 'search_source_inventory':
      return objectSchema(
        {
          query: stringSchema('Search query matched against source inventory paths, routes, media types, and diagnostics.'),
          limit: numberSchema('Maximum number of source inventory results.')
        },
        ['query']
      )
    case 'simulate_graph_patch':
    case 'submit_graph_patch':
      return objectSchema({ patch: graphPatchSchema() }, ['patch'])
    case 'list_evidence_reports':
      return objectSchema({ scopeId: stringSchema('Optional Graph-of-Graphs scope id.') })
    case 'explain_graph_fact':
      return objectSchema(
        {
          factId: stringSchema('Context graph node or edge id.'),
          mode: stringSchema('Optional explain mode: summary or full.'),
          limitSources: numberSchema('Maximum source refs to return in summary mode.'),
          limitEvidence: numberSchema('Maximum evidence entries to return per provenance item in summary mode.'),
          limitRelations: numberSchema('Maximum related edges to return in summary mode.'),
          limitProvenance: numberSchema('Maximum provenance entries to return in summary mode.')
        },
        ['factId']
      )
    case 'get_graph_fact_history':
      return objectSchema({ factId: stringSchema('Context graph node or edge id.') }, ['factId'])
    case 'get_related_nodes':
    case 'explain_trace':
      return objectSchema({ nodeId: stringSchema('Context graph node id.') }, ['nodeId'])
    case 'get_source_trace':
      return objectSchema(
        {
          factId: stringSchema('Context graph node or edge id.'),
          nodeId: stringSchema('Deprecated alias for factId.'),
          mode: stringSchema('Optional trace mode: summary or full.'),
          limitSources: numberSchema('Maximum source refs returned in summary mode.'),
          limitSourceRefs: numberSchema('Maximum source refs returned in summary mode.'),
          limitEvidence: numberSchema('Maximum evidence entries returned in summary mode.'),
          limitNodes: numberSchema('Maximum file/content nodes returned in summary mode.')
        },
        ['factId']
      )
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

function graphPatchSchema(): ContextJsonSchema {
  return {
    type: 'object',
    description: 'Canonical context GraphPatch proposal.',
    additionalProperties: true
  }
}

function objectSchema(properties: Record<string, ContextJsonSchema>, required: string[] = []): ContextJsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
}

function stringSchema(description: string): ContextJsonSchema {
  return { type: 'string', description }
}

function numberSchema(description: string): ContextJsonSchema {
  return { type: 'number', description }
}

function booleanSchema(description: string): ContextJsonSchema {
  return { type: 'boolean', description }
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

function providerKindFor(node: ContextNode): ContextRuntimeProvider['kind'] {
  const kind = nodeStringProperty(node, 'providerKind') ?? nodeStringProperty(node, 'runtimeKind')
  if (kind === 'db-schema' || kind === 'metrics' || kind === 'feature-flags' || kind === 'ci' || kind === 'logs' || kind === 'config') {
    return kind
  }
  if (node.type === 'Metric') return 'metrics'
  if (node.type === 'FeatureFlag') return 'feature-flags'
  if (node.type === 'DatabaseSchema' || node.type === 'DatabaseTable') return 'db-schema'
  if (node.type === 'ConfigItem' || node.type === 'RuntimeConfig') return 'config'
  if (node.type === 'CIRun' || node.type === 'CIJob') return 'ci'
  if (node.type === 'LogPattern') return 'logs'
  return 'static'
}

function providerTransportFor(node: ContextNode): ContextRuntimeProvider['transport'] {
  const transport = nodeStringProperty(node, 'transport')
  return transport === 'command' || transport === 'http' ? transport : 'static'
}

function policyFromProperties(properties: Record<string, unknown>): ContextProviderPolicy | undefined {
  const allowedAgents = stringListProperty(properties, 'allowedAgents')
  const requiresApproval = booleanProperty(properties, 'requiresApproval')
  const timeoutMs = numberProperty(properties, 'timeoutMs')
  const cacheTtlMs = numberProperty(properties, 'cacheTtlMs')
  const redactionLevel = redactionLevelProperty(properties, 'redactionLevel')
  const allowNetwork = booleanProperty(properties, 'allowNetwork')
  const policy: ContextProviderPolicy = {}
  if (allowedAgents.length > 0) policy.allowedAgents = allowedAgents
  if (requiresApproval !== undefined) policy.requiresApproval = requiresApproval
  if (timeoutMs !== undefined) policy.timeoutMs = timeoutMs
  if (cacheTtlMs !== undefined) policy.cacheTtlMs = cacheTtlMs
  if (redactionLevel) policy.redactionLevel = redactionLevel
  if (allowNetwork !== undefined) policy.allowNetwork = allowNetwork
  return Object.keys(policy).length > 0 ? policy : undefined
}

function capabilityGapDiagnostics(graph: ContextGraph, views: ContextPack[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!hasAnyNode(graph, ['TestCase'])) {
    diagnostics.push(createDiagnostic({
      severity: 'info',
      code: 'runtime.capability.not-generated',
      message: 'Test coverage MCP tools were not generated because no TestCase nodes were found.',
      metadata: { capability: 'get_test_coverage' }
    }))
  }
  if (!hasAnyNode(graph, [...RUNTIME_PROVIDER_TYPES])) {
    diagnostics.push(createDiagnostic({
      severity: 'info',
      code: 'runtime.capability.not-generated',
      message: 'Runtime providers were not generated because no runtime provider nodes were found.',
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

function evidenceSeedNodes(graph: ContextGraph): ContextNode[] {
  const semanticNodes = graph.nodes.filter((node) => node.type !== 'Source' && node.type !== 'SourceSnapshot')
  return (semanticNodes.length > 0 ? semanticNodes : graph.nodes).slice(0, 3)
}

function nodeEvidence(node: ContextNode, reason: string): ContextRuntimeEvidence {
  return {
    nodeId: node.id,
    sourceRefs: primarySourceRef(node) ? node.sourceRefs : [],
    reason,
    confidence: node.confidence
  }
}

function stringListProperty(properties: Record<string, unknown>, key: string): string[] {
  const value = properties[key]
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function booleanProperty(properties: Record<string, unknown>, key: string): boolean | undefined {
  const value = properties[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase())) {
    return value.toLowerCase() === 'true'
  }
  return undefined
}

function numberProperty(properties: Record<string, unknown>, key: string): number | undefined {
  const value = properties[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function redactionLevelProperty(properties: Record<string, unknown>, key: string): ContextProviderPolicy['redactionLevel'] | undefined {
  const value = properties[key]
  return value === 'none' || value === 'standard' || value === 'strict' ? value : undefined
}

function hasAnyNode(graph: ContextGraph, types: ContextNode['type'][]): boolean {
  return graph.nodes.some((node) => types.includes(node.type))
}

function hasView(views: ContextPack[], viewName: string): boolean {
  return views.some((view) => view.view === viewName)
}

function byName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name)
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.name, item])).values()]
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function titleFromName(value: string): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

const RUNTIME_PROVIDER_TYPES = new Set<ContextNode['type']>([
  'Metric',
  'RuntimeConfig',
  'ConfigItem',
  'FeatureFlag',
  'DatabaseSchema',
  'DatabaseTable',
  'LogPattern',
  'TraceSpan',
  'CIRun',
  'CIJob'
])
