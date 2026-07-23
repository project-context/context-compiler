//! Local-directory source connector.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::path::Component;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use agent_source_connector::CapturedContent;
use agent_source_connector::ConnectionTestResult;
use agent_source_connector::ConnectorCapabilities;
use agent_source_connector::ConnectorDescriptor;
use agent_source_connector::ConnectorDiagnostic;
use agent_source_connector::ConnectorDiagnosticLevel;
use agent_source_connector::ConnectorError;
use agent_source_connector::ConnectorFuture;
use agent_source_connector::ConnectorObject;
use agent_source_connector::ConnectorResult;
use agent_source_connector::DiscoveryRequest;
use agent_source_connector::DiscoveryResult;
use agent_source_connector::SecretProvider;
use agent_source_connector::SourceConnector;
use agent_source_connector::SourceConnectorFactory;
use globset::Glob;
use globset::GlobSet;
use globset::GlobSetBuilder;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;
use walkdir::WalkDir;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LocalConnectorConfig {
    pub root: PathBuf,
    #[serde(default = "default_includes")]
    pub include: Vec<String>,
    #[serde(default = "default_excludes")]
    pub exclude: Vec<String>,
    #[serde(default)]
    pub follow_links: bool,
    #[serde(default = "default_max_file_size")]
    pub max_file_size_bytes: u64,
}

fn default_includes() -> Vec<String> {
    vec!["**/*".to_owned()]
}

fn default_excludes() -> Vec<String> {
    vec![
        ".git/**".to_owned(),
        ".context/**".to_owned(),
        "target/**".to_owned(),
        ".idea/**".to_owned(),
    ]
}

const fn default_max_file_size() -> u64 {
    64 * 1024 * 1024
}

#[derive(Clone, Default)]
pub struct LocalConnectorFactory;

impl LocalConnectorFactory {
    pub fn new() -> Self {
        Self
    }
}

impl SourceConnectorFactory for LocalConnectorFactory {
    fn descriptor(&self) -> ConnectorDescriptor {
        ConnectorDescriptor {
            id: "local".to_owned(),
            display_name: "Local directory".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            capabilities: ConnectorCapabilities {
                local: true,
                remote: false,
                incremental: true,
                authentication: false,
            },
            config_schema: serde_json::to_value(schemars::schema_for!(LocalConnectorConfig))
                .unwrap_or(Value::Null),
        }
    }

    fn validate_config(&self, config: &Value) -> ConnectorResult<()> {
        let config: LocalConnectorConfig = serde_json::from_value(config.clone())
            .map_err(|error| ConnectorError::Configuration(error.to_string()))?;
        validate_root(&config.root)?;
        build_globs(&config.include)?;
        build_globs(&config.exclude)?;
        if config.max_file_size_bytes == 0 {
            return Err(ConnectorError::Configuration(
                "maxFileSizeBytes must be greater than zero".to_owned(),
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
            let config: LocalConnectorConfig = serde_json::from_value(config)
                .map_err(|error| ConnectorError::Configuration(error.to_string()))?;
            Ok(Box::new(LocalConnector::new(config)?) as Box<dyn SourceConnector>)
        })
    }
}

pub struct LocalConnector {
    config: LocalConnectorConfig,
    include: GlobSet,
    exclude: GlobSet,
}

impl LocalConnector {
    pub fn new(config: LocalConnectorConfig) -> ConnectorResult<Self> {
        validate_root(&config.root)?;
        let include = build_globs(&config.include)?;
        let exclude = build_globs(&config.exclude)?;
        Ok(Self {
            config,
            include,
            exclude,
        })
    }

    fn object_for_path(&self, path: &Path) -> ConnectorResult<ConnectorObject> {
        let relative = path
            .strip_prefix(&self.config.root)
            .map_err(|error| ConnectorError::Io(error.to_string()))?;
        let stable_key = relative.to_string_lossy().replace('\\', "/");
        let metadata =
            std::fs::metadata(path).map_err(|error| ConnectorError::Io(error.to_string()))?;
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        Ok(ConnectorObject {
            stable_key: stable_key.clone(),
            uri: stable_key,
            title: path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| relative.display().to_string()),
            media_type: media_type(extension.as_deref()),
            extension,
            size_bytes: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .and_then(|value| i64::try_from(value.as_secs()).ok()),
            content_hash: None,
        })
    }

    fn checked_path(&self, stable_key: &str) -> ConnectorResult<PathBuf> {
        let relative = Path::new(stable_key);
        if stable_key.is_empty()
            || relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(ConnectorError::NotFound(stable_key.to_owned()));
        }
        let path = self.config.root.join(relative);
        let canonical_root = std::fs::canonicalize(&self.config.root)
            .map_err(|error| ConnectorError::Io(error.to_string()))?;
        let canonical_path = std::fs::canonicalize(&path)
            .map_err(|_| ConnectorError::NotFound(stable_key.to_owned()))?;
        if !canonical_path.starts_with(&canonical_root) {
            return Err(ConnectorError::NotFound(stable_key.to_owned()));
        }
        Ok(path)
    }
}

