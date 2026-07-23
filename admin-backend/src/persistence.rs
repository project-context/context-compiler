use std::path::PathBuf;

use context_store_sqlite::SqliteStore;

use crate::BuildEvent;
use crate::BuildJob;
use crate::JobPersistence;
use crate::JobPersistenceFuture;
use crate::WorkspaceRegistry;
use context_workspace::Workspace;

pub(crate) struct SqliteJobPersistence {
    compiler_home: PathBuf,
    registry: WorkspaceRegistry,
}

impl SqliteJobPersistence {
    pub(crate) fn new(compiler_home: PathBuf) -> Self {
        Self {
            registry: WorkspaceRegistry::new(compiler_home.clone()),
            compiler_home,
        }
    }

    async fn store(&self, workspace_id: &str) -> Result<SqliteStore, String> {
        let registered = self
            .registry
            .get(workspace_id)
            .map_err(|error| error.to_string())?;
        let workspace = Workspace::discover(&registered.root, self.compiler_home.clone())
            .map_err(|error| error.to_string())?;
        SqliteStore::connect(workspace.database_path())
            .await
            .map_err(|error| error.to_string())
    }
}

impl JobPersistence for SqliteJobPersistence {
    fn load(&self) -> JobPersistenceFuture<'_, (Vec<BuildJob>, Vec<BuildEvent>)> {
        Box::pin(async move {
            let mut jobs = Vec::new();
            let mut events = Vec::new();
            for registered in self.registry.list().map_err(|error| error.to_string())? {
                let store = self.store(&registered.workspace_id).await?;
                for value in store
                    .load_build_job_records()
                    .await
                    .map_err(|error| error.to_string())?
                {
                    jobs.push(serde_json::from_value(value).map_err(|error| error.to_string())?);
                }
                for value in store
                    .load_build_event_records()
                    .await
                    .map_err(|error| error.to_string())?
                {
                    events.push(serde_json::from_value(value).map_err(|error| error.to_string())?);
                }
            }
            Ok((jobs, events))
        })
    }

    fn save_job(&self, job: BuildJob) -> JobPersistenceFuture<'_, ()> {
        Box::pin(async move {
            let store = self.store(&job.workspace_id).await?;
            let status = serde_json::to_value(job.status)
                .map_err(|error| error.to_string())?
                .as_str()
                .unwrap_or("unknown")
                .to_owned();
            let updated = job
                .finished_at_ms
                .or(job.started_at_ms)
                .unwrap_or(job.created_at_ms);
            let payload = serde_json::to_value(&job).map_err(|error| error.to_string())?;
            store
                .save_build_job_record(
                    &job.id,
                    &job.workspace_id,
                    &status,
                    job.created_at_ms,
                    updated,
                    &payload,
                )
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn save_event(&self, event: BuildEvent) -> JobPersistenceFuture<'_, ()> {
        Box::pin(async move {
            let store = self.store(&event.workspace_id).await?;
            let payload = serde_json::to_value(&event).map_err(|error| error.to_string())?;
            store
                .save_build_event_record(
                    &event.job_id,
                    &event.workspace_id,
                    event.sequence,
                    event.timestamp_ms,
                    &payload,
                )
                .await
                .map_err(|error| error.to_string())
        })
    }
}
