use agent_file_normalizer::ArtifactRole;
use agent_file_normalizer::ArtifactSpecification;
use bytes::Bytes;
use context_admin_backend::AdminBackend;
use context_admin_backend::ArtifactPreviewRequest;
use context_admin_backend::ServerBackend;
use context_protocol::ArtifactRef;
use context_workspace::ArtifactRepository;
use context_workspace::StoreMode;
use context_workspace::Workspace;
use context_workspace::WorkspaceArtifactRepository;
use tempfile::tempdir;

#[tokio::test]
async fn previews_committed_utf8_artifacts_with_a_character_limit()
-> Result<(), Box<dyn std::error::Error>> {
    let project = tempdir()?;
    let home = tempdir()?;
    let workspace = Workspace::init(project.path(), home.path(), StoreMode::External)?;
    let backend = ServerBackend::new(home.path().to_path_buf()).await?;
    let registered = backend.register_workspace_root(project.path())?;
    let artifact = write_artifact(
        &WorkspaceArtifactRepository::new(&workspace),
        "你好，Artifact\n",
    )
    .await?;

    let complete = backend
        .preview_artifact(
            registered.workspace_id.clone(),
            ArtifactPreviewRequest {
                artifact: ArtifactRef::new(artifact.uri.clone()),
                max_chars: Some(100),
            },
        )
        .await?;
    assert_eq!(complete.content, "你好，Artifact\n");
    assert!(!complete.truncated);

    let limited = backend
        .preview_artifact(
            registered.workspace_id,
            ArtifactPreviewRequest {
                artifact: ArtifactRef::new(artifact.uri),
                max_chars: Some(3),
            },
        )
        .await?;
    assert_eq!(limited.content, "你好，");
    assert!(limited.truncated);
    assert_eq!(limited.characters, 3);
    Ok(())
}

async fn write_artifact(
    repository: &WorkspaceArtifactRepository,
    content: &str,
) -> Result<agent_file_normalizer::ProducedArtifact, Box<dyn std::error::Error>> {
    let sink = repository.begin()?;
    let mut writer = sink
        .create(ArtifactSpecification {
            role: ArtifactRole::Primary,
            relative_path: None,
            media_type: "text/markdown".to_owned(),
            format: Some(agent_file_normalizer::FormatId::new("markdown")),
            extension: Some("md".to_owned()),
        })
        .await?;
    writer
        .write(Bytes::copy_from_slice(content.as_bytes()))
        .await?;
    let artifact = writer.finish().await?;
    sink.commit(std::slice::from_ref(&artifact)).await?;
    Ok(artifact)
}
