# ScopeAssignment 构建系统

本文档设计 ScopeAssignment 归属推理系统。

它回答：

```txt
如何从杂乱资料中发现可能的范围？
如何让用户在管理平台确认范围和继承策略？
如何用 LLM 辅助识别 Structure / Evidence / Fact 的 Scope？
如何处理别名、词相似度和同名不同物？
如何把候选归属裁决成 confirmed / candidate / rejected / block？
```

## 核心结论

ScopeAssignment 构建系统不是简单分类器，也不是纯 LLM 抽取。

它是：

```txt
范围归属推理系统。
```

推荐形态：

```txt
人工边界声明
+ 多路候选提取
+ 名称归一和别名候选
+ LLM 辅助识别
+ 管理平台人工审核
+ 保守裁决
+ 受控继承
+ EffectiveScope 派生索引
```

最重要的边界：

```txt
Source 层 Scope 和是否向下继承，优先由用户在管理平台显式设置。

Structure / Evidence / Fact 层可以批量选择，点击 LLM 识别，生成候选。

LLM、词相似度、embedding 相似只能生成候选，不能直接 confirmed。

用户修正并点击应用，或命中高优先级权威规则后，才写入 confirmed ScopeAssignment。
```

## 为什么这样设计

Scope 一旦错了，会污染查询、语义关系和 Agent 判断。

尤其 Source 层最危险，因为 Source 层的 Scope 可能向下影响：

```txt
Source
  -> Structure
  -> Evidence
  -> Fact
```

所以 Source 层不能让系统自动猜测后直接继承。

更合理的职责分工是：

```txt
人:
  判断一份资料整体是否适用于某个范围。
  判断这个 Scope 是否允许向下继承。
  批量审核系统候选。

系统:
  解析结构。
  定位证据。
  抽取事实。
  发现候选 Scope。
  提示冲突。
  计算 EffectiveScope。
  维护增量更新。

LLM:
  辅助识别候选词、语境角色、局部范围和事实。
  不做最终裁判。
```

## 总体流程

```txt
Source 登记和标准化
  -> 管理平台 Source Scope 人工标记
  -> Structure / Evidence / Fact 解析
  -> 管理平台批量选择对象
  -> LLM 或规则识别候选 Scope
  -> 用户修正候选
  -> 用户应用决策
  -> Reconciler 写入 ScopeAssignment
  -> 计算 EffectiveScopeIndex
```

内部对象流：

```txt
ScopeMention
  -> ScopeSignal
  -> ScopeCandidate
  -> ScopeAliasCandidate
  -> CandidateScopeAssignment
  -> ScopeDecision
  -> ScopeAssignment
  -> EffectiveScopeIndex
```

这条链路的核心是：

```txt
看到词不等于确认 Scope。
生成候选不等于写入 confirmed。
直接归属不等于派生有效范围。
```

## 管理平台工作流

管理平台是 ScopeAssignment 质量的核心入口。

它不是聊天界面，而是：

```txt
Source 边界管理台
+ 候选 Scope 审核台
+ 批量识别和修正台
+ 冲突处理台
```

### Source 层人工标记

Source 层以人工设置为主。

用户在管理平台给 Source 选择：

```txt
Scope:
  系统、服务、团队、业务线、版本、能力等。

语境类型:
  整体适用、只是讨论、对比资料、历史资料、来源归属、不确定。

继承策略:
  是否允许向下继承。
```

推荐 UI 选项：

| 用户选择 | assignmentKind | propagation | 说明 |
|---|---|---|---|
| 整体适用 | `applies_to_content` | `inherit` | 这份资料整体适用于该 Scope。 |
| 只是在讨论 | `discussed_subject` | `local_only` | 提到该 Scope，但不向下继承。 |
| 对比/汇总资料 | `comparison` 或 `discussed_subject` | `local_only` | A/B 对比、公司级汇总、迁移分析。 |
| 历史/旧版本 | `history` | `local_only` | 默认不污染当前范围。 |
| 来源/owner | `owner_or_origin` | `local_only` | 只表示资料来源或维护者。 |
| 不确定 | `unknown` | `local_only` | 保留候选，不参与继承。 |

