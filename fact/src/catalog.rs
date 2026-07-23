use context_protocol::Freshness;
use context_protocol::Page;
use context_protocol::PageRequest;
use context_protocol::RevisionMode;
use context_protocol::RevisionRef;
use context_protocol::page_by_key;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::FactFuture;
use crate::FactKind;
use crate::FactReader;
use crate::FactRevision;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FactQuery {
    #[serde(default)]
    pub page: PageRequest,
    pub text: Option<String>,
    pub kind: Option<FactKind>,
    pub freshness: Option<Freshness>,
    pub evidence_ref: Option<RevisionRef>,
    #[serde(default)]
    pub revision_mode: RevisionMode,
}

pub trait FactCatalogReader: FactReader {
    fn page_facts(&self, query: FactQuery) -> FactFuture<'_, Page<FactRevision>> {
        Box::pin(async move {
            let mut values = self.list_facts().await?;
            let freshness = query
                .freshness
                .or((query.revision_mode == RevisionMode::Current).then_some(Freshness::Current));
            if let Some(freshness) = freshness {
                values.retain(|value| value.freshness == freshness);
            }
            if let Some(kind) = query.kind {
                values.retain(|value| value.kind == kind);
            }
            if let Some(evidence_ref) = query.evidence_ref {
                values.retain(|value| {
                    value
                        .evidence
                        .iter()
                        .any(|link| link.evidence_ref == evidence_ref)
                });
            }
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| value.statement.to_lowercase().contains(&text));
            }
            Ok(page_by_key(values, &query.page, |value| {
                format!(
                    "{}@{}",
                    value.revision_ref.entity.id, value.revision_ref.revision
                )
            }))
        })
    }
}
