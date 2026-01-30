// Tool-related database operations
use sqlx::Row;
use uuid::Uuid;

use crate::db::{models::ToolDefinition, Database};

impl Database {
    pub async fn get_tools_by_project(
        &self,
        project_id: &Uuid,
    ) -> anyhow::Result<Vec<ToolDefinition>> {
        let rows = sqlx::query(
      "SELECT id, deployment_id, type, description, parameters, metadata, created_at, updated_at
       FROM tool_definitions
       WHERE project_id = $1
       ORDER BY id, created_at DESC",
    )
    .bind(project_id)
    .fetch_all(&self.pool)
    .await?;

        let tools = rows
            .into_iter()
            .map(|row| ToolDefinition {
                id: row.get("id"),
                deployment_id: row.get("deployment_id"),
                tool_type: row.get("type"),
                description: row.get("description"),
                parameters: row.get("parameters"),
                metadata: row.get("metadata"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(tools)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_or_update_tool_definition(
        &self,
        id: &str,
        deployment_id: &str,
        tool_type: &str,
        description: Option<&str>,
        parameters: Option<&serde_json::Value>,
        metadata: Option<&serde_json::Value>,
        project_id: &Uuid,
    ) -> anyhow::Result<()> {
        sqlx::query(
      "INSERT INTO tool_definitions (id, deployment_id, project_id, type, description, parameters, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id, deployment_id, project_id) DO UPDATE SET
         type = EXCLUDED.type,
         description = EXCLUDED.description,
         parameters = EXCLUDED.parameters,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()"
    )
    .bind(id)
    .bind(deployment_id)
    .bind(project_id)
    .bind(tool_type)
    .bind(description)
    .bind(parameters)
    .bind(metadata)
    .execute(&self.pool)
    .await?;

        Ok(())
    }

    pub async fn get_tool_definition(
        &self,
        id: &str,
        deployment_id: &str,
    ) -> anyhow::Result<Option<ToolDefinition>> {
        let row = sqlx::query(
      "SELECT id, deployment_id, type, description, parameters, metadata, created_at, updated_at
       FROM tool_definitions
       WHERE id = $1 AND deployment_id = $2",
    )
    .bind(id)
    .bind(deployment_id)
    .fetch_optional(&self.pool)
    .await?;

        if let Some(row) = row {
            Ok(Some(ToolDefinition {
                id: row.get("id"),
                deployment_id: row.get("deployment_id"),
                tool_type: row.get("type"),
                description: row.get("description"),
                parameters: row.get("parameters"),
                metadata: row.get("metadata"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            }))
        } else {
            Ok(None)
        }
    }
}
