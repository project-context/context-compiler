# Context Compiler

> Generate a project-level context runtime workspace for AI coding agents.

**Context Compiler** is an experimental Context Engineering project for AI-assisted software development.

It turns product documents, design specs, source code, API definitions, test cases, historical bugs, meeting notes, and runtime knowledge into a `.context/` workspace containing context artifacts, a project graph, JSON indexes, runtime providers, MCP tools, project skills, diagnostics, and agent integrations.

Users should not hand-author the runtime layer. The more complete the project materials are, the more precisely Context Compiler can infer the best `.context/` workspace for Codex, Claude Code, or another coding agent.

The goal is not to replace product managers, designers, developers, testers, or reviewers.

The goal is to reduce repeated context explanation and help AI agents work inside a real software project with the right background, the right constraints, the right source of truth, and project-specific runtime query tools.

---

## Current Architecture

Context Compiler now uses a **stable kernel + replaceable components + auto-planned project pipelines** architecture.

```txt
Components = installable, replaceable capabilities contributed by the ecosystem
Pipelines  = compiler-generated execution plans that choose which components run for known sources
Kernel     = stable runtime for planning, scheduling, validation, diagnostics, and artifacts
```

The compiler lifecycle is organized as:

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

`Resolve` is a kernel stage. Other stages are replaceable. For example, ingest components can target local files, GitHub, Feishu, Figma, or Jira; link components can use built-in rules, enterprise rules, Neo4j, GraphRAG, Sourcegraph, CodeQL, or another mature graph adapter.

Official implementations are ordinary components. The current `@context-compiler/distribution-local` package bundles local components and auto-plans the default `compile` pipeline from declared source types such as Markdown, OpenAPI, and local source code.

See:

* [Pipeline Architecture](./docs/architecture/pipeline-architecture.md)
* [Component API](./docs/sdk/component-api.md)
* [Pipeline Examples](./docs/examples/pipelines.md)
* [Project Structure](./docs/architecture/project-structure.md)

---

## Quickstart

```bash
pnpm install
pnpm test
pnpm typecheck

# Create context.config.json
pnpm --filter @context-compiler/cli exec context init

# Compile local project context
pnpm --filter @context-compiler/cli exec context compile

# Inspect compiled runtime context
pnpm --filter @context-compiler/cli exec context view implementation
pnpm --filter @context-compiler/cli exec context query refund
pnpm --filter @context-compiler/cli exec context explain REQ-ORDER-REFUND-001
pnpm --filter @context-compiler/cli exec context doctor

# Generate task context
pnpm --filter @context-compiler/cli exec context task "Support partial refund" --focus implementation --module refund

# Start the project MCP server from the CLI binary
pnpm --filter @context-compiler/cli exec context mcp start
```

---

## Why Context Compiler?

Traditional software projects are usually organized around humans.

A typical project may involve product, design, frontend, backend, testing, operations, and review roles. Each role maintains its own materials:

* Product teams maintain PRDs, business rules, meeting notes, and requirement changes.
* Designers maintain prototypes, interaction specs, visual designs, and user flows.
* Frontend teams maintain pages, components, state management, and API calls.
* Backend teams maintain services, APIs, domain models, databases, and background jobs.
* Test teams maintain test plans, test cases, test data, bug reviews, and automated tests.

In many teams, the repository is still mostly just a **code repository**.

Important project knowledge is scattered across documentation tools, chat history, issue trackers, design tools, wiki pages, cloud drives, test platforms, and people’s memory.

This may work, barely, in a human-only workflow.

But in the age of AI coding agents, it creates a new problem:

> AI agents can see the code, but they often cannot see the project.

As a result, AI agents may:

* misunderstand business requirements;
* use outdated documents;
* ignore design constraints;
* miss acceptance criteria;
* fail to understand how requirements, APIs, pages, tests, and bugs are related;
* require every role to repeatedly explain the same background;
* behave like a developer-only assistant instead of a project-level collaborator.

Context Compiler explores a different model:

