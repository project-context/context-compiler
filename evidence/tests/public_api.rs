use context_evidence::EvidenceReader;
use context_evidence::MemoryEvidenceStore;

#[tokio::test]
async fn empty_store_is_usable_through_public_api() -> Result<(), Box<dyn std::error::Error>> {
    let store = MemoryEvidenceStore::default();
    assert!(store.list_evidence().await?.is_empty());
    Ok(())
}
