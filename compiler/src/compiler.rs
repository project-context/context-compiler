use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::path::Component;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;

use agent_file_normalizer::ArtifactRole;
use agent_file_normalizer::ArtifactSpecification;
use agent_file_normalizer::Cancellation;
use agent_file_normalizer::NormalizerError;
use agent_file_normalizer::ProgressReporter;
use agent_file_normalizer::ResourceLimits;
use agent_file_normalizer_html::HtmlNormalizer;
use agent_file_normalizer_markdown::MarkdownNormalizer;
use agent_file_normalizer_pdf_html::PdfToHtmlNormalizer;
use agent_file_normalizer_pdf_markdown::PdfToMarkdownNormalizer;
use agent_file_normalizer_text_markdown::TextToMarkdownNormalizer;
use agent_file_normalizer_typescript::TypeScriptNormalizer;
use context_config::ConfigError;
use context_config::ConfigRepository;
use context_config::ContextConfig;
use context_config::RouteInput;
use context_config::StructurePolicy;
use context_evidence::EvidenceBuildRequest;
use context_evidence::EvidenceStore;
use context_fact::FactBuildRequest;
use context_fact::FactKind;
use context_fact::FactRevision;
use context_fact::FactStore;
use context_protocol::AccessStatus;
use context_protocol::ArtifactRef;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::PageRequest;
use context_protocol::ProducerRef;
use context_protocol::ReviewStatus;
use context_protocol::RevisionMode;
use context_protocol::RevisionRef;
use context_protocol::Trace;
use context_scope::ScopeStore;
use context_semantic::SemanticEdge;
use context_semantic::SemanticRelation;
use context_semantic::SemanticStore;
use context_source::CapturedSource;
use context_source::LocalSourceConnector;
use context_source::NormalizationCandidate;
use context_source::NormalizationConfig;
use context_source::NormalizedSource;
use context_source::NormalizedSourceQuery;
use context_source::NormalizerRegistry;
use context_source::SourceCatalogReader;
use context_source::SourceRecord;
use context_source::SourceStore;
use context_structure::BytesStructureInputSource;
use context_structure::StructureBuildRecord;
use context_structure::StructureCommit;
use context_structure::StructureKind;
use context_structure::StructureParseContext;
use context_structure::StructureParseProgress;
use context_structure::StructureParseRequest;
use context_structure::StructureProgressReporter;
use context_structure::StructureRelationRecord;
use context_structure::StructureRelationType;
use context_structure::StructureResourceLimits;
use context_structure::StructureStore;
use context_structure::StructureUnit;
use context_workspace::ArtifactRepository;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use sha2::Digest;
use sha2::Sha256;
use thiserror::Error;

use crate::ProcessorRegistry;

pub trait CompileStore:
    SourceStore
    + SourceCatalogReader
    + StructureStore
    + EvidenceStore
    + FactStore
    + ScopeStore
    + SemanticStore
    + Send
    + Sync
{
}

impl<T> CompileStore for T where
    T: SourceStore
        + SourceCatalogReader
        + StructureStore
        + EvidenceStore
        + FactStore
        + ScopeStore
        + SemanticStore
        + Send
        + Sync
{
}

struct ProgressBridge<'a, F> {
    state: Mutex<ProgressBridgeState<'a, F>>,
}

struct ProgressBridgeState<'a, F> {
    report: &'a mut F,
    total_files: usize,
    built: usize,
    skipped: usize,
    work_base: usize,
    file_work: usize,
    work_total: usize,
    last_file_work: usize,
    source_uri: String,
    normalizer_id: String,
    cancelled: bool,
}

impl<'a, F> ProgressBridge<'a, F>
where
    F: FnMut(NormalizationProgress) -> bool + Send,
{
    #[allow(clippy::too_many_arguments)]
    fn new(
        report: &'a mut F,
        total_files: usize,
        built: usize,
        skipped: usize,
        work_base: usize,
        file_work: usize,
        work_total: usize,
        source_uri: String,
        normalizer_id: String,
    ) -> Self {
        Self {
            state: Mutex::new(ProgressBridgeState {
                report,
                total_files,
                built,
                skipped,
                work_base,
                file_work,
                work_total,
                last_file_work: 0,
                source_uri,
                normalizer_id,
                cancelled: false,
            }),
        }
    }
}

impl<F> ProgressReporter for ProgressBridge<'_, F>
where
    F: FnMut(NormalizationProgress) -> bool + Send,
{
    fn report(
        &self,
        progress: agent_file_normalizer::NormalizationProgress,
    ) -> Result<(), NormalizerError> {
        let mut state = self.state.lock().map_err(|_| {
            NormalizerError::new(
                agent_file_normalizer::NormalizerErrorCode::INTERNAL,
                agent_file_normalizer::NormalizerErrorCategory::Internal,
                "normalization progress lock is poisoned",
            )
        })?;
        let denominator = progress.total.unwrap_or(1).max(1);
        let ratio_numerator = progress.completed.min(denominator);
        let raw = if progress.phase.as_str() == "read_input" {
            // Reading is at most the first quarter. This prevents PDF page
            // extraction from appearing complete immediately after I/O.
            (state.file_work / 4)
                .saturating_mul(usize::try_from(ratio_numerator).unwrap_or(usize::MAX))
                / usize::try_from(denominator).unwrap_or(usize::MAX).max(1)
        } else {
            let prefix = state.file_work / 4;
            prefix.saturating_add(
                state
                    .file_work
                    .saturating_sub(prefix)
                    .saturating_mul(usize::try_from(ratio_numerator).unwrap_or(usize::MAX))
                    / usize::try_from(denominator).unwrap_or(usize::MAX).max(1),
            )
        };
        state.last_file_work = state.last_file_work.max(raw.min(state.file_work));
        let event = NormalizationProgress {
            processed: state.built + state.skipped,
            total: state.total_files,
            work_processed: state.work_base.saturating_add(state.last_file_work),
            work_total: state.work_total,
            built: state.built,
            skipped: state.skipped,
            source_uri: state.source_uri.clone(),
            normalizer_id: state.normalizer_id.clone(),
            reused: false,
            phase: progress.phase.to_string(),
            message: progress.message,
            file_completed: false,
        };
        if !(state.report)(event) {
            state.cancelled = true;
            return Err(NormalizerError::cancelled());
        }
        Ok(())
    }
}

impl<F> Cancellation for ProgressBridge<'_, F>
where
    F: FnMut(NormalizationProgress) -> bool + Send,
{
    fn is_cancelled(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.cancelled)
            .unwrap_or(true)
    }
}

struct StructureProgressBridge<'a, F> {
    state: Mutex<StructureProgressBridgeState<'a, F>>,
}

struct StructureProgressBridgeState<'a, F> {
    report: &'a mut F,
    total_files: usize,
    processed: usize,
    built: usize,
    reused: usize,
    failed: usize,
    work_base: u64,
    file_work: u64,
    work_total: u64,
    last_file_work: u64,
    source_uri: String,
    parser_id: String,
    cancelled: bool,
}

impl<'a, F> StructureProgressBridge<'a, F>
where
    F: FnMut(StructureProgress) -> bool + Send,
{
    #[allow(clippy::too_many_arguments)]
    fn new(
        report: &'a mut F,
        total_files: usize,
        processed: usize,
        built: usize,
        reused: usize,
        failed: usize,
        work_base: u64,
        file_work: u64,
        work_total: u64,
        source_uri: String,
        parser_id: String,
    ) -> Self {
        Self {
            state: Mutex::new(StructureProgressBridgeState {
                report,
                total_files,
                processed,
                built,
                reused,
                failed,
                work_base,
                file_work,
                work_total,
                last_file_work: 0,
                source_uri,
                parser_id,
                cancelled: false,
            }),
        }
    }
}

