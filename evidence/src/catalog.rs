use context_protocol::Freshness;
use context_protocol::Page;
use context_protocol::PageRequest;
use context_protocol::RevisionMode;
use context_protocol::RevisionRef;
use context_protocol::page_by_key;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::EvidenceFuture;
use crate::EvidenceKind;
use crate::EvidenceReader;
use crate::EvidenceRecord;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceQuery {
    #[serde(default)]
    pub page: PageRequest,
    pub text: Option<String>,
    pub kind: Option<EvidenceKind>,
    pub freshness: Option<Freshness>,
    pub structure_ref: Option<RevisionRef>,
    #[serde(default)]
    pub revision_mode: RevisionMode,
}

pub trait EvidenceCatalogReader: EvidenceReader {
    fn page_evidence(&self, query: EvidenceQuery) -> EvidenceFuture<'_, Page<EvidenceRecord>> {
        Box::pin(async move {
            let mut values = self.list_evidence().await?;
            let freshness = query
                .freshness
                .or((query.revision_mode == RevisionMode::Current).then_some(Freshness::Current));
            if let Some(freshness) = freshness {
                values.retain(|value| value.freshness == freshness);
            }
            if let Some(kind) = query.kind {
                values.retain(|value| value.kind == kind);
            }
            if let Some(structure_ref) = query.structure_ref {
                values.retain(|value| value.structure_refs.contains(&structure_ref));
            }
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| value.excerpt.to_lowercase().contains(&text));
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
