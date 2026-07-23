use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

/// Logical layer that owns an entity.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum Layer {
    Source,
    Structure,
    Evidence,
    Fact,
}

/// Stable logical identity that survives rebuilds when a processor can match the same object.
#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct EntityRef {
    pub layer: Layer,
    pub id: String,
}

impl EntityRef {
    pub fn new(layer: Layer, id: impl Into<String>) -> Self {
        Self {
            layer,
            id: id.into(),
        }
    }
}

/// Immutable revision of a stable logical entity.
#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRef {
    pub entity: EntityRef,
    pub revision: String,
}

impl RevisionRef {
    pub fn new(entity: EntityRef, revision: impl Into<String>) -> Self {
        Self {
            entity,
            revision: revision.into(),
        }
    }
}

/// Any stable entity from Source, Structure, Evidence, or Fact.
pub type AnyLayerRef = EntityRef;

/// Opaque, content-addressed artifact locator.
#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRef {
    pub uri: String,
}

impl ArtifactRef {
    pub fn new(uri: impl Into<String>) -> Self {
        Self { uri: uri.into() }
    }
}

#[cfg(test)]
#[path = "ids_tests.rs"]
mod tests;
