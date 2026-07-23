# 架构决策

## 1. 采用 Rust 虚拟 Cargo Workspace

当前采用 Rust 1.93.0、Edition 2024 的虚拟 Cargo Workspace，每个稳定层和可替换实现使用独立 crate。

原因：

```txt
Rust 适合表达稳定协议、对象安全 trait、增量编排和单文件 CLI/MCP 分发。
独立 crate 可以强制单向依赖，并让每层和每种转换单独测试。
第一版不引入 TypeScript 运行时代码。
```

## 2. Scope 不是 Dimension

层名叫 Scope Graph。

Dimension 是 Scope 的分类轴。

```txt
Dimension: 系统
Scope: A电商平台
```

## 3. Scope 是横切层

ScopeAssignment 可以挂在：

```txt
SourceRef
StructureRef
EvidenceRef
FactRef
```

查询时计算 EffectiveScope。

## 4. Semantic Graph 独立

SemanticEdge 只允许：

```txt
FactRef -> FactRef
```

Scope 不作为语义边端点。

## 5. 继承 Scope，但不无脑继承

上层 Scope 可以向下传播，但必须带：

```txt
assignmentKind
propagation
status
confidence
basisRefs
```

内容混杂的 Source 不应该建立可继承 Scope。

## 6. 原文静态，关联动态

`.context/sources` 是默认 Agent 原文入口。

事实、证据、Scope、语义关系和索引默认不导出为 Markdown。

这些关联内容通过 `context()` 从外部 store 查询。

## 7. 低层类型私有

结构、证据、事实内部模型不强行统一。

统一的是：

```txt
Ref
Resolver
ResolvedView
Trace
Invalidation
Expansion
```

## 8. 事实必须有证据

没有 EvidenceRef 的内容不能进入 Fact。

语义边和 Scope 归属也必须能说明依据。

## 9. Source 层必须标准化

Source 层不仅登记原始来源，还要生成 `NormalizedSource`。

```txt
SourceRecord
SourceSnapshot
NormalizedSource
```

`.context/sources` 是这些对象的文件化投影。

源码尽量原样保留；PDF、PPT、DOC、图片、Excel 等需要生成 Markdown、HTML 或表格投影，并保留 normalized location 到原始来源 locator 的映射。

## 10. .context/sources 保留来源类型，但不加 connectors

采用：

```txt
.context/sources/gitlab/...
.context/sources/feishu/...
.context/sources/database/...
```

不采用：

```txt
.context/sources/connectors/gitlab/...
```

来源类型已经表达 connector 信息，不需要额外中间层。

## 11. Agent 入口放在 .context 同级

`.context` 是 cleaned source 工作区。

`AGENTS.md`、`.claude/`、`.codex/` 这类 Coding Agent 自动发现入口应该放在项目根目录，与 `.context` 同级。

这些文件只负责引导 Agent 使用 `context()` 和 `.context/sources`，不保存 canonical 项目知识。

## 12. CLI 命令叫 context

产品和系统名叫 Context Compiler。

用户日常 CLI 建议叫：

```txt
context
```

例如：

```txt
context build
context status
context doctor
```

`context-compiler` 保留为长别名、包名或 fallback，避免 `context` 命令冲突时没有退路。

CLI 命令 `context` 和动态关联工具 `context()` 要在文档中明确区分。

## 13. 第一版不需要 init

`init` 不进入第一版主流程。

首次运行：

```txt
context build
```

应自动创建：

```txt
.context/sources
AGENTS.md
.claude/
.codex/
```

如用户只要问答数据工作区，不想生成 Agent 自动发现入口，可以：

```txt
context build --no-agent
```

这样用户第一步只有一个命令，CLI 更轻。

## 14. 第一版 CLI 只有 build / status / doctor

最小第一版只做：

```txt
context build
context status
context doctor
```

后台自动更新机制和 `clean` 有价值，但进入后续阶段。

原因：

