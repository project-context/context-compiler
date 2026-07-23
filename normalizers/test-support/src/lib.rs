//! Runtime-neutral contract helpers for independently testing normalizer crates.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use agent_file_normalizer::ArtifactSink;
use agent_file_normalizer::BytesInputSource;
use agent_file_normalizer::Cancellation;
use agent_file_normalizer::InputMetadata;
use agent_file_normalizer::MemoryArtifactSink;
use agent_file_normalizer::NoScratchSpace;
use agent_file_normalizer::NormalizationContext;
use agent_file_normalizer::NormalizationProgress;
use agent_file_normalizer::NormalizationReport;
use agent_file_normalizer::NormalizationRequest;
use agent_file_normalizer::NormalizerError;
use agent_file_normalizer::NormalizerFactory;
use agent_file_normalizer::NormalizerResult;
use agent_file_normalizer::ProbeRequest;
use agent_file_normalizer::ProgressReporter;
use agent_file_normalizer::ResourceLimits;
use bytes::Bytes;

pub use agent_file_normalizer::BytesInputSource as MemoryInputSource;
pub use agent_file_normalizer::MemoryArtifactSink as TestArtifactSink;

#[derive(Clone, Default)]
pub struct TestCancellation {
    cancelled: Arc<AtomicBool>,
}

impl TestCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

impl Cancellation for TestCancellation {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Clone, Default)]
pub struct ProgressCollector {
    events: Arc<Mutex<Vec<NormalizationProgress>>>,
}

impl ProgressCollector {
    pub fn events(&self) -> NormalizerResult<Vec<NormalizationProgress>> {
        self.events
            .lock()
            .map(|events| events.clone())
            .map_err(|_| internal("progress collector lock is poisoned"))
    }

    pub fn assert_monotonic(&self) -> NormalizerResult<()> {
        let events = self.events()?;
        for pair in events.windows(2) {
            if pair[0].unit == pair[1].unit
                && pair[0].phase == pair[1].phase
                && pair[1].completed < pair[0].completed
            {
                return Err(internal("normalizer progress moved backwards"));
            }
        }
        Ok(())
    }
}

impl ProgressReporter for ProgressCollector {
    fn report(&self, progress: NormalizationProgress) -> NormalizerResult<()> {
        self.events
            .lock()
            .map_err(|_| internal("progress collector lock is poisoned"))?
            .push(progress);
        Ok(())
    }
}

pub struct ContractOutput {
    pub probe: agent_file_normalizer::ProbeResult,
    pub report: NormalizationReport,
    pub primary: Bytes,
    pub progress: Vec<NormalizationProgress>,
}

pub async fn run_contract(
    factory: &dyn NormalizerFactory,
    config: &serde_json::Value,
    metadata: InputMetadata,
    bytes: impl Into<Bytes>,
) -> NormalizerResult<ContractOutput> {
    factory.validate_config(config)?;
    let normalizer = factory.create(config)?;
    let input = BytesInputSource::new(metadata, bytes.into());
    let probe = normalizer.probe(ProbeRequest { input: &input }).await?;
    if !probe.supported {
        return Err(NormalizerError::new(
            agent_file_normalizer::NormalizerErrorCode::UNSUPPORTED_INPUT,
            agent_file_normalizer::NormalizerErrorCategory::Input,
            "contract input was rejected by probe",
        ));
    }
    let sink = MemoryArtifactSink::default();
    let progress = ProgressCollector::default();
    let cancellation = TestCancellation::default();
    let report = normalizer
        .normalize(
            NormalizationRequest { input: &input },
            NormalizationContext {
                artifacts: &sink,
                scratch: &NoScratchSpace,
                cancellation: &cancellation,
                progress: &progress,
                limits: ResourceLimits::default(),
            },
        )
        .await?;
    let artifacts = report.artifacts().cloned().collect::<Vec<_>>();
    sink.commit(&artifacts).await?;
    let primary = sink
        .read(&report.primary.uri)?
        .ok_or_else(|| internal("primary artifact was not committed"))?;
    std::str::from_utf8(&primary)
        .map_err(|error| NormalizerError::invalid_output(error.to_string()))?;
    progress.assert_monotonic()?;
    Ok(ContractOutput {
        probe,
        report,
        primary,
        progress: progress.events()?,
    })
}

fn internal(message: impl Into<String>) -> NormalizerError {
    NormalizerError::new(
        agent_file_normalizer::NormalizerErrorCode::INTERNAL,
        agent_file_normalizer::NormalizerErrorCategory::Internal,
        message,
    )
}
