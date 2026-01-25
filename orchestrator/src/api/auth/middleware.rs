use axum::{
  extract::{Request, State},
  http::{HeaderMap, StatusCode, Uri},
  middleware::Next,
  response::Response,
};
use axum_extra::extract::CookieJar;
use std::sync::Arc;
use uuid::Uuid;

use super::helpers::authenticate_api_v1_request;
use crate::api::common::ErrorResponse;
use crate::AppState;

// Middleware function to authenticate /api/v1 routes
pub async fn authenticate_api_v1_middleware(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  cookie_jar: CookieJar,
  uri: Uri,
  request: Request,
  next: Next,
) -> Result<Response, (StatusCode, axum::Json<ErrorResponse>)> {
  let path = uri.path();

  // Skip authentication for public endpoints
  if should_skip_auth(path) {
    return Ok(next.run(request).await);
  }

  // For /internal routes, X-Project-ID is not required when using API keys
  // (API keys already contain project_id)
  // For JWT tokens, X-Project-ID is still required
  let is_projects_endpoint =
    path.starts_with("/api/v1/projects") || path.starts_with("/api/v1/api-keys/project/");
  let is_events_stream = path == "/api/v1/events/stream";
  let is_internal = path.starts_with("/internal/");
  let is_signout = path == "/api/v1/auth/signout";

  // For /internal routes, X-Project-ID is optional (API keys don't need it)
  let optional_project_id_header =
    is_projects_endpoint || is_events_stream || is_internal || is_signout;

  // In local mode, skip authentication but still require X-Project-ID header
  if state.local_mode {
    // Get project_id from X-Project-ID header (optional for projects and events/stream endpoints)
    let project_id = if optional_project_id_header {
      // For /api/v1/projects, /api/v1/api-keys/project/:project_id and /api/v1/events/stream endpoints, X-Project-ID is optional
      // The handler will extract project_id from query params if needed
      headers
        .get("X-Project-ID")
        .or_else(|| headers.get("Project-ID"))
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .unwrap_or(Uuid::nil())
    } else {
      // For other endpoints, X-Project-ID header is required in local mode
      headers
        .get("X-Project-ID")
        .or_else(|| headers.get("Project-ID"))
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or((
          StatusCode::BAD_REQUEST,
          axum::Json(ErrorResponse {
            error: "X-Project-ID header is required in local mode".to_string(),
            error_type: "BAD_REQUEST".to_string(),
          }),
        ))?
    };

    // Set project_id for RLS (only if we have a valid project_id)
    // For projects/events/stream endpoints, handler will set it from query params if needed
    if project_id != Uuid::nil() {
      state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
          tracing::error!("Failed to set project_id: {}", e);
          (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(ErrorResponse {
              error: "Failed to set project_id".to_string(),
              error_type: "INTERNAL_ERROR".to_string(),
            }),
          )
        })?;
    }

    return Ok(next.run(request).await);
  }

  // Authenticate request
  match authenticate_api_v1_request(
    &state,
    &headers,
    &cookie_jar,
    path,
    !optional_project_id_header, // require_project_header: false for projects endpoints and events stream
  )
  .await
  {
    Ok(_project_id) => {
      // Authentication successful, proceed with request
      Ok(next.run(request).await)
    }
    Err(e) => Err(e),
  }
}

fn should_skip_auth(path: &str) -> bool {
  matches!(
    path,
    "/health" | "/api/v1/auth/signup" | "/api/v1/auth/signin" | "/api/v1/auth/oauth-signin"
  )
}
