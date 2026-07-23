use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;

use bytes::Bytes;
use sha2::Digest;
use sha2::Sha256;

use crate::ArtifactRole;
use crate::ArtifactSpecification;
use crate::FormatId;
use crate::InputMetadata;
use crate::NormalizationProgress;
use crate::NormalizationReport;
use crate::NormalizationStatistics;
use crate::NormalizedMapping;
use crate::NormalizerError;
use crate::NormalizerFuture;
use crate::NormalizerResult;
use crate::ProducedArtifact;
use crate::ResourceLimits;
use crate::WorkUnit;

pub trait InputSource: Send + Sync {
    fn metadata(&self) -> &InputMetadata;
    fn read_range(&self, offset: u64, max_len: usize) -> NormalizerFuture<'_, Bytes>;
}

pub trait ArtifactWriter: Send {
    fn write(&mut self, chunk: Bytes) -> NormalizerFuture<'_, ()>;
    fn finish(self: Box<Self>) -> NormalizerFuture<'static, ProducedArtifact>;
}

pub trait ArtifactSink: Send + Sync {
    fn create(
        &self,
        specification: ArtifactSpecification,
    ) -> NormalizerFuture<'_, Box<dyn ArtifactWriter>>;

    fn commit<'a>(&'a self, artifacts: &'a [ProducedArtifact]) -> NormalizerFuture<'a, ()>;

    fn abort(&self) -> NormalizerFuture<'_, ()>;
}

pub trait Cancellation: Send + Sync {
    fn is_cancelled(&self) -> bool;
}

pub trait ProgressReporter: Send + Sync {
    fn report(&self, progress: NormalizationProgress) -> NormalizerResult<()>;
}

pub trait ScratchSpace: Send + Sync {
    fn materialize<'a>(
        &'a self,
        input: &'a dyn InputSource,
    ) -> NormalizerFuture<'a, Box<dyn MaterializedInput>>;
}

pub trait MaterializedInput: Send + Sync {
    fn path(&self) -> &Path;
}

pub struct NormalizationRequest<'a> {
    pub input: &'a dyn InputSource,
}

pub struct ProbeRequest<'a> {
    pub input: &'a dyn InputSource,
}

pub struct NormalizationContext<'a> {
    pub artifacts: &'a dyn ArtifactSink,
    pub scratch: &'a dyn ScratchSpace,
    pub progress: &'a dyn ProgressReporter,
    pub cancellation: &'a dyn Cancellation,
    pub limits: ResourceLimits,
}

#[derive(Clone)]
pub struct BytesInputSource {
    metadata: InputMetadata,
    bytes: Bytes,
}

impl BytesInputSource {
    pub fn new(metadata: InputMetadata, bytes: impl Into<Bytes>) -> Self {
        Self {
            metadata,
            bytes: bytes.into(),
        }
    }
}

impl InputSource for BytesInputSource {
    fn metadata(&self) -> &InputMetadata {
        &self.metadata
    }

    fn read_range(&self, offset: u64, max_len: usize) -> NormalizerFuture<'_, Bytes> {
        let start = usize::try_from(offset).unwrap_or(usize::MAX);
        let bytes = if start >= self.bytes.len() {
            Bytes::new()
        } else {
            let end = start.saturating_add(max_len).min(self.bytes.len());
            self.bytes.slice(start..end)
        };
        Box::pin(async move { Ok(bytes) })
    }
}

#[derive(Clone, Copy, Default)]
pub struct NeverCancelled;

impl Cancellation for NeverCancelled {
    fn is_cancelled(&self) -> bool {
        false
    }
}

#[derive(Clone, Copy, Default)]
pub struct NoProgress;

impl ProgressReporter for NoProgress {
    fn report(&self, _progress: NormalizationProgress) -> NormalizerResult<()> {
        Ok(())
    }
}

#[derive(Clone, Copy, Default)]
pub struct NoScratchSpace;

