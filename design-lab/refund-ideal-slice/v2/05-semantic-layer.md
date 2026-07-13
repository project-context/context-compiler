# 05 Semantic Layer

本文件设计语义层。

核心结论：

```txt
语义层是标准图层。

语义层 = FactRef 之间的语义边。

复杂度不在数据结构里，而在如何发现、确认、驳回和修正这些边。
```

前面几层的内部实现可以按资料类型分裂：

```txt
Structure:
  TS / MD / PDF / DOC / XLS 各自实现。

Evidence:
  CodeEvidenceUnit / MDEvidenceUnit / PDFEvidenceUnit / TableEvidenceUnit。

Fact:
  CodeFact / RuleFact / OpenApiFact / TableFact。
```

Scope 层和语义层必须标准化。

Scope 层负责：

```txt
这个 Source / Structure / Evidence / Fact 放在哪个范围里看？
这些范围如何继承、阻断、收敛？
```

语义层负责：

```txt
这些 FactRef 在业务或工程含义上是什么关系？
```

## 语义层回答什么

语义层回答：

```txt
哪个事实描述了哪个事实？
哪个代码事实实现了哪个规则事实？
哪个接口事实暴露了哪个能力或代码事实？
哪个测试事实验证了哪个规则或代码事实？
哪个规则约束了哪个能力？
哪个事实支持、反驳或冲突另一个事实？
哪些事实可能相似、替代或废弃？
```

语义层不回答：

```txt
这个事实内部字段是什么？
这段证据原文是什么？
这个事实属于哪个系统、团队、版本？
两个系统的同名能力是不是可以默认合并？
Agent 当前轮次应该展示多少上下文？
```

这些分别由 FactResolver、EvidenceResolver、Scope 层和查询运行时处理。

## Semantic Graph 是什么

Semantic Graph 中文可以叫：

```txt
语义图
```

它不是新的事实表，也不是业务对象库。

第一版核心结构只有：

```txt
SemanticEdge
```

`SemanticEdge` 是 FactRef 之间的语义关系：

```txt
FactRef -> FactRef
```

canonical 端点第一版只允许：

```txt
FactRef -> FactRef
```

不允许 `FactRef -> ScopeRef`。

不允许 `ScopeRef -> ScopeRef`。

原因是 ScopeRef 是范围坐标。如果语义边允许 ScopeRef 作为端点，语义层会很容易滑成第二个 Scope 层。

范围归属永远进入 Scope Graph：

```txt
ScopeAssignment:
  SourceRef / StructureRef / EvidenceRef / FactRef -> Scope

ScopeRelation:
  Scope -> Scope
```

## 不默认建 SemanticNode

语义层第一版不默认创建 canonical `SemanticNode`。

原因：

```txt
业务能力、业务对象、流程、规则、接口、代码、测试，大部分都应该通过 FactRef 表达。

如果再创建一套语义节点，容易出现三份对象：
  Fact 里的对象
  Scope 里的范围
  Semantic 里的概念

三份对象会带来对齐、失效、修正和查询解释成本。
```

因此第一版原则是：

```txt
语义层只存边。
节点来自已有 FactRef。
查询时可以生成临时语义视图节点，但不是 canonical 存储。
```

例如查询视图里可以展示：

```txt
业务能力「订单部分退款」
```

但它的真实来源应该回到一个或多个 FactRef，例如：

```txt
fact:doc:capability:order-partial-refund
```

如果当前只有 Scope「订单部分退款」，没有对应 FactRef，那么它不能直接作为 SemanticEdge 端点。

正确方式是：

```txt
先通过 Scope 查询相关 FactRef。
再在 FactRef 之间建立 SemanticEdge。
```

查询视图可以把 FactRef 集合包装成好读的节点，但 canonical 语义层仍然只记录 FactRef 之间的边。

## SemanticEdge

`SemanticEdge` 是语义层的统一边对象。

字段建议：

| 字段 | 含义 | 说明 |
|---|---|---|
| `id` | 边 ID | 一条 SemanticEdge 一个 ID。 |
| `recordType` | 记录类型 | 固定为 `SemanticEdge`。 |
| `fromFactRef` | 起点事实引用 | 必须是 FactRef。 |
| `toFactRef` | 终点事实引用 | 必须是 FactRef。 |
| `relationKind` | 语义关系类型 | describes、implements、verifies 等。 |
| `status` | 状态 | candidate、confirmed、rejected、stale。 |
| `confidence` | 置信度 | 这条语义边是否可信。 |
| `basisRefs` | 依据 | EvidenceRef、FactRef、ScopeAssignment、ScopeRelation、SourceRelationship、人工确认等。 |
| `producedBy` | 生成方法 | 哪个 proposer、规则、模型或人工生成。 |

第一版不要在 SemanticEdge 里塞入：

