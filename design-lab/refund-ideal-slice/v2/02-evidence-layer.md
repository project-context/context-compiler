# 02 Evidence Layer

本文件重构证据层设计。

核心结论：

```txt
证据层不是一套统一 EvidenceUnit 数据表。

证据层 = 类型处理器的证据提取能力 + 对外标准证据访问协议。
```

也就是说：

```txt
TS 可以有 CodeEvidenceUnit。
Markdown 可以有 MDEvidenceUnit。
PDF 可以有 PDFEvidenceUnit。
DOC 可以有 DOCEvidenceUnit。
XLS 可以有 TableEvidenceUnit。

它们内部字段、定位方式、上下文读取方式都可以不同。

但对外必须提供同一组能力：
  可引用
  可追溯
  可失效
  可展开
```

## 处理矩阵

| 分类 / 类型 | TS | MD | PDF | DOC | XLS |
|---|---|---|---|---|---|
| 清单层 | 通用 | 通用 | 通用 | 通用 | 通用 |
| 结构层 | Tree-sitter 实现 | Markdown AST 实现 | Layout/OCR 实现 | DOC 结构实现 | Sheet/Table 实现 |
| 证据层 | Code evidence | MD evidence | PDF evidence | DOC evidence | Table evidence |
| 事实层 | Code facts | Rule facts | Doc facts | Doc facts | Table facts |
| Scope 信号入口 | Path/package | Title/path | Cover/meta | Cover/meta | Sheet/header |

这张表说明：

```txt
证据层的内部实现继续按类型分裂。
事实层不直接读这些私有证据结构。
事实层只拿 EvidenceRef，并通过 EvidenceResolver 按需解析。
Scope 层本身是标准图层；表格里这一行只表示各类型证据可给 ScopeAssignment 提供什么局部信号。
```

## 横向标准原则

横向标准不是统一 EvidenceUnit 字段。

横向标准是统一能力协议。

```txt
内部多态。
外部协议统一。
```

不同类型的内部证据可以完全不同：

```txt
CodeEvidenceUnit:
  source range、symbol path、AST node、snippet、language。

MDEvidenceUnit:
  heading path、line range、paragraph、markdown node。

PDFEvidenceUnit:
  page、bbox、OCR text、layout block、confidence。

DOCEvidenceUnit:
  section path、paragraph id、table id、comment id、style。

TableEvidenceUnit:
  sheet、table、row、column、cell range、header mapping。
```

但每个对外结果都必须具备：

```txt
引用:
  能被 EvidenceRef 引用。

追溯:
  能追到 source、snapshot、structureRef、extractor。

失效:
  能说明依赖什么，结构变化或 extractor 变化后能判断是否 stale。

展开:
  能继续展开原文、上下文、结构位置、相邻证据。
```

## 证据层回答什么

证据层只回答：

```txt
哪一段原始材料可以作为依据？
这段依据来自哪个结构位置？
这段依据如何重新定位和复读？
这段依据由哪个 extractor 生成？
这段依据是否仍然有效？
这段依据可以如何展开上下文？
```

证据层不回答：

```txt
这段依据表达了什么事实？
这个事实属于哪个系统、服务、团队、版本？
这段代码是否实现了某条业务规则？
这条测试是否验证了某条约束？
```

这些问题属于事实层、Scope 层和语义层。

## 证据层产物

证据层不定义统一的 canonical `EvidenceUnit` 字段。

它只定义少量横向契约：

```txt
EvidenceBuildRecord
  某次结构构建上运行某个证据 extractor 的记录。

InternalEvidenceSet
  类型处理器私有的证据集合。

EvidenceRef
  对外引用某个证据单元的地址。

ResolvedEvidenceView
  通过接口解析出来的证据视图。

EvidenceResolver
  标准访问接口。

MaterializedEvidenceIndex
  查询缓存和加速索引，不是 canonical schema。
```

## EvidenceBuildRecord

`EvidenceBuildRecord` 是证据抽取的一次运行记录。

它绑定：

```txt
StructureBuildRecord
EvidenceExtractor
内部证据集合存储位置
整体指纹
运行状态
```

示例：

