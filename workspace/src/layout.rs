use std::fs;
use std::path::Path;
use std::path::PathBuf;

use thiserror::Error;
use uuid::Uuid;

use crate::StoreMode;
use crate::WorkspaceConfig;

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("workspace was not found from {0}")]
    NotFound(String),
    #[error("CONTEXT_COMPILER_HOME or HOME must be available for external store mode")]
    HomeUnavailable,
    #[error("workspace I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("workspace configuration is invalid: {0}")]
    InvalidConfig(#[from] serde_json::Error),
    #[error("workspace artifact operation failed: {0}")]
    Artifact(String),
}

pub type WorkspaceResult<T> = Result<T, WorkspaceError>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Workspace {
    root: PathBuf,
    compiler_home: PathBuf,
    config: WorkspaceConfig,
}

impl Workspace {
    pub fn init(
        root: impl AsRef<Path>,
        compiler_home: impl Into<PathBuf>,
        store_mode: StoreMode,
    ) -> WorkspaceResult<Self> {
        let root = root.as_ref().to_path_buf();
        let context_dir = root.join(".context");
        let config_path = context_dir.join("workspace.json");
        fs::create_dir_all(context_dir.join("sources"))?;
        let config = if config_path.exists() {
            serde_json::from_slice(&fs::read(&config_path)?)?
        } else {
            let config = WorkspaceConfig {
                workspace_id: Uuid::now_v7().to_string(),
                schema_version: SCHEMA_VERSION,
                store_mode,
            };
            fs::write(&config_path, serde_json::to_vec_pretty(&config)?)?;
            config
        };
        let workspace = Self {
            root,
            compiler_home: compiler_home.into(),
            config,
        };
        workspace.ensure_store_layout()?;
        Ok(workspace)
    }

    pub fn discover(
        start: impl AsRef<Path>,
        compiler_home: impl Into<PathBuf>,
    ) -> WorkspaceResult<Self> {
        let start = start.as_ref();
        let mut cursor = if start.is_file() {
            start.parent().unwrap_or(start).to_path_buf()
        } else {
            start.to_path_buf()
        };
        loop {
            let config_path = cursor.join(".context/workspace.json");
            if config_path.exists() {
                let config = serde_json::from_slice(&fs::read(config_path)?)?;
                let workspace = Self {
                    root: cursor,
                    compiler_home: compiler_home.into(),
                    config,
                };
                workspace.ensure_store_layout()?;
                return Ok(workspace);
            }
            if !cursor.pop() {
                break;
            }
        }
        Err(WorkspaceError::NotFound(start.display().to_string()))
    }

    pub fn default_compiler_home() -> WorkspaceResult<PathBuf> {
        if let Some(value) = std::env::var_os("CONTEXT_COMPILER_HOME") {
            return Ok(PathBuf::from(value));
        }
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|path| path.join(".context-compiler"))
            .ok_or(WorkspaceError::HomeUnavailable)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn config(&self) -> &WorkspaceConfig {
        &self.config
    }

    pub fn set_store_mode(&mut self, store_mode: StoreMode) -> WorkspaceResult<()> {
        if self.config.store_mode == store_mode {
            return Ok(());
        }
        self.config.store_mode = store_mode;
        fs::write(
            self.context_dir().join("workspace.json"),
            serde_json::to_vec_pretty(&self.config)?,
        )?;
        self.ensure_store_layout()
    }

    pub fn context_dir(&self) -> PathBuf {
        self.root.join(".context")
    }

    pub fn projection_dir(&self) -> PathBuf {
        self.context_dir().join("sources")
    }

    pub fn store_dir(&self) -> PathBuf {
        match self.config.store_mode {
            StoreMode::External => self
                .compiler_home
                .join("workspaces")
                .join(&self.config.workspace_id),
            StoreMode::Portable => self.context_dir().join("store"),
        }
    }

    pub fn database_path(&self) -> PathBuf {
        self.store_dir().join("context.db")
    }

    pub fn artifacts_dir(&self) -> PathBuf {
        self.store_dir().join("artifacts")
    }

    pub fn indexes_dir(&self) -> PathBuf {
        self.store_dir().join("indexes")
    }

    pub fn runtime_dir(&self) -> PathBuf {
        self.store_dir().join("runtime")
    }

    fn ensure_store_layout(&self) -> WorkspaceResult<()> {
        for path in [self.artifacts_dir(), self.indexes_dir(), self.runtime_dir()] {
            fs::create_dir_all(path)?;
        }
        Ok(())
    }
}
