# Context Compiler

> 将分散的软件工程项目知识，编译成 AI Agent 可理解、可追溯、可治理、可按角色消费的结构化上下文。

**Context Compiler** 是一个面向 AI 协作型软件工程的 Context Engineering 实验项目。

它尝试将产品文档、设计说明、代码仓库、接口定义、测试用例、历史缺陷、会议纪要和运行日志等项目资料，编译成 AI Agent 可以理解、追溯、验证和按角色使用的结构化上下文。

这个项目的目标不是替代产品经理、设计师、开发、测试或 Reviewer。

它的目标是减少低效的上下文转述，让 AI Agent 能够在真实软件项目中理解正确的背景、约束、关系和可信来源。

---

## 为什么需要 Context Compiler？

传统软件项目通常围绕“人”来组织协作。

一个典型项目可能包含产品、设计、前端、后端、测试、运维和评审等角色。不同角色维护不同资料：

* 产品维护 PRD、业务规则、会议纪要和需求变更记录；
* 设计维护原型、交互说明、视觉稿和用户流程；
* 前端维护页面、组件、状态管理和接口调用；
* 后端维护服务、接口、领域模型、数据库和后台任务；
* 测试维护测试计划、测试用例、测试数据、缺陷复盘和自动化测试。

在很多团队里，仓库仍然主要只是一个 **代码仓库**。

大量重要的项目知识散落在文档工具、聊天记录、Issue 系统、设计工具、Wiki、网盘、测试平台和人的记忆中。

在纯人工协作时代，这种方式还能勉强运转。

但在 AI coding agent 时代，这会暴露出新的问题：

> AI Agent 能看到代码，却经常看不到完整项目。

因此，AI Agent 可能会：

* 误解业务需求；
* 引用过期文档；
* 忽略设计约束；
* 遗漏验收标准；
* 不知道需求、接口、页面、测试和历史缺陷之间的关系；
* 需要不同角色反复补充同样的背景；
* 更像一个“开发助手”，而不是项目级协作者。

Context Compiler 探索的是另一种模式：

> 项目仓库应该从“代码仓库”升级为“AI 可协作的项目工作空间”。

---

## 核心想法

Context Compiler 不要求产品、设计、测试和开发改变原有工作方式，也不要求所有人都改用 Markdown 或工程化格式。

它的基本思路是：

1. 人类继续使用自己习惯的工具；
2. Context Compiler 从多个来源采集项目资料；
3. 对资料进行解析、标准化、关联、校验和压缩；
4. 生成项目级 Context Graph；
5. 输出角色视图、任务上下文、诊断报告和 Agent Skill Pack；
6. AI Agent 通过文件、MCP 或 Agent 工具集成来消费这些上下文。

```txt
产品文档
设计说明
源代码
接口定义
测试用例
历史缺陷
运行日志
会议纪要
   ↓
Context Compiler
   ↓
Project Context Graph
   ↓
Role Views / Task Context / Diagnostics / Agent Skill Packs
   ↓
Product Agent / Design Agent / Frontend Agent / Backend Agent / Test Agent / Reviewer Agent
```

核心原则是：

> AI 不应该直接消费混乱的人类资料。
> AI 应该消费经过编译的、结构化的、可追溯的、按角色组织的项目上下文。

---

## Context Compiler 生成什么？

Context Compiler 可以生成多种上下文产物。

### 1. Project Brief

项目级摘要，包括：

* 项目目标；
* 业务领域；
* 用户角色；
* 技术栈；
* 仓库结构；
* 全局约束；
* 当前交付目标。

### 2. Domain Context

按业务领域组织的上下文，例如：

```txt
auth/
order/
payment/
inventory/
notification/
admin/
```

每个领域可以包含：

* 领域目标；
* 核心业务规则；
* 相关需求；
* 相关页面；
* 相关接口；
* 相关服务；
* 相关数据库表；
* 相关测试；
* 已知风险；
* 历史决策。

### 3. Role Views

不同角色需要不同上下文。

Context Compiler 可以输出面向不同角色的视图：

* Product Agent；
* Design Agent；
* Frontend Agent；
* Backend Agent；
* Test Agent；
* Reviewer Agent。

示例：

```txt
.context/views/product.md
.context/views/design.md
.context/views/frontend.md
.context/views/backend.md
.context/views/tester.md
.context/views/reviewer.md
```

