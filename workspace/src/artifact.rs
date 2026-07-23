use std::collections::BTreeMap;
use std::future::Future;
use std::io::Read;
use std::io::Write;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;

use agent_file_normalizer::ArtifactRole;
use agent_file_normalizer::ArtifactSink;
use agent_file_normalizer::ArtifactSpecification;
use agent_file_normalizer::ArtifactWriter;
use agent_file_normalizer::InputSource;
use agent_file_normalizer::MaterializedInput;
use agent_file_normalizer::MemoryArtifactSink;
use agent_file_normalizer::NormalizerError;
use agent_file_normalizer::NormalizerFuture;
use agent_file_normalizer::ProducedArtifact;
use agent_file_normalizer::ScratchSpace;
use bytes::Bytes;
use context_protocol::ArtifactRef;
use sha2::Digest;
use sha2::Sha256;
use uuid::Uuid;

use crate::Workspace;
use crate::WorkspaceError;
use crate::WorkspaceResult;

pub type ArtifactFuture<'a, T> = Pin<Box<dyn Future<Output = WorkspaceResult<T>> + Send + 'a>>;

pub trait ArtifactRepository: Send + Sync {
    fn begin(&self) -> WorkspaceResult<Arc<dyn ArtifactSink>>;
    fn read<'a>(&'a self, artifact: &'a ArtifactRef) -> ArtifactFuture<'a, Bytes>;
    fn read_prefix<'a>(
        &'a self,
        artifact: &'a ArtifactRef,
        max_bytes: usize,
    ) -> ArtifactFuture<'a, (Bytes, bool)>;
    fn copy_to<'a>(
        &'a self,
        artifact: &'a ArtifactRef,
        destination: &'a Path,
    ) -> ArtifactFuture<'a, ()>;
    fn scratch(&self) -> &dyn ScratchSpace;
}

#[derive(Clone, Debug)]
pub struct WorkspaceArtifactRepository {
    artifacts_dir: PathBuf,
    runtime_dir: PathBuf,
}

impl WorkspaceArtifactRepository {
    pub fn new(workspace: &Workspace) -> Self {
        Self {
            artifacts_dir: workspace.artifacts_dir(),
            runtime_dir: workspace.runtime_dir(),
        }
    }

    fn path_for_uri(&self, uri: &str) -> WorkspaceResult<PathBuf> {
        let digest = uri
            .strip_prefix("artifact:sha256:")
            .ok_or_else(|| WorkspaceError::Artifact(format!("unsupported artifact URI: {uri}")))?;
        if digest.len() != 64 || !digest.bytes().all(|value| value.is_ascii_hexdigit()) {
            return Err(WorkspaceError::Artifact(format!(
                "invalid artifact digest: {uri}"
            )));
        }
        Ok(self
            .artifacts_dir
            .join("sha256")
            .join(&digest[..2])
            .join(digest))
    }
}

impl ArtifactRepository for WorkspaceArtifactRepository {
    fn begin(&self) -> WorkspaceResult<Arc<dyn ArtifactSink>> {
        let staging = self
            .runtime_dir
            .join("normalization")
            .join(Uuid::now_v7().to_string());
        std::fs::create_dir_all(&staging)?;
        Ok(Arc::new(FileArtifactSink {
            artifacts_dir: self.artifacts_dir.clone(),
            staging,
            staged: Arc::new(Mutex::new(BTreeMap::new())),
        }))
    }

    fn read<'a>(&'a self, artifact: &'a ArtifactRef) -> ArtifactFuture<'a, Bytes> {
        let path = self.path_for_uri(&artifact.uri);
        Box::pin(async move {
            let path = path?;
            std::fs::read(path)
                .map(Bytes::from)
                .map_err(WorkspaceError::from)
        })
    }

    fn read_prefix<'a>(
        &'a self,
        artifact: &'a ArtifactRef,
        max_bytes: usize,
    ) -> ArtifactFuture<'a, (Bytes, bool)> {
        let path = self.path_for_uri(&artifact.uri);
        Box::pin(async move {
            let path = path?;
            let mut file = std::fs::File::open(path)?;
            let mut bytes = Vec::new();
            std::io::Read::by_ref(&mut file)
                .take(max_bytes.saturating_add(1) as u64)
                .read_to_end(&mut bytes)?;
            let truncated = bytes.len() > max_bytes;
            bytes.truncate(max_bytes);
            Ok((Bytes::from(bytes), truncated))
        })
    }

    fn copy_to<'a>(
        &'a self,
        artifact: &'a ArtifactRef,
        destination: &'a Path,
    ) -> ArtifactFuture<'a, ()> {
        let source = self.path_for_uri(&artifact.uri);
        Box::pin(async move {
            let source = source?;
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(source, destination)?;
            Ok(())
        })
    }

    fn scratch(&self) -> &dyn ScratchSpace {
        self
    }
}

