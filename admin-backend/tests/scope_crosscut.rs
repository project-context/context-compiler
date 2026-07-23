use context_admin_backend::AdminBackend;
use context_admin_backend::LayerCollection;
use context_admin_backend::LayerQuery;
use context_admin_backend::ManualScopeAssignmentRequest;
use context_admin_backend::ServerBackend;
use context_compiler::BuildOptions;
use context_protocol::RevisionRef;
use context_scope::Propagation;

#[tokio::test]
async fn manual_source_scope_is_inherited_by_fact_context() -> Result<(), Box<dyn std::error::Error>>
{
    let home = tempfile::tempdir()?;
    let project = tempfile::tempdir()?;
    std::fs::write(
        project.path().join("refund.md"),
        "# Refund policy\n\nA refund is allowed within seven days.\n",
    )?;
    let backend = ServerBackend::new(home.path().to_path_buf()).await?;
    let workspace = backend.register_workspace_root(project.path())?;
    backend
        .compile_now(
            &workspace.workspace_id,
            BuildOptions {
                no_agent: true,
                ..BuildOptions::default()
            },
        )
        .await?;

    let snapshots = backend
        .list_layer(
            workspace.workspace_id.clone(),
            LayerCollection::Snapshots,
            LayerQuery::default(),
        )
        .await?;
    let source_target: RevisionRef =
        serde_json::from_value(snapshots["items"][0]["revisionRef"].clone())?;
    backend
        .assign_scope(
            workspace.workspace_id.clone(),
            ManualScopeAssignmentRequest {
                target: source_target.clone(),
                dimension: "service".to_owned(),
                scope_key: "refund-service".to_owned(),
                label: "Refund Service".to_owned(),
                propagation: Propagation::Inherit,
            },
        )
        .await?;

    let facts = backend
        .list_layer(
            workspace.workspace_id.clone(),
            LayerCollection::Facts,
            LayerQuery::default(),
        )
        .await?;
    let fact_target: RevisionRef =
        serde_json::from_value(facts["items"][0]["revisionRef"].clone())?;
    let context = backend
        .scope_context(workspace.workspace_id, fact_target)
        .await?;

    assert!(context.direct_assignments.is_empty());
    assert!(context.effective.values.iter().any(|value| {
        value.scope_ref.id == "scope:service:refund-service"
            && value.assigned_at == source_target
            && value.lineage_path.len() >= 2
    }));
    Ok(())
}