### 4. Task Context

针对具体任务，Context Compiler 可以生成聚焦的任务上下文包。

示例：

```bash
context task "支持订单部分退款" --role backend
```

可能输出：

```txt
.context/tasks/support-partial-refund.backend.md
```

一个任务上下文可能包含：

* 相关需求；
* 业务规则；
* 验收标准；
* 相关接口；
* 相关服务；
* 相关数据库表；
* 相关测试；
* 历史缺陷；
* 风险点；
* 推荐验证步骤；
* 不应破坏的约束。

### 5. Diagnostics

Context Compiler 可以检测上下文质量问题，例如：

* 需求缺少验收标准；
* 需求缺少测试覆盖；
* 设计稿没有关联任何实现；
* PRD 中提到的接口在 OpenAPI 中不存在；
* 前端调用了未定义的后端接口；
* 过期上下文仍被引用；
* 业务规则之间存在冲突；
* 历史缺陷缺少回归测试。

### 6. Agent Skill Packs

Context Compiler 可以为不同 AI coding agent 输出专用上下文或规则包，例如：

* Claude Code；
* Codex；
* Cursor；
* Copilot；
* Gemini CLI；
* 其他 AI coding agent。

---

## Project Context Graph

Context Compiler 的核心是 **Project Context Graph**。

它不是把文档切成孤立文本块，而是把项目知识建模成相互连接的软件工程对象。

示例节点类型：

```txt
Requirement
BusinessRule
AcceptanceCriteria
DesignFrame
UserFlow
Page
Component
API
Service
DomainModel
DatabaseTable
BackgroundJob
TestCase
Bug
Decision
Risk
Release
CodeSymbol
```

示例关系：

```txt
Requirement -> has_acceptance_criteria -> AcceptanceCriteria
Requirement -> designed_by -> DesignFrame
Requirement -> implemented_by -> CodeSymbol
Requirement -> verified_by -> TestCase
Requirement -> affected_by -> Bug

DesignFrame -> maps_to -> Page
Page -> uses -> Component
Component -> calls -> API
API -> handled_by -> Service
Service -> reads_writes -> DatabaseTable
TestCase -> covers -> Requirement
Bug -> requires_regression_test -> TestCase
Decision -> supersedes -> Decision
```

这个图谱可以帮助 AI Agent 回答：

* 这个需求涉及哪些接口？
* 这个后端改动会影响哪些前端页面？
* 这个需求是否有测试覆盖？
* 修改这段逻辑前需要注意哪些历史缺陷？
* 这个设计稿是否仍然有效？
* 这个 PR 是否破坏了某条历史业务规则？

---

## 技术架构

一个典型的 Context Compiler 架构如下：

```txt
┌──────────────────────────────────────────────┐
│              Human Work Sources              │
│ PRD / Figma / Issues / Code / Tests / Logs   │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Source Connectors               │
│ Feishu / Notion / Figma / Git / Jira / etc.  │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Normalization Layer             │
│ Docs / Design Nodes / Code Symbols / Tests   │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Compiler Core                   │
│ Parse / Classify / Link / Validate / Compress│
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Project Context Graph           │
│ Requirement ↔ Design ↔ API ↔ Code ↔ Test     │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Context Artifacts               │
│ Role Views / Task Context / Diagnostics      │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│              Agent Runtime Integration       │
│ Claude Code / Codex / Cursor / MCP / CI      │
└──────────────────────────────────────────────┘
```

---

## Compiler Pipeline

Context Compiler 采用类似编译器的流水线：

```txt
Ingest
  ↓
Parse
  ↓
Normalize
  ↓
Classify
  ↓
Link
  ↓
Validate
  ↓
Compress
  ↓
Emit
```

### Ingest

从不同工具中采集项目资料。

可能的数据源包括：

* Git 仓库；
* Markdown 文档；
* OpenAPI 文档；
* 设计文件；
* Issue 系统；
* 测试用例系统；
* CI 报告；
* 运行日志；
* 会议纪要。

### Parse

将原始资料解析成结构化中间对象。

例如：

* Markdown 章节；
* OpenAPI 操作；
* 源码符号；
* 测试用例记录；
* 设计稿 Frame；
* Issue 条目。

### Normalize

