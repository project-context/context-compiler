use context_fact::FactKind;
use context_protocol::EntityRef;
use context_protocol::Freshness;
use context_protocol::Layer;
use context_protocol::ProducerRef;
use context_protocol::ReviewStatus;
use context_protocol::RevisionRef;
use context_protocol::Trace;

use super::*;

fn trace() -> Trace {
    let source = RevisionRef::new(EntityRef::new(Layer::Source, "test"), "r1");
    Trace {
        source_snapshot: source,
        parents: Vec::new(),
        producer: ProducerRef {
            name: "test".to_owned(),
            version: "1".to_owned(),
            config_hash: "test".to_owned(),
        },
    }
}

#[test]
fn symmetric_edges_use_canonical_endpoint_order() -> SemanticResult<()> {
    let left = EntityRef::new(Layer::Fact, "z");
    let right = EntityRef::new(Layer::Fact, "a");
    let edge = SemanticEdge::new(
        "similar:a:z",
        SemanticRelation::SimilarTo,
        left,
        right.clone(),
        FactKind::BusinessRule,
        FactKind::BusinessRule,
        ReviewStatus::Confirmed,
        false,
        Freshness::Current,
        trace(),
    )?;
    assert_eq!(edge.from_fact, right);
    Ok(())
}

#[test]
fn cross_scope_edges_cannot_be_silently_confirmed() -> SemanticResult<()> {
    let edge = SemanticEdge::new(
        "implements:one",
        SemanticRelation::Implements,
        EntityRef::new(Layer::Fact, "code"),
        EntityRef::new(Layer::Fact, "rule"),
        FactKind::CodeSymbol,
        FactKind::BusinessRule,
        ReviewStatus::Confirmed,
        true,
        Freshness::Current,
        trace(),
    )?;
    assert_eq!(edge.review_status, ReviewStatus::Candidate);
    Ok(())
}
