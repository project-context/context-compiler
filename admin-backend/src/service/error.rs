use thiserror::Error;

#[derive(Debug, Error)]
pub enum AdminError {
    #[error("admin state I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("admin state JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("workspace operation failed: {0}")]
    Workspace(#[from] context_workspace::WorkspaceError),
    #[error("configuration operation failed: {0}")]
    Config(#[from] context_config::ConfigError),
    #[error("resource was not found: {0}")]
    NotFound(String),
    #[error("operation conflicts with current state: {0}")]
    Conflict(String),
    #[error("request is invalid: {0}")]
    Invalid(String),
}

pub type AdminResult<T> = Result<T, AdminError>;
