use context_structure::BytesStructureInputSource;
use context_structure::StructureNeverCancelled;
use context_structure::StructureParseContext;
use context_structure::StructureParseRequest;
use context_structure::StructureParserFactory;
use context_structure::StructureResourceLimits;
use context_structure_parser_test_support::ProgressCollector;
use context_structure_parser_test_support::normalized_source;
use context_structure_parser_tree_sitter_typescript::TypeScriptStructureParserFactory;

#[tokio::test]
async fn parses_typescript_symbols_conditions_calls_and_relations()
-> Result<(), Box<dyn std::error::Error>> {
    let content = "function refund(total: number) { if (total > 0) { audit(total); } }";
    let normalized = normalized_source("ts", "typescript", "text/typescript");
    let input = BytesStructureInputSource::new(content.as_bytes().to_vec());
    let progress = ProgressCollector::default();
    let factory = TypeScriptStructureParserFactory::new();
    let parser = factory.create(&serde_json::json!({}))?;
    let report = parser
        .parse(
            StructureParseRequest {
                normalized: &normalized,
                input: &input,
            },
            StructureParseContext {
                progress: &progress,
                cancellation: &StructureNeverCancelled,
                limits: StructureResourceLimits::default(),
            },
        )
        .await?;
    assert!(report.units.iter().any(|unit| unit.kind == "file"));
    assert!(report.units.iter().any(|unit| unit.kind == "function"));
    assert!(report.units.iter().any(|unit| unit.kind == "condition"));
    assert!(report.units.iter().any(|unit| unit.kind == "call"));
    assert!(
        report
            .relations
            .iter()
            .any(|relation| relation.kind == "declares")
    );
    assert!(
        report
            .relations
            .iter()
            .any(|relation| relation.kind == "calls")
    );
    assert!(progress.is_monotonic());
    Ok(())
}
