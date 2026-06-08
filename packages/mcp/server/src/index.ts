import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import { compileContextProject } from '@context-compiler/core/compiler'
import { approveContextCorrectionProposal, applyContextCorrectionProposal, buildGraphFactHistory, deriveEvidenceGraphPatches, expandContextPackage, expandGraphTarget, explainGraphFact, getContextCorrectionProposal, getContextPackageCorrectionDecision, getGraphScopeView, getContextPackage, getLayeredSourceTrace, generateTaskContext, listContextPackageCorrections, listContextPackageCorrectionDecisions, listContextPackages, previewContextCorrectionProposal, proposeContextPackageCorrectionDecisionRevert, readEvidenceReportListing, rejectContextCorrectionProposal, replayContextPackageCorrectionDecisions, renderContextView, searchContextPackage, searchContextIndex } from '@context-compiler/core/runtime'
import { applyGraphPatch, createGraphRevision } from '@context-compiler/core/kernel'
import { explainTrace, loadGraphFiles, resolveOutputDir } from '@context-compiler/core/graph'
import { loadContextConfig, nodeContent, nodeStringProperty, sourceUri, type ContextCorrectionProposalKind, type ContextCorrectionProposalStatus, type ContextSourceCorrectionDecisionStatus, type ContextGraph, type ContextGraphScopeManifest, type ContextProjectConfig, type ContextRuntimeConfig, type ContextRuntimeEvidence, type ContextRuntimeFreshness, type ContextRuntimeProvider, type EvidenceReport, type ContextSourceInventoryEntry, type ContextToolDefinition, type GraphPatch, type GraphRevision, type PlanningPack, type RehomeProposal } from '@context-compiler/core/sdk'
import { createBuiltinLocalDistribution } from '@context-compiler/builtin-local'

const execFileAsync = promisify(execFile)
const SERVER_INSTRUCTIONS = [
  'Context Compiler exposes the local .context runtime workspace as tools and resources.',
  'Major work should align with docs/architecture/super-data-network-goal.md, the Super Data Network goal.',
  'Start with get_context_health and get_context_manifest before broad repository exploration.',
  'Use the package-first path: list_context_packages, get_context_package, expand_context_package, and search_context_package as the first drill-down path.',
  'After package drill-down, inspect correction memory first with list_package_correction_decisions, get_package_correction_decision, replay_package_correction_decisions, and propose_package_correction_decision_revert.',
  'Then use list_package_corrections, get_correction_proposal, preview_correction_proposal, approve_correction_proposal, reject_correction_proposal, and apply_correction_proposal before low-level graph patch tools.',
  'Use graph tools such as list_graph_scopes and expand_graph_target for low-level debugging after package context is identified.',
  'Use search_context, get_task_context, get_source_trace, and explain_capability for focused, evidence-backed context.',
  'Use refresh_context only when the compiled context is stale or missing.'
].join(' ')

export interface StartContextMcpServerOptions {
  rootDir: string
  input?: Readable
  output?: Writable
}

interface CompiledContextProject {
  config: ContextProjectConfig
  outputDir: string
  graph: ContextGraph
  runtimeConfig: ContextRuntimeConfig
  mcpTools: ContextToolDefinition[]
}

interface ContextMcpToolEnvelope {
  data: unknown
  evidence: ContextRuntimeEvidence[]
  freshness: ContextRuntimeFreshness
  diagnostics: ContextGraph['diagnostics']
}

/** Call one project context tool directly, useful for tests and embeddings. */
export async function callContextMcpTool(rootDir: string, name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  const project = await loadCompiledProject(rootDir)
  assertGeneratedTool(project.mcpTools, name)
  const data = await callRawContextTool(project, name, input)
  return envelopeToolResult(project, name, data)
}

