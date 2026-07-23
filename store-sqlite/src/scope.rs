use context_scope::Scope;
use context_scope::ScopeAssignment;
use context_scope::ScopeBlock;
use context_scope::ScopeCatalogReader;
use context_scope::ScopeDecision;
use context_scope::ScopeDimension;
use context_scope::ScopeError;
use context_scope::ScopeFuture;
use context_scope::ScopeQuery;
use context_scope::ScopeReader;
use context_scope::ScopeRelation;
use context_scope::ScopeStore;

use crate::SqliteStore;

impl ScopeCatalogReader for SqliteStore {
    fn page_dimensions(
        &self,
        query: ScopeQuery,
    ) -> ScopeFuture<'_, context_protocol::Page<ScopeDimension>> {
        Box::pin(async move {
            self.page_records(
                "scope_dimension",
                &query.page,
                false,
                Vec::new(),
                query.text.map(|value| (vec!["name".to_owned()], value)),
            )
            .await
            .map_err(error)
        })
    }

    fn page_scopes(&self, query: ScopeQuery) -> ScopeFuture<'_, context_protocol::Page<Scope>> {
        Box::pin(async move {
            self.page_records(
                "scope",
                &query.page,
                false,
                Vec::new(),
                query.text.map(|value| {
                    (
                        vec![
                            "label".to_owned(),
                            "value".to_owned(),
                            "dimension".to_owned(),
                        ],
                        value,
                    )
                }),
            )
            .await
            .map_err(error)
        })
    }

    fn page_assignments(
        &self,
        query: ScopeQuery,
    ) -> ScopeFuture<'_, context_protocol::Page<ScopeAssignment>> {
        Box::pin(async move {
            self.page_records(
                "scope_assignment",
                &query.page,
                false,
                review_filter(query.review_status).map_err(error)?,
                query
                    .text
                    .map(|value| (vec!["id".to_owned(), "scopeRef.id".to_owned()], value)),
            )
            .await
            .map_err(error)
        })
    }

    fn page_blocks(
        &self,
        query: ScopeQuery,
    ) -> ScopeFuture<'_, context_protocol::Page<ScopeBlock>> {
        Box::pin(async move {
            self.page_records(
                "scope_block",
                &query.page,
                false,
                review_filter(query.review_status).map_err(error)?,
                query
                    .text
                    .map(|value| (vec!["id".to_owned(), "reason".to_owned()], value)),
            )
            .await
            .map_err(error)
        })
    }

    fn page_relations(
        &self,
        query: ScopeQuery,
    ) -> ScopeFuture<'_, context_protocol::Page<ScopeRelation>> {
        Box::pin(async move {
            self.page_records(
                "scope_relation",
                &query.page,
                false,
                review_filter(query.review_status).map_err(error)?,
                query.text.map(|value| {
                    (
                        vec!["id".to_owned(), "from.id".to_owned(), "to.id".to_owned()],
                        value,
                    )
                }),
            )
            .await
            .map_err(error)
        })
    }

    fn page_decisions(
        &self,
        query: ScopeQuery,
    ) -> ScopeFuture<'_, context_protocol::Page<ScopeDecision>> {
        Box::pin(async move {
            let equals = query
                .review_status
                .map(|value| {
                    Ok(vec![(
                        "status".to_owned(),
                        json_string(value).map_err(error)?,
                    )])
                })
                .transpose()?
                .unwrap_or_default();
            self.page_records(
                "scope_decision",
                &query.page,
                false,
                equals,
                query.text.map(|value| {
                    (
                        vec![
                            "id".to_owned(),
                            "subject".to_owned(),
                            "rationale".to_owned(),
                        ],
                        value,
                    )
                }),
            )
            .await
            .map_err(error)
        })
    }
}

fn review_filter(
    status: Option<context_protocol::ReviewStatus>,
) -> Result<Vec<(String, String)>, serde_json::Error> {
    status
        .map(|value| Ok(vec![("reviewStatus".to_owned(), json_string(value)?)]))
        .transpose()
        .map(Option::unwrap_or_default)
}

fn json_string(value: impl serde::Serialize) -> Result<String, serde_json::Error> {
    Ok(serde_json::to_value(value)?
        .as_str()
        .unwrap_or_default()
        .to_owned())
}

fn error(value: impl std::fmt::Display) -> ScopeError {
    ScopeError::Store(value.to_string())
}

impl ScopeReader for SqliteStore {
    fn list_dimensions(&self) -> ScopeFuture<'_, Vec<ScopeDimension>> {
        Box::pin(async move { self.list_records("scope_dimension").await.map_err(error) })
    }

    fn list_scopes(&self) -> ScopeFuture<'_, Vec<Scope>> {
        Box::pin(async move { self.list_records("scope").await.map_err(error) })
    }

    fn list_assignments(&self) -> ScopeFuture<'_, Vec<ScopeAssignment>> {
        Box::pin(async move { self.list_records("scope_assignment").await.map_err(error) })
    }

    fn list_blocks(&self) -> ScopeFuture<'_, Vec<ScopeBlock>> {
        Box::pin(async move { self.list_records("scope_block").await.map_err(error) })
    }

    fn list_relations(&self) -> ScopeFuture<'_, Vec<ScopeRelation>> {
        Box::pin(async move { self.list_records("scope_relation").await.map_err(error) })
    }

    fn list_decisions(&self) -> ScopeFuture<'_, Vec<ScopeDecision>> {
        Box::pin(async move { self.list_records("scope_decision").await.map_err(error) })
    }
}

impl ScopeStore for SqliteStore {
    fn put_dimensions(&self, values: Vec<ScopeDimension>) -> ScopeFuture<'_, ()> {
        Box::pin(async move {
            for value in values {
                self.put_record("scope_dimension", &value.name, "", &value)
                    .await
                    .map_err(error)?;
            }
            Ok(())
        })
    }

    fn put_scopes(&self, values: Vec<Scope>) -> ScopeFuture<'_, ()> {
        Box::pin(async move {
            for value in values {
                self.put_record("scope", &value.scope_ref.id, "", &value)
                    .await
                    .map_err(error)?;
            }
            Ok(())
        })
    }

    fn put_assignments(&self, values: Vec<ScopeAssignment>) -> ScopeFuture<'_, ()> {
        Box::pin(async move {
            for value in values {
                self.put_record("scope_assignment", &value.id, "", &value)
                    .await
                    .map_err(error)?;
            }
            Ok(())
        })
    }

    fn put_blocks(&self, values: Vec<ScopeBlock>) -> ScopeFuture<'_, ()> {
        Box::pin(async move {
            for value in values {
                self.put_record("scope_block", &value.id, "", &value)
                    .await
                    .map_err(error)?;
            }
            Ok(())
        })
    }

    fn put_relations(&self, values: Vec<ScopeRelation>) -> ScopeFuture<'_, ()> {
        Box::pin(async move {
            for value in values {
                self.put_record("scope_relation", &value.id, "", &value)
                    .await
                    .map_err(error)?;
            }
            Ok(())
        })
    }

    fn put_decisions(&self, values: Vec<ScopeDecision>) -> ScopeFuture<'_, ()> {
        Box::pin(async move {
            for value in values {
                self.put_record("scope_decision", &value.id, "", &value)
                    .await
                    .map_err(error)?;
            }
            Ok(())
        })
    }
}
