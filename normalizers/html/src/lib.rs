//! Deterministic HTML-to-HTML normalization for rich agent-readable documents.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::sync::Arc;

use agent_file_normalizer::*;

#[derive(Clone, Default)]
pub struct HtmlNormalizer;

impl HtmlNormalizer {
    pub fn new() -> Self {
        Self
    }

    pub fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }
}

impl NormalizerFactory for HtmlNormalizer {
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

impl Normalizer for HtmlNormalizer {
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
            let content = String::from_utf8(bytes.to_vec())
                .map_err(|error| NormalizerError::corrupt_input(error.to_string()))?
                .replace("\r\n", "\n")
                .replace('\r', "\n");
            let content_len = content.len() as u64;
            finish_text_normalization(
                &context,
                descriptor().output.clone(),
                bytes.len() as u64,
                content,
                vec![whole_file_mapping(request.input.metadata(), content_len)],
                Vec::new(),
                bytes.len() as u64,
                bytes.len() as u64,
            )
            .await
        })
    }
}

fn descriptor() -> &'static NormalizerDescriptor {
    static VALUE: std::sync::OnceLock<NormalizerDescriptor> = std::sync::OnceLock::new();
    VALUE.get_or_init(|| NormalizerDescriptor {
        protocol_version: NORMALIZER_PROTOCOL_VERSION,
        id: "html-to-html".to_owned(),
        display_name: "HTML to HTML".to_owned(),
        implementation_version: env!("CARGO_PKG_VERSION").to_owned(),
        inputs: vec![InputMatcher {
            format: FormatId::new("html"),
            media_types: vec!["text/html".to_owned()],
            extensions: vec!["html".to_owned(), "htm".to_owned()],
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
        default_priority: 100,
    })
}

fn whole_file_mapping(metadata: &InputMetadata, normalized_end: u64) -> NormalizedMapping {
    NormalizedMapping {
        normalized_start: 0,
        normalized_end,
        original: OriginalLocator::File {
            uri: metadata.source_uri.clone(),
            start_line: None,
            end_line: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn marks_html_as_rich_document_not_shell_first() -> Result<(), Box<dyn std::error::Error>>
    {
        let normalizer = HtmlNormalizer::new();
        assert_eq!(
            normalizer.descriptor().output.agent.tools.sed,
            ToolSupportLevel::NotRecommended
        );
        let source = BytesInputSource::new(
            InputMetadata {
                source_uri: "a.html".to_owned(),
                declared_media_type: Some("text/html".to_owned()),
                extension: Some("html".to_owned()),
                size_bytes: Some(11),
            },
            b"<p>A</p>\r\n".to_vec(),
        );
        let sink = MemoryArtifactSink::default();
        let report = normalizer
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
        sink.commit(&report.artifacts().cloned().collect::<Vec<_>>())
            .await?;
        assert_eq!(
            sink.read(&report.primary.uri)?.as_deref(),
            Some(b"<p>A</p>\n".as_slice())
        );
        Ok(())
    }
}
