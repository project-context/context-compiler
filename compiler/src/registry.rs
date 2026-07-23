use std::collections::BTreeMap;
use std::sync::Arc;

use context_evidence::EvidenceBuildOutput;
use context_evidence::EvidenceBuildRequest;
use context_evidence::EvidenceBuilder;
use context_evidence::EvidenceFuture;
use context_fact::FactBuildOutput;
use context_fact::FactBuildRequest;
use context_fact::FactBuilder;
use context_fact::FactFuture;
use context_processor_markdown::MarkdownProcessor;
use context_processor_typescript::TypeScriptProcessor;
use context_source::FormatId;
use context_structure::StructureParserFactory;
use context_structure::StructureParserRegistry;
use context_structure::StructureParserResult;
use context_structure_parser_markdown::MarkdownStructureParserFactory;
use context_structure_parser_tree_sitter_typescript::TypeScriptStructureParserFactory;

pub trait Processor: Send + Sync {
    fn normalized_format(&self) -> FormatId;
    fn build_evidence(
        &self,
        request: EvidenceBuildRequest,
    ) -> EvidenceFuture<'_, EvidenceBuildOutput>;
    fn build_facts(&self, request: FactBuildRequest) -> FactFuture<'_, FactBuildOutput>;
}

macro_rules! impl_processor {
    ($processor:ty, $format:expr) => {
        impl Processor for $processor {
            fn normalized_format(&self) -> FormatId {
                FormatId::new($format)
            }

            fn build_evidence(
                &self,
                request: EvidenceBuildRequest,
            ) -> EvidenceFuture<'_, EvidenceBuildOutput> {
                EvidenceBuilder::build(self, request)
            }

            fn build_facts(&self, request: FactBuildRequest) -> FactFuture<'_, FactBuildOutput> {
                FactBuilder::build(self, request)
            }
        }
    };
}

impl_processor!(MarkdownProcessor, "markdown");
impl_processor!(TypeScriptProcessor, "typescript");

#[derive(Clone, Default)]
pub struct ProcessorRegistry {
    processors: BTreeMap<FormatId, Arc<dyn Processor>>,
    structure_parsers: StructureParserRegistry,
}

impl ProcessorRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_defaults() -> Self {
        let mut registry = Self::new();
        registry.register(Arc::new(MarkdownProcessor::new()));
        registry.register(Arc::new(TypeScriptProcessor::new()));
        let _ = registry
            .structure_parsers
            .register(Arc::new(MarkdownStructureParserFactory::new()));
        let _ = registry
            .structure_parsers
            .register(Arc::new(TypeScriptStructureParserFactory::new()));
        registry
    }

    pub fn register(&mut self, processor: Arc<dyn Processor>) {
        self.processors
            .insert(processor.normalized_format(), processor);
    }

    pub fn get(&self, format: &FormatId) -> Option<Arc<dyn Processor>> {
        self.processors.get(format).cloned()
    }

    pub fn structure_parsers(&self) -> &StructureParserRegistry {
        &self.structure_parsers
    }

    pub fn register_structure_parser(
        &mut self,
        factory: Arc<dyn StructureParserFactory>,
    ) -> StructureParserResult<()> {
        self.structure_parsers.register(factory)
    }
}
