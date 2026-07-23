use agent_file_normalizer::AgentFileProfile;
use agent_file_normalizer::FormatId;
use agent_file_normalizer::NormalizationDiagnostic;
use context_protocol::AccessStatus;
use context_protocol::ArtifactRef;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::ProducerRef;
use context_protocol::RevisionRef;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionPolicy {
    Pointer,
    Copy,
    Normalize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecord {
    pub entity_ref: EntityRef,
    pub format: FormatId,
    pub uri: String,
    pub title: String,
    pub media_type: String,
    pub current_snapshot: RevisionRef,
    pub access_status: AccessStatus,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnapshot {
    pub revision_ref: RevisionRef,
    pub content_hash: String,
    pub size_bytes: u64,
    pub modified_at: Option<i64>,
    pub freshness: Freshness,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedArtifact {
    pub artifact: ArtifactRef,
    pub role: agent_file_normalizer::ArtifactRole,
    pub relative_path: Option<String>,
    pub media_type: String,
    pub format: Option<FormatId>,
    pub extension: Option<String>,
    pub content_hash: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSource {
    pub revision_ref: RevisionRef,
    pub source_snapshot: RevisionRef,
    pub normalizer_id: String,
    pub media_type: String,
    pub format: FormatId,
    pub extension: String,
    pub agent: AgentFileProfile,
    pub primary: NormalizedArtifact,
    pub companions: Vec<NormalizedArtifact>,
    pub locator_map: Option<NormalizedArtifact>,
    pub projection_policy: ProjectionPolicy,
    pub normalizer: ProducerRef,
    pub diagnostics: Vec<NormalizationDiagnostic>,
    pub freshness: Freshness,
}
