use std::sync::Arc;

use context_query::ContextRequest;
use context_query::ContextResult;
use context_query::ContextService;
use context_store_sqlite::SqliteStore;
use context_workspace::Workspace;
use rmcp::Json;
use rmcp::ServerHandler;
use rmcp::ServiceExt;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::tool;
use rmcp::tool_handler;
use rmcp::tool_router;

#[derive(Clone)]
struct ContextMcpServer {
    service: Arc<ContextService<SqliteStore>>,
    tool_router: ToolRouter<Self>,
}

impl ContextMcpServer {
    fn new(service: ContextService<SqliteStore>) -> Self {
        Self {
            service: Arc::new(service),
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router(router = tool_router)]
impl ContextMcpServer {
    #[tool(
        name = "context",
        description = "Explore the compiled project context, expand a Fact, or inspect the manifest"
    )]
    async fn context(
        &self,
        Parameters(request): Parameters<ContextRequest>,
    ) -> Result<Json<ContextResult>, String> {
        self.service
            .context(request)
            .await
            .map(Json)
            .map_err(|error| error.to_string())
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for ContextMcpServer {}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let current = std::env::current_dir()?;
    let home = Workspace::default_compiler_home()?;
    let workspace = Workspace::discover(current, home)?;
    let store = SqliteStore::connect(workspace.database_path()).await?;
    let server = ContextMcpServer::new(ContextService::new(store));
    server
        .serve((tokio::io::stdin(), tokio::io::stdout()))
        .await?
        .waiting()
        .await?;
    Ok(())
}
