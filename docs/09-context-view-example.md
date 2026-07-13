# Context View 示例

本文只说明一件事：

```txt
context() 返回的是一份渐进式 Markdown Context View。
```

它可以直接作为工具返回内容，也可以同时保存成文件：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/views/{viewId}.md
```

对应的锚点解析表由系统内部保存：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/bindings/{viewId}.json
```

Agent 主要阅读 Markdown，不需要理解内部 JSON graph。

## 第一轮：探索入口

Agent 不应该把用户原始自然语言传给 Context Compiler。

用户问：

```txt
如何退款？
```

Agent 自己转成结构化调用：

```txt
context({
  terms: ["退款", "refund"]
})
```

系统返回一份 Markdown Context View。

保存位置可以是：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/views/cv_refund_001.md
```

内容示例：

```md
# Context View: 退款

viewId: cv_refund_001
generatedAt: 2026-06-22T10:30:00+08:00

显露状态：代表性显露。范围、事实、关系和证据均未列全。

## 当前解释

本次 terms 命中多个退款相关范围。当前不判断“如何退款”的最终答案，只提供可继续取证的上下文入口。

## 范围

[S1] A 电商平台 包含 订单部分退款。
[S2] B 电商平台 包含 售后退款。
[S3] 支付系统 包含 原路退款。
[W1] “退款”同时出现在 A 电商、B 电商和支付系统，当前不合并。
[M1] 还有 37 个候选范围未显露。

## 事实与关系

[F1] A 产品资料声明支持订单部分退款。证据：[E1]。
[F2] A 退款金额不能超过订单当前可退余额。证据：[E2]。
[F3] A 订单服务存在 `refundOrder` 主流程。证据：[E3]。
[R1] `refundOrder` 金额校验 实现 “退款金额不能超过订单当前可退余额”。证据：[E2][E3]。
[R2] A 超额退款测试 验证 “退款金额不能超过订单当前可退余额”。证据：[E4]。
[R3] A 退款金额规则 与 B 退款金额规则 候选相似，但未确认合并。
[M2] A 电商平台还有 128 条退款相关事实未显露。

## 证据预览

[E1] `.context/sources/feishu/commerce-space/refund-guide/normalized/refund-guide.md#订单部分退款`

订单支持部分退款，退款申请通过后进入订单服务退款流程。

[E2] `.context/sources/feishu/commerce-space/refund-policy/normalized/refund-policy.md#金额限制`

退款金额不能超过订单当前可退余额。

[E3] `repo-order-service/src/main/java/com/a/order/RefundService.java:42`

public RefundResult refundOrder(RefundRequest request) { ... }

[E4] `repo-order-service/src/test/java/com/a/order/RefundServiceTest.java:31`

shouldRejectRefundAmountGreaterThanRefundableBalance()

## 风险

[W1] A/B 电商都存在退款规则，文本相似不代表同一业务规则。
[W2] 支付系统的“原路退款”可能是下游支付动作，不等于订单退款业务能力。

## 可继续展开

- 展开 A 电商退款范围 [S1]：
  context({ target: "cv_refund_001#S1" })

- 展开退款主流程事实 [F3]：
  context({ target: "cv_refund_001#F3" })

- 展开实现关系 [R1]：
  context({ target: "cv_refund_001#R1" })

- 查看更多候选范围 [M1]：
  context({ target: "cv_refund_001#M1" })

- 查看 A 电商更多退款事实 [M2]：
  context({ target: "cv_refund_001#M2" })
```

这份 Markdown 不是答案，而是调查地图。

Agent 可以直接基于它继续调用工具、读证据文件或读源码。

## 第二轮：展开某个事实

Agent 决定展开：

```txt
context({
  target: "cv_refund_001#F3"
})
```

系统通过 ViewBinding 解析：

```txt
cv_refund_001#F3 -> FactRef(code:function:refundOrder)
```

返回新的 Markdown Context View。

保存位置可以是：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/views/cv_refund_f3_001.md
```

内容示例：

```md
# Context View: F3 refundOrder 主流程

viewId: cv_refund_f3_001
expandedFrom: cv_refund_001#F3

显露状态：事实中心视图。证据显露 2/8，语义邻接显露 4/23。

## 中心事实

[F3] A 订单服务存在 `refundOrder` 主流程。

有效 Scope：

- A 电商平台。来源：Source scope。
- 订单服务。来源：Source scope。
- 订单部分退款。来源：Structure scope。

## 上游证据

[E3] `repo-order-service/src/main/java/com/a/order/RefundService.java:42`

public RefundResult refundOrder(RefundRequest request) {
  validateRefundableBalance(request);
  RefundOrder refundOrder = createRefundOrder(request);
  paymentClient.refund(refundOrder);
  return RefundResult.success(refundOrder.getId());
}

[E5] `.context/sources/gitlab/group-order/repo-order-service/normalized/index.md#RefundService`

