# Pipeline Examples

Pipelines choose components for one project or one scenario. Normal users do not write these in `context.config.json`; the local distribution now plans the default compile pipeline from declared source types. These examples describe generated or advanced internal plans.

## Local Repository Auto Plan

```txt
sources: markdown + openapi + code
  -> ingest.local-files
  -> parse.markdown + parse.openapi
  -> normalize.markdown-doc + normalize.openapi-contract
  -> classify.context-facts
  -> enrich.inventory + enrich.symbol-index
  -> link.default-rules
  -> validate.default-rules
  -> govern.redaction
  -> compress.context-view + compress.task-context + compress.runtime-plan
  -> emit.files
```

## Enterprise Project

```txt
ingest.feishu + ingest.jira + ingest.figma + ingest.gitlab
  -> parse.markdown + parse.figma + parse.issue + parse.openapi
  -> normalize.*
  -> classify.enterprise-llm
  -> enrich.symbol-index + enrich.sourcegraph
  -> link.neo4j-adapter
  -> validate.enterprise-rules
  -> govern.policy-access + govern.pii-redaction
  -> compress.context-view + compress.task-context + compress.runtime-plan
  -> emit.mcp + emit.html-report
```

## PR Review

```txt
ingest.git-diff
  -> parse.diff
  -> enrich.affected-symbols
  -> link.change-impact
  -> validate.review-rules
  -> govern.external-agent-filter
  -> compress.reviewer-context
  -> emit.codex + emit.ci-report
```

## MCP Runtime

```txt
ingest.context-cache
  -> enrich.vector-index
  -> govern.policy-access
  -> compress.query-result + compress.runtime-plan
  -> emit.mcp
```
