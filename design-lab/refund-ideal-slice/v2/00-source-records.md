# 00 Source Records

Source 层负责登记资料。

它只回答：

```txt
有哪些资料？
资料在哪里？
资料是什么类型？
资料当前版本是什么？
资料有哪些可用于后续推断的边界线索？
```

Source 层不负责确认业务域、系统、服务、团队、能力归属。归属确认属于 Scope 层。

## 设计结论

v2 中，Source 层拆成三个记录类型：

```txt
SourceRecord
  资料的稳定身份。

SourceSnapshot
  某一次内容版本和指纹。

SourceHint
  从路径、标题、元数据、仓库名等顺手记录的弱候选边界线索。

SourceRelationship
  来源和来源之间的显式关系。
```

这样拆的原因：

- 文件可能移动、改名，但资料身份应尽量稳定。
- 文件内容会变化，内容版本必须单独记录。
- 路径、标题、仓库名里的业务线索很有价值，但不一定准确，只能作为后续构建 Scope 层的参考。
- 后续 EvidenceRef、FactRef、ScopeAssignment 都需要能追到具体 source 和 snapshot。

## 身份和快照规则

SourceRecord 跟“资料身份”走。

SourceSnapshot 跟“内容版本”走。

路径和文件名只是位置属性，不是身份本身。内容哈希是强内容证据，但不永远等于强身份证据，因为同一份内容也可能被复制成两份资料。

推荐判定规则：

| 场景 | SourceRecord | SourceSnapshot | 说明 |
|---|---|---|---|
| 路径不变，文件名不变，内容变了 | 复用原 SourceRecord | 新增 SourceSnapshot | 典型内容更新。 |
| 路径或文件名变化，内容 hash 相同，旧位置不存在 | 更新原 SourceRecord 的 `uri` 和 `uriHistory` | 不新增 SourceSnapshot | 可判定为移动或改名。 |
| 路径或文件名变化，内容 hash 相同，旧位置仍存在 | 新建 SourceRecord | 可复用相同内容 hash 的新 SourceSnapshot，或创建指向同 hash 的快照 | 更像复制，不应直接合并身份。 |
| 路径或文件名变化，内容也变化，但有 native id 或 git rename 等确定性身份依据 | 复用原 SourceRecord | 新增 SourceSnapshot | 可判定为同一资料迁移后更新。 |
| 无法用路径、内容 hash、native id 或 git rename 匹配到旧 SourceRecord | 新建 SourceRecord | 新增 SourceSnapshot | 新资料。 |

这意味着：

```txt
只改内容:
  SourceRecord 不变
  SourceSnapshot 新增

只改路径或文件名:
  如果能确认是移动/改名，SourceRecord 更新位置
  SourceSnapshot 不一定新增

路径、文件名、内容都变:
  需要 native id 或 git rename 等确定性身份依据才能复用 SourceRecord
  否则新建 SourceRecord
```

## 非职责

Source 层不做：

- 不抽取事实。
- 不切证据入口。
- 不确认 ScopeAssignment 归属边。
- 不表达语义关系。
- 不判断 A 系统和 B 系统的同名资料是否相同。
- 不删除暂时无法分类的资料。

## Schema

### SourceRecord

资料稳定身份。

