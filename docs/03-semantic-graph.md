# Semantic Graph

## 定位

Semantic Graph 是独立的事实关系网。

它回答：

```txt
事实之间有什么业务或工程含义？
```

它不回答：

```txt
这个事实属于哪个系统、团队、版本或业务能力？
```

这些由 Scope Graph 回答。

## 核心对象

第一版只保留：

```txt
SemanticEdge:
  FactRef -> FactRef
```

不要让 SemanticEdge 连接 ScopeRef。

不要用 SemanticEdge 表达 belongs_to。

## 关系集合

SemanticEdge 可以表达：

```txt
describes     描述
implements    实现
exposes_as    暴露为接口
verifies      验证
constrains    约束
depends_on    依赖
impacts       影响
supports      支持
refutes       反驳
conflicts     冲突
similar_to    相似
supersedes    替代
deprecates    废弃
```

## 与 Scope Graph 的关系

两层独立存储，查询时组合。

```txt
Scope Graph:
  AnyLayerRef -> Scope
  Scope -> Scope

Semantic Graph:
  FactRef -> FactRef
```

协作点是：

```txt
FactRef
```

Scope 帮语义：

```txt
缩小候选范围。
隔离 A/B 系统。
判断跨范围关系是否只能是 candidate。
控制查询显露优先级。
```

语义帮查询：

```txt
从规则跳到实现。
从实现跳到接口。
从规则跳到测试。
从事实跳到冲突、替代、废弃信息。
```

## 构建流程

Semantic Graph 应该在 FactRef 上构建。

推荐流程：

```txt
1. 准备候选事实
   同一来源、同一有效 Scope、相邻 Scope、同名符号、同一接口、同一关键词。

2. 用 Scope 限制候选
   同一系统和父子范围优先。
   平级不同系统默认 candidate。
   Scope 未知则降低置信度。

3. 判断关系类型
   是否描述、实现、验证、约束、依赖、冲突等。

4. 校验证据
   SemanticEdge 必须能追到两端 FactRef 和关系依据。

5. 写入状态
   confirmed、candidate、rejected、stale。

6. 建索引
   FactRef 邻接、relationKind、冲突、影响范围。
```

## 语义不直接修改 Scope

语义推断可以发现 Scope 问题，但不能直接写 confirmed ScopeAssignment。

例如：

```txt
代码事实和文档事实强相关，但 effective scope 冲突。
测试事实验证某规则，但测试所属 Scope 缺失。
接口事实依赖某服务事实，但服务边界不完整。
```

正确做法：

```txt
Semantic Graph 产生 Scope 修正候选
  -> Scope Reconciler 复核
  -> 证据足够才生成或修改 ScopeAssignment
```

这样避免语义推断污染范围图。

## A/B 电商例子

事实：

```txt
F1: A 产品资料声明支持订单部分退款。
F2: A 退款金额不能超过可退余额。
F3: A 订单服务存在 refundOrder 主流程。
F4: A 超额退款测试覆盖失败场景。

F5: B 售后服务存在 refundOrder 主流程。
F6: B 退款金额不能超过可退余额。
```

语义边：

```txt
F1 describes F2
F3 implements F2
F4 verifies F2
F2 similar_to F6
```

最后一条必须是 candidate，除非存在共享规则源、迁移文档、统一服务调用或人工确认。

原因是：

```txt
F2 effective scope = A电商平台
F6 effective scope = B电商平台
```

文本相似不等于可以合并。

## 查询路径

从 Fact 出发：

```txt
FactRef
  -> SemanticEdge
  -> Neighbor FactRef
  -> EvidenceRef
  -> StructureRef
  -> SourceRef
```

同时查询 effective scope：

```txt
Neighbor FactRef
  -> inherited ScopeAssignments
  -> ScopeRelation closure
```

这样 Agent 既能看到“事实之间有什么关系”，也能知道“这条关系发生在哪个范围内”。