原则：

```txt
Source 层不自动 inherit。
只有用户、配置或权威系统明确允许，才写入 propagation = inherit。
```

示例：

```txt
repo-order-service
  用户选择:
    A电商平台
    订单服务
    整体适用
    允许继承
```

写入：

```txt
ScopeAssignment:
  SourceRef(repo-order-service)
    -> Scope(A电商平台)
  assignmentKind = applies_to_content
  propagation = inherit
  status = confirmed

ScopeAssignment:
  SourceRef(repo-order-service)
    -> Scope(订单服务)
  assignmentKind = applies_to_content
  propagation = inherit
  status = confirmed
```

如果是：

```txt
A/B 退款流程对比.md
```

用户选择：

```txt
A电商平台: 只是在讨论，不继承
B电商平台: 只是在讨论，不继承
```

写入：

```txt
ScopeAssignment:
  SourceRef(A/B 退款流程对比.md)
    -> Scope(A电商平台)
  assignmentKind = discussed_subject
  propagation = local_only

ScopeAssignment:
  SourceRef(A/B 退款流程对比.md)
    -> Scope(B电商平台)
  assignmentKind = discussed_subject
  propagation = local_only
```

### 其他层批量 LLM 识别

Structure / Evidence / Fact 层可以让用户批量触发 LLM 识别。

流程：

```txt
1. 用户筛选对象
   例如某个 Source 下的章节、某个目录下的事实、某批证据。

2. 用户批量勾选
   选择 StructureRef / EvidenceRef / FactRef。

3. 用户点击 LLM 识别
   系统把选中对象的 ResolvedView、上游 Scope、邻近上下文、已有候选传给 LLM。

4. 系统生成候选
   ScopeMention
   ScopeSignal
   ScopeAliasCandidate
   CandidateScopeAssignment
   contextRole
   propagation 建议
   basisRefs

5. 用户修正
   改 Scope。
   改 assignmentKind。
   改 propagation。
   改 status。
   删除错误候选。
   合并或拆分别名。

6. 用户点击应用
   写入 ScopeDecision。
   Reconciler 写入 ScopeAssignment。
   刷新 EffectiveScopeIndex。
```

关键点：

```txt
LLM 识别按钮只生成候选。
用户点击应用才产生决策。
```

用户应用时可以选择：

| 操作 | 结果 |
|---|---|
| 应用为 confirmed | 用户确认该归属成立。 |
| 应用为 candidate | 用户认为可能相关，但不确定。 |
| 设置 local_only | 只作用于当前对象。 |
| 设置 inherit | 允许向下传播。 |
| 设置 block | 阻断上游某个 Scope。 |
| 驳回 | 记录 rejected，避免反复建议。 |

批量应用必须有安全提示：

```txt
展示影响对象数量。
展示下游会继承的 Structure / Evidence / Fact 数量。
展示同维度冲突。
展示跨 Source 分布。
不允许静默覆盖用户已有 confirmed 决策。
```

## 核心对象

### ScopeMention

ScopeMention 表示：

```txt
某个位置出现了一个可能有范围意义的表达。
```

它不是 Scope，也不是归属。

示例：

```json
{
  "recordType": "ScopeMention",
  "text": "订单服务",
  "dimensionCandidates": ["service"],
  "fromRef": {
    "layer": "evidence",
    "ref": "evidence:md:refund-policy:paragraph-12"
  },
  "contextRole": "applies_statement",
  "method": "text_pattern",
  "confidence": 0.78,
  "basisRefs": [
    {
      "layer": "evidence",
      "ref": "evidence:md:refund-policy:paragraph-12"
    }
  ]
}
```

### contextRole

contextRole 用来判断“这个词在上下文里扮演什么角色”。

