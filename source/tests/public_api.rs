use std::error::Error;

use context_protocol::AccessStatus;
use context_protocol::EntityRef;
use context_protocol::Layer;
use context_protocol::RevisionRef;
use context_source::FormatId;
use context_source::MemorySourceStore;
use context_source::SourceReader;
use context_source::SourceRecord;
use context_source::SourceStore;
use pretty_assertions::assert_eq;

#[tokio::test]
async fn public_store_api_round_trips_source_records() -> Result<(), Box<dyn Error>> {
    let store = MemorySourceStore::default();
    let entity_ref = EntityRef::new(Layer::Source, "source:test");
    let current_snapshot = RevisionRef::new(entity_ref.clone(), "sha256:test");
    let source = SourceRecord {
        entity_ref: entity_ref.clone(),
        format: FormatId::new("markdown"),
        uri: "refund.md".to_string(),
        title: "Refund".to_string(),
        media_type: "text/markdown".to_string(),
        current_snapshot,
        access_status: AccessStatus::Available,
    };
    store.put_source(source.clone()).await?;
    assert_eq!(store.get_source(&entity_ref).await?, Some(source));
    Ok(())
}
