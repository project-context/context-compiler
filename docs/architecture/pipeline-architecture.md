# Pipeline Architecture

Context Compiler is organized as a stable compiler kernel plus replaceable pipeline components. The kernel owns orchestration, schema contracts, execution state, diagnostics, and artifact persistence. It does not know how to parse Markdown, call Figma, classify requirements, link APIs to services, or emit agent packs.

All major architecture work should align with the [Super Data Network goal](./super-data-network-goal.md): a package-first, evidence-traceable network where humans and agents start outside-in from materials, drill through L0/L1/L2/L3, use the Meta Layer for evidence, correction, revision, confidence, and permissions, and keep project context converging.

The compiled output is a project-level `.context/` runtime workspace, not only a directory of Markdown files. A runtime workspace can contain static context artifacts, a project graph, JSON indexes, runtime providers, MCP tool metadata, project tool declarations, project skills, generated agent instructions, diagnostics, and cacheable runtime data.

The runtime workspace is compiler-generated. Users provide project materials and source boundaries; Context Compiler infers which MCP tools, project tools, skills, plugins, providers, and agent integrations are useful for that project.

## Mental Model

```txt
Components = reusable capabilities contributed by the ecosystem
Pipelines  = project-specific execution plans that enable selected components
Kernel     = stable runtime that validates, orders, executes, and observes components
```

This distinction is the core of the architecture. A project may have dozens of available ingest components and many parse, link, validate, govern, compress, and emit components, but each pipeline loads only what the project or scenario needs.

## Stage Order

```txt
Resolve
  -> Ingest
  -> Parse
  -> Normalize
  -> Classify
  -> Enrich
  -> Link
  -> Validate
  -> Govern
  -> Compress
  -> Emit
```

`Resolve` is a kernel-only stage. It loads config, resolves distributions, validates component ids, checks stage ownership, and builds an executable plan.

All other stages are replaceable:

- `Ingest`: collect raw human/project materials into reproducible raw artifacts.
- `Parse`: parse raw artifacts into source-specific structured data.
- `Normalize`: convert source-specific data into unified intermediate records.
- `Classify`: assign software-engineering meaning to records.
- `Enrich`: add project inventory, symbol indexes, external indexes, or adapter output.
- `Link`: build graph edges through rules, graph engines, RAG, or custom logic.
- `Validate`: emit context quality diagnostics.
- `Govern`: redact, filter, authorize, and enforce source or policy constraints.
- `Compress`: build inferred view, task, agent, or report context packs.
- `Emit`: write files, reports, MCP-ready data, project runtime metadata, generated agent instructions, or agent-specific artifacts.

## Artifact Flow

Components communicate through `PipelineState` instead of private implementation objects:

```txt
SourceConfig
  -> RawArtifact
  -> ParsedArtifact
  -> NormalizedRecord
  -> ContextNode / ContextEdge / Diagnostic
  -> ContextGraph
  -> ContextPack
  -> OutputArtifact
```

This makes each stage independently replaceable. For example, `link.default-rules` can be replaced by a Neo4j adapter, GraphRAG adapter, CodeQL adapter, Sourcegraph adapter, or enterprise-specific linker as long as it returns standard edges and diagnostics.

## Component Manifest

Every component declares stable metadata:

```ts
interface ComponentManifest {
  id: string
  stage: PipelineStage
  version: string
  apiVersion: 'v1'
  stability: 'development' | 'alpha' | 'beta' | 'stable' | 'deprecated'
  inputs: string[]
  outputs: string[]
  deterministic: boolean
  requiresNetwork: boolean
  cacheable: boolean
}
```

The kernel uses this metadata for planning, validation, documentation, caching, and future compatibility checks.

## Current Local Distribution

`@context-compiler/distribution-local` registers the local MVP components and uses a source-aware auto planner as the default `compile` pipeline. For a project with Markdown, OpenAPI, and code sources it produces:

```txt
ingest.local-files
  -> parse.markdown / parse.openapi
  -> normalize.markdown-doc / normalize.openapi-contract
  -> classify.context-facts
  -> enrich.inventory / enrich.symbol-index
  -> link.default-rules
  -> validate.default-rules
  -> govern.redaction
  -> compress.context-view / compress.task-context / compress.runtime-plan
  -> emit.files
```

Official components have no kernel privilege. They are ordinary components bundled into the local distribution.

The static local pipeline is kept as a manual fallback, but normal user config should only declare source boundaries. The compiler chooses parse, normalize, and enrichment components from those source types, then runs the shared graph, runtime-plan, and file emission stages.

`compress.runtime-plan` infers the generated runtime layer from graph facts, context packs, indexes, inventory, and diagnostics. The default file emitter then serializes that plan into `.context/context-manifest.json`, generated indexes, MCP tool metadata and resources, project tool declarations, project skills, generated Codex/Claude/Cursor instructions, optional runtime provider declarations, `runtime/runtime-plan.json`, `runtime/agent-install-plan.json`, append-only runtime trace/run summary files, and `diagnostics/context-health.json`.
