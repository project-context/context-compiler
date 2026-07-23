use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use bytes::Bytes;
use context_protocol::Locator;
use context_source::FormatId;
use context_source::NormalizedSource;
use context_source::RetrievalProfile;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use sha2::Digest;
use sha2::Sha256;
use thiserror::Error;

pub const STRUCTURE_PARSER_PROTOCOL_VERSION: u32 = 1;

#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct StructureParserId(String);

impl StructureParserId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for StructureParserId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum StructureFileFamily {
    Code,
    Document,
    MarkupStyle,
    StructuredData,
    Tabular,
    RichDocument,
    Other,
}

impl StructureFileFamily {
    pub fn ordered() -> &'static [Self] {
        &[
            Self::Code,
            Self::Document,
            Self::MarkupStyle,
            Self::StructuredData,
            Self::Tabular,
            Self::RichDocument,
            Self::Other,
        ]
    }

    pub fn infer(normalized: &NormalizedSource) -> Self {
        let extension = normalized
            .extension
            .trim_start_matches('.')
            .to_ascii_lowercase();
        let extension_family = match extension.as_str() {
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "rs" | "py" | "go" | "java" | "kt"
            | "kts" | "swift" | "c" | "h" | "cc" | "cpp" | "cs" | "rb" | "php" | "sh" | "bash"
            | "zsh" => Some(Self::Code),
            "md" | "markdown" | "txt" | "rst" | "adoc" => Some(Self::Document),
            "html" | "htm" | "css" | "scss" | "sass" | "less" | "svg" | "xml" => {
                Some(Self::MarkupStyle)
            }
            "json" | "jsonl" | "yaml" | "yml" | "toml" | "ini" | "properties" => {
                Some(Self::StructuredData)
            }
            "csv" | "tsv" => Some(Self::Tabular),
            "pdf" | "doc" | "docx" | "ppt" | "pptx" => Some(Self::RichDocument),
            _ => None,
        };
        if let Some(family) = extension_family {
            return family;
        }

        let format = normalized.format.as_str().to_ascii_lowercase();
        let media_type = normalized.media_type.to_ascii_lowercase();
        if media_type.starts_with("text/html")
            || media_type.ends_with("/xml")
            || matches!(format.as_str(), "html" | "xml" | "css")
        {
            return Self::MarkupStyle;
        }
        if media_type.contains("json")
            || media_type.contains("yaml")
            || matches!(format.as_str(), "json" | "yaml" | "toml")
        {
            return Self::StructuredData;
        }

        match normalized.agent.retrieval {
            RetrievalProfile::SourceCode => Self::Code,
            RetrievalProfile::Prose => Self::Document,
            RetrievalProfile::RichDocument => Self::RichDocument,
            RetrievalProfile::Tabular => Self::Tabular,
            RetrievalProfile::StructuredData => Self::StructuredData,
            _ => Self::Other,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Code => "代码文件",
            Self::Document => "文档",
            Self::MarkupStyle => "标记与样式",
            Self::StructuredData => "配置与结构化数据",
            Self::Tabular => "表格",
            Self::RichDocument => "富文档",
            Self::Other => "其他",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureInputMatcher {
    #[serde(default)]
    pub formats: Vec<FormatId>,
    #[serde(default)]
    pub media_types: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub families: Vec<StructureFileFamily>,
}

impl StructureInputMatcher {
    pub fn matches(&self, normalized: &NormalizedSource) -> bool {
        let extension = normalized.extension.trim_start_matches('.');
        self.formats.iter().any(|value| value == &normalized.format)
            || self
                .media_types
                .iter()
                .any(|value| value == &normalized.media_type)
            || self
                .extensions
                .iter()
                .any(|value| value.trim_start_matches('.') == extension)
            || self
                .families
                .contains(&StructureFileFamily::infer(normalized))
    }

    pub fn supports_extension(&self, extension: &str) -> bool {
        let extension = extension.trim_start_matches('.');
        self.extensions
            .iter()
            .any(|value| value.trim_start_matches('.') == extension)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParserCapabilities {
    pub deterministic: bool,
    pub relations: bool,
    pub byte_locators: bool,
    pub incremental: bool,
}

impl Default for StructureParserCapabilities {
    fn default() -> Self {
        Self {
            deterministic: true,
            relations: true,
            byte_locators: true,
            incremental: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParserDescriptor {
    pub protocol_version: u32,
    pub id: StructureParserId,
    pub display_name: String,
    pub implementation_version: String,
    pub inputs: Vec<StructureInputMatcher>,
    pub capabilities: StructureParserCapabilities,
    pub default_priority: i32,
}

impl StructureParserDescriptor {
    pub fn supports(&self, normalized: &NormalizedSource) -> bool {
        self.inputs
            .iter()
            .any(|matcher| matcher.matches(normalized))
    }

    pub fn supports_extension(&self, extension: &str) -> bool {
        self.inputs
            .iter()
            .any(|matcher| matcher.supports_extension(extension))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParsedUnit {
    pub local_id: String,
    pub stable_key: String,
    pub kind: String,
    pub label: String,
    pub preview: String,
    pub locator: Locator,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParsedRelation {
    pub local_id: String,
    pub kind: String,
    pub from_local_id: String,
    pub to_local_id: String,
    pub locator: Option<Locator>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParseStatistics {
    pub input_bytes: u64,
    pub unit_count: u64,
    pub relation_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParseDiagnostic {
    pub code: String,
    pub message: String,
    pub locator: Option<Locator>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParseReport {
    pub units: Vec<StructureParsedUnit>,
    pub relations: Vec<StructureParsedRelation>,
    /// Deterministic parser-private JSON written to the Artifact Repository by the compiler.
    pub internal_structure: Vec<u8>,
    pub diagnostics: Vec<StructureParseDiagnostic>,
    pub statistics: StructureParseStatistics,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureParseProgress {
    pub phase: String,
    pub completed: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
    pub generated_units: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StructureResourceLimits {
    pub max_input_bytes: u64,
    pub max_units: u64,
    pub max_relations: u64,
    pub chunk_size: usize,
    pub max_preview_bytes: usize,
}

impl Default for StructureResourceLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 512 * 1024 * 1024,
            max_units: 2_000_000,
            max_relations: 8_000_000,
            chunk_size: 64 * 1024,
            max_preview_bytes: 512,
        }
    }
}

#[derive(Debug, Error)]
pub enum StructureParserError {
    #[error("unsupported normalized artifact")]
    UnsupportedInput,
    #[error("invalid parser configuration: {0}")]
    InvalidConfig(String),
    #[error("invalid UTF-8 input: {0}")]
    InvalidUtf8(String),
    #[error("parser resource limit exceeded: {0}")]
    ResourceLimit(String),
    #[error("structure parsing cancelled")]
    Cancelled,
    #[error("structure parser failed: {0}")]
    Parse(String),
    #[error("structure parser registry conflict: {0}")]
    Registry(String),
}

pub type StructureParserResult<T> = Result<T, StructureParserError>;
pub type StructureParserFuture<'a, T> =
    Pin<Box<dyn Future<Output = StructureParserResult<T>> + Send + 'a>>;

pub trait StructureInputSource: Send + Sync {
    fn size_bytes(&self) -> Option<u64>;
    fn read_range(&self, offset: u64, max_len: usize) -> StructureParserFuture<'_, Bytes>;
}

#[derive(Clone)]
pub struct BytesStructureInputSource {
    bytes: Bytes,
}

impl BytesStructureInputSource {
    pub fn new(bytes: impl Into<Bytes>) -> Self {
        Self {
            bytes: bytes.into(),
        }
    }
}

impl StructureInputSource for BytesStructureInputSource {
    fn size_bytes(&self) -> Option<u64> {
        Some(self.bytes.len() as u64)
    }

    fn read_range(&self, offset: u64, max_len: usize) -> StructureParserFuture<'_, Bytes> {
        let start = usize::try_from(offset).unwrap_or(usize::MAX);
        let bytes = if start >= self.bytes.len() {
            Bytes::new()
        } else {
            self.bytes
                .slice(start..start.saturating_add(max_len).min(self.bytes.len()))
        };
        Box::pin(async move { Ok(bytes) })
    }
}

pub trait StructureCancellation: Send + Sync {
    fn is_cancelled(&self) -> bool;
}

pub trait StructureProgressReporter: Send + Sync {
    fn report(&self, progress: StructureParseProgress) -> StructureParserResult<()>;
}

#[derive(Clone, Copy, Default)]
pub struct StructureNeverCancelled;

impl StructureCancellation for StructureNeverCancelled {
    fn is_cancelled(&self) -> bool {
        false
    }
}

#[derive(Clone, Copy, Default)]
pub struct StructureNoProgress;

impl StructureProgressReporter for StructureNoProgress {
    fn report(&self, _progress: StructureParseProgress) -> StructureParserResult<()> {
        Ok(())
    }
}

pub struct StructureParseRequest<'a> {
    pub normalized: &'a NormalizedSource,
    pub input: &'a dyn StructureInputSource,
}

pub struct StructureParseContext<'a> {
    pub progress: &'a dyn StructureProgressReporter,
    pub cancellation: &'a dyn StructureCancellation,
    pub limits: StructureResourceLimits,
}

pub trait StructureParser: Send + Sync {
    fn descriptor(&self) -> &StructureParserDescriptor;

    fn parse<'a>(
        &'a self,
        request: StructureParseRequest<'a>,
        context: StructureParseContext<'a>,
    ) -> StructureParserFuture<'a, StructureParseReport>;
}

pub trait StructureParserFactory: Send + Sync {
    fn descriptor(&self) -> &StructureParserDescriptor;
    fn config_schema(&self) -> &serde_json::Value;
    fn validate_config(&self, config: &serde_json::Value) -> StructureParserResult<()>;
    fn create(&self, config: &serde_json::Value)
    -> StructureParserResult<Arc<dyn StructureParser>>;
}

#[derive(Clone)]
pub struct ConfiguredStructureParser {
    pub parser: Arc<dyn StructureParser>,
    pub config_hash: String,
}

#[derive(Clone, Default)]
pub struct StructureParserRegistry {
    factories: BTreeMap<StructureParserId, Arc<dyn StructureParserFactory>>,
}

impl StructureParserRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &mut self,
        factory: Arc<dyn StructureParserFactory>,
    ) -> StructureParserResult<()> {
        let id = factory.descriptor().id.clone();
        if self.factories.contains_key(&id) {
            return Err(StructureParserError::Registry(format!(
                "duplicate parser id: {id}"
            )));
        }
        self.factories.insert(id, factory);
        Ok(())
    }

    pub fn descriptors(&self) -> Vec<StructureParserDescriptor> {
        self.factories
            .values()
            .map(|factory| factory.descriptor().clone())
            .collect()
    }

    pub fn factory(&self, id: &str) -> Option<Arc<dyn StructureParserFactory>> {
        self.factories
            .get(&StructureParserId::new(id))
            .map(Arc::clone)
    }

    pub fn compatible(&self, normalized: &NormalizedSource) -> Vec<StructureParserDescriptor> {
        let mut descriptors = self
            .factories
            .values()
            .map(|factory| factory.descriptor())
            .filter(|descriptor| descriptor.supports(normalized))
            .cloned()
            .collect::<Vec<_>>();
        descriptors.sort_by(|left, right| {
            right
                .default_priority
                .cmp(&left.default_priority)
                .then_with(|| left.id.cmp(&right.id))
        });
        descriptors
    }

    pub fn compatible_extension(&self, extension: &str) -> Vec<StructureParserDescriptor> {
        let mut descriptors = self
            .factories
            .values()
            .map(|factory| factory.descriptor())
            .filter(|descriptor| descriptor.supports_extension(extension))
            .cloned()
            .collect::<Vec<_>>();
        descriptors.sort_by(|left, right| {
            right
                .default_priority
                .cmp(&left.default_priority)
                .then_with(|| left.id.cmp(&right.id))
        });
        descriptors
    }

    pub fn create(
        &self,
        id: &str,
        config: &serde_json::Value,
    ) -> StructureParserResult<ConfiguredStructureParser> {
        let factory = self
            .factory(id)
            .ok_or_else(|| StructureParserError::InvalidConfig(format!("unknown parser: {id}")))?;
        factory.validate_config(config)?;
        Ok(ConfiguredStructureParser {
            parser: factory.create(config)?,
            config_hash: structure_config_hash(config)?,
        })
    }
}

pub fn structure_config_hash(config: &serde_json::Value) -> StructureParserResult<String> {
    let canonical = canonical_json(config);
    let bytes = serde_json::to_vec(&canonical)
        .map_err(|error| StructureParserError::InvalidConfig(error.to_string()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn canonical_json(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(values) => {
            let ordered = values
                .iter()
                .map(|(key, value)| (key.clone(), canonical_json(value)))
                .collect::<BTreeMap<_, _>>();
            serde_json::Value::Object(ordered.into_iter().collect())
        }
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.iter().map(canonical_json).collect())
        }
        value => value.clone(),
    }
}

pub async fn read_structure_input(
    input: &dyn StructureInputSource,
    context: &StructureParseContext<'_>,
) -> StructureParserResult<Bytes> {
    let mut result = Vec::new();
    let mut offset = 0_u64;
    loop {
        if context.cancellation.is_cancelled() {
            return Err(StructureParserError::Cancelled);
        }
        let chunk = input.read_range(offset, context.limits.chunk_size).await?;
        if chunk.is_empty() {
            break;
        }
        offset = offset.saturating_add(chunk.len() as u64);
        if offset > context.limits.max_input_bytes {
            return Err(StructureParserError::ResourceLimit(
                "input byte limit exceeded".to_owned(),
            ));
        }
        result.extend_from_slice(&chunk);
        context.progress.report(StructureParseProgress {
            phase: "read_input".to_owned(),
            completed: offset,
            total: input.size_bytes().map(|value| value.saturating_mul(2)),
            message: None,
            generated_units: 0,
        })?;
    }
    Ok(Bytes::from(result))
}
