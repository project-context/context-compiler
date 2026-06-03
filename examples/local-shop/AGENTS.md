<!-- BEGIN context-compiler:codex -->
## Context Compiler

- Treat `.context/` as the generated local context runtime workspace.
- Prefer the Context Compiler MCP server over manually scanning generated context files.
- Start by calling `get_context_health` and `get_context_manifest` when project context matters.
- Use `.context/views/project.md` only as a short human-readable orientation snapshot.
- For implementation work, call `get_task_context` or run `context task "<task>" --focus implementation` when task context matters.
- Run `context doctor` before handoff when context quality or freshness matters.
- Use MCP config from `.context/mcp/server.config.json` when an agent-native MCP client is available.
<!-- END context-compiler:codex -->