`RefundService` 属于订单服务退款模块。

[M1] F3 还有 6 条证据未显露。

## 下游关系

[R1] `refundOrder` 调用 `validateRefundableBalance`，该校验实现退款金额限制。证据：[E3][E6]。
[R4] `refundOrder` 调用 `paymentClient.refund`，触发支付系统原路退款。证据：[E3][E7]。
[R5] `RefundServiceTest.shouldRejectRefundAmountGreaterThanRefundableBalance` 验证超额退款失败。证据：[E4]。
[R6] `refundOrder` 依赖订单可退余额字段 `refundableBalance`。证据：[E8]。
[M2] F3 还有 19 条语义邻接未显露。

## 相关来源

[SRC1] `repo-order-service`
[SRC2] `.context/sources/feishu/commerce-space/refund-policy/normalized/refund-policy.md`
[SRC3] `.context/sources/gitlab/group-payment/payment-api/normalized/index.md`

## 风险

[W1] `paymentClient.refund` 属于支付系统动作，是否等同订单退款完成需要继续看支付回调事实。

## 可继续展开

- 展开余额校验实现关系 [R1]：
  context({ target: "cv_refund_f3_001#R1" })

- 展开支付退款调用 [R4]：
  context({ target: "cv_refund_f3_001#R4" })

- 查看 F3 更多证据 [M1]：
  context({ target: "cv_refund_f3_001#M1" })

- 查看 F3 更多语义邻接 [M2]：
  context({ target: "cv_refund_f3_001#M2" })
```

## 第三轮：展开 M 锚点

如果 Agent 调用：

```txt
context({
  target: "cv_refund_f3_001#M1"
})
```

返回的新 Markdown 只显露 `M1` 对应的更多证据，不应该顺手展开所有范围、事实和语义边。

示例：

```md
# Context View: F3 更多证据

viewId: cv_refund_f3_evidence_002
expandedFrom: cv_refund_f3_001#M1

显露状态：F3 证据显露 6/8。

## 更多证据

[E6] `repo-order-service/src/main/java/com/a/order/RefundValidator.java:18`

if (request.amount().compareTo(order.refundableBalance()) > 0) {
  throw new RefundAmountExceededException();
}

[E7] `repo-order-service/src/main/java/com/a/order/PaymentClient.java:52`

POST /payments/refunds

[E8] `repo-order-service/src/main/java/com/a/order/Order.java:77`

private Money refundableBalance;

[E9] `.context/sources/feishu/commerce-space/refund-policy/normalized/refund-policy.md#支付退款`

订单退款审核通过后，由支付系统执行原路退款。

[M1] F3 还有 2 条证据未显露。

## 可继续展开

- 查看剩余证据 [M1]：
  context({ target: "cv_refund_f3_evidence_002#M1" })

- 展开支付退款调用 [E7]：
  context({ target: "cv_refund_f3_evidence_002#E7" })
```

## ViewBinding 示例

ViewBinding 是内部解析表，不是 Agent 主要阅读对象。

它可以保存为：

```txt
$CONTEXT_COMPILER_HOME/workspaces/{workspaceHash}/runtime/bindings/cv_refund_001.json
```

示意：

```json
{
  "viewId": "cv_refund_001",
  "bindings": {
    "S1": {
      "type": "scope",
      "ref": "scope:system:a-commerce"
    },
    "F3": {
      "type": "fact",
      "ref": "fact:code:function:refundOrder"
    },
    "R1": {
      "type": "semantic_edge",
      "ref": "semantic:implements:refundOrder:refund-balance-rule"
    },
    "E3": {
      "type": "evidence",
      "ref": "evidence:repo-order-service:RefundService.java:42"
    },
    "M2": {
      "type": "more",
      "plan": "more_facts_in_scope:a-commerce:refund"
    }
  }
}
```

## 关键规则

```txt
Context View 是 Markdown。
每一轮都是一个新的 Markdown 视图。
每一轮只显露当前锚点相关内容。
未显露内容用 M 锚点保留。
viewId#anchor 由 ViewBinding 解析。
Agent 读 Markdown，系统维护 Ref 和 graph。
```
