use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::RwLock;

use context_protocol::EntityRef;
use context_protocol::RevisionRef;

use crate::StructureBuildRecord;
use crate::StructureCatalogReader;
use crate::StructureCommit;
use crate::StructureError;
use crate::StructureFuture;
use crate::StructureReader;
use crate::StructureRelationRecord;
use crate::StructureStore;
use crate::StructureUnit;

#[derive(Default)]
struct State {
    builds: BTreeMap<EntityRef, StructureBuildRecord>,
    units: BTreeMap<RevisionRef, StructureUnit>,
    relations: BTreeMap<RevisionRef, StructureRelationRecord>,
    rebuild_required: bool,
}

#[derive(Clone, Default)]
pub struct MemoryStructureStore {
    state: Arc<RwLock<State>>,
}

impl StructureCatalogReader for MemoryStructureStore {}

impl StructureReader for MemoryStructureStore {
    fn get_structure(
        &self,
        revision_ref: &RevisionRef,
    ) -> StructureFuture<'_, Option<StructureUnit>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state.units.get(&revision_ref).cloned())
        })
    }

    fn find_structure(
        &self,
        kind: Option<&str>,
        local_id: &str,
    ) -> StructureFuture<'_, Option<StructureUnit>> {
        let kind = kind.map(str::to_owned);
        let local_id = local_id.to_owned();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state
                .units
                .values()
                .filter(|unit| kind.as_deref().is_none_or(|kind| unit.kind == kind))
                .find(|unit| {
                    unit.stable_key == local_id
                        || unit.revision_ref.entity.id == local_id
                        || unit.revision_ref.revision == local_id
                })
                .cloned())
        })
    }

    fn list_structures(&self) -> StructureFuture<'_, Vec<StructureUnit>> {
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state.units.values().cloned().collect())
        })
    }

    fn list_structures_for_source(
        &self,
        source: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureUnit>> {
        let source = source.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state
                .units
                .values()
                .filter(|unit| unit.trace.source_snapshot == source)
                .cloned()
                .collect())
        })
    }

    fn get_structure_build(
        &self,
        entity_ref: &EntityRef,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>> {
        let entity_ref = entity_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state.builds.get(&entity_ref).cloned())
        })
    }

    fn get_structure_build_for_normalized(
        &self,
        normalized: &RevisionRef,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>> {
        let normalized = normalized.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state
                .builds
                .values()
                .find(|build| build.normalized_source == normalized)
                .cloned())
        })
    }

    fn get_structure_build_by_ref(
        &self,
        reference: &str,
    ) -> StructureFuture<'_, Option<StructureBuildRecord>> {
        let reference = reference.to_owned();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state
                .builds
                .values()
                .find(|build| {
                    build.entity_ref.id == reference || build.revision_ref.revision == reference
                })
                .cloned())
        })
    }

    fn list_structure_units_for_build(
        &self,
        build: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureUnit>> {
        let build = build.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state
                .units
                .values()
                .filter(|unit| unit.build_ref == build)
                .cloned()
                .collect())
        })
    }

    fn list_structure_relations_for_build(
        &self,
        build: &RevisionRef,
    ) -> StructureFuture<'_, Vec<StructureRelationRecord>> {
        let build = build.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            Ok(state
                .relations
                .values()
                .filter(|relation| relation.build_ref == build)
                .cloned()
                .collect())
        })
    }
}

impl StructureStore for MemoryStructureStore {
    fn put_structure_build(&self, build: StructureBuildRecord) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            self.state
                .write()
                .map_err(|error| StructureError::Store(error.to_string()))?
                .builds
                .insert(build.entity_ref.clone(), build);
            Ok(())
        })
    }

    fn put_structures(&self, structures: Vec<StructureUnit>) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self
                .state
                .write()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            for structure in structures {
                state
                    .units
                    .insert(structure.revision_ref.clone(), structure);
            }
            Ok(())
        })
    }

    fn put_structure_relations(
        &self,
        relations: Vec<StructureRelationRecord>,
    ) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self
                .state
                .write()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            for relation in relations {
                state
                    .relations
                    .insert(relation.revision_ref.clone(), relation);
            }
            Ok(())
        })
    }

    fn commit_structure(&self, commit: StructureCommit) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self
                .state
                .write()
                .map_err(|error| StructureError::Store(error.to_string()))?;
            for stale in &commit.stale {
                if let Some(unit) = state.units.get_mut(stale) {
                    unit.freshness = context_protocol::Freshness::Stale;
                }
                if let Some(relation) = state.relations.get_mut(stale) {
                    relation.freshness = context_protocol::Freshness::Stale;
                }
            }
            state
                .builds
                .insert(commit.build.entity_ref.clone(), commit.build);
            for unit in commit.units {
                state.units.insert(unit.revision_ref.clone(), unit);
            }
            for relation in commit.relations {
                state
                    .relations
                    .insert(relation.revision_ref.clone(), relation);
            }
            Ok(())
        })
    }

    fn structure_rebuild_required(&self) -> StructureFuture<'_, bool> {
        Box::pin(async move {
            self.state
                .read()
                .map(|state| state.rebuild_required)
                .map_err(|error| StructureError::Store(error.to_string()))
        })
    }

    fn mark_structure_rebuild_complete(&self) -> StructureFuture<'_, ()> {
        Box::pin(async move {
            self.state
                .write()
                .map_err(|error| StructureError::Store(error.to_string()))?
                .rebuild_required = false;
            Ok(())
        })
    }
}
