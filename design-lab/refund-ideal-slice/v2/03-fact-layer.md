# 03 Fact Layer

本文件设计事实层。

核心结论：

```txt
事实层不是一套统一内部事实表。

事实层 = 类型处理器的事实抽取能力 + 对外标准事实访问协议。
```

也就是说：

```txt
TS 可以有 CodeFact。
Markdown 可以有 RuleFact / DocFact。
OpenAPI 可以有 OpenApiFact。
PDF / DOC 可以有 DocFact。
XLS 可以有 TableFact。

它们内部字段、抽取策略、局部关系类型都可以不同。

但对外必须提供同一组能力：
  可引用
  可追溯
  可失效
  可展开
```

## 处理矩阵

| 分类 / 类型 | TS | MD | PDF | DOC | XLS | OpenAPI |
|---|---|---|---|---|---|---|
| 清单层 | 通用 | 通用 | 通用 | 通用 | 通用 | 通用 |
| 结构层 | Tree-sitter 实现 | Markdown AST 实现 | Layout/OCR 实现 | DOC 结构实现 | Sheet/Table 实现 | OpenAPI AST 实现 |
| 证据层 | Code evidence | MD evidence | PDF evidence | DOC evidence | Table evidence | OpenAPI evidence |
| 事实层 | Code facts | Rule/Doc facts | Doc facts | Doc facts | Table facts | API facts |
| Scope 信号入口 | Path/package | Title/path | Cover/meta | Cover/meta | Sheet/header | Server/path/tag |

这张表说明：

```txt
事实层的内部实现继续按资料类型分裂。
Scope 层和语义层不直接读这些私有事实结构。
Scope 层和语义层只拿 FactRef，并通过 FactResolver 按需解析。
Scope 层本身是标准图层；表格里这一行只表示各类型事实可给 ScopeAssignment 提供什么局部信号。
```

## 横向标准原则

横向标准不是统一事实字段。

横向标准是统一能力协议。

```txt
内部多态。
外部协议统一。
```

不同类型的内部事实可以完全不同：

```txt
CodeFact:
  function、class、field、call、throw、condition、route handler。

RuleFact:
  规则、限制、验收条件、适用条件、例外说明。

OpenApiFact:
  operation、request field、response field、error code、schema relation。

DocFact:
  决策、风险、流程步骤、责任说明、版本说明。

TableFact:
  测试用例、输入、前置条件、期望结果、表格记录。
```

但每个对外结果都必须具备：

```txt
引用:
  能被 FactRef 引用。

追溯:
  能追到 EvidenceRef、SourceSnapshot、StructureRef 和 extractor。

失效:
  能说明依赖什么，证据变化或 extractor 变化后能判断是否 stale。

展开:
  能继续展开证据、结构上下文、来源片段、局部关系。
```

## 事实层回答什么

事实层只回答：

```txt
资料里明确出现了哪些工程对象？
资料里明确出现了哪些局部关系？
这些事实由哪些 EvidenceRef 支撑？
事实当前状态、置信度和生成方法是什么？
事实是否仍然有效？
事实能展开到哪些证据、结构和来源片段？
```

事实层不回答：

```txt
这个事实属于哪个系统、团队、业务线、版本？
这个函数是否实现了某个业务能力？
这个测试是否验证了某条业务规则？
A 系统退款和 B 系统退款是不是同一个业务概念？
多个来源共同说明了什么业务结论？
```

这些问题属于 Scope 层和语义层。

## 什么是事实

事实是从证据中抽取出来的、局部可验证的工程内容。

它必须满足：

```txt
有证据:
  至少引用一个 EvidenceRef。

局部可验证:
  能回到原始资料复查。

尽量小:
  单独成立，便于后续组合、归属和语义连接。

不带范围推断:
  不把系统、团队、业务线等归属混进事实本体。
```

例子：

