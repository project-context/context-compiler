---
name: context-implementation
description: Use when implementation work needs compiled project context, source evidence, diagnostics, or task-focused context.
---

# Implementation Context

Use this skill when the task needs compiled project context, linked source evidence, diagnostics, or freshness checks.

Before changing files, inspect the generated context runtime through MCP or the CLI:

- Do not scan the full `.context/` tree unless MCP is unavailable.
- Start with `get_context_health` and `get_context_manifest`.
- Use `search_context`, `get_task_context`, and `get_source_trace` for focused evidence.
- Run `context doctor` when freshness or diagnostics matter.
- Run `context task "$ARGUMENTS" --focus implementation` for focused task context.
- Return source node ids, source uris, confidence, freshness, and diagnostics in handoff notes.
