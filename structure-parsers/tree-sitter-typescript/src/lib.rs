//! Tree-sitter TypeScript structure parser.

#![deny(private_bounds, private_interfaces, unreachable_pub)]

use std::collections::BTreeMap;
use std::sync::Arc;

use context_protocol::Locator;
use context_source::FormatId;
use context_structure::STRUCTURE_PARSER_PROTOCOL_VERSION;
use context_structure::StructureFileFamily;
use context_structure::StructureInputMatcher;
use context_structure::StructureParseContext;
use context_structure::StructureParseProgress;
use context_structure::StructureParseReport;
use context_structure::StructureParseRequest;
use context_structure::StructureParseStatistics;
use context_structure::StructureParsedRelation;
use context_structure::StructureParsedUnit;
use context_structure::StructureParser;
use context_structure::StructureParserCapabilities;
use context_structure::StructureParserDescriptor;
use context_structure::StructureParserError;
use context_structure::StructureParserFactory;
use context_structure::StructureParserFuture;
use context_structure::StructureParserId;
use context_structure::StructureParserResult;
use context_structure::read_structure_input;
use tree_sitter::Node;
use tree_sitter::Parser;

#[derive(Clone)]
pub struct TypeScriptStructureParserFactory {
    descriptor: StructureParserDescriptor,
    schema: serde_json::Value,
}

impl Default for TypeScriptStructureParserFactory {
    fn default() -> Self {
        Self {
            descriptor: StructureParserDescriptor {
                protocol_version: STRUCTURE_PARSER_PROTOCOL_VERSION,
                id: StructureParserId::new("tree-sitter-typescript"),
                display_name: "Tree-sitter TypeScript".to_owned(),
                implementation_version: env!("CARGO_PKG_VERSION").to_owned(),
                inputs: vec![StructureInputMatcher {
                    formats: vec![FormatId::new("typescript")],
                    media_types: vec!["text/typescript".to_owned()],
                    extensions: vec!["ts".to_owned(), "tsx".to_owned()],
                    families: vec![StructureFileFamily::Code],
                }],
                capabilities: StructureParserCapabilities::default(),
                default_priority: 100,
            },
            schema: serde_json::json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "additionalProperties": false
            }),
        }
    }
}

impl TypeScriptStructureParserFactory {
    pub fn new() -> Self {
        Self::default()
    }
}

impl StructureParserFactory for TypeScriptStructureParserFactory {
    fn descriptor(&self) -> &StructureParserDescriptor {
        &self.descriptor
    }

    fn config_schema(&self) -> &serde_json::Value {
        &self.schema
    }

    fn validate_config(&self, config: &serde_json::Value) -> StructureParserResult<()> {
        if config.as_object().is_some_and(serde_json::Map::is_empty) {
            Ok(())
        } else {
            Err(StructureParserError::InvalidConfig(
                "tree-sitter-typescript currently accepts only an empty object".to_owned(),
            ))
        }
    }

    fn create(
        &self,
        config: &serde_json::Value,
    ) -> StructureParserResult<Arc<dyn StructureParser>> {
        self.validate_config(config)?;
        Ok(Arc::new(TypeScriptStructureParser {
            descriptor: self.descriptor.clone(),
        }))
    }
}

#[derive(Clone)]
pub struct TypeScriptStructureParser {
    descriptor: StructureParserDescriptor,
}

impl StructureParser for TypeScriptStructureParser {
    fn descriptor(&self) -> &StructureParserDescriptor {
        &self.descriptor
    }

