use std::sync::Arc;

use context_config::ConfigError;
use context_config::ConfigRepository;
use context_config::ContextConfig;
use context_config::StructurePolicy;
use context_config::StructureRoute;
use context_structure::StructureParserRegistry;
use context_structure_parser_markdown::MarkdownStructureParserFactory;
use context_structure_parser_tree_sitter_typescript::TypeScriptStructureParserFactory;

fn parser_registry() -> Result<StructureParserRegistry, Box<dyn std::error::Error>> {
    let mut registry = StructureParserRegistry::new();
    registry.register(Arc::new(MarkdownStructureParserFactory::new()))?;
    registry.register(Arc::new(TypeScriptStructureParserFactory::new()))?;
    Ok(registry)
}

#[test]
fn schema_v1_loads_with_virtual_structure_defaults() -> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    std::fs::write(
        root.path().join("context.config.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "sources": [],
            "normalization": {}
        }))?,
    )?;
    let loaded = ConfigRepository::new(root.path()).load(&[])?;
    assert_eq!(loaded.config.schema_version, 2);
    assert!(!loaded.persisted);
    assert_eq!(
        loaded
            .config
            .structure
            .route("md")
            .map(|route| route.parser_id.as_str()),
        Some("markdown-ast")
    );
    assert_eq!(
        loaded
            .config
            .structure
            .route("ts")
            .map(|route| route.parser_id.as_str()),
        Some("tree-sitter-typescript")
    );
    Ok(())
}

#[test]
fn structure_routes_require_unique_compatible_installed_parsers()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let repository = ConfigRepository::new(root.path());
    let loaded = repository.load(&[])?;
    let registry = parser_registry()?;
    let mut config = ContextConfig {
        sources: Vec::new(),
        ..ContextConfig::default()
    };
    repository.save_with_structure(&config, Some(&loaded.etag), &[], &registry)?;

    config.structure.routes.push(StructureRoute {
        extension: ".md".to_owned(),
        parser_id: "markdown-ast".to_owned(),
        config: serde_json::json!({}),
    });
    assert!(matches!(
        repository.save_with_structure(&config, None, &[], &registry),
        Err(ConfigError::Validation(message)) if message.contains("duplicated")
    ));

    config.structure = StructurePolicy {
        routes: vec![StructureRoute {
            extension: "html".to_owned(),
            parser_id: "markdown-ast".to_owned(),
            config: serde_json::json!({}),
        }],
    };
    assert!(matches!(
        repository.save_with_structure(&config, None, &[], &registry),
        Err(ConfigError::Validation(message)) if message.contains("does not support")
    ));

    config.structure.routes[0].parser_id = "not-installed".to_owned();
    assert!(matches!(
        repository.save_with_structure(&config, None, &[], &registry),
        Err(ConfigError::Validation(message)) if message.contains("not installed")
    ));
    Ok(())
}
