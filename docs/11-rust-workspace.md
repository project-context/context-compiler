# Rust Workspace 实现映射

理论模型保持语言无关，当前实现采用 Rust 1.93.0、Edition 2024 的虚拟 Cargo Workspace。每层单独一个 crate，crate 根只导出稳定 API，内部模块默认私有。

## 分层映射

```txt
agent-file-normalizer (独立 normalizers/ Workspace)
  -> context-source adapter
    -> context-protocol / SourceSnapshot / NormalizedSource
    -> context-structure
      -> context-evidence
        -> context-fact

context-scope      横切 RevisionRef lineage
context-semantic   只连接 FactRef
context-query      只依赖 Reader API
context-compiler   负责构建计划和失效编排
```

`normalizers/` 是被根 Workspace 排除的自包含子 Workspace，拥有自己的 Cargo.toml、Cargo.lock、toolchain、CI 和测试，可以整体迁移到独立仓库。它不依赖 Context Compiler。`context-source` 只提供平台适配，把通用输出接入 RevisionRef、Locator 和 canonical store。

`connectors/` 使用同样的自包含 Workspace 结构，定义平台无关的 `SourceConnectorFactory` / `SourceConnector` 契约，并提供 Local、Git 实现。Connector 只发现与捕获原始 bytes；转换路由和 Context 身份由宿主层适配，因此该目录也可以整体拆仓。

`context-store-sqlite` 实现各层 Store/Reader trait 和持久化事务；canonical crate 不包含 SQL。`structure-parsers/` 的 Markdown 与 TypeScript crates 只实现 Structure Parser；原有 processor 只消费 Resolver 输出并构建 Evidence / Fact。parser、processor 和 normalizer 之间均不互相依赖。

## API 边界

- 稳定逻辑身份使用 `EntityRef`，不可变内容版本使用 `RevisionRef`。
- Builder 可以产生 revision；Reader 只读；Store 保存 canonical record。
- 异步边界使用对象安全的 boxed future，不依赖 `async-trait`。
- Source 捕获保存原始 bytes，独立 `Normalizer` 负责解码或二进制解析；Context Compiler 不假设所有输入都是 UTF-8。
- `NormalizerRegistry` 按输入探测自动选择标准化路线；`StructureParserRegistry` 按保存的后缀路由创建 Parser；`ProcessorRegistry` 只为 Evidence / Fact 选择后续处理器。
- Evidence 和 Fact 保留全部父级引用；EffectiveScope 遍历全部 lineage 路径。
- Query 不写 canonical 数据；CLI 和 MCP 只调用 Compiler、Query、Workspace。

## 存储与入口

`.context/workspace.json` 只保存 workspaceId、schemaVersion 和 storeMode。默认数据库及 artifacts 按 workspaceId 位于外部 `CONTEXT_COMPILER_HOME`；portable 模式才放入 `.context/store`。

CLI 提供 `build`、`status`、`doctor`、`admin`。MCP 只暴露一个 `context()` 工具，输入为 `manifest | explore | expand` 判别联合。`context admin` 启动 Axum，将 React 生产资源嵌入 Rust 二进制，不要求最终用户安装 Node.js。

## 兼容性

所有公开 JSON 边界由 Schemars 生成版本化 fixture。`test-support` 的 Schema fixture 测试会拒绝未审查的协议变化。SQLx 固定为 0.8.6，因为 SQLx 0.9 的 MSRV 高于本项目固定的 Rust 1.93.0。
