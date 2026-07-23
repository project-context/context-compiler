use context_evidence::EvidenceBuildOutput;
use context_evidence::EvidenceBuildRecord;
use context_evidence::EvidenceBuildRequest;
use context_evidence::EvidenceBuilder;
use context_evidence::EvidenceFuture;
use context_evidence::EvidenceKind;
use context_evidence::EvidenceRecord;
use context_fact::EvidenceRole;
use context_fact::FactBuildOutput;
use context_fact::FactBuildRecord;
use context_fact::FactBuildRequest;
use context_fact::FactBuilder;
use context_fact::FactEvidenceLink;
use context_fact::FactFuture;
use context_fact::FactKind;
use context_fact::FactRevision;
use context_protocol::BuildResult;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::Locator;
use context_protocol::ProducerRef;
use context_protocol::RevisionRef;
use context_protocol::RunStatus;
use context_protocol::Trace;
use context_source::FormatId;
use context_structure::StructureBuildOutput;
use context_structure::StructureBuildRecord;
use context_structure::StructureBuildRequest;
use context_structure::StructureBuilder;
use context_structure::StructureError;
use context_structure::StructureFuture;
use context_structure::StructureKind;
use context_structure::StructureUnit;
use serde_json::json;
use sha2::Digest;
use sha2::Sha256;
use tree_sitter::Node;
use tree_sitter::Parser;

#[derive(Clone, Default)]
pub struct TypeScriptProcessor;

#[derive(Clone)]
struct RawUnit {
    kind: StructureKind,
    stable_key: String,
    label: String,
    text: String,
    start: usize,
    end: usize,
}

impl TypeScriptProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl StructureBuilder for TypeScriptProcessor {
    fn normalized_format(&self) -> FormatId {
        FormatId::new("typescript")
    }

    fn build(&self, request: StructureBuildRequest) -> StructureFuture<'_, StructureBuildOutput> {
        Box::pin(async move {
            let normalized = request.normalized;
            let content = request.content;
            let mut parser = Parser::new();
            parser
                .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
                .map_err(|error| StructureError::Build(error.to_string()))?;
            let tree = parser
                .parse(&content, None)
                .ok_or_else(|| StructureError::Build("tree-sitter returned no tree".to_owned()))?;
            let mut raw = Vec::new();
            visit(tree.root_node(), content.as_bytes(), &mut raw);
            let source_id = normalized.source_snapshot.entity.id.clone();
            let build_entity =
                EntityRef::new(Layer::Structure, format!("build:typescript:{source_id}"));
            let build_ref = RevisionRef::new(
                build_entity.clone(),
                normalized.primary.content_hash.clone(),
            );
            let processor = producer();
            let trace = Trace {
                source_snapshot: normalized.source_snapshot.clone(),
                parents: vec![normalized.revision_ref.clone()],
                producer: processor.clone(),
            };
            let artifact = normalized.primary.artifact.clone();
            let units = raw
                .into_iter()
                .map(|raw| {
                    let entity = EntityRef::new(
                        Layer::Structure,
                        format!("structure:typescript:{source_id}:{}", raw.stable_key),
                    );
                    StructureUnit {
                        revision_ref: RevisionRef::new(entity, hash(&raw.text)),
                        build_ref: build_ref.clone(),
                        kind: raw.kind,
                        stable_key: raw.stable_key,
                        label: raw.label,
                        locator: Locator::ByteRange {
                            artifact: artifact.clone(),
                            start: raw.start as u64,
                            end: raw.end as u64,
                        },
                        text: raw.text,
                        trace: trace.clone(),
                        freshness: Freshness::Current,
                    }
                })
                .collect::<Vec<_>>();
            let added = units
                .iter()
                .map(|value| value.revision_ref.clone())
                .collect();
            Ok(StructureBuildOutput {
                build: StructureBuildRecord {
                    entity_ref: build_entity,
                    revision_ref: build_ref.clone(),
                    source_snapshot: normalized.source_snapshot,
                    normalized_source: normalized.revision_ref,
                    producer: processor,
                    status: RunStatus::Completed,
                    fingerprint: normalized.primary.content_hash,
                    internal_artifact: None,
                    unit_count: units.len() as u64,
                    relation_count: 0,
                },
                units,
                relations: Vec::new(),
                result: BuildResult::completed(build_ref.revision, added),
            })
        })
    }
}

