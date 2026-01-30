// State-related database operations (workflow, session, user, conversation)
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;

impl Database {
    // Conversation history methods
    #[allow(clippy::too_many_arguments)]
    pub async fn add_conversation_history(
        &self,
        conversation_id: &str,
        agent_id: &str,
        role: &str,
        content: &serde_json::Value,
        agent_run_id: Option<&Uuid>,
        conversation_history_limit: Option<i64>,
        project_id: &Uuid,
        deployment_id: Option<&str>,
    ) -> anyhow::Result<()> {
        // Use a transaction to ensure atomicity
        let mut tx = self.pool.begin().await?;

        // Get deployment_id from agent_run_id if not provided
        let final_deployment_id = if let Some(deployment_id) = deployment_id {
            Some(deployment_id.to_string())
        } else if let Some(run_id) = agent_run_id {
            // Get deployment_id from execution
            let deployment_id_opt: Option<String> =
                sqlx::query_scalar("SELECT deployment_id FROM workflow_executions WHERE id = $1")
                    .bind(run_id)
                    .fetch_optional(&mut *tx)
                    .await?;
            deployment_id_opt
        } else {
            None
        };

        // Insert the new message
        sqlx::query(
      "INSERT INTO conversation_history (conversation_id, agent_id, role, content, agent_run_id, project_id, deployment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(conversation_id)
    .bind(agent_id)
    .bind(role)
    .bind(content)
    .bind(agent_run_id)
    .bind(project_id)
    .bind(final_deployment_id.as_deref())
    .execute(&mut *tx)
    .await?;

        // If limit is specified, delete old messages to keep only the last N
        if let Some(limit) = conversation_history_limit {
            // Delete messages beyond the limit, keeping only the most recent ones
            sqlx::query(
                "DELETE FROM conversation_history
         WHERE conversation_id = $1 AND agent_id = $2 AND project_id = $3
         AND id NOT IN (
           SELECT id FROM conversation_history
           WHERE conversation_id = $1 AND agent_id = $2 AND project_id = $3
           ORDER BY created_at DESC, id DESC
           LIMIT $4
         )",
            )
            .bind(conversation_id)
            .bind(agent_id)
            .bind(project_id)
            .bind(limit)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn get_conversation_history(
        &self,
        conversation_id: &str,
        agent_id: &str,
        project_id: &Uuid,
        _deployment_id: Option<&str>,
        limit: Option<i64>,
    ) -> anyhow::Result<Vec<serde_json::Value>> {
        let query = if let Some(limit) = limit {
            sqlx::query(
                "SELECT id, conversation_id, agent_id, role, content, created_at, agent_run_id
          FROM conversation_history
          WHERE conversation_id = $1 AND agent_id = $2 AND project_id = $3
          ORDER BY created_at DESC, id DESC
          LIMIT $4",
            )
            .bind(conversation_id)
            .bind(agent_id)
            .bind(project_id)
            .bind(limit)
        } else {
            sqlx::query(
                "SELECT id, conversation_id, agent_id, role, content, created_at, agent_run_id
          FROM conversation_history
          WHERE conversation_id = $1 AND agent_id = $2 AND project_id = $3
          ORDER BY created_at DESC, id DESC",
            )
            .bind(conversation_id)
            .bind(agent_id)
            .bind(project_id)
        };

        let rows = query.fetch_all(&self.pool).await?;

        let mut messages = Vec::new();
        for row in rows {
            messages.push(serde_json::json!({
              "id": row.get::<i64, _>("id"),
              "conversation_id": row.get::<String, _>("conversation_id"),
              "agent_id": row.get::<String, _>("agent_id"),
              "role": row.get::<String, _>("role"),
              "content": row.get::<serde_json::Value, _>("content"),
              "created_at": row.get::<DateTime<Utc>, _>("created_at").to_rfc3339(),
              "agent_run_id": row.get::<Option<Uuid>, _>("agent_run_id").map(|id| id.to_string()),
            }));
        }

        // Reverse to get chronological order (oldest first)
        messages.reverse();
        Ok(messages)
    }
}
