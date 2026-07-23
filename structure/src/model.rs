use std::borrow::Cow;

use context_protocol::ArtifactRef;
use context_protocol::BuildResult;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Locator;
use context_protocol::ProducerRef;
use context_protocol::RevisionRef;
use context_protocol::RunStatus;
use context_protocol::Trace;
use context_source::NormalizedSource;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

/// Extensible parser-defined Structure unit kind.
///
/// Well-known constants keep built-in processors ergonomic while the owned
/// representation lets external parsers add kinds without changing this crate.
#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct StructureKind(Cow<'static, str>);

#[allow(non_upper_case_globals)]
impl StructureKind {
    pub const Document: Self = Self(Cow::Borrowed("document"));
    pub const File: Self = Self(Cow::Borrowed("file"));
    pub const Heading: Self = Self(Cow::Borrowed("heading"));
    pub const Paragraph: Self = Self(Cow::Borrowed("paragraph"));
    pub const Table: Self = Self(Cow::Borrowed("table"));
    pub const ListItem: Self = Self(Cow::Borrowed("list_item"));
    pub const CodeBlock: Self = Self(Cow::Borrowed("code_block"));
    pub const Function: Self = Self(Cow::Borrowed("function"));
    pub const Method: Self = Self(Cow::Borrowed("method"));
    pub const Condition: Self = Self(Cow::Borrowed("condition"));
    pub const Call: Self = Self(Cow::Borrowed("call"));

    pub fn new(value: impl Into<Cow<'static, str>>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for StructureKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl PartialEq<&str> for StructureKind {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

/// Extensible parser-defined Structure relation kind.
#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct StructureRelationType(Cow<'static, str>);

impl StructureRelationType {
    pub fn new(value: impl Into<Cow<'static, str>>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for StructureRelationType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl PartialEq<&str> for StructureRelationType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureBuildRecord {
    pub entity_ref: EntityRef,
    pub revision_ref: RevisionRef,
    pub source_snapshot: RevisionRef,
    pub normalized_source: RevisionRef,
    pub producer: ProducerRef,
    pub status: RunStatus,
    pub fingerprint: String,
    #[serde(default)]
    pub internal_artifact: Option<ArtifactRef>,
    #[serde(default)]
    pub unit_count: u64,
    #[serde(default)]
    pub relation_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureUnit {
    pub revision_ref: RevisionRef,
    pub build_ref: RevisionRef,
    pub kind: StructureKind,
    pub stable_key: String,
    pub label: String,
    pub locator: Locator,
    pub text: String,
    pub trace: Trace,
    pub freshness: Freshness,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureRelationRecord {
    pub revision_ref: RevisionRef,
    pub build_ref: RevisionRef,
    pub relation_type: StructureRelationType,
    pub from: RevisionRef,
    pub to: RevisionRef,
    pub locator: Option<Locator>,
    pub fingerprint: String,
    pub trace: Trace,
    pub freshness: Freshness,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedStructureView {
    pub unit: StructureUnit,
    pub text: String,
    pub parents: Vec<StructureUnit>,
    pub children: Vec<StructureUnit>,
    pub adjacent: Vec<StructureUnit>,
    pub relations: Vec<StructureRelationRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureCommit {
    pub build: StructureBuildRecord,
    pub units: Vec<StructureUnit>,
    pub relations: Vec<StructureRelationRecord>,
    #[serde(default)]
    pub stale: Vec<RevisionRef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureBuildRequest {
    pub normalized: NormalizedSource,
    /// UTF-8 primary artifact content supplied by the compiler's ArtifactReader.
    /// Processors never resolve or read physical repository paths themselves.
    pub content: String,
    #[serde(default)]
    pub previous: Vec<StructureUnit>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureBuildOutput {
    pub build: StructureBuildRecord,
    pub units: Vec<StructureUnit>,
    #[serde(default)]
    pub relations: Vec<StructureRelationRecord>,
    pub result: BuildResult,
}