```txt
事实:
  函数 refundOrder 存在。
  函数 refundOrder 调用 calculateRefundableAmount。
  规则 退款金额不能超过订单当前可退余额。
  接口 POST /orders/{orderId}/refund 存在。
  请求字段 amount 表示退款金额。
  测试用例 TC-REFUND-002 期望错误码 REFUND_AMOUNT_EXCEEDS_BALANCE。

不是事实层该直接给出的结论:
  refundOrder 实现订单部分退款能力。
  TC-REFUND-002 验证退款金额不能超过可退余额。
  退款规则属于 A 电商平台订单服务。
```

上面后三条需要 Scope 或语义层根据事实和证据再建立关系。

## 事实层产物

事实层不定义统一的 canonical `Fact` 字段。

它只定义少量横向契约：

```txt
FactBuildRecord
  某次证据集合上运行某个事实 extractor 的记录。

InternalFactSet
  类型处理器私有的事实集合。

FactRef
  对外引用某个事实或局部事实关系的地址。

ResolvedFactView
  通过接口解析出来的事实视图。

FactResolver
  标准访问接口。

MaterializedFactIndex
  查询缓存和加速索引，不是 canonical schema。
```

## FactBuildRecord

`FactBuildRecord` 是事实抽取的一次运行记录。

它绑定：

```txt
EvidenceBuildRecord
FactExtractor
内部事实集合存储位置
输入指纹
整体指纹
运行状态
```

示例：

```json
{
  "id": "factBuild:md:refund-rules:sha256-demo",
  "recordType": "FactBuildRecord",
  "evidenceBuildRef": "evidenceBuild:md:refund-rules:sha256-demo",
  "sourceType": "md",
  "extractor": {
    "name": "MarkdownRuleFactExtractor",
    "version": "0.1.0",
    "configHash": "sha256:fact-config-demo"
  },
  "internalFactRef": "internalFact:md:refund-rules:sha256-demo",
  "inputFingerprint": "sha256:evidence-build-demo",
  "fingerprint": "sha256:fact-build-demo",
  "status": "extracted"
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `id` | 事实构建记录 ID | 一次 fact extractor 运行一个记录。 |
| `recordType` | 记录类型 | 固定为 `FactBuildRecord`。 |
| `evidenceBuildRef` | 输入证据构建 | 指向 EvidenceBuildRecord。 |
| `sourceType` | 资料类型 | ts、md、pdf、doc、xls、openapi 等。 |
| `extractor` | 事实抽取器 | 版本和配置进入增量判断。 |
| `internalFactRef` | 内部事实集合引用 | 指向类型处理器私有存储。 |
| `inputFingerprint` | 输入指纹 | 通常来自证据构建结果。 |
| `fingerprint` | 事实集合整体指纹 | 用于判断事实集合是否变化。 |
| `status` | 构建状态 | extracted、partial、failed、skipped、stale。 |

`FactBuildRecord` 是事实层的上下文根。

每个内部事实不需要重复 extractor、source、snapshot 等上下文。

## InternalFactSet

`InternalFactSet` 是类型处理器私有事实集合。

它不是横向标准对象。

不同资料类型可以完全不同。

例子：

```txt
CodeFactSet:
  CodeFact[]
  symbols
  calls
  conditions
  throws
  route handlers

RuleFactSet:
  RuleFact[]
  acceptance facts
  constraints
  exception clauses

OpenApiFactSet:
  OpenApiFact[]
  operations
  schemas
  request fields
  response fields
  error codes

DocFactSet:
  DocFact[]
  decisions
  risks
  process steps
  version statements

TableFactSet:
  TableFact[]
  test cases
  row facts
  expected results
