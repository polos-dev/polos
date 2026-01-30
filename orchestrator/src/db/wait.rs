// Wait-related database operations
use chrono::{DateTime, Utc};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::db::{models::ExpiredWait, Database};

impl Database {
    pub async fn set_waiting(
        &self,
        execution_id: &Uuid,
        step_key: &str,
        wait_until: Option<DateTime<Utc>>,
        wait_type: Option<&str>,
        wait_topic: Option<&str>,
        expires_at: Option<DateTime<Utc>>,
    ) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;

        // Get execution info (parent_execution_id, root_execution_id)
        let exec_row = sqlx::query(
            "SELECT parent_execution_id, root_execution_id FROM workflow_executions WHERE id = $1",
        )
        .bind(execution_id)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(exec_row) = exec_row {
            let parent_execution_id: Option<Uuid> = exec_row.get("parent_execution_id");
            let root_execution_id: Option<Uuid> = exec_row.get("root_execution_id");
            let effective_root_id = root_execution_id.unwrap_or(*execution_id);

            // Set execution to waiting state
            sqlx::query("UPDATE workflow_executions SET status = 'waiting' WHERE id = $1")
                .bind(execution_id)
                .execute(&mut *tx)
                .await?;

            // Get project_id from execution
            let wait_project_id =
                Database::get_project_id_from_execution(self, execution_id).await?;

            // Insert wait step
            sqlx::query(
        "INSERT INTO wait_steps (execution_id, parent_execution_id, root_execution_id, step_key, wait_until, wait_type, wait_topic, expires_at, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (execution_id, step_key) DO UPDATE
         SET wait_until = $5, wait_type = $6, wait_topic = $7, expires_at = $8"
      )
      .bind(execution_id)
      .bind(parent_execution_id)
      .bind(effective_root_id)
      .bind(step_key)
      .bind(wait_until)
      .bind(wait_type)
      .bind(wait_topic)
      .bind(expires_at)
      .bind(wait_project_id)
      .execute(&mut *tx)
      .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Resume execution from waiting state
    /// Marks the wait step as completed in execution_step_outputs
    #[allow(clippy::too_many_arguments)]
    pub async fn resume_execution_from_wait(
        &self,
        execution_id: &Uuid,
        root_execution_id: &Uuid,
        step_key: &str,
        wait_type: &str,
        wait_until: Option<DateTime<Utc>>,
        wait_topic: Option<&str>,
        expires_at: Option<DateTime<Utc>>,
    ) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        self.resume_execution_from_wait_with_tx(
            &mut tx,
            execution_id,
            root_execution_id,
            step_key,
            wait_type,
            wait_until,
            wait_topic,
            expires_at,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn resume_execution_from_wait_with_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        execution_id: &Uuid,
        _root_execution_id: &Uuid,
        step_key: &str,
        wait_type: &str,
        wait_until: Option<DateTime<Utc>>,
        _wait_topic: Option<&str>,
        expires_at: Option<DateTime<Utc>>,
    ) -> anyhow::Result<()> {
        // Set status back to queued
        sqlx::query(
            "UPDATE workflow_executions SET status = 'queued', queued_at = NOW() WHERE id = $1",
        )
        .bind(execution_id)
        .execute(tx.as_mut())
        .await?;

        // Mark the wait step as completed in execution_step_outputs and wait_steps
        // execution_id = root_execution_id (for hierarchical tracking)
        // source_execution_id = actual execution that created this step output
        if wait_type == "time" {
            // Use step_outputs module to store the output
            self.store_step_output(
        execution_id,
        step_key,
        Some(serde_json::json!({"success": true, "wait_until": wait_until.unwrap_or(Utc::now()).to_rfc3339()})),
        None,
        Some(true),
        Some(execution_id),
        None,
      ).await?;

            sqlx::query("UPDATE wait_steps SET wait_type = NULL, wait_until = NULL WHERE execution_id = $1 AND step_key = $2 AND wait_type = 'time'")
        .bind(execution_id)
        .bind(step_key)
        .execute(tx.as_mut())
        .await?;
        } else if wait_type == "event" {
            // For expired event waits, mark as failed with error
            // Use step_outputs module to store the output
            self.store_step_output(
        execution_id,
        step_key,
        None,
        Some(serde_json::json!({"message": format!("Event wait expired at {}", expires_at.unwrap_or(Utc::now()).to_rfc3339())})),
        Some(false),
        Some(execution_id),
        None,
      ).await?;

            sqlx::query("UPDATE wait_steps SET wait_type = NULL, wait_until = NULL, wait_topic = NULL, expires_at = NULL WHERE execution_id = $1 AND step_key = $2 AND wait_type = 'event'")
        .bind(execution_id)
        .bind(step_key)
        .execute(tx.as_mut())
        .await?;
        }

        // Don't commit here - let the caller commit
        Ok(())
    }

    /// Get and resume one expired wait (wait_until <= now or finished subworkflows)
    /// Uses SELECT FOR UPDATE SKIP LOCKED to allow multiple orchestrators to work in parallel
    /// Returns Some(ExpiredWait) if one was found and resumed, None if no expired waits found
    pub async fn get_and_resume_expired_wait(&self) -> anyhow::Result<Option<ExpiredWait>> {
        let mut tx = self.pool.begin().await?;

        // Set admin access for background workflow (operates across all projects)
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *tx)
            .await?;

        // Try to get one expired wait using UNION to combine all wait types
        // Use SELECT FOR UPDATE SKIP LOCKED to allow parallel processing
        // Priority: time waits, then event waits, then subworkflow waits
        // We need to lock the wait_steps row, so we join back to wait_steps for FOR UPDATE
        let wait_row = sqlx::query(
      "WITH expired_waits AS (
         -- Time-based waits
         SELECT ws.execution_id, COALESCE(ws.root_execution_id, ws.execution_id) as root_execution_id, 
                ws.step_key, ws.wait_type, ws.wait_until, NULL::TEXT as wait_topic, NULL::TIMESTAMPTZ as expires_at,
                1 as priority
         FROM wait_steps ws
         INNER JOIN workflow_executions e ON ws.execution_id = e.id
         WHERE e.status = 'waiting'
         AND ws.wait_type = 'time'
         AND ws.wait_until IS NOT NULL
         AND ws.wait_until <= NOW()
         AND ws.step_key IS NOT NULL
         
         UNION ALL
         
         -- Event waits
         SELECT ws.execution_id, COALESCE(ws.root_execution_id, ws.execution_id) as root_execution_id,
                ws.step_key, ws.wait_type, NULL::TIMESTAMPTZ as wait_until, ws.wait_topic, ws.expires_at,
                2 as priority
         FROM wait_steps ws
         INNER JOIN workflow_executions e ON ws.execution_id = e.id
         WHERE e.status = 'waiting'
         AND ws.wait_type = 'event'
         AND ws.expires_at IS NOT NULL
         AND ws.expires_at <= NOW()
         AND ws.step_key IS NOT NULL
         
         UNION ALL
         
         -- Subworkflow waits
         SELECT e.id as execution_id, COALESCE(e.root_execution_id, e.id) as root_execution_id,
                ws.step_key, 'subworkflow'::TEXT as wait_type, NULL::TIMESTAMPTZ as wait_until, 
                NULL::TEXT as wait_topic, NULL::TIMESTAMPTZ as expires_at,
                3 as priority
         FROM workflow_executions e
         INNER JOIN wait_steps ws ON ws.execution_id = e.id AND ws.wait_type = 'subworkflow'
         WHERE e.status = 'waiting'
         AND EXISTS (
           SELECT 1 FROM workflow_executions children
           WHERE children.parent_execution_id = e.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM workflow_executions children
           WHERE children.parent_execution_id = e.id
           AND children.status NOT IN ('completed', 'failed', 'cancelled')
         )
         AND ws.step_key IS NOT NULL
       )
       SELECT ew.execution_id, ew.root_execution_id, ew.step_key, ew.wait_type, ew.wait_until, ew.wait_topic, ew.expires_at
       FROM expired_waits ew
       INNER JOIN wait_steps ws ON ws.execution_id = ew.execution_id AND ws.step_key = ew.step_key
       ORDER BY ew.priority ASC
       LIMIT 1
       FOR UPDATE OF ws SKIP LOCKED"
    )
    .fetch_optional(&mut *tx)
    .await?;

        let wait_row = match wait_row {
            Some(row) => row,
            None => {
                tx.rollback().await?;
                return Ok(None);
            }
        };

        let execution_id: Uuid = wait_row.get("execution_id");
        let root_execution_id: Uuid = wait_row.get("root_execution_id");
        let step_key: String = wait_row.get::<String, _>("step_key");
        let wait_type: String = wait_row.get("wait_type");
        let wait_until: Option<DateTime<Utc>> = wait_row.get("wait_until");
        let wait_topic: Option<String> = wait_row.get("wait_topic");
        let expires_at: Option<DateTime<Utc>> = wait_row.get("expires_at");

        // Resume the execution within the same transaction
        self.resume_execution_from_wait_with_tx(
            &mut tx,
            &execution_id,
            &root_execution_id,
            &step_key,
            &wait_type,
            wait_until,
            wait_topic.as_deref(),
            expires_at,
        )
        .await?;

        tx.commit().await?;

        Ok(Some(ExpiredWait {
            execution_id,
            root_execution_id,
            step_key,
            wait_type,
            wait_until,
            wait_topic,
            expires_at,
        }))
    }
}
