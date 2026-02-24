use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::sync::Arc;
use utoipa::IntoParams;
use uuid::Uuid;

use crate::api::auth::helpers::check_user_and_project_access;
use crate::api::common::{ErrorResponse, ProjectId};
use crate::AppState;

/// Query parameters for listing sessions
#[derive(Deserialize, IntoParams)]
pub struct GetSessionsQuery {
    /// Maximum number of results (default: 50)
    limit: Option<i64>,
    /// Offset for pagination
    offset: Option<i64>,
    /// Start time filter (RFC3339)
    start_time: Option<String>,
    /// End time filter (RFC3339)
    end_time: Option<String>,
    /// Filter by status
    status: Option<String>,
    /// Filter by agent ID
    agent_id: Option<String>,
}

/// List sessions (root-level agent executions)
#[utoipa::path(
    get,
    path = "/api/v1/sessions",
    tag = "Sessions",
    params(
        ("X-Project-ID" = String, Header, description = "Project ID"),
        GetSessionsQuery
    ),
    responses(
        (status = 200, description = "List of sessions"),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 403, description = "Access forbidden", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_sessions(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    ProjectId(project_id): ProjectId,
    Query(params): Query<GetSessionsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    check_user_and_project_access(&state, &jar, &headers, &project_id).await?;

    let start_time = params
        .start_time
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    let end_time = params
        .end_time
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    let limit = params.limit.unwrap_or(50);
    let offset = params.offset.unwrap_or(0);

    let sessions = state
        .db
        .get_sessions_list(
            &project_id,
            start_time,
            end_time,
            params.status.as_deref(),
            params.agent_id.as_deref(),
            limit,
            offset,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to get sessions: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get sessions".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(serde_json::json!({ "sessions": sessions })))
}

/// Get session detail by execution ID
#[utoipa::path(
    get,
    path = "/api/v1/sessions/{execution_id}",
    tag = "Sessions",
    params(
        ("execution_id" = String, Path, description = "Execution ID"),
        ("X-Project-ID" = String, Header, description = "Project ID")
    ),
    responses(
        (status = 200, description = "Session detail"),
        (status = 401, description = "Not authenticated", body = ErrorResponse),
        (status = 403, description = "Access forbidden", body = ErrorResponse),
        (status = 404, description = "Session not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = []),
        ("cookie_auth" = [])
    )
)]
pub async fn get_session_detail(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    ProjectId(project_id): ProjectId,
    Path(execution_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    check_user_and_project_access(&state, &jar, &headers, &project_id).await?;

    let session = state
        .db
        .get_session_detail(&execution_id, &project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get session detail: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get session detail".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    match session {
        Some(detail) => Ok(Json(detail)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Session not found".to_string(),
                error_type: "NOT_FOUND".to_string(),
            }),
        )),
    }
}