> A project repository should evolve from a code repository into an AI-collaborative project workspace.

---

## Core Idea

Context Compiler does **not** ask every role to rewrite their work in Markdown or engineering-specific formats.

Instead:

1. Humans keep using their existing tools.
2. Context Compiler ingests project materials from multiple sources.
3. The materials are parsed, normalized, linked, validated, and compressed.
4. A project-level Context Graph is generated.
5. Inferred context views and task-specific context packages are emitted.
6. AI agents consume the compiled context through files, MCP tools, or agent-specific integrations.

```txt
Product Docs
Design Specs
Source Code
API Definitions
Test Cases
Historical Bugs
Runtime Logs
Meeting Notes
        ↓
Context Compiler
        ↓
Project Context Graph
        ↓
Context Views / Task Context / Diagnostics / Agent Skill Packs
        ↓
Product Agent / Design Agent / Frontend Agent / Backend Agent / Test Agent / Reviewer Agent
```

The key idea is simple:

> AI should not consume messy human materials directly.
> AI should consume compiled, structured, traceable, workspace-aware project context.

---

## What Context Compiler Generates

Context Compiler can generate several types of context artifacts.

### 1. Project Brief

A high-level summary of the project:

* project purpose;
* business domains;
* user groups or personas;
* technical stack;
* repository structure;
* important global constraints;
* current delivery goals.

### 2. Domain Context

Business-domain-oriented context, such as:

```txt
auth/
order/
payment/
inventory/
notification/
admin/
```

Each domain may contain:

* domain goals;
* core business rules;
* related requirements;
* related pages;
* related APIs;
* related services;
* related database tables;
* related tests;
* known risks;
* historical decisions.

### 3. Context Views

Different tasks need different slices of the same project graph.

Context Compiler infers context views from existing content instead of asking users to configure roles:

* `project`: workspace overview and broad project context;
* `implementation`: requirements, APIs, code symbols, tests, and risks for coding work;
* `review`: full graph plus diagnostics for review work;
* `testing`: requirements, acceptance criteria, test cases, bugs, and risks;
* `product`: emitted when product-oriented content exists;
* `design`: emitted when design-oriented content exists.

For example:

```txt
.context/views/product.md
.context/views/design.md
.context/views/project.md
.context/views/implementation.md
.context/views/review.md
.context/views/testing.md
```

### 4. Task Context

For a concrete task, Context Compiler can generate a focused context package.

Example:

```bash
context task "Support partial refund for orders" --focus implementation
```

Possible output:

```txt
.context/tasks/support-partial-refund.implementation.md
```

A task context may include:

* relevant requirements;
* business rules;
* acceptance criteria;
* related APIs;
* related services;
* related database tables;
* related tests;
* historical bugs;
* risk points;
* recommended validation steps;
* constraints that should not be broken.

### 5. Diagnostics

Context Compiler can detect context quality issues, such as:

* requirement without acceptance criteria;
* requirement without test coverage;
* design not linked to any implementation;
* API mentioned in PRD but missing from OpenAPI;
* frontend calling undefined backend API;
* outdated context still referenced;
* conflicting business rules;
* missing regression test for historical bug.

### 6. Agent Skill Packs

Context Compiler may emit agent-specific instruction packs for tools such as:

* Claude Code;
* Codex;
* Cursor;
* Copilot;
* Gemini CLI;
* other AI coding agents.

---

## Project Context Graph

The center of Context Compiler is the **Project Context Graph**.

Instead of storing documents as isolated chunks, Context Compiler models project knowledge as connected engineering objects.

Example node types:

```txt
Requirement
BusinessRule
AcceptanceCriteria
DesignFrame
UserFlow
Page
Component
API
Service
DomainModel
DatabaseTable
BackgroundJob
TestCase
Bug
Decision
Risk
Release
CodeSymbol
```

Example relationships:

