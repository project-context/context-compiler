use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::sync::Arc;

use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;

use crate::ArtifactRole;
use crate::NORMALIZER_PROTOCOL_VERSION;
use crate::NormalizationContext;
use crate::NormalizationReport;
use crate::NormalizationRequest;
use crate::NormalizerDescriptor;
use crate::NormalizerError;
use crate::NormalizerFuture;
use crate::NormalizerIdentity;
use crate::NormalizerResult;
use crate::ProbeRequest;
use crate::ProbeResult;

pub trait NormalizerFactory: Send + Sync {
    fn descriptor(&self) -> &NormalizerDescriptor;
    fn config_schema(&self) -> &Value;
    fn validate_config(&self, config: &Value) -> NormalizerResult<()>;
    fn create(&self, config: &Value) -> NormalizerResult<Arc<dyn Normalizer>>;
}

pub trait Normalizer: Send + Sync {
    fn descriptor(&self) -> &NormalizerDescriptor;

    fn probe<'a>(&'a self, request: ProbeRequest<'a>) -> NormalizerFuture<'a, ProbeResult>;

    fn normalize<'a>(
        &'a self,
        request: NormalizationRequest<'a>,
        context: NormalizationContext<'a>,
    ) -> NormalizerFuture<'a, NormalizationReport>;
}

#[derive(Clone)]
pub struct ConfiguredNormalizer {
    normalizer: Arc<dyn Normalizer>,
    identity: NormalizerIdentity,
}

impl ConfiguredNormalizer {
    pub fn descriptor(&self) -> &NormalizerDescriptor {
        self.normalizer.descriptor()
    }

    pub fn identity(&self) -> &NormalizerIdentity {
        &self.identity
    }

    pub fn probe<'a>(&'a self, request: ProbeRequest<'a>) -> NormalizerFuture<'a, ProbeResult> {
        self.normalizer.probe(request)
    }

    pub fn normalize<'a>(
        &'a self,
        request: NormalizationRequest<'a>,
        context: NormalizationContext<'a>,
    ) -> NormalizerFuture<'a, NormalizationReport> {
        let descriptor = self.normalizer.descriptor().clone();
        let future = self.normalizer.normalize(request, context);
        Box::pin(async move {
            let report = future.await?;
            validate_report(&descriptor, &report)?;
            Ok(report)
        })
    }
}

#[derive(Clone, Default)]
pub struct NormalizerRegistry {
    factories: BTreeMap<String, Arc<dyn NormalizerFactory>>,
}

impl NormalizerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, factory: Arc<dyn NormalizerFactory>) -> NormalizerResult<()> {
        validate_descriptor(factory.descriptor())?;
        let id = factory.descriptor().id.clone();
        if self.factories.contains_key(&id) {
            return Err(NormalizerError::invalid_config(format!(
                "normalizer is already registered: {id}"
            )));
        }
        self.factories.insert(id, factory);
        Ok(())
    }

    pub fn descriptors(&self) -> Vec<NormalizerDescriptor> {
        self.factories
            .values()
            .map(|factory| factory.descriptor().clone())
            .collect()
    }

    pub fn descriptor(&self, normalizer_id: &str) -> Option<NormalizerDescriptor> {
        self.factories
            .get(normalizer_id)
            .map(|factory| factory.descriptor().clone())
    }

    pub fn config_schema(&self, normalizer_id: &str) -> Option<Value> {
        self.factories
            .get(normalizer_id)
            .map(|factory| factory.config_schema().clone())
    }

    pub fn configure(
        &self,
        normalizer_id: &str,
        config: &Value,
    ) -> NormalizerResult<ConfiguredNormalizer> {
        let factory = self.factories.get(normalizer_id).ok_or_else(|| {
            NormalizerError::invalid_config(format!(
                "normalizer is not registered: {normalizer_id}"
            ))
        })?;
        factory.validate_config(config)?;
        let normalizer = factory.create(config)?;
        if normalizer.descriptor() != factory.descriptor() {
            return Err(NormalizerError::invalid_config(format!(
                "configured normalizer descriptor changed: {normalizer_id}"
            )));
        }
        Ok(ConfiguredNormalizer {
            identity: NormalizerIdentity {
                name: factory.descriptor().id.clone(),
                version: factory.descriptor().implementation_version.clone(),
                config_hash: canonical_config_hash(config)?,
            },
            normalizer,
        })
    }
}

pub fn empty_config_schema() -> &'static Value {
    static SCHEMA: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    SCHEMA.get_or_init(|| {
        serde_json::json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })
    })
}

pub fn empty_config() -> Value {
    serde_json::json!({})
}

pub fn validate_empty_config(config: &Value) -> NormalizerResult<()> {
    if config.as_object().is_some_and(serde_json::Map::is_empty) {
        Ok(())
    } else {
        Err(NormalizerError::invalid_config(
            "this normalizer accepts only an empty configuration object",
        ))
    }
}

