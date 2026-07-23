use context_compiler::BuildOptions;
use context_compiler::Compiler;
use context_compiler::ProcessorRegistry;
use context_protocol::Freshness;
use context_query::ContextFilters;
use context_query::ContextRequest;
use context_query::ContextService;
use context_semantic::SemanticReader;
use context_source::LocalSourceConnector;
use context_source::SourceReader;
use context_store_sqlite::SqliteStore;
use context_test_support::RefundFixture;
use context_workspace::StoreMode;
use context_workspace::Workspace;
use context_workspace::WorkspaceArtifactRepository;

#[tokio::test]
async fn refund_slice_compiles_queries_and_invalidates_incrementally()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = RefundFixture::new()?;
    let home = tempfile::tempdir()?;
    let workspace = Workspace::init(fixture.root(), home.path(), StoreMode::External)?;
    let store = SqliteStore::connect(workspace.database_path()).await?;
    let compiler = Compiler::new(
        store.clone(),
        ProcessorRegistry::with_defaults(),
        Arc::new(WorkspaceArtifactRepository::new(&workspace)),
    );
    let normalization_config = compiler.normalizers().default_config();
    let normalization_rules = compiler.normalizers().resolve(&normalization_config)?;
    let connector = LocalSourceConnector::new(fixture.root(), normalization_rules);
    let captured = connector
        .discover()?
        .iter()
        .map(|path| connector.capture(path))
        .collect::<Result<Vec<_>, _>>()?;
    let old_markdown_snapshot = captured
        .iter()
        .find(|source| source.record.uri.ends_with("refund.md"))
        .map(|source| source.snapshot.revision_ref.clone())
        .ok_or("refund Markdown fixture was not discovered")?;
    let first = compiler
        .compile_sources(captured, BuildOptions::default())
        .await?;
    assert_eq!(first.built, 2);
    assert!(first.facts >= 3);
    assert!(first.semantic_edges >= 1);
    assert!(
        store
            .list_edges()
            .await?
            .iter()
            .any(|edge| edge.freshness == Freshness::Current)
    );

    let view = ContextService::new(store.clone())
        .context(ContextRequest::Explore {
            terms: vec!["退款".to_owned()],
            filters: ContextFilters::default(),
        })
        .await?;
    assert!(view.markdown.contains("byte_range"));
    insta::assert_snapshot!("refund_context_view", view.markdown);

    let unchanged = connector
        .discover()?
        .iter()
        .map(|path| connector.capture(path))
        .collect::<Result<Vec<_>, _>>()?;
    let second = compiler
        .compile_sources(unchanged, BuildOptions::default())
        .await?;
    assert_eq!(second.skipped, 2);

    std::fs::write(
        fixture.root().join("docs/refund.md"),
        "# 退款规则\n\n退款必须在 14 天内完成。\n",
    )?;
    let updated = connector.capture(&fixture.root().join("docs/refund.md"))?;
    let third = compiler
        .compile_source(updated, BuildOptions::default())
        .await?;
    assert!(third.stale_revisions > 0);
    assert!(store.get_snapshot(&old_markdown_snapshot).await?.is_some());
    assert!(
        store
            .list_edges()
            .await?
            .iter()
            .any(|edge| edge.freshness == Freshness::Stale)
    );
    Ok(())
}
use std::sync::Arc;
