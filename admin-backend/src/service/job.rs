use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use context_protocol::Diagnostic;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::RwLock;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::AdminError;
use crate::AdminResult;

pub type JobPersistenceFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait JobPersistence: Send + Sync {
    fn load(&self) -> JobPersistenceFuture<'_, (Vec<BuildJob>, Vec<BuildEvent>)>;
    fn save_job(&self, job: BuildJob) -> JobPersistenceFuture<'_, ()>;
    fn save_event(&self, event: BuildEvent) -> JobPersistenceFuture<'_, ()>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BuildJobStatus {
    Queued,
    Running,
    Succeeded,
    SucceededWithWarnings,
    Partial,
    Failed,
    Cancelling,
    Cancelled,
    Interrupted,
}

impl BuildJobStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded
                | Self::SucceededWithWarnings
                | Self::Partial
                | Self::Failed
                | Self::Cancelled
                | Self::Interrupted
        )
    }
}

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum BuildStage {
    Queued,
    #[default]
    Discover,
    Capture,
    Normalize,
    Structure,
    Evidence,
    Fact,
    Scope,
    Semantic,
    Project,
    Complete,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRunRequest {
    #[serde(default)]
    pub full: bool,
    #[serde(default)]
    pub source_ids: Vec<String>,
    #[serde(default = "default_from_stage")]
    pub from_stage: BuildStage,
    #[serde(default = "default_to_stage")]
    pub to_stage: BuildStage,
    /// Last durably confirmed progress from a cancelled or interrupted run.
    ///
    /// A resumed normalization run still validates the existing artifacts, but
    /// its user-facing progress must never move backwards while doing so.
    #[serde(default)]
    pub resume_processed: Option<usize>,
    #[serde(default)]
    pub resume_total: Option<usize>,
}

impl Default for PipelineRunRequest {
    fn default() -> Self {
        Self {
            full: false,
            source_ids: Vec::new(),
            from_stage: default_from_stage(),
            to_stage: default_to_stage(),
            resume_processed: None,
            resume_total: None,
        }
    }
}

impl PipelineRunRequest {
    pub fn includes(&self, stage: BuildStage) -> bool {
        self.from_stage <= stage && stage <= self.to_stage
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.from_stage < BuildStage::Capture
            || self.to_stage > BuildStage::Project
            || self.from_stage > self.to_stage
        {
            return Err(format!(
                "invalid pipeline range: {:?} -> {:?}",
                self.from_stage, self.to_stage
            ));
        }
        match (self.resume_processed, self.resume_total) {
            (None, None) => {}
            (Some(processed), Some(total)) if !self.full && total > 0 && processed <= total => {}
            (Some(_), Some(_)) if self.full => {
                return Err("a full restart cannot include a resume checkpoint".to_owned());
            }
            _ => {
                return Err(
                    "resumeProcessed and resumeTotal must form a valid checkpoint".to_owned(),
                );
            }
        }
        Ok(())
    }
}

fn default_from_stage() -> BuildStage {
    BuildStage::Capture
}

fn default_to_stage() -> BuildStage {
    BuildStage::Project
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BuildEventKind {
    Status,
    Progress,
    Diagnostic,
    Result,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BuildEvent {
    pub sequence: u64,
    pub job_id: String,
    pub workspace_id: String,
    pub timestamp_ms: u64,
    pub kind: BuildEventKind,
    pub stage: BuildStage,
    pub message: String,
    pub diagnostic: Option<Diagnostic>,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BuildJob {
    pub id: String,
    pub workspace_id: String,
    pub status: BuildJobStatus,
    pub created_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
    #[serde(default)]
    pub request: PipelineRunRequest,
    pub summary: Option<Value>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobTaskResult {
    pub status: BuildJobStatus,
    pub summary: Value,
}

impl JobTaskResult {
    pub fn succeeded(summary: Value) -> Self {
        Self {
            status: BuildJobStatus::Succeeded,
            summary,
        }
    }
}

#[derive(Default)]
struct JobState {
    jobs: BTreeMap<String, BuildJob>,
    events: BTreeMap<String, Vec<BuildEvent>>,
    cancellation: BTreeMap<String, Arc<AtomicBool>>,
    active_workspaces: BTreeSet<String>,
    next_sequence: u64,
}

#[derive(Clone)]
pub struct JobManager {
    state: Arc<RwLock<JobState>>,
    sender: broadcast::Sender<BuildEvent>,
    persistence: Option<Arc<dyn JobPersistence>>,
}

impl Default for JobManager {
    fn default() -> Self {
        Self::new()
    }
}

impl JobManager {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(512);
        Self {
            state: Arc::new(RwLock::new(JobState::default())),
            sender,
            persistence: None,
        }
    }

    pub fn with_persistence(persistence: Arc<dyn JobPersistence>) -> Self {
        let mut manager = Self::new();
        manager.persistence = Some(persistence);
        manager
    }

    /// Loads persisted jobs and marks unfinished work as interrupted. The
    /// first release deliberately does not resume writes after a restart.
    pub async fn restore(&self) -> AdminResult<()> {
        let Some(persistence) = &self.persistence else {
            return Ok(());
        };
        let (jobs, events) = persistence.load().await.map_err(AdminError::Invalid)?;
        let mut interrupted = Vec::new();
        {
            let mut state = self.state.write().await;
            for mut job in jobs {
                if !job.status.is_terminal() {
                    job.status = BuildJobStatus::Interrupted;
                    job.finished_at_ms = Some(now_ms());
                    job.error = Some("management service restarted during the build".to_owned());
                    interrupted.push(job.clone());
                }
                state.jobs.insert(job.id.clone(), job);
            }
            for event in events {
                state.next_sequence = state.next_sequence.max(event.sequence);
                state
                    .events
                    .entry(event.job_id.clone())
                    .or_default()
                    .push(event);
            }
        }
        for job in interrupted {
            persistence
                .save_job(job.clone())
                .await
                .map_err(AdminError::Invalid)?;
            self.emit(
                &job.id,
                &job.workspace_id,
                BuildEventKind::Status,
                BuildStage::Complete,
                "Build interrupted by management service restart".to_owned(),
                None,
                None,
            )
            .await;
        }
        Ok(())
    }

    pub async fn start<F, Fut>(&self, workspace_id: String, task: F) -> AdminResult<BuildJob>
    where
        F: FnOnce(JobReporter) -> Fut + Send + 'static,
        Fut: Future<Output = Result<Value, String>> + Send + 'static,
    {
        self.start_with_status(
            workspace_id,
            PipelineRunRequest::default(),
            move |reporter| async move { task(reporter).await.map(JobTaskResult::succeeded) },
        )
        .await
    }

    pub async fn start_with_status<F, Fut>(
        &self,
        workspace_id: String,
        request: PipelineRunRequest,
        task: F,
    ) -> AdminResult<BuildJob>
    where
        F: FnOnce(JobReporter) -> Fut + Send + 'static,
        Fut: Future<Output = Result<JobTaskResult, String>> + Send + 'static,
    {
        let id = Uuid::now_v7().to_string();
        let created_at_ms = now_ms();
        let cancellation = Arc::new(AtomicBool::new(false));
        let job = BuildJob {
            id: id.clone(),
            workspace_id: workspace_id.clone(),
            status: BuildJobStatus::Queued,
            created_at_ms,
            started_at_ms: None,
            finished_at_ms: None,
            request: request.clone(),
            summary: None,
            error: None,
        };
        {
            let mut state = self.state.write().await;
            if !state.active_workspaces.insert(workspace_id.clone()) {
                return Err(AdminError::Conflict(format!(
                    "workspace already has an active build: {workspace_id}"
                )));
            }
            state.jobs.insert(id.clone(), job.clone());
            state.events.insert(id.clone(), Vec::new());
            state.cancellation.insert(id.clone(), cancellation.clone());
        }
        if let Some(persistence) = &self.persistence
            && let Err(error) = persistence.save_job(job.clone()).await
        {
            let mut state = self.state.write().await;
            state.jobs.remove(&id);
            state.events.remove(&id);
            state.cancellation.remove(&id);
            state.active_workspaces.remove(&workspace_id);
            return Err(AdminError::Invalid(error));
        }
        self.emit(
            &id,
            &workspace_id,
            BuildEventKind::Status,
            BuildStage::Queued,
            "Build queued".to_owned(),
            None,
            None,
        )
        .await;

        let manager = self.clone();
        let requested_stage = request.from_stage;
        let requested_end = request.to_stage;
        tokio::spawn(async move {
            manager
                .set_status(&id, BuildJobStatus::Running, Some(now_ms()), None)
                .await;
            let reporter = JobReporter {
                manager: manager.clone(),
                job_id: id.clone(),
                workspace_id: workspace_id.clone(),
                cancellation: cancellation.clone(),
            };
            reporter
                .progress(
                    requested_stage,
                    format!(
                        "Pipeline requested for {requested_stage:?} through {requested_end:?}; validating reusable inputs"
                    ),
                    Some(serde_json::json!({
                        "fromStage": requested_stage,
                        "toStage": requested_end,
                        "full": request.full,
                        "sourceIds": request.source_ids,
                    })),
                )
                .await;
            let result = if cancellation.load(Ordering::SeqCst) {
                Err("cancelled".to_owned())
            } else {
                task(reporter.clone()).await
            };
            if cancellation.load(Ordering::SeqCst) {
                manager
                    .finish(&id, &workspace_id, BuildJobStatus::Cancelled, None, None)
                    .await;
            } else {
                match result {
                    Ok(output) => {
                        let status = if matches!(
                            output.status,
                            BuildJobStatus::Succeeded
                                | BuildJobStatus::SucceededWithWarnings
                                | BuildJobStatus::Partial
                        ) {
                            output.status
                        } else {
                            BuildJobStatus::Succeeded
                        };
                        manager
                            .finish(&id, &workspace_id, status, Some(output.summary), None)
                            .await;
                    }
                    Err(error) => {
                        manager
                            .finish(
                                &id,
                                &workspace_id,
                                BuildJobStatus::Failed,
                                None,
                                Some(error),
                            )
                            .await;
                    }
                }
            }
        });
        Ok(job)
    }

    pub async fn list(&self, workspace_id: &str) -> Vec<BuildJob> {
        let mut jobs = self
            .state
            .read()
            .await
            .jobs
            .values()
            .filter(|job| job.workspace_id == workspace_id)
            .cloned()
            .collect::<Vec<_>>();
        jobs.sort_by(|left, right| {
            right
                .created_at_ms
                .cmp(&left.created_at_ms)
                .then_with(|| right.id.cmp(&left.id))
        });
        jobs
    }

    pub async fn get(&self, job_id: &str) -> Option<BuildJob> {
        self.state.read().await.jobs.get(job_id).cloned()
    }

    pub async fn events(&self, job_id: &str, after: Option<u64>) -> Vec<BuildEvent> {
        self.state
            .read()
            .await
            .events
            .get(job_id)
            .into_iter()
            .flatten()
            .filter(|event| after.is_none_or(|sequence| event.sequence > sequence))
            .cloned()
            .collect()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BuildEvent> {
        self.sender.subscribe()
    }

    pub async fn cancel(&self, job_id: &str) -> AdminResult<BuildJob> {
        let job = {
            let mut state = self.state.write().await;
            let cancellation = state
                .cancellation
                .get(job_id)
                .cloned()
                .ok_or_else(|| AdminError::NotFound(job_id.to_owned()))?;
            cancellation.store(true, Ordering::SeqCst);
            let job = state
                .jobs
                .get_mut(job_id)
                .ok_or_else(|| AdminError::NotFound(job_id.to_owned()))?;
            if job.status.is_terminal() {
                return Err(AdminError::Conflict(format!(
                    "build is already terminal: {job_id}"
                )));
            }
            job.status = BuildJobStatus::Cancelling;
            job.clone()
        };
        self.persist_job(job.clone()).await;
        Ok(job)
    }

    #[allow(clippy::too_many_arguments)]
    async fn emit(
        &self,
        job_id: &str,
        workspace_id: &str,
        kind: BuildEventKind,
        stage: BuildStage,
        message: String,
        diagnostic: Option<Diagnostic>,
        data: Option<Value>,
    ) {
        let event = {
            let mut state = self.state.write().await;
            state.next_sequence += 1;
            let event = BuildEvent {
                sequence: state.next_sequence,
                job_id: job_id.to_owned(),
                workspace_id: workspace_id.to_owned(),
                timestamp_ms: now_ms(),
                kind,
                stage,
                message,
                diagnostic,
                data,
            };
            state
                .events
                .entry(job_id.to_owned())
                .or_default()
                .push(event.clone());
            event
        };
        if let Some(persistence) = &self.persistence {
            let _ = persistence.save_event(event.clone()).await;
        }
        let _ = self.sender.send(event);
    }

    async fn set_status(
        &self,
        job_id: &str,
        status: BuildJobStatus,
        started_at_ms: Option<u64>,
        finished_at_ms: Option<u64>,
    ) {
        let job = if let Some(job) = self.state.write().await.jobs.get_mut(job_id) {
            job.status = status;
            if started_at_ms.is_some() {
                job.started_at_ms = started_at_ms;
            }
            if finished_at_ms.is_some() {
                job.finished_at_ms = finished_at_ms;
            }
            Some(job.clone())
        } else {
            None
        };
        if let Some(job) = job {
            self.persist_job(job).await;
        }
    }

    async fn finish(
        &self,
        job_id: &str,
        workspace_id: &str,
        status: BuildJobStatus,
        summary: Option<Value>,
        error: Option<String>,
    ) {
        let job = {
            let mut state = self.state.write().await;
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.status = status;
                job.finished_at_ms = Some(now_ms());
                job.summary = summary.clone();
                job.error = error.clone();
            }
            state.active_workspaces.remove(workspace_id);
            state.cancellation.remove(job_id);
            state.jobs.get(job_id).cloned()
        };
        if let Some(job) = job {
            self.persist_job(job).await;
        }
        self.emit(
            job_id,
            workspace_id,
            BuildEventKind::Result,
            BuildStage::Complete,
            error.unwrap_or_else(|| "Build completed".to_owned()),
            None,
            summary,
        )
        .await;
    }

    async fn persist_job(&self, job: BuildJob) {
        if let Some(persistence) = &self.persistence {
            let _ = persistence.save_job(job).await;
        }
    }
}

#[derive(Clone)]
pub struct JobReporter {
    manager: JobManager,
    job_id: String,
    workspace_id: String,
    cancellation: Arc<AtomicBool>,
}

impl JobReporter {
    pub fn is_cancelled(&self) -> bool {
        self.cancellation.load(Ordering::SeqCst)
    }

    pub async fn progress(
        &self,
        stage: BuildStage,
        message: impl Into<String>,
        data: Option<Value>,
    ) {
        self.manager
            .emit(
                &self.job_id,
                &self.workspace_id,
                BuildEventKind::Progress,
                stage,
                message.into(),
                None,
                data,
            )
            .await;
    }

    pub async fn diagnostic(&self, stage: BuildStage, diagnostic: Diagnostic) {
        self.manager
            .emit(
                &self.job_id,
                &self.workspace_id,
                BuildEventKind::Diagnostic,
                stage,
                diagnostic.message.clone(),
                Some(diagnostic),
                None,
            )
            .await;
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| {
            u64::try_from(value.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::Mutex;

    use serde_json::json;

    use super::BuildEvent;
    use super::BuildEventKind;
    use super::BuildJob;
    use super::BuildJobStatus;
    use super::BuildStage;
    use super::JobManager;
    use super::JobPersistence;
    use super::JobPersistenceFuture;
    use super::PipelineRunRequest;

    #[tokio::test]
    async fn rejects_two_active_jobs_for_one_workspace() -> Result<(), Box<dyn std::error::Error>> {
        let jobs = JobManager::new();
        let first = jobs
            .start("w1".to_owned(), |_reporter| async move {
                tokio::task::yield_now().await;
                Ok(json!({"ok": true}))
            })
            .await?;
        assert!(
            jobs.start("w1".to_owned(), |_reporter| async move { Ok(json!({})) })
                .await
                .is_err()
        );
        loop {
            let status = jobs.get(&first.id).await.ok_or("missing job")?.status;
            if status.is_terminal() {
                assert_eq!(status, BuildJobStatus::Succeeded);
                break;
            }
            tokio::task::yield_now().await;
        }
        Ok(())
    }

    #[tokio::test]
    async fn records_requested_pipeline_restart_boundary() -> Result<(), Box<dyn std::error::Error>>
    {
        let jobs = JobManager::new();
        let request = PipelineRunRequest {
            full: false,
            source_ids: Vec::new(),
            from_stage: BuildStage::Semantic,
            to_stage: BuildStage::Semantic,
            resume_processed: None,
            resume_total: None,
        };
        let job = jobs
            .start_with_status("w1".to_owned(), request.clone(), |_reporter| async move {
                Ok(super::JobTaskResult::succeeded(json!({ "ok": true })))
            })
            .await?;
        assert_eq!(job.request, request);
        loop {
            if jobs
                .get(&job.id)
                .await
                .ok_or("missing job")?
                .status
                .is_terminal()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            jobs.events(&job.id, None)
                .await
                .iter()
                .any(|event| event.stage == BuildStage::Semantic)
        );
        Ok(())
    }

    #[tokio::test]
    async fn restore_marks_running_jobs_interrupted_and_continues_event_sequence()
    -> Result<(), Box<dyn std::error::Error>> {
        let persistence = Arc::new(TestPersistence {
            jobs: Mutex::new(vec![BuildJob {
                id: "job-1".to_owned(),
                workspace_id: "w1".to_owned(),
                status: BuildJobStatus::Running,
                created_at_ms: 1,
                started_at_ms: Some(2),
                finished_at_ms: None,
                request: PipelineRunRequest::default(),
                summary: None,
                error: None,
            }]),
            events: Mutex::new(vec![BuildEvent {
                sequence: 7,
                job_id: "job-1".to_owned(),
                workspace_id: "w1".to_owned(),
                timestamp_ms: 2,
                kind: BuildEventKind::Progress,
                stage: BuildStage::Fact,
                message: "working".to_owned(),
                diagnostic: None,
                data: None,
            }]),
        });
        let jobs = JobManager::with_persistence(persistence);
        jobs.restore().await?;
        assert_eq!(
            jobs.get("job-1")
                .await
                .ok_or("missing restored job")?
                .status,
            BuildJobStatus::Interrupted
        );
        let events = jobs.events("job-1", Some(7)).await;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].sequence, 8);
        Ok(())
    }

    #[derive(Default)]
    struct TestPersistence {
        jobs: Mutex<Vec<BuildJob>>,
        events: Mutex<Vec<BuildEvent>>,
    }

    impl JobPersistence for TestPersistence {
        fn load(&self) -> JobPersistenceFuture<'_, (Vec<BuildJob>, Vec<BuildEvent>)> {
            Box::pin(async move {
                let jobs = self.jobs.lock().map_err(|error| error.to_string())?.clone();
                let events = self
                    .events
                    .lock()
                    .map_err(|error| error.to_string())?
                    .clone();
                Ok((jobs, events))
            })
        }

        fn save_job(&self, job: BuildJob) -> JobPersistenceFuture<'_, ()> {
            Box::pin(async move {
                let mut jobs = self.jobs.lock().map_err(|error| error.to_string())?;
                if let Some(existing) = jobs.iter_mut().find(|value| value.id == job.id) {
                    *existing = job;
                } else {
                    jobs.push(job);
                }
                Ok(())
            })
        }

        fn save_event(&self, event: BuildEvent) -> JobPersistenceFuture<'_, ()> {
            Box::pin(async move {
                self.events
                    .lock()
                    .map_err(|error| error.to_string())?
                    .push(event);
                Ok(())
            })
        }
    }
}
