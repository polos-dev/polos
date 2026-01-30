// Workflow-related database operations (includes queue and event trigger ops)
use sqlx::{QueryBuilder, Row};
use uuid::Uuid;

use crate::db::{models::DeploymentWorkflow, Database};

impl Database {
  /// Get or create a queue by name and deployment_id (lazy creation)
  pub async fn get_or_create_queue(
    &self,
    name: &str,
    deployment_id: &str,
    project_id: &Uuid,
    concurrency_limit: Option<i32>,
  ) -> anyhow::Result<()> {
    // Check if queue exists
    let queue = sqlx::query("SELECT name FROM queues WHERE name = $1 AND deployment_id = $2")
      .bind(name)
      .bind(deployment_id)
      .fetch_optional(&self.pool)
      .await?;

    if queue.is_some() {
      return Ok(());
    }

    // Queue doesn't exist, create it
    let default_limit = concurrency_limit.unwrap_or_else(|| {
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
    .bind(name)
    .bind(deployment_id)
    .bind(project_id)
    .bind(default_limit)
    .execute(&self.pool)
    .await?;

    Ok(())
  }

  /// Batch register or update queues
  pub async fn batch_register_queues(
    &self,
    deployment_id: &str,
    queues: &[(String, Option<i32>)],
    project_id: &Uuid,
  ) -> anyhow::Result<()> {
    if queues.is_empty() {
      return Ok(());
    }

    let default_limit = std::env::var("POLOS_DEFAULT_CONCURRENCY_LIMIT")
      .ok()
      .and_then(|s| s.parse::<i32>().ok())
      .unwrap_or(999999); // Very large number for "unlimited"

    let mut query_builder =
      QueryBuilder::new("INSERT INTO queues (name, deployment_id, concurrency_limit, project_id) ");

    query_builder.push_values(queues.iter(), |mut b, (name, limit)| {
      let final_limit = limit.unwrap_or(default_limit);
      b.push_bind(name);
      b.push_bind(deployment_id);
      b.push_bind(final_limit);
      b.push_bind(project_id);
    });

    query_builder.push(
      " ON CONFLICT (name, deployment_id, project_id) DO UPDATE SET 
        concurrency_limit = EXCLUDED.concurrency_limit,
        updated_at = NOW()",
    );

    let query = query_builder.build();
    query.execute(&self.pool).await?;

    Ok(())
  }

  pub async fn get_workflows_by_project(
    &self,
    project_id: &Uuid,
  ) -> anyhow::Result<Vec<DeploymentWorkflow>> {
    let rows = sqlx::query(
      "SELECT workflow_id, deployment_id, workflow_type, trigger_on_event, scheduled, created_at
       FROM deployment_workflows
       WHERE project_id = $1 AND workflow_type = 'workflow'
       ORDER BY workflow_id, created_at DESC",
    )
    .bind(project_id)
    .fetch_all(&self.pool)
    .await?;

    let workflows = rows
      .into_iter()
      .map(|row| DeploymentWorkflow {
        workflow_id: row.get("workflow_id"),
        deployment_id: row.get("deployment_id"),
        workflow_type: row.get("workflow_type"),
        trigger_on_event: row.get("trigger_on_event"),
        scheduled: row.get("scheduled"),
        created_at: row.get("created_at"),
      })
      .collect();

    Ok(workflows)
  }

  pub async fn get_workflow_by_id(
    &self,
    project_id: &Uuid,
    workflow_id: &str,
  ) -> anyhow::Result<Option<DeploymentWorkflow>> {
    let row = sqlx::query(
      "SELECT workflow_id, deployment_id, workflow_type, trigger_on_event, scheduled, created_at
       FROM deployment_workflows
       WHERE project_id = $1 AND workflow_id = $2 AND workflow_type = 'workflow'
       ORDER BY created_at DESC
       LIMIT 1",
    )
    .bind(project_id)
    .bind(workflow_id)
    .fetch_optional(&self.pool)
    .await?;

    if let Some(row) = row {
      Ok(Some(DeploymentWorkflow {
        workflow_id: row.get("workflow_id"),
        deployment_id: row.get("deployment_id"),
        workflow_type: row.get("workflow_type"),
        trigger_on_event: row.get("trigger_on_event"),
        scheduled: row.get("scheduled"),
        created_at: row.get("created_at"),
      }))
    } else {
      Ok(None)
    }
  }

  #[allow(clippy::too_many_arguments)]
  pub async fn create_or_update_event_trigger(
    &self,
    workflow_id: &str,
    deployment_id: &str,
    event_topic: &str,
    batch_size: i32,
    batch_timeout_seconds: Option<i32>,
    project_id: &Uuid,
    queue_name: Option<&str>,
  ) -> anyhow::Result<()> {
    // Default queue_name to workflow_id if not provided
    let effective_queue_name = queue_name.unwrap_or(workflow_id);

    sqlx::query(
      "INSERT INTO event_triggers (workflow_id, deployment_id, event_topic, batch_size, batch_timeout_seconds, status, created_at, processed_at, project_id, queue_name)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW(), $6, $7)
       ON CONFLICT (workflow_id, deployment_id, event_topic, project_id) DO UPDATE SET
         batch_size = EXCLUDED.batch_size,
         batch_timeout_seconds = EXCLUDED.batch_timeout_seconds,
         status = 'active',
         processed_at = NOW(),
         queue_name = COALESCE(EXCLUDED.queue_name, event_triggers.queue_name)"
    )
    .bind(workflow_id)
    .bind(deployment_id)
    .bind(event_topic)
    .bind(batch_size)
    .bind(batch_timeout_seconds)
    .bind(project_id)
    .bind(effective_queue_name)
    .execute(&self.pool)
    .await?;

    Ok(())
  }

  // Process event triggers - called by background workflow
  // Does everything in a single transaction to ensure FOR UPDATE SKIP LOCKED works correctly
  /// Process one event trigger at a time using SELECT FOR UPDATE SKIP LOCKED
  /// This allows multiple orchestrators to work in parallel
  /// Uses a single SQL query with CTEs for efficiency and atomicity
  /// Returns Some(1) if a trigger was processed and execution created, Some(0) if processed but skipped, None if no triggers found
  pub async fn process_one_event_trigger(&self) -> anyhow::Result<Option<usize>> {
    const EVENT_TRIGGER_QUERY: &str = r#"
    WITH running_counts AS (
        -- Count running executions per queue
        SELECT 
            queue_name,
            deployment_id,
            COALESCE(concurrency_key, '') as concurrency_key,
            COUNT(*) as running_count
        FROM workflow_executions
        WHERE status IN ('claimed', 'running')
        GROUP BY queue_name, deployment_id, COALESCE(concurrency_key, '')
    ),
    selected_trigger AS (
        -- Select trigger that has events and queue has capacity
        SELECT 
            t.id,
            t.workflow_id,
            t.deployment_id,
            t.event_topic,
            t.batch_size,
            t.batch_timeout_seconds,
            t.last_sequence_id,
            t.project_id,
            t.queue_name
        FROM event_triggers t
        INNER JOIN queues q
            ON q.name = COALESCE(t.queue_name, t.workflow_id)
            AND q.deployment_id = t.deployment_id
        LEFT JOIN running_counts rc
            ON rc.queue_name = COALESCE(t.queue_name, t.workflow_id)
            AND rc.deployment_id = t.deployment_id
            AND rc.concurrency_key = ''
        WHERE t.status = 'active'
        -- Must have unconsumed events
        AND EXISTS (
            SELECT 1 FROM events e
            WHERE e.topic = t.event_topic
              AND e.status = 'valid'
              AND (t.last_sequence_id IS NULL OR e.sequence_id > t.last_sequence_id)
            LIMIT 1
        )
        -- Must have capacity in queue (check concurrency limit)
        AND (
            q.concurrency_limit IS NULL
            OR COALESCE(rc.running_count, 0) < q.concurrency_limit
        )
        ORDER BY t.processed_at ASC
        LIMIT 1
        FOR UPDATE OF t SKIP LOCKED
    ),
    events_to_process AS (
        -- Get events for selected trigger
        SELECT 
            e.id,
            e.sequence_id,
            e.topic,
            e.event_type,
            e.data,
            e.created_at,
            t.batch_size,
            t.batch_timeout_seconds
        FROM selected_trigger t
        CROSS JOIN LATERAL (
            SELECT e.*
            FROM events e
            WHERE e.topic = t.event_topic
              AND e.status = 'valid'
              AND (t.last_sequence_id IS NULL OR e.sequence_id > t.last_sequence_id)
            ORDER BY e.sequence_id ASC
            LIMIT t.batch_size
        ) e
    ),
    batch_check AS (
        -- Check if batch conditions are met
        SELECT 
            COUNT(*) as event_count,
            MIN(created_at) as oldest_event_time,
            MAX(batch_size) as batch_size,
            MAX(batch_timeout_seconds) as timeout_seconds,
            CASE
                WHEN MAX(batch_timeout_seconds) IS NULL THEN true
                WHEN COUNT(*) >= MAX(batch_size) THEN true
                WHEN EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) >= MAX(batch_timeout_seconds) THEN true
                ELSE false
            END as should_process
        FROM events_to_process
    ),
    inserted_execution AS (
        -- Create execution if batch conditions met
        INSERT INTO workflow_executions (
            id, workflow_id, deployment_id, status, payload, queue_name,
            retry_count, project_id, queued_at, created_at,
            parent_execution_id, root_execution_id, step_key
        )
        SELECT 
            gen_random_uuid(),
            t.workflow_id,
            t.deployment_id,
            'queued',
            -- Build payload based on batch_size
            CASE 
                WHEN t.batch_size > 1 OR t.batch_timeout_seconds IS NOT NULL THEN
                    jsonb_build_object('events', jsonb_agg(
                        jsonb_build_object(
                            'id', e.id::text,
                            'sequence_id', e.sequence_id,
                            'topic', e.topic,
                            'event_type', e.event_type,
                            'data', e.data,
                            'created_at', to_jsonb(e.created_at)
                        ) ORDER BY e.sequence_id
                    ))
                ELSE
                    (SELECT jsonb_build_object(
                        'id', e2.id::text,
                        'sequence_id', e2.sequence_id,
                        'topic', e2.topic,
                        'event_type', e2.event_type,
                        'data', e2.data,
                        'created_at', to_jsonb(e2.created_at)
                    ) FROM events_to_process e2 ORDER BY e2.sequence_id ASC LIMIT 1)
            END,
            COALESCE(t.queue_name, t.workflow_id),
            0, -- retry_count
            t.project_id,
            NOW(),
            NOW(),
            NULL::uuid, -- parent_execution_id
            NULL::uuid, -- root_execution_id
            NULL::text  -- step_key
        FROM selected_trigger t
        CROSS JOIN events_to_process e
        CROSS JOIN batch_check bc
        WHERE bc.should_process = true
        GROUP BY t.workflow_id, t.deployment_id, t.batch_size, 
                 t.batch_timeout_seconds, t.project_id, t.queue_name
        RETURNING 1
    ),
    updated_trigger AS (
        -- Update trigger consumption state and processed_at
        -- Always update processed_at, even if no execution was created
        UPDATE event_triggers t
        SET 
            last_sequence_id = CASE 
                WHEN EXISTS (SELECT 1 FROM inserted_execution) THEN
                    (SELECT MAX(sequence_id) FROM events_to_process)
                ELSE t.last_sequence_id
            END,
            last_event_timestamp = CASE
                WHEN EXISTS (SELECT 1 FROM inserted_execution) THEN
                    (SELECT MAX(created_at) FROM events_to_process)
                ELSE t.last_event_timestamp
            END,
            processed_at = NOW()
        FROM selected_trigger st
        WHERE t.id = st.id
        RETURNING 1
    )
    SELECT COALESCE((SELECT COUNT(*) FROM inserted_execution), 0)::bigint
    "#;

    let mut tx = self.pool.begin().await?;

    // Set admin access for background workflow (operates across all projects)
    sqlx::query("SELECT set_config('app.is_admin', 'true', true)")
      .execute(&mut *tx)
      .await?;

    let result = sqlx::query_scalar::<_, i64>(EVENT_TRIGGER_QUERY)
      .fetch_optional(&mut *tx)
      .await?;

    tx.commit().await?;

    Ok(result.map(|count| count as usize))
  }
}