```txt
原文内容
代码片段
事实字段副本
长摘要
完整解释
```

需要内容时，通过 FactRef 继续展开。

示例：

```json
{
  "id": "semanticEdge:implements:code-refund-condition:rule-refund-amount-limit",
  "recordType": "SemanticEdge",
  "fromFactRef": {
    "layer": "fact",
    "ref": {
      "kind": "fact",
      "buildRef": "factBuild:code:refund-service:sha256-demo",
      "factId": "code:condition:refundAmountLteBalance"
    }
  },
  "toFactRef": {
    "layer": "fact",
    "ref": {
      "kind": "fact",
      "buildRef": "factBuild:md:refund-rules:sha256-demo",
      "factId": "doc:rule:refund-amount-limit"
    }
  },
  "relationKind": "implements",
  "status": "confirmed",
  "confidence": 0.91,
  "basisRefs": [
    {
      "buildRef": "evidenceBuild:code:refund-service:sha256-demo",
      "unitId": "code:evidence:refund-amount-check"
    },
    {
      "buildRef": "evidenceBuild:md:refund-rules:sha256-demo",
      "unitId": "md:evidence:refund-amount-rule"
    }
  ],
  "producedBy": "SemanticAligner@0.1.0"
}
```

## FactRef 端点规则

SemanticEdge 的端点必须是 FactRef：

```txt
fromFactRef -> toFactRef
```

原因：

```txt
FactRef 是可证据追溯的事实。
ScopeRef 是范围坐标。
```

Scope 层负责：

```txt
Source / Structure / Evidence / Fact 属于哪个 Scope。
以及 Scope 如何向下继承。
```

语义层负责：

```txt
FactRef 和 FactRef 在含义上是什么关系。
```

因此不要这样建：

```txt
FactRef「refundOrder 函数存在」
  implements
Scope「订单部分退款」
```

应该这样建：

```txt
FactRef「refundOrder 中存在退款主流程」
  implements
FactRef「产品资料声明支持订单部分退款」
```

然后 Scope 层另外表达：

```txt
ScopeAssignment:
  FactRef「产品资料声明支持订单部分退款」
    -> Scope「订单部分退款」

ScopeAssignment:
  FactRef「refundOrder 中存在退款主流程」
    -> Scope「订单服务」
```

查询“订单部分退款”时：

```txt
先用 Scope 找到相关 FactRef。
再沿 SemanticEdge 在 FactRef 之间展开。
```

## relationKind 集合

语义层不要使用泛化的：

```txt
belongs_to
related_to
context
```

这些太模糊，容易和 Scope 层混淆。

第一版允许的核心 `relationKind`：

| relationKind | 中文 | 示例 |
|---|---|---|
| `describes` | 描述 | 产品资料事实描述能力事实。 |
| `implements` | 实现 | 代码条件实现业务规则。 |
| `exposes_as_api` | 暴露为接口 | API operation 暴露某段代码事实。 |
| `verifies` | 验证 | 测试用例验证业务规则。 |
| `constrains` | 约束 | 退款金额规则事实约束能力事实。 |
| `depends_on` | 依赖 | 退款流程依赖支付原路退。 |
| `impacts` | 影响 | 修改退款规则影响接口和测试。 |
| `supports` | 支持 | 运行证据支持某条事实。 |
| `refutes` | 反驳 | 新文档反驳旧规则。 |
| `conflicts_with` | 冲突 | 两条规则互相矛盾。 |
| `similar_to` | 相似于 | A 系统退款和 B 系统退款候选相似。 |
| `supersedes` | 替代 | 新退款流程替代旧退款流程。 |
| `deprecates` | 废弃 | v2 接口废弃 v1 接口。 |

如果未来出现新关系，先问：

```txt
它是不是范围归属？
如果是，进入 ScopeAssignment。

它是不是事实之间的含义关系？
如果是，进入 SemanticEdge。

它是不是需要把 FactRef 连到 ScopeRef？
如果是，不进入 SemanticEdge；先通过 ScopeAssignment 和 EffectiveScope 找到对应范围下的 FactRef。

它是不是只是检索相似度？
如果是，先留在索引或候选，不要进入 confirmed SemanticEdge。
```

## 和 Scope 层的边界

Scope 层边：

```txt
ScopeAssignment:
  SourceRef / StructureRef / EvidenceRef / FactRef 归属到范围。

ScopeRelation:
  Scope 归属到上级范围。
  Scope 包含另一个 Scope。
  Scope 由谁负责。
  Scope 在哪段时间有效。
  Scope 依赖另一个 Scope。
```

语义层边：

```txt
describes
implements
exposes_as_api
verifies
constrains
depends_on
impacts
supports
refutes
conflicts_with
similar_to
supersedes
deprecates
```

判断方法：

```txt
问“这个东西放在哪个范围里看？”
  -> ScopeAssignment / ScopeRelation

问“这两个东西在业务或工程含义上是什么关系？”
  -> SemanticEdge
```