```txt
Requirement -> has_acceptance_criteria -> AcceptanceCriteria
Requirement -> designed_by -> DesignFrame
Requirement -> implemented_by -> CodeSymbol
Requirement -> verified_by -> TestCase
Requirement -> affected_by -> Bug

DesignFrame -> maps_to -> Page
Page -> uses -> Component
Component -> calls -> API
API -> handled_by -> Service
Service -> reads_writes -> DatabaseTable
TestCase -> covers -> Requirement
Bug -> requires_regression_test -> TestCase
Decision -> supersedes -> Decision
```

This graph allows AI agents to answer questions such as:

* Which APIs are related to this requirement?
* Which frontend pages are affected by this backend change?
* Does this requirement have test coverage?
* Which historical bugs should be considered before changing this logic?
* Is this design still active or deprecated?
* Does this PR break an old business rule?

---

## Architecture

A typical Context Compiler architecture looks like this:

```txt
┌──────────────────────────────────────────────┐
│              Human Work Sources              │
│ PRD / Figma / Issues / Code / Tests / Logs   │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Source Connectors               │
│ Feishu / Notion / Figma / Git / Jira / etc.  │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Normalization Layer             │
│ Docs / Design Nodes / Code Symbols / Tests   │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Compiler Core                   │
│ Parse / Classify / Link / Validate / Compress│
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Project Context Graph           │
│ Requirement ↔ Design ↔ API ↔ Code ↔ Test     │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Context Artifacts               │
│ Context Views / Task Context / Diagnostics      │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Agent Runtime Integration       │
│ Claude Code / Codex / Cursor / MCP / CI      │
└──────────────────────────────────────────────┘
```

---

## Compiler Pipeline

Context Compiler follows a compiler-like pipeline:

```txt
Ingest
  ↓
Parse
  ↓
Normalize
  ↓
Classify
  ↓
Link
  ↓
Validate
  ↓
Compress
  ↓
Emit
```

### Ingest

Collect project materials from different tools.

Possible sources:

* Git repositories;
* Markdown documents;
* OpenAPI specs;
* design files;
* issue trackers;
* test case systems;
* CI reports;
* runtime logs;
* meeting notes.

### Parse

Parse raw materials into structured intermediate objects.

Examples:

* Markdown sections;
* OpenAPI operations;
* source code symbols;
* test case records;
* design frames;
* issue items.

### Normalize

Convert different materials into unified context blocks.

### Classify

Classify context blocks into types such as:

* requirement;
* business rule;
* acceptance criteria;
* design spec;
* API contract;
* test case;
* bug;
* decision;
* risk;
* code symbol.

### Link

Build relationships between context objects.

Examples:

* requirement to API;
* API to backend service;
* page to component;
* requirement to test case;
* bug to regression test;
* design frame to frontend route.

### Validate

Run consistency and quality checks.

Examples:

* missing acceptance criteria;
* missing test coverage;
* API mismatch;
* deprecated context usage;
* conflicting requirements.

### Compress

Generate concise AI-readable context at different levels:

* project-level;
* domain-level;
* view-level;
* task-level.

### Emit

Output context artifacts to local files, JSONL, Markdown, MCP tools, CI reports, or agent-specific configuration.

---

## Suggested Output Structure

A compiled project may contain:

```txt
.context/
  context-manifest.json

  views/
    project.md
    implementation.md
    review.md
    testing.md
    product.md
    design.md

  tasks/
    TASK-1234.implementation.md
    TASK-1234.testing.md

  graph/
    nodes.jsonl
    edges.jsonl
    diagnostics.jsonl

  indexes/
    manifest.json
    symbols.json
    apis.json
    search.json

  runtime/
    runtime-plan.json
    runtime.config.json
    agent-install-plan.json
    trace.jsonl
    run-summary.json
    providers/

  mcp/
    server.config.json
    tools.json

  tools/
  skills/

  agents/
    codex/
      AGENTS.generated.md
    claude/
      CLAUDE.generated.md
    cursor/
      rules/

  plugins/
  diagnostics/
    context-health.json
```

---

## Example Context Manifest