async function callRawContextTool(project: CompiledContextProject, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_context_view':
      return getContextView(project, input)
    case 'get_context_manifest':
      return readContextManifest(project.outputDir)
    case 'get_context_health':
      return readContextHealth(project.outputDir)
    case 'get_agent_runtime_plan':
      return readRuntimePlan(project.outputDir)
    case 'get_source_trace':
      return getLayeredSourceTrace({ outputDir: project.outputDir, factId: optionalStringInput(input, 'factId') ?? stringInput(input, 'nodeId'), ...traceOptionsFromInput(input) })
    case 'explain_capability':
      return explainCapability(project.outputDir, stringInput(input, 'capabilityId'))
    case 'refresh_context':
      return refreshContext(project.config)
    case 'get_task_context':
      return getTaskContext(project, input)
    case 'list_context_packages':
      return listContextPackages({ outputDir: project.outputDir })
    case 'get_context_package':
      return getContextPackage({ outputDir: project.outputDir, packageRef: stringInput(input, 'packageRef') })
    case 'expand_context_package':
      return expandContextPackage({ outputDir: project.outputDir, packageRef: stringInput(input, 'packageRef'), mode: modeInput(input, 'package expansion') })
    case 'search_context_package':
      return searchContextPackage({
        outputDir: project.outputDir,
        query: stringInput(input, 'query'),
        packageRef: optionalStringInput(input, 'packageRef'),
        limit: numberInput(input, 'limit')
      })
    case 'list_package_corrections':
      return listContextPackageCorrections({
        outputDir: project.outputDir,
        packageRef: optionalStringInput(input, 'packageRef'),
        status: correctionStatusInput(input),
        kind: correctionKindInput(input)
      })
    case 'list_package_correction_decisions':
      return listContextPackageCorrectionDecisions({
        outputDir: project.outputDir,
        packageRef: optionalStringInput(input, 'packageRef'),
        status: sourceCorrectionDecisionStatusInput(input),
        kind: correctionKindInput(input),
        includeDrift: booleanInput(input, 'includeDrift')
      })
    case 'get_package_correction_decision':
      return getContextPackageCorrectionDecision({ outputDir: project.outputDir, decisionId: stringInput(input, 'decisionId') })
    case 'replay_package_correction_decisions':
      return replayContextPackageCorrectionDecisions({
        outputDir: project.outputDir,
        decisionId: optionalStringInput(input, 'decisionId'),
        packageRef: optionalStringInput(input, 'packageRef'),
        dryRun: booleanInput(input, 'dryRun')
      })
    case 'propose_package_correction_decision_revert':
      return proposeContextPackageCorrectionDecisionRevert({
        outputDir: project.outputDir,
        decisionId: stringInput(input, 'decisionId'),
        actor: { type: 'agent', name: optionalStringInput(input, 'actor') ?? 'mcp' },
        reason: optionalStringInput(input, 'reason'),
        config: project.config
      })
    case 'get_correction_proposal':
      return getContextCorrectionProposal({ outputDir: project.outputDir, proposalId: stringInput(input, 'proposalId') })
    case 'preview_correction_proposal':
      return previewContextCorrectionProposal({ outputDir: project.outputDir, proposalId: stringInput(input, 'proposalId') })
    case 'approve_correction_proposal':
      return approveContextCorrectionProposal({
        outputDir: project.outputDir,
        proposalId: stringInput(input, 'proposalId'),
        actor: { type: 'agent', name: optionalStringInput(input, 'actor') ?? 'mcp' },
        reason: optionalStringInput(input, 'reason')
      })
    case 'reject_correction_proposal':
      return rejectContextCorrectionProposal({
        outputDir: project.outputDir,
        proposalId: stringInput(input, 'proposalId'),
        actor: { type: 'agent', name: optionalStringInput(input, 'actor') ?? 'mcp' },
        reason: optionalStringInput(input, 'reason')
      })
    case 'apply_correction_proposal':
      return applyContextCorrectionProposal({
        outputDir: project.outputDir,
        proposalId: stringInput(input, 'proposalId'),
        dryRun: booleanInput(input, 'dryRun'),
        actor: { type: 'agent', name: optionalStringInput(input, 'actor') ?? 'mcp' },
        reason: optionalStringInput(input, 'reason'),
        config: project.config
      })
    case 'list_graph_scopes':
      return listGraphScopes(project.outputDir)
    case 'get_graph_scope':
      return getGraphScopeView({ outputDir: project.outputDir, scopeId: stringInput(input, 'scopeId'), ...scopeOptionsFromInput(input) })
    case 'expand_graph_scope':
      return getGraphScopeView({ outputDir: project.outputDir, scopeId: stringInput(input, 'scopeId'), ...scopeOptionsFromInput(input) })
    case 'expand_graph_target':
      return expandGraphTarget({ outputDir: project.outputDir, targetId: stringInput(input, 'targetId'), ...expansionOptionsFromInput(input) })
    case 'get_planning_pack':
      return readPlanningPack(project.outputDir)
    case 'inspect_source_candidate':
      return inspectSourceCandidate(project.outputDir, stringInput(input, 'path'))
    case 'search_source_inventory':
      return searchSourceInventory(project.outputDir, input)
    case 'simulate_graph_patch':
      return simulateGraphPatch(project, input)
    case 'submit_graph_patch':
      return submitGraphPatch(project.outputDir, input)
    case 'list_graph_patches':
      return listGraphPatches(project.outputDir)
    case 'list_evidence_reports':
      return listEvidenceReports(project.outputDir, input)
    case 'explain_graph_fact':
      return explainGraphFact({ outputDir: project.outputDir, factId: stringInput(input, 'factId'), ...explainOptionsFromInput(input) })
    case 'get_graph_fact_history':
      return buildGraphFactHistory({ outputDir: project.outputDir, factId: stringInput(input, 'factId') })
    case 'get_rehome_proposals':
      return getRehomeProposals(project.outputDir)
    case 'search_context':
      return searchContext(project, input)
    case 'get_related_nodes':
    case 'explain_trace':
      return explainTrace(project.graph, stringInput(input, 'nodeId'))
    case 'get_api_context':
      return getApiContext(project.graph, input)
    case 'get_test_coverage':
      return getTestCoverage(project.graph, input)
    case 'get_diagnostics':
      return { diagnostics: project.graph.diagnostics }
    case 'get_runtime_config':
      return project.runtimeConfig
    case 'list_project_tools':
      return { tools: project.runtimeConfig.tools ?? [] }
    case 'list_project_skills':
      return { skills: project.runtimeConfig.skills ?? [] }
    case 'list_runtime_providers':
      return { providers: project.runtimeConfig.providers ?? [] }
    case 'query_runtime_provider':
      return queryRuntimeProvider(project.config, project.runtimeConfig, input)
    default:
      throw new Error(`Unknown context MCP tool: ${name}`)
  }
}

