use context_scope::MemoryScopeStore;
use context_scope::ScopeReader;

#[tokio::test]
async fn empty_store_is_usable_through_public_api() -> Result<(), Box<dyn std::error::Error>> {
    let store = MemoryScopeStore::default();
    assert!(store.list_assignments().await?.is_empty());
    Ok(())
}
