# Missing Test Review

This example demonstrates diagnostics for a requirement that is linked to an API but has no test coverage.

Run from the repository root:

```bash
pnpm context --cwd examples/missing-test-review compile
pnpm context --cwd examples/missing-test-review validate
pnpm context --cwd examples/missing-test-review view review
```

## Source Layout

```txt
missing-test-review/
  context.config.json
  sources/
    product-docs/     Requirement document without linked test coverage
    api-spec/         OpenAPI contract referenced by the requirement
    source-code/      Local source file used by symbol indexing
  .context/           Generated graph, views, task context, and manifests
```
