use std::error::Error;
use std::sync::Arc;

use agent_file_normalizer::*;
use bytes::Bytes;
use context_protocol::AccessStatus;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::RevisionRef;

use super::*;

#[derive(Clone)]
struct BinaryToHtml;

impl NormalizerFactory for BinaryToHtml {
    fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }
    fn config_schema(&self) -> &NormalizerConfig {
        empty_config_schema()
    }
    fn validate_config(&self, config: &NormalizerConfig) -> NormalizerResult<()> {
        validate_empty_config(config)
    }
    fn create(&self, config: &NormalizerConfig) -> NormalizerResult<Arc<dyn Normalizer>> {
        self.validate_config(config)?;
        Ok(Arc::new(Self))
    }
}

impl Normalizer for BinaryToHtml {
    fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }

    fn probe<'a>(&'a self, request: ProbeRequest<'a>) -> NormalizerFuture<'a, ProbeResult> {
        default_probe(descriptor(), request)
    }

    fn normalize<'a>(
        &'a self,
        request: NormalizationRequest<'a>,
        context: NormalizationContext<'a>,
    ) -> NormalizerFuture<'a, NormalizationReport> {
        Box::pin(async move {
            let bytes = read_all(request.input, &context).await?;
            finish_text_normalization(
                &context,
                descriptor().output.clone(),
                bytes.len() as u64,
                format!("<p>{}</p>", bytes.len()),
                Vec::new(),
                Vec::new(),
                1,
                1,
            )
            .await
        })
    }
}

fn descriptor() -> &'static NormalizerDescriptor {
    static VALUE: std::sync::OnceLock<NormalizerDescriptor> = std::sync::OnceLock::new();
    VALUE.get_or_init(|| NormalizerDescriptor {
        protocol_version: NORMALIZER_PROTOCOL_VERSION,
        id: "binary-to-html".to_owned(),
        display_name: "Binary to HTML".to_owned(),
        implementation_version: "1".to_owned(),
        inputs: vec![InputMatcher {
            format: FormatId::new("binary_document"),
            media_types: vec!["application/octet-stream".to_owned()],
            extensions: vec!["bin".to_owned()],
            magic_prefixes: Vec::new(),
        }],
        output: NormalizedFormat {
            format: FormatId::new("html"),
            media_type: "text/html".to_owned(),
            extension: "html".to_owned(),
            agent: AgentFileProfile {
                retrieval: RetrievalProfile::RichDocument,
                tools: ToolSupport::rich_document(),
            },
        },
        capabilities: NormalizerCapabilities::default(),
        default_priority: 10,
    })
}

#[tokio::test]
async fn adapter_preserves_portable_artifact_identity() -> Result<(), Box<dyn Error>> {
    let mut registry = super::NormalizerRegistry::new();
    registry.register(Arc::new(BinaryToHtml))?;
    let entity = EntityRef::new(Layer::Source, "source:file:a.bin");
    let revision = RevisionRef::new(entity.clone(), "r1");
    let sink = MemoryArtifactSink::default();
    let normalized = registry
        .normalize(
            "binary-to-html",
            &agent_file_normalizer::empty_config(),
            SourceRecord {
                entity_ref: entity,
                format: FormatId::new("binary_document"),
                uri: "a.bin".to_owned(),
                title: "a.bin".to_owned(),
                media_type: "application/octet-stream".to_owned(),
                current_snapshot: revision.clone(),
                access_status: AccessStatus::Available,
            },
            SourceSnapshot {
                revision_ref: revision,
                content_hash: "r1".to_owned(),
                size_bytes: 3,
                modified_at: None,
                freshness: Freshness::Current,
            },
            Bytes::from_static(&[0, 159, 255]),
            &sink,
            &NoScratchSpace,
            &NoProgress,
            &NeverCancelled,
            ResourceLimits::default(),
        )
        .await?;
    let content = sink
        .read(&normalized.primary.artifact.uri)?
        .ok_or("missing artifact")?;
    assert_eq!(content, Bytes::from_static(b"<p>3</p>"));
    assert_eq!(normalized.normalizer_id, "binary-to-html");
    assert_eq!(normalized.format, FormatId::new("html"));
    assert_eq!(normalized.normalizer.name, "binary-to-html");
    Ok(())
}
