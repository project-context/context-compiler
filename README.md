# Context Compiler Next

这是 Context Compiler 的 Rust 实现仓库。

目标是设计一个面向 AI Agent 的项目上下文编译器：把大量杂乱的人类项目资料编译成可查询、可追溯、可逐步取证、可更新的项目上下文。

仓库采用虚拟 Cargo Workspace。Source、Normalizer、Structure、Evidence、Fact、Scope、Semantic、Workspace、Store、Compiler、Query、CLI 和 MCP 各自拥有独立 crate、公共 API、Schema 与测试。

## 技术基线

- Rust 1.93.0、Edition 2024、Tokio。
- SQLx 0.8.6 + SQLite/FTS5。SQLx 0.9 的 MSRV 是 Rust 1.94，因此本仓库固定使用兼容 Rust 1.93 的 0.8.6。
- Serde + Schemars 1.2、Clap、rmcp。
- pulldown-cmark 与 tree-sitter-typescript。

核心约束仍然是：

- Source / Structure / Evidence / Fact 是资料拆解链。
- Scope Graph 是横切层，切 Source、Structure、Evidence、Fact 的具体项。
- Semantic Graph 是独立关系网，只连接 FactRef 和 FactRef。
- `.context` 默认只放 cleaned sources，让 Agent 用 Read / Grep / Glob / Bash 核对原文。
- 事实、证据、Scope、语义关系和索引默认放在外部 store，通过 `context()` 查询和渐进展开。
- 各层只依赖稳定公共 API；canonical 层不依赖 SQLite 实现。
- Query 只读，CLI/MCP 不执行 SQL，processor 之间不互相依赖。

## 主要目录

- `protocol/` 到 `semantic/`：稳定分层协议、算法与内存 Store。
- `workspace/`、`store-sqlite/`：工作区身份、外部存储和 canonical persistence。
- `connectors/`：可整体迁移的独立 Cargo Workspace，包含 Source Connector 核心协议、Local 与 Git 实现。
- `normalizers/`：可整体迁移的独立 Cargo Workspace，包含平台无关核心 API 和一排 A→B 转换器；当前包含 Markdown、TypeScript、HTML、Text→Markdown、PDF→Markdown 与 PDF→HTML。
- `structure-parsers/`：可整体扩展的 Structure Parser crates；当前提供 Markdown AST 与 Tree-sitter TypeScript。
- `processor-markdown/`、`processor-typescript/`：消费 Resolver 结果的 Evidence / Fact 处理器，不再负责 Structure 构建。
- `compiler/`、`query/`：增量构建、失效传播、语义连接与 Context View。
- `cli/`、`mcp-server/`：`context` 命令和单一 `context()` MCP 工具。
- `admin-backend/`、`admin-web/`：单一 Rust 管理后端（内部按 service/api/persistence/web 分模块）和 React 管理前端。
- `test-support/`：退款 fixture、内存 Store 集合和 Schema 生成器。
- `docs/`：权威理论设计；`design-lab/`：设计实验。

阅读入口见 [docs/README.md](./docs/README.md)。

## 开发命令

```bash
just fmt
just lint
just test source
just test-normalizer html
just test scope
just test-all
just write-schemas
```

CLI 第一版：

```bash
cargo run -p context-cli -- build --json
cargo run -p context-cli -- status
cargo run -p context-cli -- doctor --json
cargo run -p context-cli -- admin
```

`context admin` 默认只监听 `127.0.0.1:7799`。开发管理端时，在 `admin-web/` 运行 `npm run dev`，访问 `http://127.0.0.1:7798`；Vite 会把 `/api`、`/docs` 和 `/openapi.json` 代理到 `http://127.0.0.1:7799`。生产构建继续由后端在 `7799` 同源托管嵌入式前端，不需要 Node.js。

管理端以 Workspace → Sources → Normalize → Structure → Evidence → Fact → Semantic → Project 全局流水线为主工作台；Scope 不作为独立流程节点，而是横切 Source、Structure、Evidence、Fact。顶部提供默认增量“运行流水线”，每个节点提供“仅运行此步”和“运行至此”，后端通过 `fromStage` / `toStage` 严格限制执行范围；运行历史持久化范围、模式、事件与结果。标准化自动匹配最佳转换路线；Structure 按文件族分组展示格式，并允许为单个标准化后缀选择兼容 Parser。
