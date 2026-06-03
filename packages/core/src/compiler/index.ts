import { ComponentRegistry, PipelinePlanner, PipelineRunner, emptyPipelineState } from '../pipeline/index.js'
import { defineContextProject } from '../config/index.js'
import { resolveOutputDir } from '../graph/index.js'
import type { CompileProjectOptions, CompileProjectResult, PipelineDefinition } from '../contracts/index.js'

/** Compile a workspace through a configured distribution and pipeline. */
export async function compileContextProject(options: CompileProjectOptions): Promise<CompileProjectResult> {
  const config = defineContextProject(options.config, { rootDir: options.rootDir })
  const outputDir = resolveOutputDir(config.workspace.rootDir, options.outputDir ?? config.outputDir ?? '.context')
  const pipeline = resolvePipeline(options.distribution, config, options.pipelineId ?? 'compile')
  const registry = new ComponentRegistry(options.distribution.components)
  const runner = new PipelineRunner(new PipelinePlanner(registry))
  const result = await runner.run({
    definition: pipeline,
    context: {
      rootDir: config.workspace.rootDir,
      outputDir,
      config
    },
    initialState: {
      ...emptyPipelineState(),
      diagnostics: options.initialDiagnostics ?? []
    }
  })

  return {
    graph: result.state.graph,
    state: result.state,
    diagnostics: result.diagnostics,
    config
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
