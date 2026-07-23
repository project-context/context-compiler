use context_protocol::BuildResult;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Locator;
use context_protocol::ProducerRef;
use context_protocol::RevisionRef;
use context_protocol::RunStatus;
use context_protocol::Trace;
use context_structure::StructureUnit;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    TextSpan,
    CodeSpan,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceBuildRecord {
    pub entity_ref: EntityRef,
    pub revision_ref: RevisionRef,
    pub producer: ProducerRef,
    pub status: RunStatus,
    pub fingerprint: String,
}

/// Versioned, reproducible evidence. Multiple Structure parents are preserved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRecord {
    pub revision_ref: RevisionRef,
    pub build_ref: RevisionRef,
    pub kind: EvidenceKind,
    pub stable_key: String,
    pub structure_refs: Vec<RevisionRef>,
    pub normalized_source: RevisionRef,
    pub locator: Locator,
    pub excerpt: String,
    pub trace: Trace,
    pub freshness: Freshness,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceBuildRequest {
    pub structures: Vec<StructureUnit>,
    #[serde(default)]
    pub previous: Vec<EvidenceRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceBuildOutput {
    pub build: EvidenceBuildRecord,
    pub evidence: Vec<EvidenceRecord>,
    pub result: BuildResult,
}
