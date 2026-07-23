use std::error::Error;
use std::sync::Arc;

use context_compiler::BuildOptions;
use context_compiler::Compiler;
use context_compiler::ProcessorRegistry;
use context_protocol::Freshness;
use context_source::FormatId;
use context_source::SourceReader;
use context_store_sqlite::SqliteStore;
use context_workspace::MemoryArtifactRepository;
use pretty_assertions::assert_eq;

#[tokio::test]
async fn configurable_a_to_b_normalizers_drive_projection_and_processors()
-> Result<(), Box<dyn Error>> {
    let workspace = tempfile::tempdir()?;
    let database = tempfile::tempdir()?;
    std::fs::write(workspace.path().join("notes.txt"), "# Refund\r\nseven days")?;
    std::fs::write(workspace.path().join("page.html"), "<h1>Refund</h1>\r\n")?;
    let store = SqliteStore::connect(database.path().join("context.db")).await?;
    let compiler = Compiler::new(
        store.clone(),
        ProcessorRegistry::with_defaults(),
        Arc::new(MemoryArtifactRepository::default()),
    );

    let result = compiler
        .compile_workspace(workspace.path(), BuildOptions::default())
        .await?;

    assert_eq!(result.built, 2);
    assert!(result.facts > 0);
    let html_result = result
        .sources
        .iter()
        .find(|source| source.structures == 0)
        .ok_or("HTML source-only build was not found")?;
    assert_eq!(html_result.facts, 0);
    assert!(
        html_result
            .diagnostics
            .iter()
            .any(|value| value.starts_with("processor_missing:"))
    );

    let normalized = store.list_normalized().await?;
    assert!(
        normalized
            .iter()
            .any(|value| value.format == FormatId::new("markdown"))
    );
    assert!(
        normalized
            .iter()
            .any(|value| value.format == FormatId::new("html"))
    );
    assert_eq!(
        std::fs::read_to_string(workspace.path().join(".context/sources/notes.txt.md"))?,
        "# Refund\nseven days"
    );
    assert_eq!(
        std::fs::read_to_string(workspace.path().join(".context/sources/page.html"))?,
        "<h1>Refund</h1>\n"
    );

    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(
        workspace.path().join("context.config.json"),
    )?)?;
    let rules = config["normalization"]["defaults"]
        .as_array()
        .ok_or("normalizer rules were not serialized")?;
    assert_eq!(rules.len(), 5);
    assert_eq!(
        rules
            .iter()
            .filter(|rule| rule["extensions"] == serde_json::json!(["pdf"]))
            .count(),
        1
    );
    Ok(())
}

#[tokio::test]
async fn changing_mapping_rebuilds_an_unchanged_source_and_stales_old_normalization()
-> Result<(), Box<dyn Error>> {
    let workspace = tempfile::tempdir()?;
    let database = tempfile::tempdir()?;
    std::fs::write(workspace.path().join("notes.txt"), "# Refund\nseven days")?;
    let store = SqliteStore::connect(database.path().join("context.db")).await?;
    let compiler = Compiler::new(
        store.clone(),
        ProcessorRegistry::with_defaults(),
        Arc::new(MemoryArtifactRepository::default()),
    );

    let first = compiler
        .compile_workspace(workspace.path(), BuildOptions::default())
        .await?;
    assert_eq!(first.built, 1);

    let config = serde_json::json!({
        "schemaVersion": 1,
        "sources": [],
        "normalization": {
            "defaults": [{
                "id": "txt-as-html",
                "normalizerId": "html-to-html",
                "enabled": true,
                "extensions": ["txt"],
                "priority": 500
            }],
            "sourceOverrides": [],
            "pathOverrides": []
        }
    });
    std::fs::write(
        workspace.path().join("context.config.json"),
        serde_json::to_vec_pretty(&config)?,
    )?;

    let second = compiler
        .compile_workspace(workspace.path(), BuildOptions::default())
        .await?;
    assert_eq!(second.built, 1);
    assert_eq!(second.skipped, 0);
    assert!(second.stale_revisions > 0);

    let normalized = store.list_normalized().await?;
    assert!(normalized.iter().any(|value| {
        value.normalizer_id == "text-to-markdown" && value.freshness == Freshness::Stale
    }));
    assert!(normalized.iter().any(|value| {
        value.normalizer_id == "html-to-html" && value.freshness == Freshness::Current
    }));
    let sources = store.list_sources().await?;
    assert_eq!(sources[0].format, FormatId::new("html"));
    assert!(
        !workspace
            .path()
            .join(".context/sources/notes.txt.md")
            .exists()
    );
    assert!(
        workspace
            .path()
            .join(".context/sources/notes.txt.html")
            .exists()
    );
    Ok(())
}
