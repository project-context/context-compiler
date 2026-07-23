use context_fact::FactKind;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::ReviewStatus;
use context_protocol::Trace;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::SemanticError;
use crate::SemanticResult;

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum SemanticRelation {
    Describes,
    Implements,
    ExposesAs,
    Verifies,
    Constrains,
    DependsOn,
    Impacts,
    Supports,
    Refutes,
    ConflictsWith,
    SimilarTo,
    Supersedes,
    Deprecates,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SemanticEdge {
    pub id: String,
    pub relation: SemanticRelation,
    pub from_fact: EntityRef,
    pub to_fact: EntityRef,
    pub from_kind: FactKind,
    pub to_kind: FactKind,
    pub review_status: ReviewStatus,
    pub freshness: Freshness,
    pub trace: Trace,
}

impl SemanticEdge {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: impl Into<String>,
        relation: SemanticRelation,
        from_fact: EntityRef,
        to_fact: EntityRef,
        from_kind: FactKind,
        to_kind: FactKind,
        mut review_status: ReviewStatus,
        cross_scope: bool,
        freshness: Freshness,
        trace: Trace,
    ) -> SemanticResult<Self> {
        if from_fact.layer != Layer::Fact || to_fact.layer != Layer::Fact {
            return Err(SemanticError::InvalidEndpoint(
                "semantic endpoints must be FactRef values".to_owned(),
            ));
        }
        let policy = relation.policy();
        if !policy.accepts(from_kind, to_kind) {
            return Err(SemanticError::InvalidEndpoint(format!(
                "{relation:?} does not allow {from_kind:?} -> {to_kind:?}"
            )));
        }
        if cross_scope && review_status == ReviewStatus::Confirmed {
            review_status = policy.max_cross_scope_review;
        }
        let (from_fact, to_fact, from_kind, to_kind) =
            if policy.symmetric && (&from_fact, from_kind) > (&to_fact, to_kind) {
                (to_fact, from_fact, to_kind, from_kind)
            } else {
                (from_fact, to_fact, from_kind, to_kind)
            };
        Ok(Self {
            id: id.into(),
            relation,
            from_fact,
            to_fact,
            from_kind,
            to_kind,
            review_status,
            freshness,
            trace,
        })
    }
}