```

要求只有一个：

```txt
必须能被该类型的 FactResolver 解析。
```

不要求所有 InternalFactSet 使用同样字段。

## FactRef

`FactRef` 是事实层对外的标准引用。

它引用的是：

```txt
某次事实构建中的某个内部事实。
或某次事实构建中的某个局部事实关系。
```

建议两种形态：

```json
{
  "kind": "fact",
  "buildRef": "factBuild:md:refund-rules:sha256-demo",
  "factId": "rule:refund-amount-limit"
}
```

```json
{
  "kind": "relation",
  "buildRef": "factBuild:code:refund-service:sha256-demo",
  "relationId": "code:call:refundOrder->calculateRefundableAmount"
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `kind` | 引用对象类型 | fact 或 relation。 |
| `buildRef` | 事实构建记录 | 指向 FactBuildRecord。 |
| `factId` | 内部事实 ID | 只在 kind=fact 时存在。 |
| `relationId` | 内部事实关系 ID | 只在 kind=relation 时存在。 |

`factId` 和 `relationId` 是 build 内局部 ID。

它们不需要全局唯一，因为 `buildRef` 已经提供上下文。

## FactResolver

`FactResolver` 是事实层真正的横向标准。

不同类型 processor 都要实现它。

```txt
listFacts(factBuildRef, filter)
extractFacts(evidenceRef, options)
resolveFact(factRef)
getFactEvidence(factRef)
getFactContext(factRef, options)
listLocalRelations(factBuildRef, filter)
listRelatedFacts(factRef, filter)
fingerprint(factRef)
invalidate(changeSet)
```

接口含义：

| 接口 | 作用 |
|---|---|
| `listFacts` | 列出某次事实构建暴露的事实引用。 |
| `extractFacts` | 从证据引用中抽取内部事实，并返回 FactRef。 |
| `resolveFact` | 把 FactRef 解析成可读、可追溯、可展开的事实视图。 |
| `getFactEvidence` | 获取支撑或反驳该事实的 EvidenceRef。 |
| `getFactContext` | 获取事实周围上下文，例如同章节规则、同函数调用、同表格行。 |
| `listLocalRelations` | 列出事实层直接可见的局部关系。 |
| `listRelatedFacts` | 围绕某个事实展开局部关系。 |
| `fingerprint` | 返回事实当前内容指纹。 |
| `invalidate` | 根据 EvidenceRef、SourceSnapshot 或 extractor 变化判断失效范围。 |

Scope 层、语义层和查询层不直接读取内部事实。

它们通过 `FactResolver` 获取自己需要的视图。

## ResolvedFactView

`resolveFact(factRef)` 返回的是视图，不是 canonical 内部事实对象。

视图可以包含冗余字段，因为它是接口结果。

示例：

```json
{
  "ref": {
    "kind": "fact",
    "buildRef": "factBuild:md:refund-rules:sha256-demo",
    "factId": "rule:refund-amount-limit"
  },
  "factKind": "business_rule",
  "label": "退款金额不能超过订单当前可退余额",
  "statement": "退款金额不能超过订单当前可退余额。",
  "evidenceRefs": [
    {
      "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
      "unitId": "md:evidence:amount-limit"
    }
  ],
  "status": "observed",
  "confidence": 0.92,
  "trace": {
    "sourceRef": "source:doc:refund-rules",
    "snapshotRef": "snapshot:doc:refund-rules:sha256-demo",
    "factBuildRef": "factBuild:md:refund-rules:sha256-demo",
    "extractor": "MarkdownRuleFactExtractor@0.1.0"
  },
  "validity": {
    "status": "observed",
    "fingerprint": "sha256:fact-rule-amount-limit"
  },
  "expansion": {
    "available": ["evidence", "structure", "nearbyFacts", "source"]
  },
  "payload": {
    "ruleType": "limit",
    "subject": "退款金额",
    "operator": "less_than_or_equal",
    "object": "订单当前可退余额"
  }
}
```

`ResolvedFactView` 是对外视图协议。

它可以包含标准外壳：

```txt
ref
factKind
label
statement
evidenceRefs
status
confidence
trace
validity
expansion
payload
```

其中 `payload` 可以按类型不同。

## 事实粒度

事实粒度要比证据更接近工程含义，但还不是语义结论。

原则：

```txt
足够小:
  能独立验证，方便归属和连接。

足够明确:
  不把多个结论塞进一个事实。

有证据:
  至少一个 EvidenceRef 支撑。

维度无关:
  不把系统、团队、业务线、版本继承结果写入事实本体。
```

建议粒度：

| 类型 | 建议事实 | 不建议事实 |
|---|---|---|
| TS | 函数存在、函数调用、条件判断、throw 错误码、路由处理器存在 | “函数实现退款能力” |
| MD | 单条规则、单条验收条件、单个限制、单个例外 | “整篇文档说明退款系统” |
| OpenAPI | operation、字段、错误码、schema 关系 | “接口实现某业务流程” |
| PDF/DOC | 流程步骤、决策、风险、版本说明 | “这个方案比旧方案好” |
| XLS | 测试用例、输入、期望结果、表格行记录 | “测试完整覆盖了规则” |

## 类型实现示例

### Rule fact

内部事实可以是：

```json
{
  "id": "rule:refund-amount-limit",
  "recordType": "RuleFact",
  "kind": "limit_rule",
  "statement": "退款金额不能超过订单当前可退余额。",
  "evidenceRefs": [
    {
      "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
      "unitId": "md:evidence:amount-limit"
    }
  ],
  "fingerprint": "sha256:fact-rule-amount-limit"
}
```

对外只暴露：

```json
{
  "kind": "fact",
  "buildRef": "factBuild:md:refund-rules:sha256-demo",
  "factId": "rule:refund-amount-limit"
}
```

### Code fact

内部事实可以是：

```json
{
  "id": "code:function:refundOrder",
  "recordType": "CodeFact",
  "kind": "function",
  "symbolName": "refundOrder",
  "evidenceRefs": [
    {
      "buildRef": "evidenceBuild:code:refund-service:sha256-demo",
      "unitId": "code:evidence:refundOrder-function"
    }
  ],
  "fingerprint": "sha256:fact-code-refundOrder"
}
```

局部关系也可以是事实：

```json
{
  "id": "code:call:refundOrder->calculateRefundableAmount",
  "recordType": "CodeFactRelation",
  "kind": "calls",
  "fromFactId": "code:function:refundOrder",
  "toFactId": "code:function:calculateRefundableAmount",
  "evidenceRefs": [
    {
      "buildRef": "evidenceBuild:code:refund-service:sha256-demo",
      "unitId": "code:evidence:call-refundable"
    }
  ],
  "fingerprint": "sha256:fact-call-refundOrder-calculate"
}
```

对外只暴露：

```json
{
  "kind": "relation",
  "buildRef": "factBuild:code:refund-service:sha256-demo",
  "relationId": "code:call:refundOrder->calculateRefundableAmount"
}
```

### OpenAPI fact

内部事实可以是：

```json
{
  "id": "api:operation:refundOrder",
  "recordType": "OpenApiFact",
  "kind": "operation",
  "method": "POST",
  "path": "/orders/{orderId}/refund",
  "operationId": "refundOrder",
  "evidenceRefs": [
    {
      "buildRef": "evidenceBuild:openapi:refund-api:sha256-demo",
      "unitId": "openapi:evidence:operation-refundOrder"
    }
  ],
  "fingerprint": "sha256:fact-api-refundOrder"
}
```

对外只暴露：

```json
{
  "kind": "fact",
  "buildRef": "factBuild:openapi:refund-api:sha256-demo",
  "factId": "api:operation:refundOrder"
}
```

### Table fact

内部事实可以是：

```json
{
  "id": "testcase:TC-REFUND-002",
  "recordType": "TableFact",
  "kind": "test_case",
  "title": "超过可退余额失败",
  "expected": "REFUND_AMOUNT_EXCEEDS_BALANCE",
  "evidenceRefs": [
    {
      "buildRef": "evidenceBuild:table:refund-cases:sha256-demo",
      "unitId": "table:evidence:TC-REFUND-002"
    }
  ],
  "fingerprint": "sha256:fact-testcase-refund-002"
}
```

对外只暴露：

```json
{
  "kind": "fact",
  "buildRef": "factBuild:table:refund-cases:sha256-demo",
  "factId": "testcase:TC-REFUND-002"
}
```

## 局部关系和语义关系的分界

事实层可以表达来源内直接可验证的局部关系：

```txt
函数 A 调用函数 B。
接口 operation 包含字段 amount。
测试用例行包含期望错误码。
规则段落包含例外说明。
文档步骤 2 跟在步骤 1 后面。
```

事实层不能直接表达跨来源解释关系：

```txt
函数 A 实现业务能力 B。
接口 C 暴露业务能力 B。
测试用例 D 验证规则 E。
规则 E 约束业务能力 B。
A 系统退款和 B 系统退款相似。
```

这些进入语义层。

## 和 Scope 层的关系

FactRef 是 Scope 层可以挂范围的对象之一。

Scope 层不只给事实挂范围，也可以给 SourceRef、StructureRef、EvidenceRef 挂范围。

事实查询时再沿引用链计算有效 Scope：

```txt
FactRef
  -> EvidenceRef
  -> StructureRef
  -> SourceRef
```

事实层不把 Scope 写进事实本体。

例如事实：

```txt
FactRef「refundOrder 函数存在」
```

Scope 层再建立：

```txt
ScopeAssignment:
  FactRef「refundOrder 函数存在」
    -> Scope「订单服务」
```

如果已知来源属于某服务或团队，也不要在事实层复制：

```txt
fact.payload.team = 交易团队
fact.payload.system = A电商平台
```

这些应该由 ScopeAssignment、ScopeRelation 和 EffectiveScope 查询时推导。

## MaterializedFactIndex

事实索引可以很宽，因为它是查询缓存，不是 canonical schema。

示例：

```json
{
  "factRef": {
    "kind": "fact",
    "buildRef": "factBuild:md:refund-rules:sha256-demo",
    "factId": "rule:refund-amount-limit"
  },
  "factKind": "business_rule",
  "label": "退款金额不能超过订单当前可退余额",
  "textPreview": "退款金额不能超过订单当前可退余额。",
  "evidenceRefs": [
    {
      "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
      "unitId": "md:evidence:amount-limit"
    }
  ],
  "sourceRefs": ["source:doc:refund-rules"],
  "fingerprint": "sha256:fact-rule-amount-limit"
}
```

索引用于搜索和展示。

Scope 层和语义层的权威追溯必须回到 FactRef、EvidenceRef 和对应 Resolver。

## 增量更新

事实层增量更新分两级。

### Build 级

缓存键：

```txt
evidenceBuildRef
extractor.name
extractor.version
extractor.configHash
inputFingerprint
```

如果证据构建没有变化，且 extractor 版本和配置没有变化：

```txt
事实层可以直接跳过。
```

### Fact / Relation 级

如果证据有局部变化，类型 processor 自己判断哪些内部事实可复用。

横向要求只需要输出：

```txt
changed factRefs
stale factRefs
new factRefs
unchanged factRefs
```

每个 FactRef 必须能回答：

```txt
fingerprint(factRef)
status(factRef)
dependencies(factRef)
evidenceRefs(factRef)
```

这样 Scope 层和语义层可以只重建受影响的归属和语义关系。

## 本层判断边界

可以在事实层判断：

- 证据中是否明确出现一个函数、接口、字段、规则、测试用例。
- 来源内是否明确出现调用、包含、字段归属、表格行关系。
- 某个事实由哪些 EvidenceRef 支撑。
- 事实抽取的状态和置信度。
- 事实是否 stale、partial 或 invalidated。

不能在事实层判断：

- 事实属于哪个系统、服务、团队、业务线。
- 两个来源里的同名事实是否同一个业务概念。
- 函数是否实现业务能力。
- 测试是否验证业务规则。
- 多个事实共同说明了什么产品结论。

事实层的价值是：

```txt
允许每种资料拥有自己的真实事实结构。
用统一 FactRef / FactResolver 把这些事实暴露给 Scope、语义和查询层。
不给 Scope 层、语义层暴露类型私有对象。
为 Scope Graph 和 Semantic Graph 提供可追溯的地基。
```
