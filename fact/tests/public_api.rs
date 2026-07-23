use context_fact::FactReader;
use context_fact::MemoryFactStore;

#[tokio::test]
async fn empty_store_is_usable_through_public_api() -> Result<(), Box<dyn std::error::Error>> {
    let store = MemoryFactStore::default();
    assert!(store.list_facts().await?.is_empty());
    Ok(())
}
