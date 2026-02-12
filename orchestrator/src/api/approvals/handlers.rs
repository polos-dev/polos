use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;

#[derive(Serialize)]
pub struct ApprovalResponse {
    pub execution_id: String,
    pub step_key: String,
    pub status: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct SubmitApprovalRequest {
    pub data: serde_json::Value,
}

/// Get approval data for a suspended execution step.
/// The execution_id in the URL is the root execution ID.
pub async fn get_approval(
    State(state): State<Arc<AppState>>,
    Path((execution_id, step_key)): Path<(String, String)>,
) -> Result<Json<ApprovalResponse>, StatusCode> {
    let execution_id_uuid = Uuid::parse_str(&execution_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Get project_id from execution and set RLS
    let project_id = state
        .db
        .get_project_id_from_execution(&execution_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get project_id from execution: {}", e);
            StatusCode::NOT_FOUND
        })?;

    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let execution = state
        .db
        .get_execution(&execution_id_uuid)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // If not waiting, return status without data so UI can show "already handled"
    if execution.status != "waiting" {
        return Ok(Json(ApprovalResponse {
            execution_id,
            step_key,
            status: execution.status,
            data: None,
        }));
    }

    // Construct event topic using this execution's workflow_id (this is the root)
    let topic = format!("workflow/{}/{}", execution.workflow_id, execution_id_uuid);

    let events = state
        .db
        .get_events(&topic, &project_id, None, None, 100)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get events for topic {}: {}", topic, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Find the suspend event matching this step_key
    let suspend_event_type = format!("suspend_{}", step_key);
    let suspend_data = events
        .iter()
        .rev() // Most recent first
        .find(|e| {
            e.event_type
                .as_ref()
                .map(|t| t == &suspend_event_type)
                .unwrap_or(false)
        })
        .map(|e| e.data.clone());

    Ok(Json(ApprovalResponse {
        execution_id,
        step_key,
        status: execution.status,
        data: suspend_data,
    }))
}

/// Submit approval response for a suspended execution step (unauthenticated).
/// The execution_id in the URL is the root execution ID.
pub async fn submit_approval(
    State(state): State<Arc<AppState>>,
    Path((execution_id, step_key)): Path<(String, String)>,
    Json(req): Json<SubmitApprovalRequest>,
) -> Result<StatusCode, StatusCode> {
    let execution_id_uuid = Uuid::parse_str(&execution_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Get project_id from execution and set RLS
    let project_id = state
        .db
        .get_project_id_from_execution(&execution_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get project_id from execution: {}", e);
            StatusCode::NOT_FOUND
        })?;

    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Verify execution is still waiting
    let execution = state
        .db
        .get_execution(&execution_id_uuid)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    if execution.status != "waiting" {
        return Err(StatusCode::CONFLICT);
    }

    // Publish resume event
    let topic = format!("workflow/{}/{}", execution.workflow_id, execution_id_uuid);
    let event_type = format!("resume_{}", step_key);
    let events: Vec<(Option<String>, serde_json::Value, Option<Uuid>, i32)> =
        vec![(Some(event_type), req.data, None, 0)];

    state
        .db
        .publish_events_batch(topic, events, None, None, &project_id)
        .await
        .map_err(|e| {
            tracing::error!(
                "Failed to publish resume event for execution {}: {}",
                execution_id_uuid,
                e
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::OK)
}
