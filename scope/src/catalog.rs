use context_protocol::Page;
use context_protocol::PageRequest;
use context_protocol::ReviewStatus;
use context_protocol::page_by_key;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::Scope;
use crate::ScopeAssignment;
use crate::ScopeBlock;
use crate::ScopeDecision;
use crate::ScopeDimension;
use crate::ScopeFuture;
use crate::ScopeReader;
use crate::ScopeRelation;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeQuery {
    #[serde(default)]
    pub page: PageRequest,
    pub text: Option<String>,
    pub review_status: Option<ReviewStatus>,
}

pub trait ScopeCatalogReader: ScopeReader {
    fn page_dimensions(&self, query: ScopeQuery) -> ScopeFuture<'_, Page<ScopeDimension>> {
        Box::pin(async move {
            let mut values = self.list_dimensions().await?;
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| value.name.to_lowercase().contains(&text));
            }
            Ok(page_by_key(values, &query.page, |value| value.name.clone()))
        })
    }

    fn page_scopes(&self, query: ScopeQuery) -> ScopeFuture<'_, Page<Scope>> {
        Box::pin(async move {
            let mut values = self.list_scopes().await?;
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| {
                    value.label.to_lowercase().contains(&text)
                        || value.value.to_lowercase().contains(&text)
                        || value.dimension.to_lowercase().contains(&text)
                });
            }
            Ok(page_by_key(values, &query.page, |value| {
                value.scope_ref.id.clone()
            }))
        })
    }

    fn page_assignments(&self, query: ScopeQuery) -> ScopeFuture<'_, Page<ScopeAssignment>> {
        Box::pin(async move {
            let mut values = self.list_assignments().await?;
            if let Some(status) = query.review_status {
                values.retain(|value| value.review_status == status);
            }
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| {
                    value.id.to_lowercase().contains(&text)
                        || value.scope_ref.id.to_lowercase().contains(&text)
                });
            }
            Ok(page_by_key(values, &query.page, |value| value.id.clone()))
        })
    }

    fn page_blocks(&self, query: ScopeQuery) -> ScopeFuture<'_, Page<ScopeBlock>> {
        Box::pin(async move {
            let mut values = self.list_blocks().await?;
            if let Some(status) = query.review_status {
                values.retain(|value| value.review_status == status);
            }
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| {
                    value.id.to_lowercase().contains(&text)
                        || value.reason.to_lowercase().contains(&text)
                });
            }
            Ok(page_by_key(values, &query.page, |value| value.id.clone()))
        })
    }

    fn page_relations(&self, query: ScopeQuery) -> ScopeFuture<'_, Page<ScopeRelation>> {
        Box::pin(async move {
            let mut values = self.list_relations().await?;
            if let Some(status) = query.review_status {
                values.retain(|value| value.review_status == status);
            }
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| {
                    value.id.to_lowercase().contains(&text)
                        || value.from.id.to_lowercase().contains(&text)
                        || value.to.id.to_lowercase().contains(&text)
                });
            }
            Ok(page_by_key(values, &query.page, |value| value.id.clone()))
        })
    }

    fn page_decisions(&self, query: ScopeQuery) -> ScopeFuture<'_, Page<ScopeDecision>> {
        Box::pin(async move {
            let mut values = self.list_decisions().await?;
            if let Some(status) = query.review_status {
                values.retain(|value| value.status == status);
            }
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| {
                    value.id.to_lowercase().contains(&text)
                        || value.subject.to_lowercase().contains(&text)
                        || value.rationale.to_lowercase().contains(&text)
                });
            }
            Ok(page_by_key(values, &query.page, |value| value.id.clone()))
        })
    }
}
