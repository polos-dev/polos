// Execution-related database operations
use chrono::{DateTime, Utc};
use sqlx::{Postgres, QueryBuilder, Row, Transaction};
use uuid::Uuid;

use crate::db::common;
use crate::db::{
    models::{Execution, ExecutionData},
    Database,
};

impl Database {
    // Wrapper method for common function
    async fn set_project_id_in_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        project_id: &Uuid,
        is_admin: bool,
    ) -> anyhow::Result<()> {
        common::set_project_id_in_tx(tx, project_id, is_admin).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_execution(
        &self,
        workflow_id: &str,
        payload: serde_json::Value,
        deployment_id: &str,
        parent_execution_id: Option<Uuid>,
        root_execution_id: Option<Uuid>,
        step_key: Option<&str>,
        queue_name: String,
        concurrency_key: Option<String>,
        wait_for_subworkflow: bool,
        session_id: Option<&str>,
        user_id: Option<&str>,
        otel_traceparent: Option<&str>,
        project_id: &Uuid,
        initial_state: Option<serde_json::Value>,
        run_timeout_seconds: Option<i32>,
        channel_context: Option<serde_json::Value>,
    ) -> anyhow::Result<(Uuid, DateTime<Utc>)> {
        let mut tx = self.pool.begin().await?;

        // Set project_id session variable for RLS (must be done in transaction)
        let is_admin = false; // TODO: Get from request context
        self.set_project_id_in_tx(&mut tx, project_id, is_admin)
            .await?;

        let id = Uuid::new_v4();

        let row = sqlx::query(
      "INSERT INTO workflow_executions (id, workflow_id, status, payload, deployment_id, parent_execution_id, root_execution_id, step_key, queue_name, concurrency_key, session_id, user_id, otel_traceparent, project_id, queued_at, initial_state, run_timeout_seconds, channel_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15, $16, $17)
       RETURNING id, created_at",
    )
    .bind(id)
    .bind(workflow_id)
    .bind("queued")
    .bind(payload)
    .bind(deployment_id)
    .bind(parent_execution_id)
    .bind(root_execution_id)
    .bind(step_key)
    .bind(&queue_name)
    .bind(concurrency_key.as_deref())
    .bind(session_id)
    .bind(user_id)
    .bind(otel_traceparent)
    .bind(project_id)
    .bind(initial_state.as_ref())
    .bind(run_timeout_seconds)
    .bind(channel_context.as_ref())
    .fetch_one(&mut *tx)
    .await?;

        let created_at: DateTime<Utc> = row.get("created_at");

        // Set parent execution to waiting for this subworkflow ONLY if wait_for_subworkflow is true
        if wait_for_subworkflow {
            if let Some(parent_id) = parent_execution_id {
                if let Some(step_key_value) = step_key {
                    // Get parent's parent_execution_id, and root_execution_id
                    let parent_row = sqlx::query(
                        "SELECT parent_execution_id, root_execution_id FROM workflow_executions WHERE id = $1",
                    )
                    .bind(parent_id)
                    .fetch_optional(&mut *tx)
                    .await?;

                    if let Some(parent_row) = parent_row {
                        let parent_parent_execution_id: Option<Uuid> =
                            parent_row.get("parent_execution_id");
                        let parent_root_execution_id: Option<Uuid> =
                            parent_row.get("root_execution_id");
                        let effective_root_id = parent_root_execution_id.unwrap_or(parent_id);

                        // Update parent execution status to waiting and free the worker slot
                        let waiting_row = sqlx::query(
                            "UPDATE workflow_executions SET status = 'waiting' WHERE id = $1 RETURNING assigned_to_worker",
                        )
                        .bind(parent_id)
                        .fetch_one(&mut *tx)
                        .await?;

                        // Decrement worker's execution count since waiting doesn't use a slot
                        if let Some(worker_id) =
                            waiting_row.get::<Option<Uuid>, _>("assigned_to_worker")
                        {
                            sqlx::query(
                                "UPDATE workers SET current_execution_count = GREATEST(0, current_execution_count - 1) WHERE id = $1"
                            )
                            .bind(worker_id)
                            .execute(&mut *tx)
                            .await?;
                        }

                        // Insert wait step for parent using step_key
                        sqlx::query(
                            "INSERT INTO wait_steps (execution_id, parent_execution_id, root_execution_id, step_key, wait_until, wait_type, project_id)
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (execution_id, step_key) DO UPDATE
                            SET wait_until = $5, wait_type = $6"
                        )
                        .bind(parent_id)
                        .bind(parent_parent_execution_id) // The parent's parent (or None if parent is root)
                        .bind(effective_root_id)
                        .bind(step_key_value)
                        .bind(None::<DateTime<Utc>>) // No time-based wait
                        .bind("subworkflow")
                        .bind(project_id)
                        .execute(&mut *tx)
                        .await?;
                    }
                }
            }
        }

        tx.commit().await?;

        Ok((id, created_at))
    }

    /// Batch create executions in a single transaction
    pub async fn create_executions(
        &self,
        executions: Vec<ExecutionData>,
        deployment_id: &str,
        otel_traceparent: Option<&str>,
        project_id: &Uuid,
    ) -> anyhow::Result<Vec<(Uuid, DateTime<Utc>)>> {
        let mut tx = self.pool.begin().await?;

        // Set project_id session variable for RLS (must be done in transaction)
        let is_admin = false; // TODO: Get from request context
        self.set_project_id_in_tx(&mut tx, project_id, is_admin)
            .await?;

        // Extract common batch-level properties from first execution (all executions in batch share these)
        let wait_for_subworkflow = executions
            .first()
            .map(|e| e.wait_for_subworkflow)
            .unwrap_or(false);
        let parent_id_for_wait = executions.first().and_then(|e| e.parent_execution_id);
        let waiting_step_key = executions.first().and_then(|e| e.step_key.clone());

        let mut results = Vec::new();

        for exec_data in executions {
            let id = Uuid::new_v4();
            let queue_name = exec_data
                .queue_name
                .as_deref()
                .unwrap_or(&exec_data.workflow_id);

            // Get or create queue (within transaction)
            let queue =
                sqlx::query("SELECT name FROM queues WHERE name = $1 AND deployment_id = $2")
                    .bind(queue_name)
                    .bind(deployment_id)
                    .fetch_optional(&mut *tx)
                    .await?;

            if queue.is_none() {
                // Queue doesn't exist, create it within transaction
                let default_limit = exec_data.queue_concurrency_limit.unwrap_or_else(|| {
                    std::env::var("POLOS_DEFAULT_CONCURRENCY_LIMIT")
                        .ok()
                        .and_then(|s| s.parse::<i32>().ok())
                        .unwrap_or(999999) // Very large number for "unlimited"
                });

                sqlx::query(
          "INSERT INTO queues (name, deployment_id, project_id, concurrency_limit) VALUES ($1, $2, $3, $4) 
            ON CONFLICT (name, deployment_id, project_id) DO UPDATE SET 
              concurrency_limit = EXCLUDED.concurrency_limit,
              updated_at = NOW()"
        )
        .bind(queue_name)
        .bind(deployment_id)
        .bind(project_id)
        .bind(default_limit)
        .execute(&mut *tx)
        .await?;
            }

            // Use otel_traceparent from exec_data if provided, otherwise fall back to batch-level otel_traceparent
            let traceparent = exec_data.otel_traceparent.as_deref().or(otel_traceparent);

            let row = sqlx::query(
        "INSERT INTO workflow_executions (id, workflow_id, status, payload, deployment_id, parent_execution_id, root_execution_id, step_key, queue_name, concurrency_key, batch_id, session_id, user_id, otel_traceparent, project_id, queued_at, initial_state, run_timeout_seconds) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), $16, $17)
          RETURNING id, created_at",
      )
      .bind(id)
      .bind(&exec_data.workflow_id)
      .bind("queued")
      .bind(exec_data.payload)
      .bind(deployment_id)
      .bind(exec_data.parent_execution_id)
      .bind(exec_data.root_execution_id)
      .bind(exec_data.step_key.as_deref())
      .bind(queue_name)
      .bind(exec_data.concurrency_key.as_deref())
      .bind(exec_data.batch_id)
      .bind(exec_data.session_id.as_deref())
      .bind(exec_data.user_id.as_deref())
      .bind(traceparent)
      .bind(project_id)
      .bind(exec_data.initial_state.as_ref())
      .bind(exec_data.run_timeout_seconds)
      .fetch_one(&mut *tx)
      .await?;

            let created_at: DateTime<Utc> = row.get("created_at");
            results.push((id, created_at));
        }

        // Update parent status to waiting once and create wait_step (if any subworkflows are waiting)
        // Since all workflows share the same parent_id, step_key, and wait_for_subworkflow, we check once after the loop
        if wait_for_subworkflow {
            if let (Some(parent_id), Some(step_key_value)) =
                (parent_id_for_wait, waiting_step_key.as_ref())
            {
                // Get parent execution details once (within transaction)
                let parent_row = sqlx::query("SELECT parent_execution_id, root_execution_id, project_id FROM workflow_executions WHERE id = $1")
          .bind(parent_id)
          .fetch_optional(&mut *tx)
          .await?;

                if let Some(parent_row) = parent_row {
                    let parent_parent_execution_id: Option<Uuid> =
                        parent_row.get("parent_execution_id");
                    let parent_root_execution_id: Option<Uuid> =
                        parent_row.get("root_execution_id");
                    let effective_root_id = parent_root_execution_id.unwrap_or(parent_id);
                    let parent_project_id: Uuid = parent_row.get("project_id");

                    // Update parent status to waiting once and free the worker slot
                    let waiting_row = sqlx::query("UPDATE workflow_executions SET status = 'waiting' WHERE id = $1 RETURNING assigned_to_worker")
                        .bind(parent_id)
                        .fetch_one(&mut *tx)
                        .await?;

                    // Decrement worker's execution count since waiting doesn't use a slot
                    if let Some(worker_id) =
                        waiting_row.get::<Option<Uuid>, _>("assigned_to_worker")
                    {
                        sqlx::query(
                            "UPDATE workers SET current_execution_count = GREATEST(0, current_execution_count - 1) WHERE id = $1"
                        )
                        .bind(worker_id)
                        .execute(&mut *tx)
                        .await?;
                    }

                    // Since step_key is common for all workflows in batch, we only create one wait_step entry
                    // Store execution_ids array in metadata to preserve ordering
                    let execution_ids: Vec<String> =
                        results.iter().map(|(id, _)| id.to_string()).collect();
                    let metadata = serde_json::json!({
                      "execution_ids": execution_ids
                    });

                    sqlx::query(
            "INSERT INTO wait_steps (execution_id, parent_execution_id, root_execution_id, step_key, wait_until, wait_type, project_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (execution_id, step_key) DO UPDATE
             SET wait_until = $5, wait_type = $6, metadata = $8"
          )
          .bind(parent_id)
          .bind(parent_parent_execution_id)
          .bind(effective_root_id)
          .bind(step_key_value)
          .bind(None::<DateTime<Utc>>)
          .bind("subworkflow")
          .bind(parent_project_id)
          .bind(Some(metadata))
          .execute(&mut *tx)
          .await?;
                }
            }
        }

        tx.commit().await?;

        Ok(results)
    }

    pub async fn get_execution(&self, execution_id: &Uuid) -> anyhow::Result<Execution> {
        let row = sqlx::query(
      "SELECT id, workflow_id, status, payload, result, error, created_at, started_at, completed_at, deployment_id, assigned_to_worker, parent_execution_id, root_execution_id, retry_count, step_key, queue_name, concurrency_key, batch_id, session_id, user_id, output_schema_name, otel_traceparent, otel_span_id, claimed_at, queued_at, initial_state, final_state, run_timeout_seconds, cancelled_at, cancelled_by, channel_context
        FROM workflow_executions WHERE id = $1"
    )
    .bind(execution_id)
    .fetch_one(&self.pool)
    .await?;

        Ok(Execution {
            id: row.get("id"),
            workflow_id: row.get("workflow_id"),
            status: row.get("status"),
            payload: row.get("payload"),
            result: row.get("result"),
            error: row.get("error"),
            created_at: row.get("created_at"),
            started_at: row.get("started_at"),
            completed_at: row.get("completed_at"),
            deployment_id: row.get("deployment_id"),
            assigned_to_worker: row.get("assigned_to_worker"),
            parent_execution_id: row.get("parent_execution_id"),
            root_execution_id: row.get("root_execution_id"),
            retry_count: row.get("retry_count"),
            step_key: row.get("step_key"),
            queue_name: row.get("queue_name"),
            concurrency_key: row.get("concurrency_key"),
            batch_id: row.get("batch_id"),
            session_id: row.get("session_id"),
            user_id: row.get("user_id"),
            output_schema_name: row.get("output_schema_name"),
            otel_traceparent: row.get("otel_traceparent"),
            otel_span_id: row.get("otel_span_id"),
            claimed_at: row.get("claimed_at"),
            queued_at: row.get("queued_at"),
            initial_state: row.get("initial_state"),
            final_state: row.get("final_state"),
            run_timeout_seconds: row.get("run_timeout_seconds"),
            cancelled_at: row.get("cancelled_at"),
            cancelled_by: row.get("cancelled_by"),
            root_workflow_id: None,
            channel_context: row.get("channel_context"),
        })
    }

    pub async fn reset_execution_for_retry(&self, execution_id: &Uuid) -> anyhow::Result<()> {
        sqlx::query(
      "UPDATE workflow_executions 
       SET status = 'queued', assigned_to_worker = NULL, assigned_at = NULL, claimed_at = NULL, error = NULL, queued_at = NOW()
       WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled', 'pending_cancel')"
    )
    .bind(execution_id)
    .execute(&self.pool)
    .await?;

        Ok(())
    }

    pub async fn update_execution_otel_span_id(
        &self,
        execution_id: &Uuid,
        otel_span_id: Option<&str>,
    ) -> anyhow::Result<()> {
        sqlx::query("UPDATE workflow_executions SET otel_span_id = $1 WHERE id = $2")
            .bind(otel_span_id)
            .bind(execution_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_executions_by_project(
        &self,
        project_id: &Uuid,
        workflow_type: &str,
        workflow_id: Option<&str>,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<Execution>> {
        let mut query_builder = QueryBuilder::new(
      "SELECT e.id, e.workflow_id, e.status, e.payload, e.result, e.error, e.created_at,
              e.started_at, e.completed_at, e.deployment_id, e.assigned_to_worker,
              e.parent_execution_id, e.root_execution_id, e.retry_count, e.step_key,
              e.queue_name, e.concurrency_key, e.batch_id, e.session_id, e.user_id,
              e.output_schema_name, e.initial_state, e.final_state, e.run_timeout_seconds,
              e.cancelled_at, e.cancelled_by, e.channel_context
       FROM workflow_executions e
       JOIN deployment_workflows dw ON e.workflow_id = dw.workflow_id AND e.deployment_id = dw.deployment_id
       WHERE dw.project_id = "
    );

        query_builder.push_bind(project_id);
        query_builder.push(" AND dw.workflow_type = ");
        query_builder.push_bind(workflow_type);

        if let Some(wf_id) = workflow_id {
            query_builder.push(" AND e.workflow_id = ");
            query_builder.push_bind(wf_id);
        }

        if let Some(start) = start_time {
            query_builder.push(" AND e.created_at >= ");
            query_builder.push_bind(start);
        }
        if let Some(end) = end_time {
            query_builder.push(" AND e.created_at <= ");
            query_builder.push_bind(end);
        }

        query_builder.push(" ORDER BY e.created_at DESC LIMIT ");
        query_builder.push_bind(limit);
        query_builder.push(" OFFSET ");
        query_builder.push_bind(offset);

        let query = query_builder.build();
        let rows = query.fetch_all(&self.pool).await?;

        let executions = rows
            .into_iter()
            .map(|row| Execution {
                id: row.get("id"),
                workflow_id: row.get("workflow_id"),
                status: row.get("status"),
                payload: row.get("payload"),
                result: row.get("result"),
                error: row.get("error"),
                created_at: row.get("created_at"),
                started_at: row.get("started_at"),
                completed_at: row.get("completed_at"),
                deployment_id: row.get("deployment_id"),
                assigned_to_worker: row.get("assigned_to_worker"),
                parent_execution_id: row.get("parent_execution_id"),
                root_execution_id: row.get("root_execution_id"),
                retry_count: row.get("retry_count"),
                step_key: row.get("step_key"),
                queue_name: row.get("queue_name"),
                concurrency_key: row.get("concurrency_key"),
                batch_id: row.get("batch_id"),
                session_id: row.get("session_id"),
                user_id: row.get("user_id"),
                output_schema_name: row.get("output_schema_name"),
                otel_traceparent: None,
                otel_span_id: None,
                claimed_at: None,
                queued_at: None,
                initial_state: row.get("initial_state"),
                final_state: row.get("final_state"),
                run_timeout_seconds: row.get("run_timeout_seconds"),
                cancelled_at: row.get("cancelled_at"),
                cancelled_by: row.get("cancelled_by"),
                root_workflow_id: None,
                channel_context: row.get("channel_context"),
            })
            .collect();

        Ok(executions)
    }

    pub async fn complete_execution(
        &self,
        execution_id: &Uuid,
        result: serde_json::Value,
        output_schema_name: Option<&str>,
        worker_id: &Uuid,
        final_state: Option<serde_json::Value>,
    ) -> anyhow::Result<Option<(Uuid, String)>> {
        tracing::info!(
            "[db.complete_execution] Starting completion for execution_id={}",
            execution_id
        );
        let mut tx = self.pool.begin().await?;

        // Combine UPDATE with RETURNING to get metadata in one query
        let exec_row = sqlx::query(
      "UPDATE workflow_executions 
       SET status = $1, result = $2, completed_at = $3, output_schema_name = $4, final_state = $5
       WHERE id = $6
       RETURNING parent_execution_id, root_execution_id, workflow_id, step_key, batch_id, project_id"
    )
      .bind("completed")
      .bind(Some(&result))
      .bind(Utc::now())
      .bind(output_schema_name)
      .bind(final_state.as_ref())
      .bind(execution_id)
      .fetch_optional(&mut *tx)
      .await?;

        let Some(exec_row) = exec_row else {
            tracing::error!(
                "[db.complete_execution] Execution {} not found",
                execution_id
            );
            return Err(anyhow::anyhow!("Execution not found"));
        };

        let parent_execution_id: Option<Uuid> = exec_row.get("parent_execution_id");
        let workflow_id: String = exec_row.get("workflow_id");
        let step_key: Option<String> = exec_row.get("step_key");
        let batch_id: Option<Uuid> = exec_row.get("batch_id");
        let project_id: Option<Uuid> = exec_row.get("project_id");

        // Clone result for use in step output storage
        let result_clone = result.clone();

        // Early return if no parent - update worker and commit
        let Some(parent_id) = parent_execution_id else {
            sqlx::query(
        "UPDATE workers 
         SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
         WHERE id = $1"
      )
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
            tx.commit().await?;
            return Ok(None);
        };

        // Early return if no step_key - update worker and commit
        let Some(step_key_value) = step_key else {
            sqlx::query(
        "UPDATE workers 
         SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
         WHERE id = $1"
      )
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
            tx.commit().await?;
            return Ok(None);
        };

        // Acquire advisory lock on parent_execution_id to prevent race conditions
        let lock_key = parent_id.as_u128() as i64;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(lock_key)
            .execute(&mut *tx)
            .await?;

        // Handle batch vs non-batch cases
        if batch_id.is_none() {
            // (a) If batch_id is null, store output as-is (no list, no merge)
            sqlx::query(
        "INSERT INTO execution_step_outputs (execution_id, step_key, outputs, output_schema_name, error, success, source_execution_id, project_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (execution_id, step_key) DO UPDATE
          SET outputs = $3, output_schema_name = $4, error = $5, success = $6, source_execution_id = $7"
      )
        .bind(parent_id)
        .bind(&step_key_value)
        .bind(Some(result_clone))
        .bind(output_schema_name)
        .bind(None::<serde_json::Value>)
        .bind(Some(true))
        .bind(execution_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
        } else {
            // Read existing outputs
            let existing_row = sqlx::query(
        "SELECT outputs FROM execution_step_outputs WHERE execution_id = $1 AND step_key = $2",
      )
      .bind(parent_id)
      .bind(&step_key_value)
      .fetch_optional(&mut *tx)
      .await?;

            // (b) If batch_id is not null, create/add to existing dict keyed by execution_id
            // Parse existing outputs as a dict, or create empty dict if null
            let mut outputs_dict: serde_json::Map<String, serde_json::Value> =
                if let Some(row) = existing_row {
                    if let Ok(Some(outputs_json)) =
                        row.try_get::<Option<serde_json::Value>, _>("outputs")
                    {
                        if outputs_json.is_object() {
                            outputs_json.as_object().unwrap().clone()
                        } else {
                            serde_json::Map::new()
                        }
                    } else {
                        serde_json::Map::new()
                    }
                } else {
                    serde_json::Map::new()
                };

            // Add/update entry for this execution_id
            let execution_id_str = execution_id.to_string();
            outputs_dict.insert(
                execution_id_str,
                serde_json::json!({
                  "result": result_clone,
                  "result_schema_name": output_schema_name,
                  "workflow_id": workflow_id,
                  "success": true
                }),
            );

            // Convert back to JSONB for storage
            let merged_outputs = serde_json::Value::Object(outputs_dict);

            // Insert or update with merged outputs (still as dict)
            sqlx::query(
        "INSERT INTO execution_step_outputs (execution_id, step_key, outputs, output_schema_name, error, success, source_execution_id, project_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (execution_id, step_key) DO UPDATE
          SET outputs = $3, output_schema_name = $4, error = $5, success = $6, source_execution_id = $7"
      )
        .bind(parent_id)
        .bind(&step_key_value)
        .bind(Some(merged_outputs))
        .bind(output_schema_name)
        .bind(None::<serde_json::Value>)
        .bind(Some(true))
        .bind(execution_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;

            // Combine batch completion check and wait_metadata fetch in one query
            let Some(batch_uuid) = batch_id else {
                // This should never happen since we're in the else branch of `if batch_id.is_none()`
                return Err(anyhow::anyhow!(
                    "batch_id is None in batch processing branch"
                ));
            };
            let batch_complete_row = sqlx::query(
        "SELECT 
          (SELECT COUNT(*) FILTER (WHERE status NOT IN ('completed', 'failed')) 
            FROM workflow_executions WHERE batch_id = $1) as incomplete_count,
          (SELECT metadata FROM wait_steps WHERE execution_id = $2 AND step_key = $3) as wait_metadata"
      )
        .bind(batch_uuid)
        .bind(parent_id)
        .bind(&step_key_value)
        .fetch_one(&mut *tx)
        .await?;

            let incomplete_count: i64 = batch_complete_row.get("incomplete_count");
            let wait_metadata: Option<serde_json::Value> = batch_complete_row.get("wait_metadata");

            // If batch not complete, update worker and commit
            if incomplete_count > 0 {
                sqlx::query(
          "UPDATE workers 
           SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
           WHERE id = $1"
        )
          .bind(worker_id)
          .execute(&mut *tx)
          .await?;
                tx.commit().await?;
                return Ok(None);
            }

            // All siblings are done, convert dict to list using order from wait_steps metadata
            // Read the current outputs dict again to convert it
            let current_outputs_row = sqlx::query(
        "SELECT outputs FROM execution_step_outputs WHERE execution_id = $1 AND step_key = $2",
      )
      .bind(parent_id)
      .bind(&step_key_value)
      .fetch_one(&mut *tx)
      .await?;

            let current_outputs: serde_json::Value = current_outputs_row.get("outputs");
            let outputs_dict = current_outputs.as_object().unwrap();

            // Build ordered list using metadata execution_ids order (keep Rust logic for safety)
            let mut ordered_list = Vec::new();
            if let Some(metadata_json) = wait_metadata {
                if let Some(execution_ids_array) = metadata_json
                    .get("execution_ids")
                    .and_then(|v| v.as_array())
                {
                    // Use order from metadata
                    for exec_id_value in execution_ids_array {
                        if let Some(exec_id_str) = exec_id_value.as_str() {
                            if let Some(entry) = outputs_dict.get(exec_id_str) {
                                ordered_list.push(entry.clone());
                            }
                        }
                    }
                }
            }

            // Update execution_step_outputs to use list instead of dict
            let final_outputs = serde_json::Value::Array(ordered_list);

            sqlx::query(
        "UPDATE execution_step_outputs SET outputs = $1 WHERE execution_id = $2 AND step_key = $3",
      )
      .bind(Some(final_outputs))
      .bind(parent_id)
      .bind(&step_key_value)
      .execute(&mut *tx)
      .await?;
        }
        // Both batch and non-batch cases fall through here if all siblings are done

        // Atomic wait_step clearing and parent resume (if waiting)
        // Also return deployment_id if parent was resumed
        let parent_resumed_row = sqlx::query(
            "WITH cleared_wait AS (
          UPDATE wait_steps 
          SET wait_type = NULL, wait_until = NULL 
          WHERE execution_id = $1 AND step_key = $2 AND wait_type = 'subworkflow'
          RETURNING 1
        )
        UPDATE workflow_executions
        SET status = 'queued', queued_at = NOW()
        WHERE id = $1 AND status = 'waiting'
        AND EXISTS(SELECT 1 FROM cleared_wait)
        RETURNING deployment_id",
        )
        .bind(parent_id)
        .bind(step_key_value)
        .fetch_optional(&mut *tx)
        .await?;

        // Update worker status and decrement execution count
        sqlx::query(
      "UPDATE workers 
        SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
        WHERE id = $1"
    )
    .bind(worker_id)
    .execute(&mut *tx)
    .await?;

        tx.commit().await?;

        // Return parent_id and deployment_id if parent was resumed and deployment_id is present (for dispatch)
        // deployment_id should always be present, but handle gracefully if it's missing
        if let Some(row) = parent_resumed_row {
            if let Some(deployment_id) = row.get::<Option<String>, _>("deployment_id") {
                Ok(Some((parent_id, deployment_id)))
            } else {
                tracing::warn!(
                    "[db.complete_execution] Parent {} was resumed but deployment_id is missing",
                    parent_id
                );
                Ok(None)
            }
        } else {
            Ok(None)
        }
    }

    pub async fn fail_execution(
        &self,
        execution_id: &Uuid,
        error: &str,
        max_retries: i32,
        worker_id: &Uuid,
        final_state: Option<serde_json::Value>,
    ) -> anyhow::Result<(bool, Option<(Uuid, String)>)> {
        let mut tx = self.pool.begin().await?;

        // Combine SELECT with UPDATE using RETURNING to get metadata in one query
        let exec_row = sqlx::query(
      "UPDATE workflow_executions 
       SET retry_count = retry_count + 1
       WHERE id = $1
       RETURNING retry_count, parent_execution_id, root_execution_id, workflow_id, step_key, batch_id, project_id"
    )
      .bind(execution_id)
      .fetch_optional(&mut *tx)
      .await?;

        let Some(exec_row) = exec_row else {
            return Err(anyhow::anyhow!("Execution not found"));
        };

        let current_retry_count: i32 = exec_row.get("retry_count");
        let parent_execution_id: Option<Uuid> = exec_row.get("parent_execution_id");
        let workflow_id: String = exec_row.get("workflow_id");
        let step_key: Option<String> = exec_row.get("step_key");
        let batch_id: Option<Uuid> = exec_row.get("batch_id");
        let project_id: Uuid = exec_row.get("project_id");

        // Check if we should retry
        let should_retry = current_retry_count <= max_retries;

        // Convert error string to JSON for storage
        let error_json = serde_json::json!({ "message": error });

        if should_retry {
            // Update status to queued for retry
            sqlx::query(
        "UPDATE workflow_executions SET status = $1, error = $2, assigned_to_worker = NULL, assigned_at = NULL, queued_at = NOW() WHERE id = $3",
      )
      .bind("queued")
      .bind(error)
      .bind(execution_id)
      .execute(&mut *tx)
      .await?;

            // Update worker status and decrement execution count
            sqlx::query(
        "UPDATE workers 
          SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
          WHERE id = $1"
      )
      .bind(worker_id)
      .execute(&mut *tx)
      .await?;

            tx.commit().await?;
            return Ok((true, None)); // Will retry
        }

        // Early return if no parent - update worker and commit
        let Some(parent_id) = parent_execution_id else {
            sqlx::query(
        "UPDATE workflow_executions SET status = $1, error = $2, completed_at = $3, final_state = $4 WHERE id = $5"
      )
        .bind("failed")
        .bind(error)
        .bind(Utc::now())
        .bind(final_state.as_ref())
        .bind(execution_id)
        .execute(&mut *tx)
        .await?;

            sqlx::query(
        "UPDATE workers 
         SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
         WHERE id = $1"
      )
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
            tx.commit().await?;
            return Ok((false, None));
        };

        // Early return if no step_key - update worker and commit
        let Some(step_key_value) = step_key else {
            sqlx::query(
        "UPDATE workflow_executions SET status = $1, error = $2, completed_at = $3, final_state = $4 WHERE id = $5"
      )
        .bind("failed")
        .bind(error)
        .bind(Utc::now())
        .bind(final_state.as_ref())
        .bind(execution_id)
        .execute(&mut *tx)
        .await?;

            sqlx::query(
        "UPDATE workers 
         SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
         WHERE id = $1"
      )
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
            tx.commit().await?;
            return Ok((false, None));
        };

        // Acquire advisory lock on parent_execution_id to prevent race conditions
        let lock_key = parent_id.as_u128() as i64;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(lock_key)
            .execute(&mut *tx)
            .await?;

        // Mark as failed (no retry or exceeded limit)
        sqlx::query(
      "UPDATE workflow_executions SET status = $1, error = $2, completed_at = $3, final_state = $4 WHERE id = $5",
    )
      .bind("failed")
      .bind(error)
      .bind(Utc::now())
      .bind(final_state.as_ref())
      .bind(execution_id)
      .execute(&mut *tx)
      .await?;

        // Handle batch vs non-batch cases
        if batch_id.is_none() {
            // (a) If batch_id is null, store output as-is (no dict, no merge)
            sqlx::query(
        "INSERT INTO execution_step_outputs (execution_id, step_key, outputs, error, success, source_execution_id, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (execution_id, step_key) DO UPDATE
         SET outputs = $3, error = $4, success = $5, source_execution_id = $6"
      )
        .bind(parent_id)
        .bind(&step_key_value)
        .bind(None::<serde_json::Value>)  // No outputs for failed execution
        .bind(Some(error_json))
        .bind(Some(false))
        .bind(execution_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
        } else {
            // (b) If batch_id is not null, create/add to existing dict keyed by execution_id
            // Read existing outputs
            let existing_row = sqlx::query(
        "SELECT outputs FROM execution_step_outputs WHERE execution_id = $1 AND step_key = $2",
      )
      .bind(parent_id)
      .bind(&step_key_value)
      .fetch_optional(&mut *tx)
      .await?;

            // Parse existing outputs as a dict, or create empty dict if null
            let mut outputs_dict: serde_json::Map<String, serde_json::Value> =
                if let Some(row) = existing_row {
                    if let Ok(Some(outputs_json)) =
                        row.try_get::<Option<serde_json::Value>, _>("outputs")
                    {
                        if outputs_json.is_object() {
                            outputs_json.as_object().unwrap().clone()
                        } else {
                            serde_json::Map::new()
                        }
                    } else {
                        serde_json::Map::new()
                    }
                } else {
                    serde_json::Map::new()
                };

            // Add/update entry for this execution_id
            let execution_id_str = execution_id.to_string();
            outputs_dict.insert(
                execution_id_str,
                serde_json::json!({
                  "workflow_id": workflow_id,
                  "success": false,
                  "error": error
                }),
            );

            // Convert back to JSONB for storage
            let merged_outputs = serde_json::Value::Object(outputs_dict);

            // Insert or update with merged outputs (still as dict)
            sqlx::query(
        "INSERT INTO execution_step_outputs (execution_id, step_key, outputs, error, success, source_execution_id, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (execution_id, step_key) DO UPDATE
         SET outputs = $3, error = $4, success = $5, source_execution_id = $6"
      )
        .bind(parent_id)
        .bind(&step_key_value)
        .bind(Some(merged_outputs))
        .bind(Some(error_json))
        .bind(Some(false))
        .bind(execution_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;

            // Combine batch completion check and wait_metadata fetch in one query
            let Some(batch_uuid) = batch_id else {
                // This should never happen since we're in the else branch of `if batch_id.is_none()`
                return Err(anyhow::anyhow!(
                    "batch_id is None in batch processing branch"
                ));
            };
            let batch_complete_row = sqlx::query(
        "SELECT 
          (SELECT COUNT(*) FILTER (WHERE status NOT IN ('completed', 'failed')) 
           FROM workflow_executions WHERE batch_id = $1) as incomplete_count,
          (SELECT metadata FROM wait_steps WHERE execution_id = $2 AND step_key = $3) as wait_metadata"
      )
        .bind(batch_uuid)
        .bind(parent_id)
        .bind(&step_key_value)
        .fetch_one(&mut *tx)
        .await?;

            let incomplete_count: i64 = batch_complete_row.get("incomplete_count");
            let wait_metadata: Option<serde_json::Value> = batch_complete_row.get("wait_metadata");

            // If batch not complete, update worker and commit
            if incomplete_count > 0 {
                sqlx::query(
          "UPDATE workers 
           SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
           WHERE id = $1"
        )
          .bind(worker_id)
          .execute(&mut *tx)
          .await?;
                tx.commit().await?;
                return Ok((false, None));
            }

            // All siblings are done, convert dict to list using order from wait_steps metadata
            // Read the current outputs dict again to convert it
            let current_outputs_row = sqlx::query(
        "SELECT outputs FROM execution_step_outputs WHERE execution_id = $1 AND step_key = $2",
      )
      .bind(parent_id)
      .bind(&step_key_value)
      .fetch_one(&mut *tx)
      .await?;

            let current_outputs: serde_json::Value = current_outputs_row.get("outputs");
            let outputs_dict = current_outputs.as_object().unwrap();

            // Build ordered list using metadata execution_ids order (keep Rust logic for safety)
            let mut ordered_list = Vec::new();
            if let Some(metadata_json) = wait_metadata {
                if let Some(execution_ids_array) = metadata_json
                    .get("execution_ids")
                    .and_then(|v| v.as_array())
                {
                    // Use order from metadata
                    for exec_id_value in execution_ids_array {
                        if let Some(exec_id_str) = exec_id_value.as_str() {
                            if let Some(entry) = outputs_dict.get(exec_id_str) {
                                ordered_list.push(entry.clone());
                            }
                        }
                    }
                }
            }

            // Update execution_step_outputs to use list instead of dict
            let final_outputs = serde_json::Value::Array(ordered_list);

            sqlx::query(
        "UPDATE execution_step_outputs SET outputs = $1 WHERE execution_id = $2 AND step_key = $3",
      )
      .bind(Some(final_outputs))
      .bind(parent_id)
      .bind(&step_key_value)
      .execute(&mut *tx)
      .await?;
        }
        // Both batch and non-batch cases fall through here if all siblings are done

        // Atomic wait_step clearing and parent resume (if waiting)
        // Also return deployment_id if parent was resumed
        let parent_resumed_row = sqlx::query(
            "WITH cleared_wait AS (
           UPDATE wait_steps 
           SET wait_type = NULL, wait_until = NULL 
           WHERE execution_id = $1 AND step_key = $2 AND wait_type = 'subworkflow'
           RETURNING 1
         )
         UPDATE workflow_executions
         SET status = 'queued', queued_at = NOW()
         WHERE id = $1 AND status = 'waiting'
         AND EXISTS(SELECT 1 FROM cleared_wait)
         RETURNING deployment_id",
        )
        .bind(parent_id)
        .bind(&step_key_value)
        .fetch_optional(&mut *tx)
        .await?;

        // Update worker status and decrement execution count
        sqlx::query(
      "UPDATE workers 
        SET status = 'online', current_execution_count = GREATEST(0, current_execution_count - 1), last_heartbeat = NOW()
        WHERE id = $1"
    )
    .bind(worker_id)
    .execute(&mut *tx)
    .await?;

        tx.commit().await?;

        // Return retry status and parent resume info (if parent was resumed and deployment_id is present)
        // deployment_id should always be present, but handle gracefully if it's missing
        let parent_resume_info = if let Some(row) = parent_resumed_row {
            if let Some(deployment_id) = row.get::<Option<String>, _>("deployment_id") {
                Some((parent_id, deployment_id))
            } else {
                tracing::warn!(
                    "[db.fail_execution] Parent {} was resumed but deployment_id is missing",
                    parent_id
                );
                None
            }
        } else {
            None
        };

        Ok((false, parent_resume_info)) // Will not retry
    }

    pub async fn cancel_execution(
        &self,
        execution_id: &Uuid,
        cancelled_by: &str,
    ) -> anyhow::Result<Vec<(Uuid, Option<Uuid>, Option<String>)>> {
        // Returns Vec<(execution_id, worker_id, push_endpoint_url)> for all executions being cancelled (root + all children)
        let mut tx = self.pool.begin().await?;

        // Set admin mode for cancellation
        sqlx::query("SET LOCAL app.is_admin = 'true'")
            .execute(&mut *tx)
            .await?;

        // Get execution status
        let row = sqlx::query("SELECT status FROM workflow_executions WHERE id = $1 FOR UPDATE")
            .bind(execution_id)
            .fetch_optional(&mut *tx)
            .await?;

        let Some(row) = row else {
            tx.rollback().await?;
            return Err(anyhow::anyhow!("Execution not found"));
        };

        let status: String = row.get("status");

        // Only allow cancellation of queued, running, waiting, or claimed executions
        if !matches!(
            status.as_str(),
            "queued" | "running" | "waiting" | "claimed" | "pending_cancel"
        ) {
            tx.rollback().await?;
            return Err(anyhow::anyhow!(
                "Execution cannot be cancelled (status: {})",
                status
            ));
        }

        // Recursively find all child executions and parent executions (using recursive CTE)
        // Update target execution, all children, and all parents to pending_cancel
        // Clear wait_steps for all executions being cancelled
        // Get worker info for all executions
        let rows = sqlx::query(
      "WITH RECURSIVE children_tree AS (
         -- Start with the target execution
         SELECT id, parent_execution_id, 0 as depth
         FROM workflow_executions
         WHERE id = $1
         
         UNION ALL
         
         -- Recursively find all children (going down)
         SELECT e.id, e.parent_execution_id, ct.depth + 1
         FROM workflow_executions e
         INNER JOIN children_tree ct ON e.parent_execution_id = ct.id
         WHERE ct.depth < 100  -- Safety limit
       ),
       parents_tree AS (
         -- Start with the target execution to get its parent
         SELECT id, parent_execution_id, 0 as depth
         FROM workflow_executions
         WHERE id = $1
         
         UNION ALL
         
         -- Recursively find all parents (going up)
         -- Find the execution that is the parent of the current level
         SELECT e.id, e.parent_execution_id, pt.depth + 1
         FROM workflow_executions e
         INNER JOIN parents_tree pt ON e.id = pt.parent_execution_id
         WHERE pt.parent_execution_id IS NOT NULL
           AND pt.depth < 100  -- Safety limit
       ),
       execution_tree AS (
         -- Union children and parents (the target execution appears in both, so use UNION to deduplicate)
         SELECT id, parent_execution_id, depth FROM children_tree
         UNION
         SELECT id, parent_execution_id, depth FROM parents_tree
       ),
       updated_executions AS (
         -- Mark all executions in tree as pending_cancel
         UPDATE workflow_executions
         SET status = 'pending_cancel',
             cancelled_at = NOW(),
             cancelled_by = $2
         WHERE id IN (SELECT id FROM execution_tree)
           AND status IN ('queued', 'running', 'waiting', 'claimed', 'pending_cancel')
         RETURNING id
       ),
       cleared_waits AS (
         -- Clear wait_steps for all executions being cancelled
         UPDATE wait_steps
         SET wait_type = NULL, wait_until = NULL
         WHERE execution_id IN (SELECT id FROM execution_tree)
         RETURNING 1
       )
       -- Get worker info for all executions being cancelled
       SELECT e.id, e.assigned_to_worker, w.push_endpoint_url
       FROM execution_tree et
       INNER JOIN workflow_executions e ON et.id = e.id
       LEFT JOIN workers w ON e.assigned_to_worker = w.id
       WHERE e.id IN (SELECT id FROM updated_executions)
       ORDER BY e.id"
    )
    .bind(execution_id)
    .bind(cancelled_by)
    .fetch_all(&mut *tx)
    .await?;

        tx.commit().await?;

        // Build result vector
        let mut result = Vec::new();
        for row in rows {
            let exec_id: Uuid = row.get("id");
            let worker_id: Option<Uuid> = row.get("assigned_to_worker");
            let push_endpoint_url: Option<String> = row.get("push_endpoint_url");
            result.push((exec_id, worker_id, push_endpoint_url));
        }

        Ok(result)
    }

    pub async fn get_timed_out_executions(
        &self,
        limit: i64,
    ) -> anyhow::Result<Vec<(Uuid, Option<Uuid>, Option<String>)>> {
        // Returns Vec<(execution_id, assigned_to_worker, push_endpoint_url)>
        // Only processes one at a time using FOR UPDATE SKIP LOCKED
        let mut tx = self.pool.begin().await?;

        // Set admin mode
        sqlx::query("SET LOCAL app.is_admin = 'true'")
            .execute(&mut *tx)
            .await?;

        let rows = sqlx::query(
            "SELECT e.id, e.assigned_to_worker, w.push_endpoint_url
       FROM workflow_executions e
       LEFT JOIN workers w ON e.assigned_to_worker = w.id
       WHERE e.status = 'running'
         AND e.cancelled_at IS NULL
         AND e.started_at IS NOT NULL
         AND e.run_timeout_seconds IS NOT NULL
         AND (e.started_at + INTERVAL '1 second' * e.run_timeout_seconds) < NOW()
       ORDER BY e.started_at ASC
       LIMIT $1
       FOR UPDATE OF e SKIP LOCKED",
        )
        .bind(limit)
        .fetch_all(&mut *tx)
        .await?;

        tx.commit().await?;

        let mut results = Vec::new();
        for row in rows {
            let execution_id: Uuid = row.get("id");
            let assigned_to_worker: Option<Uuid> = row.get("assigned_to_worker");
            let push_endpoint_url: Option<String> = row.get("push_endpoint_url");
            results.push((execution_id, assigned_to_worker, push_endpoint_url));
        }

        Ok(results)
    }

    pub async fn get_pending_cancel_executions(
        &self,
        limit: i64,
    ) -> anyhow::Result<
        Vec<(
            Uuid,
            Option<Uuid>,
            Option<String>,
            Option<chrono::DateTime<chrono::Utc>>,
        )>,
    > {
        // Returns Vec<(execution_id, assigned_to_worker, push_endpoint_url, cancelled_at)>
        // Only processes one at a time using FOR UPDATE SKIP LOCKED
        let mut tx = self.pool.begin().await?;

        // Set admin mode
        sqlx::query("SET LOCAL app.is_admin = 'true'")
            .execute(&mut *tx)
            .await?;

        let rows = sqlx::query(
            "SELECT e.id, e.assigned_to_worker, w.push_endpoint_url, e.cancelled_at
       FROM workflow_executions e
       LEFT JOIN workers w ON e.assigned_to_worker = w.id
       WHERE e.status = 'pending_cancel'
       ORDER BY e.cancelled_at ASC NULLS FIRST
       LIMIT $1
       FOR UPDATE OF e SKIP LOCKED",
        )
        .bind(limit)
        .fetch_all(&mut *tx)
        .await?;

        tx.commit().await?;

        let mut results = Vec::new();
        for row in rows {
            let execution_id: Uuid = row.get("id");
            let assigned_to_worker: Option<Uuid> = row.get("assigned_to_worker");
            let push_endpoint_url: Option<String> = row.get("push_endpoint_url");
            let cancelled_at: Option<chrono::DateTime<chrono::Utc>> = row.get("cancelled_at");
            results.push((
                execution_id,
                assigned_to_worker,
                push_endpoint_url,
                cancelled_at,
            ));
        }

        Ok(results)
    }

    pub async fn mark_execution_cancelled(&self, execution_id: &Uuid) -> anyhow::Result<()> {
        // Mark execution as cancelled (called when worker confirms cancellation)
        // Allows cancellation if:
        // 1. Status is 'pending_cancel', OR
        // 2. Execution has timed out (started_at + run_timeout_seconds < NOW())
        let mut tx = self.pool.begin().await?;

        // Set admin mode
        sqlx::query("SET LOCAL app.is_admin = 'true'")
            .execute(&mut *tx)
            .await?;

        sqlx::query(
            "UPDATE workflow_executions
       SET status = 'cancelled', 
           assigned_to_worker = NULL,
           cancelled_at = COALESCE(cancelled_at, NOW())
       WHERE id = $1 
         AND (
           status = 'pending_cancel'
           OR (
             status = 'running'
             AND started_at IS NOT NULL
             AND run_timeout_seconds IS NOT NULL
             AND (started_at + INTERVAL '1 second' * run_timeout_seconds) < NOW()
           )
         )",
        )
        .bind(execution_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn cleanup_old_executions(&self, retention_days: i32) -> anyhow::Result<u64> {
        let mut tx = self.pool.begin().await?;

        // Set admin access for background workflow (operates across all projects)
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *tx)
            .await?;

        let mut total_deleted = 0u64;

        // Delete execution_step_outputs for root executions and all their descendants
        let result = sqlx::query(
            "WITH roots_to_delete AS (
        SELECT id FROM workflow_executions
        WHERE parent_execution_id IS NULL
        AND status IN ('completed', 'failed')
        AND completed_at < NOW() - INTERVAL '1 day' * $1
      ),
      all_to_delete AS (
        SELECT id FROM workflow_executions
        WHERE root_execution_id IN (SELECT id FROM roots_to_delete)
        UNION
        SELECT id FROM roots_to_delete
      )
      DELETE FROM execution_step_outputs
      WHERE execution_id IN (SELECT id FROM all_to_delete)",
        )
        .bind(retention_days)
        .execute(&mut *tx)
        .await?;
        total_deleted += result.rows_affected();

        // Delete wait_steps for root executions and all their descendants
        let result = sqlx::query(
            "WITH roots_to_delete AS (
        SELECT id FROM workflow_executions
        WHERE parent_execution_id IS NULL
        AND status IN ('completed', 'failed')
        AND completed_at < NOW() - INTERVAL '1 day' * $1
      ),
      all_to_delete AS (
        SELECT id FROM workflow_executions
        WHERE root_execution_id IN (SELECT id FROM roots_to_delete)
        UNION
        SELECT id FROM roots_to_delete
      )
      DELETE FROM wait_steps
      WHERE execution_id IN (SELECT id FROM all_to_delete)",
        )
        .bind(retention_days)
        .execute(&mut *tx)
        .await?;
        total_deleted += result.rows_affected();

        // Delete executions (root and all descendants)
        let result = sqlx::query(
            "WITH roots_to_delete AS (
        SELECT id FROM workflow_executions
        WHERE parent_execution_id IS NULL
        AND status IN ('completed', 'failed')
        AND completed_at < NOW() - INTERVAL '1 day' * $1
      ),
      all_to_delete AS (
        SELECT id FROM workflow_executions
        WHERE root_execution_id IN (SELECT id FROM roots_to_delete)
        UNION
        SELECT id FROM roots_to_delete
      )
      DELETE FROM workflow_executions
      WHERE id IN (SELECT id FROM all_to_delete)",
        )
        .bind(retention_days)
        .execute(&mut *tx)
        .await?;
        total_deleted += result.rows_affected();

        tx.commit().await?;
        Ok(total_deleted)
    }

    // ==================== Slack Apps ====================

    /// Look up the project_id for a Slack app by its api_app_id.
    pub async fn get_slack_app(&self, api_app_id: &str) -> anyhow::Result<Option<Uuid>> {
        let row = sqlx::query("SELECT project_id FROM slack_apps WHERE api_app_id = $1")
            .bind(api_app_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|r| r.get("project_id")))
    }

    /// Register or update a Slack app → project binding.
    pub async fn upsert_slack_app(
        &self,
        api_app_id: &str,
        project_id: &Uuid,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO slack_apps (api_app_id, project_id) VALUES ($1, $2)
             ON CONFLICT (api_app_id) DO UPDATE SET project_id = EXCLUDED.project_id",
        )
        .bind(api_app_id)
        .bind(project_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Find the most recent execution for a given Slack channel + thread.
    pub async fn get_execution_by_channel_thread(
        &self,
        channel: &str,
        thread_ts: &str,
    ) -> anyhow::Result<Option<Execution>> {
        let row = sqlx::query(
            "SELECT id, workflow_id, status, payload, result, error, created_at, started_at, completed_at, deployment_id, assigned_to_worker, parent_execution_id, root_execution_id, retry_count, step_key, queue_name, concurrency_key, batch_id, session_id, user_id, output_schema_name, otel_traceparent, otel_span_id, claimed_at, queued_at, initial_state, final_state, run_timeout_seconds, cancelled_at, cancelled_by, channel_context
             FROM workflow_executions
             WHERE channel_context->'source'->>'channel' = $1
               AND channel_context->'source'->>'threadTs' = $2
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(channel)
        .bind(thread_ts)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| Execution {
            id: row.get("id"),
            workflow_id: row.get("workflow_id"),
            status: row.get("status"),
            payload: row.get("payload"),
            result: row.get("result"),
            error: row.get("error"),
            created_at: row.get("created_at"),
            started_at: row.get("started_at"),
            completed_at: row.get("completed_at"),
            deployment_id: row.get("deployment_id"),
            assigned_to_worker: row.get("assigned_to_worker"),
            parent_execution_id: row.get("parent_execution_id"),
            root_execution_id: row.get("root_execution_id"),
            retry_count: row.get("retry_count"),
            step_key: row.get("step_key"),
            queue_name: row.get("queue_name"),
            concurrency_key: row.get("concurrency_key"),
            batch_id: row.get("batch_id"),
            session_id: row.get("session_id"),
            user_id: row.get("user_id"),
            output_schema_name: row.get("output_schema_name"),
            otel_traceparent: row.get("otel_traceparent"),
            otel_span_id: row.get("otel_span_id"),
            claimed_at: row.get("claimed_at"),
            queued_at: row.get("queued_at"),
            initial_state: row.get("initial_state"),
            final_state: row.get("final_state"),
            run_timeout_seconds: row.get("run_timeout_seconds"),
            cancelled_at: row.get("cancelled_at"),
            cancelled_by: row.get("cancelled_by"),
            root_workflow_id: None,
            channel_context: row.get("channel_context"),
        }))
    }
}
