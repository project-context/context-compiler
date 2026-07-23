use std::path::Path;

use context_protocol::Page;
use context_protocol::PageRequest;
use serde::Serialize;
use serde::de::DeserializeOwned;
use sqlx::Row;
use sqlx::SqlitePool;
use sqlx::migrate::Migrator;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::sqlite::SqlitePoolOptions;
use thiserror::Error;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Debug, Error)]
pub enum SqliteStoreError {
    #[error("SQLite operation failed: {0}")]
    Sql(#[from] sqlx::Error),
    #[error("SQLite migration failed: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("record serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("database directory could not be created: {0}")]
    Io(#[from] std::io::Error),
}

pub type SqliteStoreResult<T> = Result<T, SqliteStoreError>;

#[derive(Clone)]
pub struct SqliteStore {
    pub(crate) pool: SqlitePool,
}

impl SqliteStore {
    pub async fn connect(path: impl AsRef<Path>) -> SqliteStoreResult<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(options)
            .await?;
        MIGRATOR.run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn close(self) {
        self.pool.close().await;
    }

    pub(crate) async fn put_record<T: Serialize>(
        &self,
        kind: &str,
        entity_id: &str,
        revision: &str,
        value: &T,
    ) -> SqliteStoreResult<()> {
        let payload = serde_json::to_string(value)?;
        sqlx::query(
            "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) \
             VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(record_kind, entity_id, revision) DO UPDATE SET \
             payload = excluded.payload, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(kind)
        .bind(entity_id)
        .bind(revision)
        .bind(payload)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub(crate) async fn get_record<T: DeserializeOwned>(
        &self,
        kind: &str,
        entity_id: &str,
        revision: &str,
    ) -> SqliteStoreResult<Option<T>> {
        let row = sqlx::query(
            "SELECT payload FROM canonical_records \
             WHERE record_kind = ?1 AND entity_id = ?2 AND revision = ?3",
        )
        .bind(kind)
        .bind(entity_id)
        .bind(revision)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| serde_json::from_str(row.get::<&str, _>("payload")))
            .transpose()
            .map_err(Into::into)
    }

    pub(crate) async fn list_records<T: DeserializeOwned>(
        &self,
        kind: &str,
    ) -> SqliteStoreResult<Vec<T>> {
        let rows = sqlx::query(
            "SELECT payload FROM canonical_records WHERE record_kind = ?1 \
             ORDER BY entity_id, revision",
        )
        .bind(kind)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| serde_json::from_str(row.get::<&str, _>("payload")).map_err(Into::into))
            .collect()
    }

    pub(crate) async fn page_records<T: DeserializeOwned>(
        &self,
        kind: &str,
        page: &PageRequest,
        revisioned: bool,
        equals: Vec<(String, String)>,
        text: Option<(Vec<String>, String)>,
    ) -> SqliteStoreResult<Page<T>> {
        let key = if revisioned {
            "entity_id || '@' || revision"
        } else {
            "entity_id"
        };
        let mut query = sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT payload, ");
        query
            .push(key)
            .push(" AS cursor_key FROM canonical_records WHERE record_kind = ");
        query.push_bind(kind);
        if let Some(cursor) = &page.cursor {
            query.push(" AND ").push(key).push(" > ").push_bind(cursor);
        }
        for (path, expected) in equals {
            query
                .push(" AND json_extract(payload, ")
                .push_bind(format!("$.{path}"))
                .push(") = ")
                .push_bind(expected);
        }
        if let Some((paths, value)) = text {
            query.push(" AND (");
            let pattern = format!("%{}%", escape_like(&value.to_lowercase()));
            for (index, path) in paths.into_iter().enumerate() {
                if index > 0 {
                    query.push(" OR ");
                }
                query
                    .push("lower(coalesce(json_extract(payload, ")
                    .push_bind(format!("$.{path}"))
                    .push("), '')) LIKE ")
                    .push_bind(pattern.clone())
                    .push(" ESCAPE '\\'");
            }
            query.push(")");
        }
        query
            .push(" ORDER BY ")
            .push(key)
            .push(" LIMIT ")
            .push_bind(i64::try_from(page.limit() + 1).unwrap_or(i64::MAX));
        let rows = query.build().fetch_all(&self.pool).await?;
        let limit = page.limit();
        let has_more = rows.len() > limit;
        let rows = rows.into_iter().take(limit).collect::<Vec<_>>();
        let next_cursor = has_more
            .then(|| rows.last().map(|row| row.get::<String, _>("cursor_key")))
            .flatten();
        let items = rows
            .into_iter()
            .map(|row| serde_json::from_str(row.get::<&str, _>("payload")).map_err(Into::into))
            .collect::<SqliteStoreResult<Vec<_>>>()?;
        Ok(Page { items, next_cursor })
    }
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
