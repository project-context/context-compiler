# Agent-Native `.context` 运行时工作区规范

`.context/` 是 Context Compiler 编译出来的 Agent 运行时工作区。它的主要读者不是人，而是 Claude Code、Codex、OpenCode、MCP server、CLI、viewer、索引器和其他工具。

因此，`.context/` 不应该被设计成一个文档目录、Wiki 或 Obsidian vault。它更接近给 AI Agent 使用的 IR、索引数据库、source map 和 debug symbols。人类可读 Markdown 只作为调试 projection 保留在 `debug/` 下，不是 canonical data。

## 设计目标

- **Agent-native**：默认输出 JSON、JSONL、SQLite、索引和可调用 runtime 描述，方便工具按需读取。
- **Manifest-first**：`.context/manifest.json` 是唯一机器入口。调用方应先读 manifest，再按 manifest 暴露的路径读取数据。
- **MCP-first**：Claude Code、Codex、OpenCode 应优先通过 MCP 或 CLI 查询，不应该全量扫描 `.context/`。
- **Package-first**：查询从 L0 package 开始，再进入 L1 group、L2 graph scope、L3 claim 或 task pack。
- **Evidence-first**：任何结论都要能追踪到 graph fact、source map、source ref 和原始资料。
- **Debug-is-optional**：Markdown、HTML 图谱、报告只放在 `debug/`，用于人类排查和演示。

## 顶层目录

```txt
.context/
  manifest.json
  health.json

  model/
  store/
  graph/
  index/
  packs/
  runtime/
  mcp/
  agents/
  debug/
  state/
  cache/
  extensions/
```

### `manifest.json`

控制面入口。它声明 schema version、项目名称、compile 时间、graph 路径、index 路径、packs 路径、runtime 能力、Agent surfaces、debug 入口和 state 入口。

所有工具都应该先读它。除非是底层 writer 或迁移脚本，否则不要在调用方散落硬编码路径。

### `health.json`

快速健康检查入口。用于判断 `.context` 是否可用、是否 stale、是否存在 diagnostics、capability gaps、runtime provider 缺口或索引缺口。

Agent 的推荐启动顺序是：

```txt
get_context_manifest
get_context_health
list_context_packages
get_context_package / search_context_package
get_task_context
explain_graph_fact / get_source_trace
```

## `model/`：L0/L1/L2/L3 标准模型

`model/` 存放 source-first 和 graph-of-graphs 的标准模型，不存大正文。

```txt
model/
  source-inventory.jsonl
  source-routes.jsonl
  unsupported-sources.jsonl
  source-summary.json
  packages.jsonl
  groups.jsonl
  build-units.jsonl
  scopes.jsonl
  claims.jsonl
  grouping-request.json
  plans/
    planning-pack.json
    planning-cycles.jsonl
    source-triage.json
    source-group-plan.json
    workspace-graph-plan.json
    scope-build-plan.json
    adapter-plan.json
```

- `packages.jsonl` 是 L0 package map。
- `groups.jsonl` 是 L1 source group map。
- `scopes.jsonl` 是 L2 graph scope 的轻量列表。
- `claims.jsonl` 预留给 L3 Claim Graph。
- `plans/` 是 source-first 和 scope build 的机器规划结果。

## `store/`：内容对象和 source map

`store/` 面向快速检索和证据追踪，不要求人直接阅读。

```txt
store/
  blobs/
  chunks.jsonl
  source-map.jsonl
```

- `blobs/` 预留给 content-addressed 原始内容或转换内容。
- `chunks.jsonl` 预留给 token-aware chunks、chunk type、scope id 和 source ref。
- `source-map.jsonl` 建立 compiled fact、source entry 和原始位置之间的映射。

## `graph/`：canonical typed graph

`graph/` 是事实图和 patch/revision 核心层。

```txt
graph/
  nodes.jsonl
  edges.jsonl
  diagnostics.jsonl
  scopes/
    manifest.json
    <scope-id>/
      nodes.jsonl
      edges.jsonl
      summary.json
  subgraphs/
  partitions/
  revisions.jsonl
  patches.jsonl
  submitted-patches.jsonl
  evidence-reports.jsonl
```

`nodes.jsonl` 和 `edges.jsonl` 是 canonical graph。第三方图工具、Graphify、GraphRAG、CodeGraph、Sourcegraph 或 CodeQL adapter 的输出不能直接替代 canonical graph；它们应先转换成 adapter facts 或 L2 domain IR，再投影到 ContextGraph。

