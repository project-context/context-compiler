use std::sync::Arc;

use agent_file_normalizer::*;
use context_source::NormalizationConfig;
use context_source::NormalizationRule;
use context_source::NormalizerRegistry;
use pretty_assertions::assert_eq;

#[derive(Clone)]
struct CsvToHtml;

impl NormalizerFactory for CsvToHtml {
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

impl Normalizer for CsvToHtml {
    fn descriptor(&self) -> &NormalizerDescriptor {
        descriptor()
    }
    fn probe<'a>(&'a self, request: ProbeRequest<'a>) -> NormalizerFuture<'a, ProbeResult> {
        default_probe(descriptor(), request)
    }
    fn normalize<'a>(
        &'a self,
        _request: NormalizationRequest<'a>,
        context: NormalizationContext<'a>,
    ) -> NormalizerFuture<'a, NormalizationReport> {
        Box::pin(async move {
            finish_text_normalization(
                &context,
                descriptor().output.clone(),
                0,
                String::new(),
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
        id: "csv-to-html".to_owned(),
        display_name: "CSV to HTML".to_owned(),
        implementation_version: "1".to_owned(),
        inputs: vec![InputMatcher {
            format: FormatId::new("csv"),
            media_types: vec!["text/csv".to_owned()],
            extensions: vec!["csv".to_owned()],
            magic_prefixes: Vec::new(),
        }],
        output: NormalizedFormat {
            format: FormatId::new("html"),
            media_type: "text/html".to_owned(),
            extension: "html".to_owned(),
            agent: AgentFileProfile {
                retrieval: RetrievalProfile::Tabular,
                tools: ToolSupport::rich_document(),
            },
        },
        capabilities: NormalizerCapabilities::default(),
        default_priority: 100,
    })
}

#[test]
fn context_adapter_accepts_a_portable_normalizer_factory() -> Result<(), Box<dyn std::error::Error>>
{
    let mut registry = NormalizerRegistry::new();
    registry.register(Arc::new(CsvToHtml))?;
    let resolved = registry.resolve(&NormalizationConfig {
        rules: vec![NormalizationRule {
            normalizer_id: "csv-to-html".to_owned(),
            enabled: true,
            extensions: Vec::new(),
            priority: None,
            config: empty_config(),
        }],
    })?;
    assert_eq!(resolved[0].input_extension, "csv");
    assert_eq!(resolved[0].output.format, FormatId::new("html"));
    Ok(())
}
