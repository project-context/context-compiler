import { defineContextProject } from '../config/index.js'
import { resolveOutputDir } from '../graph/index.js'
import { ComponentRegistry, PipelinePlanner, PipelineRunner, emptyPipelineState } from '../pipeline/index.js'
import type { CompileProjectOptions, CompileProjectResult, PipelineDefinition } from '../contracts/pipeline.js'

export const SOURCE_FIRST_ENGINE_PHASES = [
  'inventory',
  'triage',
  'agent-plan',
  'scope-build',
  'normalize-link-validate-govern',
  'materialize'
] as const

export type SourceFirstEnginePhase = (typeof SOURCE_FIRST_ENGINE_PHASES)[number]

/** Source-first Graph-of-Graphs compile engine. */
export class SourceFirstCompileEngine {
  async compile(options: CompileProjectOptions): Promise<CompileProjectResult> {
    const config = defineContextProject(options.config, { rootDir: options.rootDir })
    const outputDir = resolveOutputDir(config.workspace.rootDir, options.outputDir ?? config.outputDir ?? '.context')
    const pipeline = resolvePipeline(options.distribution, config, options.pipelineId ?? 'compile')
    const registry = new ComponentRegistry(options.distribution.components)
    const runner = new PipelineRunner(new PipelinePlanner(registry))
    options.onProgress?.({
      schemaVersion: 'context-progress-event.v1',
      type: 'compile.started',
      message: 'Compile started',
      timestamp: new Date().toISOString(),
      metadata: {
        pipelineId: options.pipelineId ?? 'compile',
        rootDir: config.workspace.rootDir,
        outputDir
      }
    })
    const result = await runner.run({
      definition: pipeline,
      context: {
        rootDir: config.workspace.rootDir,
        outputDir,
        config
      },
      onProgress: options.onProgress,
      initialState: {
        ...emptyPipelineState(),
        artifacts: {
          sourceFirstEngine: {
            schemaVersion: 'context-source-first-engine.v1',
            phases: SOURCE_FIRST_ENGINE_PHASES
          }
        },
        diagnostics: options.initialDiagnostics ?? []
      }
    })

    options.onProgress?.({
      schemaVersion: 'context-progress-event.v1',
      type: 'compile.completed',
      message: 'Compile completed',
      timestamp: new Date().toISOString(),
      metadata: {
        pipelineId: options.pipelineId ?? 'compile',
        nodes: result.state.graph.nodes.length,
        edges: result.state.graph.edges.length,
        diagnostics: result.diagnostics.length
      }
    })

    return {
      graph: result.state.graph,
      state: result.state,
      diagnostics: result.diagnostics,
      config
    }
  }
}

function resolvePipeline(
  distribution: CompileProjectOptions['distribution'],
  config: CompileProjectResult['config'],
  pipelineId: string
): PipelineDefinition {
  const pipeline = config.pipelines?.[pipelineId] ?? distribution.planPipeline?.(config, pipelineId) ?? distribution.pipelines[pipelineId]
  if (!pipeline) {
    throw new Error(`Pipeline not found: ${pipelineId}`)
  }
  return pipeline
}
