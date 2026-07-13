# 存储决策

## 结论

第一版采用：

```txt
外部 SQLite store + 工作区文件系统 sources
```

一句话：

```txt
SQLite 管正确性。
.context/sources 管 Agent 可读原文。
context() 管关联查询。
```

不在第一版引入：

```txt
Neo4j
独立向量数据库
分布式存储
RocksDB
自研图数据库
独立搜索服务
默认全量 Atlas Markdown
```

## 默认布局

工作区默认只生成：

```txt
project-root/
  .context/
    sources/

  AGENTS.md
  .claude/
  .codex/
```

权威 store 默认放在工作区外部，由 Context Compiler 管理：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/context.db
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/indexes/
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/
```

其中：

```txt
.context/sources:
  Source 层和 NormalizedSource 的文件化投影。
  给 Agent Read / Grep / Glob 核对原文。

external context.db:
  canonical metadata、graph、refs、build state、corrections。

external indexes:
  可重建召回索引、FTS、符号索引、邻接索引。

external runtime:
  Context View、ViewBinding、trace、临时展开状态。
```

## 为什么 db 默认不放工作区

`context.db` 默认不进入 `.context`。

原因：

```txt
db 是派生运行状态，不是 Agent 阅读材料。
db 可能很大。
db 可能包含抽取后的敏感摘要、候选推断和人工确认。
db 容易被误提交、误同步、误 Grep。
db 放在工作区会让 .context 边界变脏。
```

`.context/sources` 是 Agent 工作材料。

`context.db` 是编译器运行状态。

默认应该分开。

## SQLite 存什么

SQLite 存 canonical metadata、graph 和状态。

不存大段原文，不存大量二进制资产。

建议表方向：

```txt
workspaces
sources
source_snapshots
normalized_sources

structure_refs
evidence_refs
fact_refs

scopes
scope_assignments
scope_relations
effective_scope_index

semantic_edges

build_runs
stale_records
corrections
user_confirmations
view_bindings
```

字段可以逐步稳定，但第一版必须支持：

```txt
ref
kind
status
confidence
hash
locator
basis_refs
created_at
updated_at
stale_state
```

## 文件系统存什么

工作区文件系统默认只存 Agent 直接读取的 cleaned sources：

```txt
.context/sources:
  source.json
  original pointer 或 original copy
  normalized markdown/html/table slices
  assets
```

不要默认生成：

```txt
.context/atlas
.context/indexes
.context/runtime
.context/store
.context/index.md
.context/README.md
```

原则：

```txt
Agent 要核对的原文，放 .context/sources。
系统要保证一致性的，放外部 SQLite。
可重建的索引和 runtime artifact，放外部 store。
```

## 图如何存

Scope Graph 和 Semantic Graph 不需要图数据库。

用边表即可。

### ScopeAssignment

```txt
scope_assignments:
  id
  from_layer
  from_ref
  scope_id
  assignment_kind
  propagation
  status
  confidence
  basis_refs_json
  created_at
  updated_at
```

`from_layer` 可以是：

```txt
source
structure
evidence
fact
```

### ScopeRelation

```txt
scope_relations:
  id
  from_scope_id
  to_scope_id
  relation_kind
  status
  confidence
  basis_refs_json
  created_at
  updated_at
```

### SemanticEdge

```txt
semantic_edges:
  id
  from_fact_ref
  to_fact_ref
  relation_kind
  status
  confidence
  basis_refs_json
  created_at
  updated_at
```

查询时可以从这些边表构建 adjacency。

第一版不需要专门图数据库。

## 索引策略

第一版使用两层索引：

```txt
1. .context/sources
   Agent 在需要核对原文或做局部排查时 Grep。

2. 外部 SQLite FTS5 或轻量索引表
   context() 召回事实、证据、Scope、语义关系。
```

不要默认生成 rg-friendly Atlas 或 Fact/Evidence Markdown 数据库。

如果后续性能不够，再升级：

```txt
全文索引:
  Tantivy

向量索引:
  sqlite-vec / LanceDB / Qdrant

图遍历:
  adjacency table + in-memory graph
```

这些都不是第一版必需。

## Portable 模式

默认 store 在工作区外部。

如需离线拷贝、归档或 CI 复现，可以显式启用 portable 模式：

```txt
context build --portable
```

portable 模式允许：

```txt
.context/
  sources/
  .store/
    context.db
    indexes/
    runtime/
```

要求：

```txt
.context/.store 必须加入 .gitignore。
Agent 默认不要读取 .context/.store。
doctor 必须能提示 portable store 的大小、敏感风险和 stale 状态。
```

## 可重建与不可丢

### 可重建

```txt
external indexes
external runtime views
external runtime bindings
部分 normalized projections
.context/sources 中可重新生成的清洗投影
```

### 应保留

```txt
external context.db
source snapshot metadata
corrections
user confirmations
manual scope decisions
workspace mapping
```

### 原始资料

原始资料策略按来源类型决定：

```txt
本地文件:
  可以保存 path + hash，不一定复制。

Git 仓库:
  可以保存 repo pointer + commit hash。

外部文档:
  可以保存 snapshot policy。
  需要离线可复现时保存 original copy。
```

`NormalizedSource` 必须能映射回原始 locator 和 SourceSnapshot。

## 配置位置

用户可编辑配置放在工作区根目录：

```txt
context.config.json
```

不要把用户主配置藏进 `.context`。

Context Compiler 可以在外部 store 记录：

```txt
workspace root
workspace hash
store version
last build
health state
```

## 第一版不做

第一版不做：

```txt
多用户权限数据库
远程同步
分布式存储
图数据库
独立向量服务
复杂迁移系统
跨机器锁
全量后台 daemon
默认 Atlas 导出
默认 Fact/Evidence Markdown 导出
```

第一版要做的是：

```txt
SQLite 表结构足够清楚。
.context/sources 足够 Agent 取证。
context() 能从外部 store 返回可追溯 Context View。
build 能重复运行并更新 stale 数据。
status / doctor 能检查外部 store 和 .context/sources 映射一致性。
```

## 一句话

```txt
第一版用外部 SQLite store + .context/sources。
SQLite 保存 canonical metadata / graph / state。
.context/sources 保存 Agent 可读的 cleaned sources。
关联查询和渐进展开走 context()。
Atlas 和 portable store 都是显式可选能力，不是默认结构。
```
