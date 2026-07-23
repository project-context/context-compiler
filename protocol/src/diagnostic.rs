use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::AnyLayerRef;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticLevel {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub level: DiagnosticLevel,
    pub message: String,
    pub subject: Option<AnyLayerRef>,
}
