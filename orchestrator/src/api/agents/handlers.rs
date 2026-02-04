use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use utoipa::ToSchema;

use crate::api::auth::helpers::check_user_and_project_access;
use crate::api::common::{ErrorResponse, ProjectId};
use crate::db;
use crate::AppState;

/// Request to register an agent definition
#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterAgentRequest {
    /// Agent ID
    pub id: String,
    /// Deployment ID (optional, uses latest if not provided)
    pub deployment_id: Option<String>,
    /// LLM provider (e.g., "openai", "anthropic")
    pub provider: String,
    /// Model name (e.g., "gpt-4", "claude-3")
    pub model: String,
    /// System prompt for the agent
    pub system_prompt: Option<String>,
    /// Tools available to the agent
    pub tools: Option<serde_json::Value>,
    /// Temperature for LLM generation
    pub temperature: Option<f64>,
    /// Maximum output tokens
    pub max_output_tokens: Option<i32>,
    /// Additional configuration
    pub config: Option<serde_json::Value>,
    /// Agent metadata
    pub metadata: Option<serde_json::Value>,
}

/// Response for agent registration
#[derive(Debug, Serialize, ToSchema)]
pub struct RegisterAgentResponse {
    /// Whether registration was successful
    pub success: bool,
}

/// Register an agent definition
#[utoipa::path(
    post,
    path = "/api/v1/agents/register",
    tag = "Agents",
    request_body = RegisterAgentRequest,
    params(
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Agent registered successfully", body = RegisterAgentResponse),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Project not found"),
        (status = 409, description = "Agent already exists"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn register_agent(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Json(req): Json<RegisterAgentRequest>,
) -> Result<Json<RegisterAgentResponse>, StatusCode> {
    let project_exists = state
        .db
        .validate_project_id(&project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to validate project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if !project_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let deployment_id = if let Some(deployment_id_str) = &req.deployment_id {
        deployment_id_str.clone()
    } else {
        let deployment = state
            .db
            .get_latest_deployment(&project_id)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get latest deployment: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

        deployment.map(|d| d.id).ok_or_else(|| {
            tracing::error!("No active deployment found");
            StatusCode::BAD_REQUEST
        })?
    };

    state
        .db
        .create_or_update_agent_definition(
            &req.id,
            &deployment_id,
            &req.provider,
            &req.model,
            req.system_prompt.as_deref(),
            req.tools.as_ref(),
            req.temperature,
            req.max_output_tokens,
            req.config.as_ref(),
            req.metadata.as_ref(),
            &project_id,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to register agent: {}", e);
            if e.to_string().contains("already exists") {
                StatusCode::CONFLICT
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;

    Ok(Json(RegisterAgentResponse { success: true }))
}

/// Get all agents for a project
#[utoipa::path(
    get,
    path = "/api/v1/agents",
    tag = "Agents",
    params(
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "List of agents"),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 403, description = "Access forbidden", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_agents(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    ProjectId(project_id): ProjectId,
) -> Result<Json<Vec<db::AgentDefinition>>, (StatusCode, Json<ErrorResponse>)> {
    check_user_and_project_access(&state, &jar, &headers, &project_id).await?;

    let agents = state
        .db
        .get_agents_by_project(&project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get agents for project {}: {}", project_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get agents".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(agents))
}

/// Get an agent definition by ID
#[utoipa::path(
    get,
    path = "/api/v1/agents/{agent_id}",
    tag = "Agents",
    params(
        ("agent_id" = String, Path, description = "Agent ID"),
        ("X-Project-ID" = String, Header, description = "Project ID"),
        ("deployment_id" = Option<String>, Query, description = "Deployment ID (optional)")
    ),
    responses(
        (status = 200, description = "Agent definition"),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Agent not found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_agent_definition(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Path(agent_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<db::AgentDefinition>, StatusCode> {
    let deployment_id = if let Some(deployment_id_str) = params.get("deployment_id") {
        deployment_id_str.clone()
    } else {
        let deployment = state
            .db
            .get_latest_deployment(&project_id)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get latest deployment: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

        deployment.map(|d| d.id).ok_or_else(|| {
            tracing::error!("No active deployment found");
            StatusCode::BAD_REQUEST
        })?
    };

    let agent_def = state
        .db
        .get_agent_definition(&agent_id, &deployment_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get agent definition: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    match agent_def {
        Some(def) => Ok(Json(def)),
        None => Err(StatusCode::NOT_FOUND),
    }
}
