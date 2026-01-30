// Deployment-related database operations
use sqlx::Row;
use uuid::Uuid;

use crate::db::{models::Deployment, Database};

impl Database {
    pub async fn create_deployment(
        &self,
        deployment_id: &str,
        project_id: &Uuid,
    ) -> anyhow::Result<String> {
        sqlx::query(
            "INSERT INTO deployments (id, project_id, status) 
        VALUES ($1, $2, $3)
        ON CONFLICT (id, project_id) DO UPDATE SET status = $3",
        )
        .bind(deployment_id)
        .bind(project_id)
        .bind("active")
        .execute(&self.pool)
        .await?;

        Ok(deployment_id.to_string())
    }

    pub async fn get_deployment(
        &self,
        deployment_id: &str,
        project_id: &Uuid,
    ) -> anyhow::Result<Deployment> {
        let row = sqlx::query(
            "SELECT id, project_id, status, created_at 
        FROM deployments WHERE id = $1 AND project_id = $2",
        )
        .bind(deployment_id)
        .bind(project_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(Deployment {
            id: row.get("id"),
            project_id: row.get("project_id"),
            status: row.get("status"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn register_deployment_workflow_with_type(
        &self,
        deployment_id: &str,
        workflow_id: &str,
        workflow_type: &str,
        trigger_on_event: bool,
        scheduled: bool,
        project_id: &Uuid,
    ) -> anyhow::Result<()> {
        sqlx::query(
      "INSERT INTO deployment_workflows (deployment_id, workflow_id, workflow_type, trigger_on_event, scheduled, project_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       ON CONFLICT (workflow_id, deployment_id, project_id) DO UPDATE SET 
         workflow_type = EXCLUDED.workflow_type,
         trigger_on_event = EXCLUDED.trigger_on_event,
         scheduled = EXCLUDED.scheduled"
    )
    .bind(deployment_id)
    .bind(workflow_id)
    .bind(workflow_type)
    .bind(trigger_on_event)
    .bind(scheduled)
    .bind(project_id)
    .execute(&self.pool)
    .await?;

        Ok(())
    }

    pub async fn create_or_replace_deployment(
        &self,
        deployment_id: &str,
        project_id: &Uuid,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO deployments (id, project_id, status) 
        VALUES ($1, $2, 'active')
        ON CONFLICT (id, project_id) DO UPDATE SET status = 'active'",
        )
        .bind(deployment_id)
        .bind(project_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_latest_deployment(
        &self,
        project_id: &Uuid,
    ) -> anyhow::Result<Option<Deployment>> {
        let row = sqlx::query(
            "SELECT id, project_id, status, created_at 
        FROM deployments 
        WHERE project_id = $1 AND status = 'active'
        ORDER BY created_at DESC 
        LIMIT 1",
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| Deployment {
            id: row.get("id"),
            project_id: row.get("project_id"),
            status: row.get("status"),
            created_at: row.get("created_at"),
        }))
    }

    pub async fn deployment_exists_for_project(
        &self,
        deployment_id: &str,
        project_id: &Uuid,
    ) -> anyhow::Result<bool> {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(1) FROM deployments WHERE id = $1 AND project_id = $2",
        )
        .bind(deployment_id)
        .bind(project_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(count > 0)
    }
}
