//! Workspace identity, projections, external-store location, and managed Agent entries.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod agent;
mod artifact;
mod config;
mod layout;

pub use agent::AgentConfigOutcome;
pub use agent::ensure_managed_agent_block;
pub use artifact::ArtifactFuture;
pub use artifact::ArtifactRepository;
pub use artifact::MemoryArtifactRepository;
pub use artifact::WorkspaceArtifactRepository;
pub use config::StoreMode;
pub use config::WorkspaceConfig;
pub use layout::Workspace;
pub use layout::WorkspaceError;
pub use layout::WorkspaceResult;

#[cfg(test)]
#[path = "workspace_tests.rs"]
mod tests;
