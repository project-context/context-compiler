use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::Path;
use axum::extract::Query;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::http::HeaderValue;
use axum::http::Method;
use axum::http::Request;
use axum::http::StatusCode;
use axum::middleware;
use axum::middleware::Next;
use axum::response::IntoResponse;
use axum::response::Response;
use axum::response::sse::Event;
use axum::response::sse::KeepAlive;
use axum::response::sse::Sse;
use axum::routing::delete;
use axum::routing::get;
use axum::routing::post;
use context_protocol::ArtifactRef;
use context_protocol::EntityRef;
use context_protocol::Layer;
use context_protocol::RevisionRef;
use context_query::ContextRequest;
use context_scope::ScopeAssignment;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa::ToSchema;
use utoipa_swagger_ui::SwaggerUi;
use uuid::Uuid;

use crate::AdminBackend;
use crate::AdminError;
use crate::ApiError;
use crate::ApiErrorBody;
use crate::ArtifactPreviewRequest;
use crate::BuildEvent;
use crate::LayerCollection;
use crate::LayerQuery;
use crate::ManualScopeAssignmentRequest;
use crate::NormalizationPreviewRequest;
use crate::NormalizationResolveRequest;
use crate::PipelineRunRequest;
use crate::ReviewCommand;
use crate::ScopeContextView;
use crate::WorkspaceFileEntry;
use crate::WorkspaceFileKind;

#[derive(Clone)]
pub struct AdminApiState {
    backend: Arc<dyn AdminBackend>,
    csrf_token: String,
}

impl AdminApiState {
    pub fn new(backend: Arc<dyn AdminBackend>) -> Self {
        Self {
            backend,
            csrf_token: Uuid::now_v7().to_string(),
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    paths(
        session,
        list_workspaces,
        register_workspace,
        unregister_workspace,
        doctor,
        list_workspace_files,
        list_sources,
        get_config,
        save_config,
        connector_catalog,
        test_source,
        discover_source,
        normalizer_catalog,
        normalization_resolve,
        normalization_preview,
        artifact_preview,
        structure_parser_catalog,
        get_structure_config,
        save_structure_config,
        structure_build_units,
        structure_build_relations,
        resolve_structure,
        list_builds,
        start_build,
        get_build,
        cancel_build,
        build_events,
        list_layer,
        list_scope_resource,
        scope_context,
        assign_scope,
        lineage,
        list_reviews,
        review,
        context_query
    ),
    components(schemas(
        ApiErrorBody,
        SessionResponse,
        RegisterWorkspaceRequest,
        ConfigEnvelope,
        SaveConfigRequest,
        BuildRequest,
        EntityRefBody,
        RevisionRefBody,
        ManualScopeAssignmentBody,
        WorkspaceFileEntryBody,
        ArtifactPreviewRequestBody,
        ArtifactPreviewResponseBody,
        SaveStructureConfigRequest
    )),
    tags((name = "context-admin", description = "Local Context Compiler management API"))
)]
pub struct ApiDoc;

pub fn router(backend: Arc<dyn AdminBackend>) -> Router {
    let state = AdminApiState::new(backend);
    let api = Router::new()
        .route("/session", get(session))
        .route("/workspaces", get(list_workspaces).post(register_workspace))
        .route("/workspaces/{workspace_id}", delete(unregister_workspace))
        .route("/workspaces/{workspace_id}/doctor", get(doctor))
        .route(
            "/workspaces/{workspace_id}/files",
            get(list_workspace_files),
        )
        .route(
            "/workspaces/{workspace_id}/config",
            get(get_config).put(save_config),
        )
        .route(
            "/workspaces/{workspace_id}/connectors",
            get(connector_catalog),
        )
        .route("/workspaces/{workspace_id}/sources", get(list_sources))
        .route(
            "/workspaces/{workspace_id}/sources/{source_id}/test",
            post(test_source),
        )
        .route(
            "/workspaces/{workspace_id}/sources/{source_id}/discover",
            get(discover_source),
        )
        .route(
            "/workspaces/{workspace_id}/normalizers",
            get(normalizer_catalog),
        )
        .route(
            "/workspaces/{workspace_id}/normalization/resolve",
            post(normalization_resolve),
        )
        .route(
            "/workspaces/{workspace_id}/normalization/preview",
            post(normalization_preview),
        )
        .route(
            "/workspaces/{workspace_id}/artifacts/preview",
            post(artifact_preview),
        )
        .route(
            "/workspaces/{workspace_id}/structure/parsers",
            get(structure_parser_catalog),
        )
        .route(
            "/workspaces/{workspace_id}/structure/config",
            get(get_structure_config).put(save_structure_config),
        )
        .route(
            "/workspaces/{workspace_id}/structure/builds/{build_ref}/units",
            get(structure_build_units),
        )
        .route(
            "/workspaces/{workspace_id}/structure/builds/{build_ref}/relations",
            get(structure_build_relations),
        )
        .route(
            "/workspaces/{workspace_id}/structure/resolve/{kind}/{local_id}",
            get(resolve_structure),
        )
        .route(
            "/workspaces/{workspace_id}/builds",
            get(list_builds).post(start_build),
        )
        .route("/workspaces/{workspace_id}/builds/{job_id}", get(get_build))
        .route(
            "/workspaces/{workspace_id}/builds/{job_id}/cancel",
            post(cancel_build),
        )
        .route(
            "/workspaces/{workspace_id}/builds/{job_id}/events",
            get(build_events),
        )
        .route(
            "/workspaces/{workspace_id}/layers/{collection}",
            get(list_layer),
        )
        .route("/workspaces/{workspace_id}/snapshots", get(list_snapshots))
        .route(
            "/workspaces/{workspace_id}/normalized-sources",
            get(list_normalized_sources),
        )
        .route(
            "/workspaces/{workspace_id}/structures",
            get(list_structures),
        )
        .route("/workspaces/{workspace_id}/evidence", get(list_evidence))
        .route("/workspaces/{workspace_id}/facts", get(list_facts))
        .route(
            "/workspaces/{workspace_id}/scope/{resource}",
            get(list_scope_resource),
        )
        .route(
            "/workspaces/{workspace_id}/scope/context",
            get(scope_context),
        )
        .route(
            "/workspaces/{workspace_id}/scope/assignments",
            post(assign_scope),
        )
        .route(
            "/workspaces/{workspace_id}/semantic-edges",
            get(list_semantic_edges),
        )
        .route(
            "/workspaces/{workspace_id}/lineage/{layer}/{entity_id}/{revision}",
            get(lineage),
        )
        .route("/workspaces/{workspace_id}/reviews", get(list_reviews))
        .route("/workspaces/{workspace_id}/reviews/decide", post(review))
        .route("/workspaces/{workspace_id}/context", post(context_query))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_csrf))
        .with_state(state);

    Router::new()
        .nest("/api/v1", api)
        .merge(SwaggerUi::new("/docs").url("/openapi.json", ApiDoc::openapi()))
        .layer(TraceLayer::new_for_http())
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    csrf_token: String,
}

