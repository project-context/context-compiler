# Context Compiler Next

这是 Context Compiler 的下一代架构设计仓库。

目标是设计一个面向 AI Agent 的项目上下文编译器：把大量杂乱的人类项目资料编译成可查询、可追溯、可逐步取证、可更新的项目上下文。

当前只沉淀语言无关的架构文档，不预设工程包结构。实现未来可能采用 Rust + TypeScript，也可能继续调整。

## 当前阶段

当前阶段只保留文档和少量设计实验材料，不写实现代码。

核心约束：

- Source / Structure / Evidence / Fact 是资料拆解链。
- Scope Graph 是横切层，切 Source、Structure、Evidence、Fact 的具体项。
- Semantic Graph 是独立关系网，只连接 FactRef 和 FactRef。
- `.context` 默认只放 cleaned sources，让 Agent 用 Read / Grep / Glob / Bash 核对原文。
- 事实、证据、Scope、语义关系和索引默认放在外部 store，通过 `context()` 查询和渐进展开。
- 不提前冻结 Rust crate、TypeScript package、服务进程或存储形态。

## 目录

- `docs/`：当前权威架构文档。
- `design-lab/`：用于讨论和推演的实验样例。

阅读入口见 [docs/README.md](./docs/README.md)。
