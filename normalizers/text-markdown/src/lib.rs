//! Plain-text-to-Markdown normalization for agent file tools.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::sync::Arc;

use agent_file_normalizer::*;

#[derive(Clone, Default)]
pub struct TextToMarkdownNormalizer;

impl TextToMarkdownNormalizer {
    pub fn new() -> Self {
        Self
    }
    pub fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }
}

impl NormalizerFactory for TextToMarkdownNormalizer {
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

impl Normalizer for TextToMarkdownNormalizer {
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
        id: "text-to-markdown".to_owned(),
        display_name: "Text to Markdown".to_owned(),
        implementation_version: env!("CARGO_PKG_VERSION").to_owned(),
        inputs: vec![InputMatcher {
            format: FormatId::new("plain_text"),
            media_types: vec!["text/plain".to_owned()],
            extensions: vec!["txt".to_owned(), "text".to_owned()],
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
        default_priority: 90,
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
    async fn converts_text_to_shell_friendly_markdown() -> Result<(), Box<dyn std::error::Error>> {
        let normalizer = TextToMarkdownNormalizer::new();
        assert_eq!(
            normalizer.descriptor().output.format,
            FormatId::new("markdown")
        );
        let source = BytesInputSource::new(
            InputMetadata {
                source_uri: "a.txt".to_owned(),
                declared_media_type: Some("text/plain".to_owned()),
                extension: Some("txt".to_owned()),
                size_bytes: Some(8),
            },
            b"one\r\ntwo".to_vec(),
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
            Some(b"one\ntwo".as_slice())
        );
        Ok(())
    }
}
