use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use crate::api::common::{ErrorResponse, ProjectId};
use crate::db;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct RegisterToolRequest {
    pub id: String,
    pub deployment_id: Option<String>,
    pub tool_type: Option<String>,
    pub description: Option<String>,
    pub parameters: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct RegisterToolResponse {
    pub success: bool,
}

pub async fn register_tool(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Json(req): Json<RegisterToolRequest>,
) -> Result<Json<RegisterToolResponse>, StatusCode> {
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

    let tool_type = req.tool_type.as_deref().unwrap_or("default");

    state
        .db
        .create_or_update_tool_definition(
            &req.id,
            &deployment_id,
            tool_type,
            req.description.as_deref(),
            req.parameters.as_ref(),
            req.metadata.as_ref(),
            &project_id,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to register tool: {}", e);
            if e.to_string().contains("already exists") {
                StatusCode::CONFLICT
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;

    Ok(Json(RegisterToolResponse { success: true }))
}

pub async fn get_tools(
    State(state): State<Arc<AppState>>,
    _jar: CookieJar,
    _headers: HeaderMap,
    ProjectId(project_id): ProjectId,
) -> Result<Json<Vec<db::ToolDefinition>>, (StatusCode, Json<ErrorResponse>)> {
    let tools = state
        .db
        .get_tools_by_project(&project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get tools for project {}: {}", project_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get tools".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(tools))
}

pub async fn get_tool_definition(
    State(state): State<Arc<AppState>>,
    _jar: CookieJar,
    _headers: HeaderMap,
    Path(tool_id): Path<String>,
    ProjectId(project_id): ProjectId,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<db::ToolDefinition>, (StatusCode, Json<ErrorResponse>)> {
    let deployment_id = if let Some(deployment_id_str) = params.get("deployment_id") {
        deployment_id_str.clone()
    } else {
        let deployment = state
            .db
            .get_latest_deployment(&project_id)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get latest deployment: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Failed to get latest deployment".to_string(),
                        error_type: "INTERNAL_ERROR".to_string(),
                    }),
                )
            })?;

        deployment.map(|d| d.id).ok_or_else(|| {
            tracing::error!("No active deployment found");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "No active deployment found".to_string(),
                    error_type: "BAD_REQUEST".to_string(),
                }),
            )
        })?
    };

    let tool_def = state
        .db
        .get_tool_definition(&tool_id, &deployment_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get tool definition: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get tool definition".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    match tool_def {
        Some(def) => Ok(Json(def)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Tool not found".to_string(),
                error_type: "NOT_FOUND".to_string(),
            }),
        )),
    }
}
