use std::collections::BTreeMap;

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
use context_protocol::ArtifactRef;
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
use context_structure::StructureFuture;
use context_structure::StructureKind;
use context_structure::StructureUnit;
use pulldown_cmark::Event;
use pulldown_cmark::Options;
use pulldown_cmark::Parser;
use pulldown_cmark::Tag;
use pulldown_cmark::TagEnd;
use serde_json::json;
use sha2::Digest;
use sha2::Sha256;

#[derive(Clone, Default)]
pub struct MarkdownProcessor;

impl MarkdownProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl StructureBuilder for MarkdownProcessor {
    fn normalized_format(&self) -> FormatId {
        FormatId::new("markdown")
    }

    fn build(&self, request: StructureBuildRequest) -> StructureFuture<'_, StructureBuildOutput> {
        Box::pin(async move {
            let normalized = request.normalized;
            let content = request.content;
            let source_id = normalized.source_snapshot.entity.id.clone();
            let build_entity =
                EntityRef::new(Layer::Structure, format!("build:markdown:{source_id}"));
            let build_ref = RevisionRef::new(
                build_entity.clone(),
                normalized.primary.content_hash.clone(),
            );
            let producer = producer();
            let trace = Trace {
                source_snapshot: normalized.source_snapshot.clone(),
                parents: vec![normalized.revision_ref.clone()],
                producer: producer.clone(),
            };
            let artifact = normalized.primary.artifact.clone();
            let mut units = Vec::new();
            let mut current: Option<(StructureKind, usize, String)> = None;
            let mut heading_path: Vec<(u8, String)> = Vec::new();
            let mut key_counts = BTreeMap::<String, usize>::new();
            let parser = Parser::new_ext(&content, Options::all()).into_offset_iter();
            for (event, range) in parser {
                match event {
                    Event::Start(Tag::Heading { level, .. }) => {
                        current = Some((StructureKind::Heading, range.start, String::new()));
                        let numeric = level as u8;
                        heading_path.retain(|(existing, _)| *existing < numeric);
                    }
                    Event::Start(Tag::Paragraph) => {
                        current = Some((StructureKind::Paragraph, range.start, String::new()));
                    }
                    Event::Text(value) | Event::Code(value) => {
                        if let Some((_, _, text)) = &mut current {
                            text.push_str(&value);
                        }
                    }
                    Event::End(TagEnd::Heading(level)) => {
                        if let Some((kind, start, text)) = current.take() {
                            let label = text.trim().to_owned();
                            let numeric = level as u8;
                            heading_path.retain(|(existing, _)| *existing < numeric);
                            heading_path.push((numeric, label.clone()));
                            let seed = heading_path
                                .iter()
                                .map(|(_, value)| slug(value))
                                .collect::<Vec<_>>()
                                .join("/");
                            let stable_key = unique_key(&seed, &mut key_counts);
                            units.push(unit(
                                &source_id,
                                &build_ref,
                                kind,
                                stable_key,
                                label,
                                start,
                                range.end,
                                artifact.clone(),
                                trace.clone(),
                            ));
                        }
                    }
                    Event::End(TagEnd::Paragraph) => {
                        if let Some((kind, start, text)) = current.take() {
                            let label = text.trim().to_owned();
                            if !label.is_empty() {
                                let prefix = heading_path
                                    .iter()
                                    .map(|(_, value)| slug(value))
                                    .collect::<Vec<_>>()
                                    .join("/");
                                let seed = format!("{prefix}/paragraph");
                                let stable_key = unique_key(&seed, &mut key_counts);
                                units.push(unit(
                                    &source_id,
                                    &build_ref,
                                    kind,
                                    stable_key,
                                    label,
                                    start,
                                    range.end,
                                    artifact.clone(),
                                    trace.clone(),
                                ));
                            }
                        }
                    }
                    _ => {}
                }
            }
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
                    producer,
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

impl EvidenceBuilder for MarkdownProcessor {
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
            let build_entity = EntityRef::new(Layer::Evidence, "build:markdown:evidence");
            let build_ref = RevisionRef::new(build_entity.clone(), fingerprint.clone());
            let mut evidence = Vec::new();
            for structure in request.structures {
                let structure_ref = structure.revision_ref.clone();
                let entity = EntityRef::new(
                    Layer::Evidence,
                    format!("evidence:markdown:{}", structure.revision_ref.entity.id),
                );
                let revision = RevisionRef::new(entity, hash(&structure.text));
                let normalized_source = structure
                    .trace
                    .parents
                    .first()
                    .cloned()
                    .unwrap_or_else(|| structure.trace.source_snapshot.clone());
                evidence.push(EvidenceRecord {
                    revision_ref: revision,
                    build_ref: build_ref.clone(),
                    kind: EvidenceKind::TextSpan,
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

impl FactBuilder for MarkdownProcessor {
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
            let build_entity = EntityRef::new(Layer::Fact, "build:markdown:fact");
            let build_ref = RevisionRef::new(build_entity.clone(), fingerprint.clone());
            let mut facts = Vec::new();
            for evidence in request.evidence {
                let is_rule = ["must", "shall", "必须", "不得", "退款", "规则"]
                    .iter()
                    .any(|token| evidence.excerpt.to_lowercase().contains(token));
                let kind = if is_rule {
                    FactKind::BusinessRule
                } else {
                    FactKind::DocumentStatement
                };
                let entity = EntityRef::new(
                    Layer::Fact,
                    format!("fact:markdown:{}", evidence.stable_key),
                );
                let revision = RevisionRef::new(entity, hash(&evidence.excerpt));
                facts.push(FactRevision {
                    revision_ref: revision,
                    build_ref: build_ref.clone(),
                    kind,
                    stable_key: evidence.stable_key,
                    statement: evidence.excerpt,
                    data: json!({"sourceType": "markdown"}),
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

#[allow(clippy::too_many_arguments)]
fn unit(
    source_id: &str,
    build_ref: &RevisionRef,
    kind: StructureKind,
    stable_key: String,
    label: String,
    start: usize,
    end: usize,
    artifact: ArtifactRef,
    trace: Trace,
) -> StructureUnit {
    let text_hash = hash(&label);
    let entity = EntityRef::new(
        Layer::Structure,
        format!("structure:markdown:{source_id}:{stable_key}"),
    );
    StructureUnit {
        revision_ref: RevisionRef::new(entity, text_hash),
        build_ref: build_ref.clone(),
        kind,
        stable_key,
        label: label.clone(),
        locator: Locator::ByteRange {
            artifact,
            start: start as u64,
            end: end as u64,
        },
        text: label,
        trace,
        freshness: Freshness::Current,
    }
}

fn producer() -> ProducerRef {
    ProducerRef {
        name: "context-processor-markdown".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        config_hash: "default".to_owned(),
    }
}

fn unique_key(seed: &str, counts: &mut BTreeMap<String, usize>) -> String {
    let count = counts.entry(seed.to_owned()).or_default();
    *count += 1;
    if *count == 1 {
        seed.to_owned()
    } else {
        format!("{seed}:{}", *count)
    }
}

fn slug(value: &str) -> String {
    let mut result = String::new();
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() || character == '-' || character == '_' {
            result.push(character);
        } else if !result.ends_with('-') {
            result.push('-');
        }
    }
    result.trim_matches('-').to_owned()
}

fn hash(value: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(value.as_bytes()))
}
