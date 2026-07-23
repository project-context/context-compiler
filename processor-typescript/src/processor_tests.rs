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
async fn extracts_symbol_and_condition_with_byte_locations()
-> Result<(), Box<dyn std::error::Error>> {
    let source = RevisionRef::new(EntityRef::new(Layer::Source, "refund.ts"), "r1");
    let content = "function refund(days: number) { if (days <= 7) return true; }";
    let processor = TypeScriptProcessor::new();
    let output = StructureBuilder::build(
        &processor,
        StructureBuildRequest {
            normalized: NormalizedSource {
                revision_ref: RevisionRef::new(source.entity.clone(), "normalized:r1"),
                source_snapshot: source,
                normalizer_id: "typescript-to-typescript".to_owned(),
                media_type: "text/typescript".to_owned(),
                format: FormatId::new("typescript"),
                extension: "ts".to_owned(),
                agent: AgentFileProfile {
                    retrieval: RetrievalProfile::SourceCode,
                    tools: ToolSupport::shell_text(),
                },
                primary: NormalizedArtifact {
                    artifact: ArtifactRef::new("artifact:sha256:test"),
                    role: ArtifactRole::Primary,
                    relative_path: None,
                    media_type: "text/typescript".to_owned(),
                    format: Some(FormatId::new("typescript")),
                    extension: Some("ts".to_owned()),
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
        unit.kind == StructureKind::Function && unit.stable_key == "symbol:refund"
    }));
    assert!(
        output
            .units
            .iter()
            .any(|unit| unit.kind == StructureKind::Condition)
    );
    Ok(())
}
