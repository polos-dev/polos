use anyhow::{Context, Result};
use sqlx::PgPool;
use uuid::Uuid;

use crate::utils;

pub async fn create_default_user_and_project(pool: &PgPool) -> Result<(String, Uuid, String)> {
    // Check if default user already exists
    let existing_user: Option<(String,)> =
        sqlx::query_as("SELECT id FROM users WHERE email = 'user@local'")
            .fetch_optional(pool)
            .await?;

    let user_id = if let Some((id,)) = existing_user {
        tracing::info!("Default user already exists: {}", id);
        id
    } else {
        // Create default user
        let user_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO users (id, email, first_name, last_name, display_name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())"
        )
        .bind(&user_id)
        .bind("user@local")
        .bind("User")
        .bind("Local")
        .bind("User")
        .execute(pool)
        .await
        .context("Failed to create default user")?;

        tracing::info!("Created default user: {}", user_id);
        user_id
    };

    // Check if default project already exists
    let existing_project: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM projects WHERE name = 'default'")
            .fetch_optional(pool)
            .await?;

    let project_id = if let Some((id,)) = existing_project {
        tracing::info!("Default project already exists: {}", id);
        id
    } else {
        // Create default project
        let project_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO projects (id, name, description, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())",
        )
        .bind(project_id)
        .bind("default")
        .bind("Default project for local development")
        .execute(pool)
        .await
        .context("Failed to create default project")?;

        // Add user as admin member
        let member_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
             VALUES ($1, $2, $3, $4::project_role, NOW(), NOW())
             ON CONFLICT (user_id, project_id) DO UPDATE
             SET role = $4::project_role, updated_at = NOW()",
        )
        .bind(&member_id)
        .bind(&user_id)
        .bind(project_id)
        .bind("ADMIN") // Cast to project_role enum
        .execute(pool)
        .await
        .context("Failed to add user to project")?;

        tracing::info!("Created default project: {}", project_id);
        project_id
    };

    // Generate API key for the project
    let api_key = utils::generate_api_key();
    let key_hash = utils::hash_api_key(&api_key).context("Failed to hash API key")?;
    let last_four_digits = api_key
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();

    // Check if API key already exists for this project
    let existing_key: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM api_keys WHERE project_id = $1 AND name = 'default'")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;

    if existing_key.is_none() {
        sqlx::query(
            "INSERT INTO api_keys (id, name, key_hash, last_four_digits, project_id, created_by_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())"
        )
        .bind(Uuid::new_v4())
        .bind("default")
        .bind(&key_hash)
        .bind(&last_four_digits)
        .bind(project_id)
        .bind(&user_id)
        .execute(pool)
        .await
        .context("Failed to create API key")?;

        tracing::info!("Created API key for default project");
    } else {
        tracing::info!("API key already exists for default project");
    }

    Ok((user_id, project_id, api_key))
}
