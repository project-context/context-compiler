use std::sync::Arc;

use context_protocol::ArtifactRef;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::ProducerRef;
use context_protocol::RevisionRef;
use context_source::AgentFileProfile;
use context_source::ArtifactRole;
use context_source::FormatId;
use context_source::NormalizedArtifact;
use context_source::NormalizedSource;
use context_source::ProjectionPolicy;
use context_source::RetrievalProfile;
use context_source::ToolSupport;
use context_structure::BytesStructureInputSource;
use context_structure::StructureCancellation;
use context_structure::StructureFileFamily;
use context_structure::StructureInputMatcher;
use context_structure::StructureKind;
use context_structure::StructureNoProgress;
use context_structure::StructureParseContext;
use context_structure::StructureParseReport;
use context_structure::StructureParseRequest;
use context_structure::StructureParseStatistics;
use context_structure::StructureParser;
use context_structure::StructureParserCapabilities;
use context_structure::StructureParserDescriptor;
use context_structure::StructureParserFactory;
use context_structure::StructureParserFuture;
use context_structure::StructureParserId;
use context_structure::StructureParserRegistry;
use context_structure::StructureParserResult;
use context_structure::StructureRelationType;
use context_structure::StructureResourceLimits;
use context_structure::read_structure_input;
use context_structure::structure_config_hash;
use pretty_assertions::assert_eq;

struct TestFactory {
    descriptor: StructureParserDescriptor,
    schema: serde_json::Value,
}

impl TestFactory {
    fn new(id: &str) -> Self {
        Self {
            descriptor: StructureParserDescriptor {
                protocol_version: 1,
                id: StructureParserId::new(id),
                display_name: "Test Parser".to_owned(),
                implementation_version: "1.0.0".to_owned(),
                inputs: vec![StructureInputMatcher {
                    formats: vec![FormatId::new("typescript")],
                    media_types: vec!["text/typescript".to_owned()],
                    extensions: vec!["ts".to_owned()],
                    families: vec![StructureFileFamily::Code],
                }],
                capabilities: StructureParserCapabilities::default(),
                default_priority: 10,
            },
            schema: serde_json::json!({"type": "object", "additionalProperties": false}),
        }
    }
}

impl StructureParserFactory for TestFactory {
    fn descriptor(&self) -> &StructureParserDescriptor {
        &self.descriptor
    }

    fn config_schema(&self) -> &serde_json::Value {
        &self.schema
    }

    fn validate_config(&self, config: &serde_json::Value) -> StructureParserResult<()> {
        if config.is_object() {
            Ok(())
        } else {
            Err(context_structure::StructureParserError::InvalidConfig(
                "expected an object".to_owned(),
            ))
        }
    }

    fn create(
        &self,
        config: &serde_json::Value,
    ) -> StructureParserResult<Arc<dyn StructureParser>> {
        self.validate_config(config)?;
        Ok(Arc::new(TestParser {
            descriptor: self.descriptor.clone(),
        }))
    }
}

struct TestParser {
    descriptor: StructureParserDescriptor,
}

impl StructureParser for TestParser {
    fn descriptor(&self) -> &StructureParserDescriptor {
        &self.descriptor
    }

    fn parse<'a>(
        &'a self,
        request: StructureParseRequest<'a>,
        context: StructureParseContext<'a>,
    ) -> StructureParserFuture<'a, StructureParseReport> {
        Box::pin(async move {
            let bytes = read_structure_input(request.input, &context).await?;
            Ok(StructureParseReport {
                units: Vec::new(),
                relations: Vec::new(),
                internal_structure: b"{}".to_vec(),
                diagnostics: Vec::new(),
                statistics: StructureParseStatistics {
                    input_bytes: bytes.len() as u64,
                    unit_count: 0,
                    relation_count: 0,
                },
            })
        })
    }
}

struct Cancelled;

impl StructureCancellation for Cancelled {
    fn is_cancelled(&self) -> bool {
        true
    }
}

