use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

/// Human or policy review state. Freshness is intentionally modeled separately.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatus {
    Candidate,
    Confirmed,
    Rejected,
    Orphaned,
}

/// Whether a derived record still matches its dependencies.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Freshness {
    Current,
    Stale,
    Invalid,
}

/// Outcome of a build or extraction run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Completed,
    Partial,
    Failed,
    Skipped,
}

/// Current accessibility of a registered source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AccessStatus {
    Available,
    Missing,
    PermissionDenied,
    Unreadable,
}
