use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::api::auth::helpers::{
    authenticate_and_validate_execution_project, authenticate_api_v1_request,
};
use crate::api::common::{ErrorResponse, ProjectId};
use crate::AppState;

#[derive(Deserialize)]
pub struct AddConversationHistoryRequest {
    pub agent_id: String,
    pub role: String,
    pub content: serde_json::Value,
    pub agent_run_id: Option<String>,
    pub conversation_history_limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct GetConversationHistoryRequest {
    pub agent_id: String,
    pub deployment_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct GetConversationHistoryResponse {
    pub messages: Vec<serde_json::Value>,
}

pub async fn add_conversation_history(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookie_jar: CookieJar,
    Path(conversation_id): Path<String>,
    Json(req): Json<AddConversationHistoryRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Validate execution project if agent_run_id is provided (middleware already authenticated)
    let (agent_run_id, project_id) = if let Some(run_id_str) = &req.agent_run_id {
        // agent_run_id is execution_id - validate it matches the authenticated project
        let (exec_id, exec_project_id) =
            authenticate_and_validate_execution_project(&state, &headers, &cookie_jar, run_id_str)
                .await?;
        (Some(exec_id), exec_project_id)
    } else {
        // If no agent_run_id, get project_id from authenticated request
        // For API keys, extract from API key; for JWT, require X-Project-ID header
        let api_key_project_id =
            authenticate_api_v1_request(&state, &headers, &cookie_jar, "", true).await?;
        (None, api_key_project_id)
    };

    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to set project_id".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    let deployment_id = if let Some(run_id) = agent_run_id {
        state
            .db
            .get_execution(&run_id)
            .await
            .ok()
            .and_then(|exec| exec.deployment_id)
    } else {
        None
    };

    match state
        .db
        .add_conversation_history(
            &conversation_id,
            &req.agent_id,
            &req.role,
            &req.content,
            agent_run_id.as_ref(),
            req.conversation_history_limit,
            &project_id,
            deployment_id.as_deref(),
        )
        .await
    {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            tracing::error!("Failed to add conversation history: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to add conversation history".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            ))
        }
    }
}

pub async fn get_conversation_history(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Path(conversation_id): Path<String>,
    Query(params): Query<GetConversationHistoryRequest>,
) -> Result<Json<GetConversationHistoryResponse>, StatusCode> {
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

    let deployment_id = if let Some(deployment_id) = params.deployment_id {
        Some(deployment_id)
    } else {
        state
            .db
            .get_latest_deployment_id_for_agent(&params.agent_id, &project_id)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get latest deployment_id for agent: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?
    };

    match state
        .db
        .get_conversation_history(
            &conversation_id,
            &params.agent_id,
            &project_id,
            deployment_id.as_deref(),
            params.limit,
        )
        .await
    {
        Ok(messages) => Ok(Json(GetConversationHistoryResponse { messages })),
        Err(e) => {
            tracing::error!("Failed to get conversation history: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// ── Session memory ───────────────────────────────────────────────────

#[derive(Serialize)]
pub struct GetSessionMemoryResponse {
    pub summary: Option<String>,
    pub messages: serde_json::Value,
}

#[derive(Deserialize)]
pub struct PutSessionMemoryRequest {
    pub summary: Option<String>,
    pub messages: serde_json::Value,
}

pub async fn get_session_memory(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Path(session_id): Path<String>,
) -> Result<Json<GetSessionMemoryResponse>, (StatusCode, Json<ErrorResponse>)> {
    match state.db.get_session_memory(&session_id, &project_id).await {
        Ok(Some(row)) => Ok(Json(GetSessionMemoryResponse {
            summary: row.summary,
            messages: row.messages,
        })),
        Ok(None) => Ok(Json(GetSessionMemoryResponse {
            summary: None,
            messages: serde_json::json!([]),
        })),
        Err(e) => {
            tracing::error!("Failed to get session memory: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get session memory".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            ))
        }
    }
}

pub async fn put_session_memory(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Path(session_id): Path<String>,
    Json(req): Json<PutSessionMemoryRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    match state
        .db
        .put_session_memory(
            &session_id,
            &project_id,
            req.summary.as_deref(),
            &req.messages,
        )
        .await
    {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            tracing::error!("Failed to store session memory: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to store session memory".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            ))
        }
    }
}
