<!-- BEGIN context-compiler:claude -->
@AGENTS.md

## Claude Code

- Prefer the Context Compiler MCP server before manually scanning generated `.context` files.
- Use `.claude/skills/context-*` skills for implementation, review, and testing workflows.
- Use MCP resources such as `context://manifest`, `context://health`, and `context://views/project` when available.
- Check `.context/diagnostics/context-health.json` when context looks stale or incomplete.
<!-- END context-compiler:claude -->
