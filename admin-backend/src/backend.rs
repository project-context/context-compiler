use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use agent_source_connector::ConnectorDescriptor;
use agent_source_connector::ConnectorFuture;
use agent_source_connector::DiscoveryRequest;
use agent_source_connector::SecretProvider;
use agent_source_connector::SecretRef;
use agent_source_connector::SourceConnector;
use agent_source_connector::SourceConnectorFactory;
use agent_source_connector_git::GitConnectorFactory;
use agent_source_connector_local::LocalConnectorFactory;
use context_compiler::BuildOptions;
use context_compiler::Compiler;
use context_compiler::NormalizationProgress;
use context_compiler::ProcessorRegistry;
use context_compiler::StructureProgress;
use context_compiler::default_normalizer_registry;
use context_config::ConfigRepository;
use context_config::ContextConfig;
use context_config::LoadedConfig;
use context_config::RouteInput;
use context_config::StructurePolicy;
use context_evidence::EvidenceCatalogReader;
use context_evidence::EvidenceQuery;
use context_evidence::EvidenceReader;
use context_fact::FactCatalogReader;
use context_fact::FactQuery;
use context_fact::FactReader;
use context_protocol::AccessStatus;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::PageRequest;
use context_protocol::ProducerRef;
use context_protocol::ReviewStatus;
use context_protocol::RevisionMode;
use context_protocol::RevisionRef;
use context_protocol::Trace;
use context_query::ContextRequest;
use context_query::ContextResult;
use context_query::ContextService;
use context_scope::AssignmentPurpose;
use context_scope::ContextRole;
use context_scope::DimensionCardinality;
use context_scope::Scope;
use context_scope::ScopeAssignment;
use context_scope::ScopeCatalogReader;
use context_scope::ScopeDecision;
use context_scope::ScopeDimension;
use context_scope::ScopeEngine;
use context_scope::ScopeQuery;
use context_scope::ScopeReader;
use context_scope::ScopeRef;
use context_scope::ScopeStore;
use context_semantic::SemanticCatalogReader;
use context_semantic::SemanticQuery;
use context_semantic::SemanticReader;
use context_source::CapturedSource;
use context_source::FormatId;
use context_source::NormalizationCandidate;
use context_source::NormalizedSourceQuery;
use context_source::NormalizerRegistry;
use context_source::SnapshotQuery;
use context_source::SourceCatalogReader;
use context_source::SourceQuery;
use context_source::SourceReader;
use context_source::SourceRecord;
use context_source::SourceSnapshot;
use context_source::SourceStore;
use context_store_sqlite::ReviewAuditRecord;
use context_store_sqlite::ReviewBatch;
use context_store_sqlite::SqliteStore;
use context_structure::StructureCatalogReader;
use context_structure::StructureFileFamily;
use context_structure::StructureParserRegistry;
use context_structure::StructureQuery;
use context_structure::StructureReader;
use context_structure::StructureStore;
use context_workspace::ArtifactRepository;
use context_workspace::MemoryArtifactRepository;
use context_workspace::Workspace;
use context_workspace::WorkspaceArtifactRepository;
use context_workspace::WorkspaceError;
use serde::de::DeserializeOwned;
use serde_json::Value;
use serde_json::json;
use uuid::Uuid;

use crate::AdminBackend;
use crate::AdminError;
use crate::AdminFuture;
use crate::AdminResult;
use crate::ArtifactPreview;
use crate::ArtifactPreviewRequest;
use crate::BuildJob;
use crate::BuildJobStatus;
use crate::BuildStage;
use crate::JobManager;
use crate::JobReporter;
use crate::JobTaskResult;
use crate::LayerCollection;
use crate::LayerQuery;
use crate::ManualScopeAssignmentRequest;
use crate::NormalizationPreview;
use crate::NormalizationPreviewRequest;
use crate::NormalizationResolveRequest;
use crate::NormalizerCatalogEntry;
use crate::PipelineRunRequest;
use crate::RegisteredWorkspace;
use crate::ReviewCommand;
use crate::ReviewSubject;
use crate::ScopeContextView;
use crate::StructureConfigView;
use crate::StructureFileFamilyView;
use crate::StructureFormatView;
use crate::StructureParserCatalogEntry;
use crate::WorkspaceFileEntry;
use crate::WorkspaceFileKind;
use crate::WorkspaceRegistry;
use crate::persistence::SqliteJobPersistence;

#[derive(Clone)]
pub struct ServerBackend {
    compiler_home: PathBuf,
    registry: WorkspaceRegistry,
    jobs: JobManager,
    connectors: Arc<BTreeMap<String, Arc<dyn SourceConnectorFactory>>>,
    normalizers: NormalizerRegistry,
    structure_parsers: StructureParserRegistry,
}

impl ServerBackend {
    pub async fn new(compiler_home: PathBuf) -> AdminResult<Self> {
        let mut connectors: BTreeMap<String, Arc<dyn SourceConnectorFactory>> = BTreeMap::new();
        connectors.insert("local".to_owned(), Arc::new(LocalConnectorFactory::new()));
        connectors.insert("git".to_owned(), Arc::new(GitConnectorFactory::new()));
        let registry = WorkspaceRegistry::new(compiler_home.clone());
        let jobs = JobManager::with_persistence(Arc::new(SqliteJobPersistence::new(
            compiler_home.clone(),
        )));
        jobs.restore().await?;
        let processors = ProcessorRegistry::with_defaults();
        Ok(Self {
            registry,
            compiler_home,
            jobs,
            connectors: Arc::new(connectors),
            normalizers: default_normalizer_registry(),
            structure_parsers: processors.structure_parsers().clone(),
        })
    }

    pub fn register_workspace_root(
        &self,
        root: impl AsRef<Path>,
    ) -> AdminResult<RegisteredWorkspace> {
        self.registry.register(root)
    }

    /// Synchronous-command entry point shared by `context build` and hosts
    /// that need the configured Connector pipeline without starting HTTP.
    pub async fn compile_now(
        &self,
        workspace_id: &str,
        options: BuildOptions,
    ) -> AdminResult<context_compiler::CompileSummary> {
        let (_, workspace) = self.workspace(workspace_id)?;
        let (sources, diagnostics) = self
            .capture_configured_sources(workspace_id, &[], None)
            .await?;
        if sources.is_empty() && !diagnostics.is_empty() {
            return Err(AdminError::Invalid(diagnostics.join("; ")));
        }
        let store = SqliteStore::connect(workspace.database_path())
            .await
            .map_err(invalid)?;
        let artifacts = Arc::new(WorkspaceArtifactRepository::new(&workspace));
        let mut summary = Compiler::new(store, ProcessorRegistry::with_defaults(), artifacts)
            .compile_captured_workspace(workspace.root(), sources, options)
            .await
            .map_err(invalid)?;
        summary.failed_sources = diagnostics.len();
        summary.diagnostics.extend(diagnostics);
        Ok(summary)
    }

    fn workspace(&self, workspace_id: &str) -> AdminResult<(RegisteredWorkspace, Workspace)> {
        let registered = self.registry.get(workspace_id)?;
        let workspace = Workspace::discover(&registered.root, self.compiler_home.clone())?;
        Ok((registered, workspace))
    }

    fn config(&self, workspace_id: &str) -> AdminResult<(Workspace, LoadedConfig)> {
        let (_, workspace) = self.workspace(workspace_id)?;
        let loaded =
            ConfigRepository::new(workspace.root()).load(&self.normalizers.descriptors())?;
        Ok((workspace, loaded))
    }

    async fn connector(
        &self,
        workspace_id: &str,
        source_id: &str,
    ) -> AdminResult<(
        Workspace,
        context_config::SourceDefinition,
        Box<dyn SourceConnector>,
    )> {
        let (workspace, loaded) = self.config(workspace_id)?;
        let source = loaded
            .config
            .sources
            .into_iter()
            .find(|source| source.connector.id == source_id)
            .ok_or_else(|| AdminError::NotFound(source_id.to_owned()))?;
        if !source.connector.enabled {
            return Err(AdminError::Conflict(format!(
                "source is disabled: {source_id}"
            )));
        }
        let factory = self
            .connectors
            .get(&source.connector.connector_id)
            .cloned()
            .ok_or_else(|| {
                AdminError::Invalid(format!(
                    "connector is not installed: {}",
                    source.connector.connector_id
                ))
            })?;
        let config = runtime_connector_config(&workspace, &source)?;
        factory.validate_config(&config).map_err(invalid)?;
        let connector = factory
            .connect(config, Arc::new(NoSecrets))
            .await
            .map_err(invalid)?;
        Ok((workspace, source, connector))
    }

