import { createHash } from 'node:crypto'
import type {
  ContextAuthority,
  ContextEdge,
  ContextEdgeStatus,
  GraphFactProvenance,
  ContextNode,
  ContextNodeStatus,
  ContextNodeType,
  Evidence,
  EvidenceType,
  SourceRef
} from '../contracts/index.js'

type SourceLike = SourceRef & { name?: string; type?: string }

export interface CreateContextNodeInput {
  id: string
  type: string
  name?: string
  title?: string
  content?: string
  scopeId?: string
  subgraphRef?: string
  parentScopeId?: string
  domain?: string
  module?: string
  sourceRefs?: SourceLike[]
  source?: SourceLike
  status?: ContextNodeStatus
  authority?: ContextAuthority
  confidence?: number
  tags?: string[]
  properties?: Record<string, unknown>
  metadata?: Record<string, unknown>
  provenance?: GraphFactProvenance[]
  createdAt?: string
  updatedAt?: string
  fingerprint?: string
}

export interface CreateContextEdgeInput {
  id?: string
  from: string
  to: string
  type: string
  scopeId?: string
  confidence?: number
  evidence?: Evidence[]
  linker?: string
  status?: ContextEdgeStatus
  properties?: Record<string, unknown>
  provenance?: GraphFactProvenance[]
  createdAt?: string
  updatedAt?: string
  fingerprint?: string
}

const TYPE_ALIASES: Record<string, ContextNodeType> = {
  source: 'Source',
  source_group: 'SourceGroup',
  source_snapshot: 'SourceSnapshot',
  document: 'Document',
  section: 'Section',
  requirement: 'Requirement',
  business_rule: 'BusinessRule',
  acceptance_criteria: 'AcceptanceCriteria',
  decision: 'Decision',
  risk: 'Risk',
  changelog: 'ChangeLog',
  change_log: 'ChangeLog',
  glossary_term: 'GlossaryTerm',
  procedure: 'Procedure',
  runbook_step: 'RunbookStep',
  ui_file: 'UIFile',
  ui_page: 'UIPage',
  page: 'UIPage',
  ui_frame: 'UIFrame',
  user_flow: 'UserFlow',
  ui_state: 'UIState',
  ui_component: 'UIComponent',
  interaction: 'Interaction',
  route: 'Route',
  repository: 'Repository',
  module: 'Module',
  package: 'Package',
  class: 'Class',
  interface: 'Interface',
  enum: 'Enum',
  method: 'Method',
  field: 'Field',
  annotation: 'Annotation',
  bean: 'Bean',
  config: 'Config',
  dependency: 'Dependency',
  controller_method: 'ControllerMethod',
  service_method: 'ServiceMethod',
  repository_method: 'RepositoryMethod',
  entity: 'Entity',
  dto: 'DTO',
  mapper: 'Mapper',
  scheduled_job: 'ScheduledJob',
  event_listener: 'EventListener',
  message_consumer: 'MessageConsumer',
  code_symbol: 'CodeSymbol',
  file: 'File',
  build_target: 'BuildTarget',
  entry_point: 'EntryPoint',
  api_contract: 'APIEndpoint',
  api_endpoint: 'APIEndpoint',
  request_dto: 'RequestDTO',
  response_dto: 'ResponseDTO',
  error_code: 'ErrorCode',
  external_api: 'ExternalAPI',
  message_topic: 'MessageTopic',
  event_contract: 'EventContract',
  auth_requirement: 'AuthRequirement',
  test_plan: 'TestPlan',
  test_case: 'TestCase',
  test_suite: 'TestSuite',
  test_method: 'TestMethod',
  fixture: 'Fixture',
  test_data: 'TestData',
  assertion: 'Assertion',
  ci_run: 'CIRun',
  ci_job: 'CIJob',
  environment: 'Environment',
  runtime_config: 'RuntimeConfig',
  config_item: 'ConfigItem',
  feature_flag: 'FeatureFlag',
  database: 'DatabaseSchema',
  database_schema: 'DatabaseSchema',
  database_table: 'DatabaseTable',
  runtime_signal: 'Metric',
  metric: 'Metric',
  log_pattern: 'LogPattern',
  trace_span: 'TraceSpan',
  deployment: 'Deployment',
  release: 'Release',
  incident: 'Incident',
  diagnostic: 'Diagnostic',
  conflict: 'Conflict',
  deprecation: 'Deprecation',
  manual_override: 'ManualOverride',
  context_policy: 'ContextPolicy',
  context_health: 'ContextHealth',
  project: 'Project',
  domain: 'Domain'
}

