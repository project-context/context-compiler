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
use context_structure::StructureBuildRequest;
use context_structure::StructureBuilder;
use context_structure::StructureKind;

use super::*;

#[tokio::test]
async fn heading_paths_are_stable_structure_keys() -> Result<(), Box<dyn std::error::Error>> {
    let source = RevisionRef::new(EntityRef::new(Layer::Source, "refund.md"), "r1");
    let normalized_ref = RevisionRef::new(source.entity.clone(), "normalized:r1");
    let content = "# 退款\n\n## 地区 A\n\n退款必须在 7 天内完成。\n";
    let processor = MarkdownProcessor::new();
    let output = StructureBuilder::build(
        &processor,
        StructureBuildRequest {
            normalized: NormalizedSource {
                revision_ref: normalized_ref,
                source_snapshot: source,
                normalizer_id: "markdown-to-markdown".to_owned(),
                media_type: "text/markdown".to_owned(),
                format: FormatId::new("markdown"),
                extension: "md".to_owned(),
                agent: AgentFileProfile {
                    retrieval: RetrievalProfile::Prose,
                    tools: ToolSupport::shell_text(),
                },
                primary: NormalizedArtifact {
                    artifact: ArtifactRef::new("artifact:sha256:test"),
                    role: ArtifactRole::Primary,
                    relative_path: None,
                    media_type: "text/markdown".to_owned(),
                    format: Some(FormatId::new("markdown")),
                    extension: Some("md".to_owned()),
                    content_hash: "hash".to_owned(),
                    size_bytes: content.len() as u64,
                },
                companions: Vec::new(),
                locator_map: None,
                projection_policy: ProjectionPolicy::Normalize,
                normalizer: ProducerRef {
                    name: "test".to_owned(),
                    version: "1".to_owned(),
                    config_hash: "test".to_owned(),
                },
                diagnostics: Vec::new(),
                freshness: Freshness::Current,
            },
            content: content.to_owned(),
            previous: Vec::new(),
        },
    )
    .await?;

    assert!(output.units.iter().any(|unit| {
        unit.kind == StructureKind::Heading && unit.stable_key == "退款/地区-a"
    }));
    assert!(
        output
            .units
            .iter()
            .any(|unit| unit.stable_key == "退款/地区-a/paragraph")
    );
    Ok(())
}
