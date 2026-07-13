# 查询运行时

## 定位

查询运行时是关联上下文的主要入口。

默认情况下，Agent 不应该从 `.context` 里扫描事实、证据、Scope 或语义关系。

这些内容默认存在外部 store 中，通过：

```txt
context()
```

查询。

Agent 拿到证据路径后，再读取：

```txt
.context/sources
原始仓库
```

进行核对。

## 自然语言不进协议

用户可能问：

```txt
如何退款？
```

但 Context Compiler 工具协议不应该直接接收这个自然语言问题。

Agent 负责理解问题，并转成结构化参数：

```txt
context(terms=["退款", "refund"])
```

或者：

```txt
context(
  terms=["退款", "超额"],
  target="cv_7f3a#S1"
)
```

## 工具形态

第一版只需要一个动态工具：

```txt
context({
  terms?: string[],
  target?: string,
  filters?: Record<string, unknown>
})
```

规则：

```txt
只有 terms:
  生成探索入口 Context View。

只有 target:
  展开上一张 Context View 中的锚点。

terms + target:
  在锚点代表的局部范围内继续检索。

都没有:
  返回最小 manifest 或使用提示。
```

第一版不需要：

```txt
limit
depth
mode
aspects
querySessionId
resultGraphId
cursor
```

## Context View

`context()` 返回 Markdown Context View。

它可以直接作为工具返回内容，也可以同时保存成 Markdown 文件：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/views/{viewId}.md
```

保存为文件只是运行时诊断或复用策略，不进入默认 `.context` 工作区。

它不是答案，不是 JSON Graph，不是 top-k。

它包含：

```txt
当前可读关系句
短锚点
少量证据预览
显露状态
风险和歧义
可继续展开入口
```

示例：

```txt
[S1] A 电商平台 包含 订单部分退款。
[F1] A 订单服务存在 refundOrder 主流程。证据：[E1]。
[R1] refundOrder 实现 “退款金额不能超过可退余额”。证据：[E1][E2]。
[W1] “退款”同时出现在 A 和 B 电商，当前不合并。
[M1] 还有 37 个候选范围未显露。
```

完整渐进式 Markdown 示例见 [Context View 示例](./09-context-view-example.md)。

## ViewBinding

每次返回 Context View 前，系统内部写入 ViewBinding：

```txt
cv_7f3a#S1 -> Scope
cv_7f3a#F1 -> FactRef
cv_7f3a#R1 -> SemanticEdge / ScopeRelation projection
cv_7f3a#E1 -> EvidenceRef
cv_7f3a#M1 -> more expansion plan
```

ViewBinding 可以保存为：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/bindings/{viewId}.json
```

Agent 下一轮只传：

```txt
context(target="cv_7f3a#F1")
```

不需要会话 ID。

`viewId` 是一次返回结果工件，不是对话会话。

## M 锚点

`M` 表示某个区块还有未显露内容。

它不是分页参数。

例如：

```txt
[M1] 还有 37 个候选范围未显露。
[M2] A 电商平台还有 128 条退款相关事实未显露。
[M3] F1 还有 6 条证据未显露。
```

展开 `M` 时只返回对应区块的更多内容。

## 查询算法

```txt
1. 接收 terms / target / filters
2. 召回候选 Source / Structure / Evidence / Fact / Scope / SemanticEdge
3. 按 EffectiveScope 分区
4. 以 FactRef 为前沿扩展 SemanticEdge
5. 证据约束和治理过滤
6. 规划本轮显露内容
7. 其余内容生成 M 锚点
8. 写 ViewBinding
9. 返回 Context View
```

原则：

```txt
召回可以宽。
显露必须窄。
未显露不能丢。
证据必须可追。
```
