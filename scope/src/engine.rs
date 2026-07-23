use std::collections::BTreeMap;
use std::collections::BTreeSet;

use context_protocol::ReviewStatus;
use context_protocol::RevisionRef;

use crate::AssignmentPurpose;
use crate::DimensionCardinality;
use crate::EffectiveScope;
use crate::EffectiveScopeConflict;
use crate::EffectiveScopeValue;
use crate::Propagation;
use crate::Scope;
use crate::ScopeAssignment;
use crate::ScopeBlock;
use crate::ScopeDimension;
use crate::ScopeRef;
use crate::ScopeRelation;
use crate::ScopeRelationKind;

/// Pure evaluator. It performs no persistence and never silently resolves conflicts.
pub struct ScopeEngine;

impl ScopeEngine {
    #[allow(clippy::too_many_arguments)]
    pub fn effective_scope(
        target: &RevisionRef,
        lineage: &BTreeMap<RevisionRef, Vec<RevisionRef>>,
        dimensions: &[ScopeDimension],
        scopes: &[Scope],
        assignments: &[ScopeAssignment],
        blocks: &[ScopeBlock],
        relations: &[ScopeRelation],
    ) -> EffectiveScope {
        let scope_by_ref: BTreeMap<_, _> = scopes
            .iter()
            .map(|scope| (scope.scope_ref.clone(), scope))
            .collect();
        let mut paths = Vec::new();
        Self::lineage_paths(target, lineage, &mut vec![target.clone()], &mut paths);
        let mut values = Vec::new();

        for path in paths {
            for (position, revision) in path.iter().enumerate() {
                for assignment in assignments.iter().filter(|item| {
                    item.target == *revision
                        && item.review_status == ReviewStatus::Confirmed
                        && item.purpose == AssignmentPurpose::AppliesToContent
                        && item.propagation == Propagation::Inherit
                }) {
                    if Self::is_blocked(assignment, &path[..position], blocks, &scope_by_ref) {
                        continue;
                    }
                    let content_path = path[..=position].to_vec();
                    let scope_paths = Self::scope_paths(&assignment.scope_ref, relations);
                    for scope_path in scope_paths {
                        let Some(scope_ref) = scope_path.last().cloned() else {
                            continue;
                        };
                        values.push(EffectiveScopeValue {
                            scope_ref,
                            assigned_at: assignment.target.clone(),
                            lineage_path: content_path.clone(),
                            scope_path,
                        });
                    }
                }
            }
        }

        values.sort_by(|left, right| {
            (&left.scope_ref, &left.lineage_path, &left.scope_path).cmp(&(
                &right.scope_ref,
                &right.lineage_path,
                &right.scope_path,
            ))
        });
        values.dedup();

        let mut conflicts = Vec::new();
        for dimension in dimensions
            .iter()
            .filter(|dimension| dimension.cardinality == DimensionCardinality::Single)
        {
            let distinct: BTreeSet<_> = values
                .iter()
                .filter_map(|value| {
                    scope_by_ref
                        .get(&value.scope_ref)
                        .filter(|scope| scope.dimension == dimension.name)
                        .map(|_| value.scope_ref.clone())
                })
                .collect();
            if distinct.len() > 1 {
                conflicts.push(EffectiveScopeConflict {
                    dimension: dimension.name.clone(),
                    values: distinct.into_iter().collect(),
                });
            }
        }

        EffectiveScope {
            target: target.clone(),
            values,
            conflicts,
        }
    }

    fn lineage_paths(
        current: &RevisionRef,
        lineage: &BTreeMap<RevisionRef, Vec<RevisionRef>>,
        path: &mut Vec<RevisionRef>,
        result: &mut Vec<Vec<RevisionRef>>,
    ) {
        let parents = lineage.get(current).cloned().unwrap_or_default();
        if parents.is_empty() {
            result.push(path.clone());
            return;
        }
        for parent in parents {
            if path.contains(&parent) {
                continue;
            }
            path.push(parent.clone());
            Self::lineage_paths(&parent, lineage, path, result);
            path.pop();
        }
    }

    fn is_blocked(
        assignment: &ScopeAssignment,
        descendants: &[RevisionRef],
        blocks: &[ScopeBlock],
        scope_by_ref: &BTreeMap<ScopeRef, &Scope>,
    ) -> bool {
        descendants.iter().any(|descendant| {
            blocks.iter().any(|block| {
                if block.target != *descendant || block.review_status != ReviewStatus::Confirmed {
                    return false;
                }
                let scope_match = block
                    .scope_ref
                    .as_ref()
                    .is_some_and(|scope_ref| scope_ref == &assignment.scope_ref);
                let dimension_match = block.dimension.as_ref().is_some_and(|dimension| {
                    scope_by_ref
                        .get(&assignment.scope_ref)
                        .is_some_and(|scope| scope.dimension == *dimension)
                });
                scope_match || dimension_match
            })
        })
    }

    fn scope_paths(start: &ScopeRef, relations: &[ScopeRelation]) -> Vec<Vec<ScopeRef>> {
        let mut result = vec![vec![start.clone()]];
        let mut cursor = 0;
        while cursor < result.len() {
            let path = result[cursor].clone();
            if let Some(last) = path.last() {
                for relation in relations.iter().filter(|relation| {
                    relation.kind == ScopeRelationKind::BelongsTo
                        && relation.review_status == ReviewStatus::Confirmed
                        && relation.from == *last
                        && !path.contains(&relation.to)
                }) {
                    let mut next = path.clone();
                    next.push(relation.to.clone());
                    result.push(next);
                }
            }
            cursor += 1;
        }
        result
    }
}
