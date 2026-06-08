import type { ContextConfigInput, ContextProjectConfig } from './config.js'
import type { ContextExtensionManifest, ContextProgressReporter, DocumentExtractorAdapter, GraphAdapter, NormalizedRecord, ParsedArtifact, RawArtifact, SourceParserAdapter } from './adapters.js'
import type { Diagnostic, ContextEdge, ContextGraph, ContextNode } from './graph.js'
import type { ContextPack, OutputArtifact } from './runtime.js'
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

export interface PipelineDefinition {
  id: string
  stages: Partial<Record<PipelineStage, string[]>>
}

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
  onProgress?: ContextProgressReporter
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
  sourceParsers?: SourceParserAdapter[]
  documentExtractors?: DocumentExtractorAdapter[]
  graphAdapters?: GraphAdapter[]
  extensions?: ContextExtensionManifest[]
  planPipeline?(config: ContextProjectConfig, pipelineId: string): PipelineDefinition | undefined
  metadata?: Record<string, unknown>
}

/** Options for compiling a workspace through a configured distribution. */
export interface CompileProjectOptions {
  rootDir: string
  config: ContextProjectConfig | ContextConfigInput
  distribution: ContextDistribution
  pipelineId?: string
  outputDir?: string
  initialDiagnostics?: Diagnostic[]
  onProgress?: ContextProgressReporter
}

/** Compile result returned by the public SDK. */
export interface CompileProjectResult {
  graph: ContextGraph
  state: PipelineState
  diagnostics: Diagnostic[]
  config: ContextProjectConfig
}
