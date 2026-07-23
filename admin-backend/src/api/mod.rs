//! Axum/OpenAPI transport for Context Compiler management services.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod error;
mod router;

pub use error::ApiError;
pub use error::ApiErrorBody;
pub use router::AdminApiState;
pub use router::ApiDoc;
pub use router::router;
