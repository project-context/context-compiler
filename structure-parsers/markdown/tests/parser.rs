use context_structure::BytesStructureInputSource;
use context_structure::StructureNeverCancelled;
use context_structure::StructureParseContext;
use context_structure::StructureParseRequest;
use context_structure::StructureParserFactory;
use context_structure::StructureResourceLimits;
use context_structure_parser_markdown::MarkdownStructureParserFactory;
use context_structure_parser_test_support::ProgressCollector;
use context_structure_parser_test_support::normalized_source;

#[tokio::test]
async fn parses_markdown_units_relations_and_monotonic_progress()
-> Result<(), Box<dyn std::error::Error>> {
    let content =
        "# Refund\n\nRefunds must complete in 7 days.\n\n- Keep receipt\n\n```ts\nrefund();\n```\n";
    let normalized = normalized_source("md", "markdown", "text/markdown");
    let input = BytesStructureInputSource::new(content.as_bytes().to_vec());
    let progress = ProgressCollector::default();
    let factory = MarkdownStructureParserFactory::new();
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
    assert!(report.units.iter().any(|unit| unit.kind == "document"));
    assert!(report.units.iter().any(|unit| unit.kind == "heading"));
    assert!(report.units.iter().any(|unit| unit.kind == "paragraph"));
    assert!(report.units.iter().any(|unit| unit.kind == "list_item"));
    assert!(report.units.iter().any(|unit| unit.kind == "code_block"));
    assert!(
        report
            .relations
            .iter()
            .any(|relation| relation.kind == "contains")
    );
    assert!(progress.is_monotonic());
    Ok(())
}