impl<F> StructureProgressReporter for StructureProgressBridge<'_, F>
where
    F: FnMut(StructureProgress) -> bool + Send,
{
    fn report(
        &self,
        progress: StructureParseProgress,
    ) -> context_structure::StructureParserResult<()> {
        let mut state = self.state.lock().map_err(|_| {
            context_structure::StructureParserError::Parse(
                "structure progress lock is poisoned".to_owned(),
            )
        })?;
        let total = progress.total.unwrap_or(state.file_work).max(1);
        let current = state
            .file_work
            .saturating_mul(progress.completed.min(total))
            / total;
        let current = current.min(state.file_work.saturating_sub(1));
        state.last_file_work = state.last_file_work.max(current.min(state.file_work));
        let event = StructureProgress {
            processed: state.processed,
            total: state.total_files,
            work_processed: state.work_base.saturating_add(state.last_file_work),
            work_total: state.work_total,
            built: state.built,
            reused: state.reused,
            failed: state.failed,
            source_uri: state.source_uri.clone(),
            parser_id: state.parser_id.clone(),
            phase: progress.phase,
            message: progress.message,
            generated_units: progress.generated_units,
            file_completed: false,
        };
        if !(state.report)(event) {
            state.cancelled = true;
            return Err(context_structure::StructureParserError::Cancelled);
        }
        Ok(())
    }
}

