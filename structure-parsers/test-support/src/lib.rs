//! Reusable test hosts for Structure Parser contract tests.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use context_structure::StructureCancellation;
use context_structure::StructureParseProgress;
use context_structure::StructureParserResult;
use context_structure::StructureProgressReporter;

pub fn normalized_source(
    extension: &str,
    format: &str,
    media_type: &str,
) -> context_source::NormalizedSource {
    use agent_file_normalizer::AgentFileProfile;
    use agent_file_normalizer::ArtifactRole;
    use agent_file_normalizer::FormatId;
    use agent_file_normalizer::RetrievalProfile;
    use agent_file_normalizer::ToolSupport;
    use context_protocol::ArtifactRef;
    use context_protocol::EntityRef;
    use context_protocol::Freshness;
    use context_protocol::Layer;
    use context_protocol::ProducerRef;
    use context_protocol::RevisionRef;

    let source = RevisionRef::new(
        EntityRef::new(Layer::Source, "source:test:file"),
        "source-v1",
    );
    let normalized = RevisionRef::new(
        EntityRef::new(Layer::Source, "normalized:test:file"),
        "normalized-v1",
    );
    context_source::NormalizedSource {
        revision_ref: normalized,
        source_snapshot: source,
        normalizer_id: "test-normalizer".to_owned(),
        media_type: media_type.to_owned(),
        format: FormatId::new(format),
        extension: extension.to_owned(),
        agent: AgentFileProfile {
            retrieval: RetrievalProfile::SourceCode,
            tools: ToolSupport::shell_text(),
        },
        primary: context_source::NormalizedArtifact {
            artifact: ArtifactRef::new(
                "artifact:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
            role: ArtifactRole::Primary,
            relative_path: Some(format!("fixture.{extension}")),
            media_type: media_type.to_owned(),
            format: Some(FormatId::new(format)),
            extension: Some(extension.to_owned()),
            content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                .to_owned(),
            size_bytes: 0,
        },
        companions: Vec::new(),
        locator_map: None,
        projection_policy: context_source::ProjectionPolicy::Copy,
        normalizer: ProducerRef {
            name: "test-normalizer".to_owned(),
            version: "1".to_owned(),
            config_hash: "default".to_owned(),
        },
        diagnostics: Vec::new(),
        freshness: Freshness::Current,
    }
}

#[derive(Clone, Default)]
pub struct TestStructureCancellation {
    cancelled: Arc<AtomicBool>,
}

impl TestStructureCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
}

impl StructureCancellation for TestStructureCancellation {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Clone, Default)]
pub struct ProgressCollector {
    events: Arc<Mutex<Vec<StructureParseProgress>>>,
}

impl ProgressCollector {
    pub fn events(&self) -> Vec<StructureParseProgress> {
        self.events
            .lock()
            .map(|events| events.clone())
            .unwrap_or_default()
    }

    pub fn is_monotonic(&self) -> bool {
        self.events()
            .windows(2)
            .all(|pair| pair[0].completed <= pair[1].completed)
    }
}

impl StructureProgressReporter for ProgressCollector {
    fn report(&self, progress: StructureParseProgress) -> StructureParserResult<()> {
        if let Ok(mut events) = self.events.lock() {
            events.push(progress);
        }
        Ok(())
    }
}
