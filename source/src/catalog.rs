use context_protocol::AccessStatus;
use context_protocol::Freshness;
use context_protocol::Page;
use context_protocol::PageRequest;
use context_protocol::RevisionMode;
use context_protocol::page_by_key;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::FormatId;
use crate::NormalizedSource;
use crate::SourceFuture;
use crate::SourceReader;
use crate::SourceRecord;
use crate::SourceSnapshot;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceQuery {
    #[serde(default)]
    pub page: PageRequest,
    pub text: Option<String>,
    pub format: Option<FormatId>,
    pub access_status: Option<AccessStatus>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotQuery {
    #[serde(default)]
    pub page: PageRequest,
    pub freshness: Option<Freshness>,
    #[serde(default)]
    pub revision_mode: RevisionMode,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSourceQuery {
    #[serde(default)]
    pub page: PageRequest,
    pub format: Option<FormatId>,
    pub freshness: Option<Freshness>,
    pub normalizer_id: Option<String>,
    #[serde(default)]
    pub revision_mode: RevisionMode,
}

pub trait SourceCatalogReader: SourceReader {
    fn page_sources(&self, query: SourceQuery) -> SourceFuture<'_, Page<SourceRecord>> {
        Box::pin(async move {
            let mut values = self.list_sources().await?;
            if let Some(text) = query.text {
                let text = text.to_lowercase();
                values.retain(|value| {
                    value.title.to_lowercase().contains(&text)
                        || value.uri.to_lowercase().contains(&text)
                });
            }
            if let Some(format) = query.format {
                values.retain(|value| value.format == format);
            }
            if let Some(status) = query.access_status {
                values.retain(|value| value.access_status == status);
            }
            Ok(page_by_key(values, &query.page, |value| {
                value.entity_ref.id.clone()
            }))
        })
    }

    fn page_snapshots(&self, query: SnapshotQuery) -> SourceFuture<'_, Page<SourceSnapshot>> {
        Box::pin(async move {
            let mut values = self.list_snapshots().await?;
            let freshness = query
                .freshness
                .or((query.revision_mode == RevisionMode::Current).then_some(Freshness::Current));
            if let Some(freshness) = freshness {
                values.retain(|value| value.freshness == freshness);
            }
            Ok(page_by_key(values, &query.page, |value| {
                format!(
                    "{}@{}",
                    value.revision_ref.entity.id, value.revision_ref.revision
                )
            }))
        })
    }

    fn page_normalized(
        &self,
        query: NormalizedSourceQuery,
    ) -> SourceFuture<'_, Page<NormalizedSource>> {
        Box::pin(async move {
            let mut values = self.list_normalized().await?;
            let freshness = query
                .freshness
                .or((query.revision_mode == RevisionMode::Current).then_some(Freshness::Current));
            if let Some(freshness) = freshness {
                values.retain(|value| value.freshness == freshness);
            }
            if let Some(format) = query.format {
                values.retain(|value| value.format == format);
            }
            if let Some(normalizer_id) = query.normalizer_id {
                values.retain(|value| value.normalizer_id == normalizer_id);
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
