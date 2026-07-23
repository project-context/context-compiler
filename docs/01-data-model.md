# 数据模型

## 总体分层

当前稳定分层是：

```txt
Source Layer
  资料清单层。

Structure Layer
  结构层。

Evidence Layer
  证据层。

Fact Layer
  事实层。

Scope Graph
  横切范围层。

Semantic Graph
  事实语义关系层。
```

前四层是一条资料拆解链。

Scope Graph 横切这条链。

Semantic Graph 基于 FactRef 建独立关系网。

## Source Layer

Source 层回答：

```txt
资料是什么？
来自哪里？
哪个版本？
是否还能访问？
如何重新读取？
有没有面向 Agent 和解析器的规范化可读投影？
```

核心对象：

```txt
SourceRecord
  资料稳定身份。

SourceSnapshot
  某次内容快照。

NormalizedSource
  某个 SourceSnapshot 的规范化可读投影。
  给 Structure 解析、Evidence 定位和 Agent Read/Grep 使用。

SourceRef
  对来源或来源快照的引用。
```

Source 可以来自本地文件、Git 仓库、飞书、钉钉、腾讯文档、GitLab、数据库、运行平台等。

Source 层不直接抽业务结论，但可以产生 Scope 线索。

Source 类型不能使用封闭枚举表达。输入格式和标准格式都使用可扩展的 `FormatId`；`.docx`、`.pdf`、`.html` 只是发现和路由信号，真正的 A→B 转换能力由 `normalizers/` 独立 Workspace 中的平台无关 `Normalizer` 实现提供。

## NormalizedSource

`NormalizedSource` 是 Source 层必须产出的标准化结果。

它不替代原始资料，而是给系统和 Agent 一个稳定、可读、可追溯的投影。

不同类型资料的原则：

```txt
源码仓库:
  源码原样保留。
  不默认把 .java / .ts / .py / .html / .css / .js 转成 Markdown。
  Tree-sitter 解析结果进入 Structure 层，不替代源码。

Markdown / txt:
  基本原样保留。
  可以统一编码、换行、frontmatter 和路径。

PDF / PPT / DOC / 图片:
  生成 Markdown 或 HTML 规范化版本。
  保留页码、slide、bbox、OCR 区域、图片引用和资产路径。

Excel / CSV:
  小表可以生成 Markdown。
  大表应生成 HTML、CSV 分片、SQLite/parquet 等可查询投影，并提供 Markdown 目录页。

OpenAPI / JSON / YAML:
  原样保留，同时生成可读 Markdown 摘要或索引页。
```

`NormalizedSource` 必须保留映射：

```txt
normalized location
  -> original source locator
  -> SourceSnapshot
```

例如：

```txt
.context/sources/feishu/commerce-space/refund-policy/normalized.md#page-3-block-7
  -> original: refund-policy.pdf page=3 bbox=[...]
  -> sourceSnapshot: sha256:...
```

这样后续链路才能闭环：

```txt
EvidenceRef
  -> NormalizedSource location
  -> Original source locator
  -> SourceSnapshot
  -> SourceRecord
```

`NormalizedSource` 还必须明确记录：

```txt
format
mediaType
extension
agentFileProfile
normalizerId
normalizer ProducerRef
primary NormalizedArtifact
companions NormalizedArtifact[]
locatorMap NormalizedArtifact?
sourceSnapshot
```

`NormalizedSource` 不保存正文。`NormalizedArtifact` 保存 content-addressed `ArtifactRef`、角色、media type、格式、扩展名、hash 和字节数；正文只存在 Artifact Repository。同一个 SourceSnapshot 可以因为不同 Normalizer 路线产生不同的标准化逻辑身份。标准化身份必须包含 Normalizer ID，防止 `pdf→html` 与 `pdf→markdown` 错误复用 revision。

`.context/sources` 就是 `SourceRecord + SourceSnapshot + NormalizedSource` 的文件化投影。

## Structure Layer

Structure 层回答：

```txt
这个资料内部怎么分块？
哪里是章节、函数、接口、表格、单元格、页面区域？
```

结构可以完全按类型实现：

```txt
代码:
  Tree-sitter AST、符号、调用、控制流片段。

Markdown:
  标题树、段落、列表、表格、代码块。

PDF:
  页面、文本块、bbox、OCR 区域。

Excel:
  workbook、sheet、table、row、cell。

OpenAPI:
  path、operation、schema、field。
```

对外统一的是：

```txt
StructureRef
StructureResolver
ResolvedStructureView
```

## Evidence Layer

Evidence 层回答：

```txt
哪一块原文或局部结构可以支撑一个事实或关系？
```

证据不要求内部统一。

不同资料可以有：

```txt
CodeEvidenceUnit
MDEvidenceUnit
PDFEvidenceUnit
TableEvidenceUnit
OpenApiEvidenceUnit
```

对外统一的是：

```txt
EvidenceRef
EvidenceResolver
ResolvedEvidenceView
```

证据必须能追到：

```txt
EvidenceRef
  -> StructureRef
  -> SourceRef
```

一个 Evidence 可以产生 0、1 或多个 Fact。

一个 Fact 必须至少有一个 Evidence。

## Fact Layer

Fact 层回答：

```txt
项目资料中有哪些可验证的小事实？
```

事实是维度无关的。

事实可以是：

```txt
代码符号存在
函数调用关系
接口 operation
字段约束
业务规则
测试用例
配置项
表格记录
文档声明
```

对外统一的是：

```txt
FactRef
FactResolver
ResolvedFactView
```

Fact 必须能追到证据：

```txt
FactRef
  -> EvidenceRef[]
  -> StructureRef[]
  -> SourceRef[]
```

## Scope Graph 横切

Scope 层不是事实层之后的标签表。

Scope 可以挂在任意具体项上：

```txt
SourceRef
StructureRef
EvidenceRef
FactRef
```

标准对象：

```txt
Scope
ScopeAssignment
ScopeRelation
EffectiveScope
```

详见 [Scope Graph](./02-scope-graph.md)。

## Semantic Graph 独立

Semantic Graph 只连接 FactRef：

```txt
SemanticEdge:
  FactRef -> FactRef
```

它表达：

```txt
描述
实现
验证
约束
依赖
影响
支持
反驳
冲突
相似
替代
废弃
```

详见 [Semantic Graph](./03-semantic-graph.md)。

## 查询时的引用链

查询某个事实时，可以沿链拿到全部上下文：

```txt
FactRef
  -> EvidenceRef
  -> StructureRef
  -> SourceRef
```

再横向计算 Scope：

```txt
FactRef scope assignments
EvidenceRef scope assignments
StructureRef scope assignments
SourceRef scope assignments
ScopeRelation closure
```

再跳语义：

```txt
FactRef
  -> SemanticEdge
  -> Neighbor FactRef
```

这三件事要分开存，查询时组合。
