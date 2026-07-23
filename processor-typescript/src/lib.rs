//! TypeScript Structure, Evidence, and Fact builders.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

mod processor;

pub use processor::TypeScriptProcessor;

#[cfg(test)]
#[path = "processor_tests.rs"]
mod tests;
