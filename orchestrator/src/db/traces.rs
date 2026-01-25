// Trace-related database operations
use chrono::{DateTime, Utc};
use sqlx::QueryBuilder;
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;

impl Database {
  #[allow(clippy::too_many_arguments)]
  pub async fn store_span(
    &self,
    trace_id: &str,
    span_id: &str,
    parent_span_id: Option<&str>,
    name: &str,
    span_type: &str,
    attributes: Option<serde_json::Value>,
    events: Option<serde_json::Value>,
    input_data: Option<serde_json::Value>,
    output_data: Option<serde_json::Value>,
    error_data: Option<serde_json::Value>,
    initial_state: Option<serde_json::Value>,
    final_state: Option<serde_json::Value>,
    started_at: &str,
    ended_at: Option<&str>,
    project_id: &Uuid,
  ) -> anyhow::Result<()> {
    // Parse ISO timestamp strings into DateTime<Utc> for TIMESTAMPTZ columns
    let started_at_dt = DateTime::parse_from_rfc3339(started_at)
      .map_err(|e| anyhow::anyhow!("Failed to parse started_at timestamp: {}", e))?
      .with_timezone(&Utc);

    let ended_at_dt = if let Some(ended_at_str) = ended_at {
      Some(
        DateTime::parse_from_rfc3339(ended_at_str)
          .map_err(|e| anyhow::anyhow!("Failed to parse ended_at timestamp: {}", e))?
          .with_timezone(&Utc),
      )
    } else {
      None
    };

    let now = Utc::now();

    sqlx::query(
      "INSERT INTO spans (
        trace_id, span_id, parent_span_id, name, span_type, attributes, events,
        input, output, error, started_at, ended_at, created_at, updated_at, initial_state, final_state, project_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (trace_id, span_id) DO UPDATE
      SET parent_span_id = $3, name = $4, span_type = $5, attributes = $6, events = $7,
          input = $8, output = $9, error = $10, started_at = $11, ended_at = $12, updated_at = $14,
          initial_state = $15, final_state = $16, project_id = $17"
    )
    .bind(trace_id)
    .bind(span_id)
    .bind(parent_span_id)
    .bind(name)
    .bind(span_type)
    .bind(attributes)
    .bind(events)
    .bind(input_data)
    .bind(output_data)
    .bind(error_data)
    .bind(started_at_dt)
    .bind(ended_at_dt)
    .bind(now)
    .bind(now)
    .bind(initial_state)
    .bind(final_state)
    .bind(project_id)
    .execute(&self.pool)
    .await?;

    Ok(())
  }

