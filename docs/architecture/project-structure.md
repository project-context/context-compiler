# Project Structure

Context Compiler uses a pnpm monorepo organized around explicit core boundaries, replaceable built-in components, extension adapters, CLI/MCP entrypoints, and the generated `.context` runtime workspace.

## Workspace Packages

- `packages/core`: stable contracts and internal public subpaths for SDK, kernel, graph, source model, runtime, and compiler APIs.
- `packages/cli`: the `context` command. It loads config and the local distribution, then calls core APIs.
- `packages/builtin/local`: the default local distribution package. It bundles official built-in components, a source-aware pipeline auto planner, and manual fallback pipelines.
- `packages/builtin/<component>`: official replaceable component packages, one focused capability per package.
- `packages/extensions/<domain>/<adapter>`: optional parser, graph, or runtime adapters selected by source/modeling plans.
- `packages/mcp/server`: project-level MCP-compatible server and direct tool runtime for querying compiled `.context` workspaces.
- `packages/viewer`: local graph/runtime viewer UI.
- `packages/distributions`: reserved for future distribution wrappers; the current local implementation lives in `packages/builtin/local`.

## Component Layout

```txt
packages/builtin/
  ingest-local-files/
  parse-markdown/
  parse-openapi/
  normalize-markdown-doc/
  normalize-openapi-contract/
  classify-context-facts/
  enrich-inventory/
  enrich-symbol-index/
  enrich-scope-adapters/
  link-default-rules/
  validate-default-rules/
  govern-redaction/
  compress-context-view/
  compress-task-context/
  compress-runtime-plan/
  emit-files/
  local/

packages/extensions/
  code/graph-codegraph/
  document/parser-docling/
  document/parser-unstructured/
  knowledge/graph-microsoft-graphrag/
```

Each component package exposes one factory or adapter binding from `src/index.ts`. The package root must not accumulate unrelated behavior.

## Core Layout

```txt
packages/core/src/
  contracts/
  sdk/
  kernel/
  graph/
  source-model/
  runtime/
  compiler/
  config/
  diagnostics/
  pipeline/
  planning/
  engine/
  context/
```

`contracts` is split by domain and re-exported through explicit subpath APIs. Internal packages should not import from the root `@context-compiler/core` path. Use:

- `@context-compiler/core/sdk` for component factories, contracts, diagnostics, extension helpers, and basic graph model helpers.
- `@context-compiler/core/kernel` for pipeline planning/running/state and graph revision/patch planning.
- `@context-compiler/core/graph` for graph model, scopes, adapter normalization, graph file IO, and output-dir helpers.
- `@context-compiler/core/source-model` for source inventory, L0 package, L1 source group, grouping/correction/build-unit helpers, and source-first plans.
- `@context-compiler/core/runtime` for `.context` workspace generation, indexes, query-facing APIs, corrections, graph fact history, and runtime writer APIs.
- `@context-compiler/core/compiler` for `compileContextProject` and the source-first compile engine.

## Rule Of Thumb

If code describes how to execute a pipeline, it belongs in `core/kernel`. If code builds or reads `.context`, it belongs in `core/runtime` or `core/graph`. If code models source boundaries, packages, groups, corrections, or source-first build units, it belongs in `core/source-model`. If code understands a specific source system, parser, analyzer, linking strategy, governance rule, or output target, it belongs in a component or extension adapter.