impl SourceConnector for LocalConnector {
    fn test(&self) -> ConnectorFuture<'_, ConnectionTestResult> {
        Box::pin(async move {
            let reachable = self.config.root.is_dir();
            Ok(ConnectionTestResult {
                reachable,
                diagnostics: (!reachable)
                    .then(|| ConnectorDiagnostic {
                        code: "local_root_missing".to_owned(),
                        level: ConnectorDiagnosticLevel::Error,
                        message: format!(
                            "local source root does not exist: {}",
                            self.config.root.display()
                        ),
                    })
                    .into_iter()
                    .collect(),
            })
        })
    }

    fn discover(&self, request: DiscoveryRequest) -> ConnectorFuture<'_, DiscoveryResult> {
        Box::pin(async move {
            let mut objects = Vec::new();
            for entry in WalkDir::new(&self.config.root)
                .follow_links(self.config.follow_links)
                .into_iter()
            {
                let entry = entry.map_err(|error| ConnectorError::Io(error.to_string()))?;
                if !entry.file_type().is_file() {
                    continue;
                }
                let relative = entry
                    .path()
                    .strip_prefix(&self.config.root)
                    .map_err(|error| ConnectorError::Io(error.to_string()))?;
                if !self.include.is_match(relative) || self.exclude.is_match(relative) {
                    continue;
                }
                let stable_key = relative.to_string_lossy().replace('\\', "/");
                if self.checked_path(&stable_key).is_err() {
                    continue;
                }
                let object = self.object_for_path(entry.path())?;
                if object.size_bytes <= self.config.max_file_size_bytes {
                    objects.push(object);
                }
            }
            objects.sort_by(|left, right| left.stable_key.cmp(&right.stable_key));
            if let Some(cursor) = &request.cursor {
                objects.retain(|object| object.stable_key > *cursor);
            }
            let limit = request.limit();
            let has_more = objects.len() > limit;
            objects.truncate(limit);
            let next_cursor = has_more
                .then(|| objects.last().map(|object| object.stable_key.clone()))
                .flatten();
            Ok(DiscoveryResult {
                objects,
                next_cursor,
                diagnostics: Vec::new(),
            })
        })
    }

    fn capture(&self, stable_key: &str) -> ConnectorFuture<'_, CapturedContent> {
        let stable_key = stable_key.to_owned();
        Box::pin(async move {
            let path = self.checked_path(&stable_key)?;
            let mut object = self.object_for_path(&path)?;
            if object.size_bytes > self.config.max_file_size_bytes {
                return Err(ConnectorError::Unsupported(format!(
                    "source exceeds maxFileSizeBytes: {stable_key}"
                )));
            }
            let bytes =
                std::fs::read(path).map_err(|error| ConnectorError::Io(error.to_string()))?;
            object.content_hash = Some(format!("sha256:{:x}", Sha256::digest(&bytes)));
            Ok(CapturedContent { object, bytes })
        })
    }
}

fn validate_root(root: &Path) -> ConnectorResult<()> {
    if root.as_os_str().is_empty() {
        return Err(ConnectorError::Configuration(
            "root must not be empty".to_owned(),
        ));
    }
    Ok(())
}

fn build_globs(patterns: &[String]) -> ConnectorResult<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(
            Glob::new(pattern).map_err(|error| ConnectorError::Configuration(error.to_string()))?,
        );
    }
    builder
        .build()
        .map_err(|error| ConnectorError::Configuration(error.to_string()))
}

fn media_type(extension: Option<&str>) -> String {
    match extension {
        Some("md" | "markdown") => "text/markdown",
        Some("html" | "htm") => "text/html",
        Some("ts" | "tsx") => "text/typescript",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
    .to_owned()
}

#[cfg(test)]
mod tests {
    use agent_source_connector::DiscoveryRequest;
    use agent_source_connector::SourceConnector;
    use tempfile::tempdir;

    use super::LocalConnector;
    use super::LocalConnectorConfig;

    #[tokio::test]
    async fn discovers_and_captures_without_path_escape() -> Result<(), Box<dyn std::error::Error>>
    {
        let root = tempdir()?;
        std::fs::write(root.path().join("a.md"), "# A")?;
        std::fs::write(root.path().join("a.bin"), [1_u8, 2])?;
        let connector = LocalConnector::new(LocalConnectorConfig {
            root: root.path().to_path_buf(),
            include: vec!["**/*.md".to_owned()],
            exclude: Vec::new(),
            follow_links: false,
            max_file_size_bytes: 1024,
        })?;
        let result = connector.discover(DiscoveryRequest::default()).await?;
        assert_eq!(result.objects.len(), 1);
        assert_eq!(connector.capture("a.md").await?.bytes, b"# A");
        assert!(connector.capture("../outside").await.is_err());
        Ok(())
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn following_links_never_escapes_the_configured_root()
    -> Result<(), Box<dyn std::error::Error>> {
        use std::os::unix::fs::symlink;

        let root = tempdir()?;
        let outside = tempdir()?;
        std::fs::write(outside.path().join("secret.md"), "private")?;
        symlink(outside.path(), root.path().join("external"))?;
        let connector = LocalConnector::new(LocalConnectorConfig {
            root: root.path().to_path_buf(),
            include: vec!["**/*.md".to_owned()],
            exclude: Vec::new(),
            follow_links: true,
            max_file_size_bytes: 1024,
        })?;

        let result = connector.discover(DiscoveryRequest::default()).await?;
        assert!(result.objects.is_empty());
        assert!(connector.capture("external/secret.md").await.is_err());
        Ok(())
    }
}
