use context_semantic::MemorySemanticStore;
use context_semantic::SemanticReader;

#[tokio::test]
async fn empty_store_is_usable_through_public_api() -> Result<(), Box<dyn std::error::Error>> {
    let store = MemorySemanticStore::default();
    assert!(store.list_edges().await?.is_empty());
    Ok(())
}
