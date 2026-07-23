use utoipa::OpenApi;

#[test]
fn generated_openapi_matches_repository_fixture() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("openapi/openapi.json");
    let expected: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
    let generated = serde_json::to_value(context_admin_backend::ApiDoc::openapi())?;
    assert_eq!(expected, generated);
    Ok(())
}
