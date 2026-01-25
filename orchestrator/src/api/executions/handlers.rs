use axum::{
  extract::{Path, State},
  http::{HeaderMap, StatusCode},
  Json,
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::api::auth::helpers::authenticate_and_validate_execution_project;
use crate::api::common::{ErrorResponse, ProjectId};
use crate::api::workers::try_dispatch_execution;
use crate::db;
use crate::AppState;

#[derive(Deserialize)]
pub struct SubmitWorkflowRequest {
  payload: serde_json::Value,
  deployment_id: Option<String>,
  parent_execution_id: Option<String>,
  root_execution_id: Option<String>,
  step_key: Option<String>,
  queue_name: Option<String>,
  concurrency_key: Option<String>,
  queue_concurrency_limit: Option<i32>,
  wait_for_subworkflow: Option<bool>,
  session_id: Option<String>,
  user_id: Option<String>,
  otel_traceparent: Option<String>,
  initial_state: Option<serde_json::Value>,
  run_timeout_seconds: Option<i32>, // Timeout in seconds, default 3600 (60 minutes)
}

#[derive(Serialize)]
pub struct SubmitWorkflowResponse {
  execution_id: String,
  created_at: String,
}

#[derive(Deserialize)]
pub struct SubmitWorkflowsRequest {
  workflows: Vec<WorkflowRequest>,
  deployment_id: Option<String>,
  step_key: Option<String>,
  parent_execution_id: Option<String>,
  root_execution_id: Option<String>,
  session_id: Option<String>,
  user_id: Option<String>,
  wait_for_subworkflow: Option<bool>,
  otel_traceparent: Option<String>,
}

#[derive(Deserialize)]
pub struct WorkflowRequest {
  workflow_id: String,
  payload: serde_json::Value,
  queue_name: Option<String>,
  concurrency_key: Option<String>,
  queue_concurrency_limit: Option<i32>,
  initial_state: Option<serde_json::Value>,
  run_timeout_seconds: Option<i32>, // Timeout in seconds, default 3600 (60 minutes)
}

#[derive(Serialize)]
pub struct SubmitWorkflowsResponse {
  executions: Vec<SubmitWorkflowResponse>,
}

#[derive(Serialize)]
pub struct ExecutionResponse {
  id: String,
  workflow_id: String,
  status: String,
  payload: serde_json::Value,
  result: Option<serde_json::Value>,
  error: Option<String>,
  created_at: String,
  started_at: Option<String>,
  completed_at: Option<String>,
  deployment_id: Option<String>,
  assigned_to_worker: Option<String>,
  parent_execution_id: Option<String>,
  root_execution_id: Option<String>,
  retry_count: i32,
  step_key: Option<String>,
  queue_name: Option<String>,
  concurrency_key: Option<String>,
  batch_id: Option<String>,
  session_id: Option<String>,
  user_id: Option<String>,
  output_schema_name: Option<String>,
  cancelled_at: Option<String>,
  cancelled_by: Option<String>,
  run_timeout_seconds: Option<i32>,
}

#[derive(Deserialize)]
pub struct CompleteExecutionRequest {
  result: serde_json::Value,
  output_schema_name: Option<String>,
  worker_id: String,
  final_state: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct FailExecutionRequest {
  error: String,
  #[allow(dead_code)]
  stack: Option<String>,
  retryable: Option<bool>,
  worker_id: String,
  final_state: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct ResumeExecutionRequest {
  pub step_key: String,
  pub data: serde_json::Value,
}

#[derive(Deserialize)]
pub struct StoreStepOutputRequest {
  step_key: String,
  outputs: Option<serde_json::Value>,
  error: Option<serde_json::Value>,
  success: Option<bool>,
  source_execution_id: Option<String>,
  output_schema_name: Option<String>,
}

#[derive(Serialize)]
pub struct GetStepOutputResponse {
  step_key: String,
  outputs: Option<serde_json::Value>,
  error: Option<serde_json::Value>,
  success: Option<bool>,
  source_execution_id: Option<String>,
  output_schema_name: Option<String>,
}

#[derive(Serialize)]
pub struct StepOutput {
  step_key: String,
  outputs: Option<serde_json::Value>,
  error: Option<serde_json::Value>,
  success: Option<bool>,
  source_execution_id: Option<String>,
}

#[derive(Serialize)]
pub struct GetAllStepOutputsResponse {
  steps: Vec<StepOutput>,
}

#[derive(Deserialize)]
pub struct SetWaitingRequest {
  step_key: String,
  wait_until: Option<String>,
  wait_type: String,
  wait_topic: Option<String>,
  expires_at: Option<String>,
}

#[derive(Serialize)]
pub struct SetWaitingResponse {
  execution_id: String,
}

#[derive(Deserialize)]
pub struct UpdateExecutionOtelSpanIdRequest {
  otel_span_id: Option<String>,
}

pub async fn submit_workflow(
  State(state): State<Arc<AppState>>,
  ProjectId(project_id): ProjectId,
  Path(workflow_id): Path<String>,
  Json(req): Json<SubmitWorkflowRequest>,
) -> Result<Json<SubmitWorkflowResponse>, StatusCode> {
  tracing::info!(
    "Submitting workflow: {} for project: {}",
    workflow_id,
    project_id
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

  tracing::info!("Using deployment: {}", deployment_id);

  let parent_execution_id = req
    .parent_execution_id
    .and_then(|id| Uuid::parse_str(&id).ok());
  let root_execution_id = req
    .root_execution_id
    .and_then(|id| Uuid::parse_str(&id).ok());

  let mut session_id = req.session_id.clone();
  let mut user_id = req.user_id.clone();

  if session_id.is_none() || user_id.is_none() {
    if let Some(parent_id) = parent_execution_id {
      if let Ok(parent_exec) = state.db.get_execution(&parent_id).await {
        if session_id.is_none() {
          session_id = parent_exec.session_id;
        }
        if user_id.is_none() {
          user_id = parent_exec.user_id;
        }
      }
    }
  }

  if session_id.is_none() && parent_execution_id.is_none() {
    session_id = Some(Uuid::new_v4().to_string());
  }

  let queue_name = req.queue_name.unwrap_or_else(|| workflow_id.clone());

  state
    .db
    .get_or_create_queue(
      &queue_name,
      &deployment_id,
      &project_id,
      req.queue_concurrency_limit,
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to get or create queue {}: {}", queue_name, e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  tracing::debug!(
    "Using queue: {} (deployment: {}) with concurrency_key: {:?}",
    queue_name,
    deployment_id,
    req.concurrency_key
  );

  let wait_for_subworkflow = req.wait_for_subworkflow.unwrap_or(false);
  let (execution_id, created_at) = state
    .db
    .create_execution(
      &workflow_id,
      req.payload,
      &deployment_id,
      parent_execution_id,
      root_execution_id,
      req.step_key.as_deref(),
      queue_name,
      req.concurrency_key,
      wait_for_subworkflow,
      session_id.as_deref(),
      user_id.as_deref(),
      req.otel_traceparent.as_deref(),
      &project_id,
      req.initial_state,
      req.run_timeout_seconds,
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to create execution: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  let state_clone = state.clone();
  tokio::spawn(async move {
    if let Err(e) = try_dispatch_execution(&state_clone).await {
      tracing::error!("Failed to dispatch execution: {}", e);
    }
  });

  Ok(Json(SubmitWorkflowResponse {
    execution_id: execution_id.to_string(),
    created_at: created_at.to_rfc3339(),
  }))
}

pub async fn submit_workflows(
  State(state): State<Arc<AppState>>,
  ProjectId(project_id): ProjectId,
  Json(req): Json<SubmitWorkflowsRequest>,
) -> Result<Json<SubmitWorkflowsResponse>, StatusCode> {
  tracing::info!(
    "Submitting batch of {} workflows for project: {}",
    req.workflows.len(),
    project_id
  );

  if req.workflows.is_empty() {
    return Err(StatusCode::BAD_REQUEST);
  }

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

  tracing::info!("Using deployment: {} for batch submission", deployment_id);

  let batch_id = Uuid::new_v4();

  let parent_execution_id = req
    .parent_execution_id
    .and_then(|id| Uuid::parse_str(&id).ok());
  let root_execution_id = req
    .root_execution_id
    .and_then(|id| Uuid::parse_str(&id).ok());
  let step_key = req.step_key.clone();
  let wait_for_subworkflow = req.wait_for_subworkflow.unwrap_or(false);

  let mut session_id = req.session_id.clone();
  let mut user_id = req.user_id.clone();

  if session_id.is_none() || user_id.is_none() {
    if let Some(parent_id) = parent_execution_id {
      if let Ok(parent_exec) = state.db.get_execution(&parent_id).await {
        if session_id.is_none() {
          session_id = parent_exec.session_id.clone();
        }
        if user_id.is_none() {
          user_id = parent_exec.user_id.clone();
        }
      }
    }
  }

  if session_id.is_none() && parent_execution_id.is_none() {
    session_id = Some(Uuid::new_v4().to_string());
  }

  let mut execution_data_vec = Vec::new();

  for workflow_req in req.workflows {
    let queue_name = workflow_req
      .queue_name
      .clone()
      .unwrap_or_else(|| workflow_req.workflow_id.clone());

    execution_data_vec.push(db::ExecutionData {
      workflow_id: workflow_req.workflow_id,
      payload: workflow_req.payload,
      parent_execution_id,
      root_execution_id,
      step_key: step_key.clone(),
      queue_name: Some(queue_name),
      concurrency_key: workflow_req.concurrency_key,
      queue_concurrency_limit: workflow_req.queue_concurrency_limit,
      wait_for_subworkflow,
      batch_id: Some(batch_id),
      session_id: session_id.clone(),
      user_id: user_id.clone(),
      otel_traceparent: None,
      initial_state: workflow_req.initial_state.clone(),
      run_timeout_seconds: workflow_req.run_timeout_seconds,
    });
  }

  let results = state
    .db
    .create_executions(
      execution_data_vec,
      &deployment_id,
      req.otel_traceparent.as_deref(),
      &project_id,
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to create executions in batch: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  let state_clone = state.clone();
  for (execution_id, _) in &results {
    let execution_id_clone = *execution_id;
    let state_clone_inner = state_clone.clone();
    tokio::spawn(async move {
      if let Err(e) = try_dispatch_execution(&state_clone_inner).await {
        tracing::error!("Failed to dispatch execution {}: {}", execution_id_clone, e);
      }
    });
  }

  let executions: Vec<SubmitWorkflowResponse> = results
    .into_iter()
    .map(|(execution_id, created_at)| SubmitWorkflowResponse {
      execution_id: execution_id.to_string(),
      created_at: created_at.to_rfc3339(),
    })
    .collect();

  Ok(Json(SubmitWorkflowsResponse { executions }))
}

pub async fn get_execution(
  State(state): State<Arc<AppState>>,
  Path(execution_id): Path<String>,
) -> Result<Json<ExecutionResponse>, StatusCode> {
  let execution_id = Uuid::parse_str(&execution_id).map_err(|_| StatusCode::BAD_REQUEST)?;

  let project_id = state
    .db
    .get_project_id_from_execution(&execution_id)
    .await
    .map_err(|e| {
      tracing::error!("Failed to get project_id from execution: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
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
    .get_execution(&execution_id)
    .await
    .map_err(|_| StatusCode::NOT_FOUND)?;

  Ok(Json(ExecutionResponse {
    id: execution.id.to_string(),
    workflow_id: execution.workflow_id,
    status: execution.status,
    payload: execution.payload,
    result: execution.result,
    error: execution.error,
    created_at: execution.created_at.to_rfc3339(),
    started_at: execution.started_at.map(|t| t.to_rfc3339()),
    completed_at: execution.completed_at.map(|t| t.to_rfc3339()),
    deployment_id: execution.deployment_id.map(|id| id.to_string()),
    assigned_to_worker: execution.assigned_to_worker.map(|id| id.to_string()),
    parent_execution_id: execution.parent_execution_id.map(|id| id.to_string()),
    root_execution_id: execution.root_execution_id.map(|id| id.to_string()),
    retry_count: execution.retry_count,
    step_key: execution.step_key,
    queue_name: Some(execution.queue_name.clone()),
    concurrency_key: execution.concurrency_key,
    batch_id: execution.batch_id.map(|id| id.to_string()),
    session_id: execution.session_id,
    user_id: execution.user_id,
    output_schema_name: execution.output_schema_name.clone(),
    cancelled_at: execution.cancelled_at.map(|t| t.to_rfc3339()),
    cancelled_by: execution.cancelled_by.clone(),
    run_timeout_seconds: execution.run_timeout_seconds,
  }))
}

pub async fn complete_execution(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(execution_id): Path<String>,
  Json(req): Json<CompleteExecutionRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
  tracing::info!(
    "[complete_execution API] Received completion request for execution: {}",
    execution_id
  );

  // Authenticate API key and validate execution project
  let (execution_id_uuid, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  tracing::info!(
    "[complete_execution API] Parsed execution_id: {}",
    execution_id_uuid
  );

  let execution = state
    .db
    .get_execution(&execution_id_uuid)
    .await
    .map_err(|e| {
      tracing::error!(
        "[complete_execution API] Execution {} not found: {}",
        execution_id,
        e
      );
      (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
          error: "Execution not found".to_string(),
          error_type: "NOT_FOUND".to_string(),
        }),
      )
    })?;

  tracing::info!("[complete_execution API] Found execution: workflow_id={}, status={}, parent_execution_id={:?}, root_execution_id={:?}", 
    execution.workflow_id, execution.status, execution.parent_execution_id, execution.root_execution_id);

  let worker_id = Uuid::parse_str(&req.worker_id).map_err(|_| {
    (
      StatusCode::BAD_REQUEST,
      Json(ErrorResponse {
        error: "Invalid worker ID".to_string(),
        error_type: "BAD_REQUEST".to_string(),
      }),
    )
  })?;

  if execution.assigned_to_worker != Some(worker_id) {
    tracing::warn!("[complete_execution API] Worker {} attempted to complete execution {} assigned to different worker {:?}", 
      worker_id, execution_id, execution.assigned_to_worker);
    return Err((
      StatusCode::CONFLICT,
      Json(ErrorResponse {
        error: "Execution assigned to different worker".to_string(),
        error_type: "CONFLICT".to_string(),
      }),
    ));
  }

  tracing::info!("[complete_execution API] Calling db.complete_execution");
  let parent_resume_info = state
    .db
    .complete_execution(
      &execution_id_uuid,
      req.result.clone(),
      req.output_schema_name.as_deref(),
      &worker_id,
      req.final_state.clone(),
    )
    .await
    .map_err(|e| {
      tracing::error!(
        "[complete_execution API] Failed to complete execution {}: {}",
        execution_id,
        e
      );
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to complete execution".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  tracing::info!(
    "[complete_execution API] Successfully completed execution {}",
    execution_id_uuid
  );

  if let Some((parent_id, deployment_id)) = parent_resume_info {
    tracing::info!("[complete_execution API] Parent {} was resumed, dispatching for push workers (deployment: {})", parent_id, deployment_id);
    let state_clone = state.clone();
    tokio::spawn(async move {
      if let Err(e) = try_dispatch_execution(&state_clone).await {
        tracing::error!("Failed to dispatch parent execution {}: {}", parent_id, e);
      }
    });
  }

  Ok(StatusCode::OK)
}

pub async fn fail_execution(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(execution_id): Path<String>,
  Json(req): Json<FailExecutionRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
  tracing::info!("Failing execution: {}", execution_id);

  // Authenticate API key and validate execution project
  let (execution_id_uuid, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  let execution = state
    .db
    .get_execution(&execution_id_uuid)
    .await
    .map_err(|e| {
      tracing::error!("Execution {} not found: {}", execution_id, e);
      (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
          error: "Execution not found".to_string(),
          error_type: "NOT_FOUND".to_string(),
        }),
      )
    })?;

  let worker_id = Uuid::parse_str(&req.worker_id).map_err(|_| {
    (
      StatusCode::BAD_REQUEST,
      Json(ErrorResponse {
        error: "Invalid worker ID".to_string(),
        error_type: "BAD_REQUEST".to_string(),
      }),
    )
  })?;

  if execution.assigned_to_worker != Some(worker_id) {
    tracing::warn!(
      "Worker {} attempted to fail execution {} assigned to different worker {:?}",
      worker_id,
      execution_id,
      execution.assigned_to_worker
    );
    return Err((
      StatusCode::CONFLICT,
      Json(ErrorResponse {
        error: "Execution assigned to different worker".to_string(),
        error_type: "CONFLICT".to_string(),
      }),
    ));
  }

  let retryable = req.retryable.unwrap_or(true);

  let max_retries = if !retryable {
    -1
  } else {
    std::env::var("POLOS_MAX_RETRIES")
      .ok()
      .and_then(|s| s.parse::<i32>().ok())
      .unwrap_or(2)
  };

  let (_will_retry, parent_resume_info) = state
    .db
    .fail_execution(
      &execution_id_uuid,
      &req.error,
      max_retries,
      &worker_id,
      req.final_state.clone(),
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to fail execution {}: {}", execution_id, e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to fail execution".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  if let Some((parent_id, deployment_id)) = parent_resume_info {
    tracing::info!(
      "[fail_execution API] Parent {} was resumed, dispatching for push workers (deployment: {})",
      parent_id,
      deployment_id
    );
    let state_clone = state.clone();
    tokio::spawn(async move {
      if let Err(e) = try_dispatch_execution(&state_clone).await {
        tracing::error!("Failed to dispatch parent execution {}: {}", parent_id, e);
      }
    });
  }

  Ok(StatusCode::OK)
}

#[derive(Serialize)]
pub struct CancelExecutionResponse {
  execution_id: String,
  status: String,
  cancelled_at: String,
}

pub async fn cancel_execution(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(execution_id): Path<String>,
) -> Result<Json<CancelExecutionResponse>, (StatusCode, Json<ErrorResponse>)> {
  tracing::info!("Cancelling execution: {}", execution_id);

  // Authenticate API key and validate execution project
  let (execution_id_uuid, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  // Cancel execution in database (recursively cancels all children)
  let executions_to_cancel = state
    .db
    .cancel_execution(&execution_id_uuid, "manual")
    .await
    .map_err(|e| {
      tracing::error!("Failed to cancel execution {}: {}", execution_id, e);
      let status_code = if e.to_string().contains("not found") {
        StatusCode::NOT_FOUND
      } else if e.to_string().contains("cannot be cancelled") {
        StatusCode::BAD_REQUEST
      } else {
        StatusCode::INTERNAL_SERVER_ERROR
      };
      (
        status_code,
        Json(ErrorResponse {
          error: e.to_string(),
          error_type: "CANCELLATION_ERROR".to_string(),
        }),
      )
    })?;

  // Send cancel requests to all workers for all executions being cancelled
  // If no worker is assigned, mark as cancelled directly
  for (exec_id, worker_id_opt, push_endpoint_url_opt) in executions_to_cancel {
    if let (Some(worker_id), Some(push_endpoint_url)) = (worker_id_opt, push_endpoint_url_opt) {
      // Worker is assigned - send cancel request
      let exec_id_clone = exec_id;
      let state_clone = state.clone();
      tokio::spawn(async move {
        match crate::api::workers::send_cancel_request_to_worker(
          &push_endpoint_url,
          &worker_id,
          &exec_id_clone,
        )
        .await
        {
          crate::api::workers::CancelRequestResult::Success => {
            // Cancel request sent successfully
            tracing::info!(
              "Cancel request sent to worker {} for execution {}",
              worker_id,
              exec_id_clone
            );
          }
          crate::api::workers::CancelRequestResult::NotFound => {
            // Execution not found on worker - mark as cancelled
            tracing::info!(
              "Execution {} not found on worker {} - marking as cancelled",
              exec_id_clone,
              worker_id
            );
            if let Err(e) = state_clone
              .db
              .mark_execution_cancelled(&exec_id_clone)
              .await
            {
              tracing::error!(
                "Failed to mark execution {} as cancelled (not found): {}",
                exec_id_clone,
                e
              );
            }
          }
          crate::api::workers::CancelRequestResult::Error(e) => {
            tracing::warn!(
              "Failed to send cancel request to worker {} for execution {}: {:?}",
              worker_id,
              exec_id_clone,
              e
            );
            // Don't fail - execution is already marked pending_cancel in DB
          }
        }
      });
    } else {
      // No worker assigned - mark as cancelled directly
      let exec_id_clone = exec_id;
      let state_clone = state.clone();
      tokio::spawn(async move {
        if let Err(e) = state_clone
          .db
          .mark_execution_cancelled(&exec_id_clone)
          .await
        {
          tracing::warn!(
            "Failed to mark execution {} as cancelled (no worker): {}",
            exec_id_clone,
            e
          );
        } else {
          tracing::info!(
            "Marked execution {} as cancelled (no worker assigned)",
            exec_id_clone
          );
        }
      });
    }
  }

  // Get updated execution to return cancelled_at
  let execution = state
    .db
    .get_execution(&execution_id_uuid)
    .await
    .map_err(|e| {
      tracing::error!("Failed to get cancelled execution {}: {}", execution_id, e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to get execution".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  Ok(Json(CancelExecutionResponse {
    execution_id,
    status: execution.status.clone(),
    cancelled_at: execution
      .cancelled_at
      .map(|dt| dt.to_rfc3339())
      .unwrap_or_else(|| Utc::now().to_rfc3339()),
  }))
}

#[derive(Deserialize)]
pub struct ConfirmCancellationRequest {
  worker_id: String,
}

pub async fn confirm_cancellation(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(execution_id): Path<String>,
  Json(req): Json<ConfirmCancellationRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
  tracing::info!("Confirming cancellation for execution: {}", execution_id);

  // Authenticate API key and validate execution project
  let (execution_id_uuid, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  let worker_id = Uuid::parse_str(&req.worker_id).map_err(|_| {
    (
      StatusCode::BAD_REQUEST,
      Json(ErrorResponse {
        error: "Invalid worker ID".to_string(),
        error_type: "BAD_REQUEST".to_string(),
      }),
    )
  })?;

  // Verify execution is assigned to this worker and is pending_cancel
  let execution = state
    .db
    .get_execution(&execution_id_uuid)
    .await
    .map_err(|e| {
      tracing::error!("Execution {} not found: {}", execution_id, e);
      (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
          error: "Execution not found".to_string(),
          error_type: "NOT_FOUND".to_string(),
        }),
      )
    })?;

  if execution.assigned_to_worker != Some(worker_id) {
    tracing::warn!("Worker {} attempted to confirm cancellation for execution {} assigned to different worker {:?}", 
      worker_id, execution_id, execution.assigned_to_worker);
    return Err((
      StatusCode::CONFLICT,
      Json(ErrorResponse {
        error: "Execution assigned to different worker".to_string(),
        error_type: "CONFLICT".to_string(),
      }),
    ));
  }

  // Check if execution can be cancelled:
  // 1. Status is pending_cancel, OR
  // 2. Execution has timed out (started_at + run_timeout_seconds < NOW())
  let can_cancel = if execution.status == "pending_cancel" {
    true
  } else if let (Some(started_at), Some(run_timeout_seconds)) =
    (execution.started_at, execution.run_timeout_seconds)
  {
    let timeout_duration = ChronoDuration::seconds(run_timeout_seconds as i64);
    let timeout_at = started_at + timeout_duration;
    Utc::now() >= timeout_at
  } else {
    false
  };

  if !can_cancel {
    tracing::warn!(
      "Execution {} cannot be cancelled (status: {}, started_at: {:?}, run_timeout_seconds: {:?})",
      execution_id,
      execution.status,
      execution.started_at,
      execution.run_timeout_seconds
    );
    return Err((
      StatusCode::BAD_REQUEST,
      Json(ErrorResponse {
        error: format!(
          "Execution cannot be cancelled (status: {})",
          execution.status
        ),
        error_type: "BAD_REQUEST".to_string(),
      }),
    ));
  }

  // Mark execution as cancelled
  state
    .db
    .mark_execution_cancelled(&execution_id_uuid)
    .await
    .map_err(|e| {
      tracing::error!(
        "Failed to mark execution {} as cancelled: {}",
        execution_id,
        e
      );
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to mark execution as cancelled".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  tracing::info!(
    "Execution {} confirmed as cancelled by worker {}",
    execution_id,
    worker_id
  );
  Ok(StatusCode::OK)
}

pub async fn resume_execution(
  State(state): State<Arc<AppState>>,
  Path(execution_id): Path<String>,
  Json(req): Json<ResumeExecutionRequest>,
) -> Result<StatusCode, StatusCode> {
  let execution_id_uuid = Uuid::parse_str(&execution_id).map_err(|e| {
    tracing::error!("Invalid execution_id format: {} - {}", execution_id, e);
    StatusCode::BAD_REQUEST
  })?;

  let project_id = state
    .db
    .get_project_id_from_execution(&execution_id_uuid)
    .await
    .map_err(|e| {
      tracing::error!("Failed to get project_id from execution: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  state
    .db
    .set_project_id(&project_id, false)
    .await
    .map_err(|e| {
      tracing::error!("Failed to set project_id: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  let topic = format!("{}/{}/resume", req.step_key, execution_id_uuid);

  let events: Vec<(Option<String>, serde_json::Value, Option<Uuid>, i32)> =
    vec![(Some("resume".to_string()), req.data, None, 0)];

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

pub async fn store_step_output(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(execution_id): Path<String>,
  Json(req): Json<StoreStepOutputRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
  // Authenticate API key and validate execution project
  let (execution_id, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  let source_execution_id = req
    .source_execution_id
    .and_then(|id| Uuid::parse_str(&id).ok());

  state
    .db
    .store_step_output(
      &execution_id,
      &req.step_key,
      req.outputs,
      req.error,
      req.success,
      source_execution_id.as_ref(),
      req.output_schema_name.as_deref(),
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to store step output: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to store step output".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  Ok(StatusCode::OK)
}

pub async fn get_step_output(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path((execution_id, step_key)): Path<(String, String)>,
) -> Result<Json<GetStepOutputResponse>, (StatusCode, Json<ErrorResponse>)> {
  // Authenticate API key and validate execution project
  let (execution_id, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  let step_data = state
    .db
    .get_step_output(&execution_id, &step_key)
    .await
    .map_err(|e| {
      tracing::error!("Failed to get step output: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to get step output".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  match step_data {
    Some(data) => Ok(Json(GetStepOutputResponse {
      step_key: data
        .get("step_key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string(),
      outputs: data.get("outputs").cloned(),
      error: data.get("error").cloned(),
      success: data.get("success").and_then(|v| v.as_bool()),
      source_execution_id: data
        .get("source_execution_id")
        .and_then(|v| v.as_str())
        .map(String::from),
      output_schema_name: data
        .get("output_schema_name")
        .and_then(|v| v.as_str())
        .map(String::from),
    })),
    None => Err((
      StatusCode::NOT_FOUND,
      Json(ErrorResponse {
        error: "Step output not found".to_string(),
        error_type: "NOT_FOUND".to_string(),
      }),
    )),
  }
}

pub async fn get_all_step_outputs(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(execution_id): Path<String>,
) -> Result<Json<GetAllStepOutputsResponse>, (StatusCode, Json<ErrorResponse>)> {
  // Authenticate API key and validate execution project
  let (execution_id, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  let steps = state
    .db
    .get_all_step_outputs(&execution_id)
    .await
    .map_err(|e| {
      tracing::error!("Failed to get step outputs: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to get step outputs".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  Ok(Json(GetAllStepOutputsResponse {
    steps: steps
      .into_iter()
      .map(
        |(step_key, outputs, error, success, source_execution_id)| StepOutput {
          step_key,
          outputs,
          error,
          success,
          source_execution_id: source_execution_id.map(|id| id.to_string()),
        },
      )
      .collect(),
  }))
}

pub async fn set_waiting(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(execution_id): Path<String>,
  Json(req): Json<SetWaitingRequest>,
) -> Result<Json<SetWaitingResponse>, (StatusCode, Json<ErrorResponse>)> {
  // Authenticate API key and validate execution project
  let (execution_id, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  let wait_until = req.wait_until.and_then(|s| {
    DateTime::parse_from_rfc3339(&s)
      .ok()
      .map(|dt| dt.with_timezone(&Utc))
      .or_else(|| {
        chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M:%S%.f")
          .ok()
          .map(|naive| chrono::DateTime::from_naive_utc_and_offset(naive, chrono::Utc))
      })
  });

  let expires_at = req.expires_at.and_then(|s| {
    DateTime::parse_from_rfc3339(&s)
      .ok()
      .map(|dt| dt.with_timezone(&Utc))
      .or_else(|| {
        chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M:%S%.f")
          .ok()
          .map(|naive| chrono::DateTime::from_naive_utc_and_offset(naive, chrono::Utc))
      })
  });

  state
    .db
    .set_waiting(
      &execution_id,
      &req.step_key,
      wait_until,
      Some(&req.wait_type),
      req.wait_topic.as_deref(),
      expires_at,
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to set execution waiting: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to set execution waiting".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  Ok(Json(SetWaitingResponse {
    execution_id: execution_id.to_string(),
  }))
}

pub async fn update_execution_otel_span_id(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Path(execution_id): Path<String>,
  Json(req): Json<UpdateExecutionOtelSpanIdRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
  // Authenticate API key and validate execution project
  let (execution_id, _project_id) =
    authenticate_and_validate_execution_project(&state, &headers, &execution_id).await?;

  state
    .db
    .update_execution_otel_span_id(&execution_id, req.otel_span_id.as_deref())
    .await
    .map_err(|e| {
      tracing::error!("Failed to update execution otel span id: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to update execution otel span id".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  Ok(StatusCode::OK)
}
