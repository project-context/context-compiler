# 04 Scope Layer

本文件设计 Scope 层。

核心结论：

```txt
Scope 层是标准图层。

Scope 层不是只给 Fact 打标签。

Scope 层是横切层：
  它切在 Source / Structure / Evidence / Fact 这些具体项之上。

Scope 层的标准产物是：
  Scope
  ScopeAssignment
  ScopeRelation
  EffectiveScope 派生索引
```

也就是说，Scope Graph 不是一棵业务域树，也不是语义层的子集。

它解决的是：

```txt
某个资料项应该放在哪个范围里看？
这个范围是否可以向下继承？
范围之间有什么归属、负责、适用、依赖关系？
查询时如何先缩小范围，再逐步扩大范围？
```

## 为什么 Scope 横切每一层

前面几层的内部实现可以按资料类型分裂：

```txt
Structure:
  TS / MD / PDF / DOC / XLS / OpenAPI 各自实现。

Evidence:
  CodeEvidenceUnit / MDEvidenceUnit / PDFEvidenceUnit / TableEvidenceUnit。

Fact:
  CodeFact / RuleFact / OpenApiFact / TableFact。
```

但 Scope 层必须标准化。

原因是 Scope 要跨资料类型、跨仓库、跨系统、跨团队、跨版本工作。它不是某个文件类型的内部产物，而是查询范围和隔离边界。

Scope 也不应该只绑定 Fact。

很多资料在更上层就能判断范围：

```txt
repo-a-order-service 整个仓库明确属于 A 电商平台订单服务。
docs/a-commerce/refund.md 整份文档明确适用于 A 电商退款。
Excel 某个 sheet 明确是 v2.3 之后的退款规则。
Markdown 某个章节明确是 B 电商售后退款。
代码包名 com.a.order.refund 明确属于 A 订单服务退款模块。
```

这些范围不需要等到每条 Fact 再重新推断。

正确方式是：

```txt
能在 Source 层确认，就挂 SourceRef。
能在 Structure 层确认，就挂 StructureRef。
能在 Evidence 层确认，就挂 EvidenceRef。
只有上游缺失、冲突或混乱时，才在 Fact 层补充判断。
```

## Scope 层回答什么

Scope 层回答：

```txt
这个 Source / Structure / Evidence / Fact 可以在哪些范围里看？
这个范围从哪里判断出来？
这个范围是否确认，还是候选？
这个范围是否能向下继承？
哪些范围之间有包含、负责、适用、依赖关系？
查询时应该优先缩到哪些范围？
需要扩大时可以沿哪些 ScopeRelation 展开？
```

Scope 层不回答：

```txt
这个事实内部字段是什么？
这段证据原文是什么？
这个函数是否实现某个业务能力？
这个测试是否验证某条规则？
多个事实共同表达了什么业务结论？
```

这些分别由 FactResolver、EvidenceResolver 和语义层处理。

## Dimension 和 Scope

`Dimension` 是维度轴。

`Scope` 是维度轴上的具体范围。

例子：

```txt
Dimension: 系统
Scope: A电商平台、B电商平台、支付系统

Dimension: 服务
Scope: 订单服务、售后服务、退款服务

Dimension: 团队
Scope: 交易团队、支付团队

Dimension: 业务能力
Scope: 订单部分退款、售后退款、原路退款

Dimension: 时间
Scope: v2.3 之后、2025Q4、历史版本
```

如果实现里沿用 `Facet` 这个词，它只能作为 `Dimension` 的别名，不要再引入一套独立概念。

## 核心对象

```txt
Scope
  范围节点。

ScopeAssignment
  AnyLayerRef -> Scope。
  某个具体项归属到某个范围。

ScopeRelation
  Scope -> Scope。
  范围之间的关系。

EffectiveScope
  查询时沿引用链和 ScopeRelation 计算出的有效范围。
  它是派生结果，不是第一手事实。
```

不要再使用一个通用 `ScopeEdge` 通过 `edgeKind` 同时表达归属和范围关系。

原因是：

