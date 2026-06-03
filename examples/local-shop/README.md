# Local Shop

This example demonstrates a complete local pipeline:

```txt
Markdown PRD + Markdown tests + OpenAPI + TypeScript source
  -> local distribution compile pipeline
  -> .context graph, indexes, runtime plan, inferred agent rules, MCP tools, views, and task context
```

Run from the repository root:

```bash
pnpm context --cwd examples/local-shop compile
pnpm context --cwd examples/local-shop view implementation
pnpm context --cwd examples/local-shop query refund
pnpm context --cwd examples/local-shop explain REQ-ORDER-REFUND-001
pnpm context --cwd examples/local-shop task 支持订单部分退款 --focus implementation --module refund
pnpm context --cwd examples/local-shop doctor
```

## Source Layout

```txt
local-shop/
  context.config.json
  sources/
    product-docs/     Markdown PRD and requirement documents
    test-cases/       Markdown test-case documents
    api-spec/         OpenAPI contract files
    source-code/      Local source files used by symbol indexing
  .context/           Generated context runtime workspace
```

After `compile`, `.context/` includes JSON graph files, Markdown views, JSON indexes,
a generated runtime plan with evidence, inferred project tool and skill declarations,
generated agent instructions, MCP tool metadata, and a context health report. Runtime
providers are emitted only when the project has known dynamic runtime sources.
