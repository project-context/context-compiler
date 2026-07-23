use context_evidence::MemoryEvidenceStore;
use context_fact::MemoryFactStore;
use context_scope::MemoryScopeStore;
use context_semantic::MemorySemanticStore;
use context_source::MemorySourceStore;
use context_structure::MemoryStructureStore;

/// Independent in-memory implementations for unit and Store contract tests.
#[derive(Clone, Default)]
pub struct MemoryStores {
    pub source: MemorySourceStore,
    pub structure: MemoryStructureStore,
    pub evidence: MemoryEvidenceStore,
    pub fact: MemoryFactStore,
    pub scope: MemoryScopeStore,
    pub semantic: MemorySemanticStore,
}