将不同来源的资料转换成统一的上下文块。

### Classify

将上下文块分类为不同类型，例如：

* requirement；
* business rule；
* acceptance criteria；
* design spec；
* API contract；
* test case；
* bug；
* decision；
* risk；
* code symbol。

### Link

建立上下文对象之间的关系，例如：

* 需求关联接口；
* 接口关联后端服务；
* 页面关联组件；
* 需求关联测试用例；
* 缺陷关联回归测试；
* 设计稿关联前端路由。

### Validate

执行一致性和质量检查，例如：

* 缺少验收标准；
* 缺少测试覆盖；
* 接口不一致；
* 使用过期上下文；
* 需求冲突。

### Compress

生成不同粒度的 AI 可读上下文：

* 项目级；
* 领域级；
* 角色级；
* 任务级。

### Emit

将上下文输出为本地文件、JSONL、Markdown、MCP 工具、CI 报告或 Agent 专用配置。

---

## 推荐输出目录

一个编译后的项目可以包含：

```txt
.context/
  context-manifest.json

  views/
    project.md
    product.md
    design.md
    frontend.md
    backend.md
    tester.md
    reviewer.md

  domains/
    auth.md
    order.md
    payment.md

  tasks/
    TASK-1234.backend.md
    TASK-1234.tester.md

  graph/
    nodes.jsonl
    edges.jsonl
    diagnostics.jsonl

  indexes/
    vector.index
    symbol.index
    api.index

  artifacts/
    claude-code/
    cursor/
    codex/

  cache/
```

---

## Context Manifest 示例

```json
{
  "project": "example-shop",
  "compiledAt": "2026-06-02T10:00:00Z",
  "compilerVersion": "0.1.0",
  "sources": [
    {
      "id": "prd-order-v3",
      "type": "prd",
      "uri": "feishu://doc/example",
      "status": "active",
      "updatedAt": "2026-06-01T12:00:00Z"
    }
  ],
  "views": {
    "frontend": ".context/views/frontend.md",
    "backend": ".context/views/backend.md",
    "tester": ".context/views/tester.md",
    "reviewer": ".context/views/reviewer.md"
  },
  "graph": {
    "nodes": ".context/graph/nodes.jsonl",
    "edges": ".context/graph/edges.jsonl"
  },
  "diagnostics": ".context/graph/diagnostics.jsonl"
}
```

---

## Role View 示例

```md
# Backend Role Context

## Scope

This view is optimized for backend implementation and review.

## Related Domains

- Auth
- Order
- Payment

## APIs

### POST /api/orders/{id}/refund

Related requirement:

- REQ-ORDER-REFUND-001

Business rules:

- Refund amount must not exceed refundable amount.
- Refund operation must be idempotent.
- Refunded orders must generate an audit record.

Related services:

- RefundService
- OrderService
- PaymentGatewayClient

Related tests:

- TC-REFUND-001
- TC-REFUND-002
- TC-REFUND-REGRESSION-001

Historical risks:

- BUG-2025-331: duplicate refund caused by retry.
- BUG-2025-418: refund succeeded but order status was not updated.
```

---

## CLI 设想

> 当前 CLI 仍处于设计阶段。

```bash
# 初始化项目
context init

# 同步外部资料
context sync

# 编译项目上下文
context compile

# 检查上下文质量
context validate

# 生成角色视图
context view backend

# 生成任务上下文
context task "支持订单部分退款" --role backend

# 解释某个上下文项的来源
context explain REQ-ORDER-REFUND-001

# 分析代码变更影响
context diff --from main --to feature/partial-refund

# 输出 Agent 专用产物
context emit --target claude-code
context emit --target cursor
context emit --target codex
```

---

## 插件系统

Context Compiler 被设计为一个可扩展系统。

### Connector Plugins

用于连接外部数据源。

示例：

```txt
connector-git
connector-feishu
connector-notion
connector-confluence
connector-figma
connector-jira
connector-linear
connector-openapi
connector-testrail
connector-zentao
```

### Parser Plugins

用于解析原始内容。

示例：

```txt
parser-markdown
parser-docx
parser-html
parser-openapi
parser-source-code
parser-xlsx
parser-figma
```

### Linker Plugins

用于构建图谱关系。

示例：

```txt
linker-requirement-api
linker-api-code
linker-requirement-test
linker-design-route
linker-bug-regression
```