| contextRole | 含义 | 是否可继承 |
|---|---|---|
| `path_scope` | 路径、仓库、包名表达范围 | 需要用户或规则确认 |
| `heading_scope` | 标题或章节表达范围 | 可作为结构层候选 |
| `owner_scope` | owner、维护者、团队信息 | 不表示内容适用 |
| `applies_statement` | 明确说适用于、属于、负责 | 可作为强候选 |
| `discussed_subject` | 只是讨论或提到 | 不继承 |
| `comparison` | 对比 A 和 B | 不继承 |
| `example` | 例如、比如、假设、demo | 不继承 |
| `history` | 历史系统、旧版本、迁移前 | 默认不继承 |
| `negation` | 不属于、不负责、不支持 | 产生 block 或 rejected 依据 |

### ScopeSignal

ScopeSignal 表示：

```txt
某个对象和某个候选 Scope 之间存在一条信号。
```

信号强度：

| strength | 来源 | 用法 |
|---|---|---|
| `authoritative` | 用户确认、CMDB、服务目录、组织架构 | 可进入 confirmed 裁决 |
| `strong` | 明确标题、明确适用语句、强路径规则 | 可进入 confirmed 裁决 |
| `medium` | sheet 名、OpenAPI tag、字段组合、稳定共现 | 通常需要审核 |
| `weak` | 关键词、相似度、LLM 猜测 | 只能 candidate |

示例：

```json
{
  "recordType": "ScopeSignal",
  "fromRef": {
    "layer": "source",
    "ref": "source:gitlab:a-commerce/order-service"
  },
  "dimension": "service",
  "value": "订单服务",
  "signalKind": "user_selected_service",
  "strength": "authoritative",
  "contextRole": "path_scope",
  "basisRefs": [
    {
      "kind": "scopeDecision",
      "id": "scopeDecision:source:001"
    }
  ]
}
```

### ScopeCandidate

ScopeCandidate 表示可能存在的范围节点。

例如：

```txt
订单服务
OrderService
repo-order-service
order-service
```

可能归一成同一个 ScopeCandidate。

但只有权威依据、用户确认或足够强的规则裁决，才可以升级为 confirmed Scope。

### ScopeAliasCandidate

ScopeAliasCandidate 表示：

```txt
某个名称可能是某个 Scope 的别名。
```

别名分三类：

| 类型 | 含义 | 是否可直接使用 |
|---|---|---|
| `authoritative_alias` | 来自 CMDB、服务目录、用户配置 | 可以作为强依据 |
| `observed_alias` | 多处资料稳定共现形成的别名 | 需要裁决 |
| `candidate_alias` | 字符串相似、embedding、LLM 推测 | 只能候选 |

示例：

```json
{
  "recordType": "ScopeAliasCandidate",
  "text": "repo-order-service",
  "normalizedText": "order service",
  "dimension": "service",
  "candidateScopeRef": "scopeCandidate:service:order-service",
  "aliasKind": "repository_name",
  "status": "candidate",
  "confidence": 0.82,
  "basisRefs": [
    {
      "layer": "source",
      "ref": "source:gitlab:a-commerce/order-service"
    }
  ],
  "proposedBy": "ScopeNameResolver@0.1.0"
}
```

### CandidateScopeAssignment

CandidateScopeAssignment 是候选归属。

Proposer 和 LLM 只输出候选，不直接写最终 ScopeAssignment。

示例：

```json
{
  "recordType": "CandidateScopeAssignment",
  "fromRef": {
    "layer": "structure",
    "ref": "structure:md:heading:a-commerce-refund"
  },
  "toScopeCandidateRef": "scopeCandidate:system:a-commerce",
  "assignmentKind": "applies_to_content",
  "propagation": "inherit",
  "confidence": 0.84,
  "basisRefs": [
    {
      "layer": "structure",
      "ref": "structure:md:heading:a-commerce-refund"
    }
  ],
  "proposedBy": "LLMScopeRecognizer@0.1.0"
}
```

### ScopeDecision

ScopeDecision 记录用户或配置的决策。

它是 confirmed 的重要依据。

