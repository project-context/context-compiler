use std::sync::Arc;

use agent_file_normalizer::ArtifactSink;
use agent_file_normalizer::BytesInputSource;
use agent_file_normalizer::Cancellation;
use agent_file_normalizer::InputMetadata;
use agent_file_normalizer::NormalizationContext;
use agent_file_normalizer::NormalizationRequest;
use agent_file_normalizer::NormalizerConfig;
use agent_file_normalizer::NormalizerDescriptor;
use agent_file_normalizer::NormalizerError;
use agent_file_normalizer::NormalizerFactory;
use agent_file_normalizer::NormalizerRegistry as PortableRegistry;
use agent_file_normalizer::ProbeRequest;
use agent_file_normalizer::ProbeResult;
use agent_file_normalizer::ProgressReporter;
use agent_file_normalizer::ResourceLimits;
use agent_file_normalizer::ScratchSpace;
use bytes::Bytes;
use context_protocol::ArtifactRef;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::ProducerRef;
use context_protocol::RevisionRef;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::NormalizedArtifact;
use crate::NormalizedSource;
use crate::ProjectionPolicy;
use crate::SourceError;
use crate::SourceFuture;
use crate::SourceRecord;
use crate::SourceResult;
use crate::SourceSnapshot;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationConfig {
    #[serde(default)]
    pub rules: Vec<NormalizationRule>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationRule {
    pub normalizer_id: String,
    #[serde(default = "enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub extensions: Vec<String>,
    pub priority: Option<i32>,
    #[serde(default = "empty_config")]
    pub config: NormalizerConfig,
}

fn enabled() -> bool {
    true
}
fn empty_config() -> NormalizerConfig {
    agent_file_normalizer::empty_config()
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedNormalization {
    pub normalizer_id: String,
    pub input_format: agent_file_normalizer::FormatId,
    pub input_media_type: String,
    pub input_extension: String,
    pub output: agent_file_normalizer::NormalizedFormat,
    pub priority: i32,
    pub config: NormalizerConfig,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NormalizationCandidate {
    pub normalizer_id: String,
    pub priority: i32,
    pub config: NormalizerConfig,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SelectedNormalization {
    pub normalizer_id: String,
    pub config: NormalizerConfig,
    pub probe: ProbeResult,
}

/// Context Compiler adapter around the standalone normalizer registry.
#[derive(Clone, Default)]
pub struct NormalizerRegistry {
    portable: PortableRegistry,
}

impl NormalizerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, factory: Arc<dyn NormalizerFactory>) -> SourceResult<()> {
        self.portable.register(factory).map_err(source_error)
    }

    pub fn descriptors(&self) -> Vec<NormalizerDescriptor> {
        self.portable.descriptors()
    }

    pub fn descriptor(&self, normalizer_id: &str) -> Option<NormalizerDescriptor> {
        self.portable.descriptor(normalizer_id)
    }

    pub fn producer_ref(
        &self,
        normalizer_id: &str,
        config: &NormalizerConfig,
    ) -> SourceResult<ProducerRef> {
        let configured = self
            .portable
            .configure(normalizer_id, config)
            .map_err(source_error)?;
        Ok(producer_ref(configured.identity().clone()))
    }

    pub fn default_config(&self) -> NormalizationConfig {
        NormalizationConfig {
            rules: self
                .descriptors()
                .into_iter()
                .map(|descriptor| NormalizationRule {
                    normalizer_id: descriptor.id,
                    enabled: true,
                    extensions: descriptor
                        .inputs
                        .iter()
                        .flat_map(|input| input.extensions.clone())
                        .collect(),
                    priority: Some(descriptor.default_priority),
                    config: empty_config(),
                })
                .collect(),
        }
    }

    pub fn resolve(
        &self,
        config: &NormalizationConfig,
    ) -> SourceResult<Vec<ResolvedNormalization>> {
        let mut resolved = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for rule in &config.rules {
            if !seen.insert(&rule.normalizer_id) {
                return Err(SourceError::Configuration(format!(
                    "normalizer is configured more than once: {}",
                    rule.normalizer_id
                )));
            }
            if !rule.enabled {
                continue;
            }
            self.portable
                .configure(&rule.normalizer_id, &rule.config)
                .map_err(source_error)?;
            let descriptor = self.descriptor(&rule.normalizer_id).ok_or_else(|| {
                SourceError::Configuration(format!(
                    "normalizer is not registered: {}",
                    rule.normalizer_id
                ))
            })?;
            let input = descriptor.inputs.first().ok_or_else(|| {
                SourceError::Configuration(format!(
                    "normalizer has no input matcher: {}",
                    rule.normalizer_id
                ))
            })?;
            let extensions = if rule.extensions.is_empty() {
                input.extensions.clone()
            } else {
                rule.extensions
                    .iter()
                    .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
                    .collect()
            };
            let media_type = input
                .media_types
                .first()
                .cloned()
                .unwrap_or_else(|| "application/octet-stream".to_owned());
            for extension in extensions {
                resolved.push(ResolvedNormalization {
                    normalizer_id: descriptor.id.clone(),
                    input_format: input.format.clone(),
                    input_media_type: media_type.clone(),
                    input_extension: extension,
                    output: descriptor.output.clone(),
                    priority: rule.priority.unwrap_or(descriptor.default_priority),
                    config: rule.config.clone(),
                });
            }
        }
        resolved.sort_by(|left, right| {
            left.input_extension
                .cmp(&right.input_extension)
                .then_with(|| right.priority.cmp(&left.priority))
                .then_with(|| left.normalizer_id.cmp(&right.normalizer_id))
        });
        Ok(resolved)
    }

    pub fn probe<'a>(
        &'a self,
        normalizer_id: &'a str,
        config: &'a NormalizerConfig,
        source: &'a SourceRecord,
        bytes: Bytes,
    ) -> SourceFuture<'a, ProbeResult> {
        Box::pin(async move {
            let configured = self
                .portable
                .configure(normalizer_id, config)
                .map_err(source_error)?;
            let input = BytesInputSource::new(input_metadata(source, bytes.len()), bytes);
            configured
                .probe(ProbeRequest { input: &input })
                .await
                .map_err(source_error)
        })
    }

    pub fn select<'a>(
        &'a self,
        candidates: Vec<NormalizationCandidate>,
        source: &'a SourceRecord,
        bytes: Bytes,
    ) -> SourceFuture<'a, SelectedNormalization> {
        Box::pin(async move {
            let mut supported = Vec::new();
            for candidate in candidates {
                let probe = self
                    .probe(
                        &candidate.normalizer_id,
                        &candidate.config,
                        source,
                        bytes.clone(),
                    )
                    .await?;
                if probe.supported {
                    supported.push((candidate, probe));
                }
            }
            supported.sort_by(|(left, left_probe), (right, right_probe)| {
                right_probe
                    .confidence
                    .cmp(&left_probe.confidence)
                    .then_with(|| right.priority.cmp(&left.priority))
                    .then_with(|| left.normalizer_id.cmp(&right.normalizer_id))
            });
            let Some((selected, probe)) = supported.first() else {
                return Err(SourceError::Unsupported(source.uri.clone()));
            };
            if supported.get(1).is_some_and(|(other, other_probe)| {
                other_probe.confidence == probe.confidence
                    && other.priority == selected.priority
                    && other.normalizer_id != selected.normalizer_id
            }) {
                return Err(SourceError::Configuration(format!(
                    "normalizer candidates are tied for {}: {} and {}",
                    source.uri, selected.normalizer_id, supported[1].0.normalizer_id
                )));
            }
            Ok(SelectedNormalization {
                normalizer_id: selected.normalizer_id.clone(),
                config: selected.config.clone(),
                probe: probe.clone(),
            })
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn normalize<'a>(
        &'a self,
        normalizer_id: &'a str,
        config: &'a NormalizerConfig,
        source: SourceRecord,
        snapshot: SourceSnapshot,
        bytes: Bytes,
        artifacts: &'a dyn ArtifactSink,
        scratch: &'a dyn ScratchSpace,
        progress: &'a dyn ProgressReporter,
        cancellation: &'a dyn Cancellation,
        limits: ResourceLimits,
    ) -> SourceFuture<'a, NormalizedSource> {
        Box::pin(async move {
            let configured = self
                .portable
                .configure(normalizer_id, config)
                .map_err(source_error)?;
            let descriptor = configured.descriptor().clone();
            let input = BytesInputSource::new(input_metadata(&source, bytes.len()), bytes);
            let result = configured
                .normalize(
                    NormalizationRequest { input: &input },
                    NormalizationContext {
                        artifacts,
                        scratch,
                        progress,
                        cancellation,
                        limits,
                    },
                )
                .await;
            let report = match result {
                Ok(report) => report,
                Err(error) => {
                    let _ = artifacts.abort().await;
                    return Err(source_error(error));
                }
            };
            let produced = report.artifacts().cloned().collect::<Vec<_>>();
            artifacts.commit(&produced).await.map_err(source_error)?;
            let primary = normalized_artifact(report.primary);
            let entity = EntityRef::new(
                Layer::Source,
                format!("normalized:{}:{}", source.entity_ref.id, descriptor.id),
            );
            Ok(NormalizedSource {
                revision_ref: RevisionRef::new(entity, primary.content_hash.clone()),
                source_snapshot: snapshot.revision_ref,
                normalizer_id: descriptor.id,
                media_type: descriptor.output.media_type,
                format: descriptor.output.format,
                extension: descriptor.output.extension,
                agent: descriptor.output.agent,
                primary,
                companions: report
                    .companions
                    .into_iter()
                    .map(normalized_artifact)
                    .collect(),
                locator_map: report.locator_map.map(normalized_artifact),
                projection_policy: ProjectionPolicy::Normalize,
                normalizer: producer_ref(configured.identity().clone()),
                diagnostics: report.diagnostics,
                freshness: Freshness::Current,
            })
        })
    }
}

