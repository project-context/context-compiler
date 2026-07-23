use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::RwLock;

use context_protocol::EntityRef;
use context_protocol::RevisionRef;

use crate::NormalizedSource;
use crate::SourceCatalogReader;
use crate::SourceError;
use crate::SourceFuture;
use crate::SourceReader;
use crate::SourceRecord;
use crate::SourceSnapshot;
use crate::SourceStore;

#[derive(Default)]
struct MemorySourceState {
    sources: BTreeMap<EntityRef, SourceRecord>,
    snapshots: BTreeMap<RevisionRef, SourceSnapshot>,
    normalized: BTreeMap<RevisionRef, NormalizedSource>,
}

#[derive(Clone, Default)]
pub struct MemorySourceStore {
    state: Arc<RwLock<MemorySourceState>>,
}

impl SourceCatalogReader for MemorySourceStore {}

impl SourceReader for MemorySourceStore {
    fn get_source(&self, entity_ref: &EntityRef) -> SourceFuture<'_, Option<SourceRecord>> {
        let entity_ref = entity_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| SourceError::Store(error.to_string()))?;
            Ok(state.sources.get(&entity_ref).cloned())
        })
    }

    fn get_snapshot(&self, revision_ref: &RevisionRef) -> SourceFuture<'_, Option<SourceSnapshot>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| SourceError::Store(error.to_string()))?;
            Ok(state.snapshots.get(&revision_ref).cloned())
        })
    }

    fn get_normalized(
        &self,
        revision_ref: &RevisionRef,
    ) -> SourceFuture<'_, Option<NormalizedSource>> {
        let revision_ref = revision_ref.clone();
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| SourceError::Store(error.to_string()))?;
            Ok(state.normalized.get(&revision_ref).cloned())
        })
    }

    fn list_sources(&self) -> SourceFuture<'_, Vec<SourceRecord>> {
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| SourceError::Store(error.to_string()))?;
            Ok(state.sources.values().cloned().collect())
        })
    }

    fn list_snapshots(&self) -> SourceFuture<'_, Vec<SourceSnapshot>> {
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| SourceError::Store(error.to_string()))?;
            Ok(state.snapshots.values().cloned().collect())
        })
    }

    fn list_normalized(&self) -> SourceFuture<'_, Vec<NormalizedSource>> {
        Box::pin(async move {
            let state = self
                .state
                .read()
                .map_err(|error| SourceError::Store(error.to_string()))?;
            Ok(state.normalized.values().cloned().collect())
        })
    }
}

impl SourceStore for MemorySourceStore {
    fn put_source(&self, source: SourceRecord) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            self.state
                .write()
                .map_err(|error| SourceError::Store(error.to_string()))?
                .sources
                .insert(source.entity_ref.clone(), source);
            Ok(())
        })
    }

    fn put_snapshot(&self, snapshot: SourceSnapshot) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            self.state
                .write()
                .map_err(|error| SourceError::Store(error.to_string()))?
                .snapshots
                .insert(snapshot.revision_ref.clone(), snapshot);
            Ok(())
        })
    }

    fn put_normalized(&self, normalized: NormalizedSource) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            self.state
                .write()
                .map_err(|error| SourceError::Store(error.to_string()))?
                .normalized
                .insert(normalized.revision_ref.clone(), normalized);
            Ok(())
        })
    }

    fn commit_normalization(
        &self,
        source: SourceRecord,
        snapshot: SourceSnapshot,
        normalized: NormalizedSource,
    ) -> SourceFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self
                .state
                .write()
                .map_err(|error| SourceError::Store(error.to_string()))?;
            state.sources.insert(source.entity_ref.clone(), source);
            state
                .snapshots
                .insert(snapshot.revision_ref.clone(), snapshot);
            state
                .normalized
                .insert(normalized.revision_ref.clone(), normalized);
            Ok(())
        })
    }

    fn normalizer_rebuild_required(&self) -> SourceFuture<'_, bool> {
        Box::pin(async { Ok(false) })
    }

    fn mark_normalizer_rebuild_complete(&self) -> SourceFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