示例：

```json
{
  "recordType": "ScopeDecision",
  "id": "scopeDecision:batch:2026-06-23-001",
  "decisionKind": "apply_scope_assignments",
  "targetRefs": [
    {
      "layer": "structure",
      "ref": "structure:md:heading:a-commerce-refund"
    }
  ],
  "appliedAssignments": [
    {
      "fromRef": {
        "layer": "structure",
        "ref": "structure:md:heading:a-commerce-refund"
      },
      "toScopeRef": "scope:system:a-commerce",
      "assignmentKind": "applies_to_content",
      "propagation": "inherit",
      "status": "confirmed"
    }
  ],
  "reviewedCandidates": [
    "candidateScopeAssignment:llm:batch-001:item-001"
  ],
  "decidedBy": "user",
  "decidedAt": "2026-06-23T00:00:00+08:00"
}
```

ScopeDecision 必须保留。

原因：

```txt
人工修正可追溯。
confirmed 有用户依据。
增量重算时不能丢掉人工决策。
错误候选可以长期 rejected。
```

### ScopeAssignment

ScopeAssignment 是最终直接归属边。

示例：

```json
{
  "recordType": "ScopeAssignment",
  "fromRef": {
    "layer": "structure",
    "ref": "structure:md:heading:a-commerce-refund"
  },
  "toScopeRef": "scope:system:a-commerce",
  "assignmentKind": "applies_to_content",
  "propagation": "inherit",
  "status": "confirmed",
  "confidence": 0.91,
  "basisRefs": [
    {
      "kind": "scopeDecision",
      "id": "scopeDecision:batch:2026-06-23-001"
    },
    {
      "layer": "structure",
      "ref": "structure:md:heading:a-commerce-refund"
    }
  ],
  "producedBy": "ScopeAssignmentReconciler@0.1.0"
}
```

## 名称归一、别名与相似度

名称归一由统一模块处理：

```txt
ScopeNameResolver
```

不要让每个 extractor 自己判断：

```txt
订单服务 == OrderService == order-service == repo-order-service
```

### 名称标准化

常见处理：

```txt
大小写统一。
全角半角统一。
空格、下划线、中横线、点号分词。
camelCase / PascalCase 拆词。
路径、包名、repo 名拆词。
常见前后缀剥离：repo、service、svc、app、系统、平台、服务、团队。
中英文别名表匹配。
可选拼音或缩写匹配。
```

例如：

```txt
repo-order-service
OrderService
order_service
com.company.order.service
订单服务
```

标准化后可能形成：

```txt
tokens: [order, service]
dimension candidates: service / repository
```

但这仍然不是 confirmed。

### 相似度 feature

| feature | 说明 | 用法 |
|---|---|---|
| `exact_key_match` | key 完全匹配 | 强候选 |
| `authoritative_id_match` | CMDB id、repo id、external id 一致 | 可 confirmed |
| `confirmed_alias_match` | 已确认 alias 命中 | 可作为强依据 |
| `token_jaccard` | 分词集合相似 | 候选 |
| `edit_distance` | 字符串编辑距离 | 候选 |
| `prefix_suffix_match` | order-service / order-svc | 候选 |
| `path_cooccurrence` | 名称和路径长期共现 | 候选或中等信号 |
| `embedding_similarity` | 语义向量相似 | 只能候选 |
| `llm_same_as_guess` | LLM 判断可能相同 | 只能候选 |

规则：

```txt
相似度只能生成 ScopeAliasCandidate 或 candidate_same_as。
相似度不能单独生成 confirmed Scope。
相似度不能单独生成 confirmed ScopeAssignment。
```

### 同名不等于同一 Scope

同名函数、同名服务、同名能力可能属于不同系统。

例如：

```txt
A 电商平台:
  refundOrder
  订单服务

B 电商平台:
  refundOrder
  订单服务
```

不能因为名称相同就合并。

必须看：

```txt
上游 Source Scope
Structure Scope
服务目录 id
仓库 id
团队 owner
版本范围
证据上下文
```

