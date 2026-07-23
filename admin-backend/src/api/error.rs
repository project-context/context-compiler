use crate::AdminError;
use axum::Json;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::Response;
use serde::Deserialize;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    pub diagnostics: Vec<String>,
    pub request_id: String,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    body: ApiErrorBody,
}

impl ApiError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "invalid_request", message)
    }

    pub fn precondition(message: impl Into<String>) -> Self {
        Self::new(StatusCode::PRECONDITION_FAILED, "etag_mismatch", message)
    }

    pub fn precondition_required(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::PRECONDITION_REQUIRED,
            "if_match_required",
            message,
        )
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "csrf_rejected", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", message)
    }

    fn new(status: StatusCode, code: &str, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ApiErrorBody {
                code: code.to_owned(),
                message: message.into(),
                diagnostics: Vec::new(),
                request_id: Uuid::now_v7().to_string(),
            },
        }
    }
}

impl From<AdminError> for ApiError {
    fn from(value: AdminError) -> Self {
        match value {
            AdminError::NotFound(message) => Self::new(StatusCode::NOT_FOUND, "not_found", message),
            AdminError::Conflict(message) => Self::new(StatusCode::CONFLICT, "conflict", message),
            AdminError::Config(context_config::ConfigError::Precondition { expected, current }) => {
                Self::new(
                    StatusCode::CONFLICT,
                    "etag_mismatch",
                    format!("expected {expected}, current {current}"),
                )
            }
            AdminError::Invalid(message) => Self::bad_request(message),
            other => Self::internal(other.to_string()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}
