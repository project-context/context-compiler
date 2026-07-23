//! Read-only Context View query service.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod model;
mod service;

pub use model::ContextFilters;
pub use model::ContextRequest;
pub use model::ContextResult;
pub use model::ViewBinding;
pub use service::ContextReadStore;
pub use service::ContextService;
pub use service::QueryError;
pub use service::QueryResult;
