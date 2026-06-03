# Context Compiler

> 为 AI Coding Agent 生成项目级上下文运行时工作区。

**Context Compiler** 是一个面向 AI 协作型软件工程的 Context Engineering 实验项目。

它尝试将产品文档、设计说明、代码仓库、接口定义、测试用例、历史缺陷、会议纪要和运行日志等项目资料，编译成 `.context/` 工作区，其中包含上下文产物、项目图谱、JSON 索引、运行时 providers、MCP tools、项目级 skills、诊断信息和 Agent 集成配置。

用户不应该手写 runtime 层。用户补充的项目资料越完整，Context Compiler 就越能自动推断出最适配 Codex、Claude Code 或其他 coding agent 的 `.context/` 工作区。

这个项目的目标不是替代产品经理、设计师、开发、测试或 Reviewer。

它的目标是减少低效的上下文转述，让 AI Agent 能够在真实软件项目中理解正确的背景、约束、关系、可信来源和项目级动态查询能力。

---

## 当前架构

Context Compiler 现在采用 **稳定内核 + 可替换组件 + 自动规划的项目级 Pipelines** 的架构。

```txt
Components = 可安装、可贡献、可替换的能力库存
Pipelines  = 编译器根据已知 sources 自动生成的执行计划，决定启用哪些组件以及按什么顺序运行
Kernel     = 稳定执行内核，只负责装配、调度、校验、诊断和产物管理
```

编译流水线按阶段组织：

```txt
Resolve
  -> Ingest
  -> Parse
  -> Normalize
  -> Classify
  -> Enrich
  -> Link
  -> Validate
  -> Govern
  -> Compress
  -> Emit
```

`Resolve` 是内核阶段，不作为普通组件开放。其他阶段都可以替换：例如 `Ingest` 可以接本地文件、GitHub、飞书、Figma、Jira；`Link` 可以使用内置规则、企业自定义规则、Neo4j、GraphRAG、Sourcegraph、CodeQL 或其他成熟开源方案的 adapter。

官方默认实现也只是普通 components。当前本地发行版 `@context-compiler/distribution-local` 提供本地组件库存，并根据 Markdown、OpenAPI、源码等 source 类型自动规划默认 `compile` pipeline。

更多细节见：

* [Pipeline Architecture](./docs/architecture/pipeline-architecture.md)
* [Component API](./docs/sdk/component-api.md)
* [Pipeline Examples](./docs/examples/pipelines.md)
* [Project Structure](./docs/architecture/project-structure.md)

---

## 快速开始

```bash
pnpm install
pnpm test
pnpm typecheck

# 创建 context.config.json
pnpm --filter @context-compiler/cli exec context init

# 编译本地项目上下文
pnpm --filter @context-compiler/cli exec context compile

# 查看、查询和解释编译后的运行时上下文
pnpm --filter @context-compiler/cli exec context view implementation
pnpm --filter @context-compiler/cli exec context query refund
pnpm --filter @context-compiler/cli exec context explain REQ-ORDER-REFUND-001
pnpm --filter @context-compiler/cli exec context doctor

# 生成任务上下文
pnpm --filter @context-compiler/cli exec context task "支持订单部分退款" --focus implementation --module refund

# 从 CLI binary 启动项目 MCP Server
pnpm --filter @context-compiler/cli exec context mcp start
```

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
5. 输出上下文视图、任务上下文、诊断报告和 Agent Skill Pack；
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
Context Views / Task Context / Diagnostics / Agent Skill Packs
   ↓
