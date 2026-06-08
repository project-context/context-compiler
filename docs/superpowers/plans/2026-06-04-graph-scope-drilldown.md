# Graph Scope Drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build budgeted Graph-of-Graphs drill-down APIs so CLI and MCP can navigate from project scopes to source groups, files, content nodes, and source evidence.

**Architecture:** Core owns `GraphScopeView`, `GraphExpansion`, and `LayeredSourceTrace`. CLI and MCP are thin readers over the core runtime API; canonical graph and scope JSONL remain the source of truth.

**Tech Stack:** TypeScript, JSONL graph files, existing `.context/graph/scopes/manifest.json`, Vitest, existing CLI/MCP runtime.

---

### Task 1: Core Contracts and Tests

**Files:**
- Modify: `packages/core/src/contracts/index.ts`
- Create: `packages/core/src/__tests__/scope-drilldown.test.ts`

- [ ] Add `GraphScopeView`, `GraphExpansion`, `LayeredSourceTrace`, budget, omitted, and next-action contracts.
- [ ] Add failing Vitest coverage for scope view budgets, source-group target expansion, CodeSymbol expansion, and layered source trace.

### Task 2: Core Runtime API

**Files:**
- Create: `packages/core/src/runtime/scope-drilldown.ts`
- Modify: `packages/core/src/runtime/index.ts`

- [ ] Implement manifest and scoped graph loading from `.context/graph/scopes`.
- [ ] Implement scope view ranking and summary/full budget trimming.
- [ ] Implement target resolution for scope id, node id, and edge id.
- [ ] Implement layered source trace from fact -> SourceGroup -> scopes -> files/content -> SourceRef.

### Task 3: CLI Wiring

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`

- [ ] Add `context graph scope`, `context graph expand`, and `context graph trace`.
- [ ] Add text formatters that show actionable summaries and omitted counts by default.

### Task 4: MCP Wiring

**Files:**
- Modify: `packages/mcp/server/src/index.ts`
- Modify: `packages/core/src/runtime/planner.ts`
- Modify: `packages/mcp/server/src/index.test.ts`

- [ ] Replace local scope/trace helpers with core runtime calls.
- [ ] Add `expand_graph_target` tool and update `get_graph_scope`, `expand_graph_scope`, `get_source_trace` schemas.
- [ ] Update MCP tests for the new budgeted shape.

### Task 5: Verification

**Files:**
- Modify: `tests/e2e/source-first.test.ts`
- Modify: `tests/e2e/mcp-runtime-tools.test.ts`

- [ ] Verify local-sbt scope, expand, trace CLI/MCP flows.
- [ ] Run `pnpm typecheck`, `pnpm test`, and local-sbt compile/apply/scope/expand/trace commands.
