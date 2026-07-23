use std::path::Path;
use std::path::PathBuf;

use context_workspace::StoreMode;
use context_workspace::Workspace;
use context_workspace::WorkspaceError;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;

use crate::AdminError;
use crate::AdminResult;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredWorkspace {
    pub workspace_id: String,
    pub display_name: String,
    pub root: PathBuf,
}

#[derive(Clone, Debug)]
pub struct WorkspaceRegistry {
    path: PathBuf,
    compiler_home: PathBuf,
}

impl WorkspaceRegistry {
    pub fn new(compiler_home: impl Into<PathBuf>) -> Self {
        let compiler_home = compiler_home.into();
        Self {
            path: compiler_home.join("admin/workspaces.json"),
            compiler_home,
        }
    }

    pub fn list(&self) -> AdminResult<Vec<RegisteredWorkspace>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        serde_json::from_slice(&std::fs::read(&self.path)?).map_err(Into::into)
    }

    pub fn register(&self, root: impl AsRef<Path>) -> AdminResult<RegisteredWorkspace> {
        let workspace = match Workspace::discover(root.as_ref(), self.compiler_home.clone()) {
            Ok(workspace) => workspace,
            Err(WorkspaceError::NotFound(_)) => Workspace::init(
                root.as_ref(),
                self.compiler_home.clone(),
                StoreMode::External,
            )?,
            Err(error) => return Err(error.into()),
        };
        let root = workspace.root().canonicalize()?;
        let registered = RegisteredWorkspace {
            workspace_id: workspace.config().workspace_id.clone(),
            display_name: root
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| workspace.config().workspace_id.clone()),
            root,
        };
        let mut values = self.list()?;
        if let Some(existing) = values
            .iter_mut()
            .find(|value| value.workspace_id == registered.workspace_id)
        {
            *existing = registered.clone();
        } else {
            values.push(registered.clone());
        }
        values.sort_by(|left, right| left.workspace_id.cmp(&right.workspace_id));
        self.save(&values)?;
        Ok(registered)
    }

    pub fn get(&self, workspace_id: &str) -> AdminResult<RegisteredWorkspace> {
        self.list()?
            .into_iter()
            .find(|value| value.workspace_id == workspace_id)
            .ok_or_else(|| AdminError::NotFound(workspace_id.to_owned()))
    }

    pub fn unregister(&self, workspace_id: &str) -> AdminResult<()> {
        let mut values = self.list()?;
        let before = values.len();
        values.retain(|value| value.workspace_id != workspace_id);
        if values.len() == before {
            return Err(AdminError::NotFound(workspace_id.to_owned()));
        }
        self.save(&values)
    }

    fn save(&self, values: &[RegisteredWorkspace]) -> AdminResult<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec_pretty(values)?)?;
        std::fs::rename(temporary, &self.path)?;
        Ok(())
    }
}
