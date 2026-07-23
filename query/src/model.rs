use context_fact::FactKind;
use context_protocol::Diagnostic;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Locator;
use context_protocol::RevisionRef;
use context_scope::ScopeRef;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContextFilters {
    #[serde(default)]
    pub scope_refs: Vec<ScopeRef>,
    #[serde(default)]
    pub fact_kinds: Vec<FactKind>,
    pub freshness: Option<Freshness>,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContextRequest {
    Manifest,
    Explore {
        terms: Vec<String>,
        #[serde(default)]
        filters: ContextFilters,
    },
    Expand {
        target: EntityRef,
        #[serde(default)]
        terms: Vec<String>,
        #[serde(default)]
        filters: ContextFilters,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContextResult {
    pub view_id: String,
    pub markdown: String,
    pub freshness: Freshness,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ViewBinding {
    pub fact_ref: RevisionRef,
    pub evidence_refs: Vec<RevisionRef>,
    pub source_snapshot: RevisionRef,
    pub locators: Vec<Locator>,
}