    async fn store(&self, workspace_id: &str) -> AdminResult<SqliteStore> {
        let (_, workspace) = self.workspace(workspace_id)?;
        SqliteStore::connect(workspace.database_path())
            .await
            .map_err(invalid)
    }

    async fn structure_config_view(&self, workspace_id: &str) -> AdminResult<StructureConfigView> {
        let (_, loaded) = self.config(workspace_id)?;
        let store = self.store(workspace_id).await?;
        let mut formats = BTreeMap::<String, (String, u64, StructureFileFamily)>::new();
        let mut cursor = None;
        loop {
            let page = store
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
                .await
                .map_err(invalid)?;
            for normalized in page.items {
                let extension = normalized
                    .extension
                    .trim_start_matches('.')
                    .to_ascii_lowercase();
                let entry = formats.entry(extension).or_insert_with(|| {
                    (
                        normalized.format.as_str().to_owned(),
                        0,
                        StructureFileFamily::infer(&normalized),
                    )
                });
                entry.1 = entry.1.saturating_add(1);
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        for route in &loaded.config.structure.routes {
            let extension = route.extension.trim_start_matches('.').to_ascii_lowercase();
            formats.entry(extension.clone()).or_insert_with(|| {
                (
                    extension.clone(),
                    0,
                    structure_family_for_extension(&extension),
                )
            });
        }
        let mut grouped = BTreeMap::<StructureFileFamily, Vec<StructureFormatView>>::new();
        for (extension, (format, file_count, family)) in formats {
            let compatible = self.structure_parsers.compatible_extension(&extension);
            let selected_parser_id = loaded
                .config
                .structure
                .route(&extension)
                .map(|route| route.parser_id.clone());
            let status = match &selected_parser_id {
                Some(selected)
                    if compatible
                        .iter()
                        .any(|parser| parser.id.as_str() == selected) =>
                {
                    "configured"
                }
                Some(_) => "incompatible",
                None if compatible.is_empty() => "parser_missing",
                None => "unconfigured",
            };
            grouped
                .entry(family)
                .or_default()
                .push(StructureFormatView {
                    extension,
                    format,
                    file_count,
                    selected_parser_id,
                    compatible_parsers: compatible,
                    status: status.to_owned(),
                });
        }
        let families = StructureFileFamily::ordered()
            .iter()
            .filter_map(|family| {
                let mut values = grouped.remove(family)?;
                values.sort_by(|left, right| left.extension.cmp(&right.extension));
                Some(StructureFileFamilyView {
                    family: *family,
                    label: family.label().to_owned(),
                    file_count: values.iter().map(|value| value.file_count).sum(),
                    format_count: values.len() as u64,
                    formats: values,
                })
            })
            .collect();
        Ok(StructureConfigView {
            etag: loaded.etag,
            policy: loaded.config.structure,
            families,
        })
    }

    async fn capture_configured_sources(
        &self,
        workspace_id: &str,
        source_ids: &[String],
        reporter: Option<&JobReporter>,
    ) -> AdminResult<(Vec<CapturedSource>, Vec<String>)> {
        let (workspace, loaded) = self.config(workspace_id)?;
        if !loaded.persisted {
            ConfigRepository::new(workspace.root()).save_with_structure(
                &loaded.config,
                Some(&loaded.etag),
                &self.normalizers.descriptors(),
                &self.structure_parsers,
            )?;
        }
        let mut captured_sources = Vec::new();
        let mut failures = Vec::new();
        let selected = source_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        for source_id in &selected {
            let definition = loaded
                .config
                .sources
                .iter()
                .find(|value| value.connector.id == *source_id)
                .ok_or_else(|| AdminError::NotFound((*source_id).to_owned()))?;
            if !definition.connector.enabled {
                return Err(AdminError::Conflict(format!(
                    "source is disabled: {source_id}"
                )));
            }
        }
        for definition in loaded
            .config
            .sources
            .iter()
            .filter(|value| value.connector.enabled)
            .filter(|value| selected.is_empty() || selected.contains(value.connector.id.as_str()))
        {
            if reporter.is_some_and(JobReporter::is_cancelled) {
                return Err(AdminError::Conflict("cancelled".to_owned()));
            }
            let source_id = definition.connector.id.clone();
            let captured = async {
                let (_, _, connector) = self.connector(workspace_id, &source_id).await?;
                let mut values = Vec::new();
                let mut cursor = None;
                loop {
                    if reporter.is_some_and(JobReporter::is_cancelled) {
                        return Err(AdminError::Conflict("cancelled".to_owned()));
                    }
                    let discovered = connector
                        .discover(DiscoveryRequest {
                            cursor: cursor.clone(),
                            limit: Some(10_000),
                        })
                        .await
                        .map_err(invalid)?;
                    for object in discovered.objects {
                        if reporter.is_some_and(JobReporter::is_cancelled) {
                            return Err(AdminError::Conflict("cancelled".to_owned()));
                        }
                        let candidates = loaded.config.matching_routes(
                            RouteInput {
                                source_id: &source_id,
                                path: &object.stable_key,
                                extension: object.extension.as_deref(),
                                media_type: Some(&object.media_type),
                            },
                            &self.normalizers.descriptors(),
                        )?;
                        if candidates.is_empty() {
                            continue;
                        }
                        let content = connector
                            .capture(&object.stable_key)
                            .await
                            .map_err(invalid)?;
                        let content_hash =
                            content.object.content_hash.clone().ok_or_else(|| {
                                AdminError::Invalid(format!(
                                    "connector did not hash captured content: {source_id}/{}",
                                    object.stable_key
                                ))
                            })?;
                        let entity = EntityRef::new(
                            Layer::Source,
                            format!("source:{source_id}:{}", object.stable_key),
                        );
                        let revision_ref = RevisionRef::new(entity.clone(), content_hash.clone());
                        let uri = if source_id == "workspace" {
                            object.uri.clone()
                        } else {
                            format!("{source_id}/{}", object.uri)
                        };
                        let mut record = SourceRecord {
                            entity_ref: entity,
                            format: FormatId::new(object.extension.as_deref().unwrap_or("unknown")),
                            uri,
                            title: object.title,
                            media_type: object.media_type,
                            current_snapshot: revision_ref.clone(),
                            access_status: AccessStatus::Available,
                        };
                        let bytes = bytes::Bytes::from(content.bytes);
                        let selected = self
                            .normalizers
                            .select(
                                candidates
                                    .into_iter()
                                    .map(|route| NormalizationCandidate {
                                        normalizer_id: route.normalizer_id,
                                        priority: route.priority,
                                        config: route.config,
                                    })
                                    .collect(),
                                &record,
                                bytes.clone(),
                            )
                            .await
                            .map_err(invalid)?;
                        let descriptor = self
                            .normalizers
                            .descriptor(&selected.normalizer_id)
                            .ok_or_else(|| AdminError::Invalid(selected.normalizer_id.clone()))?;
                        let input = descriptor.inputs.first().ok_or_else(|| {
                            AdminError::Invalid(format!(
                                "normalizer has no input matcher: {}",
                                selected.normalizer_id
                            ))
                        })?;
                        record.format = input.format.clone();
                        record.media_type = input
                            .media_types
                            .first()
                            .cloned()
                            .unwrap_or_else(|| "application/octet-stream".to_owned());
                        values.push(CapturedSource {
                            record,
                            snapshot: SourceSnapshot {
                                revision_ref,
                                content_hash,
                                size_bytes: content.object.size_bytes,
                                modified_at: content.object.modified_at,
                                freshness: Freshness::Current,
                            },
                            bytes,
                            normalizer_id: selected.normalizer_id,
                            normalizer_config: selected.config,
                        });
                    }
                    cursor = discovered.next_cursor;
                    if cursor.is_none() {
                        break;
                    }
                }
                Ok::<_, AdminError>(values)
            }
            .await;
            match captured {
                Ok(mut values) => captured_sources.append(&mut values),
                Err(error) => failures.push(format!("source {source_id}: {error}")),
            }
        }
        Ok((captured_sources, failures))
    }

    fn validate_source_configs(
        &self,
        workspace: &Workspace,
        config: &ContextConfig,
    ) -> AdminResult<()> {
        for source in &config.sources {
            let factory = self
                .connectors
                .get(&source.connector.connector_id)
                .ok_or_else(|| {
                    AdminError::Invalid(format!(
                        "connector is not installed: {}",
                        source.connector.connector_id
                    ))
                })?;
            let runtime = runtime_connector_config(workspace, source)?;
            factory.validate_config(&runtime).map_err(invalid)?;
        }
        Ok(())
    }
}

impl AdminBackend for ServerBackend {
    fn jobs(&self) -> JobManager {
        self.jobs.clone()
    }

    fn list_workspaces(&self) -> AdminFuture<'_, Vec<RegisteredWorkspace>> {
        Box::pin(async move { self.registry.list() })
    }

    fn register_workspace(&self, root: PathBuf) -> AdminFuture<'_, RegisteredWorkspace> {
        Box::pin(async move { self.registry.register(root) })
    }

