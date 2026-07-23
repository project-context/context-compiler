use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::RwLock;

use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::ReviewStatus;

use crate::SemanticCatalogReader;
use crate::SemanticEdge;
use crate::SemanticError;
use crate::SemanticFuture;
use crate::SemanticReader;
use crate::SemanticStore;

#[derive(Clone, Default)]
pub struct MemorySemanticStore {
    edges: Arc<RwLock<BTreeMap<String, SemanticEdge>>>,
}

impl SemanticCatalogReader for MemorySemanticStore {}

impl SemanticReader for MemorySemanticStore {
    fn list_edges(&self) -> SemanticFuture<'_, Vec<SemanticEdge>> {
        Box::pin(async move {
            Ok(self
                .edges
                .read()
                .map_err(|error| SemanticError::Store(error.to_string()))?
                .values()
                .cloned()
                .collect())
        })
    }

    fn adjacent(&self, fact_ref: &EntityRef) -> SemanticFuture<'_, Vec<SemanticEdge>> {
        let fact_ref = fact_ref.clone();
        Box::pin(async move {
            Ok(self
                .edges
                .read()
                .map_err(|error| SemanticError::Store(error.to_string()))?
                .values()
                .filter(|edge| edge.from_fact == fact_ref || edge.to_fact == fact_ref)
                .cloned()
                .collect())
        })
    }
}

impl SemanticStore for MemorySemanticStore {
    fn put_edges(&self, edges: Vec<SemanticEdge>) -> SemanticFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self
                .edges
                .write()
                .map_err(|error| SemanticError::Store(error.to_string()))?;
            for edge in edges {
                state.insert(edge.id.clone(), edge);
            }
            Ok(())
        })
    }

    fn mark_edges_stale(&self, fact_ref: &EntityRef) -> SemanticFuture<'_, u64> {
        let fact_ref = fact_ref.clone();
        Box::pin(async move {
            let mut state = self
                .edges
                .write()
                .map_err(|error| SemanticError::Store(error.to_string()))?;
            let mut changed = 0;
            for edge in state
                .values_mut()
                .filter(|edge| edge.from_fact == fact_ref || edge.to_fact == fact_ref)
            {
                if edge.freshness != Freshness::Stale {
                    edge.freshness = Freshness::Stale;
                    edge.review_status = ReviewStatus::Orphaned;
                    changed += 1;
                }
            }
            Ok(changed)
        })
    }
}
