use agent_file_normalizer::AgentFileProfile;
use agent_file_normalizer::FormatId;
use agent_file_normalizer::InputMatcher;
use agent_file_normalizer::NORMALIZER_PROTOCOL_VERSION;
use agent_file_normalizer::NormalizedFormat;
use agent_file_normalizer::NormalizerCapabilities;
use agent_file_normalizer::NormalizerDescriptor;
use agent_file_normalizer::RetrievalProfile;
use agent_file_normalizer::ToolSupport;
use context_config::ContextConfig;
use context_config::NormalizationPolicy;
use context_config::NormalizationRule;
use context_config::PathNormalizationOverride;
use context_config::RouteInput;

fn mapping(id: &str, output: &str, priority: i32) -> NormalizerDescriptor {
    NormalizerDescriptor {
        protocol_version: NORMALIZER_PROTOCOL_VERSION,
        id: id.to_owned(),
        display_name: id.to_owned(),
        implementation_version: "1".to_owned(),
        inputs: vec![InputMatcher {
            format: FormatId::new("pdf"),
            media_types: vec!["application/pdf".to_owned()],
            extensions: vec!["pdf".to_owned()],
            magic_prefixes: Vec::new(),
        }],
        output: NormalizedFormat {
            format: FormatId::new(output),
            media_type: format!("text/{output}"),
            extension: output.to_owned(),
            agent: AgentFileProfile {
                retrieval: RetrievalProfile::RichDocument,
                tools: ToolSupport::rich_document(),
            },
        },
        capabilities: NormalizerCapabilities::default(),
        default_priority: priority,
    }
}

#[test]
fn path_override_beats_workspace_default() -> Result<(), Box<dyn std::error::Error>> {
    let config = ContextConfig {
        schema_version: 2,
        sources: Vec::new(),
        source_trash: Vec::new(),
        normalization: NormalizationPolicy {
            defaults: vec![NormalizationRule {
                id: "pdf-md".to_owned(),
                normalizer_id: "pdf-to-markdown".to_owned(),
                enabled: true,
                extensions: vec!["pdf".to_owned()],
                media_types: Vec::new(),
                priority: 100,
                config: serde_json::json!({}),
            }],
            source_overrides: Vec::new(),
            path_overrides: vec![PathNormalizationOverride {
                id: "reports".to_owned(),
                source_id: None,
                globs: vec!["reports/**".to_owned()],
                rule: NormalizationRule {
                    id: "reports-html".to_owned(),
                    normalizer_id: "pdf-to-html".to_owned(),
                    enabled: true,
                    extensions: vec!["pdf".to_owned()],
                    media_types: Vec::new(),
                    priority: 1,
                    config: serde_json::json!({}),
                },
            }],
        },
        structure: context_config::StructurePolicy::default(),
    };
    let route = config
        .resolve_route(
            RouteInput {
                source_id: "docs",
                path: "reports/q1.pdf",
                extension: Some("pdf"),
                media_type: Some("application/pdf"),
            },
            &[
                mapping("pdf-to-markdown", "markdown", 100),
                mapping("pdf-to-html", "html", 90),
            ],
        )?
        .ok_or("missing route")?;
    assert_eq!(route.normalizer_id, "pdf-to-html");
    Ok(())
}
