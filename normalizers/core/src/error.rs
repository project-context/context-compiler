use std::future::Future;
use std::pin::Pin;

use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;

use crate::OriginalLocator;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct NormalizerErrorCode(String);

impl NormalizerErrorCode {
    pub const UNSUPPORTED_INPUT: &'static str = "unsupported_input";
    pub const INVALID_CONFIG: &'static str = "invalid_config";
    pub const CORRUPT_INPUT: &'static str = "corrupt_input";
    pub const PASSWORD_REQUIRED: &'static str = "password_required";
    pub const OCR_REQUIRED: &'static str = "ocr_required";
    pub const DEPENDENCY_MISSING: &'static str = "dependency_missing";
    pub const RESOURCE_LIMIT: &'static str = "resource_limit";
    pub const CANCELLED: &'static str = "cancelled";
    pub const ARTIFACT_WRITE_FAILED: &'static str = "artifact_write_failed";
    pub const INVALID_OUTPUT: &'static str = "invalid_output";
    pub const INTERNAL: &'static str = "internal";

    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for NormalizerErrorCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum NormalizerErrorCategory {
    Configuration,
    Input,
    Requirement,
    Resource,
    Cancellation,
    Output,
    Internal,
}

#[derive(Clone, Debug, Error, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[error("{code}: {message}")]
#[serde(rename_all = "camelCase")]
pub struct NormalizerError {
    pub code: NormalizerErrorCode,
    pub category: NormalizerErrorCategory,
    pub message: String,
    pub retryable: bool,
    pub locator: Option<OriginalLocator>,
}

impl NormalizerError {
    pub fn new(
        code: impl Into<String>,
        category: NormalizerErrorCategory,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: NormalizerErrorCode::new(code),
            category,
            message: message.into(),
            retryable: false,
            locator: None,
        }
    }

    pub fn invalid_config(message: impl Into<String>) -> Self {
        Self::new(
            NormalizerErrorCode::INVALID_CONFIG,
            NormalizerErrorCategory::Configuration,
            message,
        )
    }

    pub fn corrupt_input(message: impl Into<String>) -> Self {
        Self::new(
            NormalizerErrorCode::CORRUPT_INPUT,
            NormalizerErrorCategory::Input,
            message,
        )
    }

    pub fn invalid_output(message: impl Into<String>) -> Self {
        Self::new(
            NormalizerErrorCode::INVALID_OUTPUT,
            NormalizerErrorCategory::Output,
            message,
        )
    }

    pub fn artifact_write(message: impl Into<String>) -> Self {
        Self::new(
            NormalizerErrorCode::ARTIFACT_WRITE_FAILED,
            NormalizerErrorCategory::Output,
            message,
        )
    }

    pub fn cancelled() -> Self {
        Self::new(
            NormalizerErrorCode::CANCELLED,
            NormalizerErrorCategory::Cancellation,
            "normalization was cancelled",
        )
    }

    pub fn is_cancelled(&self) -> bool {
        self.code.as_str() == NormalizerErrorCode::CANCELLED
    }
}

pub type NormalizerResult<T> = Result<T, NormalizerError>;
pub type NormalizerFuture<'a, T> = Pin<Box<dyn Future<Output = NormalizerResult<T>> + Send + 'a>>;
