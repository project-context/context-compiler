use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::Value;
use thiserror::Error;

use crate::CapturedContent;
use crate::ConnectionTestResult;
use crate::ConnectorDescriptor;
use crate::DiscoveryRequest;
use crate::DiscoveryResult;
use crate::SecretRef;

#[derive(Debug, Error)]
pub enum ConnectorError {
    #[error("connector configuration is invalid: {0}")]
    Configuration(String),
    #[error("connector authentication failed: {0}")]
    Authentication(String),
    #[error("connector I/O failed: {0}")]
    Io(String),
    #[error("connector object was not found: {0}")]
    NotFound(String),
    #[error("connector operation was cancelled")]
    Cancelled,
    #[error("connector operation is unsupported: {0}")]
    Unsupported(String),
}

pub type ConnectorResult<T> = Result<T, ConnectorError>;
pub type ConnectorFuture<'a, T> = Pin<Box<dyn Future<Output = ConnectorResult<T>> + Send + 'a>>;

pub trait SecretProvider: Send + Sync {
    fn get(&self, secret_ref: &SecretRef) -> ConnectorFuture<'_, Option<Vec<u8>>>;
}

pub trait SourceConnectorFactory: Send + Sync {
    fn descriptor(&self) -> ConnectorDescriptor;
    fn validate_config(&self, config: &Value) -> ConnectorResult<()>;
    fn connect(
        &self,
        config: Value,
        secrets: Arc<dyn SecretProvider>,
    ) -> ConnectorFuture<'_, Box<dyn SourceConnector>>;
}

pub trait SourceConnector: Send + Sync {
    fn test(&self) -> ConnectorFuture<'_, ConnectionTestResult>;
    fn discover(&self, request: DiscoveryRequest) -> ConnectorFuture<'_, DiscoveryResult>;
    fn capture(&self, stable_key: &str) -> ConnectorFuture<'_, CapturedContent>;
}