如果没有强证据，只能建立：

```txt
candidate_same_as
```

### 别名确认

别名 confirmed 的来源：

```txt
权威源声明。
用户确认。
CMDB alias。
服务目录 alias。
强结构共现并通过规则裁决。
```

只有字符串相似或 embedding 相似时：

```txt
保持 candidate。
```

别名一旦 confirmed，可以进入 Scope 的 aliases，但必须保留：

```txt
alias
aliasKind
status
basisRefs
confirmedBy
confirmedAt
```

不要只存字符串数组。

## LLM 使用规则

LLM 可以作为识别器。

适合做：

```txt
从自然语言中发现 ScopeMention。
判断 contextRole。
从文档证据抽取小事实。
发现 SemanticEdge 候选。
解释候选依据。
```

不适合做：

```txt
直接 confirmed ScopeAssignment。
直接生成不可追溯事实。
直接覆盖用户决策、CMDB、服务目录。
直接从整份大文件总结继承范围。
```

LLM 输出必须满足：

```txt
只基于输入的 StructureRef / EvidenceRef / FactRef。
每条输出必须带 basisRefs。
必须输出结构化 JSON。
必须通过 schema 校验。
必须记录 model、prompt、config、inputHash。
默认 status = candidate。
```

如果 LLM 识别出：

```txt
订单服务负责校验退款金额。
```

它也只能先生成：

```txt
ScopeSignal
CandidateScopeAssignment
```

最终是否 confirmed，由用户应用或 Reconciler 裁决。

## 规则设计

规则要显式化，不要散落在 extractor 里。

推荐规则分层：

```txt
ExtractionRule:
  从资料中发现 mention / signal。

NormalizationRule:
  名称标准化、别名、同义候选。

ProposalRule:
  从 signal 生成 CandidateScopeAssignment。

ConflictRule:
  判断同维度冲突、跨系统混淆、候选降级。

PropagationRule:
  判断 inherit / local_only / block。

ConfirmationRule:
  判断 candidate 是否可以 confirmed。
```

规则对象建议包含：

| 字段 | 含义 |
|---|---|
| `id` | 规则 ID |
| `ruleType` | extraction、normalization、proposal、conflict、propagation、confirmation |
| `dimension` | 适用维度，可为空表示通用 |
| `when` | 条件 |
| `then` | 动作 |
| `priority` | 优先级 |
| `requiresBasis` | 是否必须有 basisRefs |
| `maxStatus` | 最高能产出 candidate 还是 confirmed |
| `producedBy` | 规则来源和版本 |

示例：

```json
{
  "id": "rule:source:user-selected-inherit",
  "ruleType": "confirmation",
  "dimension": "service",
  "when": {
    "decisionKind": "user_selected_source_scope",
    "assignmentKind": "applies_to_content",
    "propagation": "inherit"
  },
  "then": {
    "status": "confirmed"
  },
  "priority": 100,
  "requiresBasis": true,
  "maxStatus": "confirmed"
}
```

相似度规则示例：

```json
{
  "id": "rule:name:embedding-similarity-candidate",
  "ruleType": "normalization",
  "dimension": null,
  "when": {
    "feature": "embedding_similarity",
    "minScore": 0.86
  },
  "then": {
    "create": "ScopeAliasCandidate",
    "status": "candidate"
  },
  "priority": 20,
  "requiresBasis": true,
  "maxStatus": "candidate"
}
```

冲突规则示例：

```json
{
  "id": "rule:system:same-level-conflict-downgrade",
  "ruleType": "conflict",
  "dimension": "system",
  "when": {
    "sameRef": true,
    "sameDimension": true,
    "multipleCandidates": true,
    "noAuthoritativeWinner": true
  },
  "then": {
    "status": "candidate",
    "reason": "same_dimension_conflict"
  },
  "priority": 90,
  "requiresBasis": true,
  "maxStatus": "candidate"
}
```

规则优先级建议：