/** Start a minimal stdio JSON-RPC server exposing project context tools. */
export async function startContextMcpStdioServer(options: StartContextMcpServerOptions): Promise<void> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const lines = createInterface({ input })
  const pendingResponses: Array<Promise<void>> = []
  const closed = Promise.race([once(lines, 'close'), once(input, 'end'), once(input, 'close')])

  lines.on('line', (line) => {
    if (line.trim().length === 0) {
      return
    }
    pendingResponses.push(respondToLine(options.rootDir, output, line))
  })

  await closed
  lines.close()
  await Promise.all(pendingResponses)
}

async function respondToLine(rootDir: string, output: Writable, line: string): Promise<void> {
  const request = JSON.parse(line) as { id?: unknown; method?: string; params?: Record<string, unknown> }
  if (!('id' in request)) {
    return
  }
  try {
    const result = await handleJsonRpcRequest(rootDir, request.method ?? '', request.params ?? {})
    await writeJsonRpcLine(output, { jsonrpc: '2.0', id: request.id, result })
  } catch (error) {
    await writeJsonRpcLine(output, {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
        data: {
          type: 'context-compiler-error',
          retryable: false
        }
      }
    })
  }
}

async function writeJsonRpcLine(output: Writable, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    output.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error && 'code' in error && error.code === 'EPIPE') {
        resolve()
        return
      }
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function handleJsonRpcRequest(rootDir: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: '@context-compiler/mcp-server', version: '0.1.0' },
      instructions: SERVER_INSTRUCTIONS
    }
  }
  if (method === 'tools/list') {
    const project = await loadCompiledProject(rootDir)
    return {
      tools: project.mcpTools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? `Context Compiler tool: ${tool.name}`,
        inputSchema: tool.inputSchema ?? { type: 'object', additionalProperties: true }
      }))
    }
  }
  if (method === 'resources/list') {
    const project = await loadCompiledProject(rootDir)
    return listContextResources(project)
  }
  if (method === 'resources/read') {
    const project = await loadCompiledProject(rootDir)
    return readContextResource(project, stringInput(params, 'uri'))
  }
  if (method === 'tools/call') {
    const toolName = stringInput(params, 'name')
    const args = isRecord(params.arguments) ? params.arguments : {}
    const result = await callContextMcpTool(rootDir, toolName, args)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    }
  }
  return {}
}

async function loadCompiledProject(rootDir: string): Promise<CompiledContextProject> {
  const { config } = await loadContextConfig(rootDir)
  const outputDir = resolveOutputDir(config.workspace.rootDir, config.outputDir ?? '.context')
  const [graph, runtimeConfig, mcpTools] = await Promise.all([
    loadGraphFiles(outputDir),
    readRuntimeConfig(outputDir, config),
    readGeneratedMcpTools(outputDir)
  ])
  return { config, outputDir, graph, runtimeConfig, mcpTools }
}

