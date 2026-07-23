# 分层管理端

管理端是 Context Compiler 的本地单用户控制面，不是第二套数据模型。它只通过各层公开 Reader/Store、Compiler、Query 与 Workspace API 工作，React 前端只调用 REST/SSE。

```txt
context.config.json
  -> Connector / Normalizer Registry
  -> Compiler Build Job
  -> Source -> Structure -> Evidence -> Fact -> Semantic
       \---------- Scope 横切 ----------/
  -> Admin Service -> REST / OpenAPI / SSE -> React
```

## Crate 边界

- `context-admin-backend`：唯一的 Rust 管理后端 crate；内部 `service` 管理 DTO/Job/审核，`api` 管理 Axum/OpenAPI/SSE，根模块组合 SQLite、Connector、Normalizer、Compiler、Query 和嵌入式前端资源。
- `admin-web`：独立 React + TypeScript + Vite 管理前端，只通过 REST/SSE 使用后端；开发服务器固定监听 `127.0.0.1:7798`，把 `/api`、`/docs` 和 `/openapi.json` 代理到 `127.0.0.1:7799`；生产时编译进 Rust 二进制并由后端在 `7799` 同源托管。

管理端不直接编辑 Structure、Evidence、Fact。用户可以运行默认增量流水线，也可以创建有明确 `fromStage` / `toStage` 边界的节点任务；单步任务只能读取上游 canonical 产物并写当前层，不能绕过 Compiler 手工修改派生数据。

## 配置与安全

`.context/workspace.json` 只保存身份；`context.config.json` 是数据源和转换路由的 canonical 配置。配置保存必须携带 ETag/`If-Match`，缺失返回 428，版本冲突返回 409。Connector 的 JSON 配置由各实现 Schema 验证，Secret 只保存 `SecretRef`。删除数据源是可恢复的软删除：活动定义从 `sources` 移入 `sourceTrash`，记录独立 `trashId` 和 `deletedAtMs`；历史 revision、审核记录与转换配置不被清除，还原时将原定义重新放回活动列表。

服务拒绝非 loopback 监听。写请求必须携带会话 CSRF token；API、日志和配置不返回明文凭据。Local Connector 拒绝通过 stable key 进行目录穿越，Git checkout 由服务放在 Workspace 外部 runtime 目录。

## Build 与审核

同一 Workspace 同时只有一个写任务。Job 和事件写入对应 Workspace SQLite；SSE 按递增 sequence 持久化并支持 `Last-Event-ID` 重放。服务启动会把遗留的 queued/running/cancelling 状态改为 `interrupted`，不自动续跑。

候选审核在写入前验证全部 `expectedStatus`，随后在一个 SQLite 事务内更新 Scope/Semantic 状态、追加 `ScopeDecision` 和不可变 `review_audit`。任一状态不符则整批返回 409。

## 页面与 API

`context admin` 的主入口是全局流水线工作台：Workspace → Sources → Normalize → Structure → Evidence → Fact → Semantic → Project。Scope crate 仍保存标准 Scope Graph，但管理端不把它表现成独立顺序节点；数据源节点提供“配置、Scope、回收站、日志”Tab，其中回收站按删除时间倒序展示并可一键还原。后续细粒度层依靠自动推断，不提供批量人工 Scope/审核入口。节点操作不会切换到另一个全局页面。顶部只保留“运行流水线”，表示从 Source 到 Project 的默认增量运行。节点内的“仅运行此步”复用上一层 canonical 产物并令 `fromStage == toStage`；“运行至此”从 Source 开始并以当前节点作为 `toStage`。“运行历史”保存执行范围、模式、SSE 事件与结果。

“产物”不是跨层通用表格，而是按数据形态选择视图：Source 按数据源分组显示原始文件树；Normalized Source 显示同样的文件树，点击文件后通过 `POST /artifacts/preview` 和 Artifact Reader 限量读取主 Artifact，提供文本、源码或沙箱 HTML 预览，不从 SQLite payload 读取正文；Structure、Evidence、Fact、Semantic 按标准化文件切换 Graph。Structure Graph 只分页加载当前文件的 units / relations，点击节点再经 Resolver 读取正文、Locator、Trace 和相邻关系。所有 Graph 都可按 EffectiveScope 过滤。

Structure 配置按固定文件族分组展示，标签自动换行：代码文件、文档、标记与样式、配置与结构化数据、表格、富文档、其他。分组不参与路由，保存配置时仍保证一个标准化后缀只对应一个 Parser；无兼容 Parser 的格式显示明确缺失状态，但不会阻断其他格式。

“Scope”使用两层清单而不是 Graph：第一层固定为标准化文件，第二层列出当前层属于该文件的节点。每一行直接显示人工、自动推断和继承标签；选择一行后展示完整 Scope 来源、冲突和人工设置表单。Semantic/Project 只读复用 Fact EffectiveScope，避免把 Scope 复制进 SemanticEdge 或索引记录。

横切 Scope 使用 `GET /scope/context` 按具体 revision 计算直接归属、继承值与冲突；`POST /scope/assignments` 只创建带人工 producer 的 confirmed assignment。自动 proposer 只能写 candidate，必须走统一审核接口；人工和自动归属都保存在 Scope Graph，不复制到 Source / Structure / Evidence / Fact 的内部字段。

标准化节点只展示后端 Registry 返回的官方转换器目录。用户通过勾选选择主转换器；同一输入格式只能保留一个主输出，例如 PDF→Markdown 与 PDF→HTML 二选一。高级路由仍由类型化配置协议承载，不要求用户手写 Normalizer ID。

辅助菜单提供 Workspace 注册切换、历史运行、各层分页浏览、lineage、候选审核、Context 实验室和 `/docs` OpenAPI 测试页。

所有列表使用不透明 keyset cursor，默认 50、最大 200。SQLite Store 与内存 Store 共享同一套 CatalogReader 契约；跨层 lineage 只在管理服务组合，不下沉到某个 canonical 层。
