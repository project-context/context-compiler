use context_fact::FactKind;
use context_protocol::ReviewStatus;

use crate::SemanticRelation;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RelationPolicy {
    pub directed: bool,
    pub symmetric: bool,
    pub inverse_display_name: &'static str,
    pub max_cross_scope_review: ReviewStatus,
    allowed_from: &'static [FactKind],
    allowed_to: &'static [FactKind],
}

const ALL: &[FactKind] = &[
    FactKind::BusinessRule,
    FactKind::DocumentStatement,
    FactKind::CodeSymbol,
    FactKind::CodeCondition,
    FactKind::ApiOperation,
    FactKind::TestCase,
];
const RULE_OR_DOC: &[FactKind] = &[FactKind::BusinessRule, FactKind::DocumentStatement];
const CODE: &[FactKind] = &[FactKind::CodeSymbol, FactKind::CodeCondition];
const IMPLEMENTABLE: &[FactKind] = &[
    FactKind::BusinessRule,
    FactKind::DocumentStatement,
    FactKind::ApiOperation,
];

impl RelationPolicy {
    pub fn accepts(self, from: FactKind, to: FactKind) -> bool {
        self.allowed_from.contains(&from) && self.allowed_to.contains(&to)
    }
}

impl SemanticRelation {
    pub fn policy(self) -> RelationPolicy {
        let (directed, symmetric, inverse, from, to) = match self {
            Self::Describes => (true, false, "described_by", RULE_OR_DOC, ALL),
            Self::Implements => (true, false, "implemented_by", CODE, IMPLEMENTABLE),
            Self::ExposesAs => (
                true,
                false,
                "exposed_from",
                &[FactKind::CodeSymbol][..],
                &[FactKind::ApiOperation][..],
            ),
            Self::Verifies => (true, false, "verified_by", &[FactKind::TestCase][..], ALL),
            Self::Constrains => (true, false, "constrained_by", RULE_OR_DOC, ALL),
            Self::DependsOn => (true, false, "required_by", ALL, ALL),
            Self::Impacts => (true, false, "impacted_by", ALL, ALL),
            Self::Supports => (true, false, "supported_by", ALL, ALL),
            Self::Refutes => (true, false, "refuted_by", ALL, ALL),
            Self::ConflictsWith => (false, true, "conflicts_with", ALL, ALL),
            Self::SimilarTo => (false, true, "similar_to", ALL, ALL),
            Self::Supersedes => (true, false, "superseded_by", ALL, ALL),
            Self::Deprecates => (true, false, "deprecated_by", ALL, ALL),
        };
        RelationPolicy {
            directed,
            symmetric,
            inverse_display_name: inverse,
            max_cross_scope_review: ReviewStatus::Candidate,
            allowed_from: from,
            allowed_to: to,
        }
    }
}
