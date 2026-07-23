//! Deterministic TypeScript-to-TypeScript normalization for agent file tools.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::sync::Arc;

use agent_file_normalizer::*;

#[derive(Clone, Default)]
pub struct TypeScriptNormalizer;

impl TypeScriptNormalizer {
    pub fn new() -> Self {
        Self
    }
    pub fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }
}

impl NormalizerFactory for TypeScriptNormalizer {
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

impl Normalizer for TypeScriptNormalizer {
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
        id: "typescript-to-typescript".to_owned(),
        display_name: "TypeScript to TypeScript".to_owned(),
        implementation_version: env!("CARGO_PKG_VERSION").to_owned(),
        inputs: vec![InputMatcher {
            format: FormatId::new("typescript"),
            media_types: vec!["text/typescript".to_owned()],
            extensions: vec!["ts".to_owned()],
            magic_prefixes: Vec::new(),
        }],
        output: NormalizedFormat {
            format: FormatId::new("typescript"),
            media_type: "text/typescript".to_owned(),
            extension: "ts".to_owned(),
            agent: AgentFileProfile {
                retrieval: RetrievalProfile::SourceCode,
                tools: ToolSupport::shell_text(),
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
    async fn preserves_source_code_and_canonicalizes_lines()
    -> Result<(), Box<dyn std::error::Error>> {
        let normalizer = TypeScriptNormalizer::new();
        let source = BytesInputSource::new(
            InputMetadata {
                source_uri: "a.ts".to_owned(),
                declared_media_type: Some("text/typescript".to_owned()),
                extension: Some("ts".to_owned()),
                size_bytes: Some(14),
            },
            b"const a = 1;\r\n".to_vec(),
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
            Some(b"const a = 1;\n".as_slice())
        );
        assert_eq!(
            normalizer.descriptor().output.agent.retrieval,
            RetrievalProfile::SourceCode
        );
        Ok(())
    }
}