const CANONICAL_TYPES = new Set<ContextNodeType>([
  'Source',
  'SourceGroup',
  'SourceSnapshot',
  'Document',
  'Section',
  'Requirement',
  'BusinessRule',
  'AcceptanceCriteria',
  'Decision',
  'Risk',
  'ChangeLog',
  'GlossaryTerm',
  'Procedure',
  'RunbookStep',
  'UIFile',
  'UIPage',
  'UIFrame',
  'UserFlow',
  'UIState',
  'UIComponent',
  'Interaction',
  'Route',
  'Repository',
  'Module',
  'Package',
  'Class',
  'Interface',
  'Enum',
  'Method',
  'Field',
  'Annotation',
  'Bean',
  'Config',
  'Dependency',
  'ControllerMethod',
  'ServiceMethod',
  'RepositoryMethod',
  'Entity',
  'DTO',
  'Mapper',
  'ScheduledJob',
  'EventListener',
  'MessageConsumer',
  'CodeSymbol',
  'File',
  'BuildTarget',
  'EntryPoint',
  'APIEndpoint',
  'RequestDTO',
  'ResponseDTO',
  'ErrorCode',
  'ExternalAPI',
  'MessageTopic',
  'EventContract',
  'AuthRequirement',
  'TestPlan',
  'TestCase',
  'TestSuite',
  'TestMethod',
  'Fixture',
  'TestData',
  'Assertion',
  'CIRun',
  'CIJob',
  'Environment',
  'RuntimeConfig',
  'ConfigItem',
  'FeatureFlag',
  'DatabaseSchema',
  'DatabaseTable',
  'Metric',
  'LogPattern',
  'TraceSpan',
  'Deployment',
  'Release',
  'Incident',
  'Diagnostic',
  'Conflict',
  'Deprecation',
  'ManualOverride',
  'ContextPolicy',
  'ContextHealth',
  'Project',
  'Domain'
])

export function normalizeContextNodeType(value: string): ContextNodeType {
  if (CANONICAL_TYPES.has(value as ContextNodeType)) {
    return value as ContextNodeType
  }
  return TYPE_ALIASES[value.trim().toLowerCase()] ?? 'Requirement'
}

export function createContextNode(input: CreateContextNodeInput): ContextNode {
  const type = normalizeContextNodeType(input.type)
  const sourceRefs = normalizeSourceRefs(input.sourceRefs ?? (input.source ? [input.source] : []))
  const properties = {
    ...(input.metadata ?? {}),
    ...(input.properties ?? {})
  }
  if (input.content !== undefined && properties.content === undefined) {
    properties.content = input.content
  }
  if (properties.type === undefined && input.type !== type) {
    properties.type = input.type
  }
  const node: ContextNode = {
    id: input.id,
    type,
    name: input.name ?? input.title ?? input.id,
    scopeId: input.scopeId,
    subgraphRef: input.subgraphRef,
    parentScopeId: input.parentScopeId,
    domain: input.domain,
    module: input.module,
    sourceRefs,
    status: input.status ?? 'active',
    authority: input.authority ?? 'source_of_truth',
    confidence: input.confidence ?? 0.85,
    tags: input.tags ?? [],
    properties,
    provenance: input.provenance ?? [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    fingerprint: input.fingerprint ?? fingerprintValue({ id: input.id, type, name: input.name ?? input.title, scopeId: input.scopeId, sourceRefs, properties })
  }
  return node
}

export function createContextEdge(input: CreateContextEdgeInput): ContextEdge {
  const id = input.id ?? `EDGE-${input.from}-${input.type}-${input.to}`.replace(/[^A-Za-z0-9_.:-]+/g, '-')
  return {
    id,
    from: input.from,
    to: input.to,
    type: input.type,
    scopeId: input.scopeId,
    confidence: input.confidence ?? 0.85,
    evidence: input.evidence ?? [],
    linker: input.linker ?? 'unknown',
    status: input.status ?? 'inferred',
    properties: input.properties ?? {},
    provenance: input.provenance ?? [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    fingerprint: input.fingerprint ?? fingerprintValue({ id, from: input.from, to: input.to, type: input.type, evidence: input.evidence ?? [] })
  }
}

export function evidenceFromSource(type: EvidenceType, description: string, sourceRefs: SourceRef[]): Evidence {
  return {
    type,
    description,
    sourceRefs
  }
}

export function normalizeSourceRef(source: SourceLike): SourceRef {
  const sourceId = source.sourceId ?? source.name ?? source.type ?? slug(source.uri)
  return {
    sourceId,
    uri: source.uri,
    title: source.title ?? source.name,
    location: source.location
  }
}

export function normalizeSourceRefs(sourceRefs: SourceLike[]): SourceRef[] {
  return sourceRefs.map(normalizeSourceRef)
}

export function primarySourceRef(node: ContextNode): SourceRef | undefined {
  return node.sourceRefs[0]
}

export function nodeContent(node: ContextNode): string | undefined {
  const value = node.properties.content
  return typeof value === 'string' ? value : undefined
}

export function nodeStringProperty(node: ContextNode, key: string): string | undefined {
  const value = node.properties[key]
  return typeof value === 'string' ? value : undefined
}

export function nodeStringArrayProperty(node: ContextNode, key: string): string[] {
  const value = node.properties[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function sourceUri(node: ContextNode): string | undefined {
  return primarySourceRef(node)?.uri
}

export function fingerprintValue(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

export function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-|-$/g, '') || 'item'
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`
}
