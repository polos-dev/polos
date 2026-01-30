// User and project member database operations
use sqlx::QueryBuilder;
use uuid::Uuid;

use crate::db::{
    models::{ProjectMember, ProjectRole, User},
    Database,
};

impl Database {
    #[allow(clippy::too_many_arguments)]
    pub async fn create_user(
        &self,
        id: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
        display_name: &str,
        password_hash: Option<&str>,
        auth_provider: Option<&str>,
        external_id: Option<&str>,
    ) -> anyhow::Result<User> {
        let user = sqlx::query_as::<_, User>(
      "INSERT INTO users (id, email, first_name, last_name, display_name, password_hash, auth_provider, external_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, email, first_name, last_name, display_name, password_hash, auth_provider, external_id, created_at, updated_at"
    )
    .bind(id)
    .bind(email.to_lowercase())
    .bind(first_name)
    .bind(last_name)
    .bind(display_name)
    .bind(password_hash)
    .bind(auth_provider)
    .bind(external_id)
    .fetch_one(&self.pool)
    .await?;
        Ok(user)
    }

    pub async fn get_user_by_email(&self, email: &str) -> anyhow::Result<Option<User>> {
        let user = sqlx::query_as::<_, User>(
      "SELECT id, email, first_name, last_name, display_name, password_hash, auth_provider, external_id, created_at, updated_at
       FROM users
       WHERE email = $1"
    )
    .bind(email.to_lowercase())
    .fetch_optional(&self.pool)
    .await?;
        Ok(user)
    }

    pub async fn get_user_by_id(&self, id: &str) -> anyhow::Result<Option<User>> {
        let user = sqlx::query_as::<_, User>(
      "SELECT id, email, first_name, last_name, display_name, password_hash, auth_provider, external_id, created_at, updated_at
       FROM users
       WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&self.pool)
    .await?;
        Ok(user)
    }

    pub async fn update_user(
        &self,
        id: &str,
        first_name: Option<&str>,
        last_name: Option<&str>,
        display_name: Option<&str>,
        auth_provider: Option<&str>,
        external_id: Option<&str>,
    ) -> anyhow::Result<User> {
        let mut query = QueryBuilder::new("UPDATE users SET updated_at = NOW()");

        if let Some(fn_val) = first_name {
            query.push(", first_name = ").push_bind(fn_val);
        }
        if let Some(ln_val) = last_name {
            query.push(", last_name = ").push_bind(ln_val);
        }
        if let Some(dn_val) = display_name {
            query.push(", display_name = ").push_bind(dn_val);
        }
        if let Some(ap_val) = auth_provider {
            query.push(", auth_provider = ").push_bind(ap_val);
        }
        if let Some(ei_val) = external_id {
            query.push(", external_id = ").push_bind(ei_val);
        }

        query.push(" WHERE id = ").push_bind(id);
        query.push(" RETURNING id, email, first_name, last_name, display_name, password_hash, auth_provider, external_id, created_at, updated_at");

        let user = query.build_query_as::<User>().fetch_one(&self.pool).await?;
        Ok(user)
    }

    // Project member operations
    pub async fn create_project_member(
        &self,
        id: &str,
        user_id: &str,
        project_id: &Uuid,
        role: ProjectRole,
    ) -> anyhow::Result<ProjectMember> {
        let member = sqlx::query_as::<_, ProjectMember>(
            "INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (user_id, project_id) DO UPDATE
       SET role = $4, updated_at = NOW()
       RETURNING id, user_id, project_id, role, created_at, updated_at",
        )
        .bind(id)
        .bind(user_id)
        .bind(project_id)
        .bind(role)
        .fetch_one(&self.pool)
        .await?;
        Ok(member)
    }

    pub async fn get_project_members_by_user(
        &self,
        user_id: &str,
    ) -> anyhow::Result<Vec<ProjectMember>> {
        let members = sqlx::query_as::<_, ProjectMember>(
            "SELECT id, user_id, project_id, role, created_at, updated_at
       FROM project_members
       WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(members)
    }

    pub async fn get_project_members_by_project(
        &self,
        project_id: &Uuid,
    ) -> anyhow::Result<Vec<ProjectMember>> {
        let members = sqlx::query_as::<_, ProjectMember>(
            "SELECT id, user_id, project_id, role, created_at, updated_at
       FROM project_members
       WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(members)
    }

    pub async fn get_project_member(
        &self,
        user_id: &str,
        project_id: &Uuid,
    ) -> anyhow::Result<Option<ProjectMember>> {
        let member = sqlx::query_as::<_, ProjectMember>(
            "SELECT id, user_id, project_id, role, created_at, updated_at
       FROM project_members
       WHERE user_id = $1 AND project_id = $2",
        )
        .bind(user_id)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(member)
    }
}
