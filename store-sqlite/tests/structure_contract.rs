use context_protocol::ArtifactRef;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::Locator;
use context_protocol::PageRequest;
use context_protocol::ProducerRef;
use context_protocol::RevisionRef;
use context_protocol::RunStatus;
use context_protocol::Trace;
use context_store_sqlite::SqliteStore;
use context_structure::MemoryStructureStore;
use context_structure::StructureBuildRecord;
use context_structure::StructureCommit;
use context_structure::StructureKind;
use context_structure::StructureRelationRecord;
use context_structure::StructureRelationType;
use context_structure::StructureStore;
use context_structure::StructureUnit;
use tempfile::tempdir;

async fn assert_structure_contract<S: StructureStore>(
    store: &S,
    namespace: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let source = RevisionRef::new(
        EntityRef::new(Layer::Source, format!("{namespace}:source")),
        "source-v1",
    );
    let normalized = RevisionRef::new(
        EntityRef::new(Layer::Source, format!("{namespace}:normalized")),
        "normalized-v1",
    );
    let build_entity = EntityRef::new(Layer::Structure, format!("{namespace}:build"));
    let build_ref = RevisionRef::new(build_entity.clone(), "build-v1");
    let parent_ref = RevisionRef::new(
        EntityRef::new(Layer::Structure, format!("{namespace}:document")),
        "unit-v1",
    );
    let child_ref = RevisionRef::new(
        EntityRef::new(Layer::Structure, format!("{namespace}:heading")),
        "unit-v1",
    );
    let relation_ref = RevisionRef::new(
        EntityRef::new(Layer::Structure, format!("{namespace}:contains")),
        "relation-v1",
    );
    let artifact = ArtifactRef::new(
        "artifact:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    let producer = ProducerRef {
        name: "markdown-ast".to_owned(),
        version: "1.0.0".to_owned(),
        config_hash: "sha256:config".to_owned(),
    };
    let trace = Trace {
        source_snapshot: source.clone(),
        parents: vec![normalized.clone()],
        producer: producer.clone(),
    };
    let document = StructureUnit {
        revision_ref: parent_ref.clone(),
        build_ref: build_ref.clone(),
        kind: StructureKind::Document,
        stable_key: "document".to_owned(),
        label: "Document".to_owned(),
        locator: Locator::ByteRange {
            artifact: artifact.clone(),
            start: 0,
            end: 16,
        },
        text: "# Refund".to_owned(),
        trace: trace.clone(),
        freshness: Freshness::Current,
    };
    let heading = StructureUnit {
        revision_ref: child_ref.clone(),
        build_ref: build_ref.clone(),
        kind: StructureKind::new("custom_heading"),
        stable_key: "refund".to_owned(),
        label: "Refund".to_owned(),
        locator: Locator::ByteRange {
            artifact: artifact.clone(),
            start: 0,
            end: 8,
        },
        text: "# Refund".to_owned(),
        trace: trace.clone(),
        freshness: Freshness::Current,
    };
    let relation = StructureRelationRecord {
        revision_ref: relation_ref.clone(),
        build_ref: build_ref.clone(),
        relation_type: StructureRelationType::new("contains"),
        from: parent_ref.clone(),
        to: child_ref.clone(),
        locator: None,
        fingerprint: "sha256:relation".to_owned(),
        trace,
        freshness: Freshness::Current,
    };
    store
        .commit_structure(StructureCommit {
            build: StructureBuildRecord {
                entity_ref: build_entity.clone(),
                revision_ref: build_ref.clone(),
                source_snapshot: source,
                normalized_source: normalized,
                producer,
                status: RunStatus::Completed,
                fingerprint: "sha256:build".to_owned(),
                internal_artifact: Some(artifact),
                unit_count: 2,
                relation_count: 1,
            },
            units: vec![document, heading],
            relations: vec![relation],
            stale: Vec::new(),
        })
        .await?;

    assert_eq!(
        store
            .get_structure_build_by_ref("build-v1")
            .await?
            .map(|build| build.entity_ref),
        Some(build_entity)
    );
    assert_eq!(
        store
            .find_structure(Some("custom_heading"), "refund")
            .await?
            .map(|unit| unit.revision_ref),
        Some(child_ref)
    );

    let first = store
        .page_structure_units_for_build(
            &build_ref,
            PageRequest {
                cursor: None,
                limit: Some(1),
            },
            None,
        )
        .await?;
    assert_eq!(first.items.len(), 1);
    assert!(first.next_cursor.is_some());
    let second = store
        .page_structure_units_for_build(
            &build_ref,
            PageRequest {
                cursor: first.next_cursor,
                limit: Some(1),
            },
            Some("refund".to_owned()),
        )
        .await?;
    assert_eq!(second.items.len(), 1);

    let relations = store
        .page_structure_relations_for_build(
            &build_ref,
            PageRequest {
                cursor: None,
                limit: Some(50),
            },
        )
        .await?;
    assert_eq!(relations.items.len(), 1);
    assert_eq!(relations.items[0].relation_type, "contains");
    Ok(())
}

#[tokio::test]
async fn structure_contract_matches_memory_and_sqlite() -> Result<(), Box<dyn std::error::Error>> {
    assert_structure_contract(&MemoryStructureStore::default(), "memory").await?;

    let directory = tempdir()?;
    let sqlite = SqliteStore::connect(directory.path().join("context.db")).await?;
    assert_structure_contract(&sqlite, "sqlite").await?;
    sqlite.close().await;
    Ok(())
}