Graphify 这类可视化地图应作为 projection 放入：

```txt
debug/maps/graphify/
```

## `index/`：检索加速层

`index/` 存放 SQLite/FTS/符号/API/包级索引。

```txt
index/
  manifest.json
  global/
    graph.sqlite
    symbols.sqlite
    api.sqlite
    docs.sqlite
    tests.sqlite
    runtime.sqlite
    fts.sqlite
    fingerprints.sqlite
  scopes/
    <scope-id>/
      graph.sqlite
      fts.sqlite
      symbols.sqlite
```

Agent 不应该手动扫描 JSONL 后自行做全文搜索。优先使用 MCP `search_context`、`search_context_package` 或 CLI query，它们会先用 SQLite FTS，再回退到内存搜索。

## `packs/`：预编译上下文包

`packs/` 是 Agent 最适合直接读取的上下文切片。

```txt
packs/
  views/
    project.json
    implementation.json
    review.json
    testing.json
    product.json
    design.json
  tasks/
    <task-id>.json
```

这些 JSON pack 可以包含 Markdown content，但外壳必须是结构化数据，方便 MCP、CLI 和 Agent 解析。人类可读 Markdown fallback 写到 `debug/views/` 或 `debug/tasks/`。

## `runtime/`：能力声明和运行时配置

```txt
runtime/
  runtime-plan.json
  runtime.config.json
  agent-install-plan.json
  trace.jsonl
  run-summary.json
  providers/
  tools/
  skills/
  plugins/
```

`runtime-plan.json` 描述项目可用 providers、MCP tools、project tools、skills、agents、plugins 和 capabilities。它回答“这个项目编译出了哪些可调用能力”。

## `mcp/`：MCP 暴露面

```txt
mcp/
  server.config.json
  tools.json
  resources.json
```

推荐资源 URI：

```txt
context://manifest
context://health
context://runtime-plan
context://packs/project
context://debug/views/project
```

旧的 `context://views/project` 不再是主要入口。结构化 pack 优先，debug Markdown fallback。

## `agents/`：Agent 专属生成说明

```txt
agents/
  codex/
    AGENTS.generated.md
  claude/
    CLAUDE.generated.md
  opencode/
    AGENTS.generated.md
```

仓库根部的 `AGENTS.md`、`CLAUDE.md` 和 `opencode.json` 应保持短小，只做 bootstrap：

1. `.context/` 是编译产物，不要手动修改。
2. 优先使用 Context Compiler MCP/CLI。
3. 先读 manifest/health，再走 package-first/task-first/evidence-first。
4. 不要全量扫描 `.context/`，除非 MCP 不可用。

## `debug/`：人类调试 projection

```txt
debug/
  views/
  tasks/
  project/
  domains/
  reports/
  diagnostics/
  maps/
    graphify/
```

`debug/` 可以包含 Markdown、HTML、Graphify 图、诊断报告和演示用摘要。它不是 canonical data，也不是 Agent 的默认入口。

## `state/`：跨编译记忆

```txt
state/
  corrections.jsonl
  rehome-proposals.jsonl
  grouping-decisions.json
  source-correction-decisions.jsonl
  approvals.jsonl
  notes.jsonl
```

`state/` 存放人或 Agent 明确提交的修正、审批、分组决策和备注。它和 `cache/` 不同，不能随意删除。

## `cache/` 和 `extensions/`

`cache/` 是可删除缓存。`extensions/` 是 adapter-owned runtime、data、artifacts、logs 和 status 所在位置，第三方 adapter 只能写自己的子目录，不能直接写 canonical `graph/`。

## 最优读取协议

文件 fallback：

```txt
AGENTS.md / CLAUDE.md / opencode.json
  -> .context/manifest.json
  -> .context/health.json
  -> .context/packs/views/project.json
  -> .context/model/packages.jsonl
  -> .context/graph/scopes/manifest.json
  -> .context/store/source-map.jsonl
  -> 原始 source
```

MCP 优先：

```txt
get_context_manifest
get_context_health
list_context_packages
get_context_package
expand_context_package
search_context_package
get_task_context
explain_graph_fact
get_source_trace
```

这个协议的目标是让 Agent 每次只读取和当前任务相关的小切片，而不是把整个项目资料塞进上下文窗口。
