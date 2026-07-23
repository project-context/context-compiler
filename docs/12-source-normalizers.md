# Source Normalizer 扩展系统

## 两个边界

标准化系统分成独立能力与宿主适配两部分：

```txt
normalizers/ 独立 Workspace
  InputSource
  -> Factory / probe / configured Normalizer
  -> ArtifactSink
  -> NormalizationReport

context-source adapter
  portable output
  -> SourceSnapshot / RevisionRef / Locator / NormalizedSource
  -> canonical store 与 .context/sources
```

独立 Workspace 不依赖 `context-source`、`context-protocol`、SQLite 或 Compiler。Context Compiler 可以使用它，其他平台也可以直接注册同一批转换器。

完整的跨平台 API、格式选择矩阵、输出契约和新增转换器说明见 [normalizers/README.md](../normalizers/README.md)。

## 为什么不统一转 Markdown

目标不是产出一种看起来整齐的文件，而是让 AI Agent 用现有工具最快、最准确地取证：

```txt
连续正文、业务规则       -> Markdown
源代码                   -> 原始源码格式
复杂表格、富文档、版面   -> 语义化 HTML
大型行式数据             -> CSV / JSONL
小型机器结构             -> 规范化 JSON / YAML
```

Markdown 对 Read、grep、rg、sed 和 token 成本通常最好，但复杂表格强转 Markdown 会损失语义，源码强转 Markdown 会破坏位置和工具生态。因此 `NormalizedFormat` 除了 format、media type 和 extension，还携带：

```txt
RetrievalProfile
ToolSupport.read
ToolSupport.grep
ToolSupport.sed
ToolSupport.lineOriented
```

宿主平台可以根据检索任务、文件大小和工具能力选择合适的映射。

## 可迁移目录

```txt
normalizers/
  Cargo.toml
  Cargo.lock
  rust-toolchain.toml
  rustfmt.toml
  justfile
  README.md
  schema/normalizer.v1.schema.json
  .github/workflows/ci.yml

  core/           agent-file-normalizer
  markdown/       agent-file-normalizer-markdown
  typescript/     agent-file-normalizer-typescript
  html/           agent-file-normalizer-html
  text-markdown/  agent-file-normalizer-text-markdown
  pdf-markdown/   agent-file-normalizer-pdf-markdown
  pdf-html/       agent-file-normalizer-pdf-html
  test-support/   agent-file-normalizer-test-support
```

根 Cargo Workspace 使用 `exclude = ["normalizers"]`，再通过 path dependency 消费其中 crate。这样子目录拥有独立 Cargo.lock 和测试生命周期；未来复制目录内容到新仓库根目录即可直接构建。

独立验证：

```bash
cargo test --manifest-path normalizers/Cargo.toml --workspace --all-targets
cargo clippy --manifest-path normalizers/Cargo.toml \
  --workspace --all-targets --all-features -- -D warnings
```

## Portable Core API

`agent-file-normalizer` 定义：

```txt
FormatId
InputMatcher
NormalizedFormat
AgentFileProfile
NormalizerDescriptor
NormalizerFactory
InputSource / ScratchSpace
ArtifactSink / ArtifactWriter
NormalizationContext
NormalizationReport
NormalizerRegistry
```

`NormalizationRequest` 不包含 Context Compiler 的 EntityRef、RevisionRef 或 SourceRecord。输入通过 `InputSource` 分段读取；必须使用路径的底层库只能向 `ScratchSpace` 请求生命周期受控的 `LeasedPath`。转换器不接收 Workspace 的真实存储目录，也不能把物理路径写进报告。

对象安全异步边界：

```rust
pub trait NormalizerFactory: Send + Sync {
    fn descriptor(&self) -> &NormalizerDescriptor;
    fn config_schema(&self) -> &serde_json::Value;
    fn validate_config(&self, config: &serde_json::Value) -> NormalizerResult<()>;
    fn create(&self, config: &serde_json::Value)
        -> NormalizerResult<Arc<dyn Normalizer>>;
}

pub trait Normalizer: Send + Sync {
    fn descriptor(&self) -> &NormalizerDescriptor;
    fn probe<'a>(&'a self, request: ProbeRequest<'a>)
        -> NormalizerFuture<'a, ProbeResult>;

    fn normalize<'a>(
        &'a self,
        request: NormalizationRequest<'a>,
        context: NormalizationContext<'a>,
    ) -> NormalizerFuture<'a, NormalizationReport>;
}
```

Registry 统一验证：

