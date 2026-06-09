import type { ContextComponent, PipelineStage } from '../contracts/pipeline.js'

/** Registry of available components keyed by stable component id. */
export class ComponentRegistry {
  private readonly components: Map<string, ContextComponent>

  constructor(components: ContextComponent[] = []) {
    this.components = new Map()
    for (const component of components) {
      this.register(component)
    }
  }

  /** Register a component and reject duplicate ids early. */
  register(component: ContextComponent): void {
    if (this.components.has(component.manifest.id)) {
      throw new Error(`Duplicate component id: ${component.manifest.id}`)
    }
    this.components.set(component.manifest.id, component)
  }

  /** Look up a component by id. */
  get(id: string): ContextComponent | undefined {
    return this.components.get(id)
  }

  /** List all registered components. */
  list(): ContextComponent[] {
    return [...this.components.values()]
  }

  /** List registered components for a single pipeline stage. */
  byStage(stage: PipelineStage): ContextComponent[] {
    return this.list().filter((component) => component.manifest.stage === stage)
  }
}

/** Define a component while preserving the public component type. */
export function defineComponent(component: ContextComponent): ContextComponent {
  return component
}
