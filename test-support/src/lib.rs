//! Shared fixtures, memory stores, and Schema helpers for Context Compiler tests.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod fixture;
mod memory;
mod schemas;

pub use fixture::RefundFixture;
pub use fixture::TestSupportError;
pub use fixture::TestSupportResult;
pub use memory::MemoryStores;
pub use schemas::schema_documents;
pub use schemas::write_schemas;