```txt
build 覆盖首次生成和重复编译。
status 覆盖日常查看。
doctor 覆盖诊断。
```

这三条命令已经能跑通从资料到外部 store 和 `.context/sources` 的最小闭环。

## 15. 自动更新是配置，不是 watch 命令

不把 `context watch` 作为主命令。

自动更新是工作区配置，默认开启：

```txt
autoUpdate.enabled = true
autoUpdate.mode = on_demand
```

用户可编辑配置放在工作区根目录：

```txt
context.config.json
```

manifest / health 是生成状态，可以放在外部 store 或 CLI 输出中，不默认写入 `.context`。

默认开启的含义：

```txt
context build 默认检测变化并增量刷新。
context status / context doctor 可以报告 stale 状态。
如果 context() runtime / MCP / Agent helper 正在运行，可以监听文件变化并自动更新。
不默认启动隐藏的全局后台 daemon。
```

## 16. 第一版存储采用外部 SQLite store + .context/sources

第一版采用：

```txt
.context/sources
external context.db
external indexes
external runtime
```

SQLite 保存：

```txt
canonical metadata
refs
ScopeAssignment / ScopeRelation
SemanticEdge
build state
corrections
user confirmations
```

文件系统保存：

```txt
NormalizedSource
Agent 可读 cleaned sources
```

`.context` 默认不保存 atlas、indexes、runtime、store 或 context.db。

如需离线迁移，可显式使用 portable 模式把 store 放到 `.context/.store`。

第一版不上图数据库、独立向量数据库、分布式存储或独立搜索服务。

## 17. Source 标准化采用配置路由 + 独立 Normalizer crate

Source 输入类型不使用封闭枚举。扩展名映射由仓库根目录的 `context.normalizers.json` 配置，但配置只能引用已注册的 `normalizerId`。

```txt
input extension
  -> registered SourceNormalizer
  -> NormalizedSource FormatId
  -> ProcessorRegistry
```

每一种 A→B 转换使用 `normalizers/` 独立 Workspace 内的单独 crate，实现、依赖和测试互不影响。该 Workspace 不依赖 Context Compiler，可以整体迁移到独立仓库；`context-source` 只是宿主适配层。Normalizer 接收原始 bytes，支持未来的 PDF、DOCX、图片等二进制转换。后续 Processor 按标准化输出格式选择，因此 `txt→markdown` 可以直接复用 Markdown Processor，`pdf→html` 可以复用未来的 HTML Processor。

## 18. ScopeAssignment 是范围归属推理系统

ScopeAssignment 构建不是简单分类器，也不是纯 LLM 抽取。

采用：

```txt
多路信号提取
+ Scope 候选归一
+ 语境识别
+ 保守裁决
+ 受控继承
+ EffectiveScope 派生索引
```

LLM 可以用于：

```txt
发现 ScopeMention
判断语境角色
生成候选 ScopeSignal
抽取文档事实
发现语义候选边
```

但 LLM 不直接写 confirmed ScopeAssignment。

词相似度、embedding 相似和 LLM same-as 判断也不直接 confirmed。

它们只能生成：

```txt
ScopeAliasCandidate
candidate_same_as
CandidateScopeAssignment
```

别名 confirmed 必须来自权威源、用户确认、强结构共现或规则裁决，并保留 basisRefs。

管理平台可以支持用户批量选择 Structure / Evidence / Fact，点击 LLM 识别生成候选 Scope。

但批量 LLM 识别只产生：

```txt
ScopeMention
ScopeSignal
ScopeAliasCandidate
CandidateScopeAssignment
```

用户手动修正并点击应用后，才写入：

```txt
ScopeDecision
ScopeAssignment
EffectiveScopeIndex refresh
```

批量设置 `propagation = inherit` 前必须展示下游影响范围。

confirmed 归属必须满足：

```txt
强依据
+ 明确适用
+ 范围单一
+ 同维度无强冲突
+ basisRefs 可追溯
```
