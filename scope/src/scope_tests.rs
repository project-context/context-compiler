use std::collections::BTreeMap;

use context_protocol::EntityRef;
use context_protocol::Layer;
use context_protocol::ProducerRef;
use context_protocol::ReviewStatus;
use context_protocol::RevisionRef;
use context_protocol::Trace;

use super::*;

fn revision(layer: Layer, id: &str) -> RevisionRef {
    RevisionRef::new(EntityRef::new(layer, id), "r1")
}

fn trace(source: &RevisionRef) -> Trace {
    Trace {
        source_snapshot: source.clone(),
        parents: Vec::new(),
        producer: ProducerRef {
            name: "test".to_owned(),
            version: "1".to_owned(),
            config_hash: "test".to_owned(),
        },
    }
}

fn assignment(id: &str, target: &RevisionRef, scope_ref: &ScopeRef) -> ScopeAssignment {
    ScopeAssignment {
        id: id.to_owned(),
        target: target.clone(),
        scope_ref: scope_ref.clone(),
        purpose: AssignmentPurpose::AppliesToContent,
        propagation: Propagation::Inherit,
        context_role: ContextRole::Main,
        review_status: ReviewStatus::Confirmed,
        trace: trace(target),
    }
}

#[test]
fn sibling_sections_do_not_pollute_each_other() {
    let source = revision(Layer::Source, "refund-doc");
    let section_a = revision(Layer::Structure, "refund-doc:a");
    let section_b = revision(Layer::Structure, "refund-doc:b");
    let region_a = ScopeRef::new("region:a");
    let region_b = ScopeRef::new("region:b");
    let scopes = vec![
        Scope {
            scope_ref: region_a.clone(),
            dimension: "region".to_owned(),
            value: "a".to_owned(),
            label: "Region A".to_owned(),
        },
        Scope {
            scope_ref: region_b.clone(),
            dimension: "region".to_owned(),
            value: "b".to_owned(),
            label: "Region B".to_owned(),
        },
    ];
    let lineage = BTreeMap::from([
        (section_a.clone(), vec![source.clone()]),
        (section_b.clone(), vec![source]),
    ]);
    let assignments = vec![
        assignment("a", &section_a, &region_a),
        assignment("b", &section_b, &region_b),
    ];

    let effective = ScopeEngine::effective_scope(
        &section_a,
        &lineage,
        &[ScopeDimension {
            name: "region".to_owned(),
            cardinality: DimensionCardinality::Single,
        }],
        &scopes,
        &assignments,
        &[],
        &[],
    );

    assert!(
        effective
            .values
            .iter()
            .any(|value| value.scope_ref == region_a)
    );
    assert!(
        !effective
            .values
            .iter()
            .any(|value| value.scope_ref == region_b)
    );
    assert!(effective.conflicts.is_empty());
}

#[test]
fn multi_parent_lineage_reports_single_dimension_conflict() {
    let evidence_a = revision(Layer::Evidence, "rule:a");
    let evidence_b = revision(Layer::Evidence, "rule:b");
    let fact = revision(Layer::Fact, "refund-rule");
    let region_a = ScopeRef::new("region:a");
    let region_b = ScopeRef::new("region:b");
    let lineage = BTreeMap::from([(fact.clone(), vec![evidence_a.clone(), evidence_b.clone()])]);
    let scopes = vec![
        Scope {
            scope_ref: region_a.clone(),
            dimension: "region".to_owned(),
            value: "a".to_owned(),
            label: "Region A".to_owned(),
        },
        Scope {
            scope_ref: region_b.clone(),
            dimension: "region".to_owned(),
            value: "b".to_owned(),
            label: "Region B".to_owned(),
        },
    ];

    let effective = ScopeEngine::effective_scope(
        &fact,
        &lineage,
        &[ScopeDimension {
            name: "region".to_owned(),
            cardinality: DimensionCardinality::Single,
        }],
        &scopes,
        &[
            assignment("a", &evidence_a, &region_a),
            assignment("b", &evidence_b, &region_b),
        ],
        &[],
        &[],
    );

    assert_eq!(effective.conflicts.len(), 1);
    assert_eq!(effective.conflicts[0].values, vec![region_a, region_b]);
    assert_eq!(effective.values.len(), 2);
}

#[test]
fn belongs_to_is_stored_child_to_parent_and_expanded() {
    let source = revision(Layer::Source, "refund-doc");
    let city = ScopeRef::new("city:shanghai");
    let country = ScopeRef::new("country:cn");
    let effective = ScopeEngine::effective_scope(
        &source,
        &BTreeMap::new(),
        &[],
        &[
            Scope {
                scope_ref: city.clone(),
                dimension: "location".to_owned(),
                value: "shanghai".to_owned(),
                label: "Shanghai".to_owned(),
            },
            Scope {
                scope_ref: country.clone(),
                dimension: "location".to_owned(),
                value: "cn".to_owned(),
                label: "China".to_owned(),
            },
        ],
        &[assignment("city", &source, &city)],
        &[],
        &[ScopeRelation {
            id: "city-country".to_owned(),
            from: city.clone(),
            to: country.clone(),
            kind: ScopeRelationKind::BelongsTo,
            review_status: ReviewStatus::Confirmed,
        }],
    );

    assert!(effective.values.iter().any(|value| {
        value.scope_ref == country && value.scope_path == vec![city.clone(), country.clone()]
    }));
}

#[test]
fn confirmed_dimension_block_stops_ancestor_inheritance() {
    let source = revision(Layer::Source, "refund-doc");
    let section = revision(Layer::Structure, "refund-doc:example");
    let region = ScopeRef::new("region:a");
    let effective = ScopeEngine::effective_scope(
        &section,
        &BTreeMap::from([(section.clone(), vec![source.clone()])]),
        &[ScopeDimension {
            name: "region".to_owned(),
            cardinality: DimensionCardinality::Single,
        }],
        &[Scope {
            scope_ref: region.clone(),
            dimension: "region".to_owned(),
            value: "a".to_owned(),
            label: "Region A".to_owned(),
        }],
        &[assignment("region", &source, &region)],
        &[ScopeBlock {
            id: "block-region".to_owned(),
            target: section.clone(),
            scope_ref: None,
            dimension: Some("region".to_owned()),
            review_status: ReviewStatus::Confirmed,
            reason: "comparison section".to_owned(),
        }],
        &[],
    );

    assert!(effective.values.is_empty());
}

#[test]
fn local_only_assignment_does_not_enter_effective_scope() {
    let source = revision(Layer::Source, "refund-doc");
    let region = ScopeRef::new("region:a");
    let mut local = assignment("local", &source, &region);
    local.propagation = Propagation::LocalOnly;
    let effective = ScopeEngine::effective_scope(
        &source,
        &BTreeMap::new(),
        &[],
        &[Scope {
            scope_ref: region,
            dimension: "region".to_owned(),
            value: "a".to_owned(),
            label: "Region A".to_owned(),
        }],
        &[local],
        &[],
        &[],
    );

    assert!(effective.values.is_empty());
}
