use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::api::auth::helpers::{check_user_and_project_access, get_current_user};
use crate::api::common::ErrorResponse;
use crate::crypto;
use crate::db;
use crate::AppState;

// Helper function to check if user is admin of project
async fn check_project_admin_access(
    state: &Arc<AppState>,
    jar: &CookieJar,
    headers: &HeaderMap,
    project_id: &Uuid,
) -> Result<db::User, (StatusCode, Json<ErrorResponse>)> {
    // Get current user
    let user = get_current_user(state, jar, headers).await.map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "Not authenticated".to_string(),
                error_type: "UNAUTHORIZED".to_string(),
            }),
        )
    })?;

    // Check if user is admin of the project
    let member = state
        .db
        .get_project_member(&user.id, project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to check project access for user {}: {}", user.id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to check project access".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    if let Some(member) = member {
        if matches!(member.role, db::ProjectRole::Admin) {
            return Ok(user);
        }
    }

    Err((
        StatusCode::FORBIDDEN,
        Json(ErrorResponse {
            error: "Admin access required".to_string(),
            error_type: "FORBIDDEN".to_string(),
        }),
    ))
}

// API Key schemas
#[derive(Deserialize, Debug)]
pub struct ApiKeyCreateRequest {
    name: String,
    project_id: String,
}

#[derive(Serialize)]
pub struct ApiKeyResponse {
    id: String,
    name: String,
    last_four_digits: String,
    created_at: String,
    last_used_at: Option<String>,
}

#[derive(Serialize)]
pub struct ApiKeyFullResponse {
    id: String,
    name: String,
    key: String, // Full unencrypted key (only when creating!
    last_four_digits: String,
    created_at: String,
    last_used_at: Option<String>,
}

const KEYS_PER_PROJECT_LIMIT: i64 = 10;

// API Key endpoints
pub async fn list_api_keys(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<ApiKeyResponse>>, (StatusCode, Json<ErrorResponse>)> {
    // Parse project_id
    let project_id_uuid = Uuid::parse_str(&project_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid project ID format".to_string(),
                error_type: "INVALID_INPUT".to_string(),
            }),
        )
    })?;

    // Check user access
    check_user_and_project_access(&state, &jar, &headers, &project_id_uuid).await?;

    // Get API keys
    let api_keys = state
        .db
        .list_api_keys_by_project(&project_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to list API keys: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to list API keys".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    let response: Vec<ApiKeyResponse> = api_keys
        .into_iter()
        .map(|k| ApiKeyResponse {
            id: k.id.to_string(),
            name: k.name,
            last_four_digits: k.last_four_digits,
            created_at: k.created_at.to_rfc3339(),
            last_used_at: k.last_used_at.map(|dt| dt.to_rfc3339()),
        })
        .collect();

    Ok(Json(response))
}

pub async fn create_api_key(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(req): Json<ApiKeyCreateRequest>,
) -> Result<Json<ApiKeyFullResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Validate name
    let name = req.name.trim();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Name cannot be empty".to_string(),
                error_type: "INVALID_INPUT".to_string(),
            }),
        ));
    }

    // Parse project_id
    let project_id_uuid = Uuid::parse_str(&req.project_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid project ID format".to_string(),
                error_type: "INVALID_INPUT".to_string(),
            }),
        )
    })?;

    // Check admin access
    let user = check_project_admin_access(&state, &jar, &headers, &project_id_uuid).await?;

    // Check if name already exists
    let existing = state
        .db
        .get_api_key_by_name(&project_id_uuid, name)
        .await
        .map_err(|e| {
            tracing::error!("Failed to check existing API key: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to check existing API key".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    if existing.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("API key with name '{}' already exists", name),
                error_type: "DUPLICATE_KEY".to_string(),
            }),
        ));
    }

    // Check key limit
    let key_count = state
        .db
        .count_api_keys_by_project(&project_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to count API keys: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to count API keys".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    if key_count >= KEYS_PER_PROJECT_LIMIT {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!(
                    "Maximum of {} API keys per project allowed",
                    KEYS_PER_PROJECT_LIMIT
                ),
                error_type: "LIMIT_EXCEEDED".to_string(),
            }),
        ));
    }

    // Generate and hash API key
    let plain_api_key = crypto::generate_api_key("sk_", 32);
    let key_hash = crypto::hash_api_key(&plain_api_key).map_err(|e| {
        tracing::error!("Failed to hash API key: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to hash API key".to_string(),
                error_type: "INTERNAL_ERROR".to_string(),
            }),
        )
    })?;
    let last_four_digits = plain_api_key
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();

    // Create API key
    let api_key = state
        .db
        .create_api_key(
            name,
            &key_hash,
            &last_four_digits,
            &project_id_uuid,
            Some(&user.id),
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to create API key: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to create API key".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(ApiKeyFullResponse {
        id: api_key.id.to_string(),
        name: api_key.name,
        key: plain_api_key, // Return unencrypted key (only time it's exposed)
        last_four_digits: api_key.last_four_digits,
        created_at: api_key.created_at.to_rfc3339(),
        last_used_at: api_key.last_used_at.map(|dt| dt.to_rfc3339()),
    }))
}

pub async fn delete_api_key(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(key_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Parse key_id
    let key_id_uuid = Uuid::parse_str(&key_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid API key ID format".to_string(),
                error_type: "INVALID_INPUT".to_string(),
            }),
        )
    })?;

    // Get API key
    let api_key = state
        .db
        .get_api_key_by_id(&key_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get API key: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to get API key".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?
        .ok_or((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "API key not found".to_string(),
                error_type: "NOT_FOUND".to_string(),
            }),
        ))?;

    // Check admin access
    check_project_admin_access(&state, &jar, &headers, &api_key.project_id).await?;

    // Delete API key
    state.db.delete_api_key(&key_id_uuid).await.map_err(|e| {
        tracing::error!("Failed to delete API key: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "Failed to delete API key".to_string(),
                error_type: "INTERNAL_ERROR".to_string(),
            }),
        )
    })?;

    Ok(Json(serde_json::json!({
      "message": "API key deleted successfully"
    })))
}
