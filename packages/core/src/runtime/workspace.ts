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
  EvidenceReport,
  GraphPatch,
  GraphRevision,
  PlanningCycle,
  PlanningPack,
  RehomeProposal,
  ContextSourceFirstPlans,
  ContextSourceInventory,
  ContextSkillDefinition,
  ContextToolDefinition
} from '../contracts/index.js'
import { buildContextAgentInstallPlan } from './agent-integration.js'
import { buildContextRuntimeHealth } from './health.js'
import { buildContextIndexes, type ContextIndexes } from './indexes.js'
import { buildContextRuntimePlan } from './planner.js'
import { buildSourceFirstPlans } from '../planning/index.js'
import { buildPlanningPack, createGraphRevision } from '../kernel/index.js'
import { fingerprintValue } from '../graph/model.js'

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
  sourceInventory: ContextSourceInventory
  sourceFirstPlans: ContextSourceFirstPlans
  graphKernel: ContextGraphKernelWorkspace
  agentInstallPlan: ContextAgentInstallPlan
  health: ContextRuntimeHealth
}

export interface ContextGraphKernelWorkspace {
  revisions: GraphRevision[]
  patches: GraphPatch[]
  evidenceReports: EvidenceReport[]
  planningPack: PlanningPack
  planningCycles: PlanningCycle[]
  rehomeProposals: RehomeProposal[]
}

/** Build all generated runtime records before the file emitter writes them. */
export function buildContextRuntimeWorkspace(
  graph: ContextGraph,
  config: ContextProjectConfig,
  packs: ContextPack[],
  options: {
    compiledAt?: string
    compilerVersion?: string
    pipelineId?: string
    plan?: ContextRuntimePlan
    sourceInventory?: ContextSourceInventory
    evidenceReports?: EvidenceReport[]
    graphKernel?: ContextGraphKernelWorkspace
  } = {}
): ContextRuntimeWorkspace {
  const compiledAt = options.compiledAt ?? new Date().toISOString()
  const sourceInventory = options.sourceInventory ?? emptySourceInventory()
  const indexes = buildContextIndexes(graph, { sourceInventory })
  const sourceFirstPlans = buildSourceFirstPlans({ graph, sourceInventory, config, generatedAt: compiledAt })
  const graphKernel = options.graphKernel ?? buildGraphKernelWorkspace(graph, sourceInventory, compiledAt, options.evidenceReports ?? [])
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
      version: options.compilerVersion ?? '0.1.0',
      project: {
        name: config.workspace.name,
        language: 'unknown',
        root: '.'
      },
      compiledAt,
      compiler: {
        name: 'context-compiler',
        version: options.compilerVersion ?? '0.1.0',
        pipeline: options.pipelineId ?? 'compile'
      },
      scale: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        diagnostics: graph.diagnostics.length,
        requirements: graph.nodes.filter((node) => node.type === 'Requirement').length,
        apis: graph.nodes.filter((node) => node.type === 'APIEndpoint').length,
        testCases: graph.nodes.filter((node) => node.type === 'TestCase').length
      },
      graph: {
        model: 'typed-property-graph',
        storage: 'jsonl+sqlite',
        nodes: '.context/graph/global/nodes.jsonl',
        edges: '.context/graph/global/edges.jsonl',
        subgraphs: '.context/graph/subgraphs',
        scopes: '.context/graph/scopes/manifest.json',
        partitions: '.context/graph/partitions',
        revisions: '.context/graph/revisions/revisions.jsonl',
        patches: '.context/graph/patches/patches.jsonl',
        evidenceReports: '.context/graph/evidence-reports.jsonl'
      },
      indexes: {
        graph: indexes.manifest.files.graph,
        symbols: indexes.manifest.files.symbols,
        apis: indexes.manifest.files.apis,
        docs: indexes.manifest.files.docs,
        tests: indexes.manifest.files.tests,
        runtime: indexes.manifest.files.runtime,
        fts: indexes.manifest.files.fts,
        fingerprints: indexes.manifest.files.fingerprints,
        scopes: indexes.manifest.files.scopes
      },
      plans: {
        planningPack: '.context/plans/planning-pack.json',
        planningCycles: '.context/plans/planning-cycles.jsonl',
        sourceTriage: '.context/plans/source-triage.json',
        sourceGroups: '.context/plans/source-group-plan.json',
        workspaceGraph: '.context/plans/workspace-graph-plan.json',
        scopeBuild: '.context/plans/scope-build-plan.json',
        adapterPlan: '.context/plans/adapter-plan.json'
      },
      proposals: {
        rehome: '.context/proposals/rehome-proposals.jsonl',
        corrections: '.context/proposals/corrections.jsonl'
      },
      artifacts: {
        projectBrief: '.context/artifacts/project/brief.md',
        domains: '.context/artifacts/domains',
        tasks: '.context/artifacts/tasks/generated',
        reports: '.context/artifacts/reports'
      },
      sources: {
        inventory: '.context/sources/inventory.jsonl',
        routes: '.context/sources/routes.jsonl',
        unsupported: '.context/sources/unsupported.jsonl',
        summary: '.context/sources/summary.json',
        groups: '.context/sources/groups.jsonl',
        packages: '.context/sources/packages.jsonl',
        buildUnits: '.context/sources/build-units.jsonl',
        groupingRequest: '.context/sources/grouping-request.json',
        groupingDecisions: '.context/sources/grouping-decisions.json',
        correctionDecisions: '.context/sources/correction-decisions.jsonl'
      },
      packs: packs.map((pack) => ({ id: pack.id, kind: pack.kind, view: pack.view, task: pack.task })),
      runtime: {
        providers: '.context/runtime/providers',
        mcp: '.context/mcp/server.config.json',
        tools: '.context/tools',
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
        skills: runtimeConfig.skills.map((skill) => skill.id),
        agents: runtimeConfig.agents.map((agent) => agent.id),
        plugins: runtimeConfig.plugins.map((plugin) => plugin.id)
      },
      agents: {
        claude: '.context/agents/claude/CLAUDE.generated.md',
        codex: '.context/agents/codex/AGENTS.generated.md',
        cursor: '.context/agents/cursor/rules/context.generated.md'
      },
      diagnostics: {
        health: '.context/diagnostics/context-health.json',
        latest: '.context/diagnostics/latest.jsonl',
        report: '.context/artifacts/reports/diagnostics.md'
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
    sourceInventory,
    sourceFirstPlans,
    graphKernel,
    agentInstallPlan,
    health
  }
}

