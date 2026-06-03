---
id: REQ-AUTH-CODE-EXPIRATION-001
type: requirement
domain: auth
status: active
sourceUri: notion://auth/login-code-expiration
---

# 登录验证码过期处理

## Acceptance Criteria

- Given a verification code older than five minutes, when the user submits it, then the API rejects the request.

## Related APIs

- POST /api/auth/verify-code
