use context_protocol::ReviewStatus;
use context_protocol::RevisionRef;
use context_protocol::Trace;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRef {
    pub id: String,
}

impl ScopeRef {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DimensionCardinality {
    Single,
    Multiple,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeDimension {
    pub name: String,
    pub cardinality: DimensionCardinality,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub scope_ref: ScopeRef,
    pub dimension: String,
    pub value: String,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentPurpose {
    AppliesToContent,
    DescribesMetadata,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Propagation {
    Inherit,
    LocalOnly,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContextRole {
    Main,
    Comparison,
    History,
    Example,
    Negation,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeAssignment {
    pub id: String,
    pub target: RevisionRef,
    pub scope_ref: ScopeRef,
    pub purpose: AssignmentPurpose,
    pub propagation: Propagation,
    pub context_role: ContextRole,
    pub review_status: ReviewStatus,
    pub trace: Trace,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeBlock {
    pub id: String,
    pub target: RevisionRef,
    pub scope_ref: Option<ScopeRef>,
    pub dimension: Option<String>,
    pub review_status: ReviewStatus,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScopeRelationKind {
    BelongsTo,
    OwnedBy,
    ValidIn,
    DependsOnScope,
    SimilarTo,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRelation {
    pub id: String,
    /// Child endpoint for `belongs_to`.
    pub from: ScopeRef,
    /// Parent endpoint for `belongs_to`.
    pub to: ScopeRef,
    pub kind: ScopeRelationKind,
    pub review_status: ReviewStatus,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeDecision {
    pub id: String,
    pub subject: String,
    pub status: ReviewStatus,
    pub rationale: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveScopeValue {
    pub scope_ref: ScopeRef,
    pub assigned_at: RevisionRef,
    /// Full content lineage from the queried revision to the assignment source.
    pub lineage_path: Vec<RevisionRef>,
    /// Full `belongs_to` path from the assigned Scope to this derived Scope.
    pub scope_path: Vec<ScopeRef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveScopeConflict {
    pub dimension: String,
    pub values: Vec<ScopeRef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveScope {
    pub target: RevisionRef,
    pub values: Vec<EffectiveScopeValue>,
    pub conflicts: Vec<EffectiveScopeConflict>,
}
