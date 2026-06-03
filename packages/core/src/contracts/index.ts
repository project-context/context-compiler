/**
 * Stable pipeline stages supported by the compiler kernel.
 *
 * `resolve` is intentionally absent because resolution is a kernel concern:
 * the kernel loads config, validates components, and builds an execution plan
 * before any replaceable component runs.
 */
export const PIPELINE_STAGES = [
  'ingest',
  'parse',
  'normalize',
  'classify',
  'enrich',
  'link',
  'validate',
  'govern',
  'compress',
  'emit'
] as const

/** A replaceable compiler lifecycle stage. */
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

/** Public stability labels for components and distributions. */
export type ComponentStability = 'development' | 'alpha' | 'beta' | 'stable' | 'deprecated'

/** Component metadata used by the kernel for planning, validation, and docs. */
export interface ComponentManifest {
  id: string
  stage: PipelineStage
  version: string
  apiVersion: 'v1'
  stability: ComponentStability
  inputs: string[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  cacheable: boolean
}

/** A human work source declared by a workspace config. */
export interface SourceConfig {
  type: string
  name: string
  path: string
  parser?: string
  mediaType?: string
  [key: string]: unknown
}

/** Workspace metadata inferred by the config loader or compiler entrypoint. */
export interface WorkspaceMetadata {
  rootDir: string
  name: string
  configPath?: string
}

/** Semantic class of dynamic runtime data exposed to agents through MCP. */
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

/** User-authored config. It describes input boundaries, not project conclusions. */
export interface ContextConfigInput {
  sources?: SourceConfig[]
  components?: Record<string, unknown>
  pipelines?: Record<string, PipelineDefinition>
  policies?: Record<string, unknown>
  outputDir?: string
}

/** Normalized compiler configuration consumed by kernel pipelines. */
export interface ContextProjectConfig {
  workspace: WorkspaceMetadata
  sources: SourceConfig[]
  components?: Record<string, unknown>
  pipelines?: Record<string, PipelineDefinition>
  policies?: Record<string, unknown>
  outputDir?: string
}

/** A configured workspace pipeline. Values are component ids enabled per stage. */
export interface PipelineDefinition {
  id: string
  stages: Partial<Record<PipelineStage, string[]>>
}

/** Source location attached to source references and evidence. */
export interface SourceLocation {
  path?: string
  lineStart?: number
  lineEnd?: number
  section?: string
  page?: number
  nodeId?: string
}

/** Source provenance attached to every artifact, node, edge, and diagnostic. */
export interface SourceRef {
  sourceId: string
  uri: string
  title?: string
  location?: SourceLocation
}

/** Raw data collected by ingest components. */
export interface RawArtifact {
  id: string
  kind: 'raw'
  mediaType: string
  content: string
  source: SourceRef
  metadata?: Record<string, unknown>
}

/** Parsed source-specific structure emitted by parse components. */
export interface ParsedArtifact {
  id: string
  kind: 'parsed'
  parser: string
  source: SourceRef
  data: unknown
  metadata?: Record<string, unknown>
}

/** Unified intermediate record emitted by normalize components. */
export interface NormalizedRecord {
  id: string
  semanticType: string
  title: string
  content?: string
  domain?: string
  tags?: string[]
  source: SourceRef
  metadata?: Record<string, unknown>
}

/** Supported typed property graph node types. */
export type ContextNodeType =
  | 'Source'
  | 'SourceSnapshot'
  | 'Document'
  | 'Section'
  | 'Requirement'
  | 'BusinessRule'
  | 'AcceptanceCriteria'
  | 'Decision'
  | 'Risk'
  | 'ChangeLog'
  | 'GlossaryTerm'
  | 'Procedure'
  | 'RunbookStep'
  | 'UIFile'
  | 'UIPage'
  | 'UIFrame'
  | 'UserFlow'
  | 'UIState'
  | 'UIComponent'
  | 'Interaction'
  | 'Route'
  | 'Repository'
  | 'Module'
  | 'Package'
  | 'Class'
  | 'Interface'
  | 'Enum'
  | 'Method'
  | 'Field'
  | 'Annotation'
  | 'Bean'
  | 'Config'
  | 'Dependency'
  | 'ControllerMethod'
  | 'ServiceMethod'
  | 'RepositoryMethod'
  | 'Entity'
  | 'DTO'
  | 'Mapper'
  | 'ScheduledJob'
  | 'EventListener'
  | 'MessageConsumer'
  | 'CodeSymbol'
  | 'File'
  | 'BuildTarget'
  | 'EntryPoint'
  | 'APIEndpoint'
  | 'RequestDTO'
  | 'ResponseDTO'
  | 'ErrorCode'
  | 'ExternalAPI'
  | 'MessageTopic'
  | 'EventContract'
  | 'AuthRequirement'
  | 'TestPlan'
  | 'TestCase'
  | 'TestSuite'
  | 'TestMethod'
  | 'Fixture'
  | 'TestData'
  | 'Assertion'
  | 'CIRun'
  | 'CIJob'
  | 'Environment'
  | 'RuntimeConfig'
  | 'ConfigItem'
  | 'FeatureFlag'
  | 'DatabaseSchema'
  | 'DatabaseTable'
  | 'Metric'
  | 'LogPattern'
  | 'TraceSpan'
  | 'Deployment'
  | 'Release'
  | 'Incident'
  | 'Diagnostic'
  | 'Conflict'
  | 'Deprecation'
  | 'ManualOverride'
  | 'ContextPolicy'
  | 'ContextHealth'
  | 'Project'
  | 'Domain'

export type ContextNodeStatus = 'active' | 'draft' | 'deprecated' | 'conflicting' | 'unknown'

export type ContextAuthority = 'source_of_truth' | 'approved' | 'reference' | 'draft' | 'inferred'

export type ContextEdgeStatus = 'confirmed' | 'inferred' | 'rejected' | 'deprecated'

export type EvidenceType =
  | 'explicit_reference'
  | 'path_match'
  | 'name_match'
  | 'api_match'
  | 'test_match'
  | 'semantic_match'
  | 'manual'

export interface Evidence {
  type: EvidenceType
  description: string
  sourceRefs: SourceRef[]
}

/** A stable semantic fact represented as a graph node. */
export interface ContextNode {
  id: string
  type: ContextNodeType
  name: string
  domain?: string
  module?: string
  sourceRefs: SourceRef[]
  status: ContextNodeStatus
  authority: ContextAuthority
  confidence: number
  tags: string[]
  properties: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  fingerprint: string
}

/** A stable relationship between two context graph nodes. */
export interface ContextEdge {
  id: string
  from: string
  to: string
  type: string
  confidence: number
  evidence: Evidence[]
  linker: string
  status: ContextEdgeStatus
  properties: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  fingerprint: string
}

/** Diagnostic severity emitted by components or the kernel. */
export type DiagnosticSeverity = 'info' | 'warning' | 'error'

/** Context quality, planning, validation, or execution issue. */
export interface Diagnostic {
  id: string
  type: string
  severity: DiagnosticSeverity
  message: string
  relatedNodes: string[]
  evidence: Evidence[]
  suggestedAction?: string
  createdAt: string
  properties: Record<string, unknown>
}

/** The compiled project knowledge graph. */
export interface ContextGraph {
  nodes: ContextNode[]
  edges: ContextEdge[]
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
    partitions: string
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
  }
  artifacts: {
    projectBrief: string
    domains: string
    tasks: string
    reports: string
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
  capabilityGaps?: Array<{ id: string; message: string; evidence: ContextRuntimeEvidence[] }>
}

/** Mutable state exchanged between replaceable pipeline components. */
export interface PipelineState {
  rawArtifacts: RawArtifact[]
  parsedArtifacts: ParsedArtifact[]
  normalizedRecords: NormalizedRecord[]
  facts: ContextNode[]
  edges: ContextEdge[]
  graph: ContextGraph
  packs: ContextPack[]
  outputArtifacts: OutputArtifact[]
  diagnostics: Diagnostic[]
  artifacts: Record<string, unknown>
}

/** Shared execution context supplied to every component invocation. */
export interface PipelineExecutionContext {
  rootDir: string
  outputDir: string
  config: ContextProjectConfig
  pipelineId: string
  stage: PipelineStage
}

/** Partial state mutation returned by a component. */
export type ComponentResult = Partial<PipelineState>

/** A replaceable compiler component implementation. */
export interface ContextComponent {
  manifest: ComponentManifest
  setup?(context: PipelineExecutionContext): Promise<void> | void
  start?(context: PipelineExecutionContext): Promise<void> | void
  process(state: PipelineState, context: PipelineExecutionContext): Promise<ComponentResult> | ComponentResult
  flush?(context: PipelineExecutionContext): Promise<ComponentResult | void> | ComponentResult | void
  shutdown?(context: PipelineExecutionContext): Promise<void> | void
}

/** A bundle of default components and pipelines. */
export interface ContextDistribution {
  id: string
  version: string
  components: ContextComponent[]
  pipelines: Record<string, PipelineDefinition>
  planPipeline?(config: ContextProjectConfig, pipelineId: string): PipelineDefinition | undefined
}

/** Options for compiling a workspace through a configured distribution. */
export interface CompileProjectOptions {
  rootDir: string
  config: ContextProjectConfig | ContextConfigInput
  distribution: ContextDistribution
  pipelineId?: string
  outputDir?: string
  initialDiagnostics?: Diagnostic[]
}

/** Compile result returned by the public SDK. */
export interface CompileProjectResult {
  graph: ContextGraph
  state: PipelineState
  diagnostics: Diagnostic[]
  config: ContextProjectConfig
}
