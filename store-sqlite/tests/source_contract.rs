use context_protocol::AccessStatus;
use context_protocol::EntityRef;
use context_protocol::Layer;
use context_protocol::RevisionRef;
use context_source::FormatId;
use context_source::MemorySourceStore;
use context_source::SourceCatalogReader;
use context_source::SourceQuery;
use context_source::SourceRecord;
use context_source::SourceStore;
use context_store_sqlite::SqliteStore;
use tempfile::tempdir;

async fn assert_source_contract<S: SourceStore>(
    store: &S,
    id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let entity = EntityRef::new(Layer::Source, id);
    let current = RevisionRef::new(entity.clone(), "sha256:one");
    let record = SourceRecord {
        entity_ref: entity.clone(),
        format: FormatId::new("markdown"),
        uri: "file:///docs/refund.md".to_owned(),
        title: "Refund".to_owned(),
        media_type: "text/markdown".to_owned(),
        current_snapshot: current,
        access_status: AccessStatus::Available,
    };
    store.put_source(record.clone()).await?;

    assert_eq!(store.get_source(&entity).await?, Some(record));
    Ok(())
}

async fn catalog_page<S: SourceStore + SourceCatalogReader>(
    store: &S,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    for (id, title) in [
        ("source:a", "Refund Alpha"),
        ("source:b", "Ignore"),
        ("source:c", "Refund Charlie"),
    ] {
        let entity = EntityRef::new(Layer::Source, id);
        store
            .put_source(SourceRecord {
                entity_ref: entity.clone(),
                format: FormatId::new("markdown"),
                uri: format!("{id}.md"),
                title: title.to_owned(),
                media_type: "text/markdown".to_owned(),
                current_snapshot: RevisionRef::new(entity, "r1"),
                access_status: AccessStatus::Available,
            })
            .await?;
    }
    let first = store
        .page_sources(SourceQuery {
            page: context_protocol::PageRequest {
                cursor: None,
                limit: Some(1),
            },
            text: Some("refund".to_owned()),
            format: Some(FormatId::new("markdown")),
            access_status: Some(AccessStatus::Available),
        })
        .await?;
    let second = store
        .page_sources(SourceQuery {
            page: context_protocol::PageRequest {
                cursor: first.next_cursor,
                limit: Some(1),
            },
            text: Some("refund".to_owned()),
            format: Some(FormatId::new("markdown")),
            access_status: Some(AccessStatus::Available),
        })
        .await?;
    Ok(first
        .items
        .into_iter()
        .chain(second.items)
        .map(|value| value.entity_ref.id)
        .collect())
}

#[tokio::test]
async fn source_contract_matches_memory_and_sqlite() -> Result<(), Box<dyn std::error::Error>> {
    let memory = MemorySourceStore::default();
    assert_source_contract(&memory, "memory/docs/refund.md").await?;

    let directory = tempdir()?;
    let sqlite = SqliteStore::connect(directory.path().join("context.db")).await?;
    assert_source_contract(&sqlite, "sqlite/docs/refund.md").await?;
    sqlite.close().await;

    let catalog_memory = MemorySourceStore::default();
    let catalog_sqlite = SqliteStore::connect(directory.path().join("catalog.db")).await?;
    assert_eq!(
        catalog_page(&catalog_memory).await?,
        catalog_page(&catalog_sqlite).await?
    );
    catalog_sqlite.close().await;
    Ok(())
}
