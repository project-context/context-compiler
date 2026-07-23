# Context Compiler 文档

本文档定义稳定的目标形态，理论模型不依赖实现语言。当前工程实现已选择纯 Rust 多 crate Workspace；实现映射见 [Rust Workspace 实现映射](./11-rust-workspace.md)。

## 目标

Context Compiler 的目标是：

```txt
把散乱的人类项目资料
编译成
AI Agent 可查询、可追溯、可逐步取证、可更新的项目上下文。
```

它不是普通 RAG，不是单纯向量检索，也不是把资料整理成一堆人工 Markdown。

核心形态由三部分组成：

```txt
Canonical Data
  权威数据层。保存清单、结构、证据、事实、Scope、语义关系。

.context Workspace
  cleaned source 工作区。让 Agent 用 Read / Grep / Glob / Bash 核对原文。

context()
  关联查询入口。用于查询事实、证据、Scope、语义关系和渐进展开。
```

## 当前核心判断

- 低层不强行统一内部结构：Markdown、PDF、Excel、代码、OpenAPI 的结构、证据、事实可以各自实现。
- 低层必须统一可引用能力：SourceRef、StructureRef、EvidenceRef、FactRef 必须能追溯、失效、展开。
- Source 层通过可注册的 `SourceNormalizer` 生成 `NormalizedSource`：源码尽量原样保留，PDF/PPT/DOC/图片/Excel 等可以生成 Markdown、HTML 或表格投影。
- 扩展名只负责选择已注册的 A→B Normalizer；Structure Parser 按标准化产物的格式、MIME、后缀与 Agent profile 匹配，不读取原始物理路径。
- Scope 是横切层：它切 Source、Structure、Evidence、Fact 这些具体项。
- Scope Graph 由 `ScopeAssignment` 和 `ScopeRelation` 组成。
- Dimension 不是层名，而是 Scope 的分类轴，例如系统、服务、团队、版本、业务能力。
- Semantic Graph 是独立关系网，只连接 FactRef 和 FactRef。
- Scope 帮语义缩范围、防混淆；语义不负责范围归属。
- `.context` 默认只放 cleaned sources，不放 atlas、facts、evidence、store、runtime。
- 事实、证据、Scope、语义关系和索引默认在外部 store，由 `context()` 查询。
- Coding Agent 自动发现入口放在工作区根目录，与 `.context` 同级，例如 `AGENTS.md`、`.claude/`、`.codex/`。

## 文档阅读顺序

1. [架构基础](./00-foundation.md)
2. [数据模型](./01-data-model.md)
3. [Scope Graph](./02-scope-graph.md)
4. [ScopeAssignment 构建系统](./10-scope-assignment-system.md)
5. [Semantic Graph](./03-semantic-graph.md)
6. [构建流程](./04-build-flow.md)
7. [.context 工作区](./05-context-workspace.md)
8. [查询运行时](./06-query-runtime.md)
9. [编译命令和工作流](./07-command-workflow.md)
10. [存储决策](./08-storage-decision.md)
11. [Context View 示例](./09-context-view-example.md)
12. [架构决策](./decisions.md)
13. [Rust Workspace 实现映射](./11-rust-workspace.md)
14. [Source Normalizer 扩展系统](./12-source-normalizers.md)
15. [分层管理端](./13-admin-control-plane.md)


## 一句话边界

```txt
Source / Structure / Evidence / Fact 是资料拆解链。
Scope Graph 是横切范围坐标网。
Semantic Graph 是事实含义关系网。
.context 是面向 Agent 工具的 cleaned source 工作区。
AGENTS.md / .claude / .codex 是引导 Agent 使用 context() 和 .context/sources 的根目录入口。
context() 是关联查询和动态工作视图入口。
```
