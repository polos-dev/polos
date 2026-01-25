// Schedule-related database operations
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::{models::Schedule, Database};

impl Database {
  pub async fn create_or_update_schedule(
    &self,
    workflow_id: &str,
    cron: &str,
    timezone: &str,
    key: &str,
    project_id: &Uuid,
  ) -> anyhow::Result<Uuid> {
    use cron::Schedule;

    // Validate cron expression doesn't have sub-minute granularity
    let parts: Vec<&str> = cron.split_whitespace().collect();
    if parts.len() > 5 {
      return Err(anyhow::anyhow!("Sub-minute granularity not supported. Cron expression must have 5 fields (minute hour day month weekday), not 6 (second minute hour day month weekday)"));
    }
    if parts.len() != 5 {
      return Err(anyhow::anyhow!(
        "Invalid cron expression. Must have 5 fields: minute hour day month weekday"
      ));
    }

    // Parse cron expression to validate it
    use std::str::FromStr;
    let cron_with_seconds = format!("0 {}", cron);
    let schedule = Schedule::from_str(&cron_with_seconds)
      .map_err(|e| anyhow::anyhow!("Invalid cron expression '{}': {}", cron, e))?;

    // Calculate next run time
    let tz: chrono_tz::Tz = timezone
      .parse()
      .map_err(|_| anyhow::anyhow!("Invalid timezone: {}", timezone))?;

    let now_utc = Utc::now();
    let now_tz = now_utc.with_timezone(&tz);

    // Get next scheduled time
    let next_run_at = schedule
      .after(&now_tz)
      .next()
      .ok_or_else(|| anyhow::anyhow!("Could not calculate next run time"))?
      .with_timezone(&Utc);

    // Get deployment_id from latest deployment_workflows entry for this workflow
    let deployment_row = sqlx::query(
      "SELECT deployment_id FROM deployment_workflows 
       WHERE workflow_id = $1 AND scheduled = TRUE
       ORDER BY created_at DESC
       LIMIT 1",
    )
    .bind(workflow_id)
    .fetch_optional(&self.pool)
    .await?;

    if let Some(deployment_row) = deployment_row {
      let deployment_id: String = deployment_row.get("deployment_id");

      // Create or get queue with concurrency=1
      sqlx::query(
        "INSERT INTO queues (name, deployment_id, concurrency_limit, project_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name, deployment_id, project_id) DO UPDATE SET
           concurrency_limit = $3",
      )
      .bind(workflow_id)
      .bind(&deployment_id)
      .bind(1)
      .bind(project_id)
      .execute(&self.pool)
      .await?;
    }

    // Use upsert to create or update
    let row = sqlx::query(
      "INSERT INTO schedules (id, workflow_id, cron, timezone, key, status, next_run_at, created_at, updated_at, project_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active', $5, NOW(), NOW(), $6)
       ON CONFLICT (workflow_id, project_id, key) DO UPDATE SET
         cron = EXCLUDED.cron,
         timezone = EXCLUDED.timezone,
         status = 'active',
         next_run_at = EXCLUDED.next_run_at,
         updated_at = NOW()
       RETURNING id"
    )
    .bind(workflow_id)
    .bind(cron)
    .bind(timezone)
    .bind(key)
    .bind(next_run_at)
    .bind(project_id)
    .fetch_one(&self.pool)
    .await?;

    Ok(row.get("id"))
  }

