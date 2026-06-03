---
id: REQ-ORDER-REFUND-001
type: requirement
domain: order
status: active
sourceUri: feishu://doc/refund
---

# 支持订单部分退款

## Acceptance Criteria

- Given a paid order, when a partial refund is requested, then the refunded amount is recorded.

## Related APIs

- POST /api/orders/{id}/refund
