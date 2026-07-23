# Agent File Normalizers

这是一个可独立移动的 Rust Workspace，用来把杂乱输入文件转换成适合 AI Agent 文件工具直接读取和检索的确定性文本投影。

它不依赖 Context Compiler。复制本目录到新仓库后可以直接运行：

```bash
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

## 目录

```txt
normalizers/
  Cargo.toml
  Cargo.lock
  rust-toolchain.toml
  justfile
  schema/normalizer.v1.schema.json

  core/           agent-file-normalizer
  markdown/       Markdown -> Markdown
  typescript/     TypeScript -> TypeScript
  html/           HTML -> HTML
  text-markdown/  Plain Text -> Markdown
  pdf-markdown/   text-layer PDF -> Markdown
  pdf-html/       text-layer PDF -> semantic HTML
  test-support/   可复用 contract harness
```

`core` 定义跨平台协议、配置、对象安全 `NormalizerFactory` / `Normalizer` trait、Registry、Artifact 输出验证和 Agent 工具适配描述。各转换器只依赖 `core` 及自身真正需要的解析库，转换器之间禁止互相依赖。

公开配置和映射协议由 Schemars 生成 `schema/normalizer.v1.schema.json`，fixture 测试会拒绝未审查的协议漂移。

## 输出目标

不存在对所有资料都最优的单一格式。选择标准格式时按 Agent 实际访问方式优化：

| 资料形态 | 优先输出 | 原因 |
|---|---|---|
| 线性说明、规则、会议记录 | Markdown | Read、grep、rg、sed 都是一等能力，token 噪声低。 |
| 源代码 | 原始源码格式 | 保留语法、符号位置和现有命令行生态。 |
| 富文档、复杂表格、版面信息 | 语义化 HTML | 比 Markdown 更能保留表格、层级、锚点和版面。 |
| 大型规则表、日志式记录 | CSV 或 JSONL | 可流式读取、按行 grep/sed、避免巨型 Markdown 表。 |
| 小型结构化配置 | 规范化 JSON/YAML | 保留机器结构，方便 jq/yq 和字段级处理。 |

`NormalizedFormat.agent` 使用以下稳定元数据表达选择结果：

```txt
RetrievalProfile
  prose | rich_document | source_code | tabular | structured_data

ToolSupportLevel
  first_class | compatible | not_recommended

ToolSupport
  read / grep / sed / line_oriented
```

平台可以用这些字段选择同一输入的不同转换器。例如 PDF 以连续正文为主时选 PDF→Markdown；以复杂表格和版面为主时选 PDF→HTML。

## Agent 文件契约

所有转换器输出的主文件必须满足：

- UTF-8 文本；
- 统一 LF 换行，不允许 CR 和 NUL；
- 相同 bytes 与相同配置产生确定性相同输出；
- 保留 normalized byte range 到原始文件位置的映射；
- 不为追求体积而 minify HTML、JSON 等可读格式；
- 标题、锚点、字段顺序和分片路径尽量稳定；
- 主文件适合直接交给 Read，且根据声明的支持等级适合 grep/rg/sed。

Registry 会统一验证换行、NUL、映射范围和 companion 路径，避免某个转换器生成无法安全投影的文件。

## 核心 API

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

`InputSource` 提供平台无关元数据和分段读取。`NormalizationContext` 注入 ArtifactSink、ScratchSpace、Cancellation、ProgressReporter 和 ResourceLimits。它们都不包含数据库 ID、Context Compiler RevisionRef 或任何具体平台类型。

`NormalizationReport` 只返回已 staged 的唯一 UTF-8 primary、可选二进制 companion、locator map、诊断和统计，不返回正文或绝对路径。宿主平台在报告验证通过后统一 commit；失败或取消时 abort。

## 配置与注册

扩展名配置只负责选择已注册实现，不能凭空产生转换能力：

```json
{
  "rules": [
    {
      "normalizerId": "text-to-markdown",
      "enabled": true,
      "extensions": ["txt", "text"],
      "priority": 90
    }
  ]
}
```

Registry 是显式组合根。宿主应用注册自己需要的 crate：

```rust
let mut registry = NormalizerRegistry::new();
registry.register(Arc::new(TextToMarkdownNormalizer::new()));
let configured = registry.configure("text-to-markdown", &config)?;
```

## 新增转换器

以 `docx→html` 为例：

1. 在本目录新增 `docx-html/` crate，并加入本 Workspace members。
2. 只依赖 `agent-file-normalizer` 和 DOCX 解析所需的普通技术库。
3. 声明唯一 NormalizerDescriptor、输入 matchers、唯一主输出和 AgentFileProfile。
4. 实现 Factory 配置 Schema、probe，并从 InputSource 向 ArtifactSink 流式写入稳定 HTML。
5. 复用 `agent-file-normalizer-test-support::run_contract` 验证正文、表格、图片引用、损坏输入、位置映射、取消、单调进度和确定性 hash。
6. 由宿主应用决定是否注册和启用它。

建议继续横向增加：

```txt
pdf-markdown/   pdf-html/
docx-markdown/  docx-html/
pptx-html/      image-ocr-markdown/
xlsx-csv/       xlsx-html/
json-jsonl/      openapi-json/
tsx/            javascript/
```

## 从主工程拆出

本目录本身就是完整 Workspace。迁移时复制整个目录内容作为新仓库根目录即可；Context Compiler 通过 `normalizers/core` 的平台适配层接入，不要求转换器反向依赖主工程。
