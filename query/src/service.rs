use std::collections::BTreeMap;
use std::collections::BTreeSet;

use context_evidence::EvidenceReader;
use context_fact::FactReader;
use context_fact::FactRevision;
use context_protocol::Freshness;
use context_protocol::RevisionRef;
use context_scope::ScopeEngine;
use context_scope::ScopeReader;
use context_semantic::SemanticReader;
use context_source::SourceReader;
use context_structure::StructureReader;
use thiserror::Error;
use uuid::Uuid;

use crate::ContextFilters;
use crate::ContextRequest;
use crate::ContextResult;

pub trait ContextReadStore:
    SourceReader
    + StructureReader
    + EvidenceReader
    + FactReader
    + ScopeReader
    + SemanticReader
    + Send
    + Sync
{
}

impl<T> ContextReadStore for T where
    T: SourceReader
        + StructureReader
        + EvidenceReader
        + FactReader
        + ScopeReader
        + SemanticReader
        + Send
        + Sync
{
}

#[derive(Debug, Error)]
pub enum QueryError {
    #[error("Source query failed: {0}")]
    Source(#[from] context_source::SourceError),
    #[error("Structure query failed: {0}")]
    Structure(#[from] context_structure::StructureError),
    #[error("Evidence query failed: {0}")]
    Evidence(#[from] context_evidence::EvidenceError),
    #[error("Fact query failed: {0}")]
    Fact(#[from] context_fact::FactError),
    #[error("Scope query failed: {0}")]
    Scope(#[from] context_scope::ScopeError),
    #[error("Semantic query failed: {0}")]
    Semantic(#[from] context_semantic::SemanticError),
    #[error("Context rendering failed: {0}")]
    Rendering(#[from] serde_json::Error),
}

pub type QueryResult<T> = Result<T, QueryError>;

pub struct ContextService<S> {
    store: S,
}

impl<S: ContextReadStore> ContextService<S> {
    pub fn new(store: S) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub async fn context(&self, request: ContextRequest) -> QueryResult<ContextResult> {
        match request {
            ContextRequest::Manifest => self.manifest().await,
            ContextRequest::Explore { terms, filters } => {
                self.render_facts(terms, filters, None).await
            }
            ContextRequest::Expand {
                target,
                terms,
                filters,
            } => self.render_facts(terms, filters, Some(target)).await,
        }
    }

    async fn manifest(&self) -> QueryResult<ContextResult> {
        let sources = self.store.list_sources().await?;
        let facts = self.store.list_facts().await?;
        let edges = self.store.list_edges().await?;
        let stale = facts
            .iter()
            .filter(|fact| fact.freshness == Freshness::Stale)
            .count();
        Ok(ContextResult {
            view_id: Uuid::now_v7().to_string(),
            markdown: format!(
                "# Context Compiler Manifest\n\n- Sources: {}\n- Facts: {}\n- Semantic edges: {}\n- Stale facts: {}\n",
                sources.len(),
                facts.len(),
                edges.len(),
                stale
            ),
            freshness: if stale == 0 {
                Freshness::Current
            } else {
                Freshness::Stale
            },
            diagnostics: Vec::new(),
        })
    }

    async fn render_facts(
        &self,
        terms: Vec<String>,
        filters: ContextFilters,
        target: Option<context_protocol::EntityRef>,
    ) -> QueryResult<ContextResult> {
        let all_facts = self.store.list_facts().await?;
        let mut selected = if let Some(target) = target {
            let adjacent = self.store.adjacent(&target).await?;
            let mut entities = BTreeSet::from([target]);
            for edge in adjacent {
                entities.insert(edge.from_fact);
                entities.insert(edge.to_fact);
            }
            all_facts
                .into_iter()
                .filter(|fact| entities.contains(&fact.revision_ref.entity))
                .collect::<Vec<_>>()
        } else {
            all_facts
        };
        let lowered_terms: Vec<_> = terms.iter().map(|value| value.to_lowercase()).collect();
        selected.retain(|fact| {
            (lowered_terms.is_empty()
                || lowered_terms
                    .iter()
                    .all(|term| fact.statement.to_lowercase().contains(term)))
                && (filters.fact_kinds.is_empty() || filters.fact_kinds.contains(&fact.kind))
                && filters
                    .freshness
                    .is_none_or(|freshness| fact.freshness == freshness)
        });
        if !filters.scope_refs.is_empty() {
            selected = self.filter_by_scope(selected, &filters).await?;
        }
        selected.sort_by(|left, right| left.revision_ref.cmp(&right.revision_ref));
        selected.truncate(filters.limit.unwrap_or(50));

        let mut markdown = String::from("# Context View\n\n");
        for fact in &selected {
            markdown.push_str(&format!("## {:?}\n\n{}\n\n", fact.kind, fact.statement));
            for link in &fact.evidence {
                if let Some(evidence) = self.store.get_evidence(&link.evidence_ref).await? {
                    let locator = serde_json::to_string(&evidence.locator)?;
                    markdown.push_str(&format!(
                        "- Evidence `{}` at `{locator}`\n",
                        evidence.revision_ref.entity.id
                    ));
                }
            }
            markdown.push('\n');
        }
        if selected.is_empty() {
            markdown.push_str("No matching facts.\n");
        }
        let freshness = aggregate_freshness(&selected);
        Ok(ContextResult {
            view_id: Uuid::now_v7().to_string(),
            markdown,
            freshness,
            diagnostics: Vec::new(),
        })
    }

    async fn filter_by_scope(
        &self,
        facts: Vec<FactRevision>,
        filters: &ContextFilters,
    ) -> QueryResult<Vec<FactRevision>> {
        let structures = self.store.list_structures().await?;
        let evidence = self.store.list_evidence().await?;
        let normalized = self.store.list_normalized().await?;
        let dimensions = self.store.list_dimensions().await?;
        let scopes = self.store.list_scopes().await?;
        let assignments = self.store.list_assignments().await?;
        let blocks = self.store.list_blocks().await?;
        let relations = self.store.list_relations().await?;
        let mut lineage: BTreeMap<RevisionRef, Vec<RevisionRef>> = BTreeMap::new();
        for source in normalized {
            lineage.insert(source.revision_ref, vec![source.source_snapshot]);
        }
        for structure in structures {
            lineage.insert(structure.revision_ref, structure.trace.parents);
        }
        for item in evidence {
            lineage.insert(item.revision_ref, item.trace.parents);
        }
        for fact in &facts {
            lineage.insert(fact.revision_ref.clone(), fact.trace.parents.clone());
        }
        Ok(facts
            .into_iter()
            .filter(|fact| {
                let effective = ScopeEngine::effective_scope(
                    &fact.revision_ref,
                    &lineage,
                    &dimensions,
                    &scopes,
                    &assignments,
                    &blocks,
                    &relations,
                );
                filters.scope_refs.iter().all(|scope_ref| {
                    effective
                        .values
                        .iter()
                        .any(|value| &value.scope_ref == scope_ref)
                })
            })
            .collect())
    }
}

fn aggregate_freshness(facts: &[FactRevision]) -> Freshness {
    if facts
        .iter()
        .any(|fact| fact.freshness == Freshness::Invalid)
    {
        Freshness::Invalid
    } else if facts.iter().any(|fact| fact.freshness == Freshness::Stale) {
        Freshness::Stale
    } else {
        Freshness::Current
    }
}
