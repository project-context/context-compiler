use std::path::Path;

#[test]
fn generated_schema_matches_repository_fixture() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("core crate has no workspace parent")?;
    let expected: serde_json::Value = serde_json::from_slice(&std::fs::read(
        root.join("schema/connector.v1.schema.json"),
    )?)?;
    assert_eq!(agent_source_connector::schema_document()?, expected);
    Ok(())
}
