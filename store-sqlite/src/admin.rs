use serde_json::Value;
use sqlx::Row;

use crate::SqliteStore;
use crate::SqliteStoreResult;

impl SqliteStore {
    pub async fn save_build_job_record(
        &self,
        job_id: &str,
        workspace_id: &str,
        status: &str,
        created_at_ms: u64,
        updated_at_ms: u64,
        payload: &Value,
    ) -> SqliteStoreResult<()> {
        sqlx::query(
            "INSERT INTO build_jobs \
             (job_id, workspace_id, status, payload, created_at_ms, updated_at_ms) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
             ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, \
             payload = excluded.payload, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(job_id)
        .bind(workspace_id)
        .bind(status)
        .bind(serde_json::to_string(payload)?)
        .bind(i64::try_from(created_at_ms).unwrap_or(i64::MAX))
        .bind(i64::try_from(updated_at_ms).unwrap_or(i64::MAX))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn save_build_event_record(
        &self,
        job_id: &str,
        workspace_id: &str,
        sequence: u64,
        created_at_ms: u64,
        payload: &Value,
    ) -> SqliteStoreResult<()> {
        sqlx::query(
            "INSERT INTO build_job_events \
             (job_id, sequence, workspace_id, payload, created_at_ms) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(job_id, sequence) DO NOTHING",
        )
        .bind(job_id)
        .bind(i64::try_from(sequence).unwrap_or(i64::MAX))
        .bind(workspace_id)
        .bind(serde_json::to_string(payload)?)
        .bind(i64::try_from(created_at_ms).unwrap_or(i64::MAX))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn load_build_job_records(&self) -> SqliteStoreResult<Vec<Value>> {
        load_payloads(
            &self.pool,
            "SELECT payload FROM build_jobs ORDER BY created_at_ms, job_id",
        )
        .await
    }

    pub async fn load_build_event_records(&self) -> SqliteStoreResult<Vec<Value>> {
        load_payloads(
            &self.pool,
            "SELECT payload FROM build_job_events ORDER BY sequence",
        )
        .await
    }
}

async fn load_payloads(pool: &sqlx::SqlitePool, query: &str) -> SqliteStoreResult<Vec<Value>> {
    sqlx::query(query)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| serde_json::from_str(row.get::<&str, _>("payload")).map_err(Into::into))
        .collect()
}
