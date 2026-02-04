use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;
use utoipa::ToSchema;

use crate::api::common::ProjectId;
use crate::AppState;

/// Request to register a workflow in a deployment
#[derive(Deserialize, ToSchema)]
pub struct RegisterDeploymentWorkflowRequest {
    /// Workflow ID
    pub workflow_id: String,
    /// Workflow type (workflow, agent, tool)
    pub workflow_type: String,
    /// Whether to trigger on events
    pub trigger_on_event: Option<bool>,
    /// Whether the workflow is scheduled
    pub scheduled: Option<bool>,
}

/// Register a workflow in a deployment
#[utoipa::path(
    post,
    path = "/api/v1/workers/deployments/{deployment_id}/workflows",
    tag = "Deployments",
    request_body = RegisterDeploymentWorkflowRequest,
    params(
        ("deployment_id" = String, Path, description = "Deployment ID"),
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Workflow registered in deployment"),
        (status = 400, description = "Invalid workflow type"),
        (status = 404, description = "Project not found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn register_deployment_workflow(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Path(deployment_id): Path<String>,
    Json(req): Json<RegisterDeploymentWorkflowRequest>,
) -> Result<StatusCode, StatusCode> {
    tracing::debug!(
    "Register deployment workflow request: workflow_id={}, workflow_type={}, trigger_on_event={:?}",
    req.workflow_id,
    req.workflow_type,
    req.trigger_on_event
  );

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

    if !["workflow", "agent", "tool"].contains(&req.workflow_type.as_str()) {
        tracing::error!("Invalid workflow_type: {}", req.workflow_type);
        return Err(StatusCode::BAD_REQUEST);
    }

    state
        .db
        .register_deployment_workflow_with_type(
            &deployment_id,
            &req.workflow_id,
            &req.workflow_type,
            req.trigger_on_event.unwrap_or(false),
            req.scheduled.unwrap_or(false),
            &project_id,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to register deployment workflow: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tracing::info!(
        "Registered {} {} in deployment {} for project: {}",
        req.workflow_type,
        req.workflow_id,
        deployment_id,
        project_id
    );
    Ok(StatusCode::OK)
}

/// Get a deployment by ID
#[utoipa::path(
    get,
    path = "/api/v1/deployments/{deployment_id}",
    tag = "Deployments",
    params(
        ("deployment_id" = String, Path, description = "Deployment ID"),
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Deployment details"),
        (status = 404, description = "Deployment not found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_deployment(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Path(deployment_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let deployment = state
        .db
        .get_deployment(&deployment_id, &project_id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(serde_json::json!({
      "id": deployment.id,
      "project_id": deployment.project_id,
      "status": deployment.status,
      "created_at": deployment.created_at.to_rfc3339()
    })))
}