#[utoipa::path(get, path = "/api/v1/session", responses((status = 200, body = SessionResponse)))]
async fn session(State(state): State<AdminApiState>) -> Json<SessionResponse> {
    Json(SessionResponse {
        csrf_token: state.csrf_token,
    })
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct RegisterWorkspaceRequest {
    #[schema(value_type = String)]
    root: PathBuf,
}

#[utoipa::path(
    get,
    path = "/api/v1/workspaces",
    responses((status = 200, description = "Registered workspaces"), (status = 500, body = ApiErrorBody))
)]
async fn list_workspaces(State(state): State<AdminApiState>) -> Result<Json<Value>, ApiError> {
    let values = state.backend.list_workspaces().await?;
    Ok(Json(to_value(values)?))
}

#[utoipa::path(
    post,
    path = "/api/v1/workspaces",
    request_body = RegisterWorkspaceRequest,
    responses((status = 201, description = "Workspace registered"), (status = 400, body = ApiErrorBody))
)]
async fn register_workspace(
    State(state): State<AdminApiState>,
    Json(request): Json<RegisterWorkspaceRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let value = state.backend.register_workspace(request.root).await?;
    Ok((StatusCode::CREATED, Json(to_value(value)?)))
}

#[utoipa::path(delete, path = "/api/v1/workspaces/{workspace_id}", params(("workspace_id" = String, Path)), responses((status = 204, description = "Workspace unregistered")))]
async fn unregister_workspace(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.backend.unregister_workspace(workspace_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/doctor", params(("workspace_id" = String, Path)), responses((status = 200, description = "Workspace health report")))]
async fn doctor(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.backend.doctor(workspace_id).await?))
}

