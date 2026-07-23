# 构建流程

## 总览

构建流程不是一次性让模型理解全部项目。

它应该是逐层保真、逐层推断：

```txt
资料登记
  -> MIME / 扩展名 shortlist + probe 选择 portable Normalizer
  -> A→B Source 标准化
  -> 结构解析
  -> 证据定位
  -> 事实抽取
  -> Scope 横切归属
  -> EffectiveScope 计算
  -> SemanticEdge 构建
  -> 外部 store 索引
  -> .context/sources cleaned source 投影
  -> context() 动态查询能力
```

## 1. 资料登记

登记所有来源，不丢资料。

输出：

```txt
SourceRecord
SourceSnapshot
NormalizedSource
SourceRef
```

如果 Source 层能明确 Scope，可以先建立 ScopeAssignment。

例如用户明确标注：

```txt
repo-order-service -> A电商平台 / 订单服务
```

这可以向下继承。

如果 Source 内容混杂，不要给整份 Source 建可继承 Scope。

## 1.5. Source 标准化

每个 SourceSnapshot 都应该尽量生成 `NormalizedSource`。

标准化目标：

```txt
让解析器可以稳定处理。
让 Agent 可以 Read / Grep。
让证据可以定位到规范化内容和原始来源。
```

不同类型策略：

```txt
源码:
  原样保留，必要时只写 pointer。

Markdown / txt:
  统一编码、换行和路径。

PDF / PPT / DOC / 图片:
  生成 Markdown 或 HTML。
  保留 page / slide / bbox / OCR / assets 映射。

Excel / CSV:
  生成表格投影和 Markdown 目录页。

OpenAPI / JSON / YAML:
  原样保留 + 可读摘要。
```

标准化路由与实现分离：

```txt
context.config.json
  -> 显式覆盖 / MIME / extension 形成候选
  -> probe confidence 与 priority 决定 normalizerId
  -> InputSource → Normalizer → ArtifactSink → NormalizationReport
  -> 输出带 ArtifactRef / FormatId / mediaType / extension 的 NormalizedSource
  -> StructureParserRegistry 按标准化后缀选择解析器
```

扩展名配置不能凭空声明转换能力；配置引用的 `normalizerId` 与 `parserId` 必须由已安装 crate 注册。没有对应 Structure Parser 时，标准化结果仍可保存和投影，Structure 阶段跳过该文件并产生诊断。

结构层由 Compiler 通过 Artifact Reader 分块读取 `NormalizedSource.primary`；Parser 不读取物理路径或 SQLite。Parser 输出确定性私有 Structure Artifact、units 与 relations，Compiler 原子提交 canonical 记录。Evidence Processor 再通过 Resolver 获取精确正文。Normalizer 可以对源码做恒等标准化。所有结果必须能回到 SourceSnapshot。

## 2. 结构解析

按资料类型解析结构。

输出：

```txt
StructureRef
```

结构层可以产生更局部的 ScopeAssignment。

例如：

```txt
Markdown 标题 "# A 电商退款"
OpenAPI path "/api/a/refund"
代码 package "com.a.order"
Excel sheet "v2.3退款规则"
```

## 3. 证据定位

从结构中定位可引用证据。

输出：

```txt
EvidenceRef
```

Evidence 继承 Source 和 Structure 的 Scope，也可以补充或阻断。

证据必须能返回局部原文。

## 4. 事实抽取

从 Evidence 抽取小事实。

输出：

```txt
FactRef
```

Fact 优先继承上游 Scope。

只有当上游 Scope 缺失、冲突或太粗时，才做 Fact 级 Scope 推断。

## 5. Scope Graph

写入：

```txt
Scope
ScopeAssignment
ScopeRelation
```

计算：

```txt
EffectiveScope
```

EffectiveScope 是查询索引，不一定是 canonical 边。

它需要保留来源解释：

```txt
from Source
from Structure
from Evidence
from Fact
from ScopeRelation
```

## 6. Semantic Graph

在 FactRef 上构建语义关系：

```txt
SemanticEdge: FactRef -> FactRef
```

Scope 只参与候选过滤、置信度、冲突判断和显露排序。

Scope 不作为 SemanticEdge 端点。

## 7. 索引

索引用于召回和加速。

建议索引：

```txt
全文索引
符号索引
Source -> Structure -> Evidence -> Fact 链索引
Fact -> EffectiveScope 索引
Scope -> Fact 索引
Fact -> SemanticEdge 邻接索引
Evidence 反查索引
```

索引不是权威数据。

## 8. .context/sources 投影

从 SourceRecord、SourceSnapshot、NormalizedSource 生成 Agent 可读的 cleaned source 工作区：

```txt
.context/sources
```

这是 Agent 核对原文和局部 Grep 的入口。

事实、证据、Scope、语义关系和索引默认不投影到 `.context`。

它们写入外部 store，由 `context()` 查询。

## 9. 增量更新

更新链路天然支持增量：

```txt
SourceSnapshot 变了
  -> 影响对应 Structure
  -> 影响 Evidence
  -> 影响 Fact
  -> 影响 ScopeAssignment / EffectiveScope
  -> 影响 SemanticEdge
  -> 刷新外部 store 索引
  -> 刷新受影响的 .context/sources normalized projection
```

结构、证据、事实、Scope、语义都应该能判断 stale。

自动更新应该是工作区策略，而不是独立主命令。

推荐默认：

```txt
autoUpdate.enabled = true
autoUpdate.mode = on_demand
```

含义：

```txt
context build:
  默认检测变化并做增量刷新。

context status / context doctor:
  可以报告 stale 状态和影响范围。

运行中的 context() runtime / MCP / Agent helper:
  可以在配置允许时监听文件变化，debounce 后自动刷新。

没有运行中进程:
  不启动隐藏全局后台 daemon。
```

## 10. 修正闭环

用户或 Agent 可以反馈：

```txt
事实错误
证据不支持
Scope 归属错误
语义关系错误
过期信息
冲突未显露
```

修正不直接覆盖历史。

应该生成 correction record，再由构建流程重放。
