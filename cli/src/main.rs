use std::path::Path;

use clap::Args;
use clap::Parser;
use clap::Subcommand;
use context_admin_backend::AdminServerOptions;
use context_admin_backend::DEFAULT_ADMIN_PORT;
use context_admin_backend::ServerBackend;
use context_compiler::BuildOptions;
use context_query::ContextRequest;
use context_query::ContextService;
use context_store_sqlite::SqliteStore;
use context_workspace::AgentConfigOutcome;
use context_workspace::StoreMode;
use context_workspace::Workspace;
use context_workspace::WorkspaceError;
use context_workspace::ensure_managed_agent_block;
use serde_json::json;

#[derive(Parser)]
#[command(
    name = "context",
    version,
    about = "Compile a repository into an AI-readable project context"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Build(BuildArgs),
    Status(OutputArgs),
    Doctor(OutputArgs),
    Admin(AdminArgs),
}

#[derive(Args)]
struct BuildArgs {
    #[arg(long)]
    full: bool,
    #[arg(long)]
    portable: bool,
    #[arg(long)]
    no_agent: bool,
    #[arg(long)]
    json: bool,
}

#[derive(Args)]
struct OutputArgs {
    #[arg(long)]
    json: bool,
}

#[derive(Args)]
struct AdminArgs {
    #[arg(long, default_value_t = DEFAULT_ADMIN_PORT)]
    port: u16,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Command::Build(args) => build(args).await?,
        Command::Status(args) => status(args).await?,
        Command::Doctor(args) => doctor(args)?,
        Command::Admin(args) => admin(args).await?,
    }
    Ok(())
}

async fn admin(args: AdminArgs) -> Result<(), Box<dyn std::error::Error>> {
    let home = Workspace::default_compiler_home()?;
    println!("Context Compiler admin: http://127.0.0.1:{}", args.port);
    context_admin_backend::serve(AdminServerOptions::local(home, args.port)).await?;
    Ok(())
}

async fn build(args: BuildArgs) -> Result<(), Box<dyn std::error::Error>> {
    let mut workspace = load_workspace(true, args.portable)?;
    if args.portable {
        workspace.set_store_mode(StoreMode::Portable)?;
    }
    let home = Workspace::default_compiler_home()?;
    let backend = ServerBackend::new(home).await?;
    let registered = backend.register_workspace_root(workspace.root())?;
    let summary = backend
        .compile_now(
            &registered.workspace_id,
            BuildOptions {
                full: args.full,
                portable: args.portable,
                no_agent: args.no_agent,
            },
        )
        .await?;
    let agent_outcome = if args.no_agent {
        None
    } else {
        Some(ensure_managed_agent_block(
            workspace.root().join("AGENTS.md"),
            "Use the Context Compiler MCP `context()` tool before making project-level changes.",
        )?)
    };
    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "summary": summary,
                "agentConfig": agent_outcome.map(agent_outcome_name),
            }))?
        );
    } else {
        println!(
            "Built {} source(s), skipped {}, produced {} fact(s) and {} semantic edge(s).",
            summary.built, summary.skipped, summary.facts, summary.semantic_edges
        );
        if let Some(outcome) = agent_outcome {
            println!("Agent config: {}.", agent_outcome_name(outcome));
        }
    }
    Ok(())
}

async fn status(args: OutputArgs) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = load_workspace(false, false)?;
    let store = SqliteStore::connect(workspace.database_path()).await?;
    let result = ContextService::new(store)
        .context(ContextRequest::Manifest)
        .await?;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        print!("{}", result.markdown);
    }
    Ok(())
}

fn doctor(args: OutputArgs) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = load_workspace(false, false)?;
    let agent_path = workspace.root().join("AGENTS.md");
    let agent_status = agent_status(&agent_path)?;
    let report = json!({
        "workspaceId": workspace.config().workspace_id,
        "schemaVersion": workspace.config().schema_version,
        "storeMode": workspace.config().store_mode,
        "database": workspace.database_path(),
        "databaseExists": workspace.database_path().exists(),
        "agentEntry": agent_status,
    });
    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!("Workspace: {}", workspace.config().workspace_id);
        println!("Database: {}", workspace.database_path().display());
        println!("Agent entry: {agent_status}");
    }
    Ok(())
}

fn load_workspace(create: bool, portable: bool) -> Result<Workspace, WorkspaceError> {
    let current = std::env::current_dir()?;
    let home = Workspace::default_compiler_home()?;
    match Workspace::discover(&current, &home) {
        Ok(workspace) => Ok(workspace),
        Err(WorkspaceError::NotFound(_)) if create => Workspace::init(
            current,
            home,
            if portable {
                StoreMode::Portable
            } else {
                StoreMode::External
            },
        ),
        Err(error) => Err(error),
    }
}

fn agent_status(path: &Path) -> Result<&'static str, std::io::Error> {
    if !path.exists() {
        return Ok("missing");
    }
    let content = std::fs::read_to_string(path)?;
    if content.contains("<!-- context-compiler:managed:start -->") {
        Ok("managed")
    } else {
        Ok("unmanaged-conflict")
    }
}

fn agent_outcome_name(outcome: AgentConfigOutcome) -> &'static str {
    match outcome {
        AgentConfigOutcome::Created => "created",
        AgentConfigOutcome::UpdatedManagedBlock => "updated-managed-block",
        AgentConfigOutcome::Unchanged => "unchanged",
        AgentConfigOutcome::SkippedUnmanaged => "skipped-unmanaged",
    }
}
