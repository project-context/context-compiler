use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorCapabilities {
    pub local: bool,
    pub remote: bool,
    pub incremental: bool,
    pub authentication: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorDescriptor {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub capabilities: ConnectorCapabilities,
    pub config_schema: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct SecretRef(pub String);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInstanceConfig {
    pub id: String,
    pub connector_id: String,
    pub display_name: String,
    #[serde(default = "enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub secret_refs: Vec<SecretRef>,
}

fn enabled() -> bool {
    true
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorDiagnosticLevel {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorDiagnostic {
    pub code: String,
    pub level: ConnectorDiagnosticLevel,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub reachable: bool,
    pub diagnostics: Vec<ConnectorDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorObject {
    pub stable_key: String,
    pub uri: String,
    pub title: String,
    pub media_type: String,
    pub extension: Option<String>,
    pub size_bytes: u64,
    pub modified_at: Option<i64>,
    pub content_hash: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRequest {
    pub cursor: Option<String>,
    pub limit: Option<u16>,
}

impl DiscoveryRequest {
    pub fn limit(&self) -> usize {
        usize::from(self.limit.unwrap_or(200).clamp(1, 10_000))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    pub objects: Vec<ConnectorObject>,
    pub next_cursor: Option<String>,
    pub diagnostics: Vec<ConnectorDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapturedContent {
    pub object: ConnectorObject,
    pub bytes: Vec<u8>,
}
