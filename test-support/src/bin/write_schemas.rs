fn main() -> Result<(), Box<dyn std::error::Error>> {
    context_test_support::write_schemas(std::env::current_dir()?)?;
    Ok(())
}
