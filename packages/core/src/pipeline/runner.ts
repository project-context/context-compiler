import { resolve } from 'node:path'
import type {
  ContextProjectConfig,
  PipelineDefinition,
  PipelineExecutionContext,
  PipelineState
} from '../contracts/index.js'
import { createDiagnostic } from '../diagnostics/index.js'
import { PipelinePlanner } from './planner.js'
import { emptyPipelineState, graphFromState, mergePipelineState } from './state.js'

/** Input accepted by the kernel pipeline runner. */
export interface RunPipelineOptions {
  definition: PipelineDefinition
  context: {
    rootDir: string
    outputDir: string
    config: ContextProjectConfig
  }
  initialState?: PipelineState
}

/** Result returned after every enabled component has run. */
export interface RunPipelineResult {
  state: PipelineState
  diagnostics: PipelineState['diagnostics']
}

/** Executes planned components, handles lifecycle hooks, and aggregates diagnostics. */
export class PipelineRunner {
  constructor(private readonly planner: PipelinePlanner) {}

  /** Run a pipeline definition through all configured components in stable stage order. */
  async run(options: RunPipelineOptions): Promise<RunPipelineResult> {
    const plan = this.planner.plan(options.definition)
    let state = options.initialState ?? emptyPipelineState()

    for (const plannedStage of plan.stages) {
      state.graph = graphFromState(state)

      for (const component of plannedStage.components) {
        const context: PipelineExecutionContext = {
          rootDir: options.context.rootDir,
          outputDir: resolve(options.context.rootDir, options.context.outputDir),
          config: options.context.config,
          pipelineId: plan.id,
          stage: plannedStage.stage
        }

        try {
          await component.setup?.(context)
          await component.start?.(context)
          const result = await component.process(state, context)
          state = mergePipelineState(state, result)
          const flushed = await component.flush?.(context)
          if (flushed) {
            state = mergePipelineState(state, flushed)
          }
        } catch (error) {
          state = mergePipelineState(state, {
            diagnostics: [
              createDiagnostic({
                severity: 'error',
                code: 'component.failed',
                message: `Component "${component.manifest.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
                trace: [component.manifest.id, plannedStage.stage],
                metadata: {
                  componentId: component.manifest.id,
                  stage: plannedStage.stage
                }
              })
            ]
          })
        } finally {
          await component.shutdown?.(context)
        }
      }
    }

    state.graph = graphFromState(state)
    return { state, diagnostics: state.diagnostics }
  }
}