function buildGraphKernelWorkspace(
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory,
  generatedAt: string,
  evidenceReports: EvidenceReport[]
): ContextGraphKernelWorkspace {
  const seedRevision = createGraphRevision(graph, {
    reason: 'materialized compile graph',
    status: 'materialized',
    createdAt: generatedAt
  })
  const planningPack = buildPlanningPack(sourceInventory, { generatedAt })
  const planningCycle: PlanningCycle = {
    schemaVersion: 'context-planning-cycle.v1',
    id: `CYCLE-${fingerprintValue({ revisionId: seedRevision.id, generatedAt }).slice(0, 16)}`,
    generatedAt,
    status: 'reconciled',
    planningPackRef: '.context/plans/planning-pack.json',
    requestRef: sourceInventory.groupingRequest ? '.context/sources/grouping-request.json' : undefined,
    patchIds: [],
    revisionIds: [seedRevision.id],
    diagnostics: []
  }
  return {
    revisions: [seedRevision],
    patches: [],
    evidenceReports,
    planningPack,
    planningCycles: [planningCycle],
    rehomeProposals: []
  }
}

function emptySourceInventory(): ContextSourceInventory {
  return {
    schemaVersion: 'context-source-inventory.v1',
    entries: [],
    summary: {
      roots: 0,
      files: 0,
      packages: 0,
      groups: 0,
      routed: 0,
      inventoryOnly: 0,
      unsupported: 0,
      skipped: 0
    }
  }
}
