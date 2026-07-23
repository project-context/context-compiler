use context_compiler::BuildOptions;
use context_compiler::Compiler;
use context_compiler::ProcessorRegistry;
use context_protocol::AccessStatus;
use context_protocol::ReviewStatus;
use context_scope::AssignmentPurpose;
use context_scope::ContextRole;
use context_scope::Propagation;
use context_scope::ScopeAssignment;
use context_scope::ScopeReader;
use context_scope::ScopeRef;
use context_scope::ScopeStore;
use context_source::LocalSourceConnector;
use context_source::SourceReader;
use context_store_sqlite::SqliteStore;
use context_test_support::RefundFixture;
use context_workspace::StoreMode;
use context_workspace::Workspace;
use context_workspace::WorkspaceArtifactRepository;

#[tokio::test]
async fn removed_sources_become_missing_and_reviews_become_orphaned()
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
    let rules = compiler
        .normalizers()
        .resolve(&compiler.normalizers().default_config())?;
    let connector = LocalSourceConnector::new(fixture.root(), rules);
    let captured = connector
        .discover()?
        .iter()
        .map(|path| connector.capture(path))
        .collect::<Result<Vec<_>, _>>()?;
    compiler
        .compile_captured_workspace(fixture.root(), captured, BuildOptions::default())
        .await?;

    let fact = context_fact::FactReader::list_facts(&store)
        .await?
        .into_iter()
        .find(|fact| fact.trace.source_snapshot.entity.id.contains("refund.md"))
        .ok_or("refund fact was not compiled")?;
    store
        .put_assignments(vec![ScopeAssignment {
            id: "reviewed-refund-scope".to_owned(),
            target: fact.revision_ref,
            scope_ref: ScopeRef::new("policy:refund"),
            purpose: AssignmentPurpose::AppliesToContent,
            propagation: Propagation::Inherit,
            context_role: ContextRole::Main,
            review_status: ReviewStatus::Confirmed,
            trace: fact.trace,
        }])
        .await?;

    std::fs::remove_file(fixture.root().join("docs/refund.md"))?;
    let remaining = connector
        .discover()?
        .iter()
        .map(|path| connector.capture(path))
        .collect::<Result<Vec<_>, _>>()?;
    let summary = compiler
        .compile_captured_workspace(fixture.root(), remaining, BuildOptions::default())
        .await?;
    assert!(summary.stale_revisions > 0);
    assert!(
        store
            .list_sources()
            .await?
            .iter()
            .any(|source| source.uri.ends_with("refund.md")
                && source.access_status == AccessStatus::Missing)
    );
    assert_eq!(
        store.list_assignments().await?[0].review_status,
        ReviewStatus::Orphaned
    );
    Ok(())
}
use std::sync::Arc;
