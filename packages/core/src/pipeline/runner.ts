import { resolve } from 'node:path'
import type { ContextProjectConfig } from '../contracts/config.js'
import type { ContextProgressEvent, ContextProgressReporter } from '../contracts/adapters.js'
import type { PipelineDefinition, PipelineExecutionContext, PipelineState } from '../contracts/pipeline.js'
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
  onProgress?: ContextProgressReporter
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
      emitProgress(options.onProgress, {
        type: 'stage.started',
        message: `Stage ${plannedStage.stage} started`,
        stage: plannedStage.stage,
        metadata: {
          pipelineId: plan.id,
          components: plannedStage.components.map((component) => component.manifest.id)
        }
      })

      for (const component of plannedStage.components) {
        const context: PipelineExecutionContext = {
          rootDir: options.context.rootDir,
          outputDir: resolve(options.context.rootDir, options.context.outputDir),
          config: options.context.config,
          pipelineId: plan.id,
          stage: plannedStage.stage,
          onProgress: options.onProgress
        }

        try {
          emitProgress(options.onProgress, {
            type: 'component.started',
            message: `Component ${component.manifest.id} started`,
            stage: plannedStage.stage,
            componentId: component.manifest.id,
            metadata: { pipelineId: plan.id }
          })
          await component.setup?.(context)
          await component.start?.(context)
          const result = await component.process(state, context)
          state = mergePipelineState(state, result)
          const flushed = await component.flush?.(context)
          if (flushed) {
            state = mergePipelineState(state, flushed)
          }
          emitProgress(options.onProgress, {
            type: 'component.completed',
            message: `Component ${component.manifest.id} completed`,
            stage: plannedStage.stage,
            componentId: component.manifest.id,
            metadata: {
              pipelineId: plan.id,
              rawArtifacts: state.rawArtifacts.length,
              parsedArtifacts: state.parsedArtifacts.length,
              facts: state.facts.length,
              edges: state.edges.length,
              diagnostics: state.diagnostics.length
            }
          })
        } catch (error) {
          if (error instanceof Error && error.name === 'ContextCompileBlockingError') {
            throw error
          }
          emitProgress(options.onProgress, {
            type: 'component.failed',
            message: `Component ${component.manifest.id} failed: ${error instanceof Error ? error.message : String(error)}`,
            stage: plannedStage.stage,
            componentId: component.manifest.id,
            metadata: { pipelineId: plan.id }
          })
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

      emitProgress(options.onProgress, {
        type: 'stage.completed',
        message: `Stage ${plannedStage.stage} completed`,
        stage: plannedStage.stage,
        metadata: {
          pipelineId: plan.id,
          rawArtifacts: state.rawArtifacts.length,
          parsedArtifacts: state.parsedArtifacts.length,
          facts: state.facts.length,
          edges: state.edges.length,
          diagnostics: state.diagnostics.length
        }
      })
    }

    state.graph = graphFromState(state)
    return { state, diagnostics: state.diagnostics }
  }
}

function emitProgress(reporter: ContextProgressReporter | undefined, event: Omit<ContextProgressEvent, 'schemaVersion' | 'timestamp'>): void {
  reporter?.({
    schemaVersion: 'context-progress-event.v1',
    timestamp: new Date().toISOString(),
    ...event
  })
}
