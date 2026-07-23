use context_protocol::ReviewStatus;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewSubject {
    ScopeAssignment,
    ScopeBlock,
    ScopeRelation,
    SemanticEdge,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDecision {
    pub subject: ReviewSubject,
    pub id: String,
    pub expected_status: ReviewStatus,
    pub status: ReviewStatus,
    pub rationale: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCommand {
    pub decisions: Vec<ReviewDecision>,
}

impl ReviewCommand {
    pub fn validate(&self) -> Result<(), String> {
        if self.decisions.is_empty() {
            return Err("at least one decision is required".to_owned());
        }
        for decision in &self.decisions {
            if decision.expected_status != ReviewStatus::Candidate {
                return Err("only candidate records may be reviewed".to_owned());
            }
            if !matches!(
                decision.status,
                ReviewStatus::Confirmed | ReviewStatus::Rejected
            ) {
                return Err("review status must be confirmed or rejected".to_owned());
            }
            if decision.rationale.trim().is_empty() {
                return Err("review rationale must not be empty".to_owned());
            }
        }
        Ok(())
    }
}
