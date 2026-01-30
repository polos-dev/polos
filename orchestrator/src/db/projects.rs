// Project-related database operations
use uuid::Uuid;

use crate::db::{models::Project, Database};

impl Database {
    pub async fn create_project(
        &self,
        name: &str,
        description: Option<&str>,
    ) -> anyhow::Result<Project> {
        let project = sqlx::query_as::<_, Project>(
            "INSERT INTO projects (name, description, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING id, name, description, created_at, updated_at",
        )
        .bind(name)
        .bind(description)
        .fetch_one(&self.pool)
        .await?;
        Ok(project)
    }

    pub async fn create_project_with_admin(
        &self,
        name: &str,
        description: Option<&str>,
        user_id: &str,
    ) -> anyhow::Result<Project> {
        let mut tx = self.pool.begin().await?;

        // Create project
        let project = sqlx::query_as::<_, Project>(
            "INSERT INTO projects (name, description, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING id, name, description, created_at, updated_at",
        )
        .bind(name)
        .bind(description)
        .fetch_one(&mut *tx)
        .await?;

        // Add user as ADMIN member
        let member_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (user_id, project_id) DO UPDATE
       SET role = $4, updated_at = NOW()",
        )
        .bind(&member_id)
        .bind(user_id)
        .bind(project.id)
        .bind(crate::db::models::ProjectRole::Admin)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(project)
    }

    pub async fn get_project_by_id(&self, project_id: &Uuid) -> anyhow::Result<Option<Project>> {
        let project = sqlx::query_as::<_, Project>(
            "SELECT id, name, description, created_at, updated_at
       FROM projects
       WHERE id = $1",
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(project)
    }

    pub async fn get_projects_for_user(&self, user_id: &str) -> anyhow::Result<Vec<Project>> {
        let projects = sqlx::query_as::<_, Project>(
            "SELECT p.id, p.name, p.description, p.created_at, p.updated_at
       FROM projects p
       INNER JOIN project_members pm ON p.id = pm.project_id
       WHERE pm.user_id = $1
       ORDER BY p.created_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(projects)
    }
}
