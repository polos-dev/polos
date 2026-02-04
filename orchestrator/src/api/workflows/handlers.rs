use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};

use crate::api::auth::helpers::check_user_and_project_access;
use crate::api::common::{ErrorResponse, ProjectId};
use crate::db;
use crate::AppState;

/// Request to register workflow queues
#[derive(Deserialize, ToSchema)]
pub struct RegisterQueuesRequest {
    /// Deployment ID
    pub deployment_id: String,
    /// List of queues to register
    pub queues: Vec<QueueInfo>,
}

/// Queue information
#[derive(Deserialize, ToSchema)]
pub struct QueueInfo {
    /// Queue name
    pub name: String,
    /// Concurrency limit for the queue
    pub concurrency_limit: Option<i32>,
}

/// Query parameters for getting workflow runs
#[derive(Deserialize, IntoParams)]
pub struct GetWorkflowRunsQuery {
    /// Filter by workflow type (workflow, agent, tool)
    workflow_type: Option<String>,
    /// Filter by workflow ID
    workflow_id: Option<String>,
    /// Maximum number of results (default: 50)
    limit: Option<i64>,
    /// Offset for pagination
    offset: Option<i64>,
    /// Start time filter (RFC3339)
    start_time: Option<String>,
    /// End time filter (RFC3339)
    end_time: Option<String>,
}

/// Workflow run summary
#[derive(Serialize, ToSchema)]
pub struct WorkflowRunSummary {
    /// Execution ID
    id: String,
    /// Root execution ID (for nested workflows)
    root_execution_id: Option<String>,
    /// Workflow ID
    workflow_id: String,
    /// Creation timestamp (RFC3339)
    created_at: String,
    /// Execution status
    status: String,
    /// Completion timestamp (RFC3339)
    completed_at: Option<String>,
    /// Input payload
    payload: serde_json::Value,
    /// Execution result
    result: Option<serde_json::Value>,
    /// Error message if failed
    error: Option<String>,
}

/// Register workflow queues
#[utoipa::path(
    post,
    path = "/api/v1/workers/queues",
    tag = "Workflows",
    request_body = RegisterQueuesRequest,
    params(
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Queues registered successfully"),
        (status = 404, description = "Project not found"),
        (status = 500, description = "Internal server error")
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn register_queues(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Json(req): Json<RegisterQueuesRequest>,
) -> Result<StatusCode, StatusCode> {
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

    let queues: Vec<(String, Option<i32>)> = req
        .queues
        .into_iter()
        .map(|q| (q.name, q.concurrency_limit))
        .collect();

    state
        .db
        .batch_register_queues(&req.deployment_id, &queues, &project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to register queues: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    tracing::info!(
        "Registered/updated {} queue(s) for deployment {}",
        queues.len(),
        req.deployment_id
    );
    Ok(StatusCode::OK)
}

/// Get all workflows for a project
#[utoipa::path(
    get,
    path = "/api/v1/workflows",
    tag = "Workflows",
    params(
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "List of workflows"),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 403, description = "Access forbidden", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_workflows(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    ProjectId(project_id): ProjectId,
) -> Result<Json<Vec<db::DeploymentWorkflow>>, (StatusCode, Json<ErrorResponse>)> {
    check_user_and_project_access(&state, &jar, &headers, &project_id).await?;

    let workflows = state
        .db
        .get_workflows_by_project(&project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get workflows for project {}: {}", project_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get workflows".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(workflows))
}

/// Get a workflow by ID
#[utoipa::path(
    get,
    path = "/api/v1/workflows/{workflow_id}",
    tag = "Workflows",
    params(
        ("workflow_id" = String, Path, description = "Workflow ID"),
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Workflow details"),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 403, description = "Access forbidden", body = ErrorResponse),
        (status = 404, description = "Workflow not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_workflow(
    State(state): State<Arc<AppState>>,
    Path(workflow_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    ProjectId(project_id): ProjectId,
) -> Result<Json<db::DeploymentWorkflow>, (StatusCode, Json<ErrorResponse>)> {
    check_user_and_project_access(&state, &jar, &headers, &project_id).await?;

    let workflow = state
        .db
        .get_workflow_by_id(&project_id, &workflow_id)
        .await
        .map_err(|e| {
            tracing::error!(
                "Failed to get workflow {} for project {}: {}",
                workflow_id,
                project_id,
                e
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get workflow".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    match workflow {
        Some(wf) => Ok(Json(wf)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Workflow {} not found", workflow_id),
                error_type: "NOT_FOUND".to_string(),
            }),
        )),
    }
}

/// Get workflow runs (executions) with optional filters
#[utoipa::path(
    get,
    path = "/api/v1/workflows/runs",
    tag = "Workflows",
    params(
        ("X-Project-ID" = String, Header, description = "Project ID"),
        GetWorkflowRunsQuery
    ),
    responses(
        (status = 200, description = "List of workflow runs", body = Vec<WorkflowRunSummary>),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 403, description = "Access forbidden", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_workflow_runs(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    ProjectId(project_id): ProjectId,
    Query(params): Query<GetWorkflowRunsQuery>,
) -> Result<Json<Vec<WorkflowRunSummary>>, (StatusCode, Json<ErrorResponse>)> {
    check_user_and_project_access(&state, &jar, &headers, &project_id).await?;

    let workflow_type = params
        .workflow_type
        .unwrap_or_else(|| "workflow".to_string());
    let limit = params.limit.unwrap_or(50);
    let offset = params.offset.unwrap_or(0);

    let start_time = params
        .start_time
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    let end_time = params
        .end_time
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    let executions = state
        .db
        .get_executions_by_project(
            &project_id,
            &workflow_type,
            params.workflow_id.as_deref(),
            start_time,
            end_time,
            limit,
            offset,
        )
        .await
        .map_err(|e| {
            tracing::error!(
                "Failed to get {} executions for project {}: {}",
                workflow_type,
                project_id,
                e
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to get {} executions", workflow_type),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    let summaries = executions
        .into_iter()
        .map(|exec| WorkflowRunSummary {
            id: exec.id.to_string(),
            root_execution_id: exec.root_execution_id.map(|id| id.to_string()),
            workflow_id: exec.workflow_id,
            created_at: exec.created_at.to_rfc3339(),
            completed_at: exec.completed_at.map(|dt| dt.to_rfc3339()),
            status: exec.status,
            payload: exec.payload,
            result: exec.result,
            error: exec.error,
        })
        .collect();

    Ok(Json(summaries))
}
