use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("core crate has no workspace parent")?;
    let path = root.join("schema/normalizer.v1.schema.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(&agent_file_normalizer::schema_document()?)?;
    std::fs::write(path, bytes)?;
    Ok(())
}
