# Component API

Components are the extension units of Context Compiler. A contributor can implement one component for one stage without understanding every other part of the system.

Components should import through explicit core subpaths:

- `@context-compiler/core/sdk` for component factories, contracts, diagnostics, extension helpers, and basic graph helpers.
- `@context-compiler/core/graph` for graph scopes, adapter normalization, and graph file IO.
- `@context-compiler/core/source-model` for source inventory, L0 package, L1 source group, correction, and source-first build-unit helpers.
- `@context-compiler/core/runtime` for `.context` workspace and query-facing runtime APIs.
- `@context-compiler/core/kernel` for pipeline/patch kernel behavior.
- `@context-compiler/core/compiler` for compile entrypoints.

## Minimal Component

```ts
import { defineComponent } from '@context-compiler/core/sdk'

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

### Source-First Ingest

An ingest component may seed source inventory and source graph records, but it should not own reusable source modeling rules.

The built-in `ingest.local-files` component owns local filesystem traversal, route matching, and raw artifact reading. It delegates L0 package modeling, L1 source group records, grouping decisions, correction application, package/build-unit mapping, and source-first plans to `@context-compiler/core/source-model`.

## Design Rules

- Do not mutate files outside the configured output directory unless the component is explicitly an emitter.
- Do not depend on another component's private data shape.
- Put source provenance on every artifact, node, edge, and diagnostic.
- Prefer deterministic ids so graph output can be diffed between runs.
- If a component calls a remote system, set `requiresNetwork: true`.
- If a component can be safely cached by input hash, set `cacheable: true`.