async function readRuntimeConfig(outputDir: string, config: ContextProjectConfig): Promise<ContextRuntimeConfig> {
  try {
    return JSON.parse(await readFile(resolve(outputDir, 'runtime', 'runtime.config.json'), 'utf8')) as ContextRuntimeConfig
  } catch {
    return {}
  }
}

async function readGeneratedMcpTools(outputDir: string): Promise<ContextToolDefinition[]> {
  try {
    return JSON.parse(await readFile(resolve(outputDir, 'mcp', 'tools.json'), 'utf8')) as ContextToolDefinition[]
  } catch {
    return []
  }
}

async function readContextManifest(outputDir: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(outputDir, 'manifest.json'), 'utf8')) as unknown
}

async function readContextHealth(outputDir: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(outputDir, 'diagnostics', 'context-health.json'), 'utf8')) as unknown
}

async function readRuntimePlan(outputDir: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(outputDir, 'runtime', 'runtime-plan.json'), 'utf8')) as unknown
}

async function readGraphScopeManifest(outputDir: string): Promise<ContextGraphScopeManifest> {
  return JSON.parse(await readFile(resolve(outputDir, 'graph', 'scopes', 'manifest.json'), 'utf8')) as ContextGraphScopeManifest
}

async function readRuntimeFreshness(outputDir: string): Promise<ContextRuntimeFreshness> {
  try {
    const summary = JSON.parse(await readFile(resolve(outputDir, 'runtime', 'run-summary.json'), 'utf8')) as {
      freshness?: ContextRuntimeFreshness
    }
    return summary.freshness ?? { status: 'unknown' }
  } catch {
    return { status: 'unknown' }
  }
}

async function envelopeToolResult(project: CompiledContextProject, toolName: string, data: unknown): Promise<ContextMcpToolEnvelope> {
  const tool = project.mcpTools.find((candidate) => candidate.name === toolName)
  return {
    data,
    evidence: tool?.evidence ?? [],
    freshness: await readRuntimeFreshness(project.outputDir),
    diagnostics: project.graph.diagnostics
  }
}

async function explainCapability(outputDir: string, capabilityId: string): Promise<unknown> {
  const plan = await readRuntimePlan(outputDir) as { capabilities?: Array<Record<string, unknown>> }
  const capability = plan.capabilities?.find((candidate) => candidate.id === capabilityId)
  if (!capability) {
    throw new Error(`Runtime capability not found: ${capabilityId}`)
  }
  return { capability }
}

async function listGraphScopes(outputDir: string): Promise<unknown> {
  const manifest = await readGraphScopeManifest(outputDir)
  return {
    schemaVersion: manifest.schemaVersion,
    scopes: manifest.scopes.map((scope) => ({
      id: scope.id,
      kind: scope.kind,
      parentScopeId: scope.parentScopeId,
      rootNodeId: scope.rootNodeId,
      sourceGroupId: scope.sourceGroupId,
      path: scope.path,
      title: scope.title,
      summary: scope.summary,
      boundaryMode: scope.boundaryMode,
      adapterRefs: scope.adapterRefs,
      stats: scope.stats,
      freshness: scope.freshness,
      indexRefs: scope.indexRefs
    })),
    adapters: manifest.adapters
  }
}

async function searchContext(project: CompiledContextProject, input: Record<string, unknown>): Promise<unknown> {
  const query = stringInput(input, 'query')
  const limit = numberInput(input, 'limit') ?? 20
  const scopeId = optionalStringInput(input, 'scopeId')
  const result = await searchContextIndex({
    outputDir: project.outputDir,
    graph: project.graph,
    query,
    limit,
    scopeId
  })
  return {
    scopeId: result.scopeId,
    engine: result.engine,
    indexPath: result.indexPath,
    results: result.results.map(summarizeNode),
    diagnostics: result.diagnostics
  }
}

async function readPlanningPack(outputDir: string): Promise<PlanningPack> {
  return JSON.parse(await readFile(resolve(outputDir, 'plans', 'planning-pack.json'), 'utf8')) as PlanningPack
}

async function inspectSourceCandidate(outputDir: string, path: string): Promise<unknown> {
  const [planningPack, inventory] = await Promise.all([readPlanningPack(outputDir), readSourceInventory(outputDir)])
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const candidate = planningPack.candidates.find((item) => normalizePath(item.path).replace(/^\.\/+/, '').replace(/\/+$/, '') === normalizedPath)
  const entries = inventory.filter((entry) => pathWithin(entry.path, path))
  return {
    path,
    candidate,
    totalFiles: entries.length,
    entries: entries.slice(0, 100)
  }
}