```json
{
  "schemaVersion": "context-runtime.v1",
  "workspace": {
    "rootDir": "/repo/examples/local-shop",
    "name": "local-shop",
    "configPath": "/repo/examples/local-shop/context.config.json"
  },
  "compiledAt": "2026-06-02T10:00:00Z",
  "compilerVersion": "0.1.0",
  "pipeline": "compile",
  "graph": {
    "nodes": ".context/graph/nodes.jsonl",
    "edges": ".context/graph/edges.jsonl",
    "diagnostics": ".context/graph/diagnostics.jsonl"
  },
  "indexes": {
    "symbols": ".context/indexes/symbols.json",
    "apis": ".context/indexes/apis.json",
    "search": ".context/indexes/search.json"
  },
  "packs": [
    { "id": "context-view:project", "kind": "context-view", "view": "project" },
    { "id": "context-view:implementation", "kind": "context-view", "view": "implementation" }
  ],
  "runtime": {
    "plan": ".context/runtime/runtime-plan.json",
    "config": ".context/runtime/runtime.config.json",
    "trace": ".context/runtime/trace.jsonl",
    "runSummary": ".context/runtime/run-summary.json",
    "agentInstallPlan": ".context/runtime/agent-install-plan.json",
    "freshness": { "status": "fresh", "checkedAt": "2026-06-02T10:00:00Z" },
    "installStatus": { "codex": "planned", "claude": "planned" },
    "capabilitySurfaces": {
      "codex": ["AGENTS.md", ".codex/config.toml", ".agents/skills", ".codex/agents"],
      "claude": ["CLAUDE.md", ".mcp.json", ".claude/skills", ".claude/settings.json"]
    },
    "providers": [],
    "tools": ["context-compile", "context-doctor", "context-task-implementation", "context-task-testing", "context-review"],
    "skills": ["implementation", "testing", "review", "product"],
    "agents": ["codex", "claude", "cursor"],
    "plugins": ["context-compiler-local"],
    "mcp": {
      "serverConfig": ".context/mcp/server.config.json",
      "tools": ".context/mcp/tools.json"
    }
  },
  "diagnostics": {
    "health": ".context/diagnostics/context-health.json",
    "graph": ".context/graph/diagnostics.jsonl"
  }
}
```

---

## Example Context View

```md
# Implementation Context

## Scope

This view is optimized for backend implementation and review.

## Related Domains

- Auth
- Order
- Payment

## APIs

### POST /api/orders/{id}/refund

Related requirement:

- REQ-ORDER-REFUND-001

Business rules:

- Refund amount must not exceed refundable amount.
- Refund operation must be idempotent.
- Refunded orders must generate an audit record.

Related services:

- RefundService
- OrderService
- PaymentGatewayClient

Related tests:

- TC-REFUND-001
- TC-REFUND-002
- TC-REFUND-REGRESSION-001

Historical risks:

- BUG-2025-331: duplicate refund caused by retry.
- BUG-2025-418: refund succeeded but order status was not updated.
```

---

## Example CLI

```bash
# Initialize Context Compiler in a project
context init

# Sync configured sources into a parser-ready manifest
context sync

# Compile project context
context compile

# Validate context quality
context validate

# Generate context view
context view implementation

# Generate task-specific context
context task "Support partial refund for orders" --focus implementation

# Install native Codex and Claude Code integration files
context integrate all

# Explain where a context item came from
context explain REQ-ORDER-REFUND-001

# Inspect local inventory / symbol index output
context inventory
context index
```

---

## Component System

Context Compiler is extended through **components**, not a generic plugin folder. Each component belongs to one pipeline stage and communicates through stable artifacts.

### Ingest Components

Collect human/project materials and emit `RawArtifact`.

Examples:

```txt
ingest.local-files
ingest.git
ingest.github
ingest.feishu
ingest.notion
ingest.confluence
ingest.figma
ingest.jira
ingest.linear
ingest.ci-report
```

### Parse Components

Parse raw content and emit `ParsedArtifact`.

