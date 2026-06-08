import type { Diagnostic, DiagnosticSeverity } from './graph.js'
import type { SourceRef } from './config.js'
export type ContextRuntimeProviderKind = 'db-schema' | 'metrics' | 'feature-flags' | 'ci' | 'logs' | 'config' | 'static'

/** Execution transport used by a runtime provider. */
export type ContextRuntimeProviderTransport = 'static' | 'command' | 'http'

/** Runtime data provider declaration emitted under `.context/runtime/providers`. */
export interface ContextRuntimeProvider {
  name: string
  kind: ContextRuntimeProviderKind
  transport: ContextRuntimeProviderTransport
  title?: string
  description?: string
  value?: unknown
  path?: string
  mediaType?: string
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  cacheTtlMs?: number
  policy?: ContextProviderPolicy
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Evidence explaining why a generated runtime capability exists. */
export interface ContextRuntimeEvidence {
  nodeId?: string
  edgeId?: string
  sourceRefs?: SourceRef[]
  reason: string
  confidence: number
}

/** Project-specific tool declaration surfaced to agents. */
export interface ContextToolDefinition {
  name: string
  command?: string
  args?: string[]
  description: string
  argsSchema?: ContextJsonSchema
  inputSchema?: ContextJsonSchema
  cwd?: string
  timeoutMs?: number
  safety: 'read_only' | 'test_only' | 'local_write' | 'dangerous'
  outputParser?: string
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Project-specific skill or instruction pack surfaced to agents. */
export interface ContextSkillDefinition {
  id: string
  title: string
  content: string
  description?: string
  path?: string
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Generated integration file for a coding agent. */
export interface ContextAgentIntegration {
  id: 'codex' | 'claude' | 'cursor' | string
  title: string
  path: string
  content: string
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Project-level plugin or adapter declaration. */
export interface ContextPluginDefinition {
  id: string
  title: string
  version?: string
  description?: string
  components?: string[]
  evidence?: ContextRuntimeEvidence[]
  metadata?: Record<string, unknown>
}

/** Generated runtime config emitted under `.context/runtime`. */
export interface ContextRuntimeConfig {
  providers?: ContextRuntimeProvider[]
  tools?: ContextToolDefinition[]
  skills?: ContextSkillDefinition[]
  agents?: ContextAgentIntegration[]
  plugins?: ContextPluginDefinition[]
}

export type ContextRuntimeCapabilityKind =
  | 'provider'
  | 'mcp-tool'
  | 'project-tool'
  | 'skill'
  | 'agent-integration'
  | 'plugin'

export type ContextAgentInstallStatus = 'not-installed' | 'planned' | 'installed' | 'stale' | 'conflict'

/** Generated runtime capability plan emitted before serialization. */
export interface ContextRuntimeCapability {
  id: string
  kind: ContextRuntimeCapabilityKind
  title: string
  targetAgents: string[]
  agentSurfaces?: string[]
  entrypoints?: string[]
  freshness?: ContextRuntimeFreshness
  installStatus?: ContextAgentInstallStatus
  policy?: ContextProviderPolicy
  evidence: ContextRuntimeEvidence[]
  confidence: number
  metadata: Record<string, unknown>
}

export interface ContextJsonSchema {
  type?: string
  properties?: Record<string, ContextJsonSchema>
  required?: string[]
  additionalProperties?: boolean | ContextJsonSchema
  enum?: unknown[]
  description?: string
  items?: ContextJsonSchema
  [key: string]: unknown
}

export interface ContextRuntimeFreshness {
  status: 'fresh' | 'stale' | 'unknown'
  checkedAt?: string
  sourceFingerprintIds?: string[]
}

export interface ContextProviderPolicy {
  allowedAgents?: string[]
  requiresApproval?: boolean
  timeoutMs?: number
  cacheTtlMs?: number
  redactionLevel?: 'none' | 'standard' | 'strict'
  allowNetwork?: boolean
}

export interface ContextSourceFingerprint {
  id: string
  source: SourceRef
  algorithm: 'sha256'
  hash: string
  sizeBytes: number
  updatedAt?: string
}

export interface ContextRuntimeTraceEvent {
  schemaVersion: 'context-runtime-trace.v1'
  id: string
  event: 'compile'
  generatedAt: string
  pipeline: string
  components: string[]
  sourceFingerprints: ContextSourceFingerprint[]
  diagnostics: Diagnostic[]
  emittedArtifacts: string[]
  metadata: Record<string, unknown>
}

export type ContextAgentTarget = 'codex' | 'claude' | 'all'

export interface ContextAgentInstallFile {
  path: string
  agent: 'codex' | 'claude'
  mode: 'managed-block' | 'write-generated' | 'merge-json'
  marker?: string
  content: string
  status?: ContextAgentInstallStatus
  detected?: ContextAgentInstallDetection
  conflict?: ContextAgentInstallConflict
  metadata?: Record<string, unknown>
}

export interface ContextAgentInstallDetection {
  exists: boolean
  hasManagedBlock?: boolean
  contentMatches?: boolean
}

export interface ContextAgentInstallConflict {
  code: string
  message: string
}

export interface ContextAgentInstallPlan {
  schemaVersion: 'context-agent-install-plan.v1'
  generatedAt: string
  targetAgents: Array<'codex' | 'claude'>
  files: ContextAgentInstallFile[]
  metadata: Record<string, unknown>
}

/** Generated runtime plan emitted under `.context/runtime/runtime-plan.json`. */
export interface ContextRuntimePlan {
  schemaVersion: 'context-runtime-plan.v1'
  generatedAt: string
  providers: ContextRuntimeProvider[]
  mcpTools: ContextToolDefinition[]
  tools: ContextToolDefinition[]
  skills: ContextSkillDefinition[]
  agents: ContextAgentIntegration[]
  plugins: ContextPluginDefinition[]
  capabilities: ContextRuntimeCapability[]
  diagnostics: Diagnostic[]
}

/** Role, task, agent, or report-oriented context package. */
export interface ContextPack {
  id: string
  kind: 'context-view' | 'task-context' | 'agent-pack' | 'report'
  title: string
  content: string
  view?: string
  task?: string
  metadata: Record<string, unknown>
}

/** File, MCP-ready record, or generated report emitted by output components. */
export interface OutputArtifact {
  id: string
  kind: 'output'
  path?: string
  mediaType: string
  content?: string
  metadata: Record<string, unknown>
}

/** JSON index manifest emitted into `.context/indexes`. */
export interface ContextIndexManifest {
  schemaVersion: string
  files: {
    graph: string
    symbols: string
    apis: string
    docs: string
    tests: string
    runtime: string
    fts: string
    fingerprints: string
    scopes: string
  }
  counts: {
    graph: number
    symbols: number
    apis: number
    docs: number
    tests: number
    runtime: number
    fts: number
    fingerprints: number
    scopes: number
  }
}

/** Expanded `.context/manifest.json` runtime entrypoint. */
export interface ContextRuntimeManifest {
  schemaVersion: string
  version: string
  project: {
    name: string
    language: string
    root: string
  }
  compiledAt: string
  compiler: {
    name: string
    version: string
    pipeline: string
  }
  scale: Record<string, number>
  graph: {
    model: 'typed-property-graph'
    storage: 'jsonl+sqlite'
    nodes: string
    edges: string
    subgraphs: string
    scopes: string
    partitions: string
    revisions: string
    patches: string
    evidenceReports: string
  }
  indexes: {
    graph: string
    symbols: string
    apis: string
    docs: string
    tests: string
    runtime: string
    fts: string
    fingerprints: string
    scopes: string
  }
  plans: {
    planningPack: string
    planningCycles: string
    sourceTriage: string
    sourceGroups: string
    workspaceGraph: string
    scopeBuild: string
    adapterPlan: string
  }
  proposals: {
    rehome: string
    corrections: string
  }
  artifacts: {
    projectBrief: string
    domains: string
    tasks: string
    reports: string
  }
  sources: {
    inventory: string
    routes: string
    unsupported: string
    summary: string
    groups: string
    packages: string
    buildUnits: string
    groupingRequest: string
    groupingDecisions: string
    correctionDecisions: string
  }
  packs: Array<{ id: string; kind: ContextPack['kind']; view?: string; task?: string }>
  runtime: {
    providers: string
    mcp: string
    tools: string
    plan: string
    config: string
    trace: string
    runSummary: string
    agentInstallPlan: string
    freshness: ContextRuntimeFreshness
    installStatus: Record<'codex' | 'claude', ContextAgentInstallStatus>
    capabilitySurfaces: Record<string, string[]>
    skills: string[]
    agents: string[]
    plugins: string[]
  }
  agents: {
    claude: string
    codex: string
    cursor: string
  }
  diagnostics: {
    health: string
    latest: string
    report: string
  }
}

/** Runtime health report used by `context doctor`. */
export interface ContextRuntimeHealth {
  schemaVersion: string
  generatedAt: string
  status: 'healthy' | 'issues'
  counts: {
    nodes: number
    edges: number
    diagnostics: number
    views: number
    indexes: number
    providers: number
    tools: number
    skills: number
  }
  diagnosticsBySeverity: Record<DiagnosticSeverity, number>
  capabilityGaps?: Array<{ id: string; diagnosticType?: string; message: string; evidence: ContextRuntimeEvidence[] }>
}