pub fn default_probe<'a>(
    descriptor: &'a NormalizerDescriptor,
    request: ProbeRequest<'a>,
) -> NormalizerFuture<'a, ProbeResult> {
    Box::pin(async move {
        let metadata = request.input.metadata();
        let extension = metadata.extension.as_deref().map(str::to_ascii_lowercase);
        let declared_media_type = metadata.declared_media_type.as_deref();
        let supported = descriptor.inputs.iter().any(|matcher| {
            declared_media_type.is_some_and(|value| {
                matcher
                    .media_types
                    .iter()
                    .any(|candidate| candidate == value)
            }) || extension.as_ref().is_some_and(|value| {
                matcher
                    .extensions
                    .iter()
                    .any(|candidate| candidate == value)
            })
        });
        let matched = descriptor.inputs.first();
        Ok(ProbeResult {
            supported,
            confidence: if supported { 80 } else { 0 },
            detected_format: supported
                .then(|| matched.map(|value| value.format.clone()))
                .flatten(),
            detected_media_type: supported
                .then(|| matched.and_then(|value| value.media_types.first().cloned()))
                .flatten(),
            work: crate::WorkEstimate {
                total: metadata.size_bytes.or(Some(1)),
                unit: if metadata.size_bytes.is_some() {
                    crate::WorkUnit::Bytes
                } else {
                    crate::WorkUnit::Files
                },
            },
            diagnostics: Vec::new(),
        })
    })
}

fn canonical_config_hash(config: &Value) -> NormalizerResult<String> {
    let bytes = serde_json::to_vec(config)
        .map_err(|error| NormalizerError::invalid_config(error.to_string()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn validate_descriptor(descriptor: &NormalizerDescriptor) -> NormalizerResult<()> {
    if descriptor.protocol_version != NORMALIZER_PROTOCOL_VERSION {
        return Err(NormalizerError::invalid_config(format!(
            "unsupported normalizer protocol version: {}",
            descriptor.protocol_version
        )));
    }
    validate_identifier("normalizer ID", &descriptor.id)?;
    validate_identifier("output format ID", descriptor.output.format.as_str())?;
    validate_media_type("output media type", &descriptor.output.media_type)?;
    validate_extension(&descriptor.output.extension)?;
    if descriptor.inputs.is_empty() {
        return Err(NormalizerError::invalid_config(
            "normalizer descriptor must contain at least one input matcher",
        ));
    }
    for input in &descriptor.inputs {
        validate_identifier("input format ID", input.format.as_str())?;
        if input.media_types.is_empty()
            && input.extensions.is_empty()
            && input.magic_prefixes.is_empty()
        {
            return Err(NormalizerError::invalid_config(
                "an input matcher must declare a media type, extension, or magic prefix",
            ));
        }
        for media_type in &input.media_types {
            validate_media_type("input media type", media_type)?;
        }
        for extension in &input.extensions {
            validate_extension(extension)?;
        }
    }
    Ok(())
}

fn validate_report(
    descriptor: &NormalizerDescriptor,
    report: &NormalizationReport,
) -> NormalizerResult<()> {
    if report.primary.role != ArtifactRole::Primary {
        return Err(NormalizerError::invalid_output(
            "normalization report primary artifact has the wrong role",
        ));
    }
    if report.primary.format.as_ref() != Some(&descriptor.output.format)
        || report.primary.media_type != descriptor.output.media_type
        || report.primary.extension.as_deref() != Some(descriptor.output.extension.as_str())
    {
        return Err(NormalizerError::invalid_output(
            "primary artifact does not match the normalizer descriptor",
        ));
    }
    if report
        .companions
        .iter()
        .any(|artifact| artifact.role != ArtifactRole::Companion)
    {
        return Err(NormalizerError::invalid_output(
            "a companion artifact has the wrong role",
        ));
    }
    if report
        .locator_map
        .as_ref()
        .is_some_and(|artifact| artifact.role != ArtifactRole::LocatorMap)
    {
        return Err(NormalizerError::invalid_output(
            "locator map artifact has the wrong role",
        ));
    }
    let mut uris = BTreeSet::new();
    for artifact in report.artifacts() {
        if !uris.insert(&artifact.uri) {
            return Err(NormalizerError::invalid_output(format!(
                "normalization report contains a duplicate artifact: {}",
                artifact.uri
            )));
        }
        if artifact.uri != format!("artifact:{}", artifact.content_hash)
            || !artifact.content_hash.starts_with("sha256:")
            || artifact.content_hash.len() != "sha256:".len() + 64
        {
            return Err(NormalizerError::invalid_output(format!(
                "artifact URI and content hash disagree: {}",
                artifact.uri
            )));
        }
        if artifact.size_bytes == 0 && artifact.role == ArtifactRole::Primary {
            // Empty text is valid; the explicit branch documents that zero is not an error.
        }
    }
    if report.statistics.processed_units > report.statistics.total_units {
        return Err(NormalizerError::invalid_output(
            "normalization statistics exceed total work units",
        ));
    }
    Ok(())
}

fn validate_extension(extension: &str) -> NormalizerResult<()> {
    if extension.is_empty()
        || extension.starts_with('.')
        || extension != extension.to_ascii_lowercase()
        || !extension
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'_' | b'-'))
    {
        return Err(NormalizerError::invalid_config(format!(
            "invalid file extension: {extension}"
        )));
    }
    Ok(())
}

fn validate_identifier(kind: &str, value: &str) -> NormalizerResult<()> {
    if value.is_empty()
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
    {
        return Err(NormalizerError::invalid_config(format!(
            "invalid {kind}: {value}"
        )));
    }
    Ok(())
}

fn validate_media_type(kind: &str, value: &str) -> NormalizerResult<()> {
    if !value.contains('/') || value.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return Err(NormalizerError::invalid_config(format!(
            "invalid {kind}: {value}"
        )));
    }
    Ok(())
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