impl ScratchSpace for WorkspaceArtifactRepository {
    fn materialize<'a>(
        &'a self,
        input: &'a dyn InputSource,
    ) -> NormalizerFuture<'a, Box<dyn MaterializedInput>> {
        Box::pin(async move {
            let root = self.runtime_dir.join("scratch");
            std::fs::create_dir_all(&root)
                .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
            let path = root.join(Uuid::now_v7().to_string());
            let mut file = std::fs::File::create(&path)
                .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
            let mut offset = 0_u64;
            loop {
                let chunk = input.read_range(offset, 64 * 1024).await?;
                if chunk.is_empty() {
                    break;
                }
                file.write_all(&chunk)
                    .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
                offset = offset.saturating_add(chunk.len() as u64);
            }
            file.flush()
                .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
            Ok(Box::new(LeasedFile { path }) as Box<dyn MaterializedInput>)
        })
    }
}

struct LeasedFile {
    path: PathBuf,
}

impl MaterializedInput for LeasedFile {
    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for LeasedFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[derive(Clone)]
struct FileArtifactSink {
    artifacts_dir: PathBuf,
    staging: PathBuf,
    staged: Arc<Mutex<BTreeMap<String, Vec<PathBuf>>>>,
}

impl ArtifactSink for FileArtifactSink {
    fn create(
        &self,
        specification: ArtifactSpecification,
    ) -> NormalizerFuture<'_, Box<dyn ArtifactWriter>> {
        let path = self.staging.join(Uuid::now_v7().to_string());
        let staged = self.staged.clone();
        Box::pin(async move {
            validate_relative_path(specification.relative_path.as_deref())?;
            let file = std::fs::File::create(&path)
                .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
            Ok(Box::new(FileArtifactWriter {
                specification,
                path,
                file,
                hash: Sha256::new(),
                size_bytes: 0,
                staged,
            }) as Box<dyn ArtifactWriter>)
        })
    }

    fn commit<'a>(&'a self, artifacts: &'a [ProducedArtifact]) -> NormalizerFuture<'a, ()> {
        Box::pin(async move {
            let mut staged = self.staged.lock().map_err(|_| {
                NormalizerError::artifact_write("artifact staging lock is poisoned")
            })?;
            for artifact in artifacts {
                let paths = staged.get_mut(&artifact.uri).ok_or_else(|| {
                    NormalizerError::artifact_write(format!(
                        "staged artifact is missing: {}",
                        artifact.uri
                    ))
                })?;
                let path = paths.pop().ok_or_else(|| {
                    NormalizerError::artifact_write(format!(
                        "staged artifact is missing: {}",
                        artifact.uri
                    ))
                })?;
                let digest = artifact
                    .uri
                    .strip_prefix("artifact:sha256:")
                    .ok_or_else(|| {
                        NormalizerError::artifact_write("invalid staged artifact URI")
                    })?;
                let destination = self
                    .artifacts_dir
                    .join("sha256")
                    .join(&digest[..2])
                    .join(digest);
                if let Some(parent) = destination.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
                }
                if destination.exists() {
                    std::fs::remove_file(path)
                        .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
                } else {
                    std::fs::rename(path, destination)
                        .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
                }
            }
            staged.retain(|_, paths| !paths.is_empty());
            let _ = std::fs::remove_dir_all(&self.staging);
            Ok(())
        })
    }

    fn abort(&self) -> NormalizerFuture<'_, ()> {
        Box::pin(async move {
            if let Ok(mut staged) = self.staged.lock() {
                staged.clear();
            }
            match std::fs::remove_dir_all(&self.staging) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(NormalizerError::artifact_write(error.to_string())),
            }
        })
    }
}

struct FileArtifactWriter {
    specification: ArtifactSpecification,
    path: PathBuf,
    file: std::fs::File,
    hash: Sha256,
    size_bytes: u64,
    staged: Arc<Mutex<BTreeMap<String, Vec<PathBuf>>>>,
}

