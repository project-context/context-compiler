use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::ReviewStatus;
use context_semantic::SemanticCatalogReader;
use context_semantic::SemanticEdge;
use context_semantic::SemanticError;
use context_semantic::SemanticFuture;
use context_semantic::SemanticQuery;
use context_semantic::SemanticReader;
use context_semantic::SemanticStore;

use crate::SqliteStore;

impl SemanticCatalogReader for SqliteStore {
    fn page_edges(
        &self,
        query: SemanticQuery,
    ) -> SemanticFuture<'_, context_protocol::Page<SemanticEdge>> {
        Box::pin(async move {
            if let Some(fact_ref) = query.fact_ref {
                let mut values: Vec<SemanticEdge> =
                    self.list_records("semantic_edge").await.map_err(error)?;
                values.retain(|value| value.from_fact == fact_ref || value.to_fact == fact_ref);
                return Ok(context_protocol::page_by_key(
                    values,
                    &query.page,
                    |value| value.id.clone(),
                ));
            }
            let mut equals = Vec::new();
            if let Some(value) = query.relation {
                equals.push(("relation".to_owned(), json_string(value).map_err(error)?));
            }
            if let Some(value) = query.review_status {
                equals.push((
                    "reviewStatus".to_owned(),
                    json_string(value).map_err(error)?,
                ));
            }
            if let Some(value) = query.freshness {
                equals.push(("freshness".to_owned(), json_string(value).map_err(error)?));
            }
            self.page_records("semantic_edge", &query.page, false, equals, None)
                .await
                .map_err(error)
        })
    }
}

fn json_string(value: impl serde::Serialize) -> Result<String, serde_json::Error> {
    Ok(serde_json::to_value(value)?
        .as_str()
        .unwrap_or_default()
        .to_owned())
}

fn error(value: impl std::fmt::Display) -> SemanticError {
    SemanticError::Store(value.to_string())
}

impl SemanticReader for SqliteStore {
    fn list_edges(&self) -> SemanticFuture<'_, Vec<SemanticEdge>> {
        Box::pin(async move { self.list_records("semantic_edge").await.map_err(error) })
    }

    fn adjacent(&self, fact_ref: &EntityRef) -> SemanticFuture<'_, Vec<SemanticEdge>> {
        let fact_ref = fact_ref.clone();
        Box::pin(async move {
            let values: Vec<SemanticEdge> =
                self.list_records("semantic_edge").await.map_err(error)?;
            Ok(values
                .into_iter()
                .filter(|edge| edge.from_fact == fact_ref || edge.to_fact == fact_ref)
                .collect())
        })
    }
}

impl SemanticStore for SqliteStore {
    fn put_edges(&self, edges: Vec<SemanticEdge>) -> SemanticFuture<'_, ()> {
        Box::pin(async move {
            for edge in edges {
                self.put_record("semantic_edge", &edge.id, "", &edge)
                    .await
                    .map_err(error)?;
            }
            Ok(())
        })
    }

    fn mark_edges_stale(&self, fact_ref: &EntityRef) -> SemanticFuture<'_, u64> {
        let fact_ref = fact_ref.clone();
        Box::pin(async move {
            let values: Vec<SemanticEdge> =
                self.list_records("semantic_edge").await.map_err(error)?;
            let mut changed = 0;
            for mut edge in values
                .into_iter()
                .filter(|edge| edge.from_fact == fact_ref || edge.to_fact == fact_ref)
            {
                if edge.freshness != Freshness::Stale {
                    edge.freshness = Freshness::Stale;
                    edge.review_status = ReviewStatus::Orphaned;
                    self.put_record("semantic_edge", &edge.id, "", &edge)
                        .await
                        .map_err(error)?;
                    changed += 1;
                }
            }
            Ok(changed)
        })
    }
}
