use std::path::Path;

use utoipa::OpenApi;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("openapi/openapi.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(&context_admin_backend::ApiDoc::openapi())?;
    std::fs::write(path, bytes)?;
    Ok(())
}
