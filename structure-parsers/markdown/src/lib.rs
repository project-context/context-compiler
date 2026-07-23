//! Markdown AST structure parser.

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
use pulldown_cmark::Event;
use pulldown_cmark::Options;
use pulldown_cmark::Parser;
use pulldown_cmark::Tag;
use pulldown_cmark::TagEnd;

#[derive(Clone)]
pub struct MarkdownStructureParserFactory {
    descriptor: StructureParserDescriptor,
    schema: serde_json::Value,
}

impl Default for MarkdownStructureParserFactory {
    fn default() -> Self {
        Self {
            descriptor: StructureParserDescriptor {
                protocol_version: STRUCTURE_PARSER_PROTOCOL_VERSION,
                id: StructureParserId::new("markdown-ast"),
                display_name: "Markdown AST".to_owned(),
                implementation_version: env!("CARGO_PKG_VERSION").to_owned(),
                inputs: vec![StructureInputMatcher {
                    formats: vec![FormatId::new("markdown")],
                    media_types: vec!["text/markdown".to_owned()],
                    extensions: vec!["md".to_owned(), "markdown".to_owned()],
                    families: vec![StructureFileFamily::Document],
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

impl MarkdownStructureParserFactory {
    pub fn new() -> Self {
        Self::default()
    }
}

impl StructureParserFactory for MarkdownStructureParserFactory {
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
                "markdown-ast currently accepts only an empty object".to_owned(),
            ))
        }
    }

    fn create(
        &self,
        config: &serde_json::Value,
    ) -> StructureParserResult<Arc<dyn StructureParser>> {
        self.validate_config(config)?;
        Ok(Arc::new(MarkdownStructureParser {
            descriptor: self.descriptor.clone(),
        }))
    }
}

#[derive(Clone)]
pub struct MarkdownStructureParser {
    descriptor: StructureParserDescriptor,
}

impl StructureParser for MarkdownStructureParser {
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
            let artifact = request.normalized.primary.artifact.clone();
            let mut units = vec![StructureParsedUnit {
                local_id: "document".to_owned(),
                stable_key: "document".to_owned(),
                kind: "document".to_owned(),
                label: request
                    .normalized
                    .primary
                    .relative_path
                    .clone()
                    .unwrap_or_else(|| request.normalized.source_snapshot.entity.id.clone()),
                preview: preview(content, context.limits.max_preview_bytes),
                locator: Locator::ByteRange {
                    artifact: artifact.clone(),
                    start: 0,
                    end: bytes.len() as u64,
                },
            }];
            let mut relations = Vec::new();
            let mut key_counts = BTreeMap::<String, usize>::new();
            let mut heading_path: Vec<(u8, String, String)> = Vec::new();
            let mut active = Vec::<ActiveUnit>::new();
            let mut last_local_id: Option<String> = None;
            for (event, range) in Parser::new_ext(content, Options::all()).into_offset_iter() {
                if context.cancellation.is_cancelled() {
                    return Err(StructureParserError::Cancelled);
                }
                match event {
                    Event::Start(Tag::Heading { level, .. }) => {
                        active.push(ActiveUnit::new("heading", range.start));
                        heading_path.retain(|(depth, _, _)| *depth < level as u8);
                    }
                    Event::Start(Tag::Paragraph) => {
                        active.push(ActiveUnit::new("paragraph", range.start));
                    }
                    Event::Start(Tag::Item) => {
                        active.push(ActiveUnit::new("list_item", range.start));
                    }
                    Event::Start(Tag::CodeBlock(_)) => {
                        active.push(ActiveUnit::new("code_block", range.start));
                    }
                    Event::Start(Tag::Table(_)) => {
                        active.push(ActiveUnit::new("table", range.start));
                    }
                    Event::Text(value) | Event::Code(value) => {
                        for active in &mut active {
                            active.text.push_str(&value);
                        }
                    }
                    Event::SoftBreak | Event::HardBreak => {
                        for active in &mut active {
                            active.text.push('\n');
                        }
                    }
                    Event::End(end) => {
                        let expected = match end {
                            TagEnd::Heading(_) => Some("heading"),
                            TagEnd::Paragraph => Some("paragraph"),
                            TagEnd::Item => Some("list_item"),
                            TagEnd::CodeBlock => Some("code_block"),
                            TagEnd::Table => Some("table"),
                            _ => None,
                        };
                        if let Some(expected) = expected
                            && let Some(position) =
                                active.iter().rposition(|value| value.kind == expected)
                        {
                            let active = active.remove(position);
                            let label = active.text.trim().to_owned();
                            if label.is_empty() {
                                continue;
                            }
                            let seed = if expected == "heading" {
                                let level = match end {
                                    TagEnd::Heading(level) => level as u8,
                                    _ => 1,
                                };
                                heading_path.retain(|(depth, _, _)| *depth < level);
                                let seed = heading_path
                                    .iter()
                                    .map(|(_, value, _)| slug(value))
                                    .chain(std::iter::once(slug(&label)))
                                    .collect::<Vec<_>>()
                                    .join("/");
                                let local_id = unique_key(&seed, &mut key_counts);
                                heading_path.push((level, label.clone(), local_id.clone()));
                                local_id
                            } else {
                                let prefix = heading_path
                                    .iter()
                                    .map(|(_, value, _)| slug(value))
                                    .collect::<Vec<_>>()
                                    .join("/");
                                unique_key(&format!("{prefix}/{expected}"), &mut key_counts)
                            };
                            let parent = heading_path
                                .iter()
                                .rev()
                                .find(|(_, _, id)| id != &seed)
                                .map(|(_, _, id)| id.clone())
                                .unwrap_or_else(|| "document".to_owned());
                            units.push(StructureParsedUnit {
                                local_id: seed.clone(),
                                stable_key: seed.clone(),
                                kind: expected.to_owned(),
                                label: preview(&label, 160),
                                preview: preview(&label, context.limits.max_preview_bytes),
                                locator: Locator::ByteRange {
                                    artifact: artifact.clone(),
                                    start: active.start as u64,
                                    end: range.end as u64,
                                },
                            });
                            relations.push(StructureParsedRelation {
                                local_id: format!("contains:{parent}:{seed}"),
                                kind: "contains".to_owned(),
                                from_local_id: parent,
                                to_local_id: seed.clone(),
                                locator: None,
                            });
                            if let Some(previous) = last_local_id.replace(seed.clone()) {
                                relations.push(StructureParsedRelation {
                                    local_id: format!("precedes:{previous}:{seed}"),
                                    kind: "precedes".to_owned(),
                                    from_local_id: previous,
                                    to_local_id: seed,
                                    locator: None,
                                });
                            }
                            if units.len() as u64 > context.limits.max_units
                                || relations.len() as u64 > context.limits.max_relations
                            {
                                return Err(StructureParserError::ResourceLimit(
                                    "unit or relation limit exceeded".to_owned(),
                                ));
                            }
                            context.progress.report(StructureParseProgress {
                                phase: "parse_ast".to_owned(),
                                completed: (bytes.len() as u64).saturating_add(range.end as u64),
                                total: Some((bytes.len() as u64).saturating_mul(2)),
                                message: Some(label),
                                generated_units: units.len() as u64,
                            })?;
                        }
                    }
                    _ => {}
                }
            }
            let internal_structure = serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "parser": self.descriptor.id.as_str(),
                "units": units,
                "relations": relations,
            }))
            .map_err(|error| StructureParserError::Parse(error.to_string()))?;
            let unit_count = units.len() as u64;
            let relation_count = relations.len() as u64;
            context.progress.report(StructureParseProgress {
                phase: "complete".to_owned(),
                completed: (bytes.len() as u64).saturating_mul(2),
                total: Some((bytes.len() as u64).saturating_mul(2)),
                message: Some(format!("generated {unit_count} units")),
                generated_units: unit_count,
            })?;
            Ok(StructureParseReport {
                units,
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

struct ActiveUnit {
    kind: &'static str,
    start: usize,
    text: String,
}

impl ActiveUnit {
    fn new(kind: &'static str, start: usize) -> Self {
        Self {
            kind,
            start,
            text: String::new(),
        }
    }
}

fn unique_key(seed: &str, counts: &mut BTreeMap<String, usize>) -> String {
    let seed = seed.trim_matches('/');
    let count = counts.entry(seed.to_owned()).or_default();
    *count += 1;
    if *count == 1 {
        seed.to_owned()
    } else {
        format!("{seed}:{}", *count)
    }
}

fn slug(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            output.push(character);
        } else if !output.ends_with('-') {
            output.push('-');
        }
    }
    output.trim_matches('-').to_owned()
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
