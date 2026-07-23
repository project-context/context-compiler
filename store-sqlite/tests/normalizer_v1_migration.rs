use std::str::FromStr;

use context_source::SourceReader;
use context_source::SourceStore;
use context_store_sqlite::SqliteStore;
use sqlx::Connection;
use sqlx::Executor;
use sqlx::Row;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::sqlite::SqliteConnection;

#[tokio::test]
async fn legacy_inline_normalized_records_are_archived_and_require_rebuild()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("legacy.db");
    let options =
        SqliteConnectOptions::from_str(path.to_string_lossy().as_ref())?.create_if_missing(true);
    let mut connection = SqliteConnection::connect_with(&options).await?;
    connection
        .execute(sqlx::raw_sql(include_str!(
            "../migrations/0001_canonical_records.sql"
        )))
        .await?;
    connection
        .execute(sqlx::raw_sql(include_str!(
            "../migrations/0002_admin_control_plane.sql"
        )))
        .await?;
    sqlx::query(
        "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) \
         VALUES ('normalized_source', 'legacy', 'r1', ?1)",
    )
    .bind(r#"{"content":"legacy inline body","mappingId":"markdown-to-markdown"}"#)
    .execute(&mut connection)
    .await?;
    connection.close().await?;

    let store = SqliteStore::connect(&path).await?;
    assert!(store.normalizer_rebuild_required().await?);
    assert!(store.list_normalized().await?.is_empty());
    store.close().await;

    let mut connection = SqliteConnection::connect_with(&options).await?;
    let archived = sqlx::query(
        "SELECT COUNT(*) AS count FROM archived_canonical_records \
         WHERE protocol_generation = 'normalizer_v0'",
    )
    .fetch_one(&mut connection)
    .await?
    .get::<i64, _>("count");
    assert_eq!(archived, 1);
    Ok(())
}