  /// Process one scheduled workflow at a time using SELECT FOR UPDATE SKIP LOCKED
  /// This allows multiple orchestrators to work in parallel
  /// Returns Some(1) if a schedule was processed and execution created, None if no schedules found
  pub async fn process_one_scheduled_workflow(&self) -> anyhow::Result<Option<usize>> {
    use cron::Schedule;
    use std::str::FromStr;

    let mut tx = self.pool.begin().await?;

    // Set admin access for background workflow (operates across all projects)
    sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
      .execute(&mut *tx)
      .await?;

    // Step 1: Get one due schedule with deployment info (single query)
    let row = sqlx::query(
      r#"
        SELECT 
            s.id,
            s.workflow_id,
            s.cron,
            s.timezone,
            s.key,
            s.last_run_at,
            s.project_id,
            dw.deployment_id
        FROM schedules s
        INNER JOIN LATERAL (
            SELECT deployment_id
            FROM deployment_workflows dw
            WHERE dw.workflow_id = s.workflow_id
              AND dw.scheduled = true
            ORDER BY dw.created_at DESC
            LIMIT 1
        ) dw ON true
        WHERE s.status = 'active'
          AND s.next_run_at <= NOW()
        -- No in-flight execution
        AND NOT EXISTS (
            SELECT 1 FROM workflow_executions ex
            WHERE ex.workflow_id = s.workflow_id
              AND ex.deployment_id = dw.deployment_id
              AND ex.status = ANY(ARRAY['queued', 'running', 'waiting'])
            LIMIT 1
        )
        ORDER BY s.next_run_at ASC
        LIMIT 1
        FOR UPDATE OF s SKIP LOCKED
        "#,
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some(row) = row else {
      tx.commit().await?;
      return Ok(None); // No schedules to process
    };

    // Extract row data
    let schedule_id: Uuid = row.get("id");
    let workflow_id: String = row.get("workflow_id");
    let deployment_id: String = row.get("deployment_id");
    let cron: String = row.get("cron");
    let timezone: String = row.get("timezone");
    let key: String = row.get("key");
    let last_run_at: Option<DateTime<Utc>> = row.get("last_run_at");
    let project_id: Uuid = row.get("project_id");

    // Step 2: Calculate next run time
    let cron_with_seconds = format!("0 {}", cron);
    let cron_schedule = Schedule::from_str(&cron_with_seconds)
      .map_err(|e| anyhow::anyhow!("Invalid cron expression: {}", e))?;

    let tz: chrono_tz::Tz = timezone
      .parse()
      .map_err(|e| anyhow::anyhow!("Invalid timezone: {}", e))?;

    let now = Utc::now();
    let now_tz = now.with_timezone(&tz);

    // Get the next scheduled time (this is the "upcoming" time)
    let mut schedule_iter = cron_schedule.after(&now_tz);
    let upcoming = schedule_iter
      .next()
      .ok_or_else(|| anyhow::anyhow!("Could not calculate upcoming time"))?
      .with_timezone(&Utc);

    // Get the time after that (this is the "next_next_run" for the schedule)
    let next_next_run = schedule_iter
      .next()
      .ok_or_else(|| anyhow::anyhow!("Could not calculate next run time"))?
      .with_timezone(&Utc);

    // Step 3: Build payload
    let payload = serde_json::json!({
        "timestamp": now.to_rfc3339(),
        "last_timestamp": last_run_at.map(|dt| dt.to_rfc3339()),
        "timezone": timezone,
        "schedule_id": schedule_id.to_string(),
        "key": key,
        "upcoming": upcoming.to_rfc3339(),
    });

    // Step 4: Create execution + update schedule (single transaction)
    let execution_id = Uuid::new_v4();
    let created = sqlx::query_scalar::<_, i64>(
      r#"
        WITH new_execution AS (
            INSERT INTO workflow_executions (
                id, workflow_id, deployment_id, status, payload,
                queue_name, concurrency_key, project_id, queued_at, created_at,
                parent_execution_id, root_execution_id, step_key
            )
            VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, NOW(), NOW(), NULL, NULL, NULL)
            RETURNING 1
        ),
        updated_schedule AS (
            UPDATE schedules
            SET 
                last_run_at = $8,
                next_run_at = $9,
                updated_at = NOW()
            WHERE id = $10
            RETURNING 1
        )
        SELECT COUNT(*)::bigint FROM new_execution
        "#,
    )
    .bind(execution_id)
    .bind(&workflow_id)
    .bind(&deployment_id)
    .bind(payload)
    .bind(&workflow_id) // queue_name
    .bind(&key) // concurrency_key
    .bind(project_id)
    .bind(now)
    .bind(next_next_run)
    .bind(schedule_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Some(created as usize))
  }

  /// Get all schedules for a workflow
  pub async fn get_schedules_for_workflow(
    &self,
    workflow_id: &str,
  ) -> anyhow::Result<Vec<Schedule>> {
    let rows = sqlx::query(
      "SELECT id, workflow_id, cron, timezone, key, status, last_run_at, next_run_at, created_at, updated_at
       FROM schedules
       WHERE workflow_id = $1
       ORDER BY created_at DESC"
    )
    .bind(workflow_id)
    .fetch_all(&self.pool)
    .await?;

    Ok(
      rows
        .into_iter()
        .map(|row| Schedule {
          id: row.get("id"),
          workflow_id: row.get("workflow_id"),
          cron: row.get("cron"),
          timezone: row.get("timezone"),
          key: row.get("key"),
          status: row.get("status"),
          last_run_at: row.get("last_run_at"),
          next_run_at: row.get("next_run_at"),
          created_at: row.get("created_at"),
          updated_at: row.get("updated_at"),
        })
        .collect(),
    )
  }

  /// Get all scheduled workflows (workflows that have at least one active schedule)
  pub async fn get_scheduled_workflows(&self) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query(
      "SELECT DISTINCT workflow_id
       FROM schedules
       WHERE status = 'active'
       ORDER BY workflow_id",
    )
    .fetch_all(&self.pool)
    .await?;

    Ok(rows.into_iter().map(|row| row.get("workflow_id")).collect())
  }

  /// Check if a workflow is schedulable (has schedule=True in latest deployment)
  pub async fn is_workflow_schedulable(&self, workflow_id: &str) -> anyhow::Result<bool> {
    let row = sqlx::query(
      "SELECT scheduled
       FROM deployment_workflows
       WHERE workflow_id = $1
       AND scheduled = TRUE
       ORDER BY created_at DESC
       LIMIT 1",
    )
    .bind(workflow_id)
    .fetch_optional(&self.pool)
    .await?;

    Ok(row.is_some())
  }
}