async function searchSourceInventory(outputDir: string, input: Record<string, unknown>): Promise<unknown> {
  const query = stringInput(input, 'query').toLowerCase()
  const limit = numberInput(input, 'limit') ?? 20
  const inventory = await readSourceInventory(outputDir)
  const results = inventory
    .filter((entry) => inventorySearchText(entry).includes(query))
    .slice(0, limit)
  return { query, results }
}

async function readSourceInventory(outputDir: string): Promise<ContextSourceInventoryEntry[]> {
  return readOptionalJsonl<ContextSourceInventoryEntry>(resolve(outputDir, 'sources', 'inventory.jsonl'))
}

function inventorySearchText(entry: ContextSourceInventoryEntry): string {
  return [
    entry.id,
    entry.sourceName,
    entry.root,
    entry.path,
    entry.uri,
    entry.mediaType,
    entry.route,
    entry.status,
    entry.unsupportedReason
  ].filter(Boolean).join('\n').toLowerCase()
}

async function listGraphPatches(outputDir: string): Promise<unknown> {
  const [ledger, inbox, evidenceReports, graph, revisions] = await Promise.all([
    readOptionalJsonl<GraphPatch>(resolve(outputDir, 'graph', 'patches', 'patches.jsonl')),
    readOptionalJsonl<GraphPatch>(submittedPatchPath(outputDir)),
    readOptionalJsonl<EvidenceReport>(resolve(outputDir, 'graph', 'evidence-reports.jsonl')),
    loadGraphFiles(outputDir),
    readGraphRevisions(outputDir)
  ])
  const baseRevision = revisions.at(-1) ?? createGraphRevision(graph, {
    reason: 'materialized compile graph',
    status: 'materialized'
  })
  const evidence = deriveEvidenceGraphPatches(graph, baseRevision, evidenceReports, ledger)
  return {
    ledger,
    inbox,
    evidence: evidence.evidencePatches,
    patches: [...ledger, ...inbox, ...evidence.evidencePatches],
    counts: {
      ledger: ledger.length,
      inbox: inbox.length,
      evidence: evidence.evidencePatches.length,
      total: ledger.length + inbox.length + evidence.evidencePatches.length
    }
  }
}

async function getRehomeProposals(outputDir: string): Promise<unknown> {
  const proposals = await readOptionalJsonl<RehomeProposal>(resolve(outputDir, 'proposals', 'rehome-proposals.jsonl'))
  return { proposals }
}

async function listEvidenceReports(outputDir: string, input: Record<string, unknown>): Promise<unknown> {
  return readEvidenceReportListing(outputDir, { scopeId: optionalStringInput(input, 'scopeId') })
}

async function simulateGraphPatch(project: CompiledContextProject, input: Record<string, unknown>): Promise<unknown> {
  const patch = graphPatchInput(input)
  const revision = await resolvePatchRevision(project.outputDir, patch)
  const result = applyGraphPatch(project.graph, patch, revision)
  return {
    simulated: true,
    patchId: patch.id,
    baseRevisionId: revision.id,
    revision: result.revision,
    graph: {
      nodes: result.graph.nodes.length,
      edges: result.graph.edges.length,
      diagnostics: result.graph.diagnostics.length
    },
    rehomeProposals: result.rehomeProposals
  }
}

