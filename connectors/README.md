# Agent Source Connectors

这是一个可整体拆仓的独立 Cargo Workspace，负责发现与捕获异构数据源。Connector 只输出稳定 object key、元数据和原始 bytes，不依赖 Context Compiler 的 SourceRecord、数据库或编译层。

```txt
core/   agent-source-connector        公共协议、Schema、对象安全 trait
local/  agent-source-connector-local  glob、符号链接与大小策略
git/    agent-source-connector-git    本地仓库或 gix clone/checkout
```

新增实现只需作为同级 crate 实现 `SourceConnectorFactory` 与 `SourceConnector`。异构 `config` 是唯一开放 JSON Object 的扩展点，并由 `descriptor.configSchema` 验证；密码和 Token 只通过 `SecretRef` / `SecretProvider` 获取。

```bash
just check
just write-schema
```

Local Connector 对 capture stable key 做目录逃逸检查。Git Connector 的远程 checkout 目录由宿主注入，不属于公开配置；Context Compiler 将它定位到 Workspace 外部 `runtime/git/`，不会污染项目目录。
