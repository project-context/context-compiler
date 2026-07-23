//! Portable contracts for discovering and capturing source objects.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod model;
mod schema;
mod traits;

pub use model::CapturedContent;
pub use model::ConnectionTestResult;
pub use model::ConnectorCapabilities;
pub use model::ConnectorDescriptor;
pub use model::ConnectorDiagnostic;
pub use model::ConnectorDiagnosticLevel;
pub use model::ConnectorInstanceConfig;
pub use model::ConnectorObject;
pub use model::DiscoveryRequest;
pub use model::DiscoveryResult;
pub use model::SecretRef;
pub use schema::schema_document;
pub use traits::ConnectorError;
pub use traits::ConnectorFuture;
pub use traits::ConnectorResult;
pub use traits::SecretProvider;
pub use traits::SourceConnector;
pub use traits::SourceConnectorFactory;