async function submitGraphPatch(outputDir: string, input: Record<string, unknown>): Promise<unknown> {
  const patch = graphPatchInput(input)
  await resolvePatchRevision(outputDir, patch)
  const path = submittedPatchPath(outputDir)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(patch)}\n`, 'utf8')
  return {
    submitted: true,
    patchId: patch.id,
    path: '.context/graph/patches/submitted.jsonl'
  }
}

async function resolvePatchRevision(outputDir: string, patch: GraphPatch): Promise<GraphRevision> {
  const revisions = await readGraphRevisions(outputDir)
  const revision = revisions.find((candidate) => candidate.id === patch.revisionId)
  if (!revision) {
    throw new Error(`Graph revision not found for patch ${patch.id}: ${patch.revisionId}`)
  }
  return revision
}

async function readGraphRevisions(outputDir: string): Promise<GraphRevision[]> {
  return readOptionalJsonl<GraphRevision>(resolve(outputDir, 'graph', 'revisions', 'revisions.jsonl'))
}

function submittedPatchPath(outputDir: string): string {
  return resolve(outputDir, 'graph', 'patches', 'submitted.jsonl')
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8')
  if (content.trim().length === 0) {
    return []
  }
  return content.trim().split('\n').map((line) => JSON.parse(line) as T)
}

async function readOptionalJsonl<T>(path: string): Promise<T[]> {
  try {
    return await readJsonl<T>(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function graphPatchInput(input: Record<string, unknown>): GraphPatch {
  const value = input.patch
  if (!isRecord(value)) {
    throw new Error('Missing graph patch input: patch')
  }
  if (value.schemaVersion !== 'context-graph-patch.v1') {
    throw new Error('Graph patch must use schemaVersion context-graph-patch.v1')
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Graph patch is missing id')
  }
  if (typeof value.revisionId !== 'string' || value.revisionId.length === 0) {
    throw new Error(`Graph patch ${value.id} is missing revisionId`)
  }
  if (!Array.isArray(value.operations)) {
    throw new Error(`Graph patch ${value.id} is missing operations`)
  }
  return value as unknown as GraphPatch
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

async function refreshContext(config: ContextProjectConfig): Promise<unknown> {
  const result = await compileContextProject({
    rootDir: config.workspace.rootDir,
    config,
    distribution: createBuiltinLocalDistribution()
  })
  return {
    refreshed: true,
    graph: {
      nodes: result.graph.nodes.length,
      edges: result.graph.edges.length,
      diagnostics: result.graph.diagnostics.length
    }
  }
}

function listContextResources(project: CompiledContextProject): { resources: Array<Record<string, unknown>> } {
  const views = new Set(['project'])
  return {
    resources: [
      {
        uri: 'context://manifest',
        name: 'Context manifest',
        description: 'The .context control-plane manifest.',
        mimeType: 'application/json'
      },
      {
        uri: 'context://health',
        name: 'Context health',
        description: 'Runtime health, diagnostics, counts, and capability gaps.',
        mimeType: 'application/json'
      },
      {
        uri: 'context://runtime-plan',
        name: 'Context runtime plan',
        description: 'Generated providers, tools, skills, agents, plugins, and capabilities.',
        mimeType: 'application/json'
      },
      ...[...views].map((view) => ({
        uri: `context://views/${view}`,
        name: `Context view: ${view}`,
        description: `Human-readable ${view} context view.`,
        mimeType: 'text/markdown'
      }))
    ]
  }
}

async function readContextResource(project: CompiledContextProject, uri: string): Promise<{ contents: Array<Record<string, string>> }> {
  if (uri === 'context://manifest') {
    return resource(uri, 'application/json', await readFile(resolve(project.outputDir, 'manifest.json'), 'utf8'))
  }
  if (uri === 'context://health') {
    return resource(uri, 'application/json', await readFile(resolve(project.outputDir, 'diagnostics', 'context-health.json'), 'utf8'))
  }
  if (uri === 'context://runtime-plan') {
    return resource(uri, 'application/json', await readFile(resolve(project.outputDir, 'runtime', 'runtime-plan.json'), 'utf8'))
  }
  if (uri.startsWith('context://views/')) {
    const view = uri.slice('context://views/'.length)
    const result = await getContextView(project, { view })
    return resource(uri, 'text/markdown', result.content)
  }
  throw new Error(`Unknown context resource: ${uri}`)
}

function resource(uri: string, mimeType: string, text: string): { contents: Array<Record<string, string>> } {
  return { contents: [{ uri, mimeType, text }] }
}

function assertGeneratedTool(tools: ContextToolDefinition[], name: string): void {
  if (!tools.some((tool) => tool.name === name)) {
    throw new Error(`MCP tool not generated for this project: ${name}`)
  }
}

async function getContextView(
  project: { outputDir: string; graph: ContextGraph; config: ContextProjectConfig },
  input: Record<string, unknown>
): Promise<{ view: string; content: string }> {
  const view = stringInput(input, 'view', 'project')
  try {
    return {
      view,
      content: await readFile(resolve(project.outputDir, 'views', `${view}.md`), 'utf8')
    }
  } catch {
    return {
      view,
      content: renderContextView(project.graph, project.config, view)
    }
  }
}

function getTaskContext(
  project: { graph: ContextGraph; config: ContextProjectConfig },
  input: Record<string, unknown>
): unknown {
  const task = stringInput(input, 'task')
  const focus = optionalStringInput(input, 'focus')
  const module = optionalStringInput(input, 'module')
  const result = generateTaskContext(project.graph, project.config, { task, focus, module })
  return {
    task: result.task,
    focus: result.focus,
    workspace: result.workspace,
    nodes: result.nodes.map(summarizeNode),
    edges: result.edges,
    diagnostics: result.diagnostics,
    recommendedChecks: result.recommendedChecks
  }
}

