use clap::Parser;
use context_admin_backend::AdminServerOptions;
use context_admin_backend::DEFAULT_ADMIN_PORT;
use context_admin_backend::serve;
use context_workspace::Workspace;

#[derive(Parser)]
#[command(name = "context-admin-backend")]
struct Args {
    #[arg(long, default_value_t = DEFAULT_ADMIN_PORT)]
    port: u16,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let home = Workspace::default_compiler_home()?;
    serve(AdminServerOptions::local(home, args.port)).await?;
    Ok(())
}
