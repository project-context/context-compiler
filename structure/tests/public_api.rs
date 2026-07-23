use context_structure::MemoryStructureStore;
use context_structure::StructureReader;

#[tokio::test]
async fn empty_store_is_usable_through_public_api() -> Result<(), Box<dyn std::error::Error>> {
    let store = MemoryStructureStore::default();
    assert!(store.list_structures().await?.is_empty());
    Ok(())
}