SemanticEdge 的端点仍然必须是：

```txt
FactRef -> FactRef
```

例子：

```txt
FactRef「refundOrder 函数存在」
  belongs_to
Scope「订单服务」
```

这是 ScopeAssignment。

```txt
FactRef「refundOrder 函数存在」
  implements
FactRef「退款金额不能超过可退余额」
```

这是 SemanticEdge。

## A/B 电商系统场景

如果 A 电商平台和 B 电商平台都有退款逻辑：

```txt
A:
  refundOrder
  /orders/{orderId}/refund
  退款金额不能超过可退余额

B:
  refundOrder
  /after-sale/refund
  退款金额不能超过可退余额
```

语义层可以建立各自内部 confirmed 边：

```txt
A.refundOrder
  implements
A.退款金额不能超过可退余额

A.超额退款测试
  verifies
A.退款金额不能超过可退余额

B.refundOrder
  implements
B.退款金额不能超过可退余额

B.超额退款测试
  verifies
B.退款金额不能超过可退余额
```

跨系统相似只能先是 candidate：

```txt
A.退款金额不能超过可退余额
  similar_to
B.退款金额不能超过可退余额
```

状态必须是：

```txt
candidate
```

除非有迁移文档、共享服务、统一规则源、代码调用、CMDB 或人工确认，否则不能升级为 confirmed。

Scope 层负责防止混淆：

```txt
ScopeAssignment:
  A.refundOrder -> Scope(A电商平台)

ScopeAssignment:
  B.refundOrder -> Scope(B电商平台)
```

语义层负责发现关系：

```txt
implements / verifies / constrains / similar_to
```

## 构建流程

语义层不是一次大模型总结。

推荐流程：

```txt
1. 收集 FactRef
   规则、函数、接口、测试、表格记录、配置事实。

2. 读取 Scope Graph
   用 ScopeAssignment、ScopeRelation、EffectiveScope 缩小候选范围，避免 A/B 系统混淆。

3. 生成候选 SemanticEdge
   名称、路径、接口、字段、调用链、测试标题、文档链接、共同证据。

4. 证据校验
   每条候选边必须能追到 EvidenceRef、FactRef 或人工确认。

5. Scope 约束
   跨 Scope 的关系默认 candidate，除非有强证据。

6. Reconciler 归并
   合并重复边、处理冲突、确认或驳回候选。

7. 输出 SemanticEdge
   只输出边，不复制事实内容。
```

## 查询时如何使用语义层

Agent 查询“退款”时，推荐顺序是：

```txt
1. 先用 Scope 找候选范围。
2. 在候选范围内沿 SemanticEdge 展开。
3. 找到相关规则、接口、代码、测试、冲突和替代关系。
4. 如果证据不够，再沿 FactRef 展开 EvidenceRef、StructureRef、Source 片段。
```

例如：

```txt
Scope「A电商平台 / 订单部分退款」
  -> FactRef「退款金额不能超过可退余额」
    <- SemanticEdge verifies
       FactRef「TC-REFUND-002」
    <- SemanticEdge implements
       FactRef「refundOrder 金额校验条件」
    <- SemanticEdge exposes_as_api
       FactRef「POST /orders/{orderId}/refund」
```

语义层给 Agent 的价值是：

```txt
不用一次拿全量资料。
可以从一个事实跳到相关代码、接口、测试和规则。
每一次跳转都有依据。
遇到低置信度关系时可以继续取证。
```

## 增量更新

语义层增量更新依赖 Ref 失效。

当以下内容变化时：

```txt
FactRef
EvidenceRef
ScopeAssignment
ScopeRelation
SourceRelationship
人工修正
```

需要重新计算相关 SemanticEdge。

但不需要重写所有语义边。

推荐输出：

```txt
new semanticEdges
changed semanticEdges
stale semanticEdges
rejected semanticEdges
unchanged semanticEdges
```

## 本层判断边界

可以在语义层判断：

- 代码事实是否实现某条规则事实。
- 测试事实是否验证某条规则事实。
- 接口事实是否暴露某个代码事实或能力事实。
- 两条规则是否支持、反驳或冲突。
- 某个旧接口是否被新接口替代。
- A/B 两个系统里的退款规则是否候选相似。

不能在语义层判断：

- FactRef 内部字段是否正确。
- EvidenceRef 原文是否可复读。
- Source 是否整体属于某个 Scope。
- FactRef 属于哪个系统、团队、版本。
- 查询当前轮次应该显露多少内容。

语义层的价值是：

```txt
把事实之间的含义关系连起来。
给 Agent 提供跨文档、代码、接口、测试的按需跳转路径。
不复制低层内容。
不替代 Scope 范围边界。
不把候选相似误判成 confirmed 合并。
```