```txt
ScopeAssignment:
  起点是 SourceRef / StructureRef / EvidenceRef / FactRef。
  生命周期跟资料解析、证据抽取、事实抽取有关。

ScopeRelation:
  起点和终点都是 Scope。
  生命周期跟 CMDB、组织架构、业务线、系统边界、人工确认有关。
```

这两类边的校验、失效、继承、查询路径都不同，拆开更清楚。

## AnyLayerRef

ScopeAssignment 的起点是 `AnyLayerRef`。

第一版允许：

```txt
SourceRef
StructureRef
EvidenceRef
FactRef
```

也就是：

```txt
SourceRef    -> Scope
StructureRef -> Scope
EvidenceRef  -> Scope
FactRef      -> Scope
```

这就是“Scope 贯穿每一层”的准确含义。

Scope 并不是复制进每一层内部字段，而是在 Scope Graph 里用标准引用指向各层对象。

## Scope

`Scope` 是一个可查询的范围节点。

示例：

```json
{
  "id": "scope:service:order-service",
  "recordType": "Scope",
  "dimension": "service",
  "key": "order-service",
  "title": "订单服务",
  "aliases": ["repo-order-service", "OrderService"],
  "status": "confirmed",
  "confidence": 0.96,
  "basisRefs": [
    {
      "layer": "source",
      "ref": "source:gitlab:a-commerce/order-service"
    },
    {
      "layer": "evidence",
      "ref": "evidence:cmdb:order-service-row"
    }
  ],
  "producedBy": "ScopeReconciler@0.1.0"
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `id` | Scope ID | 某个范围节点的稳定 ID。 |
| `recordType` | 记录类型 | 固定为 `Scope`。 |
| `dimension` | 维度轴 | system、service、team、capability、version 等。 |
| `key` | 范围键 | 机器可读名称。 |
| `title` | 可读名称 | 给人和 Agent 展示。 |
| `aliases` | 别名 | 来自路径、标题、仓库名、CMDB、人工配置。 |
| `status` | 状态 | candidate、confirmed、rejected、stale、deprecated。 |
| `confidence` | 置信度 | 表示这个 Scope 节点本身是否可信。 |
| `basisRefs` | 依据 | SourceRef、EvidenceRef、配置或人工确认记录。 |
| `producedBy` | 生成方法 | 规则、模型、人工或 reconciler。 |

Scope 不是事实。

它是查询范围坐标。

## ScopeAssignment

`ScopeAssignment` 表达：

```txt
某个具体项属于、适用于、位于、讨论了某个 Scope。
```

示例：

```json
{
  "id": "scopeAssignment:source:repo-order-service:service-order-service",
  "recordType": "ScopeAssignment",
  "fromRef": {
    "layer": "source",
    "ref": "source:gitlab:a-commerce/order-service"
  },
  "toScopeRef": "scope:service:order-service",
  "assignmentKind": "applies_to_content",
  "propagation": "inherit",
  "status": "confirmed",
  "confidence": 0.95,
  "basisRefs": [
    {
      "layer": "source",
      "ref": "source:gitlab:a-commerce/order-service"
    },
    {
      "layer": "evidence",
      "ref": "evidence:cmdb:order-service-row"
    }
  ],
  "producedBy": "SourceScopeProposer@0.1.0"
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `id` | 归属 ID | 一条 ScopeAssignment 一个 ID。 |
| `recordType` | 记录类型 | 固定为 `ScopeAssignment`。 |
| `fromRef` | 起点引用 | SourceRef、StructureRef、EvidenceRef 或 FactRef。 |
| `toScopeRef` | 目标范围 | 指向 Scope。 |
| `assignmentKind` | 归属含义 | 决定是否可继承。 |
| `propagation` | 传播策略 | inherit、local_only、block。 |
| `status` | 状态 | candidate、confirmed、rejected、stale。 |
| `confidence` | 置信度 | 这条归属是否可信。 |
| `basisRefs` | 依据 | 证据、来源元数据、结构节点、人工确认等。 |
| `producedBy` | 生成方法 | 哪个 proposer、规则、模型或人工生成。 |

推荐的 `assignmentKind`：

| assignmentKind | 含义 | 是否默认可继承 |
|---|---|---|
| `applies_to_content` | 这段内容适用于该范围 | 可以，取决于 `propagation`。 |
| `located_in_source` | 这个对象位于某来源或仓库范围 | 通常可以，但要看来源是否单一。 |
| `discussed_subject` | 这段内容讨论了该范围 | 不默认继承。 |
| `owner_or_origin` | 来源、作者或维护者属于该范围 | 不默认推导内容也属于该范围。 |

推荐的 `propagation`：

| propagation | 含义 |
|---|---|
| `inherit` | 可以向下游 Structure / Evidence / Fact 继承。 |
| `local_only` | 只描述当前对象，不向下传播。 |
| `block` | 阻断上游某些 Scope 继续传播。 |

只有 `applies_to_content + inherit` 才默认向下传播。

`discussed_subject` 表示“提到了 / 讨论了某个范围”，不等于“这段内容适用于这个范围”。

## ScopeRelation

`ScopeRelation` 表达：

```txt
Scope 与 Scope 之间的关系。
```

主方向推荐：

```txt
子范围 -> 父范围
```

示例：

```json
{
  "id": "scopeRelation:service-order-service:system-a-commerce",
  "recordType": "ScopeRelation",
  "fromScopeRef": "scope:service:order-service",
  "toScopeRef": "scope:system:a-commerce",
  "relationKind": "belongs_to",
  "status": "confirmed",
  "confidence": 0.95,
  "basisRefs": [
    {
      "layer": "evidence",
      "ref": "evidence:cmdb:order-service-system"
    }
  ],
  "producedBy": "ScopeReconciler@0.1.0"
}
```

常见 `relationKind`：

| relationKind | 含义 | 示例 |
|---|---|---|
| `belongs_to` | 归属到范围 | 订单服务 -> A电商平台 |
| `contains` | 包含范围 | A电商平台 -> 订单服务 |
| `owned_by` | 由谁负责 | 订单服务 -> 交易团队 |
| `part_of` | 是某能力或系统的一部分 | 订单部分退款 -> 退款能力域 |
| `valid_in` | 在某范围内有效 | v2.3 之后 -> A电商平台 |
| `depends_on_scope` | 范围依赖 | 订单服务 -> 支付服务 |
| `candidate_same_as` | 候选同一范围 | 订单退款 -> 售后退款 |

ScopeRelation 不表达实现、验证、约束、冲突。

这些属于 Semantic Graph。

## EffectiveScope

`EffectiveScope` 是查询时或索引时计算出来的派生结果。

它不是人工直接写入的第一手边。

计算链路：

```txt
FactRef
  -> EvidenceRef
  -> StructureRef
  -> SourceRef
```

一个 Fact 的有效范围来自：

```txt
Fact 自身的 ScopeAssignment
Evidence 的 ScopeAssignment
Structure 的 ScopeAssignment
Source 的 ScopeAssignment
ScopeRelation 推导出的上级范围
```

示例：

```json
{
  "recordType": "EffectiveScope",
  "forRef": {
    "layer": "fact",
    "ref": "fact:code:a-commerce:refundOrder-exists"
  },
  "scopes": [
    {
      "scopeRef": "scope:service:order-service",
      "source": "inherited_from_source",
      "viaAssignmentRef": "scopeAssignment:source:repo-order-service:service-order-service"
    },
    {
      "scopeRef": "scope:system:a-commerce",
      "source": "via_scope_relation",
      "viaRelationRef": "scopeRelation:service-order-service:system-a-commerce"
    }
  ]
}
```

查询结果必须能解释：

```txt
这个 Scope 是从 Fact 自己来的。
这个 Scope 是从 Evidence 继承来的。
这个 Scope 是从 Structure 继承来的。
这个 Scope 是从 Source 继承来的。
这个上级 Scope 是通过 ScopeRelation 推导来的。
```

这对 Agent 很重要，因为它能判断范围可信度和污染风险。

## Source 可以进入 Scope，但不能盲目传播

旧结论“Scope Graph 不允许 Source 直接指向 Scope”不准确。

更合理的结论是：

```txt
SourceRef 可以有 ScopeAssignment。
但必须写清 assignmentKind、propagation、status、confidence、basisRefs。
```

原因是 Source 有两种常见情况。

第一种：来源范围非常明确。

```txt
repo-a-order-service
  applies_to_content + inherit
  -> A电商平台
  -> 订单服务
```

这种范围可以向下继承，避免每条 Fact 重复推断。

第二种：来源本身是混合资料。

```txt
A/B 电商退款对比.md
公司级支付退款总结.pptx
全局事故复盘.pdf
迁移说明，同时描述老系统和新系统
```

这种 Source 不能给整份资料建立可继承 Scope。

可以建立：

```txt
discussed_subject + local_only
```

或者什么都不建，等 Structure / Evidence / Fact 层再判断。

## SourceRelationship 如何参与 Scope

`SourceRelationship` 属于 Source 层，不属于 Scope 层。

它可以作为 ScopeAssignment 或 ScopeRelation 的依据，但不能直接替代它们。

例子：

```txt
SourceRelationship:
  测试用例表 -> tests_source -> 订单服务仓库
```

Scope 层可以基于它提出候选：

```txt
ScopeAssignment:
  FactRef「TC-REFUND-002」
    -> candidate applies_to_content
  Scope「订单服务」
```

但它不能因为两个 Source 有关系，就直接确认所有事实都属于同一个系统。

## 构建流程

Scope Graph 不是一次分类器完成。

推荐流程：

```txt
1. Source 阶段
   用户打标、来源元数据、路径、仓库、文档空间、CMDB 产生粗 ScopeAssignment。

2. Structure 阶段
   标题、章节、包名、类名、函数、sheet、表头、接口 path 产生局部 ScopeAssignment。

3. Evidence 阶段
   证据块继承、阻断或补充 Scope。

4. Fact 阶段
   优先继承上游 Scope。
   只有缺失、冲突或混乱时才做 Fact 级推断。

5. ScopeRelation 构建
   从组织资料、CMDB、配置、仓库结构、用户确认中建立 Scope -> Scope。

6. ScopeReconciler 归并
   合并同义 Scope，识别冲突，确认或拒绝候选。

7. EffectiveScope 索引
   为查询加速生成 FactRef -> effective scopes 的派生索引。
```

这套流程的重点是：

```txt
上层能确定，就向下继承。
中层能细化，就补充或阻断。
底层仍不清楚，才在 Fact 层推断。
```

## A/B 电商系统场景

如果 A 电商平台和 B 电商平台都有退款逻辑：

```txt
A 电商平台:
  repo-a-order-service
  refundOrder
  /orders/{orderId}/refund
  退款金额不能超过可退余额

B 电商平台:
  repo-b-after-sale-service
  refundOrder
  /after-sale/refund
  退款金额不能超过可退余额
```

Scope 层不能因为关键词相同就合并。

如果两个仓库来源清晰，可以在 Source 层建立可继承归属：

```txt
ScopeAssignment:
  SourceRef(repo-a-order-service)
    -> scope:system:A电商平台
    assignmentKind: applies_to_content
    propagation: inherit

ScopeAssignment:
  SourceRef(repo-a-order-service)
    -> scope:service:订单服务
    assignmentKind: applies_to_content
    propagation: inherit

ScopeAssignment:
  SourceRef(repo-b-after-sale-service)
    -> scope:system:B电商平台
    assignmentKind: applies_to_content
    propagation: inherit

ScopeAssignment:
  SourceRef(repo-b-after-sale-service)
    -> scope:service:售后服务
    assignmentKind: applies_to_content
    propagation: inherit
```

随后结构、证据、事实默认继承这些范围。

如果某份文档是混合资料：

```txt
A/B 退款流程对比.md
```

不要给整份 Source 建立可继承 A 或 B Scope。

应该在结构层拆开：

```txt
ScopeAssignment:
  StructureRef("# A 电商退款")
    -> scope:system:A电商平台
    assignmentKind: applies_to_content
    propagation: inherit

ScopeAssignment:
  StructureRef("# B 电商退款")
    -> scope:system:B电商平台
    assignmentKind: applies_to_content
    propagation: inherit
```

这样：

```txt
FactRef(A.refundOrder 存在)
  effective scope:
    A电商平台
    订单服务

FactRef(B.refundOrder 存在)
  effective scope:
    B电商平台
    售后服务
```

如果 A 和 B 的退款能力相似，只能建立候选关系：

```txt
ScopeRelation:
  scope:capability:A订单部分退款
    candidate_same_as
  scope:capability:B售后退款

status:
  candidate
```

只有迁移文档、共享服务、代码调用、CMDB 或人工确认等证据存在时，才能升级为 confirmed。

## 和语义层的边界

Scope 层负责：

```txt
这个对象放在哪个范围里看？
这个范围能不能向下继承？
范围之间如何收敛、负责、适用、依赖？
```

语义层负责：

```txt
FactRef 和 FactRef 之间是什么业务或工程关系？
```

例子：

```txt
ScopeAssignment:
  FactRef(refundOrder 函数存在)
    -> scope:service:订单服务

SemanticEdge:
  FactRef(refundOrder 函数存在)
    implements
  FactRef(订单部分退款能力存在)
```

因此：

```txt
属于哪个系统、仓库、团队、版本、业务线:
  Scope 层。

实现、验证、约束、支持、反驳、冲突:
  语义层。
```

不要把 `FactRef -> Scope` 放进语义层。

也不要把 `FactRef -> FactRef implements` 放进 Scope 层。

## 查询时如何使用 Scope

用户问“退款”时，Agent 不应该一次拿全量上下文。

查询运行时可以先用 Scope Graph 返回候选范围：

```txt
候选范围:
  S1 A电商平台 / 订单部分退款
  S2 B电商平台 / 售后退款
  S3 支付系统 / 原路退款
  S4 测试范围 / 退款回归测试
```

Agent 选择或进一步过滤后，再沿 Scope Graph 展开：

```txt
S1 A电商平台
  <- 订单系统
    <- 订单服务
      <- Fact: refundOrder 函数存在
      <- Fact: 退款金额不能超过可退余额
```

如果证据不够，再通过 FactRef 展开到 EvidenceRef、StructureRef、Source 片段。

Scope 层的价值是：

```txt
先缩小范围。
再逐步扩大范围。
避免 A/B 系统混淆。
避免把公司级资料、业务线资料、系统资料、仓库资料混在一起推理。
```

## 增量更新

Scope 层增量更新分四类。

### Scope 节点更新

当 CMDB、owner、配置或人工确认变化时：

```txt
Scope
ScopeRelation
```

可能需要更新。

但不需要重写所有 FactRef。

### ScopeAssignment 更新

当 Source、Structure、Evidence 或 Fact 变化时：

```txt
ScopeAssignment
```

可能需要重新计算。

横向要求输出：

```txt
changed assignments
stale assignments
new assignments
unchanged assignments
```

### ScopeRelation 更新

当组织架构、系统边界、服务归属、版本范围变化时：

```txt
ScopeRelation
```

可能需要重新计算。

它会影响 EffectiveScope，但不需要物理改写每条 Fact。

### EffectiveScope 更新

上级范围归属不物理复制到每个事实。

例如：

```txt
订单服务 -> 订单系统 -> A电商平台
```

如果订单服务换到另一个系统，只更新：

```txt
ScopeRelation
```

查询时沿 ScopeRelation 重新推导，或重建 EffectiveScope 派生索引。

## 本层判断边界

可以在 Scope 层判断：

- 某个 Source / Structure / Evidence / Fact 属于哪个系统、服务、仓库、模块、业务能力、版本、团队候选。
- 某个归属是否可向下继承。
- 某个 Scope 属于哪个上级 Scope。
- 某个 Scope 由哪个团队负责。
- 某个 SourceRelationship 是否可以作为 ScopeAssignment 或 ScopeRelation 的依据。
- 查询应该优先在哪些 Scope 内展开。

不能在 Scope 层判断：

- FactRef 的内部事实字段是否正确。
- EvidenceRef 的原文是否可复读。
- 函数是否实现某业务能力。
- 测试是否验证某业务规则。
- 多个事实是否共同支持或反驳某业务结论。

Scope 层的价值是：

```txt
把每层具体项放进多维范围。
给查询提供缩小和扩大的坐标。
避免跨系统、跨业务线、跨版本误合并。
把继承关系留在 Scope Graph 中查询时推导。
为语义层提供清晰的推理边界。
```
