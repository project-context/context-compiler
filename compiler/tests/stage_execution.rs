use std::collections::BTreeSet;
use std::sync::Arc;

use context_compiler::Compiler;
use context_compiler::ProcessorRegistry;
use context_config::StructurePolicy;
use context_evidence::EvidenceReader;
use context_fact::FactReader;
use context_protocol::AccessStatus;
use context_protocol::EntityRef;
use context_protocol::Layer;
use context_protocol::RevisionRef;
use context_semantic::SemanticReader;
use context_source::LocalSourceConnector;
use context_source::SourceReader;
use context_store_sqlite::SqliteStore;
use context_structure::StructureReader;
use context_test_support::RefundFixture;
use context_workspace::MemoryArtifactRepository;

#[tokio::test]
async fn stages_can_run_independently_using_canonical_upstream_outputs()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = RefundFixture::new()?;
    let database = tempfile::tempdir()?;
    let store = SqliteStore::connect(database.path().join("context.db")).await?;
    let compiler = Compiler::new(
        store.clone(),
        ProcessorRegistry::with_defaults(),
        Arc::new(MemoryArtifactRepository::default()),
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

    compiler.capture_stage(&captured).await?;
    assert_eq!(store.list_sources().await?.len(), captured.len());
    assert!(store.list_normalized().await?.is_empty());

    let mut progress = Vec::new();
    compiler
        .normalize_stage_with_progress(&captured, false, |value| {
            progress.push(value);
            true
        })
        .await?;
    assert!(progress.len() >= captured.len());
    assert_eq!(
        progress.last().map(|value| value.processed),
        Some(captured.len())
    );
    assert_eq!(
        progress.last().map(|value| value.total),
        Some(captured.len())
    );
    assert!(
        progress
            .windows(2)
            .all(|pair| pair[0].work_processed <= pair[1].work_processed)
    );
    assert_eq!(
        progress
            .last()
            .map(|value| (value.work_processed, value.work_total)),
        progress
            .last()
            .map(|value| (value.work_total, value.work_total))
    );
    assert!(!store.list_normalized().await?.is_empty());
    assert!(store.list_structures().await?.is_empty());

    compiler.structure_stage().await?;
    assert!(!store.list_structures().await?.is_empty());
    assert!(store.list_evidence().await?.is_empty());

    compiler.evidence_stage().await?;
    assert!(!store.list_evidence().await?.is_empty());
    assert!(store.list_facts().await?.is_empty());

    compiler.fact_stage().await?;
    assert!(!store.list_facts().await?.is_empty());
    assert!(store.list_edges().await?.is_empty());

    assert!(compiler.semantic_stage().await? > 0);
    assert!(!store.list_edges().await?.is_empty());
    assert!(compiler.project_stage(fixture.root()).await? > 0);
    Ok(())
}

#[tokio::test]
async fn cancelled_normalization_resumes_by_reusing_completed_files()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = RefundFixture::new()?;
    let database = tempfile::tempdir()?;
    let store = SqliteStore::connect(database.path().join("context.db")).await?;
    let compiler = Compiler::new(
        store,
        ProcessorRegistry::with_defaults(),
        Arc::new(MemoryArtifactRepository::default()),
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
    assert!(captured.len() > 1);
    compiler.capture_stage(&captured).await?;

    let result = compiler
        .normalize_stage_with_progress(&captured, false, |value| !value.file_completed)
        .await;
    assert!(matches!(
        result,
        Err(context_compiler::CompileError::Cancelled)
    ));

    let (built, skipped, _, _) = compiler.normalize_stage(&captured, false).await?;
    assert_eq!(built + skipped, captured.len());
    assert_eq!(skipped, 1);
    Ok(())
}

#[tokio::test]
async fn syncing_one_connector_does_not_mark_another_connector_missing()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = RefundFixture::new()?;
    let database = tempfile::tempdir()?;
    let store = SqliteStore::connect(database.path().join("context.db")).await?;
    let compiler = Compiler::new(
        store.clone(),
        ProcessorRegistry::with_defaults(),
        Arc::new(MemoryArtifactRepository::default()),
    );
    let rules = compiler
        .normalizers()
        .resolve(&compiler.normalizers().default_config())?;
    let connector = LocalSourceConnector::new(fixture.root(), rules);
    let template = connector.capture(&connector.discover()?[0])?;

    let mut source_a = template.clone();
    source_a.record.entity_ref = EntityRef::new(Layer::Source, "source:a:document.md");
    source_a.record.current_snapshot = RevisionRef::new(
        source_a.record.entity_ref.clone(),
        source_a.snapshot.content_hash.clone(),
    );
    source_a.snapshot.revision_ref = source_a.record.current_snapshot.clone();

    let mut source_b = template;
    source_b.record.entity_ref = EntityRef::new(Layer::Source, "source:b:document.md");
    source_b.record.current_snapshot = RevisionRef::new(
        source_b.record.entity_ref.clone(),
        source_b.snapshot.content_hash.clone(),
    );
    source_b.snapshot.revision_ref = source_b.record.current_snapshot.clone();

    compiler
        .capture_stage(&[source_a.clone(), source_b.clone()])
        .await?;
    compiler
        .capture_stage_for_sources(&[], &BTreeSet::from(["a".to_owned()]))
        .await?;

    assert_eq!(
        store
            .get_source(&source_a.record.entity_ref)
            .await?
            .ok_or("missing source a")?
            .access_status,
        AccessStatus::Missing
    );
    assert_eq!(
        store
            .get_source(&source_b.record.entity_ref)
            .await?
            .ok_or("missing source b")?
            .access_status,
        AccessStatus::Available
    );
    Ok(())
}

#[tokio::test]
async fn structure_stage_reports_real_progress_reuses_and_cancels_at_file_boundaries()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = RefundFixture::new()?;
    let database = tempfile::tempdir()?;
    let store = SqliteStore::connect(database.path().join("context.db")).await?;
    let compiler = Compiler::new(
        store.clone(),
        ProcessorRegistry::with_defaults(),
        Arc::new(MemoryArtifactRepository::default()),
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
    compiler.capture_stage(&captured).await?;
    compiler.normalize_stage(&captured, false).await?;

    let mut progress = Vec::new();
    let (units, reused, failed, diagnostics) = compiler
        .structure_stage_with_progress(&StructurePolicy::default(), false, |event| {
            progress.push(event);
            true
        })
        .await?;
    assert!(units > 0);
    assert_eq!(reused, 0);
    assert_eq!(failed, 0, "{diagnostics:?}");
    assert!(
        progress
            .windows(2)
            .all(|pair| pair[0].work_processed <= pair[1].work_processed)
    );
    assert_eq!(
        progress.last().map(|event| (event.processed, event.total)),
        progress.last().map(|event| (event.total, event.total))
    );
    assert_eq!(
        progress
            .last()
            .map(|event| (event.work_processed, event.work_total)),
        progress
            .last()
            .map(|event| (event.work_total, event.work_total))
    );

    let (_, reused, failed, _) = compiler
        .structure_stage_with_progress(&StructurePolicy::default(), false, |_| true)
        .await?;
    assert_eq!(reused, captured.len());
    assert_eq!(failed, 0);

    let before = store.list_structures().await?;
    let cancelled = compiler
        .structure_stage_with_progress(&StructurePolicy::default(), true, |_| false)
        .await;
    assert!(matches!(
        cancelled,
        Err(context_compiler::CompileError::Cancelled)
    ));
    assert_eq!(store.list_structures().await?, before);
    Ok(())
}