function getApiContext(graph: ContextGraph, input: Record<string, unknown>): unknown {
  const apiId = optionalStringInput(input, 'apiId')
  const path = optionalStringInput(input, 'path')
  const method = optionalStringInput(input, 'method')?.toUpperCase()
  const apis = graph.nodes.filter((node) => {
    if (node.type !== 'APIEndpoint') {
      return false
    }
    if (apiId) {
      return node.id === apiId
    }
    const nodePath = nodeStringProperty(node, 'path') ?? node.name
    const nodeMethod = nodeStringProperty(node, 'method')?.toUpperCase()
    return (!path || nodePath === path || node.name.includes(path)) && (!method || nodeMethod === method)
  })
  return { apis: apis.map(summarizeNode) }
}

function getTestCoverage(graph: ContextGraph, input: Record<string, unknown>): unknown {
  const requirementId = optionalStringInput(input, 'requirementId')
  const edges = graph.edges.filter((edge) => edge.type === 'verified_by' && (!requirementId || edge.from === requirementId))
  const testIds = new Set(edges.map((edge) => edge.to))
  return {
    requirementId,
    edges,
    tests: graph.nodes.filter((node) => testIds.has(node.id)).map(summarizeNode)
  }
}

async function queryRuntimeProvider(
  config: ContextProjectConfig,
  runtimeConfig: ContextRuntimeConfig,
  input: Record<string, unknown>
): Promise<unknown> {
  const providerId = stringInput(input, 'providerId')
  const agent = optionalStringInput(input, 'agent')
  const provider = runtimeConfig.providers?.find((candidate) => candidate.name === providerId)
  if (!provider) {
    throw new Error(`Runtime provider not found: ${providerId}`)
  }
  assertProviderPolicy(provider, agent)
  switch (provider.transport) {
    case 'static':
      return queryStaticProvider(config, provider)
    case 'command':
      return queryCommandProvider(config, provider)
    case 'http':
      return queryHttpProvider(provider)
  }
}

function assertProviderPolicy(provider: ContextRuntimeProvider, agent: string | undefined): void {
  if (provider.transport === 'static') {
    if (agent && provider.policy?.allowedAgents && !provider.policy.allowedAgents.includes(agent)) {
      throw new Error(`Runtime provider ${provider.name} is not allowed for agent: ${agent}`)
    }
    return
  }
  const policy = provider.policy
  if (!policy) {
    throw new Error(`Runtime provider ${provider.name} requires explicit policy before ${provider.transport} queries`)
  }
  if (policy.allowedAgents && (!agent || !policy.allowedAgents.includes(agent))) {
    throw new Error(`Runtime provider ${provider.name} is not allowed for agent: ${agent ?? 'unknown'}`)
  }
  if (policy.requiresApproval !== false) {
    throw new Error(`Runtime provider ${provider.name} requires approval before ${provider.transport} queries`)
  }
  if (provider.transport === 'http' && policy.allowNetwork !== true) {
    throw new Error(`Runtime provider ${provider.name} requires allowNetwork policy before http queries`)
  }
}

async function queryStaticProvider(config: ContextProjectConfig, provider: ContextRuntimeProvider): Promise<unknown> {
  if ('value' in provider) {
    return provider.value
  }
  if (!provider.path) {
    return null
  }
  const content = await readFile(resolve(config.workspace.rootDir, provider.path), 'utf8')
  return parseMaybeJson(content)
}

async function queryCommandProvider(config: ContextProjectConfig, provider: ContextRuntimeProvider): Promise<unknown> {
  if (!provider.command) {
    throw new Error(`Runtime provider ${provider.name} is missing command`)
  }
  const result = await execFileAsync(provider.command, provider.args ?? [], {
    cwd: provider.cwd ? resolve(config.workspace.rootDir, provider.cwd) : config.workspace.rootDir,
    timeout: provider.policy?.timeoutMs ?? provider.timeoutMs ?? 5000,
    maxBuffer: 1024 * 1024
  })
  return parseMaybeJson(result.stdout.trim())
}

async function queryHttpProvider(provider: ContextRuntimeProvider): Promise<unknown> {
  if (!provider.url) {
    throw new Error(`Runtime provider ${provider.name} is missing url`)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), provider.policy?.timeoutMs ?? provider.timeoutMs ?? 5000)
  try {
    const response = await fetch(provider.url, {
      method: provider.method ?? 'GET',
      headers: provider.headers,
      body: provider.body === undefined ? undefined : JSON.stringify(provider.body),
      signal: controller.signal
    })
    const text = await response.text()
    return parseMaybeJson(text)
  } finally {
    clearTimeout(timeout)
  }
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function summarizeNode(node: ContextGraph['nodes'][number]): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    content: nodeContent(node),
    source: sourceUri(node),
    sourceRefs: node.sourceRefs,
    properties: node.properties
  }
}

