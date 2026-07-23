//! Context Compiler management backend: services, HTTP API, persistence and embedded web host.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod api;
mod backend;
mod persistence;
mod service;
mod web;

use std::net::IpAddr;
use std::net::Ipv4Addr;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

pub use api::AdminApiState;
pub use api::ApiDoc;
pub use api::ApiError;
pub use api::ApiErrorBody;
pub use api::router;
pub use backend::ServerBackend;
pub use service::AdminBackend;
pub use service::AdminError;
pub use service::AdminFuture;
pub use service::AdminResult;
pub use service::ArtifactPreview;
pub use service::ArtifactPreviewRequest;
pub use service::BuildEvent;
pub use service::BuildEventKind;
pub use service::BuildJob;
pub use service::BuildJobStatus;
pub use service::BuildStage;
pub use service::JobManager;
pub use service::JobPersistence;
pub use service::JobPersistenceFuture;
pub use service::JobReporter;
pub use service::JobTaskResult;
pub use service::LayerCollection;
pub use service::LayerQuery;
pub use service::ManualScopeAssignmentRequest;
pub use service::NormalizationPreview;
pub use service::NormalizationPreviewRequest;
pub use service::NormalizationResolveRequest;
pub use service::NormalizerCatalogEntry;
pub use service::PipelineRunRequest;
pub use service::RegisteredWorkspace;
pub use service::ReviewCommand;
pub use service::ReviewDecision;
pub use service::ReviewSubject;
pub use service::ScopeContextView;
pub use service::StructureConfigView;
pub use service::StructureFileFamilyView;
pub use service::StructureFormatView;
pub use service::StructureParserCatalogEntry;
pub use service::WorkspaceFileEntry;
pub use service::WorkspaceFileKind;
pub use service::WorkspaceRegistry;

pub const DEFAULT_ADMIN_PORT: u16 = 7799;

#[derive(Clone, Debug)]
pub struct AdminServerOptions {
    pub compiler_home: PathBuf,
    pub address: SocketAddr,
}

impl AdminServerOptions {
    pub fn local(compiler_home: PathBuf, port: u16) -> Self {
        Self {
            compiler_home,
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        }
    }
}

pub async fn serve(options: AdminServerOptions) -> Result<SocketAddr, std::io::Error> {
    if !options.address.ip().is_loopback() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "the first release only permits loopback admin listeners",
        ));
    }
    let backend = Arc::new(
        ServerBackend::new(options.compiler_home)
            .await
            .map_err(|error| std::io::Error::other(error.to_string()))?,
    );
    let app = web::with_embedded_web(api::router(backend));
    let listener = tokio::net::TcpListener::bind(options.address).await?;
    let address = listener.local_addr()?;
    axum::serve(listener, app).await?;
    Ok(address)
}