Examples:

```txt
parse.markdown
parse.docx
parse.html
parse.openapi
parse.source-code
parse.xlsx
parse.figma
```

### Normalize / Classify Components

Convert source-specific structures into unified records, then classify them into requirements, APIs, tests, bugs, code symbols, and other semantic facts.

Examples:

```txt
normalize.markdown-doc
normalize.openapi-contract
normalize.code-symbol
classify.context-facts
classify.enterprise-llm
```

### Enrich / Link Components

Add inventory, symbol indexes, external indexes, or graph relationships. Link components can be built-in rules, mature graph/RAG/code-intelligence adapters, or enterprise implementations.

Examples:

```txt
enrich.inventory
enrich.symbol-index
enrich.sourcegraph
link.default-rules
link.neo4j-adapter
link.graph-rag
link.codeql-adapter
link.enterprise-rules
```

### Validate / Govern Components

Check context quality and enforce governance before output.

Examples:

```txt
validate.default-rules
validate.api-mismatch
validate.conflicting-rules
govern.redaction
govern.policy-access
govern.pii-filter
govern.external-agent-filter
```

### Compress / Emit Components

Generate context views, task context, agent packs, MCP data, files, or reports.

Examples:

```txt
compress.context-view
compress.task-context
compress.runtime-plan
compress.reviewer-context
emit.files
emit.mcp
emit.codex
emit.cursor
emit.html-report
```

---

## Configuration Example

```ts
import { defineContextProject } from '@context-compiler/core'

export default defineContextProject({
  sources: [
    {
      type: 'markdown',
      name: 'product-docs',
      path: './sources/product-docs'
    },
    {
      type: 'openapi',
      name: 'api-spec',
      path: './sources/api-spec/openapi.yaml'
    },
    {
      type: 'code',
      name: 'source',
      path: './sources/source-code'
    },
    {
      type: 'markdown',
      name: 'test-cases',
      path: './sources/test-cases'
    }
  ],

  policies: {
    redact: [
      'secret',
      'access_token',
      'phone_number',
      'email',
      'id_card'
    ],
    deprecatedHandling: 'warn',
    conflictHandling: 'diagnose'
  }
})
```

`project`, `roles`, `profiles`, and `pipelines` are intentionally absent from normal user config. The workspace is the directory that contains `context.config.json`; the compiler infers project metadata, the local compile pipeline, context views, runtime plan, and task context from the source content.

---

## MCP Integration

Context Compiler can expose project context through an MCP server.

Possible MCP tools:

```txt
get_project_brief
get_context_view
get_domain_context
get_task_context
search_context
get_related_nodes
get_requirement
get_api_context
get_test_coverage
get_diagnostics
explain_trace
```

Example request:

```json
{
  "tool": "get_task_context",
  "input": {
    "task": "Support partial refund for orders",
    "focus": "implementation",
    "maxTokens": 12000
  }
}
```

Example response:

```json
{
  "data": {
    "task": "Support partial refund for orders",
    "focus": "implementation",
    "nodes": [],
    "edges": [],
    "recommendedChecks": []
  },
  "evidence": [],
  "freshness": { "status": "fresh" },
  "diagnostics": []
}
```

---

## Context Governance

Context Compiler treats context as something that must be governed, not just retrieved.

Each context block should carry metadata such as:

```txt
source URI
source type
author
created time
updated time
status
confidence
authority level
effective time
deprecation state
source owner or team
```

This allows AI agents to know:

* where a context item came from;
* whether it is still active;
* whether it is approved or only a draft;
* whether it conflicts with another source;
* whether the current agent is allowed to see it;
* whether it should be used as a source of truth.

---

## Context Priority

Different sources may represent different kinds of truth.

For example:

```txt
Code represents current behavior.
PRD represents expected behavior.
Tests represent verified behavior.
Design represents intended user experience.
Bugs represent historical risk.
Decisions represent architectural constraints.
```

Context Compiler should not blindly assume one source always overrides another.

