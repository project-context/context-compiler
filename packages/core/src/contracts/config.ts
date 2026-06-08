import type { PipelineDefinition } from './pipeline.js'
export interface SourceConfig {
  type?: string
  name: string
  path: string
  parser?: string
  mediaType?: string
  include?: string[]
  exclude?: string[]
  maxFileBytes?: number
  includeDotfiles?: boolean
  [key: string]: unknown
}

/** Workspace metadata inferred by the config loader or compiler entrypoint. */
export interface WorkspaceMetadata {
  rootDir: string
  name: string
  configPath?: string
}

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