impl EvidenceBuilder for TypeScriptProcessor {
    fn build(&self, request: EvidenceBuildRequest) -> EvidenceFuture<'_, EvidenceBuildOutput> {
        Box::pin(async move {
            let fingerprint = hash(
                &request
                    .structures
                    .iter()
                    .map(|value| value.revision_ref.revision.as_str())
                    .collect::<Vec<_>>()
                    .join("|"),
            );
            let build_entity = EntityRef::new(Layer::Evidence, "build:typescript:evidence");
            let build_ref = RevisionRef::new(build_entity.clone(), fingerprint.clone());
            let mut evidence = Vec::new();
            for structure in request.structures {
                let structure_ref = structure.revision_ref.clone();
                let entity = EntityRef::new(
                    Layer::Evidence,
                    format!("evidence:typescript:{}", structure.revision_ref.entity.id),
                );
                let normalized_source = structure
                    .trace
                    .parents
                    .first()
                    .cloned()
                    .unwrap_or_else(|| structure.trace.source_snapshot.clone());
                evidence.push(EvidenceRecord {
                    revision_ref: RevisionRef::new(entity, hash(&structure.text)),
                    build_ref: build_ref.clone(),
                    kind: EvidenceKind::CodeSpan,
                    stable_key: structure.stable_key,
                    structure_refs: vec![structure_ref.clone()],
                    normalized_source,
                    locator: structure.locator,
                    excerpt: structure.text,
                    trace: Trace {
                        source_snapshot: structure.trace.source_snapshot,
                        parents: vec![structure_ref],
                        producer: producer(),
                    },
                    freshness: Freshness::Current,
                });
            }
            let added = evidence
                .iter()
                .map(|value| value.revision_ref.clone())
                .collect();
            Ok(EvidenceBuildOutput {
                build: EvidenceBuildRecord {
                    entity_ref: build_entity,
                    revision_ref: build_ref.clone(),
                    producer: producer(),
                    status: RunStatus::Completed,
                    fingerprint,
                },
                evidence,
                result: BuildResult::completed(build_ref.revision, added),
            })
        })
    }
}

impl FactBuilder for TypeScriptProcessor {
    fn build(&self, request: FactBuildRequest) -> FactFuture<'_, FactBuildOutput> {
        Box::pin(async move {
            let fingerprint = hash(
                &request
                    .evidence
                    .iter()
                    .map(|value| value.revision_ref.revision.as_str())
                    .collect::<Vec<_>>()
                    .join("|"),
            );
            let build_entity = EntityRef::new(Layer::Fact, "build:typescript:fact");
            let build_ref = RevisionRef::new(build_entity.clone(), fingerprint.clone());
            let mut facts = Vec::new();
            for evidence in request.evidence {
                let kind = if evidence.stable_key.starts_with("condition:") {
                    FactKind::CodeCondition
                } else {
                    FactKind::CodeSymbol
                };
                let entity = EntityRef::new(
                    Layer::Fact,
                    format!("fact:typescript:{}", evidence.stable_key),
                );
                facts.push(FactRevision {
                    revision_ref: RevisionRef::new(entity, hash(&evidence.excerpt)),
                    build_ref: build_ref.clone(),
                    kind,
                    stable_key: evidence.stable_key,
                    statement: evidence.excerpt,
                    data: json!({"sourceType": "typescript"}),
                    evidence: vec![FactEvidenceLink {
                        evidence_ref: evidence.revision_ref.clone(),
                        role: EvidenceRole::Supports,
                    }],
                    trace: Trace {
                        source_snapshot: evidence.trace.source_snapshot,
                        parents: vec![evidence.revision_ref],
                        producer: producer(),
                    },
                    freshness: Freshness::Current,
                });
            }
            let added = facts
                .iter()
                .map(|value| value.revision_ref.clone())
                .collect();
            Ok(FactBuildOutput {
                build: FactBuildRecord {
                    entity_ref: build_entity,
                    revision_ref: build_ref.clone(),
                    producer: producer(),
                    status: RunStatus::Completed,
                    fingerprint,
                },
                facts,
                result: BuildResult::completed(build_ref.revision, added),
            })
        })
    }
}

fn visit(node: Node<'_>, source: &[u8], units: &mut Vec<RawUnit>) {
    let kind = node.kind();
    let mapped = match kind {
        "function_declaration" | "method_definition" => Some(StructureKind::Function),
        "if_statement" | "switch_statement" => Some(StructureKind::Condition),
        "call_expression" => Some(StructureKind::Call),
        _ => None,
    };
    if let Some(structure_kind) = mapped {
        let name_node = node
            .child_by_field_name("name")
            .or_else(|| node.child_by_field_name("function"));
        let name = name_node
            .and_then(|value| value.utf8_text(source).ok())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{}:{}", kind, node.start_position().row + 1));
        let prefix = match structure_kind.as_str() {
            "function" => "symbol",
            "condition" => "condition",
            "call" => "call",
            _ => "node",
        };
        let text = node
            .utf8_text(source)
            .map(str::to_owned)
            .unwrap_or_else(|_| name.clone());
        units.push(RawUnit {
            kind: structure_kind,
            stable_key: format!("{prefix}:{}", slug(&name)),
            label: name,
            text,
            start: node.start_byte(),
            end: node.end_byte(),
        });
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        visit(child, source, units);
    }
}

fn producer() -> ProducerRef {
    ProducerRef {
        name: "context-processor-typescript".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        config_hash: "default".to_owned(),
    }
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
        .collect()
}

fn hash(value: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(value.as_bytes()))
}