```json
{
  "id": "evidenceBuild:md:refund-rules:sha256-demo",
  "recordType": "EvidenceBuildRecord",
  "structureBuildRef": "structureBuild:snapshot:doc:refund-rules:sha256-demo",
  "sourceType": "md",
  "extractor": {
    "name": "MDEvidenceExtractor",
    "version": "0.1.0",
    "configHash": "sha256:evidence-config-demo"
  },
  "internalEvidenceRef": "internalEvidence:md:refund-rules:sha256-demo",
  "inputFingerprint": "sha256:structure-build-demo",
  "fingerprint": "sha256:evidence-build-demo",
  "status": "extracted"
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `id` | 证据构建记录 ID | 一次 evidence extractor 运行一个记录。 |
| `recordType` | 记录类型 | 固定为 `EvidenceBuildRecord`。 |
| `structureBuildRef` | 输入结构构建 | 指向 StructureBuildRecord。 |
| `sourceType` | 资料类型 | ts、md、pdf、doc、xls 等。 |
| `extractor` | 证据抽取器 | 版本和配置进入增量判断。 |
| `internalEvidenceRef` | 内部证据集合引用 | 指向类型处理器私有存储。 |
| `inputFingerprint` | 输入指纹 | 通常来自结构构建结果。 |
| `fingerprint` | 证据集合整体指纹 | 用于判断证据集合是否变化。 |
| `status` | 构建状态 | extracted、partial、failed、skipped、stale。 |

`EvidenceBuildRecord` 是证据层的上下文根。

每个内部证据单元不需要重复 extractor、source、snapshot 等上下文。

## InternalEvidenceSet

`InternalEvidenceSet` 是类型处理器私有证据集合。

它不是横向标准对象。

不同资料类型可以完全不同。

例子：

```txt
CodeEvidenceSet:
  CodeEvidenceUnit[]
  source ranges
  symbol paths
  AST node refs
  code snippets
  language metadata

MDEvidenceSet:
  MDEvidenceUnit[]
  heading paths
  line ranges
  markdown node refs
  paragraph text

PDFEvidenceSet:
  PDFEvidenceUnit[]
  page regions
  OCR text
  bbox
  OCR confidence

DOCEvidenceSet:
  DOCEvidenceUnit[]
  paragraph ids
  section paths
  table refs
  comments

TableEvidenceSet:
  TableEvidenceUnit[]
  sheet refs
  row ids
  column refs
  cell ranges