impl ScratchSpace for NoScratchSpace {
    fn materialize<'a>(
        &'a self,
        _input: &'a dyn InputSource,
    ) -> NormalizerFuture<'a, Box<dyn MaterializedInput>> {
        Box::pin(async {
            Err(NormalizerError::new(
                crate::NormalizerErrorCode::DEPENDENCY_MISSING,
                crate::NormalizerErrorCategory::Requirement,
                "the host did not provide a scratch space",
            ))
        })
    }
}

pub async fn read_all(
    input: &dyn InputSource,
    context: &NormalizationContext<'_>,
) -> NormalizerResult<Bytes> {
    let mut result = Vec::new();
    let mut offset = 0_u64;
    loop {
        if context.cancellation.is_cancelled() {
            return Err(NormalizerError::cancelled());
        }
        let chunk = input.read_range(offset, context.limits.chunk_size).await?;
        if chunk.is_empty() {
            break;
        }
        offset = offset.saturating_add(chunk.len() as u64);
        if offset > context.limits.max_input_bytes {
            return Err(NormalizerError::new(
                crate::NormalizerErrorCode::RESOURCE_LIMIT,
                crate::NormalizerErrorCategory::Resource,
                "normalizer input exceeded the configured byte limit",
            ));
        }
        result.extend_from_slice(&chunk);
        context.progress.report(NormalizationProgress {
            phase: "read_input".into(),
            completed: offset,
            total: input.metadata().size_bytes,
            unit: WorkUnit::Bytes,
            message: Some(input.metadata().source_uri.clone()),
        })?;
    }
    Ok(Bytes::from(result))
}

pub async fn write_primary_text(
    context: &NormalizationContext<'_>,
    format: FormatId,
    media_type: impl Into<String>,
    extension: impl Into<String>,
    content: String,
) -> NormalizerResult<ProducedArtifact> {
    if content.len() as u64 > context.limits.max_output_bytes {
        return Err(NormalizerError::new(
            crate::NormalizerErrorCode::RESOURCE_LIMIT,
            crate::NormalizerErrorCategory::Resource,
            "normalizer output exceeded the configured byte limit",
        ));
    }
    if content.contains('\0') || content.contains('\r') {
        return Err(NormalizerError::invalid_output(
            "primary text must be UTF-8 with LF line endings and no NUL bytes",
        ));
    }
    let mut writer = context
        .artifacts
        .create(ArtifactSpecification {
            role: ArtifactRole::Primary,
            relative_path: None,
            media_type: media_type.into(),
            format: Some(format),
            extension: Some(extension.into()),
        })
        .await?;
    writer.write(Bytes::from(content)).await?;
    writer.finish().await
}

pub async fn write_locator_map(
    context: &NormalizationContext<'_>,
    mappings: &[NormalizedMapping],
) -> NormalizerResult<Option<ProducedArtifact>> {
    if mappings.is_empty() {
        return Ok(None);
    }
    let mut writer = context
        .artifacts
        .create(ArtifactSpecification {
            role: ArtifactRole::LocatorMap,
            relative_path: Some("locator-map.jsonl".to_owned()),
            media_type: "application/x-context-locator-map+jsonl".to_owned(),
            format: Some(FormatId::new("locator_map_jsonl")),
            extension: Some("jsonl".to_owned()),
        })
        .await?;
    for mapping in mappings {
        let mut line = serde_json::to_vec(mapping)
            .map_err(|error| NormalizerError::invalid_output(error.to_string()))?;
        line.push(b'\n');
        writer.write(Bytes::from(line)).await?;
    }
    writer.finish().await.map(Some)
}

#[allow(clippy::too_many_arguments)]
pub async fn finish_text_normalization(
    context: &NormalizationContext<'_>,
    output_format: crate::NormalizedFormat,
    input_bytes: u64,
    content: String,
    mappings: Vec<NormalizedMapping>,
    diagnostics: Vec<crate::NormalizationDiagnostic>,
    processed_units: u64,
    total_units: u64,
) -> NormalizerResult<NormalizationReport> {
    let output_bytes = content.len() as u64;
    let primary = write_primary_text(
        context,
        output_format.format,
        output_format.media_type,
        output_format.extension,
        content,
    )
    .await?;
    let locator_map = write_locator_map(context, &mappings).await?;
    Ok(NormalizationReport {
        primary,
        companions: Vec::new(),
        locator_map,
        diagnostics,
        statistics: NormalizationStatistics {
            input_bytes,
            output_bytes,
            processed_units,
            total_units,
        },
    })
}