#[test]
fn registry_rejects_duplicate_ids_and_hashes_canonical_config()
-> Result<(), Box<dyn std::error::Error>> {
    let mut registry = StructureParserRegistry::new();
    registry.register(Arc::new(TestFactory::new("test-parser")))?;
    assert!(
        registry
            .register(Arc::new(TestFactory::new("test-parser")))
            .is_err()
    );
    let left_hash = structure_config_hash(&serde_json::json!({"b": 2, "a": 1}))?;
    let right_hash = structure_config_hash(&serde_json::json!({"a": 1, "b": 2}))?;
    assert_eq!(left_hash, right_hash);
    Ok(())
}

#[test]
fn kinds_relations_and_file_families_remain_extensible() -> Result<(), Box<dyn std::error::Error>> {
    let custom_kind = StructureKind::new("graphql_operation");
    let custom_relation = StructureRelationType::new("references_fragment");
    assert_eq!(serde_json::to_value(custom_kind)?, "graphql_operation");
    assert_eq!(
        serde_json::to_value(custom_relation)?,
        "references_fragment"
    );
    assert_eq!(
        StructureFileFamily::ordered(),
        &[
            StructureFileFamily::Code,
            StructureFileFamily::Document,
            StructureFileFamily::MarkupStyle,
            StructureFileFamily::StructuredData,
            StructureFileFamily::Tabular,
            StructureFileFamily::RichDocument,
            StructureFileFamily::Other,
        ]
    );
    assert_eq!(
        StructureFileFamily::infer(&normalized("tsx")),
        StructureFileFamily::Code
    );
    Ok(())
}

#[tokio::test]
async fn parser_contract_enforces_cancellation_and_input_limits()
-> Result<(), Box<dyn std::error::Error>> {
    let source = BytesStructureInputSource::new("let value = 1;");
    let normal = normalized("ts");
    let parser = TestFactory::new("test-parser").create(&serde_json::json!({}))?;
    let cancelled = parser
        .parse(
            StructureParseRequest {
                normalized: &normal,
                input: &source,
            },
            StructureParseContext {
                progress: &StructureNoProgress,
                cancellation: &Cancelled,
                limits: StructureResourceLimits::default(),
            },
        )
        .await;
    assert!(matches!(
        cancelled,
        Err(context_structure::StructureParserError::Cancelled)
    ));

    let limited = parser
        .parse(
            StructureParseRequest {
                normalized: &normal,
                input: &source,
            },
            StructureParseContext {
                progress: &StructureNoProgress,
                cancellation: &context_structure::StructureNeverCancelled,
                limits: StructureResourceLimits {
                    max_input_bytes: 4,
                    chunk_size: 2,
                    ..StructureResourceLimits::default()
                },
            },
        )
        .await;
    assert!(matches!(
        limited,
        Err(context_structure::StructureParserError::ResourceLimit(_))
    ));
    Ok(())
}

fn normalized(extension: &str) -> NormalizedSource {
    let source = RevisionRef::new(EntityRef::new(Layer::Source, "source:test"), "source-v1");
    let revision_ref = RevisionRef::new(
        EntityRef::new(Layer::Source, "normalized:test"),
        "normalized-v1",
    );
    let artifact = ArtifactRef::new(
        "artifact:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    NormalizedSource {
        revision_ref,
        source_snapshot: source,
        normalizer_id: "identity".to_owned(),
        media_type: "text/typescript".to_owned(),
        format: FormatId::new("typescript"),
        extension: extension.to_owned(),
        agent: AgentFileProfile {
            retrieval: RetrievalProfile::SourceCode,
            tools: ToolSupport::shell_text(),
        },
        primary: NormalizedArtifact {
            artifact,
            role: ArtifactRole::Primary,
            relative_path: Some(format!("fixture.{extension}")),
            media_type: "text/typescript".to_owned(),
            format: Some(FormatId::new("typescript")),
            extension: Some(extension.to_owned()),
            content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                .to_owned(),
            size_bytes: 14,
        },
        companions: Vec::new(),
        locator_map: None,
        projection_policy: ProjectionPolicy::Copy,
        normalizer: ProducerRef {
            name: "identity".to_owned(),
            version: "1".to_owned(),
            config_hash: "default".to_owned(),
        },
        diagnostics: Vec::new(),
        freshness: Freshness::Current,
    }
}
