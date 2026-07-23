use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::RwLock;

use context_protocol::EntityRef;
use context_protocol::RevisionRef;

use crate::FactBuildRecord;
use crate::FactCatalogReader;
use crate::FactError;
use crate::FactFuture;
use crate::FactReader;
use crate::FactRevision;
use crate::FactStore;

#[derive(Default)]
struct State {
    builds: BTreeMap<EntityRef, FactBuildRecord>,
    facts: BTreeMap<RevisionRef, FactRevision>,
}

#[derive(Clone, Default)]
pub struct MemoryFactStore {
    state: Arc<RwLock<State>>,
}

impl FactCatalogReader for MemoryFactStore {}

impl FactReader for MemoryFactStore {
    fn get_fact(&self, revision_ref: &RevisionRef) -> FactFuture<'_, Option<FactRevision>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| FactError::Store(error.to_string()))?;
            Ok(state.facts.get(&revision_ref).cloned())
        })
    }

    fn list_facts(&self) -> FactFuture<'_, Vec<FactRevision>> {
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| FactError::Store(error.to_string()))?;
            Ok(state.facts.values().cloned().collect())
        })
    }

    fn list_facts_for_evidence(
        &self,
        evidence_ref: &RevisionRef,
    ) -> FactFuture<'_, Vec<FactRevision>> {
        let evidence_ref = evidence_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| FactError::Store(error.to_string()))?;
            Ok(state
                .facts
                .values()
                .filter(|fact| {
                    fact.evidence
                        .iter()
                        .any(|link| link.evidence_ref == evidence_ref)
                })
                .cloned()
                .collect())
        })
    }

    fn get_fact_build(&self, entity_ref: &EntityRef) -> FactFuture<'_, Option<FactBuildRecord>> {
        let entity_ref = entity_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| FactError::Store(error.to_string()))?;
            Ok(state.builds.get(&entity_ref).cloned())
        })
    }
}

impl FactStore for MemoryFactStore {
    fn put_fact_build(&self, build: FactBuildRecord) -> FactFuture<'_, ()> {
        Box::pin(async move {
            self.state
                .write()
                .map_err(|error| FactError::Store(error.to_string()))?
                .builds
                .insert(build.entity_ref.clone(), build);
            Ok(())
        })
    }

    fn put_facts(&self, facts: Vec<FactRevision>) -> FactFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self
                .state
                .write()
                .map_err(|error| FactError::Store(error.to_string()))?;
            for fact in facts {
                state.facts.insert(fact.revision_ref.clone(), fact);
            }
            Ok(())
        })
    }
}
