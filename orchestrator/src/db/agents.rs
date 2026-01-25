// Agent-related database operations
use sqlx::Row;
use uuid::Uuid;

use crate::db::{models::AgentDefinition, Database};

impl Database {
  #[allow(clippy::too_many_arguments)]
  pub async fn create_or_update_agent_definition(
    &self,
    id: &str,
    deployment_id: &str,
    provider: &str,
    model: &str,
    system_prompt: Option<&str>,
    tools: Option<&serde_json::Value>,
    temperature: Option<f64>,
    max_output_tokens: Option<i32>,
    config: Option<&serde_json::Value>,
    metadata: Option<&serde_json::Value>,
    project_id: &Uuid,
  ) -> anyhow::Result<()> {
    sqlx::query(
      "INSERT INTO agent_definitions (id, deployment_id, project_id, provider, model, system_prompt, tools, temperature, max_output_tokens, config, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (id, deployment_id, project_id) DO UPDATE SET
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         system_prompt = EXCLUDED.system_prompt,
         tools = EXCLUDED.tools,
         temperature = EXCLUDED.temperature,
         max_output_tokens = EXCLUDED.max_output_tokens,
         config = EXCLUDED.config,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()"
    )
    .bind(id)
    .bind(deployment_id)
    .bind(project_id)
    .bind(provider)
    .bind(model)
    .bind(system_prompt)
    .bind(tools)
    .bind(temperature)
    .bind(max_output_tokens)
    .bind(config)
    .bind(metadata)
    .execute(&self.pool)
    .await?;

    Ok(())
  }

  pub async fn get_agents_by_project(
    &self,
    project_id: &Uuid,
  ) -> anyhow::Result<Vec<AgentDefinition>> {
    let rows = sqlx::query(
      "SELECT id, deployment_id, provider, model, system_prompt, tools, temperature, max_output_tokens, config, metadata, created_at, updated_at
       FROM agent_definitions
       WHERE project_id = $1
       ORDER BY id, created_at DESC"
    )
    .bind(project_id)
    .fetch_all(&self.pool)
    .await?;

    let agents = rows
      .into_iter()
      .map(|row| AgentDefinition {
        id: row.get("id"),
        deployment_id: row.get("deployment_id"),
        provider: row.get("provider"),
        model: row.get("model"),
        system_prompt: row.get("system_prompt"),
        tools: row.get("tools"),
        temperature: row.get("temperature"),
        max_output_tokens: row.get("max_output_tokens"),
        config: row.get("config"),
        metadata: row.get("metadata"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
      })
      .collect();

    Ok(agents)
  }

  pub async fn get_agent_definition(
    &self,
    id: &str,
    deployment_id: &str,
  ) -> anyhow::Result<Option<AgentDefinition>> {
    let row = sqlx::query(
      "SELECT id, deployment_id, provider, model, system_prompt, tools, temperature, max_output_tokens, config, metadata, created_at, updated_at
       FROM agent_definitions
       WHERE id = $1 AND deployment_id = $2"
    )
    .bind(id)
    .bind(deployment_id)
    .fetch_optional(&self.pool)
    .await?;

    if let Some(row) = row {
      Ok(Some(AgentDefinition {
        id: row.get("id"),
        deployment_id: row.get("deployment_id"),
        provider: row.get("provider"),
        model: row.get("model"),
        system_prompt: row.get("system_prompt"),
        tools: row.get("tools"),
        temperature: row.get("temperature"),
        max_output_tokens: row.get("max_output_tokens"),
        config: row.get("config"),
        metadata: row.get("metadata"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
      }))
    } else {
      Ok(None)
    }
  }

  pub async fn get_latest_deployment_id_for_agent(
    &self,
    agent_id: &str,
    project_id: &Uuid,
  ) -> anyhow::Result<Option<String>> {
    let row = sqlx::query(
      "SELECT deployment_id FROM agent_definitions 
       WHERE id = $1 AND project_id = $2
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1",
    )
    .bind(agent_id)
    .bind(project_id)
    .fetch_optional(&self.pool)
    .await?;

    Ok(row.map(|r| r.get("deployment_id")))
  }
}
