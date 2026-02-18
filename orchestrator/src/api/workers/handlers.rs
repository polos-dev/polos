use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use reqwest;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::common::ProjectId;
use crate::db;
use crate::AppState;
use anyhow;

/// Request to register a worker
#[derive(Deserialize, ToSchema)]
pub struct RegisterWorkerRequest {
    /// Worker capabilities
    pub capabilities: Option<serde_json::Value>,
    /// Project ID
    pub project_id: String,
    /// Worker mode (push)
    pub mode: Option<String>,
    /// Push endpoint URL for receiving work
    pub push_endpoint_url: Option<String>,
    /// Maximum concurrent executions
    pub max_concurrent_executions: Option<i32>,
    /// Deployment ID (optional, uses latest if not provided)
    pub deployment_id: Option<String>,
}

/// Request to register a deployment for workers
#[derive(Deserialize, ToSchema)]
pub struct RegisterWorkerDeploymentRequest {
    /// Deployment ID
    pub deployment_id: String,
}

/// Response after registering a worker
#[derive(Serialize, ToSchema)]
pub struct RegisterWorkerResponse {
    /// Assigned worker ID
    worker_id: String,
}

#[derive(Serialize)]
pub struct PollWorkflowResponse {
    execution_id: String,
    workflow_id: String,
    deployment_id: Option<String>,
    payload: serde_json::Value,
    parent_execution_id: Option<String>,
    root_execution_id: Option<String>,
    step_key: Option<String>,
    retry_count: i32,
    created_at: String,
    session_id: Option<String>,
    user_id: Option<String>,
    otel_traceparent: Option<String>,
    otel_span_id: Option<String>,
    initial_state: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct PushWorkRequest {
    worker_id: String,
    execution_id: String,
    workflow_id: String,
    deployment_id: Option<String>,
    payload: serde_json::Value,
    parent_execution_id: Option<String>,
    root_execution_id: Option<String>,
    root_workflow_id: Option<String>,
    step_key: Option<String>,
    retry_count: i32,
    created_at: String,
    session_id: Option<String>,
    user_id: Option<String>,
    otel_traceparent: Option<String>,
    otel_span_id: Option<String>,
    initial_state: Option<serde_json::Value>,
    run_timeout_seconds: Option<i32>,
}

#[derive(Debug)]
pub enum PushError {
    Network(reqwest::Error),
    Overloaded,
    Unavailable,
    Failed(StatusCode),
}

impl From<reqwest::Error> for PushError {
    fn from(err: reqwest::Error) -> Self {
        PushError::Network(err)
    }
}

// Push work to a worker endpoint
pub async fn push_work_to_worker(
    worker: &db::Worker,
    execution: &db::Execution,
) -> Result<(), PushError> {
    let endpoint_url = worker
        .push_endpoint_url
        .as_ref()
        .ok_or_else(|| PushError::Failed(StatusCode::BAD_REQUEST))?;

    let client = reqwest::Client::new();
    let timeout = Duration::from_secs(10);

    let payload = PushWorkRequest {
        worker_id: worker.id.to_string(),
        execution_id: execution.id.to_string(),
        workflow_id: execution.workflow_id.clone(),
        deployment_id: execution.deployment_id.clone(),
        payload: execution.payload.clone(),
        parent_execution_id: execution.parent_execution_id.map(|id| id.to_string()),
        root_execution_id: execution.root_execution_id.map(|id| id.to_string()),
        root_workflow_id: execution.root_workflow_id.clone(),
        step_key: execution.step_key.clone(),
        retry_count: execution.retry_count,
        created_at: execution.created_at.to_rfc3339(),
        session_id: execution.session_id.clone(),
        user_id: execution.user_id.clone(),
        otel_traceparent: execution.otel_traceparent.clone(),
        otel_span_id: execution.otel_span_id.clone(),
        initial_state: execution.initial_state.clone(),
        run_timeout_seconds: execution.run_timeout_seconds,
    };

    let response = client
        .post(format!("{}/execute", endpoint_url))
        .header("X-Worker-ID", worker.id.to_string())
        .timeout(timeout)
        .json(&payload)
        .send()
        .await?;

    match response.status().as_u16() {
        200 => Ok(()),
        429 => Err(PushError::Overloaded),
        503 => Err(PushError::Unavailable),
        _ => Err(PushError::Failed(
            StatusCode::from_u16(response.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        )),
    }
}

#[derive(Debug)]
pub enum CancelRequestResult {
    Success,
    NotFound, // Execution not found or already completed
    Error(PushError),
}

pub async fn send_cancel_request_to_worker(
    push_endpoint_url: &str,
    worker_id: &Uuid,
    execution_id: &Uuid,
) -> CancelRequestResult {
    let client = reqwest::Client::new();
    let timeout = Duration::from_secs(30); // 30 second timeout

    let response = match client
        .post(format!("{}/cancel/{}", push_endpoint_url, execution_id))
        .header("X-Worker-ID", worker_id.to_string())
        .timeout(timeout)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => return CancelRequestResult::Error(PushError::Network(e)),
    };

    match response.status().as_u16() {
        200 => CancelRequestResult::Success,
        404 => CancelRequestResult::NotFound, // Execution not found or already completed
        _ => {
            tracing::warn!(
                "Worker cancel request returned status {} for execution {}",
                response.status(),
                execution_id
            );
            CancelRequestResult::Error(PushError::Failed(response.status()))
        }
    }
}

/// Try to dispatch executions to push-based workers (for background dispatcher loop).
/// Loops through all available executions until none remain.
/// Returns Ok(()) on success, Err on error.
pub async fn try_dispatch_execution(state: &AppState) -> anyhow::Result<()> {
    // Process all available executions in this iteration
    let mut processed_count = 0;
    loop {
        // Claim and assign execution in a single transaction
        // Uses SELECT FOR UPDATE SKIP LOCKED to allow multiple orchestrators to work in parallel
        match state.db_bg.claim_and_assign_execution_for_push().await {
            Ok(Some((execution, worker))) => {
                // Successfully claimed and assigned, now push
                match push_work_to_worker(&worker, &execution).await {
                    Ok(()) => {
                        // Push successful - mark execution as running
                        if let Err(e) = state.db_bg.mark_execution_running(&execution.id).await {
                            tracing::error!(
                                "Failed to mark execution {} as running: {}",
                                execution.id,
                                e
                            );
                            // Rollback since we can't mark as running (no error since push succeeded)
                            if let Err(e) = state
                                .db_bg
                                .rollback_execution_assignment(&execution.id, &worker.id, None)
                                .await
                            {
                                tracing::error!(
                                    "Failed to rollback execution {}: {}",
                                    execution.id,
                                    e
                                );
                            }
                            // Continue processing more executions
                            continue;
                        }
                        // Update push status
                        if let Err(e) = state
                            .db_bg
                            .update_worker_push_status(&worker.id, true)
                            .await
                        {
                            tracing::error!("Failed to update worker push status: {}", e);
                        }
                        // Successfully dispatched — small backoff to avoid hogging pool connections
                        processed_count += 1;
                        if processed_count % 10 == 0 {
                            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
                        } else {
                            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                        }
                        continue;
                    }
                    Err(err) => {
                        tracing::error!(
                            "Failed to push work to worker {} for execution {}: {:?}",
                            worker.id,
                            execution.id,
                            err
                        );
                        // Rollback execution assignment with error
                        if let Err(e) = state
                            .db_bg
                            .rollback_execution_assignment(&execution.id, &worker.id, Some(&err))
                            .await
                        {
                            tracing::error!("Failed to rollback execution {}: {}", execution.id, e);
                        }
                        continue;
                    }
                }
            }
            Ok(None) => {
                // No more executions available, break loop
                break;
            }
            Err(e) => {
                // Error claiming execution - log and break to avoid tight error loop
                tracing::error!("Failed to claim and assign execution: {}", e);
                return Err(e);
            }
        }
    }

    Ok(())
}

/// Register a worker
#[utoipa::path(
    post,
    path = "/api/v1/workers/register",
    tag = "Workers",
    request_body = RegisterWorkerRequest,
    responses(
        (status = 200, description = "Worker registered", body = RegisterWorkerResponse),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Project not found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn register_worker(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterWorkerRequest>,
) -> Result<Json<RegisterWorkerResponse>, StatusCode> {
    let worker_id = Uuid::new_v4();
    let project_id = Uuid::parse_str(&req.project_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Validate project_id exists
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

    // Validate mode: must be "push" (default to "push" if not provided)
    let mode = req.mode.as_deref().unwrap_or("push");
    if mode != "push" {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Validate push mode requirements
    if req.push_endpoint_url.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(ref url) = req.push_endpoint_url {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    // Validate max_concurrent_executions
    if let Some(max) = req.max_concurrent_executions {
        if max <= 0 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    // Set project_id session variable for RLS
    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Get deployment_id - use from request if provided, otherwise get latest active deployment for project
    let deployment_id = if let Some(deployment_id) = req.deployment_id {
        match state
            .db
            .deployment_exists_for_project(&deployment_id, &project_id)
            .await
        {
            Ok(true) => {
                tracing::info!(
                    "[register_worker] Using provided deployment {} for project {}",
                    deployment_id,
                    project_id
                );
                Some(deployment_id)
            }
            Ok(false) => {
                tracing::info!(
          "[register_worker] Deployment {} does not exist for project {}, creating new deployment",
          deployment_id,
          project_id
        );
                match state
                    .db
                    .create_or_replace_deployment(&deployment_id, &project_id)
                    .await
                {
                    Ok(_) => {
                        tracing::info!(
                            "[register_worker] Created deployment {} for project {}",
                            deployment_id,
                            project_id
                        );
                        Some(deployment_id)
                    }
                    Err(e) => {
                        tracing::error!(
                            "[register_worker] Failed to create deployment {} for project {}: {}",
                            deployment_id,
                            project_id,
                            e
                        );
                        return Err(StatusCode::INTERNAL_SERVER_ERROR);
                    }
                }
            }
            Err(e) => {
                tracing::error!(
                    "[register_worker] Failed to check if deployment {} exists for project {}: {}",
                    deployment_id,
                    project_id,
                    e
                );
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    } else {
        match state.db.get_latest_deployment(&project_id).await {
            Ok(Some(deployment)) => {
                tracing::info!(
                    "[register_worker] Using latest deployment {} for project {}",
                    deployment.id,
                    project_id
                );
                Some(deployment.id)
            }
            Ok(None) => {
                tracing::error!("[register_worker] No active deployment found for project {}, worker will have no deployment_id", project_id);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            Err(e) => {
                tracing::error!(
                    "[register_worker] Failed to get latest deployment for project {}: {}",
                    project_id,
                    e
                );
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    };

    state
        .db
        .register_worker(
            &worker_id,
            &project_id,
            req.capabilities.as_ref(),
            Some(mode),
            req.push_endpoint_url.as_deref(),
            req.max_concurrent_executions,
            deployment_id.as_deref(),
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to register worker: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tracing::info!(
        "Worker registered: {} for project: {} (mode: {})",
        worker_id,
        project_id,
        mode
    );

    Ok(Json(RegisterWorkerResponse {
        worker_id: worker_id.to_string(),
    }))
}

/// Register or update a worker deployment
#[utoipa::path(
    post,
    path = "/api/v1/workers/deployments",
    tag = "Workers",
    request_body = RegisterWorkerDeploymentRequest,
    params(
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Deployment registered"),
        (status = 404, description = "Project not found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn register_worker_deployment(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Json(req): Json<RegisterWorkerDeploymentRequest>,
) -> Result<StatusCode, StatusCode> {
    // Validate project_id exists
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

    // Set project_id session variable for RLS
    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Get or create deployment
    state
        .db
        .create_or_replace_deployment(&req.deployment_id, &project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create or replace deployment: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::OK)
}

pub async fn poll_workflow(
    State(state): State<Arc<AppState>>,
    Path(worker_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<PollWorkflowResponse>>, StatusCode> {
    let worker_id = Uuid::parse_str(&worker_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Get project_id from worker and set session variable for RLS
    let project_id = state
        .db_sse
        .get_project_id_from_worker(&worker_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get project_id from worker: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    state
        .db_sse
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Get max_workflows from query parameter (default to 1 if not provided)
    let max_workflows = params
        .get("max_workflows")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1);

    // Update heartbeat
    state
        .db_sse
        .update_worker_heartbeat(&worker_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Long poll for up to 30 seconds
    let poll_duration = Duration::from_secs(30);
    let poll_interval = Duration::from_millis(100);
    let start = tokio::time::Instant::now();

    while start.elapsed() < poll_duration {
        // Try to claim workflows in a loop until max_workflows or nothing available
        let mut executions = Vec::new();

        loop {
            if executions.len() >= max_workflows {
                break;
            }

            match state.db_sse.claim_next_executions(&worker_id).await {
                Ok(Some(execution)) => {
                    tracing::info!("[poll_workflow] claimed execution: {}", execution.id);
                    executions.push(execution);
                }
                Ok(None) => {
                    break;
                }
                Err(e) => {
                    tracing::error!("Error claiming execution: {}", e);
                    break;
                }
            }
        }

        if !executions.is_empty() {
            tracing::info!(
                "Assigned {} execution(s) to worker {}",
                executions.len(),
                worker_id
            );

            let _ = state
                .db_sse
                .update_worker_status(&worker_id, "online")
                .await;

            let responses: Vec<PollWorkflowResponse> = executions
                .into_iter()
                .map(|execution| PollWorkflowResponse {
                    execution_id: execution.id.to_string(),
                    workflow_id: execution.workflow_id,
                    deployment_id: execution.deployment_id.clone(),
                    payload: execution.payload,
                    parent_execution_id: execution.parent_execution_id.map(|id| id.to_string()),
                    root_execution_id: execution.root_execution_id.map(|id| id.to_string()),
                    step_key: execution.step_key,
                    retry_count: execution.retry_count,
                    created_at: execution.created_at.to_rfc3339(),
                    session_id: execution.session_id,
                    user_id: execution.user_id,
                    otel_traceparent: execution.otel_traceparent,
                    otel_span_id: execution.otel_span_id,
                    initial_state: execution.initial_state,
                })
                .collect();

            return Ok(Json(responses));
        }

        sleep(poll_interval).await;
    }

    Ok(Json(vec![]))
}

#[derive(Serialize)]
pub struct HeartbeatResponse {
    pub re_register: bool,
}

// Worker heartbeat
pub async fn worker_heartbeat(
    State(state): State<Arc<AppState>>,
    Path(worker_id): Path<String>,
) -> Result<Json<HeartbeatResponse>, StatusCode> {
    let worker_id = Uuid::parse_str(&worker_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Check if worker exists
    let project_id_result = state.db.get_project_id_from_worker(&worker_id).await;

    match project_id_result {
        Ok(project_id) => {
            // Worker exists - update heartbeat
            state
                .db
                .set_project_id(&project_id, false)
                .await
                .map_err(|e| {
                    tracing::error!("Failed to set project_id: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

            // Check if worker needs recovery
            if let Ok(Some((
                status,
                push_failure_count,
                push_failure_threshold,
                last_push_attempt_at,
            ))) = state.db.get_worker_recovery_info(&worker_id).await
            {
                let should_recover = match (push_failure_count, push_failure_threshold) {
                    // Case 1: Worker is offline but push counts are healthy - mark as online
                    (Some(count), Some(threshold)) if status == "offline" && count < threshold => {
                        tracing::info!("Worker {} is offline but push counts are healthy (count: {}, threshold: {}), marking as online", worker_id, count, threshold);
                        true
                    }
                    // Case 2: Worker exceeded push failure threshold and last attempt was 30+ seconds ago
                    (Some(count), Some(threshold)) if count >= threshold => {
                        let should_reset = match last_push_attempt_at {
                            Some(last_attempt) => {
                                let time_since = chrono::Utc::now() - last_attempt;
                                time_since.num_seconds() >= 30
                            }
                            None => true, // No last attempt recorded, assume recovered
                        };
                        if should_reset {
                            let time_ago = last_push_attempt_at
                                .map(|la| (chrono::Utc::now() - la).num_seconds())
                                .unwrap_or(-1);
                            tracing::info!(
                "Worker {} recovered from push failures (count: {}, threshold: {}, last attempt: {}s ago)",
                worker_id, count, threshold, time_ago
              );
                        }
                        should_reset
                    }
                    _ => false,
                };

                if should_recover {
                    state
                        .db
                        .mark_worker_online_and_reset_failures(&worker_id)
                        .await
                        .map_err(|e| {
                            tracing::error!("Failed to recover worker: {}", e);
                            StatusCode::INTERNAL_SERVER_ERROR
                        })?;
                }
            }

            state
                .db
                .update_worker_heartbeat(&worker_id)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            Ok(Json(HeartbeatResponse { re_register: false }))
        }
        Err(_) => {
            // Worker doesn't exist - ask for re-registration
            tracing::info!(
                "Worker {} not found in database, requesting re-registration",
                worker_id
            );
            Ok(Json(HeartbeatResponse { re_register: true }))
        }
    }
}

/// Response for worker status query
#[derive(Serialize, ToSchema)]
pub struct WorkerStatusResponse {
    pub online_count: i64,
    pub has_workers: bool,
}

#[derive(Deserialize)]
pub struct WorkerStatusQuery {
    pub deployment_id: String,
}

/// Get worker status for a deployment
#[utoipa::path(
    get,
    path = "/api/v1/workers/status",
    tag = "Workers",
    params(
        ("deployment_id" = String, Query, description = "Deployment ID to check worker status for"),
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Worker status", body = WorkerStatusResponse),
        (status = 400, description = "Bad request"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_worker_status(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Query(query): Query<WorkerStatusQuery>,
) -> Result<Json<WorkerStatusResponse>, StatusCode> {
    let online_count = state
        .db
        .get_worker_count_for_deployment(&project_id, &query.deployment_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get worker count: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(WorkerStatusResponse {
        online_count,
        has_workers: online_count > 0,
    }))
}

/// Response for active workers query
#[derive(Serialize, ToSchema)]
pub struct ActiveWorkersResponse {
    pub worker_ids: Vec<String>,
}

/// Get active worker IDs for a project.
/// Returns workers that are online and have sent a heartbeat within the last 60 seconds.
#[utoipa::path(
    get,
    path = "/api/v1/workers/active",
    tag = "Workers",
    params(
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Active worker IDs", body = ActiveWorkersResponse),
        (status = 400, description = "Bad request"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_active_workers(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
) -> Result<Json<ActiveWorkersResponse>, StatusCode> {
    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let worker_ids = state
        .db
        .get_active_worker_ids(&project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get active worker IDs: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(ActiveWorkersResponse { worker_ids }))
}

// Mark worker as online (called after worker completes registration of agents, tools, workflows, etc.)
pub async fn mark_worker_online(
    State(state): State<Arc<AppState>>,
    Path(worker_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let worker_id = Uuid::parse_str(&worker_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Get project_id from worker and set session variable for RLS
    let project_id = state
        .db
        .get_project_id_from_worker(&worker_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get project_id from worker: {}", e);
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

    state
        .db
        .update_worker_status(&worker_id, "online")
        .await
        .map_err(|e| {
            tracing::error!("Failed to mark worker as online: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tracing::info!("Worker {} marked as online", worker_id);
    Ok(StatusCode::OK)
}
