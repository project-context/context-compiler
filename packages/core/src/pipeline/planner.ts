import { PIPELINE_STAGES, type ContextComponent, type PipelineDefinition, type PipelineStage } from '../contracts/pipeline.js'
import { ComponentRegistry } from './registry.js'

/** Executable plan produced by resolving a pipeline definition against a registry. */
export interface PipelinePlan {
  id: string
  stages: Array<{
    stage: PipelineStage
    components: ContextComponent[]
  }>
}

/** Turns configured component ids into an executable, stage-ordered plan. */
export class PipelinePlanner {
  constructor(private readonly registry: ComponentRegistry) {}

  /** Validate a pipeline definition and return executable components in kernel order. */
  plan(definition: PipelineDefinition): PipelinePlan {
    const plannedStages: PipelinePlan['stages'] = []

    for (const stage of PIPELINE_STAGES) {
      const componentIds = definition.stages[stage] ?? []
      const components = componentIds.map((id) => {
        const component = this.registry.get(id)
        if (!component) {
          throw new Error(`Pipeline "${definition.id}" references unknown component "${id}".`)
        }
        if (component.manifest.stage !== stage) {
          throw new Error(
            `Pipeline "${definition.id}" configured component "${id}" for stage "${stage}", but it belongs to stage "${component.manifest.stage}".`
          )
        }
        return component
      })

      if (components.length > 0) {
        plannedStages.push({ stage, components })
      }
    }

    return { id: definition.id, stages: plannedStages }
  }
}
