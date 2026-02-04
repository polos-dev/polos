use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::auth::helpers::{check_user_and_project_access, get_current_user};
use crate::api::common::ErrorResponse;
use crate::db::models::ProjectRole;
use crate::AppState;

/// Request to create a new project
#[derive(Deserialize, ToSchema)]
pub struct CreateProjectRequest {
    /// Project name
    name: String,
    /// Optional project description
    description: Option<String>,
}

/// Project details response
#[derive(Serialize, ToSchema)]
pub struct ProjectResponse {
    /// Project ID
    id: String,
    /// Project name
    name: String,
    /// Optional project description
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    /// Creation timestamp (RFC3339)
    created_at: String,
    /// Last update timestamp (RFC3339)
    updated_at: String,
}

/// List of projects response
#[derive(Serialize, ToSchema)]
pub struct ProjectsResponse {
    /// List of projects
    projects: Vec<ProjectResponse>,
}

/// Create a new project
#[utoipa::path(
    post,
    path = "/api/v1/projects",
    tag = "Projects",
    request_body = CreateProjectRequest,
    responses(
        (status = 200, description = "Project created successfully", body = ProjectResponse),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn create_project(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(body): Json<CreateProjectRequest>,
) -> Result<Json<ProjectResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Get current user
    let user = get_current_user(&state, &jar, &headers)
        .await
        .map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "Not authenticated".to_string(),
                    error_type: "UNAUTHORIZED".to_string(),
                }),
            )
        })?;

    // Create project and add user as ADMIN in a single transaction
    let project = state
        .db
        .create_project_with_admin(&body.name, body.description.as_deref(), &user.id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create project with admin: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to create project: {}", e),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(ProjectResponse {
        id: project.id.to_string(),
        name: project.name,
        description: project.description,
        created_at: project.created_at.to_rfc3339(),
        updated_at: project.updated_at.to_rfc3339(),
    }))
}

/// Get all projects for the current user
#[utoipa::path(
    get,
    path = "/api/v1/projects",
    tag = "Projects",
    responses(
        (status = 200, description = "List of projects", body = ProjectsResponse),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_projects(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<Json<ProjectsResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Get current user
    let user = get_current_user(&state, &jar, &headers)
        .await
        .map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "Not authenticated".to_string(),
                    error_type: "UNAUTHORIZED".to_string(),
                }),
            )
        })?;

    // Get projects for user
    let projects = state
        .db
        .get_projects_for_user(&user.id)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get projects".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    let projects_response: Vec<ProjectResponse> = projects
        .into_iter()
        .map(|p| ProjectResponse {
            id: p.id.to_string(),
            name: p.name,
            description: p.description,
            created_at: p.created_at.to_rfc3339(),
            updated_at: p.updated_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(ProjectsResponse {
        projects: projects_response,
    }))
}

/// Get a project by ID
#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_id}",
    tag = "Projects",
    params(
        ("project_id" = String, Path, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Project details", body = ProjectResponse),
        (status = 400, description = "Invalid project ID", body = ErrorResponse),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 403, description = "Access forbidden", body = ErrorResponse),
        (status = 404, description = "Project not found", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_project_by_id(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(project_id): Path<String>,
) -> Result<Json<ProjectResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Get current user
    let user = get_current_user(&state, &jar, &headers)
        .await
        .map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "Not authenticated".to_string(),
                    error_type: "UNAUTHORIZED".to_string(),
                }),
            )
        })?;

    // Parse project_id
    let project_uuid = uuid::Uuid::parse_str(&project_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid project ID".to_string(),
                error_type: "BAD_REQUEST".to_string(),
            }),
        )
    })?;

    // Check if user has access to the project
    let member = state
        .db
        .get_project_member(&user.id, &project_uuid)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to check project access".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    if member.is_none() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "Access to project forbidden".to_string(),
                error_type: "PROJECT_ACCESS_FORBIDDEN".to_string(),
            }),
        ));
    }

    // Get project
    let project = state
        .db
        .get_project_by_id(&project_uuid)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get project".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?
        .ok_or((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Project not found".to_string(),
                error_type: "NOT_FOUND".to_string(),
            }),
        ))?;

    Ok(Json(ProjectResponse {
        id: project.id.to_string(),
        name: project.name,
        description: project.description,
        created_at: project.created_at.to_rfc3339(),
        updated_at: project.updated_at.to_rfc3339(),
    }))
}

/// Project member details
#[derive(Serialize, ToSchema)]
pub struct ProjectMemberResponse {
    /// Member ID
    id: String,
    /// User ID
    user_id: String,
    /// User details
    user: Option<UserInfo>,
    /// Role (Admin, Write, Read)
    role: String,
    /// Creation timestamp (RFC3339)
    created_at: String,
    /// Last update timestamp (RFC3339)
    updated_at: String,
}

/// User information
#[derive(Serialize, ToSchema)]
pub struct UserInfo {
    /// User ID
    id: String,
    /// User's email address
    email: String,
    /// User's first name
    #[serde(skip_serializing_if = "Option::is_none")]
    first_name: Option<String>,
    /// User's last name
    #[serde(skip_serializing_if = "Option::is_none")]
    last_name: Option<String>,
    /// User's display name
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
}

/// Get all members of a project
#[utoipa::path(
    get,
    path = "/api/v1/projects/{project_id}/members",
    tag = "Projects",
    params(
        ("project_id" = String, Path, description = "Project ID")
    ),
    responses(
        (status = 200, description = "List of project members", body = Vec<ProjectMemberResponse>),
        (status = 400, description = "Invalid project ID", body = ErrorResponse),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 403, description = "Access forbidden", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_project_members(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<ProjectMemberResponse>>, (StatusCode, Json<ErrorResponse>)> {
    // Parse project_id
    let project_uuid = Uuid::parse_str(&project_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid project ID".to_string(),
                error_type: "BAD_REQUEST".to_string(),
            }),
        )
    })?;

    // Check if user has access to the project
    check_user_and_project_access(&state, &jar, &headers, &project_uuid).await?;

    // Get project members with user information
    let rows = sqlx::query(
        "SELECT 
       pm.id, 
       pm.user_id, 
       pm.project_id, 
       pm.role, 
       pm.created_at, 
       pm.updated_at,
       u.id as u_id,
       u.email,
       u.first_name,
       u.last_name,
       u.display_name
     FROM project_members pm
     LEFT JOIN users u ON pm.user_id = u.id
     WHERE pm.project_id = $1
     ORDER BY pm.created_at ASC",
    )
    .bind(project_uuid)
    .fetch_all(&state.db.pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get project members: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to get project members".to_string(),
                error_type: "INTERNAL_ERROR".to_string(),
            }),
        )
    })?;

    let members: Vec<ProjectMemberResponse> = rows
        .into_iter()
        .map(|row| {
            let user_id: String = row.get("user_id");
            let u_id: Option<String> = row.get("u_id");

            let user = u_id.map(|id| UserInfo {
                id,
                email: row.get("email"),
                first_name: row.get("first_name"),
                last_name: row.get("last_name"),
                display_name: row.get("display_name"),
            });

            let role_enum: ProjectRole = row.get("role");
            let role_str = match role_enum {
                ProjectRole::Admin => "Admin",
                ProjectRole::Write => "Write",
                ProjectRole::Read => "Read",
            };

            ProjectMemberResponse {
                id: row.get("id"),
                user_id,
                user,
                role: role_str.to_string(),
                created_at: row
                    .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                    .to_rfc3339(),
                updated_at: row
                    .get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
                    .to_rfc3339(),
            }
        })
        .collect();

    Ok(Json(members))
}
