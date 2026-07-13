# Scope Graph

## 为什么叫 Scope，不叫 Dimension

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

Dimension: 时间
Scope: v2.3 之后、2025Q4、历史版本
```

这一层要解决的是：

```txt
这个资料项应该在哪个范围里看？
查询时应该缩到哪个范围？
哪些范围之间有包含、负责、适用、依赖关系？
```

所以层名叫：

```txt
Scope Graph
```

`Dimension` 是 `Scope.dimension` 或 `Scope.facet` 字段。

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
  查询时沿引用链和 ScopeRelation 计算出来的有效范围。
```

## AnyLayerRef

Scope 是横切层，切的是具体项。

`ScopeAssignment` 的起点可以是：

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

这样设计的原因是：很多资料并不混乱，Scope 可以在更上层就确定。

例如：

```txt
repo-order-service 整个仓库明确属于 A 电商平台订单服务。
docs/a-commerce/refund.md 整份文档明确适用于 A 电商平台订单退款。
Excel 某个 sheet 明确是 v2.3 之后的退款规则。
Markdown 某个章节明确是 B 电商售后退款。
```

这些 Scope 不需要到每个 Fact 再重新推断。

## 继承和有效 Scope

事实查询时可以沿引用链获得 Scope：

```txt
FactRef
  -> EvidenceRef
  -> StructureRef
  -> SourceRef
```

有效 Scope 来自：

```txt
Fact 自身的 ScopeAssignment
Evidence 的 ScopeAssignment
Structure 的 ScopeAssignment
Source 的 ScopeAssignment
ScopeRelation 推导出的上级范围
```

因此：

```txt
上层能确定，就向下继承。
中层能细化，就补充或覆盖。
底层仍不清楚，才在 Fact 层推断。
```

## 继承不能无脑传播

Source 层 Scope 很有价值，但也最容易污染。

一个文件可能是：

```txt
A/B 电商退款对比.md
公司级支付退款总结.pptx
全局事故复盘.pdf
迁移说明，同时描述老系统和新系统
```

所以 ScopeAssignment 必须区分含义。

建议字段：

```txt
assignmentKind:
  applies_to_content
  located_in_source
  discussed_subject
  owner_or_origin

propagation:
  inherit
  block
  local_only

status:
  confirmed
  candidate
  rejected
  stale

confidence:
  0..1

basisRefs:
  SourceRef / StructureRef / EvidenceRef / FactRef / human decision
```

只有 `applies_to_content + inherit` 才默认向下传播。

`discussed_subject` 表示“这段内容讨论了某个对象”，不等于这段内容适用于该对象。

## 下层覆盖上层

越靠下越精确。

例如：

```txt
Source: 退款汇总.md
  discussed_subject: A电商平台
  discussed_subject: B电商平台
  propagation: local_only

Structure: # A 电商退款
  applies_to_content: A电商平台
  propagation: inherit

Evidence: 段落 3
  继承 A电商平台

Fact: 退款金额不能超过可退余额
  effective scope = A电商平台
```

如果某个结构明确阻断上层：

```txt
Structure: # B 电商退款
  propagation: block inherited A
  applies_to_content: B电商平台
```

则该结构下的证据和事实不继承 A。

## ScopeRelation

`ScopeRelation` 只表达范围之间的关系。

例子：

```txt
订单服务 -> belongs_to -> 订单系统
订单系统 -> belongs_to -> A电商平台
订单服务 -> owned_by -> 交易团队
订单部分退款 -> part_of -> 退款能力域
v2.3之后 -> valid_in -> A电商平台
```

ScopeRelation 不表达实现、验证、约束、冲突。

这些属于 Semantic Graph。

## 构建流程

Scope Graph 构建不是一次分类器完成。

推荐流程：

```txt
1. Source 阶段
   用户打标、connector 元数据、路径、仓库、文档空间、CMDB 产生粗 ScopeAssignment。

2. Structure 阶段
   标题、章节、包名、类名、函数、sheet、表头、接口 path 产生局部 ScopeAssignment。

3. Evidence 阶段
   证据块继承、阻断或补充 Scope。

4. Fact 阶段
   优先继承上游 Scope；只有缺失、冲突或混乱时才做 Fact 级推断。

5. ScopeRelation 构建
   从组织资料、CMDB、配置、仓库结构、用户确认中建立 Scope -> Scope。

6. EffectiveScope 索引
   为查询加速生成 FactRef -> effective scopes 的派生索引。
```

## 查询结果

查询某个 Fact 时，系统应该能说明：

```txt
这个 Scope 是从 Fact 自己来的。
这个 Scope 是从 Evidence 继承来的。
这个 Scope 是从 Structure 继承来的。
这个 Scope 是从 Source 继承来的。
这个上级 Scope 是通过 ScopeRelation 推导来的。
```

这对 Agent 很重要，因为它能判断结论可信度和污染风险。

## A/B 电商例子

如果两个仓库都叫退款：

```txt
repo-a-order-service
repo-b-after-sale-service
```

Source 层可以有：

```txt
repo-a-order-service -> scope:A电商平台
repo-a-order-service -> scope:订单服务

repo-b-after-sale-service -> scope:B电商平台
repo-b-after-sale-service -> scope:售后服务
```

如果仓库 Scope 明确且可继承，那么其中结构、证据、事实默认继承。

但如果一个文档是：

```txt
A/B 退款流程对比.md
```

Source 层不应该给整份文档建立可继承的 A 或 B Scope。

应该到结构层：

```txt
# A 电商退款
  -> scope:A电商平台

# B 电商退款
  -> scope:B电商平台
```

再向下传播。
