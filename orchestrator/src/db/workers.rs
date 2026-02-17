use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::{
    models::{Execution, Worker},
    Database,
};

impl Database {
    // Get count of online workers for a deployment
    pub async fn get_worker_count_for_deployment(
        &self,
        project_id: &Uuid,
        deployment_id: &str,
    ) -> anyhow::Result<i64> {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) as count
             FROM workers
             WHERE project_id = $1
               AND current_deployment_id = $2
               AND status = 'online'
               AND last_heartbeat > NOW() - INTERVAL '60 seconds'",
        )
        .bind(project_id)
        .bind(deployment_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(count.0)
    }

    // Worker registration
    #[allow(clippy::too_many_arguments)]
    pub async fn register_worker(
        &self,
        worker_id: &Uuid,
        project_id: &Uuid,
        capabilities: Option<&serde_json::Value>,
        mode: Option<&str>,
        push_endpoint_url: Option<&str>,
        max_concurrent_executions: Option<i32>,
        current_deployment_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let mode_str = mode.unwrap_or("push");
        let max_executions = max_concurrent_executions.unwrap_or(100);

        sqlx::query(
      "INSERT INTO workers (id, project_id, status, last_heartbeat, capabilities, mode, push_endpoint_url, max_concurrent_executions, current_deployment_id) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE 
        SET status = $3, last_heartbeat = $4, capabilities = $5, mode = $6, push_endpoint_url = $7, max_concurrent_executions = $8, current_deployment_id = $9",
    )
    .bind(worker_id)
    .bind(project_id)
    .bind("offline")
    .bind(Utc::now())
    .bind(capabilities)
    .bind(mode_str)
    .bind(push_endpoint_url)
    .bind(max_executions)
    .bind(current_deployment_id)
    .execute(&self.pool)
    .await?;

        Ok(())
    }

    // Update worker heartbeat and reconcile execution count
    pub async fn update_worker_heartbeat(&self, worker_id: &Uuid) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE workers
             SET last_heartbeat = $1,
                 current_execution_count = (
                     SELECT COUNT(*)
                     FROM workflow_executions
                     WHERE assigned_to_worker = $2
                       AND status IN ('claimed', 'running')
                 )
             WHERE id = $2",
        )
        .bind(Utc::now())
        .bind(worker_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // Update worker status
    pub async fn update_worker_status(&self, worker_id: &Uuid, status: &str) -> anyhow::Result<()> {
        sqlx::query("UPDATE workers SET status = $1, last_heartbeat = $2 WHERE id = $3")
            .bind(status)
            .bind(Utc::now())
            .bind(worker_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    // Get next queued executions and assign to worker (batch)
    // Failed executions that should be retried are already set to 'queued' status by fail_execution
    // Only claims executions where queue concurrency limit allows
    // Respects queue concurrency limits when batching
    pub async fn claim_next_executions(
        &self,
        worker_id: &Uuid,
    ) -> anyhow::Result<Option<Execution>> {
        let mut tx = self.pool.begin().await?;
        // Build query to find next available execution
        // Use FOR UPDATE OF e to lock only the executions table row
        let row = sqlx::query(
            "WITH running_counts AS (
        SELECT 
          queue_name,
          deployment_id,
          COALESCE(concurrency_key, '') as concurrency_key,
          COUNT(*) as running_count
        FROM workflow_executions
        WHERE status IN ('claimed', 'running')
        GROUP BY queue_name, deployment_id, COALESCE(concurrency_key, '')
      )
      SELECT e.id, e.workflow_id, e.status, e.payload, e.result, e.error, 
             e.created_at, e.started_at, e.completed_at, 
             e.deployment_id, e.parent_execution_id, e.root_execution_id, 
             e.retry_count, e.step_key, e.queue_name, e.concurrency_key, 
             e.batch_id, e.session_id, e.user_id, e.output_schema_name, 
             e.otel_traceparent, e.otel_span_id, e.initial_state, e.final_state, 
             e.run_timeout_seconds, q.concurrency_limit
      FROM workflow_executions e
      INNER JOIN queues q 
        ON q.name = e.queue_name 
        AND q.deployment_id = e.deployment_id
      LEFT JOIN running_counts rc 
        ON rc.queue_name = e.queue_name 
        AND rc.deployment_id = e.deployment_id
        AND rc.concurrency_key = COALESCE(e.concurrency_key, '')
      WHERE e.status = 'queued'
        AND (
          q.concurrency_limit IS NULL  -- Removed queue_name IS NULL check
          OR COALESCE(rc.running_count, 0) < q.concurrency_limit
        )
      ORDER BY COALESCE(e.queued_at, e.created_at) ASC 
      LIMIT 1 
      FOR UPDATE OF e SKIP LOCKED",
        )
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(row) = row {
            let execution_id: Uuid = row.get("id");

            // Assign to worker AND update status to running
            sqlx::query(
                "UPDATE workflow_executions 
          SET assigned_to_worker = $1, assigned_at = $2, status = $3
          WHERE id = $4",
            )
            .bind(worker_id)
            .bind(Utc::now())
            .bind("running")
            .bind(execution_id)
            .execute(&mut *tx)
            .await?;

            let execution = Execution {
                id: row.get("id"),
                workflow_id: row.get("workflow_id"),
                status: "running".to_string(),
                payload: row.get("payload"),
                result: row.get("result"),
                error: row.get("error"),
                created_at: row.get("created_at"),
                started_at: row.get("started_at"),
                completed_at: row.get("completed_at"),
                deployment_id: row.get("deployment_id"),
                assigned_to_worker: Some(*worker_id),
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
                claimed_at: None,
                queued_at: None,
                initial_state: row.get("initial_state"),
                final_state: row.get("final_state"),
                run_timeout_seconds: row.get("run_timeout_seconds"),
                cancelled_at: None,
                cancelled_by: None,
                root_workflow_id: None,
            };
            tx.commit().await?;
            Ok(Some(execution))
        } else {
            tx.commit().await?;
            Ok(None)
        }
    }

    // Mark execution as running after successful push
    pub async fn mark_execution_running(&self, execution_id: &Uuid) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE workflow_executions
       SET status = 'running', started_at = COALESCE(started_at, NOW())
       WHERE id = $1 AND status = 'claimed'",
        )
        .bind(execution_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // Claim a queued execution and assign it to an available worker in a single transaction
    // Uses SELECT FOR UPDATE SKIP LOCKED to allow multiple orchestrators to work in parallel
    // Returns (Execution, Worker) if successful, None if no execution available
    pub async fn claim_and_assign_execution_for_push(
        &self,
    ) -> anyhow::Result<Option<(Execution, Worker)>> {
        let mut tx = self.pool.begin().await?;

        // Set admin access for background dispatcher (operates across all projects)
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *tx)
            .await?;

        // Get one queued execution with SELECT FOR UPDATE SKIP LOCKED
        // This allows multiple orchestrators to work on different executions in parallel
        // Uses CTEs to efficiently check queue concurrency limits AND worker availability
        // Only selects executions that have at least one available worker for their deployment_id
        let execution_row = sqlx::query(
            "WITH running_counts AS (
        SELECT
          queue_name,
          deployment_id,
          COALESCE(concurrency_key, '') as concurrency_key,
          COUNT(*) as running_count
        FROM workflow_executions
        WHERE status IN ('claimed', 'running')
        GROUP BY queue_name, deployment_id, COALESCE(concurrency_key, '')
      ),
      available_deployments AS (
        -- Get deployment_ids that have at least one available worker
        SELECT DISTINCT current_deployment_id
        FROM workers
        WHERE mode = 'push'
          AND status = 'online'
          AND current_execution_count < max_concurrent_executions
          AND push_failure_count < push_failure_threshold
          AND last_heartbeat > NOW() - INTERVAL '60 seconds'
      )
      SELECT e.id, e.workflow_id, e.status, e.payload, e.result, e.error,
             e.created_at, e.started_at, e.completed_at,
             e.deployment_id, e.parent_execution_id, e.root_execution_id,
             e.retry_count, e.step_key, e.queue_name, e.concurrency_key,
             e.batch_id, e.session_id, e.user_id, e.output_schema_name,
             e.otel_traceparent, e.otel_span_id, e.initial_state, e.final_state,
             e.claimed_at, e.queued_at, e.run_timeout_seconds, q.concurrency_limit
      FROM workflow_executions e
      INNER JOIN queues q
        ON q.name = e.queue_name
        AND q.deployment_id = e.deployment_id
      INNER JOIN available_deployments ad
        ON ad.current_deployment_id = e.deployment_id
      LEFT JOIN running_counts rc
        ON rc.queue_name = e.queue_name
        AND rc.deployment_id = e.deployment_id
        AND rc.concurrency_key = COALESCE(e.concurrency_key, '')
      WHERE e.status = 'queued'
        AND (
          q.concurrency_limit IS NULL
          OR COALESCE(rc.running_count, 0) < q.concurrency_limit
        )
      ORDER BY COALESCE(e.queued_at, e.created_at) ASC
      LIMIT 1
      FOR UPDATE OF e SKIP LOCKED",
        )
        .fetch_optional(&mut *tx)
        .await?;

        let execution_row = match execution_row {
            Some(row) => row,
            None => {
                tx.rollback().await?;
                return Ok(None);
            }
        };

        let execution_id: Uuid = execution_row.get("id");
        let deployment_id: String = execution_row.get("deployment_id");

        let result = sqlx::query(
            r#"
      WITH available_worker AS (
        -- Find and lock one available worker (SKIP LOCKED allows parallel processing)
        SELECT id, status, last_heartbeat, capabilities, current_deployment_id, created_at,
               mode, push_endpoint_url, max_concurrent_executions, current_execution_count,
               last_push_attempt_at, push_failure_count, push_failure_threshold
        FROM workers
        WHERE mode = 'push'
          AND status = 'online'
          AND current_deployment_id = $1
          AND current_execution_count < max_concurrent_executions
          AND push_failure_count < push_failure_threshold
          AND last_heartbeat > NOW() - INTERVAL '60 seconds'
        ORDER BY current_execution_count, last_push_attempt_at NULLS FIRST, push_failure_count
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ),
      updated_execution AS (
        -- Claim execution (only if still queued and worker is available)
        UPDATE workflow_executions
        SET status = 'claimed', 
            assigned_to_worker = (SELECT id FROM available_worker),
            assigned_at = NOW(), 
            claimed_at = NOW()
        WHERE id = $2 
          AND status = 'queued'
          AND EXISTS (SELECT 1 FROM available_worker)
        RETURNING *
      ),
      updated_worker AS (
        -- Increment worker execution count and update push status
        UPDATE workers
        SET current_execution_count = current_execution_count + 1,
            last_push_attempt_at = NOW()
        WHERE id = (SELECT id FROM available_worker)
          AND EXISTS (SELECT 1 FROM updated_execution)
        RETURNING *
      )
      SELECT
        -- Execution fields
        e.id as exec_id, e.workflow_id, e.status as exec_status, e.payload, e.result, e.error,
        e.created_at as exec_created_at, e.started_at, e.completed_at,
        e.deployment_id, e.parent_execution_id,
        COALESCE(e.root_execution_id, e.id) as root_execution_id,
        e.retry_count, e.step_key, e.queue_name, e.concurrency_key,
        e.batch_id, e.session_id, e.user_id, e.output_schema_name,
        e.otel_traceparent, e.otel_span_id, e.initial_state, e.final_state,
        e.claimed_at, e.queued_at, e.run_timeout_seconds,
        root_exec.workflow_id as root_workflow_id,
        -- Worker fields
        w.id as worker_id, w.status as worker_status, w.last_heartbeat, w.capabilities,
        w.current_deployment_id, w.created_at as worker_created_at,
        w.mode, w.push_endpoint_url, w.max_concurrent_executions,
        w.current_execution_count, w.last_push_attempt_at, w.push_failure_count,
        w.push_failure_threshold
      FROM updated_execution e
      CROSS JOIN updated_worker w
      LEFT JOIN workflow_executions root_exec ON root_exec.id = COALESCE(e.root_execution_id, e.id)
      "#,
        )
        .bind(&deployment_id)
        .bind(execution_id)
        .fetch_optional(&mut *tx)
        .await?;

        match result {
            Some(row) => {
                // Commit transaction after successful assignment
                tx.commit().await?;

                // Build Execution struct
                let execution = Execution {
                    id: row.get("exec_id"),
                    workflow_id: row.get("workflow_id"),
                    status: row.get::<String, _>("exec_status"),
                    payload: row.get("payload"),
                    result: row.get("result"),
                    error: row.get("error"),
                    created_at: row.get("exec_created_at"),
                    started_at: row.get("started_at"),
                    completed_at: row.get("completed_at"),
                    deployment_id: row.get("deployment_id"),
                    assigned_to_worker: Some(row.get("worker_id")),
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
                    initial_state: row.get("initial_state"),
                    final_state: row.get("final_state"),
                    claimed_at: row.get("claimed_at"),
                    queued_at: row.get("queued_at"),
                    run_timeout_seconds: row.get("run_timeout_seconds"),
                    cancelled_at: None,
                    cancelled_by: None,
                    root_workflow_id: row.get("root_workflow_id"),
                };

                // Build Worker struct
                let worker = Worker {
                    id: row.get("worker_id"),
                    status: row.get("worker_status"),
                    last_heartbeat: row.get("last_heartbeat"),
                    capabilities: row.get("capabilities"),
                    current_deployment_id: row.get("current_deployment_id"),
                    created_at: row.get("worker_created_at"),
                    mode: row.get("mode"),
                    push_endpoint_url: row.get("push_endpoint_url"),
                    max_concurrent_executions: row.get("max_concurrent_executions"),
                    current_execution_count: row.get("current_execution_count"),
                    last_push_attempt_at: row.get("last_push_attempt_at"),
                    push_failure_count: row.get("push_failure_count"),
                    push_failure_threshold: row.get("push_failure_threshold"),
                };

                Ok(Some((execution, worker)))
            }
            None => {
                // No available worker found or execution was already claimed
                tx.rollback().await?;
                Ok(None)
            }
        }
    }

    // Mark stale workers as offline
    /// Clean up stale workers and their executions
    /// Performs 3 operations:
    /// 1. Reset executions with status='claimed' and claimed_at > 1 min ago back to queued
    /// 2. Delete workers with status='online' and last_heartbeat > 2 min ago (foreign key sets assigned_to_worker to NULL)
    /// 3. Reset executions with status='running' or 'claimed' and assigned_to_worker IS NULL to queued
    pub async fn cleanup_stale_workers(&self) -> anyhow::Result<(usize, usize, usize, usize)> {
        let mut tx = self.pool.begin().await?;

        // Set admin access for background workflow (operates across all projects)
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *tx)
            .await?;

        // Step 1: Reset stale claimed executions (claimed for more than 1 minute) back to queued
        let stale_claimed_count = sqlx::query(
      "UPDATE workflow_executions 
       SET status = 'queued', assigned_to_worker = NULL, assigned_at = NULL, claimed_at = NULL, queued_at = NOW()
       WHERE status = 'claimed' 
         AND claimed_at IS NOT NULL
         AND claimed_at < NOW() - INTERVAL '1 minute'"
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as usize;

        // Step 2: Delete stale workers (offline but no heartbeat for more than 2 minutes)
        // The foreign key constraint should be set to ON DELETE SET NULL for assigned_to_worker
        let deleted_workers_count = sqlx::query(
            "DELETE FROM workers
       WHERE status = 'offline'
         AND last_heartbeat < NOW() - INTERVAL '2 minutes'",
        )
        .execute(&mut *tx)
        .await?
        .rows_affected() as usize;

        // Step 3: Mark stale workers as offline (online but no heartbeat for more than 2 minutes)
        let marked_offline_workers_count = sqlx::query(
            "UPDATE workers
       SET status = 'offline'
       WHERE status = 'online'
         AND last_heartbeat < NOW() - INTERVAL '2 minutes'",
        )
        .execute(&mut *tx)
        .await?
        .rows_affected() as usize;

        // Step 4: Reset executions with status='running' or 'claimed' and assigned_to_worker IS NULL to queued
        let orphaned_executions_count = sqlx::query(
      "UPDATE workflow_executions 
       SET status = 'queued', assigned_at = NULL, claimed_at = NULL, queued_at = NOW()
       WHERE status IN ('running', 'claimed')
         AND (assigned_to_worker IS NULL OR assigned_to_worker IN (SELECT id FROM workers WHERE status = 'offline'))"
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as usize;

        tx.commit().await?;

        Ok((
            stale_claimed_count,
            deleted_workers_count,
            marked_offline_workers_count,
            orphaned_executions_count,
        ))
    }

    // Reassign executions from an offline worker
    pub async fn reassign_executions_from_worker(&self, worker_id: &Uuid) -> anyhow::Result<usize> {
        let mut tx = self.pool.begin().await?;

        // Reset executions to queued (including 'claimed' status)
        let result = sqlx::query(
      "UPDATE workflow_executions 
      SET status = 'queued', assigned_to_worker = NULL, assigned_at = NULL, claimed_at = NULL, queued_at = NOW()
      WHERE status IN ('running', 'claimed') AND assigned_to_worker = $1"
    )
    .bind(worker_id)
    .execute(&mut *tx)
    .await?;

        let count = result.rows_affected() as usize;

        // Reset worker's current_execution_count
        sqlx::query(
            "UPDATE workers 
      SET current_execution_count = 0
      WHERE id = $1",
        )
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(count)
    }

    // Reassign executions from all offline workers
    pub async fn reassign_executions_from_offline_workers(&self) -> anyhow::Result<usize> {
        // Set admin access for background task (operates across all projects)
        let mut conn = self.pool.acquire().await?;
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *conn)
            .await?;

        // Get all offline workers
        let worker_rows = sqlx::query("SELECT id FROM workers WHERE status = 'offline'")
            .fetch_all(&mut *conn)
            .await?;

        let mut total_reassigned = 0;
        for row in worker_rows {
            let worker_id: Uuid = row.get("id");
            match self.reassign_executions_from_worker(&worker_id).await {
                Ok(count) => {
                    total_reassigned += count;
                    if count > 0 {
                        tracing::info!(
                            "Reassigned {} execution(s) from offline worker {}",
                            count,
                            worker_id
                        );
                    }
                }
                Err(e) => {
                    tracing::error!(
                        "Failed to reassign executions from offline worker {}: {}",
                        worker_id,
                        e
                    );
                }
            }
        }

        Ok(total_reassigned)
    }

    // Reset stale claimed executions (claimed for more than 1 minute) back to queued
    pub async fn reset_stale_claimed_executions(&self) -> anyhow::Result<usize> {
        // Set admin access for background task (operates across all projects)
        let mut conn = self.pool.acquire().await?;
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *conn)
            .await?;

        let result = sqlx::query(
      "UPDATE workflow_executions 
       SET status = 'queued', assigned_to_worker = NULL, assigned_at = NULL, claimed_at = NULL, queued_at = NOW()
       WHERE status = 'claimed' 
         AND claimed_at IS NOT NULL
         AND claimed_at < NOW() - INTERVAL '1 minute'"
    )
    .execute(&mut *conn)
    .await?;

        let count = result.rows_affected() as usize;
        if count > 0 {
            tracing::info!("Reset {} stale claimed execution(s) back to queued", count);
        }

        Ok(count)
    }

    // Check if an execution can be claimed based on queue concurrency limits
    pub async fn can_claim_execution_by_queue_limit(
        &self,
        execution_id: &Uuid,
    ) -> anyhow::Result<bool> {
        // Set admin access for background dispatcher (operates across all projects)
        let mut conn = self.pool.acquire().await?;
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *conn)
            .await?;

        // Get execution's queue info and check concurrency limit
        let result = sqlx::query(
            "WITH running_counts AS (
        SELECT 
          queue_name,
          deployment_id,
          COALESCE(concurrency_key, '') as concurrency_key,
          COUNT(*) as running_count
        FROM workflow_executions
        WHERE status IN ('claimed', 'running')
        GROUP BY queue_name, deployment_id, COALESCE(concurrency_key, '')
      )
      SELECT q.concurrency_limit, COALESCE(rc.running_count, 0) as running_count
      FROM workflow_executions e
      INNER JOIN queues q 
        ON q.name = e.queue_name 
        AND q.deployment_id = e.deployment_id
      LEFT JOIN running_counts rc 
        ON rc.queue_name = e.queue_name 
        AND rc.deployment_id = e.deployment_id
        AND rc.concurrency_key = COALESCE(e.concurrency_key, '')
      WHERE e.id = $1
        AND e.status = 'queued'",
        )
        .bind(execution_id)
        .fetch_optional(&mut *conn)
        .await?;

        match result {
            Some(row) => {
                let concurrency_limit: Option<i32> = row.get("concurrency_limit");
                let running_count: i64 = row.get("running_count");

                // If limit is NULL, allow claiming. Otherwise check if under limit
                Ok(concurrency_limit.is_none()
                    || running_count < concurrency_limit.unwrap_or(0) as i64)
            }
            None => {
                // Execution not found or not in queued status - cannot claim
                Ok(false)
            }
        }
    }

    // Get available push workers for a deployment
    pub async fn get_available_push_workers(
        &self,
        deployment_id: &str,
    ) -> anyhow::Result<Vec<Worker>> {
        // Set admin access for background dispatcher (operates across all projects)
        let mut conn = self.pool.acquire().await?;
        sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
            .execute(&mut *conn)
            .await?;

        let rows = sqlx::query(
            "SELECT id, status, last_heartbeat, capabilities, current_deployment_id, created_at,
              mode, push_endpoint_url, max_concurrent_executions, current_execution_count,
              last_push_attempt_at, push_failure_count, push_failure_threshold
       FROM workers
       WHERE mode = 'push'
         AND status = 'online'
         AND current_deployment_id = $1
         AND current_execution_count < max_concurrent_executions
         AND push_failure_count < push_failure_threshold
         AND last_heartbeat > NOW() - INTERVAL '60 seconds'
       ORDER BY current_execution_count ASC, last_push_attempt_at ASC NULLS FIRST",
        )
        .bind(deployment_id)
        .fetch_all(&mut *conn)
        .await?;

        let workers: Vec<Worker> = rows
            .into_iter()
            .map(|row| Worker {
                id: row.get("id"),
                status: row.get("status"),
                last_heartbeat: row.get("last_heartbeat"),
                capabilities: row.get("capabilities"),
                current_deployment_id: row.get("current_deployment_id"),
                created_at: row.get("created_at"),
                mode: row.get("mode"),
                push_endpoint_url: row.get("push_endpoint_url"),
                max_concurrent_executions: row.get("max_concurrent_executions"),
                current_execution_count: row.get("current_execution_count"),
                last_push_attempt_at: row.get("last_push_attempt_at"),
                push_failure_count: row.get("push_failure_count"),
                push_failure_threshold: row.get("push_failure_threshold"),
            })
            .collect();

        Ok(workers)
    }

    // Increment worker execution count
    pub async fn increment_worker_execution_count(&self, worker_id: &Uuid) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE workers 
      SET current_execution_count = current_execution_count + 1
      WHERE id = $1",
        )
        .bind(worker_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // Decrement worker execution count
    pub async fn decrement_worker_execution_count(&self, worker_id: &Uuid) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE workers 
      SET current_execution_count = GREATEST(0, current_execution_count - 1)
      WHERE id = $1",
        )
        .bind(worker_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // Update worker push status (success or failure)
    pub async fn update_worker_push_status(
        &self,
        worker_id: &Uuid,
        success: bool,
    ) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;

        if success {
            sqlx::query(
                "UPDATE workers 
        SET push_failure_count = 0, last_push_attempt_at = NOW()
        WHERE id = $1",
            )
            .bind(worker_id)
            .execute(&mut *tx)
            .await?;
        } else {
            // Increment failure count and check threshold in a single transaction
            let (new_failure_count, threshold): (i32, i32) = sqlx::query_as(
                "UPDATE workers 
        SET push_failure_count = push_failure_count + 1, last_push_attempt_at = NOW()
        WHERE id = $1
        RETURNING push_failure_count, push_failure_threshold",
            )
            .bind(worker_id)
            .fetch_one(&mut *tx)
            .await?;

            // If threshold reached, mark as offline and reassign executions
            if new_failure_count >= threshold {
                sqlx::query(
          "UPDATE workers SET status = 'offline', current_execution_count = 0 WHERE id = $1",
        )
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;

                // Reassign executions within the same transaction
                // Reset executions to queued (including 'claimed' status)
                sqlx::query(
          "UPDATE workflow_executions 
          SET status = 'queued', assigned_to_worker = NULL, assigned_at = NULL, claimed_at = NULL, queued_at = NOW()
          WHERE status IN ('running', 'claimed') AND assigned_to_worker = $1"
        )
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    // Validate worker assignment for an execution
    pub async fn validate_worker_assignment(
        &self,
        execution_id: &Uuid,
        worker_id: &Uuid,
    ) -> anyhow::Result<bool> {
        let assigned_worker: Option<Uuid> =
            sqlx::query_scalar("SELECT assigned_to_worker FROM workflow_executions WHERE id = $1")
                .bind(execution_id)
                .fetch_optional(&self.pool)
                .await?;

        Ok(assigned_worker == Some(*worker_id))
    }

    /// Get worker status and push failure info for recovery check
    #[allow(clippy::type_complexity)]
    pub async fn get_worker_recovery_info(
        &self,
        worker_id: &Uuid,
    ) -> anyhow::Result<Option<(String, Option<i32>, Option<i32>, Option<DateTime<Utc>>)>> {
        let result: Option<(String, Option<i32>, Option<i32>, Option<DateTime<Utc>>)> =
            sqlx::query_as(
                "SELECT status, push_failure_count, push_failure_threshold, last_push_attempt_at 
       FROM workers 
       WHERE id = $1",
            )
            .bind(worker_id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(result)
    }

    /// Mark worker as online and reset push failure counts (recovery)
    pub async fn mark_worker_online_and_reset_failures(
        &self,
        worker_id: &Uuid,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE workers 
       SET status = 'online', push_failure_count = 0, last_heartbeat = $1
       WHERE id = $2",
        )
        .bind(Utc::now())
        .bind(worker_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // Rollback execution assignment and update worker in a single transaction
    pub async fn rollback_execution_assignment(
        &self,
        execution_id: &Uuid,
        worker_id: &Uuid,
        error: Option<&crate::api::workers::handlers::PushError>,
    ) -> anyhow::Result<()> {
        // Decrement worker execution count
        self.decrement_worker_execution_count(worker_id).await?;

        // Update push status only if error is not Overloaded
        if let Some(err) = error {
            if !matches!(err, crate::api::workers::handlers::PushError::Overloaded) {
                self.update_worker_push_status(worker_id, false).await?;
            }
        } else {
            // No error provided, update push status as failure
            self.update_worker_push_status(worker_id, false).await?;
        }

        // Reset execution to queued (from executions module)
        self.reset_execution_for_retry(execution_id).await?;

        Ok(())
    }
}