```txt
用户确认
  > 权威系统
  > 外部来源元数据
  > 人工批量规则
  > 路径 / 仓库 / 包名强规则
  > 结构标题 / sheet / OpenAPI path
  > 证据明确语句
  > Fact 级兜底
  > 字符串相似 / embedding / LLM
```

## Reconciler 裁决

Reconciler 输入：

```txt
ScopeSignal
ScopeCandidate
ScopeAliasCandidate
CandidateScopeAssignment
ScopeDecision
ScopeRelation
历史裁决
```

Reconciler 输出：

```txt
Scope
ScopeAssignment
candidate assignment
rejected assignment
block assignment
```

confirmed 条件：

```txt
强依据
+ 明确适用
+ 范围单一
+ 同维度无强冲突
+ basisRefs 可追溯
  -> confirmed
```

candidate 条件：

```txt
只是关键词相似。
只是 embedding 相似。
LLM 猜测。
普通正文提到。
同一维度多个候选且无强证据决胜。
跨系统相似。
来源是总结、对比、历史、迁移、假设。
用户应用为 candidate。
```

block 条件：

```txt
下层明确阻断上层继承。
明确否定某范围适用。
用户在管理平台选择 block。
```

rejected 条件：

```txt
用户驳回。
权威系统反证。
文档明确写不属于、不负责、不支持。
```

## DimensionPolicy

不同维度不能使用同一套规则。

### system

```txt
通常单值。
Source 层以用户选择、配置、CMDB、服务目录为主。
Structure 层标题可以产生局部 confirmed。
同层冲突时降级 candidate。
```

### service

```txt
通常单值或少量多值。
优先来源：用户选择、CMDB、repo 名、package、module、OpenAPI server/tag。
正文普通提到不 confirmed。
```

### team

```txt
不从普通正文随便推断。
优先来源：组织架构、owner、CODEOWNERS、CMDB、用户配置。
“交易相关团队”不自动等于“交易团队”。
```

### capability

```txt
可以多值。
来源：标题、规则、接口、代码、测试共同指向。
没有权威命名时可以生成 candidate capability。
不要把相似能力直接合并。
```

### version / time

```txt
局部优先。
经常需要 block 上层。
优先从明确文本、tag、release note、配置读取。
```

## EffectiveScope 计算

ScopeAssignment 只保存直接判断。

不要把继承结果物理复制到每个 Fact。

计算链路：

```txt
FactRef
  -> EvidenceRef
  -> StructureRef
  -> SourceRef
```

伪流程：

```txt
effectiveScopes(ref):
  parent = parentRef(ref)
  inherited = effectiveScopes(parent)
  direct = confirmed ScopeAssignment for ref
  blockers = block assignments for ref

  scopes = inherited
  scopes = removeBlocked(scopes, blockers)
  scopes = merge(scopes, direct)
  scopes = applyScopeRelations(scopes)

  return scopes
```

EffectiveScopeIndex 是查询加速索引，不是第一手归属边。

## 存储建议

第一版建议存：

```txt
scope_mentions
scope_signals
scope_candidates
scope_alias_candidates
scope_similarity_edges
candidate_scope_assignments
scope_review_batches
scope_decisions
scope_assignments
scope_relations
effective_scope_index
```

其中：

```txt
scope_mentions / scope_signals:
  可重建，但建议保留以便解释和调试。

scope_candidates:
  候选 Scope 池。

scope_alias_candidates / scope_similarity_edges:
  可重建，但建议保留以解释名称归一和候选合并过程。

candidate_scope_assignments:
  可重建，但建议保留候选池和审核历史。

scope_review_batches:
  管理平台批量识别、批量审核和应用记录。

scope_decisions:
  用户确认、驳回、别名合并、批量应用，不能丢。

scope_assignments / scope_relations:
  canonical graph。

effective_scope_index:
  可重建的查询索引。
```

## 增量更新

变化来源：