#[derive(Clone, Debug, Default, Deserialize)]
struct WorkspaceFilesQuery {
    #[serde(default)]
    path: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileEntryBody {
    name: String,
    path: String,
    kind: String,
    size_bytes: u64,
    modified_at_ms: Option<u64>,
}

impl From<WorkspaceFileEntry> for WorkspaceFileEntryBody {
    fn from(value: WorkspaceFileEntry) -> Self {
        let kind = match value.kind {
            WorkspaceFileKind::Directory => "directory",
            WorkspaceFileKind::File => "file",
            WorkspaceFileKind::Symlink => "symlink",
            WorkspaceFileKind::Other => "other",
        };
        Self {
            name: value.name,
            path: value.path,
            kind: kind.to_owned(),
            size_bytes: value.size_bytes,
            modified_at_ms: value.modified_at_ms,
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/workspaces/{workspace_id}/files",
    params(
        ("workspace_id" = String, Path),
        ("path" = Option<String>, Query, description = "Workspace-relative directory path")
    ),
    responses(
        (status = 200, body = [WorkspaceFileEntryBody]),
        (status = 400, body = ApiErrorBody),
        (status = 404, body = ApiErrorBody)
    )
)]
async fn list_workspace_files(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<WorkspaceFilesQuery>,
) -> Result<Json<Vec<WorkspaceFileEntryBody>>, ApiError> {
    let values = state
        .backend
        .list_workspace_files(workspace_id, query.path)
        .await?;
    Ok(Json(values.into_iter().map(Into::into).collect()))
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ConfigEnvelope {
    config: Value,
    etag: String,
    persisted: bool,
    imported_legacy: bool,
}

#[utoipa::path(
    get,
    path = "/api/v1/workspaces/{workspace_id}/config",
    params(("workspace_id" = String, Path)),
    responses((status = 200, body = ConfigEnvelope), (status = 404, body = ApiErrorBody))
)]
async fn get_config(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
) -> Result<Response, ApiError> {
    let loaded = state.backend.get_config(workspace_id).await?;
    let envelope = ConfigEnvelope {
        config: to_value(loaded.config)?,
        etag: loaded.etag.clone(),
        persisted: loaded.persisted,
        imported_legacy: loaded.imported_legacy,
    };
    let mut response = Json(envelope).into_response();
    response.headers_mut().insert(
        axum::http::header::ETAG,
        HeaderValue::from_str(&loaded.etag)
            .map_err(|error| ApiError::internal(error.to_string()))?,
    );
    Ok(response)
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct SaveConfigRequest {
    config: Value,
}

#[utoipa::path(
    put,
    path = "/api/v1/workspaces/{workspace_id}/config",
    params(("workspace_id" = String, Path)),
    request_body = SaveConfigRequest,
    responses((status = 200, description = "Configuration saved"), (status = 409, body = ApiErrorBody))
)]
async fn save_config(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<SaveConfigRequest>,
) -> Result<Response, ApiError> {
    let config = serde_json::from_value(request.config)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let expected = headers
        .get(axum::http::header::IF_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| ApiError::precondition_required("If-Match header is required"))?;
    let etag = state
        .backend
        .save_config(workspace_id, config, Some(expected))
        .await?;
    let mut response = Json(serde_json::json!({ "etag": etag })).into_response();
    response.headers_mut().insert(
        axum::http::header::ETAG,
        HeaderValue::from_str(&etag).map_err(|error| ApiError::internal(error.to_string()))?,
    );
    Ok(response)
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/connectors", params(("workspace_id" = String, Path)), responses((status = 200, description = "Connector catalog")))]
async fn connector_catalog(
    State(state): State<AdminApiState>,
    Path(_workspace_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(state.backend.connector_catalog().await?)?))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/sources", params(("workspace_id" = String, Path)), responses((status = 200, description = "Configured source definitions")))]
async fn list_sources(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let loaded = state.backend.get_config(workspace_id).await?;
    Ok(Json(to_value(loaded.config.sources)?))
}

#[utoipa::path(post, path = "/api/v1/workspaces/{workspace_id}/sources/{source_id}/test", params(("workspace_id" = String, Path), ("source_id" = String, Path)), responses((status = 200, description = "Connection test")))]
async fn test_source(
    State(state): State<AdminApiState>,
    Path((workspace_id, source_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(
        state.backend.test_source(workspace_id, source_id).await?,
    )?))
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryQuery {
    cursor: Option<String>,
    limit: Option<u16>,
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/sources/{source_id}/discover", params(("workspace_id" = String, Path), ("source_id" = String, Path)), responses((status = 200, description = "Discovered source objects")))]
async fn discover_source(
    State(state): State<AdminApiState>,
    Path((workspace_id, source_id)): Path<(String, String)>,
    Query(query): Query<DiscoveryQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(
        state
            .backend
            .discover_source(workspace_id, source_id, query.cursor, query.limit)
            .await?,
    )?))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/normalizers", params(("workspace_id" = String, Path)), responses((status = 200, description = "Normalizer catalog")))]
async fn normalizer_catalog(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(
        state.backend.normalizer_catalog(workspace_id).await?,
    )?))
}

