use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::Diagnostic;
use crate::RevisionRef;

/// Uniform change summary returned by every layer builder.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub build_ref: String,
    pub added: Vec<RevisionRef>,
    pub changed: Vec<RevisionRef>,
    pub stale: Vec<RevisionRef>,
    pub unchanged: Vec<RevisionRef>,
    pub diagnostics: Vec<Diagnostic>,
    pub dependencies: Vec<RevisionRef>,
}

impl BuildResult {
    pub fn completed(build_ref: impl Into<String>, added: Vec<RevisionRef>) -> Self {
        Self {
            build_ref: build_ref.into(),
            added,
            changed: Vec::new(),
            stale: Vec::new(),
            unchanged: Vec::new(),
            diagnostics: Vec::new(),
            dependencies: Vec::new(),
        }
    }
}
