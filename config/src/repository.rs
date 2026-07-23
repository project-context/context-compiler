use std::collections::BTreeSet;

use agent_file_normalizer::NormalizerDescriptor;
use agent_source_connector::ConnectorInstanceConfig;
use context_structure::StructureParserRegistry;
use serde_json::json;
use sha2::Digest;
use sha2::Sha256;
use thiserror::Error;

use crate::ContextConfig;
use crate::NormalizationPolicy;
use crate::NormalizationRule;
use crate::SourceDefinition;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("configuration I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("configuration JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("configuration validation failed: {0}")]
    Validation(String),
    #[error("configuration conflict: {0}")]
    Conflict(String),
    #[error("configuration precondition failed; expected {expected}, current {current}")]
    Precondition { expected: String, current: String },
}

pub type ConfigResult<T> = Result<T, ConfigError>;

#[derive(Clone, Debug, PartialEq)]
pub struct LoadedConfig {
    pub config: ContextConfig,
    pub etag: String,
    pub persisted: bool,
    pub imported_legacy: bool,
}

#[derive(Clone, Debug)]
pub struct ConfigRepository {
    root: std::path::PathBuf,
}

impl ConfigRepository {
    pub fn new(root: impl Into<std::path::PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn path(&self) -> std::path::PathBuf {
        self.root.join("context.config.json")
    }

    pub fn load(&self, descriptors: &[NormalizerDescriptor]) -> ConfigResult<LoadedConfig> {
        let path = self.path();
        if path.exists() {
            let bytes = std::fs::read(path)?;
            let mut value: serde_json::Value = serde_json::from_slice(&bytes)?;
            let upgraded = value
                .get("schemaVersion")
                .and_then(serde_json::Value::as_u64)
                == Some(1);
            if upgraded {
                value["schemaVersion"] = serde_json::Value::from(2_u64);
            }
            let config: ContextConfig = serde_json::from_value(value)?;
            validate(&config)?;
            let effective_bytes = if upgraded {
                serde_json::to_vec_pretty(&config)?
            } else {
                bytes
            };
            return Ok(LoadedConfig {
                config,
                etag: etag(&effective_bytes),
                persisted: !upgraded,
                imported_legacy: false,
            });
        }
        let legacy = self.root.join("context.normalizers.json");
        let (config, imported_legacy) = if legacy.exists() {
            let value: LegacyNormalizationConfig = serde_json::from_slice(&std::fs::read(legacy)?)?;
            (legacy_config(value, descriptors), true)
        } else {
            (default_config(descriptors), false)
        };
        let bytes = serde_json::to_vec_pretty(&config)?;
        Ok(LoadedConfig {
            config,
            etag: etag(&bytes),
            persisted: false,
            imported_legacy,
        })
    }

    pub fn save(
        &self,
        config: &ContextConfig,
        expected_etag: Option<&str>,
        descriptors: &[NormalizerDescriptor],
    ) -> ConfigResult<String> {
        validate(config)?;
        validate_normalizers(config, descriptors)?;
        let path = self.path();
        if let Some(expected) = expected_etag {
            let current = self.load(descriptors)?.etag;
            if current != expected {
                return Err(ConfigError::Precondition {
                    expected: expected.to_owned(),
                    current,
                });
            }
        }
        let bytes = serde_json::to_vec_pretty(config)?;
        let temporary = self.root.join(".context.config.json.tmp");
        std::fs::write(&temporary, &bytes)?;
        std::fs::rename(temporary, path)?;
        Ok(etag(&bytes))
    }

    pub fn save_with_structure(
        &self,
        config: &ContextConfig,
        expected_etag: Option<&str>,
        descriptors: &[NormalizerDescriptor],
        parsers: &StructureParserRegistry,
    ) -> ConfigResult<String> {
        validate_structure(config, parsers)?;
        self.save(config, expected_etag, descriptors)
    }
}

fn default_config(descriptors: &[NormalizerDescriptor]) -> ContextConfig {
    let mut defaults_by_input = std::collections::BTreeMap::new();
    for descriptor in descriptors {
        let Some(input) = descriptor.inputs.first() else {
            continue;
        };
        let key = input.format.as_str().to_owned();
        let replace = defaults_by_input
            .get(&key)
            .is_none_or(|current: &&NormalizerDescriptor| {
                descriptor.default_priority > current.default_priority
            });
        if replace {
            defaults_by_input.insert(key, descriptor);
        }
    }
    ContextConfig {
        schema_version: 2,
        sources: vec![default_local_source()],
        source_trash: Vec::new(),
        normalization: NormalizationPolicy {
            defaults: defaults_by_input
                .into_values()
                .filter_map(|descriptor| descriptor.inputs.first().map(|input| (descriptor, input)))
                .map(|(descriptor, input)| NormalizationRule {
                    id: format!("default-{}", descriptor.id),
                    normalizer_id: descriptor.id.clone(),
                    enabled: true,
                    extensions: input.extensions.clone(),
                    media_types: input.media_types.clone(),
                    priority: descriptor.default_priority,
                    config: serde_json::json!({}),
                })
                .collect(),
            source_overrides: Vec::new(),
            path_overrides: Vec::new(),
        },
        structure: crate::StructurePolicy::default(),
    }
}

fn legacy_config(
    legacy: LegacyNormalizationConfig,
    descriptors: &[NormalizerDescriptor],
) -> ContextConfig {
    let descriptor_by_id = descriptors
        .iter()
        .map(|descriptor| (descriptor.id.as_str(), descriptor))
        .collect::<std::collections::BTreeMap<_, _>>();
    let defaults = legacy
        .rules
        .into_iter()
        .map(|rule| NormalizationRule {
            id: format!("legacy-{}", rule.normalizer_id),
            priority: rule.priority.unwrap_or_else(|| {
                descriptor_by_id
                    .get(rule.normalizer_id.as_str())
                    .map_or(0, |descriptor| descriptor.default_priority)
            }),
            normalizer_id: rule.normalizer_id,
            enabled: rule.enabled,
            extensions: rule.extensions,
            media_types: Vec::new(),
            config: serde_json::json!({}),
        })
        .collect();
    ContextConfig {
        schema_version: 2,
        sources: vec![default_local_source()],
        source_trash: Vec::new(),
        normalization: NormalizationPolicy {
            defaults,
            source_overrides: Vec::new(),
            path_overrides: Vec::new(),
        },
        structure: crate::StructurePolicy::default(),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyNormalizationConfig {
    #[serde(default)]
    rules: Vec<LegacyNormalizationRule>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyNormalizationRule {
    normalizer_id: String,
    #[serde(default = "legacy_enabled")]
    enabled: bool,
    #[serde(default)]
    extensions: Vec<String>,
    priority: Option<i32>,
}

fn legacy_enabled() -> bool {
    true
}

fn default_local_source() -> SourceDefinition {
    SourceDefinition {
        connector: ConnectorInstanceConfig {
            id: "workspace".to_owned(),
            connector_id: "local".to_owned(),
            display_name: "Workspace files".to_owned(),
            enabled: true,
            config: json!({ "root": "." }),
            secret_refs: Vec::new(),
        },
    }
}

fn validate(config: &ContextConfig) -> ConfigResult<()> {
    if config.schema_version != 2 {
        return Err(ConfigError::Validation(format!(
            "unsupported schemaVersion: {}",
            config.schema_version
        )));
    }
    let mut source_ids = BTreeSet::new();
    for source in &config.sources {
        if source.connector.id.trim().is_empty() || !source_ids.insert(source.connector.id.as_str())
        {
            return Err(ConfigError::Validation(format!(
                "source ID is empty or duplicated: {}",
                source.connector.id
            )));
        }
    }
    let mut trash_ids = BTreeSet::new();
    for entry in &config.source_trash {
        if entry.trash_id.trim().is_empty() || !trash_ids.insert(entry.trash_id.as_str()) {
            return Err(ConfigError::Validation(format!(
                "source trash ID is empty or duplicated: {}",
                entry.trash_id
            )));
        }
        if entry.source.connector.id.trim().is_empty() {
            return Err(ConfigError::Validation(
                "trashed source ID cannot be empty".to_owned(),
            ));
        }
    }
    let mut rule_ids = BTreeSet::new();
    for rule in config
        .normalization
        .defaults
        .iter()
        .chain(
            config
                .normalization
                .source_overrides
                .iter()
                .flat_map(|value| value.rules.iter()),
        )
        .chain(
            config
                .normalization
                .path_overrides
                .iter()
                .map(|value| &value.rule),
        )
    {
        if rule.id.trim().is_empty() || !rule_ids.insert(rule.id.as_str()) {
            return Err(ConfigError::Validation(format!(
                "normalization rule ID is empty or duplicated: {}",
                rule.id
            )));
        }
    }
    let mut extensions = BTreeSet::new();
    for route in &config.structure.routes {
        let extension = route.extension.trim_start_matches('.').to_ascii_lowercase();
        if extension.is_empty() || !extensions.insert(extension.clone()) {
            return Err(ConfigError::Validation(format!(
                "structure extension is empty or duplicated: {}",
                route.extension
            )));
        }
        if route.parser_id.trim().is_empty() {
            return Err(ConfigError::Validation(format!(
                "structure parser ID is empty for extension {extension}"
            )));
        }
    }
    Ok(())
}

fn validate_structure(
    config: &ContextConfig,
    parsers: &StructureParserRegistry,
) -> ConfigResult<()> {
    for route in &config.structure.routes {
        let factory = parsers.factory(&route.parser_id).ok_or_else(|| {
            ConfigError::Validation(format!(
                "structure parser is not installed: {}",
                route.parser_id
            ))
        })?;
        if !factory.descriptor().supports_extension(&route.extension) {
            return Err(ConfigError::Validation(format!(
                "structure parser {} does not support .{}",
                route.parser_id,
                route.extension.trim_start_matches('.')
            )));
        }
        factory
            .validate_config(&route.config)
            .map_err(|error| ConfigError::Validation(error.to_string()))?;
    }
    Ok(())
}

fn validate_normalizers(
    config: &ContextConfig,
    descriptors: &[NormalizerDescriptor],
) -> ConfigResult<()> {
    let installed = descriptors
        .iter()
        .map(|descriptor| descriptor.id.as_str())
        .collect::<BTreeSet<_>>();
    for rule in config
        .normalization
        .defaults
        .iter()
        .chain(
            config
                .normalization
                .source_overrides
                .iter()
                .flat_map(|value| value.rules.iter()),
        )
        .chain(
            config
                .normalization
                .path_overrides
                .iter()
                .map(|value| &value.rule),
        )
    {
        if !installed.contains(rule.normalizer_id.as_str()) {
            return Err(ConfigError::Validation(format!(
                "normalizer is not installed: {}",
                rule.normalizer_id
            )));
        }
    }
    Ok(())
}

fn etag(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use agent_file_normalizer::AgentFileProfile;
    use agent_file_normalizer::FormatId;
    use agent_file_normalizer::InputMatcher;
    use agent_file_normalizer::NormalizedFormat;
    use agent_file_normalizer::NormalizerCapabilities;
    use agent_file_normalizer::NormalizerDescriptor;
    use agent_file_normalizer::RetrievalProfile;
    use agent_file_normalizer::ToolSupport;
    use tempfile::tempdir;

    use super::ConfigRepository;

    fn descriptor() -> NormalizerDescriptor {
        NormalizerDescriptor {
            protocol_version: agent_file_normalizer::NORMALIZER_PROTOCOL_VERSION,
            id: "markdown-to-markdown".to_owned(),
            display_name: "Markdown to Markdown".to_owned(),
            implementation_version: "1".to_owned(),
            inputs: vec![InputMatcher {
                format: FormatId::new("markdown"),
                media_types: vec!["text/markdown".to_owned()],
                extensions: vec!["md".to_owned()],
                magic_prefixes: Vec::new(),
            }],
            output: NormalizedFormat {
                format: FormatId::new("markdown"),
                media_type: "text/markdown".to_owned(),
                extension: "md".to_owned(),
                agent: AgentFileProfile {
                    retrieval: RetrievalProfile::Prose,
                    tools: ToolSupport::shell_text(),
                },
            },
            capabilities: NormalizerCapabilities::default(),
            default_priority: 100,
        }
    }

    #[test]
    fn uses_etag_preconditions_and_virtual_defaults() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempdir()?;
        let repository = ConfigRepository::new(root.path());
        let descriptors = vec![descriptor()];
        let loaded = repository.load(&descriptors)?;
        assert!(!loaded.persisted);
        let etag = repository.save(&loaded.config, Some(&loaded.etag), &descriptors)?;
        assert!(
            repository
                .save(&loaded.config, Some("sha256:stale"), &descriptors)
                .is_err()
        );
        assert_eq!(repository.load(&descriptors)?.etag, etag);
        Ok(())
    }

    #[test]
    fn virtual_defaults_choose_one_primary_output_per_input_format()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempdir()?;
        let preferred = descriptor();
        let mut alternative = preferred.clone();
        alternative.id = "markdown-to-html".to_owned();
        alternative.output.format = FormatId::new("html");
        alternative.output.media_type = "text/html".to_owned();
        alternative.output.extension = "html".to_owned();
        alternative.default_priority = preferred.default_priority - 10;

        let loaded = ConfigRepository::new(root.path()).load(&[alternative, preferred])?;
        assert_eq!(loaded.config.normalization.defaults.len(), 1);
        assert_eq!(
            loaded.config.normalization.defaults[0].normalizer_id,
            "markdown-to-markdown"
        );
        Ok(())
    }

    #[test]
    fn persists_recoverable_source_trash_entries() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempdir()?;
        let repository = ConfigRepository::new(root.path());
        let descriptors = vec![descriptor()];
        let loaded = repository.load(&descriptors)?;
        let mut config = loaded.config;
        let source = config.sources.remove(0);
        config.source_trash.push(crate::TrashedSourceDefinition {
            trash_id: "workspace:123".to_owned(),
            deleted_at_ms: 123,
            source,
        });

        repository.save(&config, Some(&loaded.etag), &descriptors)?;
        let restored = repository.load(&descriptors)?.config;
        assert!(restored.sources.is_empty());
        assert_eq!(restored.source_trash.len(), 1);
        assert_eq!(restored.source_trash[0].source.connector.id, "workspace");
        Ok(())
    }
}