- 配置引用的实现已经注册；
- Normalizer ID 不重复；
- Factory 配置必须先通过自己的 JSON Schema/类型化校验；
- 输入与输出扩展名安全；
- 主 Artifact 唯一，是无 NUL、统一 LF 的 UTF-8 文本；
- companion path 不能逃出输出 bundle。

`NormalizationReport` 只包含 primary、companions、locator map、诊断和统计，不包含正文或绝对路径。primary 是唯一 canonical 标准化内容；companion 可以保存图片、字体或其它二进制资源。

## Context Compiler Adapter

`context-source::NormalizerRegistry` 包装 portable Registry，但不把 Context 类型泄漏回转换器。Adapter 负责：

- 将 Connector 的 `Vec<u8>` 无复制转换成共享 bytes-backed `InputSource`；
- 注入 ArtifactSink、ScratchSpace、Cancellation、ProgressReporter 和 ResourceLimits；
- 将 `NormalizerIdentity` 转成 `ProducerRef`；
- 提交 content-addressed Artifact 并生成 RevisionRef；
- 在一个 SourceStore 事务内提交 SourceRecord、SourceSnapshot 和 artifact-only NormalizedSource。

文件系统 Artifact Repository 使用 `artifact:sha256:<digest>` 逻辑 URI，实体位于 `artifacts/sha256/<前两位>/<digest>`；`.context/sources` 只是从 Repository 复制出的可读投影。SQLite payload 不保存完整正文。

## 配置

首次 `context build` 在仓库根目录生成可版本控制的 `context.config.json`。旧的 `context.normalizers.json` 只作为兼容输入读取；两个文件同时存在时 canonical 配置优先：

```json
{
  "schemaVersion": 1,
  "sources": [{
    "id": "workspace",
    "connectorId": "local",
    "displayName": "Workspace files",
    "enabled": true,
    "config": { "root": "." },
    "secretRefs": []
  }],
  "normalization": {
    "defaults": [{
      "id": "default-pdf",
      "normalizerId": "pdf-to-markdown",
      "enabled": true,
      "extensions": ["pdf"],
      "mediaTypes": ["application/pdf"],
      "priority": 100
    }],
    "sourceOverrides": [],
    "pathOverrides": []
  }
}
```

配置只负责路由，不能凭空获得转换能力。`normalizerId` 必须由宿主应用注册。优先级固定为“路径/glob > 数据源 > Workspace 默认”，同层按 `priority`；同一优先级命中不同转换器时明确报冲突。

PDF 首版只处理文本层。加密文件返回 `pdf_password_required`，无文本层文件返回 `pdf_ocr_required`。每页输出保存 normalized byte span 到一基页码 `DocumentPage` 的映射；PDF→HTML 即使没有 HTML Processor 也会成功保留 Source 投影，并把后续处理能力显示为 Read-only。

## 身份与增量更新

标准化逻辑身份包含 Source 身份和 mapping ID：

```txt
normalized:{sourceEntityId}:{normalizerId}
```

`normalizerId`、Normalizer 实现版本和规范化配置哈希参与缓存判断。即使原始文件内容没变，切换转换器、配置或升级实现后仍会重新标准化，并让旧标准化结果及受影响下游变为 stale。

投影规则：

```txt
docs/page.html -> .context/sources/docs/page.html
docs/notes.txt -> .context/sources/docs/notes.txt.md
```

Compiler 通过 `.context/source-projections.json` 只清理自己登记的旧投影，不删除用户文件；两个 Source 映射到相同投影路径时明确失败。

## Processor 边界

```txt
portable Normalizer
  A 文件 -> Agent-friendly 标准文件

Structure Parser
  标准 Artifact -> Structure Artifact / Units / Relations

Context Processor
  Resolved Structure -> Evidence / Fact
```

Structure Parser 只读取标准化 Artifact，不解析物理路径。Compiler 根据 `structure.routes[]` 为每个标准化后缀选择一个兼容 Parser，并把 Parser 产物写入 content-addressed Artifact Repository。Evidence / Fact Processor 只消费 Resolver 提供的标准视图。因此 TXT→Markdown、DOCX→Markdown 和 PDF→Markdown 都可以复用 Markdown AST Parser；转换器不应复制 Structure、Evidence、Fact 逻辑。

新增转换器应直接复用 `agent-file-normalizer-test-support` 的内存 InputSource、MemoryArtifactSink、取消令牌、进度收集器与 `run_contract`。这保证每个转换器 crate 可以在不启动 Context Compiler、SQLite 或 Tokio 服务的情况下独立验证。