Instead, it should detect conflicts and expose them as diagnostics.

---

## Security and Privacy

Context Compiler should support:

* secret detection;
* PII redaction;
* source and focus based context access;
* source-level permissions;
* external-agent filtering;
* audit trails;
* manual override;
* provenance tracking.

This is especially important when context is used by external AI services or third-party agents.

---

## Use Cases

### AI Coding

Generate task-specific backend or frontend context before coding.

```bash
context task "Add login verification code expiration handling" --focus implementation
```

### PR Review

Generate a review context for changed files.

```bash
context diff --from main --to feature/login-code-expiration
```

The Reviewer Agent can check whether the change is consistent with:

* requirements;
* design specs;
* API contracts;
* test cases;
* historical bugs;
* business rules.

### Test Generation

Generate test context from acceptance criteria and historical bugs.

```bash
context task "Generate regression tests for refund retry" --focus testing
```

### Requirement Review

Check whether a PRD has enough implementation and testing information.

```bash
context validate --source prd-order-refund-v3
```

### Onboarding

Generate a project brief and domain tours for new developers or AI agents.

```bash
context view project
context view implementation
```

---

## Comparison with Codebase Knowledge Graph Tools

Context Compiler is related to codebase understanding and knowledge graph tools, but it has a different focus.

A codebase graph tool helps AI understand code structure.

Context Compiler aims to help AI understand the whole software project.

```txt
Codebase understanding:
code -> graph -> search/explain/visualize

Context Compiler:
product/design/code/test/bugs/logs -> context graph -> context views/task context/diagnostics -> multi-agent collaboration
```

In short:

> Codebase graph tools help AI understand code.
> Context Compiler helps AI understand the project and work correctly with task focus.

---

## Current Status

This project is currently in the RFC / experimental design stage.

The initial goal is to build a minimal compiler that supports:

* Markdown PRD;
* OpenAPI specs;
* local Git repositories;
* source code symbol extraction;
* Markdown or spreadsheet test cases;
* requirement-to-API linking;
* API-to-code linking;
* requirement-to-test linking;
* context view generation;
* basic diagnostics.

---

## Roadmap

### Phase 0: RFC

* Define core concepts.
* Define context schema.
* Define graph model.
* Define plugin interfaces.
* Define CLI proposal.

### Phase 1: Local MVP

* Local Markdown source connector.
* Git source connector.
* OpenAPI parser.
* Basic TypeScript source parser.
* Context graph stored as JSONL or SQLite.
* Markdown context view emitter.
* Basic diagnostics.

### Phase 2: Task Context

* Task-based context generation.
* Diff impact analysis.
* Reviewer context.
* Test context.
* Agent-ready context packs.

### Phase 3: MCP Server

* MCP tool server.
* Dynamic context query.
* Agent integration.
* Claude Code / Cursor / Codex adapters.

### Phase 4: Multi-source Connectors

* Figma connector.
* Feishu / Notion / Confluence connector.
* Jira / Linear connector.
* Test management connector.
* CI report connector.

### Phase 5: Context Governance

* Provenance viewer.
* Conflict detection.
* Manual override.
* Role-based access.
* PII and secret redaction.
* Context health dashboard.

---

## Contributing

Context Compiler is an open exploration of AI-native software engineering infrastructure.

Contributions are welcome in the following areas:

* context schema design;
* graph model design;
* connector plugins;
* parser plugins;
* validator rules;
* context view templates;
* MCP integration;
* AI agent workflow design;
* examples and case studies.

If you are interested in AI coding agents, software engineering workflows, context engineering, knowledge graphs, developer tools, or multi-agent collaboration, this project is for you.

---

## License

License will be selected before the first public release.

---

## Project Vision

Software engineering is not only code.

It is a network of requirements, designs, APIs, services, tests, bugs, decisions, constraints, and people.

AI agents need this network to work reliably.

Context Compiler is an attempt to make that network explicit, structured, traceable, and usable.

> From code repository to AI-collaborative project workspace.