### Validator Plugins

用于检查上下文质量。

示例：

```txt
validator-missing-tests
validator-api-mismatch
validator-deprecated-context
validator-design-requirement-mismatch
validator-conflicting-rules
```

### Emitter Plugins

用于输出上下文产物。

示例：

```txt
emitter-markdown
emitter-jsonl
emitter-mcp
emitter-claude-code
emitter-cursor
emitter-codex
emitter-html-report
```

### Policy Plugins

用于控制可见性、安全和隐私。

示例：

```txt
policy-redaction
policy-role-access
policy-pii-filter
policy-secret-filter
policy-external-agent-filter
```

---

## 配置示例

```ts
import { defineContextProject } from '@context-compiler/core'

export default defineContextProject({
  project: {
    name: 'example-shop',
    domains: ['auth', 'order', 'payment', 'inventory'],
    defaultLanguage: 'zh-CN'
  },

  sources: [
    {
      type: 'git',
      name: 'frontend',
      path: './apps/web'
    },
    {
      type: 'git',
      name: 'backend',
      path: './apps/api'
    },
    {
      type: 'openapi',
      name: 'api-spec',
      path: './openapi.yaml'
    },
    {
      type: 'markdown',
      name: 'product-docs',
      path: './docs/product'
    },
    {
      type: 'markdown',
      name: 'test-cases',
      path: './docs/tests'
    }
  ],

  roles: {
    product: {
      include: ['requirement', 'business_rule', 'decision', 'diagnostic']
    },
    frontend: {
      include: ['requirement', 'design_spec', 'api_contract', 'ui_component', 'test_case']
    },
    backend: {
      include: ['requirement', 'api_contract', 'domain_model', 'database', 'test_case', 'bug']
    },
    tester: {
      include: ['requirement', 'acceptance_criteria', 'test_case', 'bug', 'risk']
    },
    reviewer: {
      include: ['*'],
      diagnostics: true
    }
  },

  policies: {
    redact: [
      'secret',
      'access_token',
      'phone_number',
      'email',
      'id_card'
    ],
    deprecatedHandling: 'warn',
    conflictHandling: 'diagnose'
  },

  emitters: [
    {
      type: 'markdown',
      outputDir: '.context/views'
    },
    {
      type: 'jsonl',
      outputDir: '.context/graph'
    },
    {
      type: 'mcp',
      port: 3921
    }
  ]
})
```

---

## MCP 集成

Context Compiler 可以通过 MCP Server 向 AI Agent 暴露项目上下文。

可能的 MCP tools：

```txt
get_project_brief
get_role_view
get_domain_context
get_task_context
search_context
get_related_nodes
get_requirement
get_api_context
get_test_coverage
get_diagnostics
explain_trace
```

请求示例：

```json
{
  "tool": "get_task_context",
  "input": {
    "task": "支持订单部分退款",
    "role": "backend",
    "maxTokens": 12000
  }
}
```

响应示例：

```json
{
  "summary": "...",
  "requirements": [],
  "businessRules": [],
  "apis": [],
  "services": [],
  "databaseTables": [],
  "tests": [],
  "risks": [],
  "recommendedChecks": []
}
```

---

## Context Governance

Context Compiler 将上下文视为需要治理的工程资产，而不是简单检索结果。

每个上下文块都应该携带元数据，例如：

```txt
source URI
source type
author
created time
updated time
status
confidence
authority level
effective time
deprecation state
owner role
```

这样 AI Agent 才能知道：

* 这条上下文来自哪里；
* 它是否仍然有效；
* 它是正式版本还是草稿；
* 它是否和其他资料冲突；
* 当前 Agent 是否有权限看到它；
* 它是否应该被当成 source of truth 使用。

---

## Context Priority

不同来源代表不同类型的事实。

例如：

```txt
代码代表当前行为；
PRD 代表期望行为；
测试代表已验证行为；
设计代表目标体验；
缺陷代表历史风险；
决策记录代表架构约束。
```

Context Compiler 不应该简单假设某一种来源永远覆盖另一种来源。

它应该识别冲突，并将冲突作为诊断结果暴露出来。

---

## 安全与隐私

Context Compiler 应该支持：

