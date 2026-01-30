use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::db::Database;

/// Helper method to set project_id session variable in a transaction
/// Note: This sets it for the current transaction, so it must be called within a transaction context
pub async fn set_project_id_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    project_id: &Uuid,
    is_admin: bool,
) -> anyhow::Result<()> {
    sqlx::query("SELECT set_config('app.project_id', $1::text, true)")
        .bind(project_id.to_string())
        .execute(&mut **tx)
        .await?;
    sqlx::query("SELECT set_config('app.is_admin', $1::text, true)")
        .bind(is_admin.to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Helper method to validate project_id exists
pub async fn validate_project_id(pool: &PgPool, project_id: &Uuid) -> anyhow::Result<bool> {
    let result =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)")
            .bind(project_id)
            .fetch_one(pool)
            .await?;
    Ok(result)
}

/// Helper method to get project_id from execution_id
pub async fn get_project_id_from_execution(
    pool: &PgPool,
    execution_id: &Uuid,
) -> anyhow::Result<Uuid> {
    let project_id =
        sqlx::query_scalar::<_, Uuid>("SELECT project_id FROM workflow_executions WHERE id = $1")
            .bind(execution_id)
            .fetch_one(pool)
            .await?;
    Ok(project_id)
}

/// Helper method to get project_id from worker_id
pub async fn get_project_id_from_worker(pool: &PgPool, worker_id: &Uuid) -> anyhow::Result<Uuid> {
    let project_id = sqlx::query_scalar::<_, Uuid>("SELECT project_id FROM workers WHERE id = $1")
        .bind(worker_id)
        .fetch_one(pool)
        .await?;
    Ok(project_id)
}

// Wrapper methods on Database for common functions
impl Database {
    pub async fn validate_project_id(&self, project_id: &Uuid) -> anyhow::Result<bool> {
        validate_project_id(&self.pool, project_id).await
    }

    pub async fn set_project_id(&self, _project_id: &Uuid, _is_admin: bool) -> anyhow::Result<()> {
        // For connection pool, we need to set it per connection
        // Since connections are reused, we'll set it at the start of each query
        // For now, this is a no-op - we'll set it in each database method instead
        // This method is kept for compatibility but the actual setting happens in methods
        Ok(())
    }

    pub async fn get_project_id_from_execution(&self, execution_id: &Uuid) -> anyhow::Result<Uuid> {
        get_project_id_from_execution(&self.pool, execution_id).await
    }

    pub async fn get_project_id_from_worker(&self, worker_id: &Uuid) -> anyhow::Result<Uuid> {
        get_project_id_from_worker(&self.pool, worker_id).await
    }
}
