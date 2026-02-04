// Event-related database operations
use chrono::{DateTime, Utc};
use sqlx::{postgres::PgRow, Row};
use uuid::Uuid;

use crate::db::common;
use crate::db::{models::Event, Database};

impl Database {
    pub async fn create_or_get_event_topic(
        &self,
        topic: &str,
        project_id: &Uuid,
    ) -> anyhow::Result<Uuid> {
        // Try to get existing topic
        let row: Option<PgRow> =
            sqlx::query("SELECT id FROM event_topics WHERE topic = $1 AND project_id = $2")
                .bind(topic)
                .bind(project_id)
                .fetch_optional(&self.pool)
                .await?;

        if let Some(row) = row {
            Ok(row.get("id"))
        } else {
            // Create new topic
            let row: PgRow = sqlx::query(
        "INSERT INTO event_topics (id, topic, project_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id"
      )
      .bind(topic)
      .bind(project_id)
      .fetch_one(&self.pool)
      .await?;
            Ok(row.get("id"))
        }
    }

    pub async fn publish_events_batch(
        &self,
        topic: String,
        events: Vec<(Option<String>, serde_json::Value, Option<Uuid>, i32)>,
        _source_execution_id: Option<&Uuid>,
        _root_execution_id: Option<&Uuid>,
        project_id: &Uuid,
    ) -> anyhow::Result<Vec<i64>> {
        let mut tx = self.pool.begin().await?;

        // Set project_id session variable for RLS
        common::set_project_id_in_tx(&mut tx, project_id, false).await?;

        // Create or get topic (needs to be done within transaction)
        // Use ON CONFLICT to handle race conditions
        let topic_row = sqlx::query(
            "INSERT INTO event_topics (id, topic, project_id) 
       VALUES (gen_random_uuid(), $1, $2)
       ON CONFLICT (topic, project_id) DO NOTHING
       RETURNING id",
        )
        .bind(&topic)
        .bind(project_id)
        .fetch_optional(&mut *tx)
        .await?;

        let _topic_id: Uuid = if let Some(row) = topic_row {
            // Successfully inserted
            row.get("id")
        } else {
            // Conflict occurred, fetch existing topic
            let row: PgRow =
                sqlx::query("SELECT id FROM event_topics WHERE topic = $1 AND project_id = $2")
                    .bind(&topic)
                    .bind(project_id)
                    .fetch_one(&mut *tx)
                    .await?;
            row.get("id")
        };

        let mut sequence_ids = Vec::new();
        let mut last_event_type: Option<String> = None;
        let mut last_data: Option<serde_json::Value> = None;
        let mut last_event_id: Option<Uuid> = None;
        let mut last_created_at: Option<DateTime<Utc>> = None;

        // Publish all events (all for the same topic)
        for (event_type, data, execution_id, attempt_number) in events {
            // Insert event and return sequence_id
            let row: PgRow = sqlx::query(
                "INSERT INTO events (id, topic, event_type, data, status, execution_id, attempt_number, project_id)
                VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
                RETURNING sequence_id, id, created_at"
              )
              .bind(&topic)
              .bind(event_type.as_deref())
              .bind(data.clone())
              .bind("valid")
              .bind(execution_id.as_ref())
              .bind(attempt_number)
              .bind(project_id)
              .fetch_one(&mut *tx)
              .await?;

            let seq_id: i64 = row.get("sequence_id");
            last_event_id = Some(row.get("id"));
            last_created_at = Some(row.get("created_at"));
            sequence_ids.push(seq_id);
            // Store last event data for resuming waiting executions
            last_event_type = event_type.clone();
            last_data = Some(data);
        }

        // Check for executions waiting on this topic
        // Use FOR UPDATE SKIP LOCKED to allow parallel processing across multiple orchestrator instances
        let waiting_rows = sqlx::query(
            "SELECT ws.execution_id, COALESCE(ws.root_execution_id, ws.execution_id) as root_execution_id, ws.step_key
            FROM wait_steps ws
            INNER JOIN workflow_executions e ON ws.execution_id = e.id
            WHERE e.status = 'waiting'
            AND ws.wait_type = 'event'
            AND ws.wait_topic = $1
            AND ws.step_key IS NOT NULL
            FOR UPDATE SKIP LOCKED"
        )
        .bind(&topic)
        .fetch_all(&mut *tx)
        .await?;

        // Resume each waiting execution (use last event data)
        for row in waiting_rows {
            let exec_id: Uuid = row.get("execution_id");
            let step_key_value: String = row.get::<String, _>("step_key");

            // Store event data in execution_step_outputs
            let event_output = serde_json::json!({
              "sequence_id": sequence_ids.last().unwrap(),
              "topic": topic,
              "event_type": last_event_type,
              "data": last_data,
              "id": last_event_id,
              "created_at": last_created_at,
            });

            // Get project_id from execution
            let event_wait_project_id =
                Database::get_project_id_from_execution(self, &exec_id).await?;

            sqlx::query(
        "INSERT INTO execution_step_outputs (execution_id, step_key, outputs, error, success, source_execution_id, project_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (execution_id, step_key) DO UPDATE
          SET outputs = $3, error = $4, success = $5, source_execution_id = $6"
      )
      .bind(exec_id)
      .bind(&step_key_value)
      .bind(Some(event_output))
      .bind(None::<serde_json::Value>)
      .bind(Some(true))
      .bind(exec_id)
      .bind(event_wait_project_id)
      .execute(&mut *tx)
      .await?;

            // Clear wait step
            sqlx::query("UPDATE wait_steps SET wait_type = NULL, wait_until = NULL, wait_topic = NULL, expires_at = NULL WHERE execution_id = $1 AND step_key = $2 AND wait_type = 'event'")
        .bind(exec_id)
        .bind(&step_key_value)
        .execute(&mut *tx)
        .await?;

            // Queue execution for resumption
            sqlx::query(
                "UPDATE workflow_executions SET status = 'queued', queued_at = NOW() WHERE id = $1",
            )
            .bind(exec_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(sequence_ids)
    }

    /// Check for one workflow waiting on an event and resume it if an event is available
    /// Uses SELECT FOR UPDATE SKIP LOCKED to allow multiple orchestrators to work in parallel
    /// Returns Some(1) if an execution was resumed, None if no waiting executions found
    pub async fn check_and_resume_one_event_wait(&self) -> anyhow::Result<Option<usize>> {
        let mut tx = self.pool.begin().await?;

        // Set admin access for background workflow (operates across all projects)
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *tx)
            .await?;

        let result = sqlx::query_scalar::<_, i64>(
            r#"
        WITH waiting_for_events AS (
            -- Find one execution waiting for an event
            SELECT 
                ws.execution_id,
                ws.step_key,
                ws.wait_topic,
                ws.created_at as wait_created_at,
                e.project_id
            FROM wait_steps ws
            INNER JOIN workflow_executions e ON ws.execution_id = e.id
            WHERE e.status = 'waiting'
              AND ws.wait_type = 'event'
              AND ws.wait_topic IS NOT NULL
              AND ws.step_key IS NOT NULL
            ORDER BY ws.created_at ASC  -- Process oldest waits first
            LIMIT 1
            FOR UPDATE OF ws SKIP LOCKED
        ),
        matching_event AS (
            -- Find the most recent event for this topic
            SELECT 
                w.execution_id,
                w.step_key,
                w.wait_topic,
                w.project_id,
                e.id as event_id,
                e.sequence_id,
                e.event_type,
                e.data,
                e.created_at
            FROM waiting_for_events w
            INNER JOIN LATERAL (
                SELECT e.*
                FROM events e
                WHERE e.topic = w.wait_topic
                  AND e.status = 'valid'
                  AND e.project_id = w.project_id
                  AND e.created_at >= w.wait_created_at
                ORDER BY e.sequence_id DESC
                LIMIT 1
            ) e ON true
        ),
        inserted_output AS (
            -- Store event data in execution_step_outputs
            INSERT INTO execution_step_outputs (
                execution_id, step_key, outputs, error, success, 
                source_execution_id, project_id
            )
            SELECT 
                execution_id,
                step_key,
                jsonb_build_object(
                    'sequence_id', sequence_id,
                    'topic', wait_topic,
                    'event_type', event_type,
                    'data', data,
                    'id', event_id,
                    'created_at', created_at
                ),
                NULL::jsonb, -- error
                true, -- success
                execution_id, -- source_execution_id
                project_id
            FROM matching_event
            ON CONFLICT (execution_id, step_key) 
            DO UPDATE SET 
                outputs = EXCLUDED.outputs,
                error = EXCLUDED.error,
                success = EXCLUDED.success,
                source_execution_id = EXCLUDED.source_execution_id
            RETURNING 1
        ),
        cleared_wait AS (
            -- Clear wait step
            UPDATE wait_steps ws
            SET wait_type = NULL, 
                wait_until = NULL, 
                wait_topic = NULL, 
                expires_at = NULL
            FROM matching_event me
            WHERE ws.execution_id = me.execution_id
              AND ws.step_key = me.step_key
              AND ws.wait_type = 'event'
            RETURNING 1
        ),
        resumed_execution AS (
            -- Resume execution
            UPDATE workflow_executions ex
            SET status = 'queued', queued_at = NOW()
            FROM matching_event me
            WHERE ex.id = me.execution_id
            RETURNING 1
        )
        SELECT COALESCE((SELECT COUNT(*) FROM resumed_execution), 0)::bigint
        "#,
        )
        .fetch_optional(&mut *tx)
        .await?;

        // The query always returns a count (0 or 1), never NULL
        // 0 means: no waiting execution found OR waiting execution found but no matching event
        // 1 means: waiting execution found, matching event found, and execution resumed
        let count = result.unwrap_or(0);

        if count > 0 {
            tx.commit().await?;
            Ok(Some(count as usize))
        } else {
            // Check if there was actually a waiting execution (even if no event matched)
            // We can't distinguish this easily, so we'll just return None to indicate
            // no work was done, and the caller will continue looping
            tx.commit().await?;
            Ok(None)
        }
    }

    pub async fn get_events(
        &self,
        topic: &str,
        project_id: &Uuid,
        last_sequence_id: Option<i64>,
        last_timestamp: Option<chrono::DateTime<chrono::Utc>>,
        limit: i32,
    ) -> anyhow::Result<Vec<Event>> {
        let query = if let Some(last_seq) = last_sequence_id {
            // If last_sequence_id is provided, use it (takes priority over timestamp)
            sqlx::query(
        "SELECT id, sequence_id, topic, event_type, data, status, execution_id, attempt_number, created_at
         FROM events
         WHERE topic = $1 AND status = 'valid' AND project_id = $2 AND sequence_id > $3
         ORDER BY sequence_id ASC
         LIMIT $4"
      )
      .bind(topic)
      .bind(project_id)
      .bind(last_seq)
      .bind(limit)
        } else if let Some(ts) = last_timestamp {
            // If last_timestamp is provided (and no last_sequence_id), filter by timestamp
            sqlx::query(
        "SELECT id, sequence_id, topic, event_type, data, status, execution_id, attempt_number, created_at
         FROM events
         WHERE topic = $1 AND status = 'valid' AND project_id = $2 AND created_at > $3
         ORDER BY sequence_id ASC
         LIMIT $4"
      )
      .bind(topic)
      .bind(project_id)
      .bind(ts)
      .bind(limit)
        } else {
            // No filtering - get all events
            sqlx::query(
        "SELECT id, sequence_id, topic, event_type, data, status, execution_id, attempt_number, created_at
         FROM events
         WHERE topic = $1 AND status = 'valid' AND project_id = $2
         ORDER BY sequence_id ASC
         LIMIT $3"
      )
      .bind(topic)
      .bind(project_id)
      .bind(limit)
        };

        let rows = query.fetch_all(&self.pool).await?;

        Ok(rows
            .into_iter()
            .map(|row: PgRow| Event {
                id: row.get("id"),
                sequence_id: row.get("sequence_id"),
                topic: row.get("topic"),
                event_type: row.get("event_type"),
                data: row.get("data"),
                status: row.get("status"),
                execution_id: row.get("execution_id"),
                attempt_number: row.get("attempt_number"),
                created_at: row.get("created_at"),
            })
            .collect())
    }
}
