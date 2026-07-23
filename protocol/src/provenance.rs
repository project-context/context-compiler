use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::ArtifactRef;
use crate::EntityRef;
use crate::RevisionRef;

/// Versioned component that produced a derived record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProducerRef {
    pub name: String,
    pub version: String,
    pub config_hash: String,
}

/// Canonical location that can be resolved independently of a workspace projection path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Locator {
    File {
        uri: String,
        start_line: Option<u32>,
        end_line: Option<u32>,
    },
    ByteRange {
        artifact: ArtifactRef,
        start: u64,
        end: u64,
    },
    /// One-indexed page within an immutable document artifact.
    DocumentPage { artifact: ArtifactRef, page: u32 },
    External {
        uri: String,
        selector: Option<String>,
    },
}

/// Evidence used to justify a fact, assignment, decision, or graph edge.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BasisRef {
    Revision { value: RevisionRef },
    Entity { value: EntityRef },
    Decision { id: String },
    External { uri: String },
}

/// Complete provenance for a derived revision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub source_snapshot: RevisionRef,
    pub parents: Vec<RevisionRef>,
    pub producer: ProducerRef,
}
