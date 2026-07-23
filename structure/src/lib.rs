//! Storage-neutral Structure layer contracts.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod catalog;
mod memory;
mod model;
mod parser;
mod store;

pub use catalog::StructureCatalogReader;
pub use catalog::StructureQuery;
pub use memory::MemoryStructureStore;
pub use model::ResolvedStructureView;
pub use model::StructureBuildOutput;
pub use model::StructureBuildRecord;
pub use model::StructureBuildRequest;
pub use model::StructureCommit;
pub use model::StructureKind;
pub use model::StructureRelationRecord;
pub use model::StructureRelationType;
pub use model::StructureUnit;
pub use parser::BytesStructureInputSource;
pub use parser::ConfiguredStructureParser;
pub use parser::STRUCTURE_PARSER_PROTOCOL_VERSION;
pub use parser::StructureCancellation;
pub use parser::StructureFileFamily;
pub use parser::StructureInputMatcher;
pub use parser::StructureInputSource;
pub use parser::StructureNeverCancelled;
pub use parser::StructureNoProgress;
pub use parser::StructureParseContext;
pub use parser::StructureParseDiagnostic;
pub use parser::StructureParseProgress;
pub use parser::StructureParseReport;
pub use parser::StructureParseRequest;
pub use parser::StructureParseStatistics;
pub use parser::StructureParsedRelation;
pub use parser::StructureParsedUnit;
pub use parser::StructureParser;
pub use parser::StructureParserCapabilities;
pub use parser::StructureParserDescriptor;
pub use parser::StructureParserError;
pub use parser::StructureParserFactory;
pub use parser::StructureParserFuture;
pub use parser::StructureParserId;
pub use parser::StructureParserRegistry;
pub use parser::StructureParserResult;
pub use parser::StructureProgressReporter;
pub use parser::StructureResourceLimits;
pub use parser::read_structure_input;
pub use parser::structure_config_hash;
pub use store::StructureBuilder;
pub use store::StructureError;
pub use store::StructureFuture;
pub use store::StructureReader;
pub use store::StructureResult;
pub use store::StructureStore;
