use std::str::FromStr;

use context_store_sqlite::SqliteStore;
use context_structure::StructureReader;
use context_structure::StructureStore;
use sqlx::Connection;
use sqlx::Executor;
use sqlx::Row;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::sqlite::SqliteConnection;

#[tokio::test]
async fn legacy_structure_is_archived_and_scope_targets_become_orphaned()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("legacy-structure.db");
    let options =
        SqliteConnectOptions::from_str(path.to_string_lossy().as_ref())?.create_if_missing(true);
    let mut connection = SqliteConnection::connect_with(&options).await?;
    for migration in [
        include_str!("../migrations/0001_canonical_records.sql"),
        include_str!("../migrations/0002_admin_control_plane.sql"),
        include_str!("../migrations/0003_normalizer_protocol_v1.sql"),
    ] {
        connection.execute(sqlx::raw_sql(migration)).await?;
    }
    for (kind, id) in [
        ("structure_build", "build"),
        ("structure_unit", "unit"),
        ("evidence_record", "evidence"),
        ("fact_revision", "fact"),
        ("semantic_edge", "edge"),
    ] {
        sqlx::query(
            "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) \
             VALUES (?1, ?2, 'r1', '{}')",
        )
        .bind(kind)
        .bind(id)
        .execute(&mut connection)
        .await?;
    }
    sqlx::query(
        "INSERT INTO canonical_records (record_kind, entity_id, revision, payload) \
         VALUES ('scope_assignment', 'scope', 'r1', ?1)",
    )
    .bind(
        r#"{"reviewStatus":"confirmed","target":{"entity":{"layer":"structure","id":"unit"},"revision":"r1"}}"#,
    )
    .execute(&mut connection)
    .await?;
    connection.close().await?;

    let store = SqliteStore::connect(&path).await?;
    assert!(store.structure_rebuild_required().await?);
    assert!(store.list_structures().await?.is_empty());
    store.close().await;

    let mut connection = SqliteConnection::connect_with(&options).await?;
    let archived = sqlx::query(
        "SELECT COUNT(*) AS count FROM archived_canonical_records \
         WHERE protocol_generation = 'structure_v1'",
    )
    .fetch_one(&mut connection)
    .await?
    .get::<i64, _>("count");
    assert_eq!(archived, 5);
    let scope_payload = sqlx::query_scalar::<_, String>(
        "SELECT payload FROM canonical_records \
         WHERE record_kind = 'scope_assignment' AND entity_id = 'scope'",
    )
    .fetch_one(&mut connection)
    .await?;
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&scope_payload)?["reviewStatus"],
        "orphaned"
    );
    Ok(())
}
