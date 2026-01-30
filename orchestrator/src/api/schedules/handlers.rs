use axum::{
  extract::{Path, State},
  http::StatusCode,
  Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::api::common::ProjectId;
use crate::AppState;

#[derive(Deserialize)]
pub struct CreateScheduleRequest {
  pub workflow_id: String,
  pub cron: String,
  pub timezone: String,
  pub key: String,
}

#[derive(Serialize)]
pub struct CreateScheduleResponse {
  pub schedule_id: String,
}

#[derive(Serialize)]
pub struct ScheduleResponse {
  pub id: String,
  pub workflow_id: String,
  pub cron: String,
  pub timezone: String,
  pub key: String,
  pub status: String,
  pub last_run_at: Option<String>,
  pub next_run_at: String,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Serialize)]
pub struct GetSchedulesResponse {
  pub schedules: Vec<ScheduleResponse>,
}

#[derive(Serialize)]
pub struct GetScheduledWorkflowsResponse {
  pub workflow_ids: Vec<String>,
}

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

pub async fn get_scheduled_workflows(
  State(state): State<Arc<AppState>>,
) -> Result<Json<GetScheduledWorkflowsResponse>, StatusCode> {
  let workflow_ids = state.db.get_scheduled_workflows().await.map_err(|e| {
    tracing::error!("Failed to get scheduled workflows: {}", e);
    StatusCode::INTERNAL_SERVER_ERROR
  })?;

  Ok(Json(GetScheduledWorkflowsResponse { workflow_ids }))
}