```

要求只有一个：

```txt
必须能被该类型的 EvidenceResolver 解析。
```

不要求所有 InternalEvidenceSet 使用同样字段。

## EvidenceRef

`EvidenceRef` 是证据层对外的标准引用。

它引用的是：

```txt
某次证据构建中的某个内部证据单元。
```

示例：

```json
{
  "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
  "unitId": "md:evidence:amount-limit"
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `buildRef` | 证据构建记录 | 指向 EvidenceBuildRecord。 |
| `unitId` | 内部证据单元 ID | build 内局部 ID。 |

`unitId` 不需要全局唯一，因为 `buildRef` 已经提供上下文。

事实层、Scope 层和语义层都不应该复制证据内容。

它们只保存：

```txt
EvidenceRef
```

需要内容时再调用：

```txt
resolveEvidence(evidenceRef)
```

## EvidenceResolver

`EvidenceResolver` 是证据层真正的横向标准。

不同类型 processor 都要实现它。

```txt
listEvidence(evidenceBuildRef, filter)
extractEvidence(structureRef, options)
resolveEvidence(evidenceRef)
getEvidenceContext(evidenceRef, options)
fingerprint(evidenceRef)
invalidate(changeSet)
```

接口含义：

| 接口 | 作用 |
|---|---|
| `listEvidence` | 列出某次证据构建暴露的证据引用。 |
| `extractEvidence` | 从结构引用中生成内部证据单元，并返回 EvidenceRef。 |
| `resolveEvidence` | 把 EvidenceRef 解析成可读、可定位、可展开的证据视图。 |
| `getEvidenceContext` | 获取证据周围上下文。 |
| `fingerprint` | 返回证据当前内容指纹。 |
| `invalidate` | 根据 SourceSnapshot、StructureBuild 或 extractor 变化判断失效范围。 |

事实层不直接读 MD/TS/PDF/DOC/XLS 的私有证据结构。

事实层只调用：

```txt
resolveEvidence(evidenceRef)
getEvidenceContext(evidenceRef)
```

## ResolvedEvidenceView

`resolveEvidence(evidenceRef)` 返回的是视图，不是 canonical 内部证据对象。

视图可以包含冗余字段，因为它是接口结果。

示例：

```json
{
  "ref": {
    "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
    "unitId": "md:evidence:amount-limit"
  },
  "evidenceKind": "md_text_span",
  "locator": {
    "kind": "line_range",
    "uri": "raw/product-refund-rules.md",
    "startLine": 11,
    "endLine": 11,
    "headingPath": ["订单部分退款"]
  },
  "content": {
    "text": "退款金额不能超过订单当前可退余额。"
  },
  "context": {
    "parent": "订单部分退款",
    "before": "用户可以对已支付且未完全退款的订单发起部分退款。",
    "after": "可退余额 = 实付金额 - 已退款金额。"
  },
  "trace": {
    "sourceRef": "source:doc:refund-rules",
    "snapshotRef": "snapshot:doc:refund-rules:sha256-demo",
    "structureRef": {
      "kind": "unit",
      "buildRef": "structureBuild:snapshot:doc:refund-rules:sha256-demo",
      "unitId": "md:p:amount-limit"
    },
    "evidenceBuildRef": "evidenceBuild:md:refund-rules:sha256-demo",
    "extractor": "MDEvidenceExtractor@0.1.0"
  },
  "validity": {
    "status": "observed",
    "fingerprint": "sha256:evidence-content-amount-limit"
  },
  "expansion": {
    "available": ["source", "structure", "parent", "siblings", "raw"]
  },
  "payload": {
    "markdownNodeKind": "paragraph"
  }
}
```

`ResolvedEvidenceView` 是对外视图协议。

它可以包含标准外壳：

```txt
ref
evidenceKind
locator
content
trace
validity
expansion
payload
```

其中 `payload` 可以按类型不同。

## 证据粒度

证据粒度要比结构单元更接近事实，但还不是事实。

原则：

```txt
足够小:
  能支撑或反驳一个局部事实。

足够大:
  保留必要上下文，不让事实抽取断章取义。

可定位:
  能重新找到原始内容。

可复读:
  能重新读取同一份 SourceSnapshot 中的内容。
```

关系约束：

```txt
StructureRef -> EvidenceRef 是 1 -> 0..N
EvidenceRef -> FactRef 是 1 -> 0..N
FactRef -> EvidenceRef 是 1 -> 1..N
```

一个结构单元可以没有证据。

一个结构单元也可以切出多个证据。

一个证据引用可以产生 0、1 或多个事实。

一个事实必须至少引用一个证据。

## 类型粒度建议

| 类型 | 证据粒度 | 例子 |
|---|---|---|
| TS | 函数片段、条件片段、throw 片段、调用片段 | `if (request.amount > refundableAmount) throw ...` |
| MD | 句子、段落、表格行、章节中的局部规则 | “退款金额不能超过订单当前可退余额。” |
| PDF | OCR 文本块、页内区域、表格区域 | 第 3 页某个规则块 |
| DOC | 段落、表格行、批注、标题下局部内容 | “v2.3 起订单服务负责校验可退余额” |
| XLS | 行、关键单元格范围、表格区域 | `TC-REFUND-002` 这一行 |

## 类型实现示例

### MD evidence

内部证据可以是：

```json
{
  "id": "md:evidence:amount-limit",
  "recordType": "MDEvidenceUnit",
  "structureEntryId": "md:section:partial-refund",
  "headingPath": ["订单部分退款"],
  "lineRange": [11, 11],
  "text": "退款金额不能超过订单当前可退余额。",
  "fingerprint": "sha256:evidence-content-amount-limit"
}
```

对外只暴露：

```json
{
  "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
  "unitId": "md:evidence:amount-limit"
}
```

### Code evidence

内部证据可以是：

```json
{
  "id": "code:evidence:amount-check",
  "recordType": "CodeEvidenceUnit",
  "structureEntryId": "ts:condition:amount-gt-refundable",
  "symbolPath": ["refundOrder"],
  "sourceRange": [25, 27],
  "snippet": "if (request.amount > refundableAmount) { throw new RefundError(\"REFUND_AMOUNT_EXCEEDS_BALANCE\"); }",
  "astNodeRef": "tree-sitter:node:binary_expression:demo",
  "fingerprint": "sha256:evidence-content-code-amount-check"
}
```

对外只暴露：

```json
{
  "buildRef": "evidenceBuild:code:refund-service:sha256-demo",
  "unitId": "code:evidence:amount-check"
}
```

### PDF evidence

内部证据可以是：

```json
{
  "id": "pdf:evidence:refund-rule-block",
  "recordType": "PDFEvidenceUnit",
  "page": 3,
  "bbox": {
    "x": 120,
    "y": 240,
    "width": 360,
    "height": 80
  },
  "ocrText": "退款金额不能超过可退余额",
  "ocrConfidence": 0.92,
  "fingerprint": "sha256:evidence-content-pdf-refund-rule"
}
```

对外只暴露：

```json
{
  "buildRef": "evidenceBuild:pdf:refund-policy:sha256-demo",
  "unitId": "pdf:evidence:refund-rule-block"
}
```

### Table evidence

内部证据可以是：

```json
{
  "id": "table:evidence:TC-REFUND-002",
  "recordType": "TableEvidenceUnit",
  "sheet": null,
  "rowKey": "TC-REFUND-002",
  "rowIndex": 3,
  "cells": {
    "case_id": "TC-REFUND-002",
    "title": "超过可退余额失败",
    "precondition": "paidAmount=100 refundedAmount=20",
    "request_amount": "90",
    "expected": "REFUND_AMOUNT_EXCEEDS_BALANCE"
  },
  "fingerprint": "sha256:evidence-content-test-row-002"
}
```

对外只暴露：

```json
{
  "buildRef": "evidenceBuild:table:refund-cases:sha256-demo",
  "unitId": "table:evidence:TC-REFUND-002"
}
```

## 支撑和反驳不是内部证据本身

内部证据单元只表示证据内容和定位。

它不直接声明自己支撑或反驳哪个事实。

支撑关系由事实层或后续层建立：

```txt
FactRef
  evidenceRefs:
    - EvidenceRef
```

或者显式引用关系：

```json
{
  "targetRef": {
    "layer": "fact",
    "id": "fact:rule:refund-amount-limit"
  },
  "evidenceRef": {
    "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
    "unitId": "md:evidence:amount-limit"
  },
  "role": "supports"
}
```

同一 EvidenceRef 可以支持多个事实。

同一 EvidenceRef 也可能在另一个上下文中反驳某个候选事实。

## MaterializedEvidenceIndex

证据索引可以很宽，因为它是查询缓存，不是 canonical schema。

示例：

```json
{
  "evidenceRef": {
    "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
    "unitId": "md:evidence:amount-limit"
  },
  "sourceRef": "source:doc:refund-rules",
  "snapshotRef": "snapshot:doc:refund-rules:sha256-demo",
  "evidenceKind": "md_text_span",
  "locator": {
    "kind": "line_range",
    "uri": "raw/product-refund-rules.md",
    "startLine": 11,
    "endLine": 11
  },
  "textPreview": "退款金额不能超过订单当前可退余额。",
  "fingerprint": "sha256:evidence-content-amount-limit"
}
```

索引用于搜索和展示。

事实层、Scope 层、语义层的权威追溯必须回到 EvidenceRef 和 EvidenceResolver。

## 对事实层的约束

事实层同样不应该被设计成统一内部事实表。

更合理是：

```txt
CodeFact
RuleFact
DocFact
TableFact
```

这些可以由类型 processor 内部实现。

但事实层也必须提供：

```txt
FactRef
FactResolver
ResolvedFactView
```

Scope 层和语义层不直接读取 CodeFact、RuleFact、TableFact 的私有字段。

它们引用：

```txt
FactRef
```

然后通过 resolver 按需获取事实视图。

## Scope 和语义为什么不同

Scope 层和语义层不是普通类型处理器的内部产物。

它们是跨事实推断和推理得出的结论层。

所以它们需要标准化。

```txt
Scope 层:
  Scope
  ScopeAssignment
  ScopeRelation

语义层:
  SemanticEdge
```

Scope 层和语义层引用事实时，引用的是：

```txt
FactRef
```

不是某个具体的 CodeFact 或 RuleFact 内部对象。

## 增量更新

证据层增量更新分两级。

### Build 级

缓存键：

```txt
structureBuildRef
extractor.name
extractor.version
extractor.configHash
inputFingerprint
```

如果结构构建没有变化，且 extractor 版本和配置没有变化：

```txt
证据层可以直接跳过。
```

### Unit 级

如果结构有局部变化，类型 processor 自己判断哪些内部证据单元可复用。

横向要求只需要输出：

```txt
changed evidenceRefs
stale evidenceRefs
new evidenceRefs
unchanged evidenceRefs
```

每个 EvidenceRef 必须能回答：

```txt
fingerprint(evidenceRef)
status(evidenceRef)
dependencies(evidenceRef)
```

这样事实层可以只重建受影响的事实。

## 本层判断边界

可以在证据层判断：

- 这段原文或源码是否可重新定位。
- 这个结构单元可以切出多少证据引用。
- 证据内容的 hash 是否变化。
- OCR 或抽取过程的置信度是多少。
- 证据是否 stale、partial 或 invalidated。

不能在证据层判断：

- 这段内容表达了什么事实。
- 事实是否成立。
- 事实属于哪个 Scope。
- 代码是否实现了文档规则。
- 测试是否验证了业务约束。

证据层的价值是：

```txt
允许每种资料拥有自己的真实证据结构。
用统一 EvidenceRef / EvidenceResolver 把这些证据暴露给后续层。
不给事实层、Scope 层、语义层暴露类型私有对象。
```
