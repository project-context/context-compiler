use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::RwLock;

use context_protocol::EntityRef;
use context_protocol::RevisionRef;

use crate::EvidenceBuildRecord;
use crate::EvidenceCatalogReader;
use crate::EvidenceError;
use crate::EvidenceFuture;
use crate::EvidenceReader;
use crate::EvidenceRecord;
use crate::EvidenceStore;

#[derive(Default)]
struct State {
    builds: BTreeMap<EntityRef, EvidenceBuildRecord>,
    evidence: BTreeMap<RevisionRef, EvidenceRecord>,
}

#[derive(Clone, Default)]
pub struct MemoryEvidenceStore {
    state: Arc<RwLock<State>>,
}

impl EvidenceCatalogReader for MemoryEvidenceStore {}

impl EvidenceReader for MemoryEvidenceStore {
    fn get_evidence(
        &self,
        revision_ref: &RevisionRef,
    ) -> EvidenceFuture<'_, Option<EvidenceRecord>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| EvidenceError::Store(error.to_string()))?;
            Ok(state.evidence.get(&revision_ref).cloned())
        })
    }

    fn list_evidence(&self) -> EvidenceFuture<'_, Vec<EvidenceRecord>> {
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| EvidenceError::Store(error.to_string()))?;
            Ok(state.evidence.values().cloned().collect())
        })
    }

    fn list_evidence_for_structure(
        &self,
        structure_ref: &RevisionRef,
    ) -> EvidenceFuture<'_, Vec<EvidenceRecord>> {
        let structure_ref = structure_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| EvidenceError::Store(error.to_string()))?;
            Ok(state
                .evidence
                .values()
                .filter(|evidence| evidence.structure_refs.contains(&structure_ref))
                .cloned()
                .collect())
        })
    }

    fn get_evidence_build(
        &self,
        entity_ref: &EntityRef,
    ) -> EvidenceFuture<'_, Option<EvidenceBuildRecord>> {
        let entity_ref = entity_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| EvidenceError::Store(error.to_string()))?;
            Ok(state.builds.get(&entity_ref).cloned())
        })
    }
}

impl EvidenceStore for MemoryEvidenceStore {
    fn put_evidence_build(&self, build: EvidenceBuildRecord) -> EvidenceFuture<'_, ()> {
        Box::pin(async move {
            self.state
                .write()
                .map_err(|error| EvidenceError::Store(error.to_string()))?
                .builds
                .insert(build.entity_ref.clone(), build);
            Ok(())
        })
    }

    fn put_evidence(&self, evidence: Vec<EvidenceRecord>) -> EvidenceFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self
                .state
                .write()
                .map_err(|error| EvidenceError::Store(error.to_string()))?;
            for item in evidence {
                state.evidence.insert(item.revision_ref.clone(), item);
            }
            Ok(())
        })
    }
}
