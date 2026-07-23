use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

pub const NORMALIZER_PROTOCOL_VERSION: u32 = 1;
pub type NormalizerConfig = serde_json::Value;

#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct FormatId(String);

impl FormatId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InputMatcher {
    pub format: FormatId,
    pub media_types: Vec<String>,
    pub extensions: Vec<String>,
    #[serde(default)]
    pub magic_prefixes: Vec<Vec<u8>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum RetrievalProfile {
    Prose,
    RichDocument,
    SourceCode,
    Tabular,
    StructuredData,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ToolSupportLevel {
    FirstClass,
    Compatible,
    NotRecommended,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSupport {
    pub read: ToolSupportLevel,
    pub grep: ToolSupportLevel,
    pub sed: ToolSupportLevel,
    pub line_oriented: bool,
}

impl ToolSupport {
    pub fn shell_text() -> Self {
        Self {
            read: ToolSupportLevel::FirstClass,
            grep: ToolSupportLevel::FirstClass,
            sed: ToolSupportLevel::FirstClass,
            line_oriented: true,
        }
    }

    pub fn rich_document() -> Self {
        Self {
            read: ToolSupportLevel::FirstClass,
            grep: ToolSupportLevel::Compatible,
            sed: ToolSupportLevel::NotRecommended,
            line_oriented: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentFileProfile {
    pub retrieval: RetrievalProfile,
    pub tools: ToolSupport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedFormat {
    pub format: FormatId,
    pub media_type: String,
    pub extension: String,
    pub agent: AgentFileProfile,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizerCapabilities {
    pub deterministic: bool,
    pub streaming: bool,
    pub random_access: bool,
    pub companions: bool,
    pub locator_kinds: Vec<String>,
}

impl Default for NormalizerCapabilities {
    fn default() -> Self {
        Self {
            deterministic: true,
            streaming: false,
            random_access: false,
            companions: false,
            locator_kinds: vec!["file".to_owned(), "byte_range".to_owned()],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizerDescriptor {
    pub protocol_version: u32,
    pub id: String,
    pub display_name: String,
    pub implementation_version: String,
    pub inputs: Vec<InputMatcher>,
    pub output: NormalizedFormat,
    pub capabilities: NormalizerCapabilities,
    pub default_priority: i32,
}

impl NormalizerDescriptor {
    pub fn builder(
        id: impl Into<String>,
        display_name: impl Into<String>,
        implementation_version: impl Into<String>,
        output: NormalizedFormat,
    ) -> NormalizerDescriptorBuilder {
        NormalizerDescriptorBuilder {
            descriptor: Self {
                protocol_version: NORMALIZER_PROTOCOL_VERSION,
                id: id.into(),
                display_name: display_name.into(),
                implementation_version: implementation_version.into(),
                inputs: Vec::new(),
                output,
                capabilities: NormalizerCapabilities::default(),
                default_priority: 0,
            },
        }
    }
}

#[derive(Clone, Debug)]
pub struct NormalizerDescriptorBuilder {
    descriptor: NormalizerDescriptor,
}

impl NormalizerDescriptorBuilder {
    pub fn input(mut self, input: InputMatcher) -> Self {
        self.descriptor.inputs.push(input);
        self
    }

    pub fn capabilities(mut self, capabilities: NormalizerCapabilities) -> Self {
        self.descriptor.capabilities = capabilities;
        self
    }

    pub fn default_priority(mut self, priority: i32) -> Self {
        self.descriptor.default_priority = priority;
        self
    }

    pub fn build(self) -> NormalizerDescriptor {
        self.descriptor
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizerIdentity {
    pub name: String,
    pub version: String,
    pub config_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InputMetadata {
    pub source_uri: String,
    pub declared_media_type: Option<String>,
    pub extension: Option<String>,
    pub size_bytes: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum WorkUnit {
    Bytes,
    Pages,
    Slides,
    Sheets,
    Rows,
    Entries,
    Items,
    Files,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkEstimate {
    pub total: Option<u64>,
    pub unit: WorkUnit,
}

impl WorkEstimate {
    pub fn files(total: u64) -> Self {
        Self {
            total: Some(total),
            unit: WorkUnit::Files,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub supported: bool,
    pub confidence: u8,
    pub detected_format: Option<FormatId>,
    pub detected_media_type: Option<String>,
    pub work: WorkEstimate,
    pub diagnostics: Vec<NormalizationDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
#[non_exhaustive]
pub enum OriginalLocator {
    File {
        uri: String,
        start_line: Option<u32>,
        end_line: Option<u32>,
    },
    ByteRange {
        uri: String,
        start: u64,
        end: u64,
    },
    DocumentPage {
        uri: String,
        page: u32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum NormalizationDiagnosticLevel {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationDiagnostic {
    pub code: String,
    pub level: NormalizationDiagnosticLevel,
    pub message: String,
    pub locator: Option<OriginalLocator>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedMapping {
    pub normalized_start: u64,
    pub normalized_end: u64,
    pub original: OriginalLocator,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ArtifactRole {
    Primary,
    Companion,
    LocatorMap,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSpecification {
    pub role: ArtifactRole,
    pub relative_path: Option<String>,
    pub media_type: String,
    pub format: Option<FormatId>,
    pub extension: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProducedArtifact {
    pub uri: String,
    pub role: ArtifactRole,
    pub relative_path: Option<String>,
    pub media_type: String,
    pub format: Option<FormatId>,
    pub extension: Option<String>,
    pub content_hash: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationStatistics {
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub processed_units: u64,
    pub total_units: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationReport {
    pub primary: ProducedArtifact,
    pub companions: Vec<ProducedArtifact>,
    pub locator_map: Option<ProducedArtifact>,
    pub diagnostics: Vec<NormalizationDiagnostic>,
    pub statistics: NormalizationStatistics,
}

impl NormalizationReport {
    pub fn artifacts(&self) -> impl Iterator<Item = &ProducedArtifact> {
        std::iter::once(&self.primary)
            .chain(self.companions.iter())
            .chain(self.locator_map.iter())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationProgress {
    pub phase: ProgressPhase,
    pub completed: u64,
    pub total: Option<u64>,
    pub unit: WorkUnit,
    pub message: Option<String>,
}

#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct ProgressPhase(String);

impl ProgressPhase {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ProgressPhase {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl From<&str> for ProgressPhase {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for ProgressPhase {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResourceLimits {
    pub max_input_bytes: u64,
    pub max_output_bytes: u64,
    pub chunk_size: usize,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 512 * 1024 * 1024,
            max_output_bytes: 512 * 1024 * 1024,
            chunk_size: 64 * 1024,
        }
    }
}
