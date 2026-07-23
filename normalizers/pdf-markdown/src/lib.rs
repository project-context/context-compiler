//! Text-layer PDF to deterministic Markdown normalization.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::sync::Arc;

use agent_file_normalizer::*;
use lopdf::Document;

#[derive(Clone, Default)]
pub struct PdfToMarkdownNormalizer;

impl PdfToMarkdownNormalizer {
    pub fn new() -> Self {
        Self
    }
    pub fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }
}

impl NormalizerFactory for PdfToMarkdownNormalizer {
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

impl Normalizer for PdfToMarkdownNormalizer {
    fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }

    fn probe<'a>(&'a self, request: ProbeRequest<'a>) -> NormalizerFuture<'a, ProbeResult> {
        probe_pdf(request)
    }

    fn normalize<'a>(
        &'a self,
        request: NormalizationRequest<'a>,
        context: NormalizationContext<'a>,
    ) -> NormalizerFuture<'a, NormalizationReport> {
        Box::pin(async move {
            let bytes = read_all(request.input, &context).await?;
            let document = load_pdf(&bytes)?;
            let pages = document.get_pages();
            let total_pages = pages.len() as u64;
            let mut content = String::new();
            let mut mappings = Vec::new();
            let mut diagnostics = Vec::new();
            let mut extracted_text = false;
            for (index, page) in pages.keys().copied().enumerate() {
                if context.cancellation.is_cancelled() {
                    context.artifacts.abort().await?;
                    return Err(NormalizerError::cancelled());
                }
                let text = document
                    .extract_text(&[page])
                    .map_err(|error| NormalizerError::corrupt_input(error.to_string()))?;
                let text = normalize_text(&text);
                let start = content.len() as u64;
                content.push_str(&format!("<!-- page:{page} -->\n\n## Page {page}\n\n"));
                if text.trim().is_empty() {
                    content.push_str("_[No extractable text on this page]_\n\n");
                    diagnostics.push(NormalizationDiagnostic {
                        code: "pdf_page_has_no_text".to_owned(),
                        level: NormalizationDiagnosticLevel::Warning,
                        message: format!("PDF page {page} has no extractable text"),
                        locator: Some(OriginalLocator::DocumentPage {
                            uri: request.input.metadata().source_uri.clone(),
                            page,
                        }),
                    });
                } else {
                    extracted_text = true;
                    content.push_str(text.trim());
                    content.push_str("\n\n");
                }
                mappings.push(NormalizedMapping {
                    normalized_start: start,
                    normalized_end: content.len() as u64,
                    original: OriginalLocator::DocumentPage {
                        uri: request.input.metadata().source_uri.clone(),
                        page,
                    },
                });
                context.progress.report(NormalizationProgress {
                    phase: "extract_pages".into(),
                    completed: index as u64 + 1,
                    total: Some(total_pages),
                    unit: WorkUnit::Pages,
                    message: Some(format!(
                        "{} page {page}",
                        request.input.metadata().source_uri
                    )),
                })?;
            }
            if !extracted_text {
                context.artifacts.abort().await?;
                return Err(NormalizerError::new(
                    NormalizerErrorCode::OCR_REQUIRED,
                    NormalizerErrorCategory::Requirement,
                    "PDF has no extractable text layer",
                ));
            }
            finish_text_normalization(
                &context,
                descriptor().output.clone(),
                bytes.len() as u64,
                content,
                mappings,
                diagnostics,
                total_pages,
                total_pages,
            )
            .await
        })
    }
}

fn descriptor() -> &'static NormalizerDescriptor {
    static VALUE: std::sync::OnceLock<NormalizerDescriptor> = std::sync::OnceLock::new();
    VALUE.get_or_init(|| NormalizerDescriptor {
        protocol_version: NORMALIZER_PROTOCOL_VERSION,
        id: "pdf-to-markdown".to_owned(),
        display_name: "PDF to Markdown".to_owned(),
        implementation_version: env!("CARGO_PKG_VERSION").to_owned(),
        inputs: vec![InputMatcher {
            format: FormatId::new("pdf"),
            media_types: vec!["application/pdf".to_owned()],
            extensions: vec!["pdf".to_owned()],
            magic_prefixes: vec![b"%PDF-".to_vec()],
        }],
        output: NormalizedFormat {
            format: FormatId::new("markdown"),
            media_type: "text/markdown".to_owned(),
            extension: "md".to_owned(),
            agent: AgentFileProfile {
                retrieval: RetrievalProfile::RichDocument,
                tools: ToolSupport::shell_text(),
            },
        },
        capabilities: NormalizerCapabilities {
            deterministic: true,
            streaming: false,
            random_access: true,
            companions: false,
            locator_kinds: vec!["document_page".to_owned()],
        },
        default_priority: 100,
    })
}

