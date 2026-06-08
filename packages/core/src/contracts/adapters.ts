import type { ComponentStability, PipelineStage } from './pipeline.js'
import type { ContextProjectConfig, SourceRef } from './config.js'
import type { ContextRuntimeFreshness } from './runtime.js'
import type { ContextEdge, ContextGraph, ContextGraphAdapterRef, ContextGraphScope, ContextGraphScopeKind, ContextNode, Diagnostic } from './graph.js'
import type { ContextSourceGroupKind, ContextSourceInventory, ContextSourceInventoryEntry, ContextSourceRoute } from './sources.js'
export type AdapterRuntimeMode = 'dependency' | 'managed-runtime' | 'configured-runtime'
export type AdapterRuntimeEcosystem = 'node' | 'python' | 'custom'
export type AdapterRuntimeState = 'available' | 'installed' | 'missing' | 'install-failed' | 'not-required'

export interface AdapterRuntimeCommand {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface AdapterRuntimePythonRequirement {
  candidates?: string[]
  minVersion?: string
  maxVersionExclusive?: string
}

export interface AdapterRuntimeRequirement {
  mode: AdapterRuntimeMode
  ecosystem?: AdapterRuntimeEcosystem
  packageName?: string
  version?: string
  executable?: string
  runtimeDir?: string
  python?: AdapterRuntimePythonRequirement
  installCommands?: AdapterRuntimeCommand[]
  configuredEnvVar?: string
  metadata?: Record<string, unknown>
}

export interface AdapterRuntimeInstallPlan {
  schemaVersion: 'context-adapter-runtime-install-plan.v1'
  adapterId: string
  mode: 'managed-runtime'
  ecosystem: AdapterRuntimeEcosystem
  packageName?: string
  runtimeDir: string
  markerPath: string
  commands: AdapterRuntimeCommand[]
  metadata?: Record<string, unknown>
}

export interface AdapterRuntimeStatus {
  schemaVersion: 'context-adapter-runtime-status.v1'
  adapterId: string
  mode: AdapterRuntimeMode
  state: AdapterRuntimeState
  requirement: AdapterRuntimeRequirement
  packageName?: string
  runtimeDir?: string
  markerPath?: string
  installedAt?: string
  installPlan?: AdapterRuntimeInstallPlan
  diagnostics: Diagnostic[]
  metadata?: Record<string, unknown>
}

export type ContextProgressStream = 'stdout' | 'stderr'

export interface ContextProgressInfo {
  phaseId?: string
  phaseLabel?: string
  unitId?: string
  unitLabel?: string
  percent?: number
  current?: number
  total?: number
  indeterminate?: boolean
}

export interface ContextProgressEvent {
  schemaVersion: 'context-progress-event.v1'
  type: string
  message: string
  timestamp: string
  stage?: PipelineStage
  componentId?: string
  adapterId?: string
  command?: AdapterRuntimeCommand
  stream?: ContextProgressStream
  progress?: ContextProgressInfo
  metadata?: Record<string, unknown>
}

export type ContextProgressReporter = (event: ContextProgressEvent) => void

export interface GraphAdapterManifest {
  id: string
  title: string
  version: string
  scopeKinds: ContextGraphScopeKind[]
  sourceGroupKinds?: ContextSourceGroupKind[]
  inputs: string[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  stability: ComponentStability
  externalProjects?: string[]
  runtime?: AdapterRuntimeRequirement
  metadata?: Record<string, unknown>
}

export interface GraphBuildInput {
  scope: ContextGraphScope
  graph: ContextGraph
  scopeGraph?: ContextGraph
  sourceInventory?: ContextSourceInventory
  sourceEntries?: ContextSourceInventoryEntry[]
  rawArtifacts?: RawArtifact[]
  parsedArtifacts?: ParsedArtifact[]
  normalizedRecords?: NormalizedRecord[]
  config?: ContextProjectConfig
  rootDir?: string
  outputDir?: string
  artifactDir?: string
  adapterConfig?: Record<string, unknown>
  artifacts?: Record<string, unknown>
}

export interface GraphAdapterArtifact {
  id: string
  path: string
  mediaType: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface ContextGraphIndexHint {
  nodeId?: string
  edgeId?: string
  scopeId?: string
  index: string
  text?: string
  metadata?: Record<string, unknown>
}

export type GraphBuildNodePatch = Omit<ContextNode, 'type'> & { type: string }

export interface GraphBuildResult {
  nodes: GraphBuildNodePatch[]
  edges: ContextEdge[]
  diagnostics?: Diagnostic[]
  indexHints?: ContextGraphIndexHint[]
  artifacts?: GraphAdapterArtifact[]
  adapterRefs?: ContextGraphAdapterRef[]
}

export type ContextExtensionCategory = 'document' | 'knowledge' | 'code' | 'runtime' | 'source' | 'custom'
export type ContextExtensionAdapterKind = 'source-parser' | 'document-extractor' | 'graph-adapter'

export interface SourceParserAdapterManifest {
  id: string
  title: string
  version: string
  mediaTypes: string[]
  routes: ContextSourceRoute[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  stability: ComponentStability
  externalProjects?: string[]
  metadata?: Record<string, unknown>
}

export interface DocumentExtractorAdapterManifest {
  id: string
  title: string
  version: string
  mediaTypes: string[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  stability: ComponentStability
  externalProjects?: string[]
  runtime?: AdapterRuntimeRequirement
  metadata?: Record<string, unknown>
}

export type ContextExtensionAdapterManifest = SourceParserAdapterManifest | DocumentExtractorAdapterManifest | GraphAdapterManifest

export interface ContextExtensionAdapterBinding {
  kind: ContextExtensionAdapterKind
  manifest: ContextExtensionAdapterManifest
}

export interface ContextExtensionManifest {
  schemaVersion: 'context-extension.v1'
  id: string
  title: string
  version: string
  category: ContextExtensionCategory
  stability: ComponentStability
  adapters: ContextExtensionAdapterBinding[]
  externalProjects?: string[]
  metadata?: Record<string, unknown>
}

export interface SourceParserInput {
  entry: ContextSourceInventoryEntry
  bytes?: Uint8Array
  text?: string
  rootDir?: string
  outputDir?: string
  metadata?: Record<string, unknown>
}

export interface SourceParserResult {
  rawArtifacts?: RawArtifact[]
  parsedArtifacts?: ParsedArtifact[]
  diagnostics?: Diagnostic[]
  artifacts?: GraphAdapterArtifact[]
  metadata?: Record<string, unknown>
}

export interface DocumentExtractionInput {
  entry: ContextSourceInventoryEntry
  bytes?: Uint8Array
  text?: string
  scope?: ContextGraphScope
  rootDir?: string
  outputDir?: string
  metadata?: Record<string, unknown>
}

export interface DocumentExtractionResult {
  parsedArtifacts?: ParsedArtifact[]
  normalizedRecords?: NormalizedRecord[]
  diagnostics?: Diagnostic[]
  artifacts?: GraphAdapterArtifact[]
  metadata?: Record<string, unknown>
}

export interface SourceParserAdapter {
  manifest: SourceParserAdapterManifest
  parse(input: SourceParserInput): Promise<SourceParserResult>
}

export interface DocumentExtractorAdapter {
  manifest: DocumentExtractorAdapterManifest
  extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult>
}

export interface GraphAdapter {
  manifest: GraphAdapterManifest
  build(input: GraphBuildInput): Promise<GraphBuildResult>
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