fn input_metadata(source: &SourceRecord, size: usize) -> InputMetadata {
    InputMetadata {
        source_uri: source.uri.clone(),
        declared_media_type: Some(source.media_type.clone()),
        extension: std::path::Path::new(&source.uri)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase),
        size_bytes: Some(size as u64),
    }
}

fn normalized_artifact(value: agent_file_normalizer::ProducedArtifact) -> NormalizedArtifact {
    NormalizedArtifact {
        artifact: ArtifactRef::new(value.uri),
        role: value.role,
        relative_path: value.relative_path,
        media_type: value.media_type,
        format: value.format,
        extension: value.extension,
        content_hash: value.content_hash,
        size_bytes: value.size_bytes,
    }
}

fn producer_ref(value: agent_file_normalizer::NormalizerIdentity) -> ProducerRef {
    ProducerRef {
        name: value.name,
        version: value.version,
        config_hash: value.config_hash,
    }
}

fn source_error(error: NormalizerError) -> SourceError {
    if error.is_cancelled() {
        SourceError::Cancelled
    } else if error.category == agent_file_normalizer::NormalizerErrorCategory::Configuration {
        SourceError::Configuration(error.to_string())
    } else if error.category == agent_file_normalizer::NormalizerErrorCategory::Input {
        SourceError::Decode(error.to_string())
    } else {
        SourceError::Normalization(error.to_string())
    }
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
