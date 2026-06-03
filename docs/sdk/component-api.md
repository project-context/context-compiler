# Component API

Components are the extension units of Context Compiler. A contributor can implement one component for one stage without understanding every other part of the system.

## Minimal Component

```ts
import { defineComponent } from '@context-compiler/core'

export function createMyLinker() {
  return defineComponent({
    manifest: {
      id: 'link.my-linker',
      stage: 'link',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph'],
      outputs: ['context-edge'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state, context) {
      return {
        edges: [
          {
            id: 'EDGE-example',
            from: 'REQ-1',
            to: 'API-1',
            type: 'relates_to',
            metadata: {}
          }
        ]
      }
    }
  })
}
```

## Lifecycle

The kernel supports:

```txt
setup -> start -> process -> flush -> shutdown
```

Most components only need `process`. Use lifecycle hooks for external connections, caches, telemetry, and cleanup.

## Execution Context

Every component receives a normalized execution context:

```ts
interface PipelineExecutionContext {
  rootDir: string
  outputDir: string
  config: ContextProjectConfig
  pipelineId: string
  stage: PipelineStage
}
```

`config.workspace` is inferred by the kernel. The user config does not declare `project`, `roles`, or `profiles`; components should read workspace identity from `config.workspace` and infer behavior from graph content.

## Stage Responsibilities

- Ingest components return `RawArtifact[]`.
- Parse components return `ParsedArtifact[]`.
- Normalize components return `NormalizedRecord[]`.
- Classify components return `ContextNode[]` facts.
- Enrich components return facts, indexes, or artifacts.
- Link components return `ContextEdge[]`.
- Validate components return `Diagnostic[]`.
- Govern components return filtered/redacted graph or facts.
- Compress components return `ContextPack[]`.
- Emit components return `OutputArtifact[]`.

## Design Rules

- Do not mutate files outside the configured output directory unless the component is explicitly an emitter.
- Do not depend on another component's private data shape.
- Put source provenance on every artifact, node, edge, and diagnostic.
- Prefer deterministic ids so graph output can be diffed between runs.
- If a component calls a remote system, set `requiresNetwork: true`.
- If a component can be safely cached by input hash, set `cacheable: true`.