Product Agent / Design Agent / Frontend Agent / Backend Agent / Test Agent / Reviewer Agent
```

核心原则是：

> AI 不应该直接消费混乱的人类资料。
> AI 应该消费经过编译的、结构化的、可追溯的、按任务焦点组织的项目上下文。

---

## Context Compiler 生成什么？

Context Compiler 可以生成多种上下文产物。

### 1. Project Brief

项目级摘要，包括：

* 项目目标；
* 业务领域；
* 用户群体或业务画像；
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

### 3. Context Views

不同任务需要同一张项目图谱的不同切片。

Context Compiler 根据已有内容推断上下文视图，而不是让用户配置角色：

* `project`：工作区总览和项目级上下文；
* `implementation`：面向编码实现的需求、接口、代码符号、测试和风险；
* `review`：面向评审的全图信息和诊断；
* `testing`：面向测试的需求、验收标准、测试用例、缺陷和风险；
* `product`：存在产品内容时生成；
* `design`：存在设计内容时生成。

示例：

```txt
.context/views/product.md
.context/views/design.md
.context/views/project.md
.context/views/implementation.md
.context/views/review.md
.context/views/testing.md
```

### 4. Task Context

针对具体任务，Context Compiler 可以生成聚焦的任务上下文包。

示例：

```bash
context task "支持订单部分退款" --focus implementation
```

可能输出：

```txt
.context/tasks/support-partial-refund.implementation.md
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
│ Context Views / Task Context / Diagnostics      │
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
* 视图级；
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
    implementation.md
    review.md
    testing.md
    product.md
    design.md

  tasks/
    TASK-1234.implementation.md
    TASK-1234.testing.md

  graph/
    nodes.jsonl
    edges.jsonl
    diagnostics.jsonl

  indexes/
    manifest.json
    symbols.json
    apis.json
    search.json

  runtime/
    runtime-plan.json
    runtime.config.json
    agent-install-plan.json
    trace.jsonl
    run-summary.json
    providers/

  mcp/
    server.config.json
    tools.json

  tools/
  skills/

  agents/
    codex/
      AGENTS.generated.md
    claude/
      CLAUDE.generated.md
    cursor/
      rules/

  plugins/
  diagnostics/
    context-health.json
```

---

## Context Manifest 示例

```json
{
  "schemaVersion": "context-runtime.v1",
  "workspace": {
    "rootDir": "/repo/examples/local-shop",
    "name": "local-shop",
    "configPath": "/repo/examples/local-shop/context.config.json"
  },
  "compiledAt": "2026-06-02T10:00:00Z",
  "compilerVersion": "0.1.0",
  "pipeline": "compile",
  "graph": {
    "nodes": ".context/graph/nodes.jsonl",
    "edges": ".context/graph/edges.jsonl",
    "diagnostics": ".context/graph/diagnostics.jsonl"
  },
  "indexes": {
    "symbols": ".context/indexes/symbols.json",
    "apis": ".context/indexes/apis.json",
    "search": ".context/indexes/search.json"
  },
  "packs": [
    { "id": "context-view:project", "kind": "context-view", "view": "project" },
    { "id": "context-view:implementation", "kind": "context-view", "view": "implementation" }
  ],
  "runtime": {
    "plan": ".context/runtime/runtime-plan.json",
    "config": ".context/runtime/runtime.config.json",
    "trace": ".context/runtime/trace.jsonl",
    "runSummary": ".context/runtime/run-summary.json",
    "agentInstallPlan": ".context/runtime/agent-install-plan.json",
    "freshness": { "status": "fresh", "checkedAt": "2026-06-02T10:00:00Z" },
    "installStatus": { "codex": "planned", "claude": "planned" },
    "capabilitySurfaces": {
      "codex": ["AGENTS.md", ".codex/config.toml", ".agents/skills", ".codex/agents"],
      "claude": ["CLAUDE.md", ".mcp.json", ".claude/skills", ".claude/settings.json"]
    },
    "providers": [],
    "tools": ["context-compile", "context-doctor", "context-task-implementation", "context-task-testing", "context-review"],
    "skills": ["implementation", "testing", "review", "product"],
    "agents": ["codex", "claude", "cursor"],
    "plugins": ["context-compiler-local"],
    "mcp": {
      "serverConfig": ".context/mcp/server.config.json",
      "tools": ".context/mcp/tools.json"
    }
  },
  "diagnostics": {
    "health": ".context/diagnostics/context-health.json",
    "graph": ".context/graph/diagnostics.jsonl"
  }
}
```

---

## Context View 示例

```md
# Implementation Context

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

## CLI

```bash
# 初始化项目
context init

# 同步当前 sources 到 parser-ready manifest
context sync

# 编译项目上下文
context compile

# 检查上下文质量
context validate

# 生成上下文视图
context view implementation

# 生成任务上下文
context task "支持订单部分退款" --focus implementation

# 安装 Codex 和 Claude Code 原生集成文件
context integrate all

# 解释某个上下文项的来源
context explain REQ-ORDER-REFUND-001

# 查看本地 inventory / symbol index 输出
context inventory
context index
```

---

## Component System

Context Compiler 的扩展单元是 **component**，不是一个泛泛的 plugin 目录。每个 component 属于一个明确的流水线阶段，并通过标准 artifact 与其他阶段通信。

### Ingest Components

从人类工作源采集资料，输出 `RawArtifact`。

