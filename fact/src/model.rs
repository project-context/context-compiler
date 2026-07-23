use context_evidence::EvidenceRecord;
use context_protocol::BuildResult;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::ProducerRef;
use context_protocol::RevisionRef;
use context_protocol::RunStatus;
use context_protocol::Trace;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum FactKind {
    BusinessRule,
    DocumentStatement,
    CodeSymbol,
    CodeCondition,
    ApiOperation,
    TestCase,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceRole {
    Supports,
    Refutes,
    Qualifies,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FactEvidenceLink {
    pub evidence_ref: RevisionRef,
    pub role: EvidenceRole,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FactRevision {
    pub revision_ref: RevisionRef,
    pub build_ref: RevisionRef,
    pub kind: FactKind,
    pub stable_key: String,
    pub statement: String,
    #[serde(default)]
    pub data: Value,
    pub evidence: Vec<FactEvidenceLink>,
    pub trace: Trace,
    pub freshness: Freshness,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FactBuildRecord {
    pub entity_ref: EntityRef,
    pub revision_ref: RevisionRef,
    pub producer: ProducerRef,
    pub status: RunStatus,
    pub fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FactBuildRequest {
    pub evidence: Vec<EvidenceRecord>,
    #[serde(default)]
    pub previous: Vec<FactRevision>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FactBuildOutput {
    pub build: FactBuildRecord,
    pub facts: Vec<FactRevision>,
    pub result: BuildResult,
}