#[utoipa::path(post, path = "/api/v1/workspaces/{workspace_id}/normalization/preview", params(("workspace_id" = String, Path)), responses((status = 200, description = "Read-only normalization preview")))]
async fn normalization_preview(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Json(request): Json<NormalizationPreviewRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(
        state
            .backend
            .preview_normalization(workspace_id, request)
            .await?,
    )?))
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ArtifactPreviewRequestBody {
    artifact_uri: String,
    max_chars: Option<usize>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ArtifactPreviewResponseBody {
    content: String,
    truncated: bool,
    characters: usize,
}

#[utoipa::path(
    post,
    path = "/api/v1/workspaces/{workspace_id}/artifacts/preview",
    params(("workspace_id" = String, Path)),
    request_body = ArtifactPreviewRequestBody,
    responses(
        (status = 200, body = ArtifactPreviewResponseBody, description = "UTF-8 Artifact content preview"),
        (status = 400, body = ApiErrorBody),
        (status = 404, body = ApiErrorBody)
    )
)]
async fn artifact_preview(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Json(request): Json<ArtifactPreviewRequestBody>,
) -> Result<Json<ArtifactPreviewResponseBody>, ApiError> {
    let preview = state
        .backend
        .preview_artifact(
            workspace_id,
            ArtifactPreviewRequest {
                artifact: ArtifactRef::new(request.artifact_uri),
                max_chars: request.max_chars,
            },
        )
        .await?;
    Ok(Json(ArtifactPreviewResponseBody {
        content: preview.content,
        truncated: preview.truncated,
        characters: preview.characters,
    }))
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct SaveStructureConfigRequest {
    #[schema(value_type = Object)]
    policy: Value,
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/structure/parsers", params(("workspace_id" = String, Path)), responses((status = 200, description = "Installed Structure Parser catalog")))]
async fn structure_parser_catalog(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(
        state.backend.structure_parser_catalog(workspace_id).await?,
    )?))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/structure/config", params(("workspace_id" = String, Path)), responses((status = 200, description = "Grouped Structure routing configuration")))]
async fn get_structure_config(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let value = state.backend.structure_config(workspace_id).await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::ETAG,
        HeaderValue::from_str(&value.etag)
            .map_err(|error| ApiError::from(crate::AdminError::Invalid(error.to_string())))?,
    );
    Ok((headers, Json(to_value(value)?)))
}