示例：

```txt
ingest.local-files
ingest.git
ingest.github
ingest.feishu
ingest.notion
ingest.confluence
ingest.figma
ingest.jira
ingest.linear
ingest.ci-report
```

### Parse Components

解析原始内容，输出 `ParsedArtifact`。

示例：

```txt
parse.markdown
parse.docx
parse.html
parse.openapi
parse.source-code
parse.xlsx
parse.figma
```

### Normalize / Classify Components

将来源特定结构转成统一记录，并进一步分类为需求、接口、测试、缺陷、代码符号等语义事实。

示例：

```txt
normalize.markdown-doc
normalize.openapi-contract
normalize.code-symbol
classify.context-facts
classify.enterprise-llm
```

### Enrich / Link Components

补充 inventory、symbol index、外部索引，或构建图谱关系。Link 可以是内置规则，也可以是成熟图谱/RAG/代码智能方案的 adapter。

示例：

```txt
enrich.inventory
enrich.symbol-index
enrich.sourcegraph
link.default-rules
link.neo4j-adapter
link.graph-rag
link.codeql-adapter
link.enterprise-rules
```

### Validate / Govern Components

检查上下文质量，并在输出前执行治理策略。

示例：

```txt
validate.default-rules
validate.api-mismatch
validate.conflicting-rules
govern.redaction
govern.policy-access
govern.pii-filter
govern.external-agent-filter
```

### Compress / Emit Components

生成上下文视图、任务上下文、Agent 包、MCP 数据或文件报告。

示例：

```txt
compress.context-view
compress.task-context
compress.runtime-plan
compress.reviewer-context
emit.files
emit.mcp
emit.codex
emit.cursor
emit.html-report
```

---

## 配置示例

```ts
import { defineContextProject } from '@context-compiler/core'

export default defineContextProject({
  sources: [
    {
      type: 'markdown',
      name: 'product-docs',
      path: './sources/product-docs'
    },
    {
      type: 'openapi',
      name: 'api-spec',
      path: './sources/api-spec/openapi.yaml'
    },
    {
      type: 'code',
      name: 'source',
      path: './sources/source-code'
    },
    {
      type: 'markdown',
      name: 'test-cases',
      path: './sources/test-cases'
    }
  ],

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
  }
})
```

`project`、`roles`、`profiles`、`pipelines` 都不会出现在普通用户配置里。`context.config.json` 所在目录就是 workspace，编译器会根据已有 source 内容推断项目元信息、本地 compile pipeline、上下文视图、runtime plan 和任务上下文。

---

## MCP 集成

Context Compiler 可以通过 MCP Server 向 AI Agent 暴露项目上下文。

可能的 MCP tools：

```txt
get_project_brief
get_context_view
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
    "focus": "implementation",
    "maxTokens": 12000
  }
}
```

响应示例：

```json
{
  "data": {
    "task": "支持订单部分退款",
    "focus": "implementation",
    "nodes": [],
    "edges": [],
    "recommendedChecks": []
  },
  "evidence": [],
  "freshness": { "status": "fresh" },
  "diagnostics": []
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
source owner or team
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
* 基于来源和任务焦点的上下文访问控制；
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
context task "增加登录验证码过期处理" --focus implementation
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
context task "为退款重试生成回归测试" --focus testing
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
context view implementation
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
product/design/code/test/bugs/logs -> context graph -> context views/task context/diagnostics -> multi-agent collaboration
```

简单来说：

> 代码知识图谱工具帮助 AI 看懂代码。
> Context Compiler 帮助 AI 看懂项目，并按任务焦点正确工作。

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
* 上下文视图生成；
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
* Markdown Context View 输出；
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
* 基于来源、策略和任务焦点的访问控制；
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
* Context View 模板；
* MCP 集成；
* AI Agent 工作流设计；
* 示例项目和案例研究。

如果你关注 AI coding agent、软件工程协作、Context Engineering、知识图谱、开发者工具或多 Agent 协作，这个项目会很适合你参与。

---

## License

License will be selected before the first public release.

---

## 项目愿景

软件工程不只是代码。

它是一张由需求、设计、接口、服务、测试、缺陷、决策、约束和人共同组成的网络。

AI Agent 要想可靠地参与软件工程，就需要理解这张网络。

Context Compiler 的目标，就是让这张网络变得显式、结构化、可追溯、可治理、可被 AI 使用。

> From code repository to AI-collaborative project workspace.
