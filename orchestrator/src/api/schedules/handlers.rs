use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

use crate::api::common::ProjectId;
use crate::AppState;

/// Request to create a schedule
#[derive(Deserialize, ToSchema)]
pub struct CreateScheduleRequest {
    /// Workflow ID to schedule
    pub workflow_id: String,
    /// Cron expression (e.g., "0 * * * *" for every hour)
    pub cron: String,
    /// Timezone (e.g., "America/New_York")
    pub timezone: String,
    /// Unique key for the schedule
    pub key: String,
}

/// Response after creating a schedule
#[derive(Serialize, ToSchema)]
pub struct CreateScheduleResponse {
    /// Created schedule ID
    pub schedule_id: String,
}

/// Schedule details
#[derive(Serialize, ToSchema)]
pub struct ScheduleResponse {
    /// Schedule ID
    pub id: String,
    /// Workflow ID
    pub workflow_id: String,
    /// Cron expression
    pub cron: String,
    /// Timezone
    pub timezone: String,
    /// Unique key
    pub key: String,
    /// Status (active, paused)
    pub status: String,
    /// Last run timestamp (RFC3339)
    pub last_run_at: Option<String>,
    /// Next run timestamp (RFC3339)
    pub next_run_at: String,
    /// Creation timestamp (RFC3339)
    pub created_at: String,
    /// Last update timestamp (RFC3339)
    pub updated_at: String,
}

/// Response for getting schedules
#[derive(Serialize, ToSchema)]
pub struct GetSchedulesResponse {
    /// List of schedules
    pub schedules: Vec<ScheduleResponse>,
}

/// Response for getting scheduled workflow IDs
#[derive(Serialize, ToSchema)]
pub struct GetScheduledWorkflowsResponse {
    /// List of workflow IDs with schedules
    pub workflow_ids: Vec<String>,
}

/// Create a schedule for a workflow
#[utoipa::path(
    post,
    path = "/api/v1/schedules",
    tag = "Schedules",
    request_body = CreateScheduleRequest,
    params(
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Schedule created", body = CreateScheduleResponse),
        (status = 400, description = "Workflow is not schedulable"),
        (status = 404, description = "Project not found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn create_schedule(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Json(req): Json<CreateScheduleRequest>,
) -> Result<Json<CreateScheduleResponse>, StatusCode> {
    tracing::info!("Creating schedule for workflow: {}", req.workflow_id);
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

    tracing::info!("Setting project_id: {}", project_id);
    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tracing::info!("Checking if workflow is schedulable: {}", req.workflow_id);
    let is_schedulable = state
        .db
        .is_workflow_schedulable(&req.workflow_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to check if workflow is schedulable: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tracing::info!("Is schedulable: {}", is_schedulable);
    if !is_schedulable {
        return Err(StatusCode::BAD_REQUEST);
    }

    tracing::info!("Creating or updating schedule: {}", req.workflow_id);
    let schedule_id = state
        .db
        .create_or_update_schedule(
            &req.workflow_id,
            &req.cron,
            &req.timezone,
            &req.key,
            &project_id,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to create schedule: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tracing::info!("Schedule created: {}", schedule_id);
    Ok(Json(CreateScheduleResponse {
        schedule_id: schedule_id.to_string(),
    }))
}

/// Get all schedules for a workflow
#[utoipa::path(
    get,
    path = "/api/v1/schedules/workflows/{workflow_id}",
    tag = "Schedules",
    params(
        ("workflow_id" = String, Path, description = "Workflow ID")
    ),
    responses(
        (status = 200, description = "List of schedules", body = GetSchedulesResponse),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_schedules_for_workflow(
    State(state): State<Arc<AppState>>,
    Path(workflow_id): Path<String>,
) -> Result<Json<GetSchedulesResponse>, StatusCode> {
    let schedules = state
        .db
        .get_schedules_for_workflow(&workflow_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get schedules for workflow: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let schedule_responses: Vec<ScheduleResponse> = schedules
        .iter()
        .map(|s| ScheduleResponse {
            id: s.id.to_string(),
            workflow_id: s.workflow_id.clone(),
            cron: s.cron.clone(),
            timezone: s.timezone.clone(),
            key: s.key.clone(),
            status: s.status.clone(),
            last_run_at: s.last_run_at.map(|dt| dt.to_rfc3339()),
            next_run_at: s.next_run_at.to_rfc3339(),
            created_at: s.created_at.to_rfc3339(),
            updated_at: s.updated_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(GetSchedulesResponse {
        schedules: schedule_responses,
    }))
}

/// Get all workflows that have schedules
#[utoipa::path(
    get,
    path = "/api/v1/schedules/workflows",
    tag = "Schedules",
    responses(
        (status = 200, description = "List of workflow IDs", body = GetScheduledWorkflowsResponse),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_scheduled_workflows(
    State(state): State<Arc<AppState>>,
) -> Result<Json<GetScheduledWorkflowsResponse>, StatusCode> {
    let workflow_ids = state.db.get_scheduled_workflows().await.map_err(|e| {
        tracing::error!("Failed to get scheduled workflows: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(GetScheduledWorkflowsResponse { workflow_ids }))
}
