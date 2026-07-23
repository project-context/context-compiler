use std::fs;

use context_test_support::schema_documents;

#[test]
fn generated_schemas_match_repository_fixtures() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("test-support must be a direct child of the workspace root")?;
    for (relative, generated) in schema_documents()? {
        let stored: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(root.join(relative))?)?;
        assert_eq!(stored, generated);
    }
    Ok(())
}
