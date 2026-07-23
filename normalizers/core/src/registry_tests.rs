use std::error::Error;
use std::sync::Arc;

use serde_json::Value;

use super::*;
use crate::AgentFileProfile;
use crate::ArtifactSink;
use crate::BytesInputSource;
use crate::FormatId;
use crate::InputMatcher;
use crate::InputMetadata;
use crate::MemoryArtifactSink;
use crate::NeverCancelled;
use crate::NoProgress;
use crate::NoScratchSpace;
use crate::NormalizationContext;
use crate::NormalizationReport;
use crate::NormalizationRequest;
use crate::NormalizationStatistics;
use crate::NormalizedFormat;
use crate::NormalizedMapping;
use crate::NormalizerCapabilities;
use crate::OriginalLocator;
use crate::ProbeRequest;
use crate::ProbeResult;
use crate::ResourceLimits;
use crate::RetrievalProfile;
use crate::ToolSupport;
use crate::WorkEstimate;
use crate::empty_config_schema;
use crate::read_all;
use crate::validate_empty_config;
use crate::write_locator_map;
use crate::write_primary_text;

fn assert_object_safe(_factory: Arc<dyn NormalizerFactory>, _normalizer: Arc<dyn Normalizer>) {}

#[derive(Clone, Default)]
struct BinaryToText;

impl NormalizerFactory for BinaryToText {
    fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }

    fn config_schema(&self) -> &Value {
        empty_config_schema()
    }

    fn validate_config(&self, config: &Value) -> NormalizerResult<()> {
        validate_empty_config(config)
    }

    fn create(&self, config: &Value) -> NormalizerResult<Arc<dyn Normalizer>> {
        self.validate_config(config)?;
        Ok(Arc::new(Self))
    }
}

impl Normalizer for BinaryToText {
    fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }

    fn probe<'a>(&'a self, _request: ProbeRequest<'a>) -> NormalizerFuture<'a, ProbeResult> {
        Box::pin(async {
            Ok(ProbeResult {
                supported: true,
                confidence: 100,
                detected_format: Some(FormatId::new("binary")),
                detected_media_type: Some("application/octet-stream".to_owned()),
                work: WorkEstimate::files(1),
                diagnostics: Vec::new(),
            })
        })
    }

    fn normalize<'a>(
        &'a self,
        request: NormalizationRequest<'a>,
        context: NormalizationContext<'a>,
    ) -> NormalizerFuture<'a, NormalizationReport> {
        Box::pin(async move {
            let bytes = read_all(request.input, &context).await?;
            let content = format!("bytes: {}\n", bytes.len());
            let content_len = content.len() as u64;
            let primary = write_primary_text(
                &context,
                descriptor().output.format.clone(),
                descriptor().output.media_type.clone(),
                descriptor().output.extension.clone(),
                content,
            )
            .await?;
            let locator_map = write_locator_map(
                &context,
                &[NormalizedMapping {
                    normalized_start: 0,
                    normalized_end: content_len,
                    original: OriginalLocator::File {
                        uri: request.input.metadata().source_uri.clone(),
                        start_line: None,
                        end_line: None,
                    },
                }],
            )
            .await?;
            Ok(NormalizationReport {
                primary,
                companions: Vec::new(),
                locator_map,
                diagnostics: Vec::new(),
                statistics: NormalizationStatistics {
                    input_bytes: bytes.len() as u64,
                    output_bytes: content_len,
                    processed_units: 1,
                    total_units: 1,
                },
            })
        })
    }
}

fn descriptor() -> &'static NormalizerDescriptor {
    static VALUE: std::sync::OnceLock<NormalizerDescriptor> = std::sync::OnceLock::new();
    VALUE.get_or_init(|| NormalizerDescriptor {
        protocol_version: crate::NORMALIZER_PROTOCOL_VERSION,
        id: "binary-to-text".to_owned(),
        display_name: "Binary to text".to_owned(),
        implementation_version: "1".to_owned(),
        inputs: vec![InputMatcher {
            format: FormatId::new("binary"),
            media_types: vec!["application/octet-stream".to_owned()],
            extensions: vec!["bin".to_owned()],
            magic_prefixes: Vec::new(),
        }],
        output: NormalizedFormat {
            format: FormatId::new("plain_text"),
            media_type: "text/plain".to_owned(),
            extension: "txt".to_owned(),
            agent: AgentFileProfile {
                retrieval: RetrievalProfile::Prose,
                tools: ToolSupport::shell_text(),
            },
        },
        capabilities: NormalizerCapabilities::default(),
        default_priority: 10,
    })
}

fn input(bytes: Vec<u8>) -> BytesInputSource {
    BytesInputSource::new(
        InputMetadata {
            source_uri: "a.bin".to_owned(),
            declared_media_type: None,
            extension: Some("bin".to_owned()),
            size_bytes: Some(bytes.len() as u64),
        },
        bytes,
    )
}

#[tokio::test]
async fn standalone_registry_streams_non_utf8_input_into_artifacts() -> Result<(), Box<dyn Error>> {
    let mut registry = NormalizerRegistry::new();
    registry.register(Arc::new(BinaryToText))?;
    let configured = registry.configure("binary-to-text", &serde_json::json!({}))?;
    let source = input(vec![0, 159, 255]);
    let sink = MemoryArtifactSink::default();
    let report = configured
        .normalize(
            NormalizationRequest { input: &source },
            NormalizationContext {
                artifacts: &sink,
                scratch: &NoScratchSpace,
                progress: &NoProgress,
                cancellation: &NeverCancelled,
                limits: ResourceLimits::default(),
            },
        )
        .await?;
    let artifacts = report.artifacts().cloned().collect::<Vec<_>>();
    sink.commit(&artifacts).await?;
    let content = sink.read(&report.primary.uri)?.ok_or("missing primary")?;
    assert_eq!(content.as_ref(), b"bytes: 3\n");
    assert!(report.locator_map.is_some());
    Ok(())
}

#[test]
fn duplicate_registration_and_non_empty_config_are_rejected() -> Result<(), Box<dyn Error>> {
    assert_object_safe(Arc::new(BinaryToText), Arc::new(BinaryToText));
    let mut registry = NormalizerRegistry::new();
    registry.register(Arc::new(BinaryToText))?;
    assert!(registry.register(Arc::new(BinaryToText)).is_err());
    assert!(
        registry
            .configure("binary-to-text", &serde_json::json!({ "extra": true }))
            .is_err()
    );
    Ok(())
}

#[test]
fn report_validation_rejects_descriptor_mismatch() {
    let sink = MemoryArtifactSink::default();
    let invalid = NormalizationReport {
        primary: crate::ProducedArtifact {
            uri: "artifact:sha256:abc".to_owned(),
            role: crate::ArtifactRole::Primary,
            relative_path: None,
            media_type: "text/html".to_owned(),
            format: Some(FormatId::new("html")),
            extension: Some("html".to_owned()),
            content_hash: "sha256:abc".to_owned(),
            size_bytes: 1,
        },
        companions: Vec::new(),
        locator_map: None,
        diagnostics: Vec::new(),
        statistics: NormalizationStatistics::default(),
    };
    let _ = sink;
    assert!(validate_report(descriptor(), &invalid).is_err());
}
