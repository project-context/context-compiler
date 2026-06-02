import { ContextEdgeSchema, ContextGraphSchema, ContextNodeSchema } from './schemas.js'
import type { ContextEdge, ContextGraph, ContextNode, Diagnostic } from './schemas.js'
import type { ContextProjectConfig } from './config.js'
import type { CompilerContext, EmitterPlugin, LinkerPlugin, ParserPlugin, ValidatorPlugin } from './plugins.js'
import { createDefaultLinker } from './linker.js'
import { createDefaultValidator } from './validator.js'
import { dedupeEdges, dedupeNodes, resolveOutputDir } from './graph.js'

export interface CompileOptions {
  rootDir: string
  outputDir?: string
  parsers: ParserPlugin[]
  linkers?: LinkerPlugin[]
  validators?: ValidatorPlugin[]
  emitters?: EmitterPlugin[]
}

export interface CompileResult {
  graph: ContextGraph
}

export async function compileContextProject(
  config: ContextProjectConfig,
  options: CompileOptions
): Promise<CompileResult> {
  const outputDir = resolveOutputDir(options.rootDir, options.outputDir)
  const context: CompilerContext = {
    rootDir: options.rootDir,
    outputDir,
    config
  }
  const nodes: ContextNode[] = []
  const edges: ContextEdge[] = []

  for (const source of config.sources) {
    const parser = options.parsers.find((candidate) => candidate.sourceTypes.includes(source.type))
    if (!parser) {
      throw new Error(`No parser registered for source type: ${source.type}`)
    }

    const result = await parser.parse(source, context)
    nodes.push(...result.nodes.map((node) => ContextNodeSchema.parse(node)))
    edges.push(...(result.edges ?? []).map((edge) => ContextEdgeSchema.parse(edge)))
  }

  let graph = ContextGraphSchema.parse({
    nodes: dedupeNodes(nodes),
    edges: dedupeEdges(edges),
    diagnostics: []
  })

  for (const linker of options.linkers ?? [createDefaultLinker()]) {
    const linkedEdges = await linker.link(graph, context)
    graph = {
      ...graph,
      edges: dedupeEdges([...graph.edges, ...linkedEdges.map((edge) => ContextEdgeSchema.parse(edge))])
    }
  }

  const diagnostics: Diagnostic[] = []
  for (const validator of options.validators ?? [createDefaultValidator()]) {
    diagnostics.push(...(await validator.validate(graph, context)))
  }
  graph = ContextGraphSchema.parse({ ...graph, diagnostics })

  for (const emitter of options.emitters ?? []) {
    await emitter.emit(graph, context)
  }

  return { graph }
}