#[utoipa::path(put, path = "/api/v1/workspaces/{workspace_id}/structure/config", params(("workspace_id" = String, Path)), request_body = SaveStructureConfigRequest, responses((status = 200, description = "Saved Structure routing configuration"), (status = 409, body = ApiErrorBody)))]
async fn save_structure_config(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<SaveStructureConfigRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let expected_etag = headers
        .get(axum::http::header::IF_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let policy = serde_json::from_value(request.policy).map_err(|error| {
        ApiError::from(crate::AdminError::Invalid(format!(
            "invalid structure policy: {error}"
        )))
    })?;
    let value = state
        .backend
        .save_structure_config(workspace_id, policy, expected_etag)
        .await?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        axum::http::header::ETAG,
        HeaderValue::from_str(&value.etag)
            .map_err(|error| ApiError::from(crate::AdminError::Invalid(error.to_string())))?,
    );
    Ok((response_headers, Json(to_value(value)?)))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/structure/builds/{build_ref}/units", params(("workspace_id" = String, Path), ("build_ref" = String, Path)), responses((status = 200, description = "Paged Structure units for one build")))]
async fn structure_build_units(
    State(state): State<AdminApiState>,
    Path((workspace_id, build_ref)): Path<(String, String)>,
    Query(query): Query<LayerQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .backend
            .structure_build_units(workspace_id, build_ref, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/structure/builds/{build_ref}/relations", params(("workspace_id" = String, Path), ("build_ref" = String, Path)), responses((status = 200, description = "Paged Structure relations for one build")))]
async fn structure_build_relations(
    State(state): State<AdminApiState>,
    Path((workspace_id, build_ref)): Path<(String, String)>,
    Query(query): Query<LayerQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .backend
            .structure_build_relations(workspace_id, build_ref, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/structure/resolve/{kind}/{local_id}", params(("workspace_id" = String, Path), ("kind" = String, Path), ("local_id" = String, Path)), responses((status = 200, description = "Resolved Structure unit text and graph context"), (status = 404, body = ApiErrorBody)))]
async fn resolve_structure(
    State(state): State<AdminApiState>,
    Path((workspace_id, kind, local_id)): Path<(String, String, String)>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .backend
            .resolve_structure(workspace_id, kind, local_id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v1/workspaces/{workspace_id}/normalization/resolve", params(("workspace_id" = String, Path)), responses((status = 200, description = "Resolved normalization route")))]
async fn normalization_resolve(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Json(request): Json<NormalizationResolveRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .backend
            .resolve_normalization(workspace_id, request)
            .await?,
    ))
}

#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct BuildRequest {
    #[serde(default)]
    full: bool,
    #[serde(default)]
    source_ids: Vec<String>,
    #[serde(default = "default_build_from_stage")]
    #[schema(value_type = String, example = "normalize")]
    from_stage: crate::BuildStage,
    #[serde(default = "default_build_to_stage")]
    #[schema(value_type = String, example = "structure")]
    to_stage: crate::BuildStage,
    #[serde(default)]
    resume_processed: Option<usize>,
    #[serde(default)]
    resume_total: Option<usize>,
}

fn default_build_from_stage() -> crate::BuildStage {
    crate::BuildStage::Capture
}

fn default_build_to_stage() -> crate::BuildStage {
    crate::BuildStage::Project
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/builds", params(("workspace_id" = String, Path)), responses((status = 200, description = "Build jobs")))]
async fn list_builds(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(
        state.backend.jobs().list(&workspace_id).await,
    )?))
}

#[utoipa::path(
    post,
    path = "/api/v1/workspaces/{workspace_id}/builds",
    params(("workspace_id" = String, Path)),
    request_body = BuildRequest,
    responses((status = 202, description = "Build accepted"), (status = 409, body = ApiErrorBody))
)]
async fn start_build(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Json(request): Json<BuildRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let job = state
        .backend
        .start_build(
            workspace_id,
            PipelineRunRequest {
                full: request.full,
                source_ids: request.source_ids,
                from_stage: request.from_stage,
                to_stage: request.to_stage,
                resume_processed: request.resume_processed,
                resume_total: request.resume_total,
            },
        )
        .await?;
    Ok((StatusCode::ACCEPTED, Json(to_value(job)?)))
}

#[utoipa::path(
    get,
    path = "/api/v1/workspaces/{workspace_id}/builds/{job_id}",
    params(("workspace_id" = String, Path), ("job_id" = String, Path)),
    responses((status = 200, description = "Build job"), (status = 404, body = ApiErrorBody))
)]
async fn get_build(
    State(state): State<AdminApiState>,
    Path((_workspace_id, job_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let job = state
        .backend
        .jobs()
        .get(&job_id)
        .await
        .ok_or_else(|| ApiError::from(AdminError::NotFound(job_id)))?;
    Ok(Json(to_value(job)?))
}

#[utoipa::path(
    post,
    path = "/api/v1/workspaces/{workspace_id}/builds/{job_id}/cancel",
    params(("workspace_id" = String, Path), ("job_id" = String, Path)),
    responses((status = 200, description = "Cancellation requested"), (status = 409, body = ApiErrorBody))
)]
async fn cancel_build(
    State(state): State<AdminApiState>,
    Path((_workspace_id, job_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(state.backend.jobs().cancel(&job_id).await?)?))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/builds/{job_id}/events", params(("workspace_id" = String, Path), ("job_id" = String, Path)), responses((status = 200, description = "SSE event stream")))]
async fn build_events(
    State(state): State<AdminApiState>,
    Path((_workspace_id, job_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let after = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let jobs = state.backend.jobs();
    let replay = jobs.events(&job_id, after).await;
    let live_job_id = job_id.clone();
    let live = BroadcastStream::new(jobs.subscribe()).filter_map(move |result| match result {
        Ok(event) if event.job_id == live_job_id => Some(event),
        _ => None,
    });
    let stream = tokio_stream::iter(replay)
        .chain(live)
        .map(|event| Ok(sse_event(event)));
    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn sse_event(event: BuildEvent) -> Event {
    let data = serde_json::to_string(&event)
        .unwrap_or_else(|error| serde_json::json!({ "error": error.to_string() }).to_string());
    Event::default()
        .id(event.sequence.to_string())
        .event("build")
        .data(data)
}

#[utoipa::path(
    get,
    path = "/api/v1/workspaces/{workspace_id}/layers/{collection}",
    params(("workspace_id" = String, Path), ("collection" = String, Path), LayerQuery),
    responses((status = 200, description = "Layer page"), (status = 400, body = ApiErrorBody))
)]
async fn list_layer(
    State(state): State<AdminApiState>,
    Path((workspace_id, collection)): Path<(String, LayerCollection)>,
    Query(query): Query<LayerQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .backend
            .list_layer(workspace_id, collection, query)
            .await?,
    ))
}

