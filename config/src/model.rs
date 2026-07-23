use agent_source_connector::ConnectorInstanceConfig;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContextConfig {
    pub schema_version: u32,
    #[serde(default)]
    pub sources: Vec<SourceDefinition>,
    #[serde(default)]
    pub source_trash: Vec<TrashedSourceDefinition>,
    #[serde(default)]
    pub normalization: NormalizationPolicy,
    #[serde(default)]
    pub structure: StructurePolicy,
}

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            schema_version: 2,
            sources: Vec::new(),
            source_trash: Vec::new(),
            normalization: NormalizationPolicy::default(),
            structure: StructurePolicy::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructurePolicy {
    #[serde(default = "default_structure_routes")]
    pub routes: Vec<StructureRoute>,
}

impl Default for StructurePolicy {
    fn default() -> Self {
        Self {
            routes: default_structure_routes(),
        }
    }
}

impl StructurePolicy {
    pub fn route(&self, extension: &str) -> Option<&StructureRoute> {
        let extension = extension.trim_start_matches('.');
        self.routes
            .iter()
            .find(|route| route.extension.trim_start_matches('.') == extension)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StructureRoute {
    pub extension: String,
    pub parser_id: String,
    #[serde(default = "empty_object")]
    pub config: serde_json::Value,
}

fn default_structure_routes() -> Vec<StructureRoute> {
    vec![
        StructureRoute {
            extension: "md".to_owned(),
            parser_id: "markdown-ast".to_owned(),
            config: empty_object(),
        },
        StructureRoute {
            extension: "ts".to_owned(),
            parser_id: "tree-sitter-typescript".to_owned(),
            config: empty_object(),
        },
        StructureRoute {
            extension: "tsx".to_owned(),
            parser_id: "tree-sitter-typescript".to_owned(),
            config: empty_object(),
        },
    ]
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceDefinition {
    #[serde(flatten)]
    pub connector: ConnectorInstanceConfig,
}

/// A restorable source configuration removed from the active pipeline.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrashedSourceDefinition {
    /// Stable identity for this trash entry. Multiple historical versions of
    /// the same source can coexist in the recycle bin.
    pub trash_id: String,
    pub deleted_at_ms: u64,
    pub source: SourceDefinition,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationPolicy {
    #[serde(default)]
    pub defaults: Vec<NormalizationRule>,
    #[serde(default)]
    pub source_overrides: Vec<SourceNormalizationOverride>,
    #[serde(default)]
    pub path_overrides: Vec<PathNormalizationOverride>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationRule {
    pub id: String,
    pub normalizer_id: String,
    #[serde(default = "enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub media_types: Vec<String>,
    #[serde(default)]
    pub priority: i32,
    #[serde(default = "empty_object")]
    pub config: serde_json::Value,
}

fn empty_object() -> serde_json::Value {
    serde_json::json!({})
}

fn enabled() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceNormalizationOverride {
    pub source_id: String,
    #[serde(default)]
    pub rules: Vec<NormalizationRule>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PathNormalizationOverride {
    pub id: String,
    pub source_id: Option<String>,
    pub globs: Vec<String>,
    pub rule: NormalizationRule,
}
