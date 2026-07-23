//! Canonical, portable Context Compiler workspace configuration.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod model;
mod repository;
mod resolver;
mod schema;

pub use model::ContextConfig;
pub use model::NormalizationPolicy;
pub use model::NormalizationRule;
pub use model::PathNormalizationOverride;
pub use model::SourceDefinition;
pub use model::SourceNormalizationOverride;
pub use model::StructurePolicy;
pub use model::StructureRoute;
pub use model::TrashedSourceDefinition;
pub use repository::ConfigError;
pub use repository::ConfigRepository;
pub use repository::ConfigResult;
pub use repository::LoadedConfig;
pub use resolver::ResolvedRoute;
pub use resolver::RouteInput;
pub use schema::schema_document;
