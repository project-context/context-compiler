use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StoreMode {
    External,
    Portable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    pub workspace_id: String,
    pub schema_version: u32,
    pub store_mode: StoreMode,
}