* 密钥检测；
* PII 脱敏；
* 基于角色的上下文访问控制；
* 数据源级权限；
* 外部 Agent 过滤；
* 审计记录；
* 人工修正；
* 来源追溯。

当上下文会被外部 AI 服务或第三方 Agent 使用时，这一点尤其重要。

---

## 使用场景

### AI Coding

在编码前生成具体任务的前端或后端上下文。

```bash
context task "增加登录验证码过期处理" --role backend
```

### PR Review

基于代码变更生成 Review Context。

```bash
context diff --from main --to feature/login-code-expiration
```

Reviewer Agent 可以检查本次变更是否符合：

* 需求；
* 设计说明；
* 接口契约；
* 测试用例；
* 历史缺陷；
* 业务规则。

### 测试生成

根据验收标准和历史缺陷生成测试上下文。

```bash
context task "为退款重试生成回归测试" --role tester
```

### 需求评审

检查 PRD 是否具备足够的实现和测试信息。

```bash
context validate --source prd-order-refund-v3
```

### 新人或 AI Agent Onboarding

生成项目摘要和领域导览。

```bash
context view project
context view backend
```

---

## 与代码知识图谱工具的区别

Context Compiler 和代码理解、代码知识图谱工具相关，但关注点不同。

代码知识图谱工具帮助 AI 理解代码结构。

Context Compiler 试图帮助 AI 理解完整软件项目。

```txt
Codebase understanding:
code -> graph -> search/explain/visualize

Context Compiler:
product/design/code/test/bugs/logs -> context graph -> role views/task context/diagnostics -> multi-agent collaboration
```

简单来说：

> 代码知识图谱工具帮助 AI 看懂代码。
> Context Compiler 帮助 AI 看懂项目，并按角色正确工作。

---

## 当前状态

本项目当前处于 RFC / 实验设计阶段。

初始目标是构建一个最小可用编译器，支持：

* Markdown PRD；
* OpenAPI 文档；
* 本地 Git 仓库；
* 源码符号提取；
* Markdown 或表格测试用例；
* 需求到接口的关联；
* 接口到代码的关联；
* 需求到测试的关联；
* 角色视图生成；
* 基础诊断能力。

---

## Roadmap

### Phase 0: RFC

* 定义核心概念；
* 定义上下文 Schema；
* 定义图谱模型；
* 定义插件接口；
* 定义 CLI 方案。

### Phase 1: Local MVP

* 本地 Markdown 数据源；
* Git 数据源；
* OpenAPI 解析器；
* 基础 TypeScript 源码解析；
* 使用 JSONL 或 SQLite 存储 Context Graph；
* Markdown Role View 输出；
* 基础诊断能力。

### Phase 2: Task Context

* 任务级上下文生成；
* Diff 影响分析；
* Reviewer Context；
* Test Context；
* Agent-ready context packs。

### Phase 3: MCP Server

* MCP Tool Server；
* 动态上下文查询；
* Agent 集成；
* Claude Code / Cursor / Codex Adapter。

### Phase 4: Multi-source Connectors

* Figma Connector；
* 飞书 / Notion / Confluence Connector；
* Jira / Linear Connector；
* 测试管理平台 Connector；
* CI Report Connector。

### Phase 5: Context Governance

* Provenance Viewer；
* 冲突检测；
* 人工 Override；
* 基于角色的访问控制；
* PII 和 Secret 脱敏；
* Context Health Dashboard。

---

## 参与贡献

Context Compiler 是一次面向 AI 原生软件工程基础设施的开放探索。

欢迎在以下方向贡献：

* 上下文 Schema 设计；
* 图谱模型设计；
* Connector 插件；
* Parser 插件；
* Validator 规则；
* Role View 模板；
* MCP 集成；
* AI Agent 工作流设计；
* 示例项目和案例研究。

如果你关注 AI coding agent、软件工程协作、Context Engineering、知识图谱、开发者工具或多 Agent 协作，这个项目会很适合你参与。

---

## License

TBD.

---

## 项目愿景

软件工程不只是代码。

它是一张由需求、设计、接口、服务、测试、缺陷、决策、约束和人共同组成的网络。

AI Agent 要想可靠地参与软件工程，就需要理解这张网络。

Context Compiler 的目标，就是让这张网络变得显式、结构化、可追溯、可治理、可被 AI 使用。

> From code repository to AI-collaborative project workspace.
