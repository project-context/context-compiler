use schemars::JsonSchema;
use schemars::schema_for;
use serde_json::Value;

use crate::NormalizationDiagnostic;
use crate::NormalizationProgress;
use crate::NormalizationReport;
use crate::NormalizerDescriptor;
use crate::NormalizerError;
use crate::ProbeResult;

#[allow(dead_code)]
#[derive(JsonSchema)]
struct NormalizerProtocolSchema {
    descriptor: NormalizerDescriptor,
    probe: ProbeResult,
    report: NormalizationReport,
    progress: NormalizationProgress,
    diagnostic: NormalizationDiagnostic,
    error: NormalizerError,
}

pub fn schema_document() -> Result<Value, serde_json::Error> {
    serde_json::to_value(schema_for!(NormalizerProtocolSchema))
}