```json
{
  "id": "source:doc:refund-rules",
  "recordType": "SourceRecord",
  "kind": "markdown_document",
  "uri": "raw/product-refund-rules.md",
  "title": "A 电商平台订单退款规则",
  "mediaType": "text/markdown",
  "containerRef": null,
  "uriHistory": [],
  "origin": {
    "sourceSystem": "local_filesystem",
    "root": "design-lab/refund-ideal-slice/raw"
  },
  "currentSnapshotRef": "snapshot:doc:refund-rules:sha256-demo",
  "currentAccessStatus": "available",
  "discoveredBy": "filesystem_scan",
  "discoveredAt": "2026-06-11T00:00:00+08:00",
  "status": "observed"
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `id` | 资料稳定 ID | 尽量不随内容变化而变化。 |
| `recordType` | 记录类型 | 固定为 `SourceRecord`。 |
| `kind` | 资料类型 | 决定后续走什么 parser，例如 markdown、openapi、typescript、csv。 |
| `uri` | 资料位置 | 可以是本地路径、仓库路径、URL、对象存储地址。 |
| `title` | 可读标题 | 来自文件名、文档标题或元数据。 |
| `mediaType` | 媒体类型 | 用于解析器路由。 |
| `containerRef` | 上级容器 | 可指向 repo、目录、文档集；单文件可为 null。 |
| `uriHistory` | 历史位置 | 记录移动、改名后的旧路径。 |
| `origin` | 来源入口 | 记录 sourceSystem、root、仓库、外部系统等。 |
| `currentSnapshotRef` | 当前内容版本 | 指向最新 SourceSnapshot。 |
| `currentAccessStatus` | 当前访问状态 | available、missing、permission_denied、unreadable。 |
| `discoveredBy` | 发现方法 | 例如 filesystem_scan、git_scan、manual_import。 |
| `discoveredAt` | 发现时间 | 不是内容修改时间。 |
| `status` | 登记状态 | observed、missing、deleted、unreadable、ignored。 |

### SourceSnapshot

资料内容版本。

```json
{
  "id": "snapshot:doc:refund-rules:sha256-demo",
  "recordType": "SourceSnapshot",
  "sourceRef": "source:doc:refund-rules",
  "contentHash": "sha256:demo-refund-rules",
  "sizeBytes": 512,
  "modifiedAt": "2026-06-11T00:00:00+08:00",
  "ingestedAt": "2026-06-11T00:00:00+08:00",
  "versionLabel": "working-copy",
  "captureStatus": "captured"
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `id` | 快照 ID | 一次内容版本一个 ID。 |
| `recordType` | 记录类型 | 固定为 `SourceSnapshot`。 |
| `sourceRef` | 所属资料 | 指回 SourceRecord。 |
| `contentHash` | 内容指纹 | 用于增量构建、过期检测、证据失效判断。 |
| `sizeBytes` | 内容大小 | 用于健康检查和异常检测。 |
| `modifiedAt` | 来源修改时间 | 来自文件系统、Git、外部系统。 |
| `ingestedAt` | 系统接入时间 | Context Compiler 读取该版本的时间。 |
| `versionLabel` | 版本标签 | 可是 git commit、文档版本、working-copy。 |
| `captureStatus` | 快照采集状态 | captured、failed、partial。它描述这次快照采集结果，不代表资料当前是否可访问。 |

### SourceHint

候选边界线索。

SourceHint 不一定准确。

它只是 Source 阶段顺手记录的弱信号，后续 Scope 层可以参考它，但不能直接把它当成 confirmed ScopeAssignment。

一个 SourceRecord 可以产生很多 SourceHint。尤其是全局总结、迁移说明、会议纪要、对比文档，可能同时提到多个系统、团队、业务域、版本和能力。

```json
{
  "id": "sourceHint:doc:refund-rules:system-a-commerce",
  "recordType": "SourceHint",
  "sourceRef": "source:doc:refund-rules",
  "snapshotRef": "snapshot:doc:refund-rules:sha256-demo",
  "facet": "system",
  "value": "A电商平台",
  "method": "title_match",
  "basis": {
    "kind": "title",
    "value": "A 电商平台订单退款规则"
  },
  "status": "candidate",
  "confidence": 0.72
}
```

字段解释：

| 字段 | 含义 | 说明 |
|---|---|---|
| `id` | 线索 ID | 一条候选线索一个 ID。 |
| `recordType` | 记录类型 | 固定为 `SourceHint`。 |
| `sourceRef` | 线索来自哪份资料 | 指向 SourceRecord。 |
| `snapshotRef` | 线索来自哪个版本 | 避免资料变化后线索还被误用。 |
| `facet` | 候选维度 | 例如 system、service、repository、team、version、domain、capability。 |
| `value` | 候选值 | 例如 A电商平台、订单服务、交易团队。 |
| `method` | 产生方法 | path_match、title_match、metadata、repo_name、manual_seed。 |
| `basis` | 线索依据 | Source 阶段还没有 EvidenceRef，所以先记录原始依据。 |
| `status` | 线索状态 | candidate、confirmed_by_config、rejected、stale。 |
| `confidence` | 线索置信度 | 只表示线索强弱，不等于 ScopeAssignment 确认。 |

SourceHint 常见来源：

| method | basis 示例 | 说明 |
|---|---|---|
| `path_match` | `docs/a-commerce/refund/rules.md` | 从路径片段得到候选系统或能力。 |
| `title_match` | `A 电商平台订单退款规则` | 从标题得到候选系统或能力。 |
| `repo_name` | `repo-order-service` | 从仓库名得到候选服务或仓库。 |
| `metadata` | 文档系统标签、owner、space | 从外部系统元数据得到候选。 |
| `manual_seed` | 用户配置或人工导入 | 人工给定的初始线索。 |

SourceHint 的正确使用方式：

```txt
SourceHint + StructureRef + EvidenceRef + FactRef
  -> ScopeAssignment candidate
  -> confirmed / rejected / stale
```

SourceHint 本身只停留在 candidate 信号层。

### SourceRef

`SourceRef` 不是新的数据实体。

它只是对 Source 层对象的标准引用方式。

最常见的 `SourceRef` 直接指向 SourceRecord：

```json
{
  "kind": "record",
  "sourceId": "source:repo:order-service"
}
```

如果某个关系必须绑定到具体内容版本，可以额外带 snapshot：

```json
{
  "kind": "snapshot",
  "sourceId": "source:doc:refund-rules",
  "snapshotId": "snapshot:doc:refund-rules:sha256-demo"
}
```

原则：

```txt
SourceRecord:
  表示资料身份。

SourceSnapshot:
  表示内容版本。

SourceRef:
  表示外部层引用 SourceRecord 或 SourceSnapshot 的地址。
```

### SourceRelationship

`SourceRelationship` 表达来源之间的关系。

它属于 Source 层，不属于 Scope 层核心对象。

示例：

```json
{
  "id": "sourceRelationship:test-refund:repo-order-service",
  "recordType": "SourceRelationship",
  "fromSourceRef": {
    "kind": "record",
    "sourceId": "source:xls:refund-test-cases"
  },
  "toSourceRef": {
    "kind": "record",
    "sourceId": "source:repo:order-service"
  },
  "relationshipKind": "tests_source",
  "status": "candidate",
  "confidence": 0.78,
  "basisRefs": [
    {
      "buildRef": "evidenceBuild:table:refund-cases:sha256-demo",
      "unitId": "table:evidence:sheet-refund-title"
    }
  ],
  "producedBy": "SourceRelationshipProposer@0.1.0"
}
```

常见关系：

| relationshipKind | 含义 |
|---|---|
| `contains_source` | 来源包含来源 |
| `depends_on_source` | 来源依赖来源 |
| `documents_source` | 文档描述某来源 |
| `tests_source` | 测试覆盖某来源 |
| `calls_source` | 来源调用来源 |
| `migrated_from` | 来源迁移自另一个来源 |
| `candidate_same_as` | 候选同一来源 |

跨来源关系默认是 candidate。

不能因为名称相似或都出现“退款”就 confirmed。

Scope 层可以消费 SourceRelationship，把它作为 ScopeAssignment 或 ScopeRelation 的依据，但不拥有 SourceRelationship。

## 案例

### 产品规则文档

```json
{
  "id": "source:doc:refund-rules",
  "recordType": "SourceRecord",
  "kind": "markdown_document",
  "uri": "raw/product-refund-rules.md",
  "title": "A 电商平台订单退款规则",
  "mediaType": "text/markdown",
  "containerRef": null,
  "uriHistory": [],
  "origin": {
    "sourceSystem": "local_filesystem",
    "root": "design-lab/refund-ideal-slice/raw"
  },
  "currentSnapshotRef": "snapshot:doc:refund-rules:sha256-demo",
  "currentAccessStatus": "available",
  "discoveredBy": "filesystem_scan",
  "discoveredAt": "2026-06-11T00:00:00+08:00",
  "status": "observed"
}
```

对应候选线索：

```json
{
  "id": "sourceHint:doc:refund-rules:system-a-commerce",
  "recordType": "SourceHint",
  "sourceRef": "source:doc:refund-rules",
  "snapshotRef": "snapshot:doc:refund-rules:sha256-demo",
  "facet": "system",
  "value": "A电商平台",
  "method": "title_match",
  "basis": {
    "kind": "title",
    "value": "A 电商平台订单退款规则"
  },
  "status": "candidate",
  "confidence": 0.72
}
```

```json
{
  "id": "sourceHint:doc:refund-rules:capability-order-refund",
  "recordType": "SourceHint",
  "sourceRef": "source:doc:refund-rules",
  "snapshotRef": "snapshot:doc:refund-rules:sha256-demo",
  "facet": "capability",
  "value": "订单退款",
  "method": "title_match",
  "basis": {
    "kind": "title",
    "value": "A 电商平台订单退款规则"
  },
  "status": "candidate",
  "confidence": 0.68
}
```

### 代码文件

```json
{
  "id": "source:code:refund-service",
  "recordType": "SourceRecord",
  "kind": "typescript_file",
  "uri": "raw/refund-service.ts",
  "title": "refund-service.ts",
  "mediaType": "text/typescript",
  "containerRef": "source:repo:order-service",
  "uriHistory": [],
  "origin": {
    "sourceSystem": "local_filesystem",
    "root": "design-lab/refund-ideal-slice/raw"
  },
  "currentSnapshotRef": "snapshot:code:refund-service:sha256-demo",
  "currentAccessStatus": "available",
  "discoveredBy": "filesystem_scan",
  "discoveredAt": "2026-06-11T00:00:00+08:00",
  "status": "observed"
}
```

对应候选线索：

```json
{
  "id": "sourceHint:code:refund-service:repository-order-service",
  "recordType": "SourceHint",
  "sourceRef": "source:code:refund-service",
  "snapshotRef": "snapshot:code:refund-service:sha256-demo",
  "facet": "repository",
  "value": "repo-order-service",
  "method": "container_ref",
  "basis": {
    "kind": "containerRef",
    "value": "source:repo:order-service"
  },
  "status": "candidate",
  "confidence": 0.8
}
```

## 为什么不用 v1 的 sourceBoundary

v1 写法：

```json
{
  "sourceBoundary": {
    "systemHint": "A电商平台",
    "domainHint": "订单退款"
  }
}
```

问题：

- 多个 hint 被塞进一个对象，无法单独标记来源、方法、置信度和状态。
- 看起来像已经确认的归属，容易和 confirmed ScopeAssignment 混淆。
- 资料变更后无法判断哪条 hint 过期。
- 不适合路径、标题、元数据、人工种子同时产生多个候选线索。

v2 改成独立 SourceHint 后，每条候选线索都可以被确认、驳回、过期和追踪。

## 文件变化案例

### 内容更新

```txt
raw/product-refund-rules.md 内容变化
路径不变
```

结果：

```txt
SourceRecord:
  id 不变
  uri 不变
  currentSnapshotRef 指向新快照

SourceSnapshot:
  新增一条
```

### 移动或改名

```txt
raw/product-refund-rules.md
  -> raw/docs/a-commerce/refund-rules.md
内容 hash 不变
旧路径不存在
```

结果：

```txt
SourceRecord:
  id 不变
  uri 更新为新路径
  uriHistory 追加旧路径

SourceSnapshot:
  不需要新增
```

### 复制

```txt
raw/product-refund-rules.md 仍存在
raw/backup/product-refund-rules.md 新增
内容 hash 相同
```

结果：

```txt
SourceRecord:
  新建一条 backup source

SourceSnapshot:
  可以记录相同 contentHash
```

### 路径和内容都变化

```txt
raw/product-refund-rules.md
  -> raw/docs/refund-v2.md
内容也变化
```

结果：

```txt
如果有 git rename 或 native id:
  复用 SourceRecord
  新增 SourceSnapshot

否则:
  新建 SourceRecord
  新增 SourceSnapshot
```

## 和下一层的关系

SourceRecord 进入结构层：

```txt
SourceSnapshot -> TypeProcessor.buildStructure() -> StructureRef
```

SourceSnapshot 进入证据层：

```txt
StructureRef -> EvidenceResolver -> EvidenceRef
```

SourceHint 进入 Scope 推断：

```txt
SourceHint + SourceRef / StructureRef / EvidenceRef / FactRef
  -> ScopeAssignment candidate
```

Source 层只提供线索和来源关系，不直接确认最终 Scope 归属。

如果来源本身范围非常明确，例如一个仓库明确属于某个系统，Scope 层可以基于 SourceRecord 产生：

```txt
SourceRef -> Scope
```

但这仍然是 Scope 层的 `ScopeAssignment`，不是 Source 层自己的结论。