    fn unregister_workspace(&self, workspace_id: String) -> AdminFuture<'_, ()> {
        Box::pin(async move { self.registry.unregister(&workspace_id) })
    }

    fn doctor(&self, workspace_id: String) -> AdminFuture<'_, Value> {
        Box::pin(async move {
            let (_, workspace) = self.workspace(&workspace_id)?;
            let root = workspace.root();
            let canonical = root.join("context.config.json");
            let legacy = root.join("context.normalizers.json");
            let agent = root.join("AGENTS.md");
            let agent_status = if !agent.exists() {
                "missing"
            } else if std::fs::read_to_string(&agent)
                .map_err(AdminError::Io)?
                .contains("<!-- context-compiler:managed:start -->")
            {
                "managed"
            } else {
                "unmanaged_conflict"
            };
            let (normalizer_rebuild_required, structure_rebuild_required) =
                if workspace.database_path().exists() {
                    let store = SqliteStore::connect(workspace.database_path())
                        .await
                        .map_err(invalid)?;
                    (
                        store.normalizer_rebuild_required().await.map_err(invalid)?,
                        store.structure_rebuild_required().await.map_err(invalid)?,
                    )
                } else {
                    (false, false)
                };
            let mut diagnostics = Vec::new();
            if normalizer_rebuild_required {
                diagnostics.push("normalizer_protocol_v1_rebuild_required");
            }
            if structure_rebuild_required {
                diagnostics.push("structure_protocol_v2_rebuild_required");
            }
            Ok(json!({
                "workspaceId": workspace.config().workspace_id,
                "schemaVersion": workspace.config().schema_version,
                "storeMode": workspace.config().store_mode,
                "database": workspace.database_path(),
                "databaseExists": workspace.database_path().exists(),
                "canonicalConfig": canonical.exists(),
                "legacyConfig": legacy.exists(),
                "configConflict": canonical.exists() && legacy.exists(),
                "agentEntry": agent_status,
                "diagnostics": diagnostics,
            }))
        })
    }

    fn list_workspace_files(
        &self,
        workspace_id: String,
        path: String,
    ) -> AdminFuture<'_, Vec<WorkspaceFileEntry>> {
        Box::pin(async move {
            let (registered, _) = self.workspace(&workspace_id)?;
            let relative = Path::new(&path);
            if relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            }) {
                return Err(AdminError::Invalid(
                    "workspace file path must stay inside the workspace".to_owned(),
                ));
            }

            let root = registered.root.canonicalize()?;
            let directory = root.join(relative).canonicalize()?;
            if !directory.starts_with(&root) {
                return Err(AdminError::Invalid(
                    "workspace file path resolves outside the workspace".to_owned(),
                ));
            }
            if !directory.is_dir() {
                return Err(AdminError::Invalid(
                    "workspace file path must identify a directory".to_owned(),
                ));
            }

            let mut entries = Vec::new();
            for entry in std::fs::read_dir(directory)? {
                let entry = entry?;
                let metadata = std::fs::symlink_metadata(entry.path())?;
                let file_type = metadata.file_type();
                let kind = if file_type.is_dir() {
                    WorkspaceFileKind::Directory
                } else if file_type.is_file() {
                    WorkspaceFileKind::File
                } else if file_type.is_symlink() {
                    WorkspaceFileKind::Symlink
                } else {
                    WorkspaceFileKind::Other
                };
                let entry_relative = entry
                    .path()
                    .strip_prefix(&root)
                    .map_err(|_| AdminError::Invalid("invalid workspace entry".to_owned()))?
                    .to_string_lossy()
                    .replace(std::path::MAIN_SEPARATOR, "/");
                let modified_at_ms = metadata
                    .modified()
                    .ok()
                    .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                    .and_then(|duration| u64::try_from(duration.as_millis()).ok());
                entries.push(WorkspaceFileEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: entry_relative,
                    kind,
                    size_bytes: if file_type.is_file() {
                        metadata.len()
                    } else {
                        0
                    },
                    modified_at_ms,
                });
            }
            entries.sort_by(|left, right| {
                let left_rank = !matches!(left.kind, WorkspaceFileKind::Directory);
                let right_rank = !matches!(right.kind, WorkspaceFileKind::Directory);
                left_rank
                    .cmp(&right_rank)
                    .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            });
            Ok(entries)
        })
    }

    fn get_config(&self, workspace_id: String) -> AdminFuture<'_, LoadedConfig> {
        Box::pin(async move { self.config(&workspace_id).map(|(_, loaded)| loaded) })
    }

    fn save_config(
        &self,
        workspace_id: String,
        config: ContextConfig,
        expected_etag: Option<String>,
    ) -> AdminFuture<'_, String> {
        Box::pin(async move {
            let (workspace, _) = self.config(&workspace_id)?;
            self.validate_source_configs(&workspace, &config)?;
            ConfigRepository::new(workspace.root())
                .save_with_structure(
                    &config,
                    expected_etag.as_deref(),
                    &self.normalizers.descriptors(),
                    &self.structure_parsers,
                )
                .map_err(Into::into)
        })
    }

    fn connector_catalog(&self) -> AdminFuture<'_, Vec<ConnectorDescriptor>> {
        Box::pin(async move {
            Ok(self
                .connectors
                .values()
                .map(|factory| factory.descriptor())
                .collect())
        })
    }

    fn test_source(
        &self,
        workspace_id: String,
        source_id: String,
    ) -> AdminFuture<'_, agent_source_connector::ConnectionTestResult> {
        Box::pin(async move {
            let (_, _, connector) = self.connector(&workspace_id, &source_id).await?;
            connector.test().await.map_err(invalid)
        })
    }

    fn discover_source(
        &self,
        workspace_id: String,
        source_id: String,
        cursor: Option<String>,
        limit: Option<u16>,
    ) -> AdminFuture<'_, agent_source_connector::DiscoveryResult> {
        Box::pin(async move {
            let (_, _, connector) = self.connector(&workspace_id, &source_id).await?;
            connector
                .discover(DiscoveryRequest { cursor, limit })
                .await
                .map_err(invalid)
        })
    }

    fn normalizer_catalog(
        &self,
        workspace_id: String,
    ) -> AdminFuture<'_, Vec<NormalizerCatalogEntry>> {
        Box::pin(async move {
            let (_, loaded) = self.config(&workspace_id)?;
            let enabled = configured_normalizers(&loaded.config);
            Ok(self
                .normalizers
                .descriptors()
                .into_iter()
                .map(|mapping| NormalizerCatalogEntry {
                    processor_installed: matches!(
                        mapping.output.format.as_str(),
                        "markdown" | "typescript"
                    ),
                    enabled: enabled.contains(&mapping.id),
                    mapping,
                })
                .collect())
        })
    }

    fn preview_normalization(
        &self,
        workspace_id: String,
        request: NormalizationPreviewRequest,
    ) -> AdminFuture<'_, NormalizationPreview> {
        Box::pin(async move {
            let (_, loaded) = self.config(&workspace_id)?;
            let (_, _, connector) = self.connector(&workspace_id, &request.source_id).await?;
            let captured = connector
                .capture(&request.stable_key)
                .await
                .map_err(invalid)?;
            let extension = captured.object.extension.as_deref();
            let candidates = loaded.config.matching_routes(
                RouteInput {
                    source_id: &request.source_id,
                    path: &captured.object.stable_key,
                    extension,
                    media_type: Some(&captured.object.media_type),
                },
                &self.normalizers.descriptors(),
            )?;
            if candidates.is_empty() {
                return Err(AdminError::Invalid(format!(
                    "no normalization route matched {}",
                    captured.object.stable_key
                )));
            }
            let hash = captured
                .object
                .content_hash
                .clone()
                .unwrap_or_else(|| format!("preview:{}", Uuid::now_v7()));
            let entity = EntityRef::new(
                Layer::Source,
                format!(
                    "preview:{}:{}",
                    request.source_id, captured.object.stable_key
                ),
            );
            let revision_ref = RevisionRef::new(entity.clone(), hash.clone());
            let mut record = SourceRecord {
                entity_ref: entity,
                format: FormatId::new(extension.unwrap_or("unknown")),
                uri: captured.object.uri,
                title: captured.object.title,
                media_type: captured.object.media_type,
                current_snapshot: revision_ref.clone(),
                access_status: AccessStatus::Available,
            };
            let bytes = bytes::Bytes::from(captured.bytes);
            let selected = self
                .normalizers
                .select(
                    candidates
                        .into_iter()
                        .map(|route| NormalizationCandidate {
                            normalizer_id: route.normalizer_id,
                            priority: route.priority,
                            config: route.config,
                        })
                        .collect(),
                    &record,
                    bytes.clone(),
                )
                .await
                .map_err(invalid)?;
            let descriptor = self
                .normalizers
                .descriptor(&selected.normalizer_id)
                .ok_or_else(|| AdminError::Invalid(selected.normalizer_id.clone()))?;
            let input = descriptor.inputs.first().ok_or_else(|| {
                AdminError::Invalid(format!(
                    "normalizer has no input matcher: {}",
                    selected.normalizer_id
                ))
            })?;
            record.format = input.format.clone();
            let artifacts = MemoryArtifactRepository::default();
            let sink = artifacts.begin()?;
            let normalized = self
                .normalizers
                .normalize(
                    &selected.normalizer_id,
                    &selected.config,
                    record,
                    SourceSnapshot {
                        revision_ref,
                        content_hash: hash,
                        size_bytes: captured.object.size_bytes,
                        modified_at: captured.object.modified_at,
                        freshness: Freshness::Current,
                    },
                    bytes,
                    sink.as_ref(),
                    artifacts.scratch(),
                    &agent_file_normalizer::NoProgress,
                    &agent_file_normalizer::NeverCancelled,
                    agent_file_normalizer::ResourceLimits::default(),
                )
                .await
                .map_err(invalid)?;
            let maximum = request.max_chars.unwrap_or(100_000).clamp(1, 1_000_000);
            // Read enough bytes to cover the requested UTF-8 character window
            // without loading an arbitrarily large artifact into the admin host.
            let (bytes, byte_truncated) = artifacts
                .read_prefix(&normalized.primary.artifact, maximum.saturating_mul(4))
                .await?;
            let valid_length = match std::str::from_utf8(&bytes) {
                Ok(_) => bytes.len(),
                Err(error) if error.error_len().is_none() => error.valid_up_to(),
                Err(error) => return Err(invalid(error)),
            };
            let normalized_content =
                String::from_utf8(bytes[..valid_length].to_vec()).map_err(invalid)?;
            let character_truncated = normalized_content.chars().count() > maximum;
            let truncated = byte_truncated || character_truncated;
            let content = normalized_content.chars().take(maximum).collect();
            Ok(NormalizationPreview {
                normalizer_id: selected.normalizer_id,
                output_format: normalized.format.as_str().to_owned(),
                media_type: normalized.media_type,
                extension: normalized.extension,
                content,
                truncated,
                diagnostics: normalized.diagnostics,
            })
        })
    }

    fn preview_artifact(
        &self,
        workspace_id: String,
        request: ArtifactPreviewRequest,
    ) -> AdminFuture<'_, ArtifactPreview> {
        Box::pin(async move {
            let (_, workspace) = self.workspace(&workspace_id)?;
            let artifacts = WorkspaceArtifactRepository::new(&workspace);
            let maximum = request.max_chars.unwrap_or(250_000).clamp(1, 2_000_000);
            let (bytes, byte_truncated) = artifacts
                .read_prefix(&request.artifact, maximum.saturating_mul(4))
                .await
                .map_err(|error| match error {
                    WorkspaceError::Io(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        AdminError::NotFound(request.artifact.uri.clone())
                    }
                    other => AdminError::Workspace(other),
                })?;
            let valid_length = match std::str::from_utf8(&bytes) {
                Ok(_) => bytes.len(),
                Err(error) if error.error_len().is_none() => error.valid_up_to(),
                Err(error) => return Err(invalid(error)),
            };
            let normalized_content =
                String::from_utf8(bytes[..valid_length].to_vec()).map_err(invalid)?;
            let characters = normalized_content.chars().count();
            let character_truncated = characters > maximum;
            Ok(ArtifactPreview {
                content: normalized_content.chars().take(maximum).collect(),
                truncated: byte_truncated || character_truncated,
                characters: characters.min(maximum),
            })
        })
    }

    fn resolve_normalization(
        &self,
        workspace_id: String,
        request: NormalizationResolveRequest,
    ) -> AdminFuture<'_, Value> {
        Box::pin(async move {
            let (_, loaded) = self.config(&workspace_id)?;
            let route = loaded.config.resolve_route(
                RouteInput {
                    source_id: &request.source_id,
                    path: &request.path,
                    extension: request.extension.as_deref(),
                    media_type: request.media_type.as_deref(),
                },
                &self.normalizers.descriptors(),
            )?;
            serde_json::to_value(route).map_err(invalid)
        })
    }

    fn structure_parser_catalog(
        &self,
        _workspace_id: String,
    ) -> AdminFuture<'_, Vec<StructureParserCatalogEntry>> {
        Box::pin(async move {
            Ok(self
                .structure_parsers
                .descriptors()
                .into_iter()
                .filter_map(|descriptor| {
                    let factory = self.structure_parsers.factory(descriptor.id.as_str())?;
                    Some(StructureParserCatalogEntry {
                        descriptor,
                        config_schema: factory.config_schema().clone(),
                        installed: true,
                    })
                })
                .collect())
        })
    }

    fn structure_config(&self, workspace_id: String) -> AdminFuture<'_, StructureConfigView> {
        Box::pin(async move { self.structure_config_view(&workspace_id).await })
    }

    fn save_structure_config(
        &self,
        workspace_id: String,
        policy: StructurePolicy,
        expected_etag: Option<String>,
    ) -> AdminFuture<'_, StructureConfigView> {
        Box::pin(async move {
            let (workspace, loaded) = self.config(&workspace_id)?;
            let mut config = loaded.config;
            config.schema_version = 2;
            config.structure = policy;
            ConfigRepository::new(workspace.root()).save_with_structure(
                &config,
                expected_etag.as_deref(),
                &self.normalizers.descriptors(),
                &self.structure_parsers,
            )?;
            self.structure_config_view(&workspace_id).await
        })
    }

    fn structure_build_units(
        &self,
        workspace_id: String,
        build_ref: String,
        query: LayerQuery,
    ) -> AdminFuture<'_, Value> {
        Box::pin(async move {
            let store = self.store(&workspace_id).await?;
            let build = store
                .get_structure_build_by_ref(&build_ref)
                .await
                .map_err(invalid)?
                .ok_or_else(|| AdminError::NotFound(format!("structure build {build_ref}")))?;
            let page = store
                .page_structure_units_for_build(
                    &build.revision_ref,
                    PageRequest {
                        cursor: query.cursor,
                        limit: query.limit,
                    },
                    query.text,
                )
                .await
                .map_err(invalid)?;
            serde_json::to_value(page).map_err(invalid)
        })
    }

    fn structure_build_relations(
        &self,
        workspace_id: String,
        build_ref: String,
        query: LayerQuery,
    ) -> AdminFuture<'_, Value> {
        Box::pin(async move {
            let store = self.store(&workspace_id).await?;
            let build = store
                .get_structure_build_by_ref(&build_ref)
                .await
                .map_err(invalid)?
                .ok_or_else(|| AdminError::NotFound(format!("structure build {build_ref}")))?;
            let page = store
                .page_structure_relations_for_build(
                    &build.revision_ref,
                    PageRequest {
                        cursor: query.cursor,
                        limit: query.limit,
                    },
                )
                .await
                .map_err(invalid)?;
            serde_json::to_value(page).map_err(invalid)
        })
    }

    fn resolve_structure(
        &self,
        workspace_id: String,
        kind: String,
        local_id: String,
    ) -> AdminFuture<'_, Value> {
        Box::pin(async move {
            let (_, workspace) = self.workspace(&workspace_id)?;
            let store = self.store(&workspace_id).await?;
            let unit = store
                .find_structure((kind != "any").then_some(kind.as_str()), &local_id)
                .await
                .map_err(invalid)?
                .ok_or_else(|| AdminError::NotFound(format!("{kind}/{local_id}")))?;
            let relations = store
                .list_structure_relations_for_build(&unit.build_ref)
                .await
                .map_err(invalid)?;
            let build_units = store
                .list_structure_units_for_build(&unit.build_ref)
                .await
                .map_err(invalid)?;
            let text = match &unit.locator {
                context_protocol::Locator::ByteRange {
                    artifact,
                    start,
                    end,
                } => {
                    let bytes = WorkspaceArtifactRepository::new(&workspace)
                        .read(artifact)
                        .await
                        .map_err(invalid)?;
                    let start = usize::try_from(*start)
                        .unwrap_or(usize::MAX)
                        .min(bytes.len());
                    let end = usize::try_from(*end).unwrap_or(usize::MAX).min(bytes.len());
                    if start > end {
                        String::new()
                    } else {
                        String::from_utf8_lossy(&bytes[start..end]).into_owned()
                    }
                }
                _ => unit.text.clone(),
            };
            let referenced = |reference: &RevisionRef| {
                build_units
                    .iter()
                    .find(|candidate| &candidate.revision_ref == reference)
                    .cloned()
            };
            let parents = relations
                .iter()
                .filter(|relation| {
                    relation.relation_type == "contains" && relation.to == unit.revision_ref
                })
                .filter_map(|relation| referenced(&relation.from))
                .collect::<Vec<_>>();
            let children = relations
                .iter()
                .filter(|relation| {
                    relation.relation_type == "contains" && relation.from == unit.revision_ref
                })
                .filter_map(|relation| referenced(&relation.to))
                .collect::<Vec<_>>();
            let adjacent = relations
                .iter()
                .filter(|relation| {
                    relation.relation_type != "contains"
                        && (relation.from == unit.revision_ref || relation.to == unit.revision_ref)
                })
                .filter_map(|relation| {
                    if relation.from == unit.revision_ref {
                        referenced(&relation.to)
                    } else {
                        referenced(&relation.from)
                    }
                })
                .collect::<Vec<_>>();
            serde_json::to_value(context_structure::ResolvedStructureView {
                unit,
                text,
                parents,
                children,
                adjacent,
                relations,
            })
            .map_err(invalid)
        })
    }

    fn list_layer(
        &self,
        workspace_id: String,
        collection: LayerCollection,
        query: LayerQuery,
    ) -> AdminFuture<'_, Value> {
        Box::pin(async move {
            let store = self.store(&workspace_id).await?;
            let page = PageRequest {
                cursor: query.cursor.clone(),
                limit: query.limit,
            };
            let revisions = if query.all_revisions {
                RevisionMode::All
            } else {
                RevisionMode::Current
            };
            let value = match collection {
                LayerCollection::Sources => serde_json::to_value(
                    store
                        .page_sources(SourceQuery {
                            page,
                            text: query.text,
                            format: query.kind.map(FormatId::new),
                            access_status: None,
                        })
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::Snapshots => serde_json::to_value(
                    store
                        .page_snapshots(SnapshotQuery {
                            page,
                            freshness: query.freshness,
                            revision_mode: revisions,
                        })
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::NormalizedSources => serde_json::to_value(
                    store
                        .page_normalized(NormalizedSourceQuery {
                            page,
                            format: query.kind.map(FormatId::new),
                            freshness: query.freshness,
                            normalizer_id: None,
                            revision_mode: revisions,
                        })
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::Structures => serde_json::to_value(
                    store
                        .page_structures(StructureQuery {
                            page,
                            text: query.text,
                            kind: parse_optional(query.kind.as_deref(), "structure kind")?,
                            freshness: query.freshness,
                            source_snapshot: query.source_entity_id.zip(query.source_revision).map(
                                |(entity_id, revision)| {
                                    RevisionRef::new(
                                        context_protocol::EntityRef::new(
                                            context_protocol::Layer::Source,
                                            entity_id,
                                        ),
                                        revision,
                                    )
                                },
                            ),
                            revision_mode: revisions,
                        })
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::Evidence => serde_json::to_value(
                    store
                        .page_evidence(EvidenceQuery {
                            page,
                            text: query.text,
                            kind: parse_optional(query.kind.as_deref(), "evidence kind")?,
                            freshness: query.freshness,
                            structure_ref: None,
                            revision_mode: revisions,
                        })
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::Facts => serde_json::to_value(
                    store
                        .page_facts(FactQuery {
                            page,
                            text: query.text,
                            kind: parse_optional(query.kind.as_deref(), "fact kind")?,
                            freshness: query.freshness,
                            evidence_ref: None,
                            revision_mode: revisions,
                        })
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::ScopeDimensions => serde_json::to_value(
                    store
                        .page_dimensions(scope_query(page, &query))
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::Scopes => serde_json::to_value(
                    store
                        .page_scopes(scope_query(page, &query))
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::ScopeAssignments => serde_json::to_value(
                    store
                        .page_assignments(scope_query(page, &query))
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::ScopeBlocks => serde_json::to_value(
                    store
                        .page_blocks(scope_query(page, &query))
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::ScopeRelations => serde_json::to_value(
                    store
                        .page_relations(scope_query(page, &query))
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::ScopeDecisions => serde_json::to_value(
                    store
                        .page_decisions(scope_query(page, &query))
                        .await
                        .map_err(invalid)?,
                ),
                LayerCollection::SemanticEdges => serde_json::to_value(
                    store
                        .page_edges(SemanticQuery {
                            page,
                            relation: parse_optional(query.kind.as_deref(), "semantic relation")?,
                            review_status: query.review_status,
                            freshness: query.freshness,
                            fact_ref: None,
                        })
                        .await
                        .map_err(invalid)?,
                ),
            }
            .map_err(invalid)?;
            Ok(value)
        })
    }

    fn scope_context(
        &self,
        workspace_id: String,
        target: RevisionRef,
    ) -> AdminFuture<'_, ScopeContextView> {
        Box::pin(async move {
            let store = self.store(&workspace_id).await?;
            let (lineage, _) = scope_lineage(&store).await?;
            if !lineage.contains_key(&target) {
                return Err(AdminError::NotFound(format!(
                    "{}@{}",
                    target.entity.id, target.revision
                )));
            }
            let dimensions = store.list_dimensions().await.map_err(invalid)?;
            let scopes = store.list_scopes().await.map_err(invalid)?;
            let assignments = store.list_assignments().await.map_err(invalid)?;
            let blocks = store.list_blocks().await.map_err(invalid)?;
            let relations = store.list_relations().await.map_err(invalid)?;
            let direct_assignments = assignments
                .iter()
                .filter(|assignment| assignment.target == target)
                .cloned()
                .collect();
            let effective = ScopeEngine::effective_scope(
                &target,
                &lineage,
                &dimensions,
                &scopes,
                &assignments,
                &blocks,
                &relations,
            );
            Ok(ScopeContextView {
                target,
                direct_assignments,
                effective,
                scopes,
            })
        })
    }

    fn assign_scope(
        &self,
        workspace_id: String,
        request: ManualScopeAssignmentRequest,
    ) -> AdminFuture<'_, ScopeAssignment> {
        Box::pin(async move {
            let dimension = request.dimension.trim();
            let key = stable_scope_key(&request.scope_key);
            let label = request.label.trim();
            if dimension.is_empty() || key.is_empty() || label.is_empty() {
                return Err(AdminError::Invalid(
                    "dimension, scopeKey and label are required".to_owned(),
                ));
            }
            let store = self.store(&workspace_id).await?;
            let (lineage, source_snapshots) = scope_lineage(&store).await?;
            if !lineage.contains_key(&request.target) {
                return Err(AdminError::NotFound(format!(
                    "{}@{}",
                    request.target.entity.id, request.target.revision
                )));
            }
            let source_snapshot = source_snapshots
                .get(&request.target)
                .cloned()
                .ok_or_else(|| AdminError::Invalid("target has no Source lineage".to_owned()))?;

            let mut dimensions = store.list_dimensions().await.map_err(invalid)?;
            if !dimensions.iter().any(|value| value.name == dimension) {
                dimensions.push(ScopeDimension {
                    name: dimension.to_owned(),
                    cardinality: DimensionCardinality::Multiple,
                });
                store.put_dimensions(dimensions).await.map_err(invalid)?;
            }

            let scope_ref = ScopeRef::new(format!("scope:{dimension}:{key}"));
            store
                .put_scopes(vec![Scope {
                    scope_ref: scope_ref.clone(),
                    dimension: dimension.to_owned(),
                    value: key,
                    label: label.to_owned(),
                }])
                .await
                .map_err(invalid)?;

            let assignment = ScopeAssignment {
                id: format!(
                    "manual:{}@{}:{}",
                    request.target.entity.id, request.target.revision, scope_ref.id
                ),
                target: request.target,
                scope_ref,
                purpose: AssignmentPurpose::AppliesToContent,
                propagation: request.propagation,
                context_role: ContextRole::Main,
                review_status: ReviewStatus::Confirmed,
                trace: Trace {
                    source_snapshot,
                    parents: Vec::new(),
                    producer: ProducerRef {
                        name: "context-admin-manual".to_owned(),
                        version: env!("CARGO_PKG_VERSION").to_owned(),
                        config_hash: "manual".to_owned(),
                    },
                },
            };
            store
                .put_assignments(vec![assignment.clone()])
                .await
                .map_err(invalid)?;
            Ok(assignment)
        })
    }

    fn start_build(
        &self,
        workspace_id: String,
        request: PipelineRunRequest,
    ) -> AdminFuture<'_, BuildJob> {
        Box::pin(async move {
            request.validate().map_err(AdminError::Invalid)?;
            let (_, workspace) = self.workspace(&workspace_id)?;
            let root = workspace.root().to_path_buf();
            let database = workspace.database_path();
            let artifacts = Arc::new(WorkspaceArtifactRepository::new(&workspace));
            let structure_policy = self.config(&workspace_id)?.1.config.structure;
            let backend = self.clone();
            let build_workspace_id = workspace_id.clone();
            let run_request = request.clone();
            self.jobs
                .start_with_status(workspace_id, request, move |reporter| async move {
                    let store = SqliteStore::connect(database)
                        .await
                        .map_err(|error| error.to_string())?;
                    let compiler = Compiler::new(
                        store,
                        ProcessorRegistry::with_defaults(),
                        artifacts,
                    );
                    let needs_captured_input = run_request.includes(BuildStage::Capture)
                        || run_request.includes(BuildStage::Normalize);
                    let (sources, mut diagnostics) = if needs_captured_input {
                        backend
                            .capture_configured_sources(
                                &build_workspace_id,
                                &run_request.source_ids,
                                Some(&reporter),
                            )
                            .await
                            .map_err(|error| error.to_string())?
                    } else {
                        (Vec::new(), Vec::new())
                    };
                    if sources.is_empty() && !diagnostics.is_empty() {
                        return Err(diagnostics.join("; "));
                    }
                    let mut stages = serde_json::Map::new();

                    if run_request.includes(BuildStage::Capture) {
                        if reporter.is_cancelled() {
                            return Err("cancelled".to_owned());
                        }
                        let stale = if run_request.source_ids.is_empty() {
                            compiler.capture_stage(&sources).await
                        } else {
                            let source_ids = run_request
                                .source_ids
                                .iter()
                                .cloned()
                                .collect::<BTreeSet<_>>();
                            compiler
                                .capture_stage_for_sources(&sources, &source_ids)
                                .await
                        }
                        .map_err(|error| error.to_string())?;
                        stages.insert(
                            "capture".to_owned(),
                            json!({ "records": sources.len(), "staleRevisions": stale }),
                        );
                        reporter
                            .progress(
                                BuildStage::Capture,
                                format!("Source stage captured {} routed files", sources.len()),
                                Some(json!({ "records": sources.len(), "staleRevisions": stale })),
                            )
                            .await;
                    }

                    if run_request.includes(BuildStage::Normalize) {
                        if reporter.is_cancelled() {
                            return Err("cancelled".to_owned());
                        }
                        let total = sources.len();
                        reporter
                            .progress(
                                BuildStage::Normalize,
                                format!("Normalize stage started with {total} files"),
                                Some(json!({
                                    "processed": 0,
                                    "total": total,
                                    "percent": 0,
                                    "runProcessed": 0,
                                    "checkpointProcessed": 0,
                                    "completedFiles": 0,
                                    "totalFiles": total,
                                    "built": 0,
                                    "skipped": 0,
                                })),
                            )
                            .await;
                        let (progress_tx, mut progress_rx) =
                            tokio::sync::mpsc::unbounded_channel::<NormalizationProgress>();
                        let progress_reporter = reporter.clone();
                        let progress_task = tokio::spawn(async move {
                            while let Some(progress) = progress_rx.recv().await {
                                let processed = progress.work_processed;
                                let percent = progress_percent(processed, progress.work_total);
                                let completed_files = progress.processed;
                                progress_reporter
                                    .progress(
                                        BuildStage::Normalize,
                                        progress.message.clone().unwrap_or_else(|| format!(
                                            "Normalized {}/{}: {}",
                                            completed_files, progress.total, progress.source_uri
                                        )),
                                        Some(json!({
                                            "processed": processed,
                                            "total": progress.work_total,
                                            "percent": percent,
                                            "runProcessed": progress.work_processed,
                                            "checkpointProcessed": 0,
                                            "completedFiles": completed_files,
                                            "totalFiles": progress.total,
                                            "built": progress.built,
                                            "skipped": progress.skipped,
                                            "currentFile": progress.file_completed.then_some(progress.source_uri),
                                            "normalizerId": progress.normalizer_id,
                                            "outcome": progress.file_completed.then_some(if progress.reused { "reused" } else { "built" }),
                                            "phase": progress.phase,
                                        })),
                                    )
                                    .await;
                            }
                        });
                        let progress_sender = progress_tx.clone();
                        let cancellation_reporter = reporter.clone();
                        let mut last_sent_percent = 0;
                        let normalization = compiler
                            .normalize_stage_with_progress(
                                &sources,
                                run_request.full,
                                move |progress| {
                                    let percent = progress_percent(
                                        progress.work_processed,
                                        progress.work_total,
                                    );
                                    if progress.file_completed || percent != last_sent_percent {
                                        last_sent_percent = percent;
                                        let _ = progress_sender.send(progress);
                                    }
                                    !cancellation_reporter.is_cancelled()
                                },
                            )
                            .await;
                        drop(progress_tx);
                        let _ = progress_task.await;
                        let (built, skipped, stale, stage_diagnostics) =
                            normalization.map_err(|error| error.to_string())?;
                        diagnostics.extend(stage_diagnostics);
                        stages.insert(
                            "normalize".to_owned(),
                            json!({ "built": built, "skipped": skipped, "staleRevisions": stale }),
                        );
                        reporter
                            .progress(
                                BuildStage::Normalize,
                                format!("Normalize stage built {built} and reused {skipped} files"),
                                Some(json!({
                                    "processed": built + skipped,
                                    "total": total,
                                    "percent": 100,
                                    "completedFiles": built + skipped,
                                    "totalFiles": total,
                                    "built": built,
                                    "skipped": skipped,
                                    "staleRevisions": stale,
                                })),
                            )
                            .await;
                    }

                    if run_request.includes(BuildStage::Structure) {
                        if reporter.is_cancelled() {
                            return Err("cancelled".to_owned());
                        }
                        let (progress_tx, mut progress_rx) =
                            tokio::sync::mpsc::unbounded_channel::<StructureProgress>();
                        let progress_reporter = reporter.clone();
                        let progress_task = tokio::spawn(async move {
                            while let Some(progress) = progress_rx.recv().await {
                                let percent = progress_percent(
                                    usize::try_from(progress.work_processed).unwrap_or(usize::MAX),
                                    usize::try_from(progress.work_total).unwrap_or(usize::MAX),
                                );
                                progress_reporter
                                    .progress(
                                        BuildStage::Structure,
                                        progress.message.clone().unwrap_or_else(|| {
                                            format!(
                                                "Parsed {}/{}: {}",
                                                progress.processed,
                                                progress.total,
                                                progress.source_uri
                                            )
                                        }),
                                        Some(json!({
                                            "processed": progress.work_processed,
                                            "total": progress.work_total,
                                            "percent": percent,
                                            "completedFiles": progress.processed,
                                            "totalFiles": progress.total,
                                            "built": progress.built,
                                            "reused": progress.reused,
                                            "failed": progress.failed,
                                            "currentFile": progress.source_uri,
                                            "parserId": progress.parser_id,
                                            "phase": progress.phase,
                                            "generatedUnits": progress.generated_units,
                                            "fileCompleted": progress.file_completed,
                                        })),
                                    )
                                    .await;
                            }
                        });
                        let progress_sender = progress_tx.clone();
                        let cancellation_reporter = reporter.clone();
                        let mut last_sent_percent = 0;
                        let structure = compiler
                            .structure_stage_with_progress(
                                &structure_policy,
                                run_request.full,
                                move |progress| {
                                    let percent = progress_percent(
                                        usize::try_from(progress.work_processed)
                                            .unwrap_or(usize::MAX),
                                        usize::try_from(progress.work_total)
                                            .unwrap_or(usize::MAX),
                                    );
                                    if progress.file_completed || percent != last_sent_percent {
                                        last_sent_percent = percent;
                                        let _ = progress_sender.send(progress);
                                    }
                                    !cancellation_reporter.is_cancelled()
                                },
                            )
                            .await;
                        drop(progress_tx);
                        let _ = progress_task.await;
                        let (records, reused, failed, stage_diagnostics) =
                            structure.map_err(|error| error.to_string())?;
                        diagnostics.extend(stage_diagnostics);
                        stages.insert(
                            "structure".to_owned(),
                            json!({ "records": records, "reused": reused, "failed": failed }),
                        );
                        reporter
                            .progress(
                                BuildStage::Structure,
                                format!("Structure stage produced {records} records"),
                                Some(json!({
                                    "records": records,
                                    "reused": reused,
                                    "failed": failed,
                                    "percent": 100,
                                })),
                            )
                            .await;
                    }

                    if run_request.includes(BuildStage::Evidence) {
                        if reporter.is_cancelled() {
                            return Err("cancelled".to_owned());
                        }
                        let (records, stage_diagnostics) = compiler
                            .evidence_stage()
                            .await
                            .map_err(|error| error.to_string())?;
                        diagnostics.extend(stage_diagnostics);
                        stages.insert("evidence".to_owned(), json!({ "records": records }));
                        reporter
                            .progress(
                                BuildStage::Evidence,
                                format!("Evidence stage produced {records} records"),
                                Some(json!({ "records": records })),
                            )
                            .await;
                    }

                    if run_request.includes(BuildStage::Fact) {
                        if reporter.is_cancelled() {
                            return Err("cancelled".to_owned());
                        }
                        let (records, stage_diagnostics) = compiler
                            .fact_stage()
                            .await
                            .map_err(|error| error.to_string())?;
                        diagnostics.extend(stage_diagnostics);
                        stages.insert("fact".to_owned(), json!({ "records": records }));
                        reporter
                            .progress(
                                BuildStage::Fact,
                                format!("Fact stage produced {records} facts"),
                                Some(json!({ "records": records })),
                            )
                            .await;
                    }

                    if run_request.includes(BuildStage::Scope) {
                        stages.insert("scope".to_owned(), json!({ "evaluated": true }));
                        reporter
                            .progress(
                                BuildStage::Scope,
                                "Scope inheritance, blocks and conflicts evaluated",
                                None,
                            )
                            .await;
                    }

                    if run_request.includes(BuildStage::Semantic) {
                        if reporter.is_cancelled() {
                            return Err("cancelled".to_owned());
                        }
                        let records = compiler
                            .semantic_stage()
                            .await
                            .map_err(|error| error.to_string())?;
                        stages.insert("semantic".to_owned(), json!({ "records": records }));
                        reporter
                            .progress(
                                BuildStage::Semantic,
                                format!("Semantic stage produced {records} edges"),
                                Some(json!({ "records": records })),
                            )
                            .await;
                    }

                    if run_request.includes(BuildStage::Project) {
                        if reporter.is_cancelled() {
                            return Err("cancelled".to_owned());
                        }
                        let records = compiler
                            .project_stage(&root)
                            .await
                            .map_err(|error| error.to_string())?;
                        stages.insert("project".to_owned(), json!({ "records": records }));
                        reporter
                            .progress(
                                BuildStage::Project,
                                format!("Agent-readable projection updated for {records} files"),
                                Some(json!({ "records": records })),
                            )
                            .await;
                    }

                    let status = if diagnostics.is_empty() {
                        BuildJobStatus::Succeeded
                    } else {
                        BuildJobStatus::Partial
                    };
                    Ok(JobTaskResult {
                        status,
                        summary: json!({
                            "fromStage": run_request.from_stage,
                            "toStage": run_request.to_stage,
                            "full": run_request.full,
                            "sourceIds": run_request.source_ids,
                            "stages": stages,
                            "diagnostics": diagnostics,
                        }),
                    })
                })
                .await
        })
    }

    fn lineage(
        &self,
        workspace_id: String,
        entity_id: String,
        revision: String,
    ) -> AdminFuture<'_, Value> {
        Box::pin(async move {
            let store = self.store(&workspace_id).await?;
            let mut records = Vec::new();
            records.extend(
                store
                    .list_snapshots()
                    .await
                    .map_err(invalid)?
                    .into_iter()
                    .map(|value| serde_json::to_value(value).map_err(invalid))
                    .collect::<AdminResult<Vec<_>>>()?,
            );
            records.extend(
                store
                    .list_normalized()
                    .await
                    .map_err(invalid)?
                    .into_iter()
                    .map(|value| serde_json::to_value(value).map_err(invalid))
                    .collect::<AdminResult<Vec<_>>>()?,
            );
            records.extend(
                store
                    .list_structures()
                    .await
                    .map_err(invalid)?
                    .into_iter()
                    .map(|value| serde_json::to_value(value).map_err(invalid))
                    .collect::<AdminResult<Vec<_>>>()?,
            );
            records.extend(
                store
                    .list_evidence()
                    .await
                    .map_err(invalid)?
                    .into_iter()
                    .map(|value| serde_json::to_value(value).map_err(invalid))
                    .collect::<AdminResult<Vec<_>>>()?,
            );
            records.extend(
                store
                    .list_facts()
                    .await
                    .map_err(invalid)?
                    .into_iter()
                    .map(|value| serde_json::to_value(value).map_err(invalid))
                    .collect::<AdminResult<Vec<_>>>()?,
            );
            let by_key = records
                .into_iter()
                .filter_map(|value| revision_key(&value).map(|key| (key, value)))
                .collect::<BTreeMap<_, _>>();
            let root_key = format!("{entity_id}@{revision}");
            let root = by_key
                .get(&root_key)
                .cloned()
                .ok_or_else(|| AdminError::NotFound(root_key.clone()))?;
            let ancestors = traverse_lineage(&root_key, &by_key, true);
            let descendants = traverse_lineage(&root_key, &by_key, false);
            Ok(json!({
                "root": root,
                "ancestors": ancestors,
                "descendants": descendants,
            }))
        })
    }

    fn review(&self, workspace_id: String, command: ReviewCommand) -> AdminFuture<'_, Value> {
        Box::pin(async move {
            command.validate().map_err(AdminError::Invalid)?;
            let store = self.store(&workspace_id).await?;
            let mut assignments = store.list_assignments().await.map_err(invalid)?;
            let mut blocks = store.list_blocks().await.map_err(invalid)?;
            let mut relations = store.list_relations().await.map_err(invalid)?;
            let mut edges = store.list_edges().await.map_err(invalid)?;

            for decision in &command.decisions {
                let current = match decision.subject {
                    ReviewSubject::ScopeAssignment => assignments
                        .iter()
                        .find(|value| value.id == decision.id)
                        .map(|value| value.review_status),
                    ReviewSubject::ScopeBlock => blocks
                        .iter()
                        .find(|value| value.id == decision.id)
                        .map(|value| value.review_status),
                    ReviewSubject::ScopeRelation => relations
                        .iter()
                        .find(|value| value.id == decision.id)
                        .map(|value| value.review_status),
                    ReviewSubject::SemanticEdge => edges
                        .iter()
                        .find(|value| value.id == decision.id)
                        .map(|value| value.review_status),
                }
                .ok_or_else(|| AdminError::NotFound(decision.id.clone()))?;
                if current != decision.expected_status || current != ReviewStatus::Candidate {
                    return Err(AdminError::Conflict(format!(
                        "review state changed for {}: expected {:?}, current {:?}",
                        decision.id, decision.expected_status, current
                    )));
                }
            }

            let mut audit = Vec::new();
            let mut audit_records = Vec::new();
            for decision in command.decisions {
                match decision.subject {
                    ReviewSubject::ScopeAssignment => {
                        assignments
                            .iter_mut()
                            .find(|value| value.id == decision.id)
                            .ok_or_else(|| AdminError::NotFound(decision.id.clone()))?
                            .review_status = decision.status
                    }
                    ReviewSubject::ScopeBlock => {
                        blocks
                            .iter_mut()
                            .find(|value| value.id == decision.id)
                            .ok_or_else(|| AdminError::NotFound(decision.id.clone()))?
                            .review_status = decision.status
                    }
                    ReviewSubject::ScopeRelation => {
                        relations
                            .iter_mut()
                            .find(|value| value.id == decision.id)
                            .ok_or_else(|| AdminError::NotFound(decision.id.clone()))?
                            .review_status = decision.status
                    }
                    ReviewSubject::SemanticEdge => {
                        edges
                            .iter_mut()
                            .find(|value| value.id == decision.id)
                            .ok_or_else(|| AdminError::NotFound(decision.id.clone()))?
                            .review_status = decision.status
                    }
                }
                let decision_id = Uuid::now_v7().to_string();
                audit_records.push(ReviewAuditRecord {
                    decision_id: decision_id.clone(),
                    subject_kind: format!("{:?}", decision.subject).to_lowercase(),
                    subject_id: decision.id.clone(),
                    expected_status: format!("{:?}", decision.expected_status).to_lowercase(),
                    decided_status: format!("{:?}", decision.status).to_lowercase(),
                    rationale: decision.rationale.clone(),
                });
                audit.push(ScopeDecision {
                    id: decision_id,
                    subject: format!("{:?}:{}", decision.subject, decision.id),
                    status: decision.status,
                    rationale: decision.rationale,
                });
            }
            store
                .apply_review_batch(ReviewBatch {
                    assignments,
                    blocks,
                    relations,
                    edges,
                    decisions: audit.clone(),
                    audit: audit_records,
                })
                .await
                .map_err(invalid)?;
            Ok(json!({ "decisions": audit }))
        })
    }

    fn context(
        &self,
        workspace_id: String,
        request: ContextRequest,
    ) -> AdminFuture<'_, ContextResult> {
        Box::pin(async move {
            let store = self.store(&workspace_id).await?;
            ContextService::new(store)
                .context(request)
                .await
                .map_err(invalid)
        })
    }
}

fn runtime_connector_config(
    workspace: &Workspace,
    source: &context_config::SourceDefinition,
) -> AdminResult<Value> {
    let mut config = source.connector.config.clone();
    let object = config.as_object_mut().ok_or_else(|| {
        AdminError::Invalid(format!(
            "connector config must be an object: {}",
            source.connector.id
        ))
    })?;
    match source.connector.connector_id.as_str() {
        "local" => {
            let root = object.get("root").and_then(Value::as_str).unwrap_or(".");
            let root = Path::new(root);
            if root.is_relative() {
                object.insert(
                    "root".to_owned(),
                    Value::String(workspace.root().join(root).display().to_string()),
                );
            }
        }
        "git" => {
            let safe_id: String = source
                .connector
                .id
                .chars()
                .map(|value| {
                    if value.is_ascii_alphanumeric() {
                        value
                    } else {
                        '_'
                    }
                })
                .collect();
            object.insert(
                "checkoutDir".to_owned(),
                Value::String(
                    workspace
                        .runtime_dir()
                        .join("git")
                        .join(safe_id)
                        .display()
                        .to_string(),
                ),
            );
        }
        _ => {}
    }
    Ok(config)
}

fn configured_normalizers(config: &ContextConfig) -> std::collections::BTreeSet<String> {
    config
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
        .filter(|value| value.enabled)
        .map(|value| value.normalizer_id.clone())
        .collect()
}

fn structure_family_for_extension(extension: &str) -> StructureFileFamily {
    match extension
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "rs" | "py" | "go" | "java" | "kt"
        | "kts" | "swift" | "c" | "h" | "cc" | "cpp" | "cs" | "rb" | "php" | "sh" | "bash"
        | "zsh" => StructureFileFamily::Code,
        "md" | "markdown" | "txt" | "rst" | "adoc" => StructureFileFamily::Document,
        "html" | "htm" | "css" | "scss" | "sass" | "less" | "svg" | "xml" => {
            StructureFileFamily::MarkupStyle
        }
        "json" | "jsonl" | "yaml" | "yml" | "toml" | "ini" | "properties" => {
            StructureFileFamily::StructuredData
        }
        "csv" | "tsv" => StructureFileFamily::Tabular,
        "pdf" | "doc" | "docx" | "ppt" | "pptx" => StructureFileFamily::RichDocument,
        _ => StructureFileFamily::Other,
    }
}

fn scope_query(page: PageRequest, query: &LayerQuery) -> ScopeQuery {
    ScopeQuery {
        page,
        text: query.text.clone(),
        review_status: query.review_status,
    }
}

fn parse_optional<T: DeserializeOwned>(value: Option<&str>, name: &str) -> AdminResult<Option<T>> {
    value
        .map(|value| {
            serde_json::from_value(Value::String(value.to_owned()))
                .map_err(|error| AdminError::Invalid(format!("invalid {name}: {error}")))
        })
        .transpose()
}

async fn scope_lineage(
    store: &SqliteStore,
) -> AdminResult<(
    BTreeMap<RevisionRef, Vec<RevisionRef>>,
    BTreeMap<RevisionRef, RevisionRef>,
)> {
    let mut lineage = BTreeMap::new();
    let mut source_snapshots = BTreeMap::new();

    for snapshot in store.list_snapshots().await.map_err(invalid)? {
        lineage
            .entry(snapshot.revision_ref.clone())
            .or_insert_with(Vec::new);
        source_snapshots.insert(snapshot.revision_ref.clone(), snapshot.revision_ref);
    }
    for normalized in store.list_normalized().await.map_err(invalid)? {
        lineage.insert(
            normalized.revision_ref.clone(),
            vec![normalized.source_snapshot.clone()],
        );
        source_snapshots.insert(normalized.revision_ref, normalized.source_snapshot);
    }
    for structure in store.list_structures().await.map_err(invalid)? {
        let mut parents = structure.trace.parents.clone();
        if parents.is_empty() {
            parents.push(structure.trace.source_snapshot.clone());
        }
        lineage.insert(structure.revision_ref.clone(), parents);
        source_snapshots.insert(structure.revision_ref, structure.trace.source_snapshot);
    }
    for evidence in store.list_evidence().await.map_err(invalid)? {
        let mut parents = evidence.trace.parents.clone();
        if parents.is_empty() {
            parents.extend(evidence.structure_refs.clone());
        }
        lineage.insert(evidence.revision_ref.clone(), parents);
        source_snapshots.insert(evidence.revision_ref, evidence.trace.source_snapshot);
    }
    for fact in store.list_facts().await.map_err(invalid)? {
        let mut parents = fact.trace.parents.clone();
        if parents.is_empty() {
            parents.extend(fact.evidence.iter().map(|link| link.evidence_ref.clone()));
        }
        lineage.insert(fact.revision_ref.clone(), parents);
        source_snapshots.insert(fact.revision_ref, fact.trace.source_snapshot);
    }
    Ok((lineage, source_snapshots))
}

fn stable_scope_key(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn invalid(error: impl std::fmt::Display) -> AdminError {
    AdminError::Invalid(error.to_string())
}

fn progress_percent(processed: usize, total: usize) -> usize {
    if total == 0 {
        100
    } else {
        processed.min(total).saturating_mul(100) / total
    }
}

fn revision_key(value: &Value) -> Option<String> {
    let reference = value.get("revisionRef")?;
    Some(format!(
        "{}@{}",
        reference.get("entity")?.get("id")?.as_str()?,
        reference.get("revision")?.as_str()?
    ))
}

fn parent_keys(value: &Value) -> Vec<String> {
    let mut parents = value
        .get("trace")
        .and_then(|trace| trace.get("parents"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|reference| {
            Some(format!(
                "{}@{}",
                reference.get("entity")?.get("id")?.as_str()?,
                reference.get("revision")?.as_str()?
            ))
        })
        .collect::<Vec<_>>();
    if let Some(reference) = value.get("sourceSnapshot")
        && let (Some(id), Some(revision)) = (
            reference
                .get("entity")
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str),
            reference.get("revision").and_then(Value::as_str),
        )
    {
        parents.push(format!("{id}@{revision}"));
    }
    parents
}

fn traverse_lineage(
    root: &str,
    records: &BTreeMap<String, Value>,
    towards_parents: bool,
) -> Vec<Value> {
    let mut seen = BTreeSet::new();
    let mut pending = vec![root.to_owned()];
    let mut result = Vec::new();
    while let Some(key) = pending.pop() {
        let neighbours = if towards_parents {
            records.get(&key).map(parent_keys).unwrap_or_default()
        } else {
            records
                .iter()
                .filter(|(_, value)| parent_keys(value).contains(&key))
                .map(|(child, _)| child.clone())
                .collect()
        };
        for neighbour in neighbours {
            if seen.insert(neighbour.clone())
                && let Some(value) = records.get(&neighbour)
            {
                result.push(value.clone());
                pending.push(neighbour);
            }
        }
    }
    result
}

struct NoSecrets;

impl SecretProvider for NoSecrets {
    fn get(&self, _secret_ref: &SecretRef) -> ConnectorFuture<'_, Option<Vec<u8>>> {
        Box::pin(async { Ok(None) })
    }
}
