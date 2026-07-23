use std::sync::Arc;

use axum::body::Body;
use axum::body::to_bytes;
use axum::http::Request;
use axum::http::StatusCode;
use context_admin_backend::ServerBackend;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn local_api_requires_csrf_and_registers_a_workspace()
-> Result<(), Box<dyn std::error::Error>> {
    let home = tempfile::tempdir()?;
    let project = tempfile::tempdir()?;
    std::fs::create_dir(project.path().join("docs"))?;
    std::fs::write(project.path().join("docs/guide.md"), "# Guide")?;
    let backend = Arc::new(ServerBackend::new(home.path().to_path_buf()).await?);
    let app = context_admin_backend::router(backend);

    let rejected = app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "root": project.path() }).to_string(),
                ))?,
        )
        .await?;
    assert_eq!(rejected.status(), StatusCode::FORBIDDEN);

    let session = app
        .clone()
        .oneshot(Request::get("/api/v1/session").body(Body::empty())?)
        .await?;
    let session: Value = serde_json::from_slice(&to_bytes(session.into_body(), 64 * 1024).await?)?;
    let csrf = session["csrfToken"].as_str().ok_or("missing CSRF token")?;

    let registered = app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces")
                .header("content-type", "application/json")
                .header("origin", "http://127.0.0.1:7798")
                .header("x-context-csrf", csrf)
                .body(Body::from(
                    serde_json::json!({ "root": project.path() }).to_string(),
                ))?,
        )
        .await?;
    assert_eq!(registered.status(), StatusCode::CREATED);
    let registered: Value =
        serde_json::from_slice(&to_bytes(registered.into_body(), 64 * 1024).await?)?;
    let workspace_id = registered["workspaceId"]
        .as_str()
        .ok_or("missing workspace ID")?;

    let workspaces = app
        .clone()
        .oneshot(Request::get("/api/v1/workspaces").body(Body::empty())?)
        .await?;
    let values: Value =
        serde_json::from_slice(&to_bytes(workspaces.into_body(), 64 * 1024).await?)?;
    assert_eq!(values.as_array().map(Vec::len), Some(1));

    let root_files = app
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/workspaces/{workspace_id}/files")).body(Body::empty())?,
        )
        .await?;
    assert_eq!(root_files.status(), StatusCode::OK);
    let root_files: Value =
        serde_json::from_slice(&to_bytes(root_files.into_body(), 64 * 1024).await?)?;
    assert!(root_files.as_array().is_some_and(|values| {
        values
            .iter()
            .any(|entry| entry["name"] == "docs" && entry["kind"] == "directory")
    }));

    let docs = app
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/workspaces/{workspace_id}/files?path=docs"))
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(docs.status(), StatusCode::OK);
    let docs: Value = serde_json::from_slice(&to_bytes(docs.into_body(), 64 * 1024).await?)?;
    assert_eq!(docs[0]["path"], "docs/guide.md");
    assert_eq!(docs[0]["kind"], "file");

    let escaped = app
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/workspaces/{workspace_id}/files?path=.."))
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(escaped.status(), StatusCode::BAD_REQUEST);

    let build = app
        .clone()
        .oneshot(
            Request::post(format!("/api/v1/workspaces/{workspace_id}/builds"))
                .header("content-type", "application/json")
                .header("x-context-csrf", csrf)
                .body(Body::from(
                    serde_json::json!({
                        "full": false,
                        "sourceIds": ["workspace"],
                        "fromStage": "semantic",
                        "toStage": "semantic"
                    })
                    .to_string(),
                ))?,
        )
        .await?;
    assert_eq!(build.status(), StatusCode::ACCEPTED);
    let build: Value = serde_json::from_slice(&to_bytes(build.into_body(), 64 * 1024).await?)?;
    assert_eq!(build["request"]["fromStage"], "semantic");
    assert_eq!(build["request"]["toStage"], "semantic");
    assert_eq!(build["request"]["sourceIds"][0], "workspace");

    let openapi = app
        .oneshot(Request::get("/openapi.json").body(Body::empty())?)
        .await?;
    assert_eq!(openapi.status(), StatusCode::OK);
    let document: Value =
        serde_json::from_slice(&to_bytes(openapi.into_body(), 2 * 1024 * 1024).await?)?;
    for path in [
        "/api/v1/workspaces",
        "/api/v1/workspaces/{workspace_id}/files",
        "/api/v1/workspaces/{workspace_id}/config",
        "/api/v1/workspaces/{workspace_id}/normalization/preview",
        "/api/v1/workspaces/{workspace_id}/builds/{job_id}/events",
        "/api/v1/workspaces/{workspace_id}/lineage/{layer}/{entity_id}/{revision}",
        "/api/v1/workspaces/{workspace_id}/scope/context",
        "/api/v1/workspaces/{workspace_id}/scope/assignments",
        "/api/v1/workspaces/{workspace_id}/reviews/decide",
        "/api/v1/workspaces/{workspace_id}/context",
    ] {
        assert!(document["paths"].get(path).is_some(), "missing {path}");
    }
    Ok(())
}
