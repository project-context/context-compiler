use std::fs;

use agent_file_normalizer::ArtifactRole;
use agent_file_normalizer::ArtifactSpecification;
use bytes::Bytes;
use context_protocol::ArtifactRef;
use tempfile::tempdir;

use super::*;

#[test]
fn external_store_location_survives_workspace_move() -> WorkspaceResult<()> {
    let original_parent = tempdir()?;
    let moved_parent = tempdir()?;
    let home = tempdir()?;
    let original = original_parent.path().join("project");
    fs::create_dir_all(&original)?;
    let workspace = Workspace::init(&original, home.path(), StoreMode::External)?;
    let database = workspace.database_path();
    let workspace_id = workspace.config().workspace_id.clone();
    let moved = moved_parent.path().join("renamed-project");
    fs::rename(&original, &moved)?;

    let rediscovered = Workspace::discover(&moved, home.path())?;
    assert_eq!(rediscovered.config().workspace_id, workspace_id);
    assert_eq!(rediscovered.database_path(), database);
    Ok(())
}

#[test]
fn unmanaged_agent_file_is_never_overwritten() -> WorkspaceResult<()> {
    let directory = tempdir()?;
    let path = directory.path().join("AGENTS.md");
    fs::write(&path, "user owned\n")?;

    let outcome = ensure_managed_agent_block(&path, "Use context().")?;

    assert_eq!(outcome, AgentConfigOutcome::SkippedUnmanaged);
    assert_eq!(fs::read_to_string(path)?, "user owned\n");
    Ok(())
}

#[test]
fn portable_mode_can_be_selected_for_an_existing_workspace() -> WorkspaceResult<()> {
    let project = tempdir()?;
    let home = tempdir()?;
    let mut workspace = Workspace::init(project.path(), home.path(), StoreMode::External)?;

    workspace.set_store_mode(StoreMode::Portable)?;

    let rediscovered = Workspace::discover(project.path(), home.path())?;
    assert_eq!(rediscovered.config().store_mode, StoreMode::Portable);
    assert_eq!(
        rediscovered.database_path(),
        project.path().join(".context/store/context.db")
    );
    Ok(())
}

#[tokio::test]
async fn artifact_repository_commits_content_addressed_primary_once()
-> Result<(), Box<dyn std::error::Error>> {
    let project = tempdir()?;
    let home = tempdir()?;
    let workspace = Workspace::init(project.path(), home.path(), StoreMode::External)?;
    let repository = WorkspaceArtifactRepository::new(&workspace);

    let first = write_test_artifact(&repository, "hello\n").await?;
    let second = write_test_artifact(&repository, "hello\n").await?;

    assert_eq!(first.uri, second.uri);
    assert!(first.uri.starts_with("artifact:sha256:"));
    assert_eq!(
        repository.read(&ArtifactRef::new(first.uri)).await?,
        Bytes::from_static(b"hello\n")
    );
    Ok(())
}

#[tokio::test]
async fn artifact_repository_rejects_companion_path_escape()
-> Result<(), Box<dyn std::error::Error>> {
    let project = tempdir()?;
    let home = tempdir()?;
    let workspace = Workspace::init(project.path(), home.path(), StoreMode::External)?;
    let repository = WorkspaceArtifactRepository::new(&workspace);
    let sink = repository.begin()?;
    let result = sink
        .create(ArtifactSpecification {
            role: ArtifactRole::Companion,
            relative_path: Some("../escape.bin".to_owned()),
            media_type: "application/octet-stream".to_owned(),
            format: None,
            extension: Some("bin".to_owned()),
        })
        .await;
    assert!(result.is_err());
    sink.abort().await?;
    Ok(())
}

async fn write_test_artifact(
    repository: &WorkspaceArtifactRepository,
    content: &str,
) -> Result<agent_file_normalizer::ProducedArtifact, Box<dyn std::error::Error>> {
    let sink = repository.begin()?;
    let mut writer = sink
        .create(ArtifactSpecification {
            role: ArtifactRole::Primary,
            relative_path: None,
            media_type: "text/plain".to_owned(),
            format: Some(agent_file_normalizer::FormatId::new("text")),
            extension: Some("txt".to_owned()),
        })
        .await?;
    writer
        .write(Bytes::copy_from_slice(content.as_bytes()))
        .await?;
    let artifact = writer.finish().await?;
    sink.commit(std::slice::from_ref(&artifact)).await?;
    Ok(artifact)
}