impl<F> context_structure::StructureCancellation for StructureProgressBridge<'_, F>
where
    F: FnMut(StructureProgress) -> bool + Send,
{
    fn is_cancelled(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.cancelled)
            .unwrap_or(true)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BuildOptions {
    pub full: bool,
    pub portable: bool,
    pub no_agent: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub source: RevisionRef,
    pub skipped: bool,
    pub structures: usize,
    pub evidence: usize,
    pub facts: usize,
    pub semantic_edges: usize,
    pub stale_revisions: usize,
    pub diagnostics: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompileSummary {
    pub sources: Vec<CompileResult>,
    pub built: usize,
    pub skipped: usize,
    pub failed_sources: usize,
    pub facts: usize,
    pub semantic_edges: usize,
    pub stale_revisions: usize,
    pub diagnostics: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizationProgress {
    /// Fully committed files. This remains a file count for status copy.
    pub processed: usize,
    pub total: usize,
    /// Confirmed fine-grained work checkpoints used by the progress bar.
    pub work_processed: usize,
    pub work_total: usize,
    pub built: usize,
    pub skipped: usize,
    pub source_uri: String,
    pub normalizer_id: String,
    pub reused: bool,
    pub phase: String,
    pub message: Option<String>,
    pub file_completed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StructureProgress {
    pub processed: usize,
    pub total: usize,
    pub work_processed: u64,
    pub work_total: u64,
    pub built: usize,
    pub reused: usize,
    pub failed: usize,
    pub source_uri: String,
    pub parser_id: String,
    pub phase: String,
    pub message: Option<String>,
    pub generated_units: u64,
    pub file_completed: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionManifest {
    #[serde(default)]
    paths: BTreeMap<String, String>,
}

#[derive(Debug, Error)]
pub enum CompileError {
    #[error("Compilation cancelled")]
    Cancelled,
    #[error("Workspace configuration failed: {0}")]
    Config(#[from] ConfigError),
    #[error("Source layer failed: {0}")]
    Source(#[from] context_source::SourceError),
    #[error("Structure layer failed: {0}")]
    Structure(#[from] context_structure::StructureError),
    #[error("Structure parser failed: {0}")]
    StructureParser(#[from] context_structure::StructureParserError),
    #[error("Evidence layer failed: {0}")]
    Evidence(#[from] context_evidence::EvidenceError),
    #[error("Fact layer failed: {0}")]
    Fact(#[from] context_fact::FactError),
    #[error("Scope layer failed: {0}")]
    Scope(#[from] context_scope::ScopeError),
    #[error("Semantic layer failed: {0}")]
    Semantic(#[from] context_semantic::SemanticError),
    #[error("Source projection failed: {0}")]
    Projection(String),
    #[error("Artifact repository failed: {0}")]
    Artifact(#[from] context_workspace::WorkspaceError),
}

pub struct Compiler<S> {
    store: S,
    registry: ProcessorRegistry,
    normalizers: NormalizerRegistry,
    artifacts: Arc<dyn ArtifactRepository>,
}

impl<S: CompileStore> Compiler<S> {
    pub fn new(
        store: S,
        registry: ProcessorRegistry,
        artifacts: Arc<dyn ArtifactRepository>,
    ) -> Self {
        Self {
            store,
            registry,
            normalizers: default_normalizer_registry(),
            artifacts,
        }
    }

    pub fn with_registries(
        store: S,
        registry: ProcessorRegistry,
        normalizers: NormalizerRegistry,
        artifacts: Arc<dyn ArtifactRepository>,
    ) -> Self {
        Self {
            store,
            registry,
            normalizers,
            artifacts,
        }
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn normalizers(&self) -> &NormalizerRegistry {
        &self.normalizers
    }

    async fn resolve_structure_text(
        &self,
        structure: &StructureUnit,
    ) -> Result<String, CompileError> {
        match &structure.locator {
            context_protocol::Locator::ByteRange {
                artifact,
                start,
                end,
            } => {
                let bytes = self.artifacts.read(artifact).await?;
                let start = usize::try_from(*start)
                    .unwrap_or(usize::MAX)
                    .min(bytes.len());
                let end = usize::try_from(*end).unwrap_or(usize::MAX).min(bytes.len());
                if start > end {
                    return Err(CompileError::Projection(format!(
                        "invalid Structure locator range: {start}..{end}"
                    )));
                }
                String::from_utf8(bytes[start..end].to_vec()).map_err(|error| {
                    CompileError::Projection(format!(
                        "Structure locator does not resolve to UTF-8 text: {error}"
                    ))
                })
            }
            _ => Ok(structure.text.clone()),
        }
    }

    async fn current_normalized_workload(&self) -> Result<(usize, u64), CompileError> {
        let mut total = 0_usize;
        let mut work_total = 0_u64;
        let mut cursor = None;
        loop {
            let page = self
                .store
                .page_normalized(NormalizedSourceQuery {
                    page: PageRequest {
                        cursor: cursor.clone(),
                        limit: Some(200),
                    },
                    format: None,
                    freshness: Some(Freshness::Current),
                    normalizer_id: None,
                    revision_mode: RevisionMode::Current,
                })
                .await?;
            total = total.saturating_add(page.items.len());
            work_total = work_total.saturating_add(
                page.items
                    .iter()
                    .map(|source| source.primary.size_bytes.max(1))
                    .sum::<u64>(),
            );
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        Ok((total, work_total.max(1)))
    }

    /// Persists the Source layer only. Later stages deliberately remain
    /// untouched so management hosts can run one pipeline node in isolation.
    pub async fn capture_stage(&self, sources: &[CapturedSource]) -> Result<usize, CompileError> {
        self.capture_stage_inner(sources, None).await
    }

    /// Persists only the selected Connector sources. Missing-file detection is
    /// restricted to those sources so a one-source sync cannot stale records
    /// owned by another configured Connector.
    pub async fn capture_stage_for_sources(
        &self,
        sources: &[CapturedSource],
        source_ids: &BTreeSet<String>,
    ) -> Result<usize, CompileError> {
        self.capture_stage_inner(sources, Some(source_ids)).await
    }

    async fn capture_stage_inner(
        &self,
        sources: &[CapturedSource],
        source_ids: Option<&BTreeSet<String>>,
    ) -> Result<usize, CompileError> {
        let active_sources = sources
            .iter()
            .map(|source| source.record.entity_ref.clone())
            .collect::<BTreeSet<_>>();
        let mut stale_revisions = 0;
        for source in sources {
            if let Some(previous) = self.store.get_source(&source.record.entity_ref).await?
                && previous.current_snapshot != source.snapshot.revision_ref
            {
                stale_revisions += self.invalidate_source(&previous.current_snapshot).await?;
            }
            self.store.put_snapshot(source.snapshot.clone()).await?;
            self.store.put_source(source.record.clone()).await?;
        }
        stale_revisions += match source_ids {
            Some(source_ids) => {
                self.mark_missing_sources_for(&active_sources, source_ids)
                    .await?
            }
            None => self.mark_missing_sources(&active_sources).await?,
        };
        Ok(stale_revisions)
    }

    /// Produces NormalizedSource revisions without invoking a Processor.
    pub async fn normalize_stage(
        &self,
        sources: &[CapturedSource],
        full: bool,
    ) -> Result<(usize, usize, usize, Vec<String>), CompileError> {
        self.normalize_stage_with_progress(sources, full, |_| true)
            .await
    }

    pub async fn normalize_stage_with_progress<F>(
        &self,
        sources: &[CapturedSource],
        full: bool,
        mut report: F,
    ) -> Result<(usize, usize, usize, Vec<String>), CompileError>
    where
        F: FnMut(NormalizationProgress) -> bool + Send,
    {
        let mut built = 0;
        let mut skipped = 0;
        let mut stale_revisions = 0;
        let mut diagnostics = Vec::new();
        let total = sources.len();
        let mut work = Vec::with_capacity(sources.len());
        for source in sources {
            let probe = self
                .normalizers
                .probe(
                    &source.normalizer_id,
                    &source.normalizer_config,
                    &source.record,
                    source.bytes.clone(),
                )
                .await?;
            if !probe.supported {
                return Err(
                    context_source::SourceError::Unsupported(source.record.uri.clone()).into(),
                );
            }
            let estimated = probe.work.total.unwrap_or(1).max(1);
            work.push(usize::try_from(estimated).unwrap_or(usize::MAX - 1));
        }
        // One final unit per file is reserved for committing its artifacts and
        // canonical record, so 100% always means that the file is durable.
        let work_total = work.iter().fold(0_usize, |sum, value| {
            sum.saturating_add(*value).saturating_add(1)
        });
        let mut work_base = 0_usize;
        for (source, file_work) in sources.iter().zip(work) {
            let existing = self.store.get_source(&source.record.entity_ref).await?;
            let mapping = self
                .normalizers
                .descriptor(&source.normalizer_id)
                .ok_or_else(|| {
                    context_source::SourceError::Configuration(format!(
                        "normalizer is not registered: {}",
                        source.normalizer_id
                    ))
                })?;
            let producer = self
                .normalizers
                .producer_ref(&source.normalizer_id, &source.normalizer_config)?;
            let normalized = self.store.list_normalized().await?;
            let same_snapshot = existing
                .as_ref()
                .is_some_and(|value| value.current_snapshot == source.snapshot.revision_ref);
            let mapping_current = same_snapshot
                && normalized.iter().any(|value| {
                    value.source_snapshot == source.snapshot.revision_ref
                        && value.normalizer_id == source.normalizer_id
                });
            let producer_current = mapping_current
                && normalized.iter().any(|value| {
                    value.source_snapshot == source.snapshot.revision_ref
                        && value.normalizer_id == source.normalizer_id
                        && value.normalizer == producer
                });
            let format_current = producer_current
                && normalized.iter().any(|value| {
                    value.source_snapshot == source.snapshot.revision_ref
                        && value.normalizer_id == source.normalizer_id
                        && value.normalizer == producer
                        && value.format == mapping.output.format
                        && value.media_type == mapping.output.media_type
                        && value.extension == mapping.output.extension
                });
            let agent_profile_current = format_current
                && normalized.iter().any(|value| {
                    value.source_snapshot == source.snapshot.revision_ref
                        && value.normalizer_id == source.normalizer_id
                        && value.normalizer == producer
                        && value.format == mapping.output.format
                        && value.media_type == mapping.output.media_type
                        && value.extension == mapping.output.extension
                        && value.agent == mapping.output.agent
                });
            let normalization_current = agent_profile_current
                && normalized.iter().any(|value| {
                    value.source_snapshot == source.snapshot.revision_ref
                        && value.normalizer_id == source.normalizer_id
                        && value.normalizer == producer
                        && value.format == mapping.output.format
                        && value.media_type == mapping.output.media_type
                        && value.extension == mapping.output.extension
                        && value.agent == mapping.output.agent
                        && value.freshness == Freshness::Current
                });
            if !full && normalization_current {
                skipped += 1;
                work_base = work_base.saturating_add(file_work).saturating_add(1);
                if !report(NormalizationProgress {
                    processed: built + skipped,
                    total,
                    work_processed: work_base,
                    work_total,
                    built,
                    skipped,
                    source_uri: source.record.uri.clone(),
                    normalizer_id: source.normalizer_id.clone(),
                    reused: true,
                    phase: "file_reused".to_owned(),
                    message: Some("reused committed artifact".to_owned()),
                    file_completed: true,
                }) {
                    return Err(CompileError::Cancelled);
                }
                continue;
            }

            let artifact_sink = self.artifacts.begin()?;
            let bridge = ProgressBridge::new(
                &mut report,
                total,
                built,
                skipped,
                work_base,
                file_work,
                work_total,
                source.record.uri.clone(),
                source.normalizer_id.clone(),
            );
            let normalized = self
                .normalizers
                .normalize(
                    &source.normalizer_id,
                    &source.normalizer_config,
                    source.record.clone(),
                    source.snapshot.clone(),
                    source.bytes.clone(),
                    artifact_sink.as_ref(),
                    self.artifacts.scratch(),
                    &bridge,
                    &bridge,
                    ResourceLimits::default(),
                )
                .await?;
            drop(bridge);
            if self.registry.get(&normalized.format).is_none() {
                diagnostics.push(format!(
                    "processor_missing: no processor is installed for normalized format {}",
                    normalized.format.as_str()
                ));
            }
            if let Some(previous) = existing.map(|value| value.current_snapshot) {
                stale_revisions += self.invalidate_source(&previous).await?;
            }
            self.store
                .commit_normalization(source.record.clone(), source.snapshot.clone(), normalized)
                .await?;
            built += 1;
            work_base = work_base.saturating_add(file_work).saturating_add(1);
            if !report(NormalizationProgress {
                processed: built + skipped,
                total,
                work_processed: work_base,
                work_total,
                built,
                skipped,
                source_uri: source.record.uri.clone(),
                normalizer_id: source.normalizer_id.clone(),
                reused: false,
                phase: "file_committed".to_owned(),
                message: Some("artifact and canonical record committed".to_owned()),
                file_completed: true,
            }) {
                return Err(CompileError::Cancelled);
            }
        }
        if full {
            self.store.mark_normalizer_rebuild_complete().await?;
        }
        Ok((built, skipped, stale_revisions, diagnostics))
    }

    pub async fn structure_stage(&self) -> Result<(usize, Vec<String>), CompileError> {
        self.structure_stage_with_progress(&StructurePolicy::default(), false, |_| true)
            .await
            .map(|(units, _, _, diagnostics)| (units, diagnostics))
    }

    pub async fn structure_stage_with_progress<F>(
        &self,
        policy: &StructurePolicy,
        full: bool,
        mut report_progress: F,
    ) -> Result<(usize, usize, usize, Vec<String>), CompileError>
    where
        F: FnMut(StructureProgress) -> bool + Send,
    {
        let (total, work_total) = self.current_normalized_workload().await?;
        let mut work_base = 0_u64;
        let mut built = 0_usize;
        let mut reused = 0_usize;
        let mut failed = 0_usize;
        let mut unit_count = 0_usize;
        let mut diagnostics = Vec::new();

        let mut cursor = None;
        loop {
            let page = self
                .store
                .page_normalized(NormalizedSourceQuery {
                    page: PageRequest {
                        cursor: cursor.clone(),
                        limit: Some(200),
                    },
                    format: None,
                    freshness: Some(Freshness::Current),
                    normalizer_id: None,
                    revision_mode: RevisionMode::Current,
                })
                .await?;
            let next_cursor = page.next_cursor;
            for source in page.items {
                let file_work = source.primary.size_bytes.max(1);
                let source_uri = source
                    .primary
                    .relative_path
                    .clone()
                    .unwrap_or_else(|| source.source_snapshot.entity.id.clone());
                let Some(route) = policy.route(&source.extension) else {
                    failed += 1;
                    diagnostics.push(format!(
                        "structure_parser_missing: no parser route for .{} ({source_uri})",
                        source.extension
                    ));
                    work_base = work_base.saturating_add(file_work);
                    if !report_progress(StructureProgress {
                        processed: built + reused + failed,
                        total,
                        work_processed: work_base,
                        work_total,
                        built,
                        reused,
                        failed,
                        source_uri,
                        parser_id: String::new(),
                        phase: "skipped".to_owned(),
                        message: Some("no compatible parser is configured".to_owned()),
                        generated_units: 0,
                        file_completed: true,
                    }) {
                        return Err(CompileError::Cancelled);
                    }
                    continue;
                };
                let configured = match self
                    .registry
                    .structure_parsers()
                    .create(&route.parser_id, &route.config)
                {
                    Ok(configured) if configured.parser.descriptor().supports(&source) => {
                        configured
                    }
                    Ok(_) => {
                        failed += 1;
                        let message = format!(
                            "structure_parser_incompatible: {} cannot parse .{}",
                            route.parser_id, source.extension
                        );
                        diagnostics.push(message.clone());
                        work_base = work_base.saturating_add(file_work);
                        if !report_progress(StructureProgress {
                            processed: built + reused + failed,
                            total,
                            work_processed: work_base,
                            work_total,
                            built,
                            reused,
                            failed,
                            source_uri,
                            parser_id: route.parser_id.clone(),
                            phase: "skipped".to_owned(),
                            message: Some(message),
                            generated_units: 0,
                            file_completed: true,
                        }) {
                            return Err(CompileError::Cancelled);
                        }
                        continue;
                    }
                    Err(error) => {
                        failed += 1;
                        let message = error.to_string();
                        diagnostics.push(format!("{source_uri}: {message}"));
                        work_base = work_base.saturating_add(file_work);
                        if !report_progress(StructureProgress {
                            processed: built + reused + failed,
                            total,
                            work_processed: work_base,
                            work_total,
                            built,
                            reused,
                            failed,
                            source_uri,
                            parser_id: route.parser_id.clone(),
                            phase: "failed".to_owned(),
                            message: Some(message),
                            generated_units: 0,
                            file_completed: true,
                        }) {
                            return Err(CompileError::Cancelled);
                        }
                        continue;
                    }
                };
                let descriptor = configured.parser.descriptor();
                let fingerprint = structure_build_fingerprint(
                    &source.primary.content_hash,
                    descriptor.id.as_str(),
                    &descriptor.implementation_version,
                    &configured.config_hash,
                );
                if !full
                    && self
                        .store
                        .get_structure_build_for_normalized(&source.revision_ref)
                        .await?
                        .is_some_and(|build| build.fingerprint == fingerprint)
                {
                    reused += 1;
                    work_base = work_base.saturating_add(file_work);
                    if !report_progress(StructureProgress {
                        processed: built + reused + failed,
                        total,
                        work_processed: work_base,
                        work_total,
                        built,
                        reused,
                        failed,
                        source_uri,
                        parser_id: route.parser_id.clone(),
                        phase: "reused".to_owned(),
                        message: Some("reused unchanged structure build".to_owned()),
                        generated_units: 0,
                        file_completed: true,
                    }) {
                        return Err(CompileError::Cancelled);
                    }
                    continue;
                }

                let input_bytes = match self.artifacts.read(&source.primary.artifact).await {
                    Ok(input) => input,
                    Err(error) => {
                        failed += 1;
                        let message = format!("artifact read failed: {error}");
                        diagnostics.push(format!("{source_uri}: {message}"));
                        work_base = work_base.saturating_add(file_work);
                        if !report_progress(StructureProgress {
                            processed: built + reused + failed,
                            total,
                            work_processed: work_base,
                            work_total,
                            built,
                            reused,
                            failed,
                            source_uri,
                            parser_id: route.parser_id.clone(),
                            phase: "failed".to_owned(),
                            message: Some(message),
                            generated_units: 0,
                            file_completed: true,
                        }) {
                            return Err(CompileError::Cancelled);
                        }
                        continue;
                    }
                };
                let input = BytesStructureInputSource::new(input_bytes);
                let bridge = StructureProgressBridge::new(
                    &mut report_progress,
                    total,
                    built + reused + failed,
                    built,
                    reused,
                    failed,
                    work_base,
                    file_work,
                    work_total,
                    source_uri.clone(),
                    route.parser_id.clone(),
                );
                let parsed = configured
                    .parser
                    .parse(
                        StructureParseRequest {
                            normalized: &source,
                            input: &input,
                        },
                        StructureParseContext {
                            progress: &bridge,
                            cancellation: &bridge,
                            limits: StructureResourceLimits::default(),
                        },
                    )
                    .await;
                drop(bridge);
                let parsed = match parsed {
                    Ok(parsed) => parsed,
                    Err(context_structure::StructureParserError::Cancelled) => {
                        return Err(CompileError::Cancelled);
                    }
                    Err(error) => {
                        failed += 1;
                        diagnostics.push(format!("{source_uri}: {error}"));
                        work_base = work_base.saturating_add(file_work);
                        let _ = report_progress(StructureProgress {
                            processed: built + reused + failed,
                            total,
                            work_processed: work_base,
                            work_total,
                            built,
                            reused,
                            failed,
                            source_uri,
                            parser_id: route.parser_id.clone(),
                            phase: "failed".to_owned(),
                            message: Some(error.to_string()),
                            generated_units: 0,
                            file_completed: true,
                        });
                        continue;
                    }
                };

                let internal = async {
                    let artifact_sink = self.artifacts.begin()?;
                    let mut writer = artifact_sink
                        .create(ArtifactSpecification {
                            role: ArtifactRole::Companion,
                            relative_path: Some("structure.json".to_owned()),
                            media_type: "application/x-context-structure+json".to_owned(),
                            format: Some(agent_file_normalizer::FormatId::new(
                                "context_structure_json",
                            )),
                            extension: Some("json".to_owned()),
                        })
                        .await
                        .map_err(|error| CompileError::Projection(error.to_string()))?;
                    writer
                        .write(bytes::Bytes::from(parsed.internal_structure.clone()))
                        .await
                        .map_err(|error| CompileError::Projection(error.to_string()))?;
                    let internal = writer
                        .finish()
                        .await
                        .map_err(|error| CompileError::Projection(error.to_string()))?;
                    artifact_sink
                        .commit(std::slice::from_ref(&internal))
                        .await
                        .map_err(|error| CompileError::Projection(error.to_string()))?;
                    Ok::<_, CompileError>(internal)
                }
                .await;
                let internal = match internal {
                    Ok(internal) => internal,
                    Err(error) => {
                        failed += 1;
                        let message = format!("internal Structure Artifact failed: {error}");
                        diagnostics.push(format!("{source_uri}: {message}"));
                        work_base = work_base.saturating_add(file_work);
                        if !report_progress(StructureProgress {
                            processed: built + reused + failed,
                            total,
                            work_processed: work_base,
                            work_total,
                            built,
                            reused,
                            failed,
                            source_uri,
                            parser_id: route.parser_id.clone(),
                            phase: "failed".to_owned(),
                            message: Some(message),
                            generated_units: 0,
                            file_completed: true,
                        }) {
                            return Err(CompileError::Cancelled);
                        }
                        continue;
                    }
                };

                let producer = ProducerRef {
                    name: descriptor.id.to_string(),
                    version: descriptor.implementation_version.clone(),
                    config_hash: configured.config_hash,
                };
                let build_entity = EntityRef::new(
                    Layer::Structure,
                    format!("build:{}:{}", descriptor.id, source.revision_ref.entity.id),
                );
                let build_ref = RevisionRef::new(build_entity.clone(), fingerprint.clone());
                let trace = Trace {
                    source_snapshot: source.source_snapshot.clone(),
                    parents: vec![source.revision_ref.clone()],
                    producer: producer.clone(),
                };
                let mut local_refs = BTreeMap::new();
                let units = parsed
                    .units
                    .into_iter()
                    .map(|parsed_unit| {
                        let revision_hash = structure_json_hash(&parsed_unit);
                        let revision_ref = RevisionRef::new(
                            EntityRef::new(
                                Layer::Structure,
                                format!(
                                    "structure:{}:{}:{}",
                                    descriptor.id,
                                    source.revision_ref.entity.id,
                                    parsed_unit.stable_key
                                ),
                            ),
                            revision_hash,
                        );
                        local_refs.insert(parsed_unit.local_id, revision_ref.clone());
                        StructureUnit {
                            revision_ref,
                            build_ref: build_ref.clone(),
                            kind: structure_kind(&parsed_unit.kind),
                            stable_key: parsed_unit.stable_key,
                            label: parsed_unit.label,
                            locator: parsed_unit.locator,
                            text: parsed_unit.preview,
                            trace: trace.clone(),
                            freshness: Freshness::Current,
                        }
                    })
                    .collect::<Vec<_>>();
                let relations = parsed
                    .relations
                    .into_iter()
                    .filter_map(|relation| {
                        let from = local_refs.get(&relation.from_local_id)?.clone();
                        let to = local_refs.get(&relation.to_local_id)?.clone();
                        let fingerprint = structure_json_hash(&relation);
                        Some(StructureRelationRecord {
                            revision_ref: RevisionRef::new(
                                EntityRef::new(
                                    Layer::Structure,
                                    format!(
                                        "relation:{}:{}:{}",
                                        descriptor.id,
                                        source.revision_ref.entity.id,
                                        relation.local_id
                                    ),
                                ),
                                fingerprint.clone(),
                            ),
                            build_ref: build_ref.clone(),
                            relation_type: StructureRelationType::new(relation.kind),
                            from,
                            to,
                            locator: relation.locator,
                            fingerprint,
                            trace: trace.clone(),
                            freshness: Freshness::Current,
                        })
                    })
                    .collect::<Vec<_>>();
                let previous = self
                    .store
                    .get_structure_build_for_normalized(&source.revision_ref)
                    .await?;
                let mut stale = Vec::new();
                if let Some(previous) = previous {
                    stale.extend(
                        self.store
                            .list_structure_units_for_build(&previous.revision_ref)
                            .await?
                            .into_iter()
                            .map(|unit| unit.revision_ref),
                    );
                    stale.extend(
                        self.store
                            .list_structure_relations_for_build(&previous.revision_ref)
                            .await?
                            .into_iter()
                            .map(|relation| relation.revision_ref),
                    );
                }
                unit_count = unit_count.saturating_add(units.len());
                let generated_units = units.len() as u64;
                let commit = self
                    .store
                    .commit_structure(StructureCommit {
                        build: StructureBuildRecord {
                            entity_ref: build_entity,
                            revision_ref: build_ref,
                            source_snapshot: source.source_snapshot,
                            normalized_source: source.revision_ref,
                            producer,
                            status: context_protocol::RunStatus::Completed,
                            fingerprint,
                            internal_artifact: Some(ArtifactRef::new(internal.uri)),
                            unit_count: generated_units,
                            relation_count: relations.len() as u64,
                        },
                        units,
                        relations,
                        stale,
                    })
                    .await;
                if let Err(error) = commit {
                    failed += 1;
                    let message = format!("atomic Structure commit failed: {error}");
                    diagnostics.push(format!("{source_uri}: {message}"));
                    work_base = work_base.saturating_add(file_work);
                    if !report_progress(StructureProgress {
                        processed: built + reused + failed,
                        total,
                        work_processed: work_base,
                        work_total,
                        built,
                        reused,
                        failed,
                        source_uri,
                        parser_id: route.parser_id.clone(),
                        phase: "failed".to_owned(),
                        message: Some(message),
                        generated_units: 0,
                        file_completed: true,
                    }) {
                        return Err(CompileError::Cancelled);
                    }
                    continue;
                }
                built += 1;
                work_base = work_base.saturating_add(file_work);
                if !report_progress(StructureProgress {
                    processed: built + reused + failed,
                    total,
                    work_processed: work_base,
                    work_total,
                    built,
                    reused,
                    failed,
                    source_uri,
                    parser_id: route.parser_id.clone(),
                    phase: "file_committed".to_owned(),
                    message: Some(format!("committed {generated_units} structure units")),
                    generated_units,
                    file_completed: true,
                }) {
                    return Err(CompileError::Cancelled);
                }
            }
            cursor = next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        if full && failed == 0 {
            self.store.mark_structure_rebuild_complete().await?;
        }
        Ok((unit_count, reused, failed, diagnostics))
    }

    pub async fn evidence_stage(&self) -> Result<(usize, Vec<String>), CompileError> {
        let normalized = self
            .store
            .list_normalized()
            .await?
            .into_iter()
            .filter(|value| value.freshness == Freshness::Current)
            .collect::<Vec<_>>();
        let structures = self.store.list_structures().await?;
        let existing = self.store.list_evidence().await?;
        let mut count = 0;
        let mut diagnostics = Vec::new();
        for source in normalized {
            let Some(processor) = self.registry.get(&source.format) else {
                diagnostics.push(format!(
                    "processor_missing: no processor is installed for normalized format {}",
                    source.format.as_str()
                ));
                continue;
            };
            let mut selected_structures = structures
                .iter()
                .filter(|value| {
                    value.trace.source_snapshot == source.source_snapshot
                        && value.freshness == Freshness::Current
                        && value.kind != StructureKind::Document
                        && value.kind != StructureKind::File
                })
                .cloned()
                .collect::<Vec<_>>();
            for structure in &mut selected_structures {
                structure.text = self.resolve_structure_text(structure).await?;
            }
            let output = processor
                .build_evidence(EvidenceBuildRequest {
                    structures: selected_structures,
                    previous: existing
                        .iter()
                        .filter(|value| {
                            value.normalized_source == source.revision_ref
                                && value.freshness == Freshness::Current
                        })
                        .cloned()
                        .collect(),
                })
                .await?;
            count += output.evidence.len();
            self.store.put_evidence_build(output.build).await?;
            self.store.put_evidence(output.evidence).await?;
        }
        Ok((count, diagnostics))
    }

    pub async fn fact_stage(&self) -> Result<(usize, Vec<String>), CompileError> {
        let normalized = self
            .store
            .list_normalized()
            .await?
            .into_iter()
            .filter(|value| value.freshness == Freshness::Current)
            .collect::<Vec<_>>();
        let evidence = self.store.list_evidence().await?;
        let existing = self.store.list_facts().await?;
        let mut count = 0;
        let mut diagnostics = Vec::new();
        for source in normalized {
            let Some(processor) = self.registry.get(&source.format) else {
                diagnostics.push(format!(
                    "processor_missing: no processor is installed for normalized format {}",
                    source.format.as_str()
                ));
                continue;
            };
            let output = processor
                .build_facts(FactBuildRequest {
                    evidence: evidence
                        .iter()
                        .filter(|value| {
                            value.normalized_source == source.revision_ref
                                && value.freshness == Freshness::Current
                        })
                        .cloned()
                        .collect(),
                    previous: existing
                        .iter()
                        .filter(|value| {
                            value.trace.source_snapshot == source.source_snapshot
                                && value.freshness == Freshness::Current
                        })
                        .cloned()
                        .collect(),
                })
                .await?;
            count += output.facts.len();
            self.store.put_fact_build(output.build).await?;
            self.store.put_facts(output.facts).await?;
        }
        Ok((count, diagnostics))
    }

    pub async fn semantic_stage(&self) -> Result<usize, CompileError> {
        let facts = self
            .store
            .list_facts()
            .await?
            .into_iter()
            .filter(|value| value.freshness == Freshness::Current)
            .collect::<Vec<_>>();
        let edges = self.link_implementations(&facts, &[])?;
        let count = edges.len();
        self.store.put_edges(edges).await?;
        Ok(count)
    }

    pub async fn project_stage(&self, root: impl AsRef<Path>) -> Result<usize, CompileError> {
        let sources = self.store.list_sources().await?;
        let normalized = self.store.list_normalized().await?;
        let mut projections = Vec::new();
        let mut desired_paths = BTreeMap::new();
        for source in &sources {
            if source.access_status != AccessStatus::Available {
                continue;
            }
            let Some(projection) = normalized.iter().find(|value| {
                value.source_snapshot == source.current_snapshot
                    && value.freshness == Freshness::Current
            }) else {
                continue;
            };
            let relative = projection_relative_path(&source.uri, &projection.extension)?;
            if let Some(other_source) = desired_paths.insert(relative.clone(), &source.uri) {
                return Err(CompileError::Projection(format!(
                    "sources {other_source} and {} map to the same projection {}",
                    source.uri,
                    relative.display()
                )));
            }
            projections.push((source.uri.as_str(), relative, projection));
        }
        update_projections(root.as_ref(), &projections, self.artifacts.as_ref()).await?;
        Ok(projections.len())
    }

    pub async fn compile_sources(
        &self,
        sources: Vec<CapturedSource>,
        options: BuildOptions,
    ) -> Result<CompileSummary, CompileError> {
        self.compile_stages(sources, options, &StructurePolicy::default(), false)
            .await
    }

    pub async fn compile_workspace(
        &self,
        root: impl AsRef<Path>,
        options: BuildOptions,
    ) -> Result<CompileSummary, CompileError> {
        let config_repository = ConfigRepository::new(root.as_ref());
        let mappings = self.normalizers.descriptors();
        let loaded = config_repository.load(&mappings)?;
        if !loaded.persisted {
            config_repository.save(&loaded.config, Some(&loaded.etag), &mappings)?;
        }
        let rules = discovery_rules(&loaded.config, &self.normalizers)?;
        let connector = LocalSourceConnector::new(root.as_ref(), rules);
        let mut sources = Vec::new();
        for path in connector.discover()? {
            let mut captured = connector.capture(&path)?;
            let extension = path.extension().and_then(|value| value.to_str());
            let relative = path
                .strip_prefix(root.as_ref())
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let candidates = loaded
                .config
                .matching_routes(
                    RouteInput {
                        source_id: "workspace",
                        path: &relative,
                        extension,
                        media_type: Some(&captured.record.media_type),
                    },
                    &mappings,
                )?
                .into_iter()
                .map(|route| NormalizationCandidate {
                    normalizer_id: route.normalizer_id,
                    priority: route.priority,
                    config: route.config,
                })
                .collect();
            let selected = self
                .normalizers
                .select(candidates, &captured.record, captured.bytes.clone())
                .await?;
            let descriptor = self
                .normalizers
                .descriptor(&selected.normalizer_id)
                .ok_or_else(|| {
                    context_source::SourceError::Configuration(format!(
                        "normalizer is not registered: {}",
                        selected.normalizer_id
                    ))
                })?;
            let input = descriptor.inputs.first().ok_or_else(|| {
                context_source::SourceError::Configuration(format!(
                    "normalizer has no input matcher: {}",
                    selected.normalizer_id
                ))
            })?;
            captured.normalizer_id = selected.normalizer_id;
            captured.normalizer_config = selected.config;
            captured.record.format = input.format.clone();
            captured.record.media_type = input
                .media_types
                .first()
                .cloned()
                .unwrap_or_else(|| "application/octet-stream".to_owned());
            sources.push(captured);
        }
        self.compile_captured_workspace(root, sources, options)
            .await
    }

    /// Compiles content captured by an external Connector registry and updates
    /// the workspace's readable projections. This keeps Connector plugins out
    /// of the compiler dependency graph while giving CLI/admin hosts one stable
    /// orchestration entry point.
    pub async fn compile_captured_workspace(
        &self,
        root: impl AsRef<Path>,
        sources: Vec<CapturedSource>,
        options: BuildOptions,
    ) -> Result<CompileSummary, CompileError> {
        let root = root.as_ref();
        let loaded = ConfigRepository::new(root).load(&self.normalizers.descriptors())?;
        let summary = self
            .compile_stages(sources, options, &loaded.config.structure, true)
            .await?;
        self.project_stage(root).await?;
        Ok(summary)
    }

    async fn compile_stages(
        &self,
        sources: Vec<CapturedSource>,
        options: BuildOptions,
        structure_policy: &StructurePolicy,
        mark_missing: bool,
    ) -> Result<CompileSummary, CompileError> {
        let previous_normalized = self.store.list_normalized().await?;
        let mut previously_current = BTreeSet::new();
        for source in &sources {
            let producer = self
                .normalizers
                .producer_ref(&source.normalizer_id, &source.normalizer_config)?;
            if previous_normalized.iter().any(|normalized| {
                normalized.source_snapshot == source.snapshot.revision_ref
                    && normalized.normalizer_id == source.normalizer_id
                    && normalized.normalizer == producer
                    && normalized.freshness == Freshness::Current
            }) {
                previously_current.insert(source.snapshot.revision_ref.clone());
            }
        }

        let capture_stale = if mark_missing {
            self.capture_stage(&sources).await?
        } else {
            let no_source_ids = BTreeSet::new();
            self.capture_stage_inner(&sources, Some(&no_source_ids))
                .await?
        };
        let (built, skipped, normalization_stale, normalization_diagnostics) =
            self.normalize_stage(&sources, options.full).await?;
        let (_, structure_reused, structure_failed, structure_diagnostics) = self
            .structure_stage_with_progress(structure_policy, options.full, |_| true)
            .await?;
        let (_, evidence_diagnostics) = self.evidence_stage().await?;
        let (fact_count, fact_diagnostics) = self.fact_stage().await?;
        let semantic_count = self.semantic_stage().await?;

        let normalized = self.store.list_normalized().await?;
        let structures = self.store.list_structures().await?;
        let evidence = self.store.list_evidence().await?;
        let facts = self.store.list_facts().await?;
        let edges = self.store.list_edges().await?;
        let stale_revisions = capture_stale.saturating_add(normalization_stale);
        let single_source_stale = (sources.len() == 1).then_some(stale_revisions);
        let mut source_results = Vec::with_capacity(sources.len());
        for source in &sources {
            let source_structures = structures
                .iter()
                .filter(|unit| {
                    unit.trace.source_snapshot == source.snapshot.revision_ref
                        && unit.freshness == Freshness::Current
                })
                .count();
            let source_evidence = evidence
                .iter()
                .filter(|record| {
                    record.trace.source_snapshot == source.snapshot.revision_ref
                        && record.freshness == Freshness::Current
                })
                .count();
            let source_facts = facts
                .iter()
                .filter(|fact| {
                    fact.trace.source_snapshot == source.snapshot.revision_ref
                        && fact.freshness == Freshness::Current
                })
                .collect::<Vec<_>>();
            let fact_entities = source_facts
                .iter()
                .map(|fact| &fact.revision_ref.entity)
                .collect::<BTreeSet<_>>();
            let source_edges = edges
                .iter()
                .filter(|edge| {
                    edge.freshness == Freshness::Current
                        && (fact_entities.contains(&edge.from_fact)
                            || fact_entities.contains(&edge.to_fact))
                })
                .count();
            let source_normalized = normalized.iter().find(|record| {
                record.source_snapshot == source.snapshot.revision_ref
                    && record.freshness == Freshness::Current
            });
            let mut diagnostics = structure_diagnostics
                .iter()
                .chain(normalization_diagnostics.iter())
                .filter(|diagnostic| {
                    diagnostic.contains(&source.record.uri)
                        || diagnostic.contains(&source.record.entity_ref.id)
                })
                .cloned()
                .collect::<Vec<_>>();
            if source_normalized.is_some_and(|record| self.registry.get(&record.format).is_none()) {
                diagnostics.push(format!(
                    "processor_missing: no downstream processor is installed for {}",
                    source.record.uri
                ));
            }
            source_results.push(CompileResult {
                source: source.snapshot.revision_ref.clone(),
                skipped: !options.full
                    && previously_current.contains(&source.snapshot.revision_ref),
                structures: source_structures,
                evidence: source_evidence,
                facts: source_facts.len(),
                semantic_edges: source_edges,
                stale_revisions: single_source_stale.unwrap_or(0),
                diagnostics,
            });
        }

        let mut diagnostics = normalization_diagnostics;
        diagnostics.extend(structure_diagnostics);
        diagnostics.extend(evidence_diagnostics);
        diagnostics.extend(fact_diagnostics);
        Ok(CompileSummary {
            sources: source_results,
            built,
            skipped,
            failed_sources: structure_failed,
            facts: fact_count,
            semantic_edges: semantic_count,
            stale_revisions,
            diagnostics: {
                if structure_reused > 0 {
                    diagnostics.push(format!(
                        "structure_reused: {structure_reused} unchanged files"
                    ));
                }
                diagnostics
            },
        })
    }

    async fn mark_missing_sources(
        &self,
        active_sources: &BTreeSet<context_protocol::EntityRef>,
    ) -> Result<usize, CompileError> {
        self.mark_missing_sources_matching(active_sources, |_| true)
            .await
    }

    async fn mark_missing_sources_for(
        &self,
        active_sources: &BTreeSet<context_protocol::EntityRef>,
        source_ids: &BTreeSet<String>,
    ) -> Result<usize, CompileError> {
        let prefixes = source_ids
            .iter()
            .map(|source_id| format!("source:{source_id}:"))
            .collect::<Vec<_>>();
        self.mark_missing_sources_matching(active_sources, |source| {
            prefixes
                .iter()
                .any(|prefix| source.entity_ref.id.starts_with(prefix))
        })
        .await
    }

    async fn mark_missing_sources_matching(
        &self,
        active_sources: &BTreeSet<context_protocol::EntityRef>,
        matches_source: impl Fn(&SourceRecord) -> bool,
    ) -> Result<usize, CompileError> {
        let missing = self
            .store
            .list_sources()
            .await?
            .into_iter()
            .filter(|source| matches_source(source) && !active_sources.contains(&source.entity_ref))
            .collect::<Vec<_>>();
        let mut changed = 0;
        for mut source in missing {
            if let Some(mut snapshot) = self.store.get_snapshot(&source.current_snapshot).await? {
                changed += self.invalidate_source(&snapshot.revision_ref).await?;
                if snapshot.freshness != Freshness::Stale {
                    snapshot.freshness = Freshness::Stale;
                    changed += 1;
                    self.store.put_snapshot(snapshot).await?;
                }
            }
            if source.access_status != AccessStatus::Missing {
                source.access_status = AccessStatus::Missing;
                self.store.put_source(source).await?;
            }
        }
        Ok(changed)
    }

    pub async fn compile_source(
        &self,
        captured: CapturedSource,
        options: BuildOptions,
    ) -> Result<CompileResult, CompileError> {
        self.compile_stages(vec![captured], options, &StructurePolicy::default(), false)
            .await?
            .sources
            .into_iter()
            .next()
            .ok_or_else(|| CompileError::Projection("source build returned no result".to_owned()))
    }

    async fn invalidate_source(&self, source: &RevisionRef) -> Result<usize, CompileError> {
        let mut changed = 0;
        let mut affected = BTreeSet::from([source.clone()]);
        let mut normalized = self.store.list_normalized().await?;
        normalized.retain(|value| value.source_snapshot == *source);
        for value in &mut normalized {
            affected.insert(value.revision_ref.clone());
            if value.freshness != Freshness::Stale {
                value.freshness = Freshness::Stale;
                changed += 1;
            }
        }
        for value in normalized {
            self.store.put_normalized(value).await?;
        }

        let mut structures = self.store.list_structures_for_source(source).await?;
        for structure in &mut structures {
            affected.insert(structure.revision_ref.clone());
            if structure.freshness != Freshness::Stale {
                structure.freshness = Freshness::Stale;
                changed += 1;
            }
        }
        self.store.put_structures(structures).await?;

        let mut evidence = self.store.list_evidence().await?;
        evidence.retain(|value| value.trace.source_snapshot == *source);
        for value in &mut evidence {
            affected.insert(value.revision_ref.clone());
            if value.freshness != Freshness::Stale {
                value.freshness = Freshness::Stale;
                changed += 1;
            }
        }
        self.store.put_evidence(evidence).await?;

        let mut facts = self.store.list_facts().await?;
        facts.retain(|value| value.trace.source_snapshot == *source);
        for fact in &mut facts {
            affected.insert(fact.revision_ref.clone());
            if fact.freshness != Freshness::Stale {
                fact.freshness = Freshness::Stale;
                changed += 1;
            }
            changed += usize::try_from(
                self.store
                    .mark_edges_stale(&fact.revision_ref.entity)
                    .await?,
            )
            .unwrap_or(usize::MAX);
        }
        self.store.put_facts(facts).await?;

        let mut assignments = self.store.list_assignments().await?;
        for assignment in &mut assignments {
            if affected.contains(&assignment.target)
                && assignment.review_status != ReviewStatus::Orphaned
            {
                assignment.review_status = ReviewStatus::Orphaned;
                changed += 1;
            }
        }
        self.store.put_assignments(assignments).await?;

        let mut blocks = self.store.list_blocks().await?;
        for block in &mut blocks {
            if affected.contains(&block.target) && block.review_status != ReviewStatus::Orphaned {
                block.review_status = ReviewStatus::Orphaned;
                changed += 1;
            }
        }
        self.store.put_blocks(blocks).await?;
        Ok(changed)
    }

    fn link_implementations(
        &self,
        new_facts: &[FactRevision],
        all_facts: &[FactRevision],
    ) -> Result<Vec<SemanticEdge>, CompileError> {
        let mut edges = Vec::new();
        let mut seen = BTreeSet::new();
        for code in all_facts
            .iter()
            .chain(new_facts)
            .filter(|fact| fact.kind == FactKind::CodeSymbol)
        {
            for rule in all_facts
                .iter()
                .chain(new_facts)
                .filter(|fact| fact.kind == FactKind::BusinessRule)
            {
                if code.freshness == Freshness::Stale
                    || rule.freshness == Freshness::Stale
                    || !concepts_overlap(&code.statement, &rule.statement)
                {
                    continue;
                }
                let id = format!(
                    "implements:{}:{}",
                    code.revision_ref.entity.id, rule.revision_ref.entity.id
                );
                if !seen.insert(id.clone()) {
                    continue;
                }
                edges.push(SemanticEdge::new(
                    id,
                    SemanticRelation::Implements,
                    code.revision_ref.entity.clone(),
                    rule.revision_ref.entity.clone(),
                    code.kind,
                    rule.kind,
                    ReviewStatus::Candidate,
                    code.trace.source_snapshot.entity != rule.trace.source_snapshot.entity,
                    Freshness::Current,
                    Trace {
                        source_snapshot: code.trace.source_snapshot.clone(),
                        parents: vec![code.revision_ref.clone(), rule.revision_ref.clone()],
                        producer: code.trace.producer.clone(),
                    },
                )?);
            }
        }
        Ok(edges)
    }
}

fn concepts_overlap(left: &str, right: &str) -> bool {
    fn concepts(value: &str) -> BTreeSet<&'static str> {
        let lowercase = value.to_lowercase();
        let candidates = [
            ("refund", ["refund", "退款"].as_slice()),
            ("return", ["return", "退货"].as_slice()),
            ("day", ["day", "days", "天"].as_slice()),
            ("payment", ["payment", "支付"].as_slice()),
        ];
        candidates
            .into_iter()
            .filter_map(|(concept, tokens)| {
                tokens
                    .iter()
                    .any(|token| lowercase.contains(token))
                    .then_some(concept)
            })
            .collect()
    }
    let left = concepts(left);
    let right = concepts(right);
    !left.is_disjoint(&right)
}

async fn update_projections(
    root: &Path,
    projections: &[(&str, std::path::PathBuf, &NormalizedSource)],
    artifacts: &dyn ArtifactRepository,
) -> Result<(), CompileError> {
    let previous = load_projection_manifest(root)?;
    let desired = projections
        .iter()
        .map(|(_, relative, _)| relative.clone())
        .collect::<BTreeSet<_>>();
    for relative in previous.paths.values() {
        let relative = checked_relative_path(relative)?;
        if !desired.contains(&relative) {
            let path = root.join(".context/sources").join(relative);
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(CompileError::Projection(error.to_string())),
            }
        }
    }

    let mut manifest = ProjectionManifest::default();
    for (source_uri, relative, normalized) in projections {
        write_projection(root, relative, normalized, artifacts).await?;
        manifest.paths.insert(
            (*source_uri).to_owned(),
            relative.to_string_lossy().replace('\\', "/"),
        );
    }
    save_projection_manifest(root, &manifest)
}

async fn write_projection(
    root: &Path,
    relative: &Path,
    normalized: &NormalizedSource,
    artifacts: &dyn ArtifactRepository,
) -> Result<(), CompileError> {
    let path = root.join(".context/sources").join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| CompileError::Projection(error.to_string()))?;
    }
    artifacts
        .copy_to(&normalized.primary.artifact, &path)
        .await?;
    Ok(())
}

fn load_projection_manifest(root: &Path) -> Result<ProjectionManifest, CompileError> {
    let path = root.join(".context/source-projections.json");
    if !path.exists() {
        return Ok(ProjectionManifest::default());
    }
    let bytes = std::fs::read(path).map_err(|error| CompileError::Projection(error.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|error| CompileError::Projection(error.to_string()))
}

fn save_projection_manifest(
    root: &Path,
    manifest: &ProjectionManifest,
) -> Result<(), CompileError> {
    let path = root.join(".context/source-projections.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| CompileError::Projection(error.to_string()))?;
    }
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| CompileError::Projection(error.to_string()))?;
    std::fs::write(path, bytes).map_err(|error| CompileError::Projection(error.to_string()))
}

fn checked_relative_path(value: &str) -> Result<std::path::PathBuf, CompileError> {
    let path = Path::new(value);
    if value.is_empty()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(CompileError::Projection(format!(
            "projection manifest path escapes workspace: {value}"
        )));
    }
    Ok(path.to_path_buf())
}

fn projection_relative_path(
    source_uri: &str,
    normalized_extension: &str,
) -> Result<std::path::PathBuf, CompileError> {
    let relative = Path::new(source_uri);
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(CompileError::Projection(format!(
            "source URI escapes workspace: {source_uri}",
        )));
    }
    let mut relative = relative.to_path_buf();
    let original_extension = relative.extension().and_then(|value| value.to_str());
    if original_extension != Some(normalized_extension) {
        let file_name = relative
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| CompileError::Projection(format!("invalid source URI: {source_uri}")))?;
        relative.set_file_name(format!("{file_name}.{normalized_extension}"));
    }
    Ok(relative)
}

fn structure_build_fingerprint(
    artifact_hash: &str,
    parser_id: &str,
    implementation_version: &str,
    config_hash: &str,
) -> String {
    let value = format!("{artifact_hash}\0{parser_id}\0{implementation_version}\0{config_hash}");
    format!("sha256:{:x}", Sha256::digest(value.as_bytes()))
}

fn structure_json_hash(value: &impl serde::Serialize) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn structure_kind(value: &str) -> StructureKind {
    StructureKind::new(value.to_owned())
}

pub fn default_normalizer_registry() -> NormalizerRegistry {
    let mut registry = NormalizerRegistry::new();
    for factory in [
        Arc::new(MarkdownNormalizer::new()) as Arc<dyn agent_file_normalizer::NormalizerFactory>,
        Arc::new(TypeScriptNormalizer::new()),
        Arc::new(HtmlNormalizer::new()),
        Arc::new(TextToMarkdownNormalizer::new()),
        Arc::new(PdfToMarkdownNormalizer::new()),
        Arc::new(PdfToHtmlNormalizer::new()),
    ] {
        if let Err(error) = registry.register(factory) {
            panic!("invalid built-in normalizer registry: {error}");
        }
    }
    registry
}

fn discovery_rules(
    config: &ContextConfig,
    registry: &NormalizerRegistry,
) -> Result<Vec<context_source::ResolvedNormalization>, CompileError> {
    let mut configured = BTreeMap::<String, context_source::NormalizationRule>::new();
    for rule in config
        .normalization
        .defaults
        .iter()
        .chain(
            config
                .normalization
                .source_overrides
                .iter()
                .flat_map(|value| value.rules.iter()),
        )
        .chain(
            config
                .normalization
                .path_overrides
                .iter()
                .map(|value| &value.rule),
        )
    {
        let entry = configured
            .entry(rule.normalizer_id.clone())
            .or_insert_with(|| context_source::NormalizationRule {
                normalizer_id: rule.normalizer_id.clone(),
                enabled: rule.enabled,
                extensions: Vec::new(),
                priority: Some(rule.priority),
                config: rule.config.clone(),
            });
        entry.enabled |= rule.enabled;
        entry.priority = Some(entry.priority.unwrap_or(rule.priority).max(rule.priority));
        for extension in &rule.extensions {
            if !entry.extensions.contains(extension) {
                entry.extensions.push(extension.clone());
            }
        }
    }
    let config = NormalizationConfig {
        rules: configured.into_values().collect(),
    };
    registry.resolve(&config).map_err(Into::into)
}
