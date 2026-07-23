//! Incremental Context Compiler orchestration.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod compiler;
mod registry;

pub use compiler::BuildOptions;
pub use compiler::CompileError;
pub use compiler::CompileResult;
pub use compiler::CompileSummary;
pub use compiler::Compiler;
pub use compiler::NormalizationProgress;
pub use compiler::StructureProgress;
pub use compiler::default_normalizer_registry;
pub use registry::Processor;
pub use registry::ProcessorRegistry;
