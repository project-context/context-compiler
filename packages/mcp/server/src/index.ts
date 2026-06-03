import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import {
  compileContextProject,
  explainTrace,
  generateTaskContext,
  loadContextConfig,
  loadGraphFiles,
  queryGraph,
  renderContextView,
  resolveOutputDir,
  type ContextCommandRuntimeProvider,
  type ContextGraph,
  type ContextHttpRuntimeProvider,
  type ContextProjectConfig,
  type ContextRuntimeConfig,
  type ContextRuntimeEvidence,
  type ContextRuntimeFreshness,
  type ContextRuntimeProvider,
  type ContextToolDefinition,
  type ContextStaticRuntimeProvider
} from '@context-compiler/core'
import { createLocalDistribution } from '@context-compiler/distribution-local'

const execFileAsync = promisify(execFile)
const SERVER_INSTRUCTIONS = [
  'Context Compiler exposes the local .context runtime workspace as tools and resources.',
  'Start with get_context_health and get_context_manifest before broad repository exploration.',
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
      return getSourceTrace(project, input)
    case 'explain_capability':
      return explainCapability(project.outputDir, stringInput(input, 'capabilityId'))
    case 'refresh_context':
      return refreshContext(project.config)
    case 'get_task_context':
      return getTaskContext(project, input)
    case 'search_context':
      return {
        results: queryGraph(project.graph, stringInput(input, 'query'), numberInput(input, 'limit') ?? 20).map(summarizeNode)
      }
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
        name: tool.id,
        description: tool.description ?? `Context Compiler tool: ${tool.id}`,
        inputSchema: tool.inputs ?? { type: 'object', additionalProperties: true }
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
  return JSON.parse(await readFile(resolve(outputDir, 'context-manifest.json'), 'utf8')) as unknown
}

async function readContextHealth(outputDir: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(outputDir, 'diagnostics', 'context-health.json'), 'utf8')) as unknown
}

async function readRuntimePlan(outputDir: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(outputDir, 'runtime', 'runtime-plan.json'), 'utf8')) as unknown
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
  const tool = project.mcpTools.find((candidate) => candidate.id === toolName)
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

function getSourceTrace(project: { graph: ContextGraph }, input: Record<string, unknown>): unknown {
  const nodeId = stringInput(input, 'nodeId')
  const trace = explainTrace(project.graph, nodeId)
  return {
    node: trace.node,
    source: trace.node.source,
    relatedEdges: trace.relatedEdges,
    relatedNodes: trace.relatedNodes
  }
}

async function refreshContext(config: ContextProjectConfig): Promise<unknown> {
  const result = await compileContextProject({
    rootDir: config.workspace.rootDir,
    config,
    distribution: createLocalDistribution()
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
    return resource(uri, 'application/json', await readFile(resolve(project.outputDir, 'context-manifest.json'), 'utf8'))
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
  if (!tools.some((tool) => tool.id === name)) {
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
    if (node.type !== 'api_contract') {
      return false
    }
    if (apiId) {
      return node.id === apiId
    }
    const nodePath = typeof node.metadata.path === 'string' ? node.metadata.path : node.title
    const nodeMethod = typeof node.metadata.method === 'string' ? node.metadata.method.toUpperCase() : undefined
    return (!path || nodePath === path || node.title.includes(path)) && (!method || nodeMethod === method)
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
  const provider = runtimeConfig.providers?.find((candidate) => candidate.id === providerId)
  if (!provider) {
    throw new Error(`Runtime provider not found: ${providerId}`)
  }
  assertProviderPolicy(provider, agent)
  switch (provider.kind) {
    case 'static':
      return queryStaticProvider(config, provider)
    case 'command':
      return queryCommandProvider(config, provider)
    case 'http':
      return queryHttpProvider(provider)
  }
}

function assertProviderPolicy(provider: ContextRuntimeProvider, agent: string | undefined): void {
  if (provider.kind === 'static') {
    if (agent && provider.policy?.allowedAgents && !provider.policy.allowedAgents.includes(agent)) {
      throw new Error(`Runtime provider ${provider.id} is not allowed for agent: ${agent}`)
    }
    return
  }
  const policy = provider.policy
  if (!policy) {
    throw new Error(`Runtime provider ${provider.id} requires explicit policy before ${provider.kind} queries`)
  }
  if (policy.allowedAgents && (!agent || !policy.allowedAgents.includes(agent))) {
    throw new Error(`Runtime provider ${provider.id} is not allowed for agent: ${agent ?? 'unknown'}`)
  }
  if (policy.requiresApproval !== false) {
    throw new Error(`Runtime provider ${provider.id} requires approval before ${provider.kind} queries`)
  }
  if (provider.kind === 'http' && policy.allowNetwork !== true) {
    throw new Error(`Runtime provider ${provider.id} requires allowNetwork policy before http queries`)
  }
}

async function queryStaticProvider(config: ContextProjectConfig, provider: ContextStaticRuntimeProvider): Promise<unknown> {
  if ('value' in provider) {
    return provider.value
  }
  if (!provider.path) {
    return null
  }
  const content = await readFile(resolve(config.workspace.rootDir, provider.path), 'utf8')
  return parseMaybeJson(content)
}

async function queryCommandProvider(config: ContextProjectConfig, provider: ContextCommandRuntimeProvider): Promise<unknown> {
  const result = await execFileAsync(provider.command, provider.args ?? [], {
    cwd: provider.cwd ? resolve(config.workspace.rootDir, provider.cwd) : config.workspace.rootDir,
    timeout: provider.policy?.timeoutMs ?? provider.timeoutMs ?? 5000,
    maxBuffer: 1024 * 1024
  })
  return parseMaybeJson(result.stdout.trim())
}

async function queryHttpProvider(provider: ContextHttpRuntimeProvider): Promise<unknown> {
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
    title: node.title,
    content: node.content,
    source: node.source.uri,
    metadata: node.metadata
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  await startContextMcpStdioServer({ rootDir: process.cwd() })
}
