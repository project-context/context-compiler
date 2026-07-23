use std::sync::Arc;
use std::sync::RwLock;

use crate::Scope;
use crate::ScopeAssignment;
use crate::ScopeBlock;
use crate::ScopeCatalogReader;
use crate::ScopeDecision;
use crate::ScopeDimension;
use crate::ScopeError;
use crate::ScopeFuture;
use crate::ScopeReader;
use crate::ScopeRelation;
use crate::ScopeStore;

#[derive(Default)]
struct State {
    dimensions: Vec<ScopeDimension>,
    scopes: Vec<Scope>,
    assignments: Vec<ScopeAssignment>,
    blocks: Vec<ScopeBlock>,
    relations: Vec<ScopeRelation>,
    decisions: Vec<ScopeDecision>,
}

#[derive(Clone, Default)]
pub struct MemoryScopeStore {
    state: Arc<RwLock<State>>,
}

impl ScopeCatalogReader for MemoryScopeStore {}

macro_rules! list_values {
    ($name:ident, $field:ident, $item:ty) => {
        fn $name(&self) -> ScopeFuture<'_, Vec<$item>> {
            Box::pin(async move {
                Ok(self
                    .state
                    .read()
                    .map_err(|error| ScopeError::Store(error.to_string()))?
                    .$field
                    .clone())
            })
        }
    };
}

impl ScopeReader for MemoryScopeStore {
    list_values!(list_dimensions, dimensions, ScopeDimension);
    list_values!(list_scopes, scopes, Scope);
    list_values!(list_assignments, assignments, ScopeAssignment);
    list_values!(list_blocks, blocks, ScopeBlock);
    list_values!(list_relations, relations, ScopeRelation);
    list_values!(list_decisions, decisions, ScopeDecision);
}

impl ScopeStore for MemoryScopeStore {
    fn put_dimensions(&self, values: Vec<ScopeDimension>) -> ScopeFuture<'_, ()> {
        Box::pin(
            async move { self.upsert(values, |value| value.name.clone(), |s| &mut s.dimensions) },
        )
    }

    fn put_scopes(&self, values: Vec<Scope>) -> ScopeFuture<'_, ()> {
        Box::pin(async move {
            self.upsert(
                values,
                |value| value.scope_ref.id.clone(),
                |s| &mut s.scopes,
            )
        })
    }

    fn put_assignments(&self, values: Vec<ScopeAssignment>) -> ScopeFuture<'_, ()> {
        Box::pin(
            async move { self.upsert(values, |value| value.id.clone(), |s| &mut s.assignments) },
        )
    }

    fn put_blocks(&self, values: Vec<ScopeBlock>) -> ScopeFuture<'_, ()> {
        Box::pin(async move { self.upsert(values, |value| value.id.clone(), |s| &mut s.blocks) })
    }

    fn put_relations(&self, values: Vec<ScopeRelation>) -> ScopeFuture<'_, ()> {
        Box::pin(async move { self.upsert(values, |value| value.id.clone(), |s| &mut s.relations) })
    }

    fn put_decisions(&self, values: Vec<ScopeDecision>) -> ScopeFuture<'_, ()> {
        Box::pin(async move { self.upsert(values, |value| value.id.clone(), |s| &mut s.decisions) })
    }
}

impl MemoryScopeStore {
    fn upsert<T, K, S>(&self, values: Vec<T>, key: K, select: S) -> Result<(), ScopeError>
    where
        K: Fn(&T) -> String,
        S: Fn(&mut State) -> &mut Vec<T>,
    {
        let mut state = self
            .state
            .write()
            .map_err(|error| ScopeError::Store(error.to_string()))?;
        let target = select(&mut state);
        for value in values {
            let id = key(&value);
            if let Some(existing) = target.iter_mut().find(|current| key(current) == id) {
                *existing = value;
            } else {
                target.push(value);
            }
        }
        Ok(())
    }
}
