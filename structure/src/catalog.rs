use context_protocol::Freshness;
use context_protocol::Page;
use context_protocol::PageRequest;
use context_protocol::RevisionMode;
use context_protocol::RevisionRef;
use context_protocol::page_by_key;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::StructureFuture;
use crate::StructureKind;
use crate::StructureReader;
use crate::StructureUnit;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureQuery {
    #[serde(default)]
    pub page: PageRequest,
    pub text: Option<String>,
    pub kind: Option<StructureKind>,
    pub freshness: Option<Freshness>,
    pub source_snapshot: Option<RevisionRef>,
    #[serde(default)]
    pub revision_mode: RevisionMode,
}

pub trait StructureCatalogReader: StructureReader {
    fn page_structures(&self, query: StructureQuery) -> StructureFuture<'_, Page<StructureUnit>> {
        Box::pin(async move {
            let mut values = self.list_structures().await?;
            let freshness = query
                .freshness
                .or((query.revision_mode == RevisionMode::Current).then_some(Freshness::Current));
            if let Some(freshness) = freshness {
                values.retain(|value| value.freshness == freshness);
            }
            if let Some(kind) = query.kind {
                values.retain(|value| value.kind == kind);
            }
            if let Some(source) = query.source_snapshot {
                values.retain(|value| value.trace.source_snapshot == source);
            }
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| {
                    value.label.to_lowercase().contains(&text)
                        || value.text.to_lowercase().contains(&text)
                });
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
