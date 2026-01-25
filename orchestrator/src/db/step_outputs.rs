// Step output-related database operations
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;

impl Database {
  /// Store step output for recovery
  #[allow(clippy::too_many_arguments)]
  pub async fn store_step_output(
    &self,
    execution_id: &Uuid,
    step_key: &str,
    outputs: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
    success: Option<bool>,
    source_execution_id: Option<&Uuid>,
    output_schema_name: Option<&str>,
  ) -> anyhow::Result<()> {
    // Get project_id from execution
    let project_id = Database::get_project_id_from_execution(self, execution_id).await?;

    sqlx::query(
      "INSERT INTO execution_step_outputs (execution_id, step_key, outputs, error, success, source_execution_id, output_schema_name, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (execution_id, step_key) DO UPDATE
       SET outputs = $3, error = $4, success=$5, source_execution_id = $6, output_schema_name = $7"
    )
    .bind(execution_id)
    .bind(step_key)
    .bind(outputs)
    .bind(error)
    .bind(success)
    .bind(source_execution_id)
    .bind(output_schema_name)
    .bind(project_id)
    .execute(&self.pool)
    .await?;

    Ok(())
  }

  /// Get step output for recovery
  pub async fn get_step_output(
    &self,
    execution_id: &Uuid,
    step_key: &str,
  ) -> anyhow::Result<Option<serde_json::Value>> {
    let row = sqlx::query(
      "SELECT step_key, outputs, error, success, source_execution_id, output_schema_name
       FROM execution_step_outputs
       WHERE execution_id = $1 AND step_key = $2",
    )
    .bind(execution_id)
    .bind(step_key)
    .fetch_optional(&self.pool)
    .await?;

    Ok(row.map(|row| {
      serde_json::json!({
        "step_key": row.get::<String, _>("step_key"),
        "outputs": row.get::<Option<serde_json::Value>, _>("outputs"),
        "error": row.get::<Option<serde_json::Value>, _>("error"),
        "success": row.get::<Option<bool>, _>("success"),
        "source_execution_id": row.get::<Option<Uuid>, _>("source_execution_id"),
        "output_schema_name": row.get::<Option<String>, _>("output_schema_name"),
      })
    }))
  }

  /// Get all step outputs for an execution (for recovery)
  pub async fn get_all_step_outputs(
    &self,
    execution_id: &Uuid,
  ) -> anyhow::Result<
    Vec<(
      String,
      Option<serde_json::Value>,
      Option<serde_json::Value>,
      Option<bool>,
      Option<Uuid>,
    )>,
  > {
    let rows = sqlx::query(
      "SELECT step_key, outputs, error, success, source_execution_id
       FROM execution_step_outputs
       WHERE execution_id = $1
       ORDER BY step_key ASC",
    )
    .bind(execution_id)
    .fetch_all(&self.pool)
    .await?;

    Ok(
      rows
        .into_iter()
        .map(|row| {
          (
            row.get("step_key"),
            row.get("outputs"),
            row.get("error"),
            row.get("success"),
            row.get("source_execution_id"),
          )
        })
        .collect(),
    )
  }
}
