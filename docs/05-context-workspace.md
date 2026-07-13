# .context 工作区

## 定位

`.context` 默认只做一件事：

```txt
保存 Agent 可以 Read / Grep / Glob 的 cleaned sources。
```

它不是权威数据库。

它不是 Atlas。

它不是索引目录。

它不是 runtime 缓存目录。

事实、证据、Scope、语义关系、索引、构建状态和 ViewBinding 默认都放在工作空间外部的 Context Compiler store 中，由 `context()` 查询。

这样做是为了避免：

```txt
百万级事实和证据导出成海量 Markdown。
Agent Grep 被派生文件淹没。
.db / 索引 / runtime artifact 被误提交或误扫描。
抽取后的敏感推断散落在项目目录里。
```

`.context` 是 Agent 最终取证的可读资料区。

`context()` 是 Agent 查询关联上下文的入口。

## 默认工作区结构

推荐默认结构：

```txt
project-root/
  .context/
    sources/

  AGENTS.md
  .claude/
  .codex/
```

如果用户不需要 Coding Agent 自动发现入口，可以只生成：

```txt
project-root/
  .context/
    sources/
```

`.context` 默认不生成：

```txt
atlas/
indexes/
store/
runtime/
index.md
README.md
manifest.json
health.json
context.db
```

这些内容如果需要，应该进入外部 store、CLI 输出或按需物化结果，而不是默认暴露给 Agent 的文件工具。

## sources

`.context/sources` 是 Source 层和 NormalizedSource 的文件投影。

它按来源通道和来源身份组织，不按 Scope 组织。

不要加 `connectors/` 这一层。来源类型本身就是第一层目录。

示例：

```txt
.context/sources/
  gitlab/{group}/{repo}/
  feishu/{space}/{doc}/
  dingtalk/{workspace}/{doc}/
  tencent-docs/{workspace}/{doc-or-sheet}/
  database/{connection}/{schema}/
  local-files/{import-batch}/{source-file}/
```

原因：

```txt
一个 Source 可能表达多个 Scope。
按 Scope 放会复制、污染和难以更新。
```

源码仓库应尽量保持原样。

PDF、PPT、DOC、图片、Excel 等不适合 Agent 直接读的资料，可以生成规范化 Markdown、HTML、CSV 分片或表格切片。

每个来源项建议包含：

```txt
source.json
original/
normalized/
assets/
```

示例：

```txt
.context/sources/
  gitlab/group-order/repo-order-service/
    source.json
    original/
      repo-pointer.json
    normalized/
      src/main/java/com/a/order/RefundService.java

  feishu/commerce-space/refund-policy/
    source.json
    original/
      refund-policy.pdf
    normalized/
      refund-policy.md
    assets/
      page-001.png

  local-files/import-2026-06-18/refund-flow-ppt/
    source.json
    original/
      refund-flow.pptx
    normalized/
      refund-flow.md
    assets/
      slide-001.png
```

`source.json` 保存：

```txt
source id
source system
original uri
snapshot hash
media type
access status
title
normalized mapping
```

目录表达来源类型；细节放进 `source.json`。

## 外部 Store

权威数据默认不放进 `.context`。

推荐由 Context Compiler 管理外部 store，例如：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/context.db
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/indexes/
```

外部 store 保存：

```txt
SourceRecord / SourceSnapshot
StructureRef / EvidenceRef / FactRef
Scope / ScopeAssignment / ScopeRelation / EffectiveScope
SemanticEdge
build state
corrections
user confirmations
ViewBinding
query/runtime trace
```

`context()` 根据当前工作区路径找到对应 store。

Agent 不直接读 store。

## Portable 模式

有些场景需要把上下文包离线拷贝、归档或交给 CI 复现。

可以提供显式 portable 模式：

```txt
context build --portable
```

portable 模式可以生成：

```txt
.context/
  sources/
  .store/
    context.db
    indexes/
    runtime/
```

但这不是默认模式。

portable 模式必须提醒用户：

```txt
.context/.store 应加入 .gitignore。
.context/.store 不是 Agent 默认阅读对象。
```

## Coding Agent 入口

面向具体 Coding Agent 的自动发现入口放在工作区根目录，与 `.context` 同级：

```txt
project-root/
  .context/
  AGENTS.md
  .claude/
  .codex/
```

这些入口不保存项目知识本体，只保存使用说明和指向 `context()` / `.context/sources` 的短指令。

推荐职责：

```txt
AGENTS.md:
  通用 Coding Agent 指令。
  告诉 Agent 关联查询用 context()，取证原文读 .context/sources。

.claude/:
  Claude Code 专用设置、命令、提示或指令片段。

.codex/:
  Codex 专用设置、命令、提示或指令片段。
```

不要把这些入口只放在 `.context` 里面。

原因：

```txt
Coding Agent 通常从项目根目录发现 AGENTS.md、.claude、.codex 等入口。
.context 是 cleaned source 工作区，不承担所有工具的自动发现职责。
根目录入口更像 activation shim，负责告诉 Agent 如何使用 context() 和 .context/sources。
```

## Agent 默认使用方式

推荐：

```txt
1. 读根目录 AGENTS.md。
2. 关联上下文、事实、证据、Scope、语义关系通过 context() 查询。
3. context() 返回证据路径后，再 Read .context/sources 中的规范化原文。
4. 需要全文排查时，只在 .context/sources 中 Grep。
```

不要：

```txt
扫描整个 .context。
期待 .context 里有全量事实或证据 Markdown。
把 .context 当数据库。
绕过 context() 自己从 sources 推理全局关系。
```

## Atlas 的位置

Atlas 仍然是一个有价值的概念：

```txt
分层 graph 的 Markdown 投影。
像静态版、多页面的 Context View。
```

但它不进入默认 `.context` 工作区。

原因是：

```txt
大规模项目会产生海量事实和证据。
默认生成 Atlas 容易变成 Markdown 版数据库。
Grep 噪声会变大。
增量更新成本会变高。
```

Atlas 第一版应作为可选物化能力：

```txt
按需把某次 context() 返回保存成 Markdown。
按需为高频主题生成少量静态页。
按需为人工复核生成审阅页。
```

默认边界是：

```txt
.context/sources:
  cleaned source workspace。

external store:
  canonical graph / facts / evidence / indexes / runtime state。

context():
  关联查询和渐进式 Context View。

AGENTS.md / .claude / .codex:
  Agent 激活入口。
```