```txt
SourceSnapshot 改变。
StructureRef 改变。
EvidenceRef 改变。
FactRef 改变。
ScopeRelation 改变。
用户确认或驳回候选。
管理平台批量应用。
外部 CMDB / 组织架构更新。
LLM extractor 版本或 prompt 改变。
```

重算策略：

```txt
Source 变化:
  重算该 Source 下的 Structure / Evidence / Fact 信号和候选。
  保留用户 Source ScopeDecision。

Structure 变化:
  重算该结构子树下的 Evidence / Fact / CandidateScopeAssignment。

Evidence 变化:
  重算相关 Fact 和局部候选。

Fact 变化:
  重算 Fact 级候选和相关 SemanticEdge。

ScopeRelation 变化:
  不重写 direct ScopeAssignment，只刷新 EffectiveScopeIndex。

用户决策变化:
  写入高优先级依据，刷新受影响 EffectiveScopeIndex。
```

## A/B 电商例子

### Source 人工声明

```txt
A/B 退款流程对比.md
```

用户在管理平台选择：

```txt
A电商平台:
  只是在讨论
  不继承

B电商平台:
  只是在讨论
  不继承
```

Source 层不向下传播 A 或 B。

### Structure 批量识别

文档内：

```txt
# A 电商退款
退款金额不能超过可退余额。

# B 电商退款
退款金额不能超过售后单可退余额。
```

用户批量选择两个 heading，点击 LLM 识别。

候选结果：

```txt
StructureRef("# A 电商退款")
  -> Scope(A电商平台)
  assignmentKind = applies_to_content
  propagation = inherit

StructureRef("# B 电商退款")
  -> Scope(B电商平台)
  assignmentKind = applies_to_content
  propagation = inherit
```

用户确认并应用后，写入 confirmed ScopeAssignment。

下面的 EvidenceRef 和 FactRef 通过 EffectiveScope 继承各自章节 Scope。

### 仓库整体适用

```txt
gitlab/a-commerce/order-service
```

用户或配置确认：

```txt
Scope:
  A电商平台
  订单服务

继承:
  允许
```

写入：

```txt
SourceRef(repo-order-service)
  -> Scope(A电商平台)
  propagation = inherit

SourceRef(repo-order-service)
  -> Scope(订单服务)
  propagation = inherit
```

仓库内事实通过 EffectiveScope 获得：

```txt
订单服务
A电商平台
```

如果存在：

```txt
ScopeRelation:
  订单服务 -> 交易团队
```

查询时还可以推导：

```txt
交易团队
```

## 验收标准

第一版系统至少要通过：

```txt
1. Source 层不自动 inherit，除非用户、配置或权威系统明确允许。
2. 用户能在管理平台设置 Source Scope 和继承策略。
3. 用户能批量选择 Structure / Evidence / Fact 并触发 LLM 识别。
4. LLM 识别只产生候选，不能直接 confirmed。
5. 用户修正并应用后写入 ScopeDecision 和 ScopeAssignment。
6. 批量 inherit 前必须展示下游影响范围。
7. A/B 对比文档不会把整份 Source 归属到 A 或 B。
8. A 章节下的事实继承 A，B 章节下的事实继承 B。
9. “例如订单服务”只产生 example mention，不产生 confirmed ScopeAssignment。
10. “交易相关团队”不会自动归一成“交易团队”，除非有 alias 或权威依据。
11. 字符串相似和 embedding 相似只能产生候选别名或 candidate_same_as。
12. confirmed alias 必须保留 basisRefs 和确认来源。
13. ScopeRelation 变化只刷新 EffectiveScopeIndex，不重写所有 Fact。
14. 每个 confirmed ScopeAssignment 都能解释来源和依据。
```

## 一句话

```txt
ScopeAssignment 构建系统 =
  Source 层人工边界声明
  + 其他层批量 LLM 候选识别
  + 用户修正应用
  + 名称归一和别名候选
  + 规则裁决
  + 受控继承
  + EffectiveScope 派生索引。

LLM 负责提高候选召回。
用户和规则负责 confirmed。
EffectiveScope 负责查询时正确继承。
```
