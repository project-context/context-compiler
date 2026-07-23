use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Page;
use context_protocol::PageRequest;
use context_protocol::ReviewStatus;
use context_protocol::page_by_key;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::SemanticEdge;
use crate::SemanticFuture;
use crate::SemanticReader;
use crate::SemanticRelation;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SemanticQuery {
    #[serde(default)]
    pub page: PageRequest,
    pub relation: Option<SemanticRelation>,
    pub review_status: Option<ReviewStatus>,
    pub freshness: Option<Freshness>,
    pub fact_ref: Option<EntityRef>,
}

pub trait SemanticCatalogReader: SemanticReader {
    fn page_edges(&self, query: SemanticQuery) -> SemanticFuture<'_, Page<SemanticEdge>> {
        Box::pin(async move {
            let mut values = self.list_edges().await?;
            if let Some(relation) = query.relation {
                values.retain(|value| value.relation == relation);
            }
            if let Some(status) = query.review_status {
                values.retain(|value| value.review_status == status);
            }
            if let Some(freshness) = query.freshness {
                values.retain(|value| value.freshness == freshness);
            }
            if let Some(fact_ref) = query.fact_ref {
                values.retain(|value| value.from_fact == fact_ref || value.to_fact == fact_ref);
            }
            Ok(page_by_key(values, &query.page, |value| value.id.clone()))
        })
    }
}