#[derive(Clone, Default)]
pub struct MemoryArtifactSink {
    committed: Arc<Mutex<BTreeMap<String, Bytes>>>,
    staged: Arc<Mutex<BTreeMap<String, Bytes>>>,
}

impl MemoryArtifactSink {
    pub fn read(&self, uri: &str) -> NormalizerResult<Option<Bytes>> {
        self.committed
            .lock()
            .map(|values| values.get(uri).cloned())
            .map_err(|_| NormalizerError::artifact_write("memory artifact lock is poisoned"))
    }
}

impl ArtifactSink for MemoryArtifactSink {
    fn create(
        &self,
        specification: ArtifactSpecification,
    ) -> NormalizerFuture<'_, Box<dyn ArtifactWriter>> {
        let staged = self.staged.clone();
        Box::pin(async move {
            Ok(Box::new(MemoryArtifactWriter {
                specification,
                staged,
                bytes: Vec::new(),
            }) as Box<dyn ArtifactWriter>)
        })
    }

    fn commit<'a>(&'a self, artifacts: &'a [ProducedArtifact]) -> NormalizerFuture<'a, ()> {
        Box::pin(async move {
            let mut staged = self
                .staged
                .lock()
                .map_err(|_| NormalizerError::artifact_write("memory artifact lock is poisoned"))?;
            let mut committed = self
                .committed
                .lock()
                .map_err(|_| NormalizerError::artifact_write("memory artifact lock is poisoned"))?;
            for artifact in artifacts {
                let bytes = staged.remove(&artifact.uri).ok_or_else(|| {
                    NormalizerError::artifact_write(format!(
                        "staged artifact is missing: {}",
                        artifact.uri
                    ))
                })?;
                committed.entry(artifact.uri.clone()).or_insert(bytes);
            }
            Ok(())
        })
    }

    fn abort(&self) -> NormalizerFuture<'_, ()> {
        Box::pin(async move {
            self.staged
                .lock()
                .map_err(|_| NormalizerError::artifact_write("memory artifact lock is poisoned"))?
                .clear();
            Ok(())
        })
    }
}

struct MemoryArtifactWriter {
    specification: ArtifactSpecification,
    staged: Arc<Mutex<BTreeMap<String, Bytes>>>,
    bytes: Vec<u8>,
}

impl ArtifactWriter for MemoryArtifactWriter {
    fn write(&mut self, chunk: Bytes) -> NormalizerFuture<'_, ()> {
        self.bytes.extend_from_slice(&chunk);
        Box::pin(async { Ok(()) })
    }

    fn finish(self: Box<Self>) -> NormalizerFuture<'static, ProducedArtifact> {
        Box::pin(async move {
            validate_artifact_bytes(&self.specification, &self.bytes)?;
            let content_hash = format!("sha256:{:x}", Sha256::digest(&self.bytes));
            let uri = format!("artifact:{content_hash}");
            let size_bytes = self.bytes.len() as u64;
            self.staged
                .lock()
                .map_err(|_| NormalizerError::artifact_write("memory artifact lock is poisoned"))?
                .insert(uri.clone(), Bytes::from(self.bytes));
            Ok(ProducedArtifact {
                uri,
                role: self.specification.role,
                relative_path: self.specification.relative_path,
                media_type: self.specification.media_type,
                format: self.specification.format,
                extension: self.specification.extension,
                content_hash,
                size_bytes,
            })
        })
    }
}

fn validate_artifact_bytes(
    specification: &ArtifactSpecification,
    bytes: &[u8],
) -> NormalizerResult<()> {
    if specification.role == ArtifactRole::Primary {
        let text = std::str::from_utf8(bytes)
            .map_err(|error| NormalizerError::invalid_output(error.to_string()))?;
        if text.contains('\0') || text.contains('\r') {
            return Err(NormalizerError::invalid_output(
                "primary text must use canonical LF line endings and contain no NUL bytes",
            ));
        }
    }
    Ok(())
}
