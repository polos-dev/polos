// API key-related database operations
use uuid::Uuid;

use crate::db::{models::ApiKey, Database};

impl Database {
    pub async fn list_api_keys_by_project(&self, project_id: &Uuid) -> anyhow::Result<Vec<ApiKey>> {
        let keys = sqlx::query_as::<_, ApiKey>(
      "SELECT id, name, key_hash, last_four_digits, project_id, created_by_id, created_at, updated_at, last_used_at
       FROM api_keys
       WHERE project_id = $1
       ORDER BY created_at DESC"
    )
    .bind(project_id)
    .fetch_all(&self.pool)
    .await?;
        Ok(keys)
    }

    pub async fn get_api_key_by_id(&self, key_id: &Uuid) -> anyhow::Result<Option<ApiKey>> {
        let key = sqlx::query_as::<_, ApiKey>(
      "SELECT id, name, key_hash, last_four_digits, project_id, created_by_id, created_at, updated_at, last_used_at
       FROM api_keys
       WHERE id = $1"
    )
    .bind(key_id)
    .fetch_optional(&self.pool)
    .await?;
        Ok(key)
    }

    pub async fn get_api_key_by_name(
        &self,
        project_id: &Uuid,
        name: &str,
    ) -> anyhow::Result<Option<ApiKey>> {
        let key = sqlx::query_as::<_, ApiKey>(
      "SELECT id, name, key_hash, last_four_digits, project_id, created_by_id, created_at, updated_at, last_used_at
       FROM api_keys
       WHERE project_id = $1 AND name = $2"
    )
    .bind(project_id)
    .bind(name)
    .fetch_optional(&self.pool)
    .await?;
        Ok(key)
    }

    pub async fn get_api_key_by_hash(&self, key_hash: &str) -> anyhow::Result<Option<ApiKey>> {
        let key = sqlx::query_as::<_, ApiKey>(
      "SELECT id, name, key_hash, last_four_digits, project_id, created_by_id, created_at, updated_at, last_used_at
       FROM api_keys
       WHERE key_hash = $1"
    )
    .bind(key_hash)
    .fetch_optional(&self.pool)
    .await?;
        Ok(key)
    }

    pub async fn count_api_keys_by_project(&self, project_id: &Uuid) -> anyhow::Result<i64> {
        let count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM api_keys WHERE project_id = $1")
                .bind(project_id)
                .fetch_one(&self.pool)
                .await?;
        Ok(count)
    }

    pub async fn create_api_key(
        &self,
        name: &str,
        key_hash: &str,
        last_four_digits: &str,
        project_id: &Uuid,
        created_by_id: Option<&str>,
    ) -> anyhow::Result<ApiKey> {
        let key = sqlx::query_as::<_, ApiKey>(
      "INSERT INTO api_keys (name, key_hash, last_four_digits, project_id, created_by_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, key_hash, last_four_digits, project_id, created_by_id, created_at, updated_at, last_used_at"
    )
    .bind(name)
    .bind(key_hash)
    .bind(last_four_digits)
    .bind(project_id)
    .bind(created_by_id)
    .fetch_one(&self.pool)
    .await?;
        Ok(key)
    }

    pub async fn delete_api_key(&self, key_id: &Uuid) -> anyhow::Result<bool> {
        let result = sqlx::query("DELETE FROM api_keys WHERE id = $1")
            .bind(key_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn update_api_key_last_used(&self, key_id: &Uuid) -> anyhow::Result<()> {
        sqlx::query("UPDATE api_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1")
            .bind(key_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
