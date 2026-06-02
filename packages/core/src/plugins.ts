import type { ContextEdge, ContextGraph, ContextNode, Diagnostic } from './schemas.js'
import type { ContextProjectConfig, SourceConfig } from './config.js'

export interface CompilerContext {
  rootDir: string
  outputDir: string
  config?: ContextProjectConfig
}

export interface ParseResult {
  nodes: ContextNode[]
  edges?: ContextEdge[]
}

export interface ConnectorPlugin {
  name: string
  sourceTypes: string[]
  collect(source: SourceConfig, context: CompilerContext): Promise<SourceConfig[]>
}

export interface ParserPlugin {
  name: string
  sourceTypes: string[]
  parse(source: SourceConfig, context: CompilerContext): Promise<ParseResult>
}

export interface LinkerPlugin {
  name: string
  link(graph: ContextGraph, context: CompilerContext): Promise<ContextEdge[]>
}

export interface ValidatorPlugin {
  name: string
  validate(graph: ContextGraph, context: CompilerContext): Promise<Diagnostic[]>
}

export interface EmitterPlugin {
  name: string
  emit(graph: ContextGraph, context: CompilerContext): Promise<void>
}

export interface CompilerPlugin {
  name: string
  connectors?: ConnectorPlugin[]
  parsers?: ParserPlugin[]
  linkers?: LinkerPlugin[]
  validators?: ValidatorPlugin[]
  emitters?: EmitterPlugin[]
}

