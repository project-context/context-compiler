//! Git repository connector backed by gitoxide.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use agent_source_connector::CapturedContent;
use agent_source_connector::ConnectionTestResult;
use agent_source_connector::ConnectorCapabilities;
use agent_source_connector::ConnectorDescriptor;
use agent_source_connector::ConnectorError;
use agent_source_connector::ConnectorFuture;
use agent_source_connector::ConnectorResult;
use agent_source_connector::DiscoveryRequest;
use agent_source_connector::DiscoveryResult;
use agent_source_connector::SecretProvider;
use agent_source_connector::SourceConnector;
use agent_source_connector::SourceConnectorFactory;
use agent_source_connector_local::LocalConnector;
use agent_source_connector_local::LocalConnectorConfig;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GitConnectorConfig {
    pub repository: String,
    /// Runtime-managed checkout location for remote repositories. This field is
    /// injected by the host and is intentionally absent from the public schema.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(skip)]
    pub checkout_dir: Option<PathBuf>,
    pub revision: Option<String>,
    pub subpath: Option<PathBuf>,
    #[serde(default = "default_includes")]
    pub include: Vec<String>,
    #[serde(default = "default_excludes")]
    pub exclude: Vec<String>,
    #[serde(default = "default_max_file_size")]
    pub max_file_size_bytes: u64,
}

fn default_includes() -> Vec<String> {
    vec!["**/*".to_owned()]
}

fn default_excludes() -> Vec<String> {
    vec![".git/**".to_owned(), "target/**".to_owned()]
}

const fn default_max_file_size() -> u64 {
    64 * 1024 * 1024
}

#[derive(Clone, Default)]
pub struct GitConnectorFactory;

impl GitConnectorFactory {
    pub fn new() -> Self {
        Self
    }
}

impl SourceConnectorFactory for GitConnectorFactory {
    fn descriptor(&self) -> ConnectorDescriptor {
        ConnectorDescriptor {
            id: "git".to_owned(),
            display_name: "Git repository".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            capabilities: ConnectorCapabilities {
                local: true,
                remote: true,
                incremental: true,
                authentication: true,
            },
            config_schema: serde_json::to_value(schemars::schema_for!(GitConnectorConfig))
                .unwrap_or(Value::Null),
        }
    }

    fn validate_config(&self, config: &Value) -> ConnectorResult<()> {
        let config: GitConnectorConfig = serde_json::from_value(config.clone())
            .map_err(|error| ConnectorError::Configuration(error.to_string()))?;
        if config.repository.trim().is_empty() {
            return Err(ConnectorError::Configuration(
                "repository must not be empty".to_owned(),
            ));
        }
        Ok(())
    }

    fn connect(
        &self,
        config: Value,
        _secrets: Arc<dyn SecretProvider>,
    ) -> ConnectorFuture<'_, Box<dyn SourceConnector>> {
        Box::pin(async move {
            self.validate_config(&config)?;
            let config: GitConnectorConfig = serde_json::from_value(config)
                .map_err(|error| ConnectorError::Configuration(error.to_string()))?;
            Ok(Box::new(GitConnector::prepare(config)?) as Box<dyn SourceConnector>)
        })
    }
}

pub struct GitConnector {
    local: LocalConnector,
    _repository: gix::ThreadSafeRepository,
}

impl GitConnector {
    pub fn prepare(config: GitConnectorConfig) -> ConnectorResult<Self> {
        let repository_path = PathBuf::from(&config.repository);
        let repo = if repository_path.exists() {
            gix::open(&repository_path).map_err(|error| ConnectorError::Io(error.to_string()))?
        } else {
            let checkout_dir = config.checkout_dir.as_ref().ok_or_else(|| {
                ConnectorError::Configuration(
                    "the host must provide a checkout directory for remote repositories".to_owned(),
                )
            })?;
            if checkout_dir.exists() {
                gix::open(checkout_dir).map_err(|error| ConnectorError::Io(error.to_string()))?
            } else {
                let mut fetch = gix::prepare_clone(config.repository.as_str(), checkout_dir)
                    .map_err(|error| ConnectorError::Io(error.to_string()))?;
                if let Some(revision) = config.revision.as_deref() {
                    fetch = fetch
                        .with_ref_name(Some(revision))
                        .map_err(|error| ConnectorError::Configuration(error.to_string()))?;
                }
                let interrupt = AtomicBool::new(false);
                let mut checkout = fetch
                    .fetch_then_checkout(gix::progress::Discard, &interrupt)
                    .map_err(|error| ConnectorError::Authentication(error.to_string()))?
                    .0;
                checkout
                    .main_worktree(gix::progress::Discard, &interrupt)
                    .map_err(|error| ConnectorError::Io(error.to_string()))?
                    .0
            }
        };
        let worktree = repo
            .workdir()
            .ok_or_else(|| {
                ConnectorError::Unsupported("bare repositories are unsupported".to_owned())
            })?
            .to_path_buf();
        let root = config
            .subpath
            .as_ref()
            .map_or(worktree.clone(), |subpath| worktree.join(subpath));
        let local = LocalConnector::new(LocalConnectorConfig {
            root,
            include: config.include,
            exclude: config.exclude,
            follow_links: false,
            max_file_size_bytes: config.max_file_size_bytes,
        })?;
        Ok(Self {
            local,
            _repository: repo.into_sync(),
        })
    }
}

impl SourceConnector for GitConnector {
    fn test(&self) -> ConnectorFuture<'_, ConnectionTestResult> {
        self.local.test()
    }

    fn discover(&self, request: DiscoveryRequest) -> ConnectorFuture<'_, DiscoveryResult> {
        self.local.discover(request)
    }

    fn capture(&self, stable_key: &str) -> ConnectorFuture<'_, CapturedContent> {
        self.local.capture(stable_key)
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::GitConnector;
    use super::GitConnectorConfig;

    #[test]
    fn opens_a_local_repository_without_copying_it() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempdir()?;
        gix::init(root.path())?;
        std::fs::write(root.path().join("README.md"), "# Repo")?;
        let connector = GitConnector::prepare(GitConnectorConfig {
            repository: root.path().display().to_string(),
            checkout_dir: Some(root.path().join("unused")),
            revision: None,
            subpath: None,
            include: vec!["**/*.md".to_owned()],
            exclude: vec![".git/**".to_owned()],
            max_file_size_bytes: 1024,
        })?;
        drop(connector);
        Ok(())
    }
}