impl ArtifactWriter for FileArtifactWriter {
    fn write(&mut self, chunk: Bytes) -> NormalizerFuture<'_, ()> {
        self.hash.update(&chunk);
        self.size_bytes = self.size_bytes.saturating_add(chunk.len() as u64);
        let result = self
            .file
            .write_all(&chunk)
            .map_err(|error| NormalizerError::artifact_write(error.to_string()));
        Box::pin(async move { result })
    }

    fn finish(mut self: Box<Self>) -> NormalizerFuture<'static, ProducedArtifact> {
        Box::pin(async move {
            self.file
                .flush()
                .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
            if self.specification.role == ArtifactRole::Primary {
                validate_primary_text(&self.path)?;
            }
            let content_hash = format!("sha256:{:x}", self.hash.finalize());
            let uri = format!("artifact:{content_hash}");
            self.staged
                .lock()
                .map_err(|_| NormalizerError::artifact_write("artifact staging lock is poisoned"))?
                .entry(uri.clone())
                .or_default()
                .push(self.path.clone());
            Ok(ProducedArtifact {
                uri,
                role: self.specification.role,
                relative_path: self.specification.relative_path,
                media_type: self.specification.media_type,
                format: self.specification.format,
                extension: self.specification.extension,
                content_hash,
                size_bytes: self.size_bytes,
            })
        })
    }
}

fn validate_relative_path(value: Option<&str>) -> Result<(), NormalizerError> {
    let Some(value) = value else {
        return Ok(());
    };
    let path = Path::new(value);
    if value.is_empty()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(NormalizerError::invalid_output(format!(
            "artifact relative path escapes the bundle: {value}"
        )));
    }
    Ok(())
}

fn validate_primary_text(path: &Path) -> Result<(), NormalizerError> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut carry = Vec::new();
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| NormalizerError::artifact_write(error.to_string()))?;
        if read == 0 {
            break;
        }
        if buffer[..read]
            .iter()
            .any(|value| matches!(value, 0 | b'\r'))
        {
            return Err(NormalizerError::invalid_output(
                "primary text must use LF line endings and contain no NUL bytes",
            ));
        }
        carry.extend_from_slice(&buffer[..read]);
        match std::str::from_utf8(&carry) {
            Ok(_) => carry.clear(),
            Err(error) if error.error_len().is_none() => {
                let valid = error.valid_up_to();
                carry.drain(..valid);
                if carry.len() > 3 {
                    return Err(NormalizerError::invalid_output(
                        "primary artifact is not UTF-8",
                    ));
                }
            }
            Err(error) => return Err(NormalizerError::invalid_output(error.to_string())),
        }
    }
    if !carry.is_empty() {
        std::str::from_utf8(&carry)
            .map_err(|error| NormalizerError::invalid_output(error.to_string()))?;
    }
    Ok(())
}

#[derive(Clone, Default)]
pub struct MemoryArtifactRepository {
    sink: MemoryArtifactSink,
}

impl ArtifactRepository for MemoryArtifactRepository {
    fn begin(&self) -> WorkspaceResult<Arc<dyn ArtifactSink>> {
        Ok(Arc::new(self.sink.clone()))
    }

    fn read<'a>(&'a self, artifact: &'a ArtifactRef) -> ArtifactFuture<'a, Bytes> {
        let value = self.sink.read(&artifact.uri);
        Box::pin(async move {
            value
                .map_err(|error| WorkspaceError::Artifact(error.to_string()))?
                .ok_or_else(|| {
                    WorkspaceError::Artifact(format!("artifact was not found: {}", artifact.uri))
                })
        })
    }

    fn read_prefix<'a>(
        &'a self,
        artifact: &'a ArtifactRef,
        max_bytes: usize,
    ) -> ArtifactFuture<'a, (Bytes, bool)> {
        Box::pin(async move {
            let bytes = self.read(artifact).await?;
            let truncated = bytes.len() > max_bytes;
            Ok((bytes.slice(..bytes.len().min(max_bytes)), truncated))
        })
    }

    fn copy_to<'a>(
        &'a self,
        artifact: &'a ArtifactRef,
        destination: &'a Path,
    ) -> ArtifactFuture<'a, ()> {
        Box::pin(async move {
            let bytes = self.read(artifact).await?;
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(destination, bytes)?;
            Ok(())
        })
    }

    fn scratch(&self) -> &dyn ScratchSpace {
        self
    }
}

impl ScratchSpace for MemoryArtifactRepository {
    fn materialize<'a>(
        &'a self,
        _input: &'a dyn InputSource,
    ) -> NormalizerFuture<'a, Box<dyn MaterializedInput>> {
        Box::pin(async {
            Err(NormalizerError::new(
                agent_file_normalizer::NormalizerErrorCode::DEPENDENCY_MISSING,
                agent_file_normalizer::NormalizerErrorCategory::Requirement,
                "memory artifact repository has no scratch space",
            ))
        })
    }
}