  /// Get all spans for a trace_id, ordered by started_at, filtered by project_id
  pub async fn get_spans_by_trace_id(
    &self,
    trace_id: &str,
    project_id: &Uuid,
  ) -> anyhow::Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
      "SELECT trace_id, span_id, parent_span_id, name, span_type, attributes, events,
              input, output, error, started_at, ended_at, initial_state, final_state
       FROM spans
       WHERE trace_id = $1 AND project_id = $2
       ORDER BY started_at ASC",
    )
    .bind(trace_id)
    .bind(project_id)
    .fetch_all(&self.pool)
    .await?;

    let spans: Vec<serde_json::Value> = rows
      .into_iter()
      .map(|row| {
        let started_at: DateTime<Utc> = row.get("started_at");
        let ended_at: Option<DateTime<Utc>> = row.get("ended_at");

        serde_json::json!({
          "trace_id": row.get::<String, _>("trace_id"),
          "span_id": row.get::<String, _>("span_id"),
          "parent_span_id": row.get::<Option<String>, _>("parent_span_id"),
          "name": row.get::<String, _>("name"),
          "span_type": row.get::<String, _>("span_type"),
          "attributes": row.get::<Option<serde_json::Value>, _>("attributes"),
          "events": row.get::<Option<serde_json::Value>, _>("events"),
          "input": row.get::<Option<serde_json::Value>, _>("input"),
          "output": row.get::<Option<serde_json::Value>, _>("output"),
          "error": row.get::<Option<serde_json::Value>, _>("error"),
          "started_at": started_at.to_rfc3339(),
          "ended_at": ended_at.map(|dt| dt.to_rfc3339()),
          "initial_state": row.get::<Option<serde_json::Value>, _>("initial_state"),
          "final_state": row.get::<Option<serde_json::Value>, _>("final_state"),
        })
      })
      .collect();

    Ok(spans)
  }

  /// Get a list of traces with filtering, scoped to a project
  /// Returns traces aggregated from spans with root span information
  #[allow(clippy::too_many_arguments)]
  pub async fn get_traces(
    &self,
    project_id: &Uuid,
    start_time: Option<DateTime<Utc>>,
    end_time: Option<DateTime<Utc>>,
    root_span_type: Option<&str>,
    root_span_name: Option<&str>,
    has_error: Option<bool>,
    limit: i64,
    offset: i64,
  ) -> anyhow::Result<Vec<serde_json::Value>> {
    // Use a CTE to get root spans first, then aggregate
    // Build query dynamically with QueryBuilder to handle optional filters
    let mut query_builder = QueryBuilder::new(
      "WITH root_spans AS (
        SELECT DISTINCT ON (trace_id)
          trace_id,
          span_type as root_span_type,
          name as root_span_name,
          input,
          started_at
        FROM spans
        WHERE parent_span_id IS NULL AND project_id = ",
    );
    query_builder.push_bind(project_id);
    query_builder.push(
      " ORDER BY trace_id, started_at ASC
      ),
      trace_outputs AS (
        SELECT DISTINCT ON (trace_id)
          trace_id,
          output,
          ended_at,
          error as root_error
        FROM spans
        WHERE parent_span_id IS NULL AND project_id = ",
    );
    query_builder.push_bind(project_id);
    query_builder.push(
      " ORDER BY trace_id, started_at DESC
      ),
      execution_statuses AS (
        SELECT DISTINCT ON (trace_id)
          trace_id,
          e.status as status
        FROM root_spans rs
        LEFT JOIN workflow_executions e ON e.id = (
          -- Convert trace_id (32 hex chars) to UUID format
          -- UUID format: 8-4-4-4-12
          uuid(
            substring(rs.trace_id from 1 for 8) || '-' ||
            substring(rs.trace_id from 9 for 4) || '-' ||
            substring(rs.trace_id from 13 for 4) || '-' ||
            substring(rs.trace_id from 17 for 4) || '-' ||
            substring(rs.trace_id from 21 for 12)
          )
        )
      )
      SELECT 
        rs.trace_id,
        rs.root_span_type,
        rs.root_span_name,
        rs.started_at,
        tr.ended_at,
        rs.input,
        tr.output as output,
        tr.root_error,
        es.status as status
      FROM root_spans rs
      JOIN trace_outputs tr ON rs.trace_id = tr.trace_id
      LEFT JOIN execution_statuses es ON rs.trace_id = es.trace_id
      WHERE 1=1",
    );

    if let Some(start) = start_time {
      query_builder.push(" AND rs.started_at >= ");
      query_builder.push_bind(start);
    }
    if let Some(end) = end_time {
      query_builder.push(" AND tr.ended_at <= ");
      query_builder.push_bind(end);
    }
    if let Some(span_type) = root_span_type {
      query_builder.push(" AND rs.root_span_type = ");
      query_builder.push_bind(span_type);
    }
    if let Some(name) = root_span_name {
      query_builder.push(" AND rs.root_span_name LIKE ");
      query_builder.push_bind(format!("%{}%", name));
    }
    if let Some(has_err) = has_error {
      if has_err {
        query_builder.push(" AND tr.root_error IS NOT NULL");
      } else {
        query_builder.push(" AND tr.root_error IS NULL");
      }
    }

    query_builder.push(" ORDER BY tr.ended_at DESC LIMIT ");
    query_builder.push_bind(limit);
    query_builder.push(" OFFSET ");
    query_builder.push_bind(offset);

    let query = query_builder.build();
    let rows = query.fetch_all(&self.pool).await?;

    let traces: Vec<serde_json::Value> = rows
      .into_iter()
      .map(|row| {
        let started_at: Option<DateTime<Utc>> = row.get("started_at");
        let ended_at: Option<DateTime<Utc>> = row.get("ended_at");
        let status: Option<String> = row.get("status");

        let duration = if let (Some(start), Some(end)) = (started_at, ended_at) {
          Some((end - start).num_milliseconds())
        } else {
          None
        };

        serde_json::json!({
          "trace_id": row.get::<String, _>("trace_id"),
          "root_span_type": row.get::<Option<String>, _>("root_span_type"),
          "root_span_name": row.get::<Option<String>, _>("root_span_name"),
          "started_at": started_at.map(|dt| dt.to_rfc3339()),
          "ended_at": ended_at.map(|dt| dt.to_rfc3339()),
          "duration_ms": duration,
          "input": row.get::<Option<serde_json::Value>, _>("input"),
          "output": row.get::<Option<serde_json::Value>, _>("output"),
          "root_error": row.get::<Option<serde_json::Value>, _>("root_error"),
          "status": status.map(|s| s.to_string()).unwrap_or_else(|| "unknown".to_string()),
        })
      })
      .collect();

    Ok(traces)
  }
}