fn probe_pdf<'a>(request: ProbeRequest<'a>) -> NormalizerFuture<'a, ProbeResult> {
    Box::pin(async move {
        let size = request.input.metadata().size_bytes.unwrap_or(0);
        let bytes = request
            .input
            .read_range(0, usize::try_from(size).unwrap_or(usize::MAX))
            .await?;
        let document = load_pdf(&bytes)?;
        let pages = document.get_pages().len() as u64;
        Ok(ProbeResult {
            supported: true,
            confidence: 100,
            detected_format: Some(FormatId::new("pdf")),
            detected_media_type: Some("application/pdf".to_owned()),
            work: WorkEstimate {
                total: Some(pages),
                unit: WorkUnit::Pages,
            },
            diagnostics: Vec::new(),
        })
    })
}

fn load_pdf(bytes: &[u8]) -> NormalizerResult<Document> {
    let document = Document::load_mem(bytes)
        .map_err(|error| NormalizerError::corrupt_input(format!("invalid PDF: {error}")))?;
    if document.is_encrypted() {
        return Err(NormalizerError::new(
            NormalizerErrorCode::PASSWORD_REQUIRED,
            NormalizerErrorCategory::Requirement,
            "encrypted PDF requires a password",
        ));
    }
    Ok(document)
}

fn normalize_text(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::PdfToMarkdownNormalizer;
    use agent_file_normalizer::*;
    use lopdf::{
        Document, Object, Stream,
        content::{Content, Operation},
        dictionary,
    };

    #[tokio::test]
    async fn renders_multiple_pages_deterministically_with_page_lineage()
    -> Result<(), Box<dyn std::error::Error>> {
        let bytes = pdf(&[Some("Refund policy"), Some("Seven days")])?;
        let first = run(bytes.clone()).await?;
        let second = run(bytes).await?;
        assert_eq!(first, second);
        assert!(first.0.contains("Refund policy"));
        assert!(first.0.contains("## Page 2"));
        assert!(first.1.contains("document_page"));
        Ok(())
    }

    #[tokio::test]
    async fn textless_pdf_requests_ocr() -> Result<(), Box<dyn std::error::Error>> {
        let bytes = pdf(&[None])?;
        let source = input(bytes);
        let sink = MemoryArtifactSink::default();
        let result = PdfToMarkdownNormalizer::new()
            .normalize(NormalizationRequest { input: &source }, context(&sink))
            .await;
        let Err(error) = result else {
            return Err("a textless PDF must not normalize".into());
        };
        assert_eq!(error.code.as_str(), NormalizerErrorCode::OCR_REQUIRED);
        Ok(())
    }

    async fn run(bytes: Vec<u8>) -> Result<(String, String), Box<dyn std::error::Error>> {
        let source = input(bytes);
        let sink = MemoryArtifactSink::default();
        let report = PdfToMarkdownNormalizer::new()
            .normalize(NormalizationRequest { input: &source }, context(&sink))
            .await?;
        sink.commit(&report.artifacts().cloned().collect::<Vec<_>>())
            .await?;
        let primary = String::from_utf8(
            sink.read(&report.primary.uri)?
                .ok_or("missing primary")?
                .to_vec(),
        )?;
        let locator = String::from_utf8(
            sink.read(&report.locator_map.ok_or("missing locator")?.uri)?
                .ok_or("missing locator bytes")?
                .to_vec(),
        )?;
        Ok((primary, locator))
    }

    fn context(sink: &MemoryArtifactSink) -> NormalizationContext<'_> {
        NormalizationContext {
            artifacts: sink,
            scratch: &NoScratchSpace,
            progress: &NoProgress,
            cancellation: &NeverCancelled,
            limits: ResourceLimits::default(),
        }
    }

    fn input(bytes: Vec<u8>) -> BytesInputSource {
        let len = bytes.len() as u64;
        BytesInputSource::new(
            InputMetadata {
                source_uri: "policy.pdf".to_owned(),
                declared_media_type: Some("application/pdf".to_owned()),
                extension: Some("pdf".to_owned()),
                size_bytes: Some(len),
            },
            bytes,
        )
    }

    fn pdf(pages: &[Option<&str>]) -> Result<Vec<u8>, lopdf::Error> {
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let font_id = document.add_object(
            dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" },
        );
        let mut page_ids = Vec::new();
        for text in pages {
            let operations = text.map_or_else(Vec::new, |text| {
                vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 12.into()]),
                    Operation::new("Td", vec![50.into(), 750.into()]),
                    Operation::new("Tj", vec![Object::string_literal(text)]),
                    Operation::new("ET", vec![]),
                ]
            });
            let content_id = document.add_object(Stream::new(
                dictionary! {},
                Content { operations }.encode()?,
            ));
            let page_id = document.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()], "Contents" => content_id,
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font_id } } });
            page_ids.push(page_id);
        }
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages",
            "Kids" => page_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => i64::try_from(page_ids.len()).unwrap_or(i64::MAX) }),
        );
        let catalog_id =
            document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        document.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes)?;
        Ok(bytes)
    }
}
