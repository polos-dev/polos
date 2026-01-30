use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::api::auth::helpers::check_user_and_project_access;
use crate::api::common::{ErrorResponse, ProjectId};
use crate::db;
use crate::AppState;

#[derive(Deserialize)]
pub struct RegisterQueuesRequest {
    pub deployment_id: String,
    pub queues: Vec<QueueInfo>,
}

#[derive(Deserialize)]
pub struct QueueInfo {
    pub name: String,
    pub concurrency_limit: Option<i32>,
}

#[derive(Deserialize)]
pub struct GetWorkflowRunsQuery {
    workflow_type: Option<String>,
    workflow_id: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    start_time: Option<String>,
    end_time: Option<String>,
}

#[derive(Serialize)]
pub struct WorkflowRunSummary {
    id: String,
    root_execution_id: Option<String>,
    workflow_id: String,
    created_at: String,
    status: String,
    completed_at: Option<String>,
    payload: serde_json::Value,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

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