function stringInput(input: Record<string, unknown>, key: string, fallback?: string): string {
  const value = input[key]
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (fallback !== undefined) {
    return fallback
  }
  throw new Error(`Missing string input: ${key}`)
}

function optionalStringInput(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberInput(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' ? value : undefined
}

function booleanInput(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key]
  return typeof value === 'boolean' ? value : undefined
}

function correctionStatusInput(input: Record<string, unknown>): ContextCorrectionProposalStatus | undefined {
  const status = optionalStringInput(input, 'status')
  if (status === undefined) {
    return undefined
  }
  if (status !== 'proposed' && status !== 'approved' && status !== 'rejected' && status !== 'applied') {
    throw new Error('Invalid correction status. Expected proposed, approved, rejected, or applied.')
  }
  return status
}

function sourceCorrectionDecisionStatusInput(input: Record<string, unknown>): ContextSourceCorrectionDecisionStatus | undefined {
  const status = optionalStringInput(input, 'status')
  if (status === undefined) {
    return undefined
  }
  if (status !== 'applied' && status !== 'superseded' && status !== 'reverted' && status !== 'invalid') {
    throw new Error('Invalid source correction decision status. Expected applied, superseded, reverted, or invalid.')
  }
  return status
}

function correctionKindInput(input: Record<string, unknown>): ContextCorrectionProposalKind | undefined {
  const kind = optionalStringInput(input, 'kind')
  if (kind === undefined) {
    return undefined
  }
  if (kind !== 'relabel' && kind !== 'split' && kind !== 'merge' && kind !== 'rehome' && kind !== 'confirm_relation' && kind !== 'reject_relation') {
    throw new Error('Invalid correction kind. Expected relabel, split, merge, rehome, confirm_relation, or reject_relation.')
  }
  return kind
}

function explainOptionsFromInput(input: Record<string, unknown>) {
  const mode = optionalStringInput(input, 'mode')
  if (mode !== undefined && mode !== 'summary' && mode !== 'full') {
    throw new Error('Invalid explain mode. Expected summary or full.')
  }
  return {
    mode: (mode ?? 'summary') as 'summary' | 'full',
    limitSources: numberInput(input, 'limitSources'),
    limitEvidence: numberInput(input, 'limitEvidence'),
    limitRelations: numberInput(input, 'limitRelations'),
    limitProvenance: numberInput(input, 'limitProvenance')
  }
}

function scopeOptionsFromInput(input: Record<string, unknown>) {
  const mode = modeInput(input, 'scope')
  return {
    mode,
    limitNodes: numberInput(input, 'limitNodes'),
    limitEdges: numberInput(input, 'limitEdges'),
    limitChildScopes: numberInput(input, 'limitChildScopes'),
    limitSourceRefs: numberInput(input, 'limitSourceRefs'),
    limitEvidence: numberInput(input, 'limitEvidence')
  }
}

function expansionOptionsFromInput(input: Record<string, unknown>) {
  const direction = optionalStringInput(input, 'direction')
  if (direction !== undefined && direction !== 'up' && direction !== 'down' && direction !== 'around') {
    throw new Error('Invalid graph expansion direction. Expected up, down, or around.')
  }
  return {
    ...scopeOptionsFromInput(input),
    direction: direction as 'up' | 'down' | 'around' | undefined,
    depth: numberInput(input, 'depth')
  }
}

function traceOptionsFromInput(input: Record<string, unknown>) {
  return {
    mode: modeInput(input, 'source trace'),
    limitNodes: numberInput(input, 'limitNodes'),
    limitEdges: numberInput(input, 'limitEdges'),
    limitChildScopes: numberInput(input, 'limitChildScopes'),
    limitSources: numberInput(input, 'limitSources'),
    limitSourceRefs: numberInput(input, 'limitSourceRefs'),
    limitEvidence: numberInput(input, 'limitEvidence')
  }
}

function modeInput(input: Record<string, unknown>, label: string): 'summary' | 'full' {
  const mode = optionalStringInput(input, 'mode')
  if (mode !== undefined && mode !== 'summary' && mode !== 'full') {
    throw new Error(`Invalid ${label} mode. Expected summary or full.`)
  }
  return (mode ?? 'summary') as 'summary' | 'full'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  await startContextMcpStdioServer({ rootDir: process.cwd() })
}
