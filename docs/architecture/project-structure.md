# Project Structure

Context Compiler uses a pnpm monorepo organized around the compiler kernel and replaceable pipeline components.

## Workspace Packages

- `packages/core`: stable public contracts, kernel runtime, pipeline planning, graph utilities, diagnostics, context rendering, config loading, and the compile SDK.
- `packages/cli`: the `context` command. It loads config and distributions, then calls core APIs.
- `packages/distributions/local`: the default local MVP distribution. It bundles official components, a source-aware pipeline auto planner, and manual fallback pipelines.
- `packages/mcp/server`: project-level MCP-compatible server and direct tool runtime for querying compiled `.context` workspaces.
- `packages/components/<stage>/<name>`: independently replaceable component packages.

## Component Layout

```txt
packages/components/
  ingest/local-files/
  parse/markdown/
  parse/openapi/
  normalize/markdown-doc/
  normalize/openapi-contract/
  classify/context-facts/
  enrich/inventory/
  enrich/symbol-index/
  link/default-rules/
  validate/default-rules/
  govern/redaction/
  compress/context-view/
  compress/task-context/
  emit/files/
```

Each component package exposes one factory from `src/index.ts`. The package root must not accumulate unrelated behavior.

## Core Layout

```txt
packages/core/src/
  contracts/
  pipeline/
  compiler/
  config/
  graph/
  diagnostics/
  context/
  runtime/
```

`contracts` is the public SDK boundary. Components may import public contracts and helpers from `@context-compiler/core`, but they should not reach into private implementation files.

## Rule Of Thumb

If code describes how to execute a pipeline, it belongs in `core`. If code understands a specific source, analyzer, linking strategy, governance rule, or output target, it belongs in a component.
