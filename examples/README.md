# Examples

This folder contains runnable project scenarios for Context Compiler.

Each scenario keeps input data under a dedicated `sources/` parent folder:

```txt
examples/<scenario>/
  context.config.json
  README.md
  sources/
    product-docs/
    test-cases/
    api-spec/
    source-code/
  .context/
```

The config file declares source boundaries only. The workspace is the directory containing `context.config.json`, and `.context/` is generated from the existing source content.

## Local Shop

`examples/local-shop` is the happy-path local MVP demo:

```bash
pnpm context --cwd examples/local-shop compile
pnpm context --cwd examples/local-shop view implementation
pnpm context --cwd examples/local-shop query refund
pnpm context --cwd examples/local-shop explain REQ-ORDER-REFUND-001
pnpm context --cwd examples/local-shop task 支持订单部分退款 --focus implementation --module refund
```

Or run the bundled script:

```bash
pnpm demo:local-shop
```

## Missing Test Review

`examples/missing-test-review` shows diagnostics for a requirement that has acceptance criteria and an API but no linked test case:

```bash
pnpm context --cwd examples/missing-test-review compile
pnpm context --cwd examples/missing-test-review validate
pnpm context --cwd examples/missing-test-review view review
```