async fn named_layer(
    state: AdminApiState,
    workspace_id: String,
    collection: LayerCollection,
    query: LayerQuery,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .backend
            .list_layer(workspace_id, collection, query)
            .await?,
    ))
}

macro_rules! layer_handler {
    ($name:ident, $collection:expr) => {
        async fn $name(
            State(state): State<AdminApiState>,
            Path(workspace_id): Path<String>,
            Query(query): Query<LayerQuery>,
        ) -> Result<Json<Value>, ApiError> {
            named_layer(state, workspace_id, $collection, query).await
        }
    };
}

layer_handler!(list_snapshots, LayerCollection::Snapshots);
layer_handler!(list_normalized_sources, LayerCollection::NormalizedSources);
layer_handler!(list_structures, LayerCollection::Structures);
layer_handler!(list_evidence, LayerCollection::Evidence);
layer_handler!(list_facts, LayerCollection::Facts);
layer_handler!(list_semantic_edges, LayerCollection::SemanticEdges);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScopeContextQuery {
    layer: Layer,
    entity_id: String,
    revision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct EntityRefBody {
    layer: String,
    id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct RevisionRefBody {
    entity: EntityRefBody,
    revision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ManualScopeAssignmentBody {
    target: RevisionRefBody,
    dimension: String,
    scope_key: String,
    label: String,
    /// `inherit` or `local_only`.
    propagation: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/workspaces/{workspace_id}/scope/context",
    params(
        ("workspace_id" = String, Path),
        ("layer" = String, Query),
        ("entityId" = String, Query),
        ("revision" = String, Query)
    ),
    responses((status = 200, description = "Direct and effective Scope for one revision"), (status = 404, body = ApiErrorBody))
)]
async fn scope_context(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Query(query): Query<ScopeContextQuery>,
) -> Result<Json<ScopeContextView>, ApiError> {
    let target = RevisionRef::new(EntityRef::new(query.layer, query.entity_id), query.revision);
    Ok(Json(
        state.backend.scope_context(workspace_id, target).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/workspaces/{workspace_id}/scope/assignments",
    params(("workspace_id" = String, Path)),
    request_body = ManualScopeAssignmentBody,
    responses((status = 200, description = "Confirmed manual ScopeAssignment"), (status = 400, body = ApiErrorBody), (status = 404, body = ApiErrorBody))
)]
async fn assign_scope(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<ManualScopeAssignmentBody>,
) -> Result<Json<ScopeAssignment>, ApiError> {
    let layer = match body.target.entity.layer.as_str() {
        "source" => Layer::Source,
        "structure" => Layer::Structure,
        "evidence" => Layer::Evidence,
        "fact" => Layer::Fact,
        value => return Err(ApiError::bad_request(format!("unknown layer: {value}"))),
    };
    let propagation = match body.propagation.as_str() {
        "inherit" => context_scope::Propagation::Inherit,
        "local_only" => context_scope::Propagation::LocalOnly,
        value => {
            return Err(ApiError::bad_request(format!(
                "unknown propagation: {value}"
            )));
        }
    };
    let request = ManualScopeAssignmentRequest {
        target: RevisionRef::new(
            EntityRef::new(layer, body.target.entity.id),
            body.target.revision,
        ),
        dimension: body.dimension,
        scope_key: body.scope_key,
        label: body.label,
        propagation,
    };
    Ok(Json(
        state.backend.assign_scope(workspace_id, request).await?,
    ))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/scope/{resource}", params(("workspace_id" = String, Path), ("resource" = String, Path)), responses((status = 200, description = "Scope resource page")))]
async fn list_scope_resource(
    State(state): State<AdminApiState>,
    Path((workspace_id, resource)): Path<(String, String)>,
    Query(query): Query<LayerQuery>,
) -> Result<Json<Value>, ApiError> {
    let collection = match resource.as_str() {
        "dimensions" => LayerCollection::ScopeDimensions,
        "scopes" => LayerCollection::Scopes,
        "assignments" => LayerCollection::ScopeAssignments,
        "blocks" => LayerCollection::ScopeBlocks,
        "relations" => LayerCollection::ScopeRelations,
        "decisions" => LayerCollection::ScopeDecisions,
        _ => {
            return Err(ApiError::bad_request(format!(
                "unknown Scope resource: {resource}"
            )));
        }
    };
    named_layer(state, workspace_id, collection, query).await
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/lineage/{layer}/{entity_id}/{revision}", params(("workspace_id" = String, Path), ("layer" = String, Path), ("entity_id" = String, Path), ("revision" = String, Path)), responses((status = 200, description = "Cross-layer lineage")))]
async fn lineage(
    State(state): State<AdminApiState>,
    Path((workspace_id, _layer, entity_id, revision)): Path<(String, String, String, String)>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .backend
            .lineage(workspace_id, entity_id, revision)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v1/workspaces/{workspace_id}/reviews", params(("workspace_id" = String, Path)), responses((status = 200, description = "Candidate review page")))]
async fn list_reviews(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Query(mut query): Query<LayerQuery>,
) -> Result<Json<Value>, ApiError> {
    query.review_status = Some(context_protocol::ReviewStatus::Candidate);
    query.limit = Some(query.limit.unwrap_or(200).min(200));
    let mut items = Vec::new();
    for collection in [
        LayerCollection::ScopeAssignments,
        LayerCollection::ScopeBlocks,
        LayerCollection::ScopeRelations,
        LayerCollection::SemanticEdges,
    ] {
        let page = state
            .backend
            .list_layer(workspace_id.clone(), collection, query.clone())
            .await?;
        if let Some(values) = page.get("items").and_then(Value::as_array) {
            items.extend(values.iter().cloned());
        }
    }
    Ok(Json(
        serde_json::json!({ "items": items, "nextCursor": null }),
    ))
}

#[utoipa::path(post, path = "/api/v1/workspaces/{workspace_id}/reviews/decide", params(("workspace_id" = String, Path)), responses((status = 200, description = "Atomic review decision"), (status = 409, body = ApiErrorBody)))]
async fn review(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Json(command): Json<ReviewCommand>,
) -> Result<Json<Value>, ApiError> {
    command.validate().map_err(ApiError::bad_request)?;
    Ok(Json(state.backend.review(workspace_id, command).await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/workspaces/{workspace_id}/context",
    params(("workspace_id" = String, Path)),
    responses((status = 200, description = "Context view"), (status = 400, body = ApiErrorBody))
)]
async fn context_query(
    State(state): State<AdminApiState>,
    Path(workspace_id): Path<String>,
    Json(request): Json<ContextRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(to_value(
        state.backend.context(workspace_id, request).await?,
    )?))
}

async fn require_csrf(
    State(state): State<AdminApiState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, ApiError> {
    if matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) && request
        .headers()
        .get("x-context-csrf")
        .and_then(|value| value.to_str().ok())
        != Some(state.csrf_token.as_str())
    {
        return Err(ApiError::new_forbidden("missing or invalid CSRF token"));
    }
    if let Some(origin) = request
        .headers()
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        && !origin.starts_with("http://127.0.0.1:")
        && !origin.starts_with("http://localhost:")
    {
        return Err(ApiError::new_forbidden(
            "cross-origin write request rejected",
        ));
    }
    Ok(next.run(request).await)
}

fn to_value(value: impl Serialize) -> Result<Value, ApiError> {
    serde_json::to_value(value).map_err(|error| ApiError::internal(error.to_string()))
}

impl ApiError {
    fn new_forbidden(message: impl Into<String>) -> Self {
        Self::forbidden(message)
    }
}