    fn parse<'a>(
        &'a self,
        request: StructureParseRequest<'a>,
        context: StructureParseContext<'a>,
    ) -> StructureParserFuture<'a, StructureParseReport> {
        Box::pin(async move {
            if !self.descriptor.supports(request.normalized) {
                return Err(StructureParserError::UnsupportedInput);
            }
            let bytes = read_structure_input(request.input, &context).await?;
            let content = std::str::from_utf8(&bytes)
                .map_err(|error| StructureParserError::InvalidUtf8(error.to_string()))?;
            let mut parser = Parser::new();
            parser
                .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
                .map_err(|error| StructureParserError::Parse(error.to_string()))?;
            let tree = parser.parse(content, None).ok_or_else(|| {
                StructureParserError::Parse("tree-sitter returned no tree".to_owned())
            })?;
            let artifact = request.normalized.primary.artifact.clone();
            let mut raw = Vec::new();
            let mut relations = Vec::new();
            let mut counts = BTreeMap::new();
            visit(
                tree.root_node(),
                bytes.as_ref(),
                None,
                &artifact,
                &mut raw,
                &mut relations,
                &mut counts,
                &context,
            )?;
            if raw.len() as u64 > context.limits.max_units
                || relations.len() as u64 > context.limits.max_relations
            {
                return Err(StructureParserError::ResourceLimit(
                    "unit or relation limit exceeded".to_owned(),
                ));
            }
            let internal_structure = serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "parser": self.descriptor.id.as_str(),
                "units": raw,
                "relations": relations,
            }))
            .map_err(|error| StructureParserError::Parse(error.to_string()))?;
            let unit_count = raw.len() as u64;
            let relation_count = relations.len() as u64;
            context.progress.report(StructureParseProgress {
                phase: "complete".to_owned(),
                completed: (bytes.len() as u64).saturating_mul(2),
                total: Some((bytes.len() as u64).saturating_mul(2)),
                message: Some(format!("generated {unit_count} units")),
                generated_units: unit_count,
            })?;
            Ok(StructureParseReport {
                units: raw,
                relations,
                internal_structure,
                diagnostics: Vec::new(),
                statistics: StructureParseStatistics {
                    input_bytes: bytes.len() as u64,
                    unit_count,
                    relation_count,
                },
            })
        })
    }
}

#[allow(clippy::too_many_arguments)]
fn visit(
    node: Node<'_>,
    source: &[u8],
    parent: Option<String>,
    artifact: &context_protocol::ArtifactRef,
    units: &mut Vec<StructureParsedUnit>,
    relations: &mut Vec<StructureParsedRelation>,
    counts: &mut BTreeMap<String, usize>,
    context: &StructureParseContext<'_>,
) -> StructureParserResult<()> {
    if context.cancellation.is_cancelled() {
        return Err(StructureParserError::Cancelled);
    }
    let mapped = match node.kind() {
        "program" => Some(("file", "file")),
        "function_declaration" | "function_expression" | "arrow_function" => {
            Some(("function", "symbol"))
        }
        "method_definition" => Some(("method", "symbol")),
        "if_statement" | "switch_statement" | "ternary_expression" => {
            Some(("condition", "condition"))
        }
        "call_expression" => Some(("call", "call")),
        _ => None,
    };
    let current = if let Some((kind, prefix)) = mapped {
        let name_node = node
            .child_by_field_name("name")
            .or_else(|| node.child_by_field_name("function"));
        let label = name_node
            .and_then(|value| value.utf8_text(source).ok())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{}:{}", node.kind(), node.start_position().row + 1));
        let seed = if kind == "file" {
            "file".to_owned()
        } else {
            format!("{prefix}:{}", slug(&label))
        };
        let count = counts.entry(seed.clone()).or_insert(0);
        *count += 1;
        let local_id = if *count == 1 {
            seed
        } else {
            format!("{seed}:{}", *count)
        };
        let node_preview = preview(
            node.utf8_text(source).unwrap_or(&label),
            context.limits.max_preview_bytes,
        );
        units.push(StructureParsedUnit {
            local_id: local_id.clone(),
            stable_key: local_id.clone(),
            kind: kind.to_owned(),
            label,
            preview: node_preview,
            locator: Locator::ByteRange {
                artifact: artifact.clone(),
                start: node.start_byte() as u64,
                end: node.end_byte() as u64,
            },
        });
        if let Some(parent) = &parent {
            let relation_kind = if matches!(kind, "function" | "method") {
                "declares"
            } else if kind == "call" {
                "calls"
            } else {
                "contains"
            };
            relations.push(StructureParsedRelation {
                local_id: format!("{relation_kind}:{parent}:{local_id}"),
                kind: relation_kind.to_owned(),
                from_local_id: parent.clone(),
                to_local_id: local_id.clone(),
                locator: None,
            });
        }
        Some(local_id)
    } else {
        parent
    };
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        visit(
            child,
            source,
            current.clone(),
            artifact,
            units,
            relations,
            counts,
            context,
        )?;
    }
    Ok(())
}

fn slug(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned()
}

fn preview(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}…", &value[..boundary])
}
