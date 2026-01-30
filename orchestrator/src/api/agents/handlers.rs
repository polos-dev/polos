use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use crate::api::auth::helpers::check_user_and_project_access;
use crate::api::common::{ErrorResponse, ProjectId};
use crate::db;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct RegisterAgentRequest {
    pub id: String,
    pub deployment_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub system_prompt: Option<String>,
    pub tools: Option<serde_json::Value>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<i32>,
    pub config: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct RegisterAgentResponse {
    pub success: bool,
}

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
