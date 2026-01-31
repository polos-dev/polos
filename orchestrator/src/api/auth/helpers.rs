use axum::http::{HeaderMap, StatusCode};
use axum_extra::extract::CookieJar;
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{Duration as ChronoDuration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use std::sync::Arc;
use time::Duration as TimeDuration;
use uuid::Uuid;

use crate::api::common::ErrorResponse;
use crate::db;
use crate::AppState;

#[derive(serde::Serialize, serde::Deserialize)]
struct Claims {
    sub: String, // user id
    exp: i64,
}

fn get_jwt_secret() -> String {
    std::env::var("JWT_SECRET").unwrap_or_else(|_| "your-secret-key".to_string())
}

fn get_jwt_algorithm() -> Algorithm {
    Algorithm::HS256
}

pub(crate) fn create_access_token(user_id: &str) -> Result<String, StatusCode> {
    let secret = get_jwt_secret();
    let now = Utc::now();
    let expires_in = ChronoDuration::minutes(60 * 24); // 24 hours
    let exp = (now + expires_in).timestamp();

    let claims = Claims {
        sub: user_id.to_string(),
        exp,
    };

    encode(
        &Header::new(get_jwt_algorithm()),
        &claims,
        &EncodingKey::from_secret(secret.as_ref()),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn decode_token(token: &str) -> Option<Claims> {
    let secret = get_jwt_secret();
    let mut validation = Validation::new(get_jwt_algorithm());
    validation.validate_exp = true;

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &validation,
    )
    .ok()
    .map(|data| data.claims)
}

pub(crate) fn hash_password(password: &str) -> Result<String, StatusCode> {
    hash(password, DEFAULT_COST).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub(crate) fn verify_password(password: &str, hash: &str) -> bool {
    verify(password, hash).unwrap_or(false)
}

fn get_cookie_name() -> String {
    std::env::var("COOKIE_NAME").unwrap_or_else(|_| "auth_token".to_string())
}

pub(crate) fn set_auth_cookie(jar: CookieJar, token: &str) -> CookieJar {
    let cookie_name = get_cookie_name();
    let cookie_domain = std::env::var("COOKIE_DOMAIN").ok();
    let cookie_secure = std::env::var("COOKIE_SECURE")
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);

    let mut cookie = axum_extra::extract::cookie::Cookie::new(cookie_name, token.to_string());
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_max_age(Some(TimeDuration::hours(24)));

    if let Some(domain) = cookie_domain {
        cookie.set_domain(domain);
    }

    if cookie_secure {
        cookie.set_secure(true);
    }

    let samesite = std::env::var("COOKIE_SAMESITE").unwrap_or_else(|_| "Lax".to_string());

    if samesite.to_lowercase() == "none" {
        cookie.set_same_site(axum_extra::extract::cookie::SameSite::None);
    } else if samesite.to_lowercase() == "strict" {
        cookie.set_same_site(axum_extra::extract::cookie::SameSite::Strict);
    } else {
        cookie.set_same_site(axum_extra::extract::cookie::SameSite::Lax);
    }

    jar.add(cookie)
}

pub(crate) fn delete_auth_cookie(jar: CookieJar) -> CookieJar {
    let cookie_name = get_cookie_name();
    let cookie_domain = std::env::var("COOKIE_DOMAIN").ok();

    let mut cookie = axum_extra::extract::cookie::Cookie::new(cookie_name, "");
    cookie.set_path("/");
    cookie.set_max_age(None);

    if let Some(domain) = cookie_domain {
        cookie.set_domain(domain);
    }

    jar.add(cookie)
}

// Current user extractor - helper function to get current user
pub async fn get_current_user(
    state: &Arc<AppState>,
    jar: &CookieJar,
    headers: &HeaderMap,
) -> Result<db::User, StatusCode> {
    // In local mode, return the default user (user@local)
    if state.local_mode {
        let user = state
            .db
            .get_user_by_email("user@local")
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or_else(|| {
                tracing::error!("Local mode enabled but user@local not found in database");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        return Ok(user);
    }

    // Get token from cookie first
    let cookie_name = get_cookie_name();
    let mut token = jar.get(&cookie_name).map(|c| c.value().to_string());

    // Fallback to Authorization header
    if token.is_none() {
        token = headers
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| {
                s.strip_prefix("Bearer ")
                    .map(|stripped| stripped.to_string())
            });
    }

    let token = token.ok_or(StatusCode::UNAUTHORIZED)?;

    let claims = decode_token(&token).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = claims.sub;

    let user = state
        .db
        .get_user_by_id(&user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    Ok(user)
}

// Helper function to check user authentication and project access
pub async fn check_user_and_project_access(
    state: &Arc<AppState>,
    jar: &CookieJar,
    headers: &HeaderMap,
    project_id: &Uuid,
) -> Result<db::User, (StatusCode, axum::Json<ErrorResponse>)> {
    // Get current user (for auth check)
    let user = get_current_user(state, jar, headers).await.map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            axum::Json(ErrorResponse {
                error: "Not authenticated".to_string(),
                error_type: "UNAUTHORIZED".to_string(),
            }),
        )
    })?;

    // Check if user has access to the project
    let member = state
        .db
        .get_project_member(&user.id, project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to check project access for user {}: {}", user.id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(ErrorResponse {
                    error: "Failed to check project access".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    if member.is_none() {
        return Err((
            StatusCode::FORBIDDEN,
            axum::Json(ErrorResponse {
                error: "Access to project forbidden".to_string(),
                error_type: "PROJECT_ACCESS_FORBIDDEN".to_string(),
            }),
        ));
    }

    Ok(user)
}

// Helper function to authenticate API key and get project_id
pub async fn authenticate_api_key(
    state: &Arc<AppState>,
    headers: &HeaderMap,
) -> Result<Uuid, (StatusCode, axum::Json<ErrorResponse>)> {
    // In local mode, get project_id from X-Project-ID header
    if state.local_mode {
        let project_id = headers
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
            ))?;

        // Set project_id for RLS
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

        return Ok(project_id);
    }

    // Get Authorization header
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or((
            StatusCode::UNAUTHORIZED,
            axum::Json(ErrorResponse {
                error: "Missing Authorization header".to_string(),
                error_type: "UNAUTHORIZED".to_string(),
            }),
        ))?;

    // Extract Bearer token
    let api_key = if let Some(stripped) = auth_header.strip_prefix("Bearer ") {
        stripped
    } else {
        return Err((
            StatusCode::UNAUTHORIZED,
            axum::Json(ErrorResponse {
                error: "Invalid Authorization header format. Expected 'Bearer <token>'".to_string(),
                error_type: "UNAUTHORIZED".to_string(),
            }),
        ));
    };

    // Validate API key starts with sk_
    if !api_key.starts_with("sk_") {
        return Err((
            StatusCode::UNAUTHORIZED,
            axum::Json(ErrorResponse {
                error: "Invalid API key format. API key must start with 'sk_'".to_string(),
                error_type: "UNAUTHORIZED".to_string(),
            }),
        ));
    }

    // Hash the API key
    let key_hash = crate::crypto::hash_api_key(api_key).map_err(|e| {
        tracing::error!("Failed to hash API key: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(ErrorResponse {
                error: "Failed to authenticate".to_string(),
                error_type: "INTERNAL_ERROR".to_string(),
            }),
        )
    })?;

    // Look up API key in database
    let api_key_record = state
        .db
        .get_api_key_by_hash(&key_hash)
        .await
        .map_err(|e| {
            tracing::error!("Failed to lookup API key: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(ErrorResponse {
                    error: "Failed to authenticate".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?
        .ok_or((
            StatusCode::UNAUTHORIZED,
            axum::Json(ErrorResponse {
                error: "Invalid API key".to_string(),
                error_type: "UNAUTHORIZED".to_string(),
            }),
        ))?;

    // Update last_used_at timestamp
    if let Err(e) = state.db.update_api_key_last_used(&api_key_record.id).await {
        tracing::warn!("Failed to update API key last_used_at: {}", e);
        // Don't fail the request if this update fails
    }

    Ok(api_key_record.project_id)
}

// Helper function to validate that an execution belongs to the authenticated project
// This function assumes the request has already been authenticated by middleware
// (either via API key or JWT cookie). It verifies that the execution belongs to
// the authenticated project.
pub async fn authenticate_and_validate_execution_project(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    cookie_jar: &axum_extra::extract::CookieJar,
    execution_id: &str,
) -> Result<(Uuid, Uuid), (StatusCode, axum::Json<ErrorResponse>)> {
    // Parse execution ID
    let execution_id_uuid = Uuid::parse_str(execution_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            axum::Json(ErrorResponse {
                error: "Invalid execution ID".to_string(),
                error_type: "BAD_REQUEST".to_string(),
            }),
        )
    })?;

    // In local mode, get project_id from X-Project-ID header and verify it matches execution
    if state.local_mode {
        let header_project_id = headers
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
            ))?;

        // Get project_id from execution
        let execution_project_id = state
            .db
            .get_project_id_from_execution(&execution_id_uuid)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get project_id from execution: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(ErrorResponse {
                        error: "Failed to get execution".to_string(),
                        error_type: "INTERNAL_ERROR".to_string(),
                    }),
                )
            })?;

        // Verify that the header project_id matches the execution's project_id
        if header_project_id != execution_project_id {
            return Err((
                StatusCode::FORBIDDEN,
                axum::Json(ErrorResponse {
                    error: "X-Project-ID does not match execution project".to_string(),
                    error_type: "FORBIDDEN".to_string(),
                }),
            ));
        }

        // Set project_id for RLS
        state
            .db
            .set_project_id(&header_project_id, false)
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

        return Ok((execution_id_uuid, header_project_id));
    }

    // Get the authenticated project_id (middleware already authenticated the request)
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| {
            s.strip_prefix("Bearer ")
                .map(|stripped| stripped.to_string())
        });

    let is_api_key = auth_header
        .as_ref()
        .map(|token| token.starts_with("sk_"))
        .unwrap_or(false);

    // For API keys, X-Project-ID is not required (project_id comes from API key)
    // For JWT tokens, X-Project-ID is required (unless it's a projects endpoint)
    let require_project_header = !is_api_key;

    let authenticated_project_id =
        authenticate_api_v1_request(state, headers, cookie_jar, "", require_project_header).await?;

    // Get project_id from execution
    let execution_project_id = state
        .db
        .get_project_id_from_execution(&execution_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get project_id from execution: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(ErrorResponse {
                    error: "Failed to get execution".to_string(),
                    error_type: "INTERNAL_ERROR".to_string(),
                }),
            )
        })?;

    // Verify that the authenticated project_id matches the execution's project_id
    if authenticated_project_id != Uuid::nil() && authenticated_project_id != execution_project_id {
        return Err((
            StatusCode::FORBIDDEN,
            axum::Json(ErrorResponse {
                error: "Project does not match execution project".to_string(),
                error_type: "FORBIDDEN".to_string(),
            }),
        ));
    }

    Ok((execution_id_uuid, execution_project_id))
}

// Helper function to authenticate API v1 requests
// Supports two authentication methods:
// 1. API key (starting with sk_) - extracts project_id from API key
// 2. JWT token (from cookie) - requires X-Project-ID header
// For /api/v1/projects endpoints, X-Project-ID header is optional when using JWT
pub async fn authenticate_api_v1_request(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    cookie_jar: &CookieJar,
    _path: &str,
    require_project_header: bool,
) -> Result<Uuid, (StatusCode, axum::Json<ErrorResponse>)> {
    // Check for API key in Authorization header
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| {
            s.strip_prefix("Bearer ")
                .map(|stripped| stripped.to_string())
        });

    // Check if it's an API key (starts with sk_)
    if let Some(token) = &auth_header {
        if token.starts_with("sk_") {
            // Authenticate API key and get project_id
            let project_id = authenticate_api_key(state, headers).await?;
            // Set project_id for RLS
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
            return Ok(project_id);
        }
    }

    // Not an API key, check for JWT token in cookie
    let cookie_name = get_cookie_name();
    let token = cookie_jar
        .get(&cookie_name)
        .map(|c| c.value().to_string())
        .or({
            // Fallback to Authorization header (might be JWT, not API key)
            auth_header
        });

    if let Some(token) = token {
        // Validate JWT token
        let claims = decode_token(&token).ok_or((
            StatusCode::UNAUTHORIZED,
            axum::Json(ErrorResponse {
                error: "Invalid authentication token".to_string(),
                error_type: "UNAUTHORIZED".to_string(),
            }),
        ))?;

        // Verify user exists
        state
            .db
            .get_user_by_id(&claims.sub)
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(ErrorResponse {
                        error: "Failed to authenticate".to_string(),
                        error_type: "INTERNAL_ERROR".to_string(),
                    }),
                )
            })?
            .ok_or((
                StatusCode::UNAUTHORIZED,
                axum::Json(ErrorResponse {
                    error: "User not found".to_string(),
                    error_type: "UNAUTHORIZED".to_string(),
                }),
            ))?;

        // Get project_id from X-Project-ID header
        if !require_project_header {
            // For /api/v1/projects endpoints, X-Project-ID is optional
            // If not provided, return None to indicate no project-specific RLS needed
            // The handler will handle querying all projects for the user
            let project_id = headers
                .get("X-Project-ID")
                .or_else(|| headers.get("Project-ID"))
                .and_then(|h| h.to_str().ok())
                .and_then(|s| Uuid::parse_str(s).ok());

            if let Some(project_id) = project_id {
                // Set project_id for RLS if provided
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
                return Ok(project_id);
            } else {
                // No project_id provided for /api/v1/projects endpoint - this is allowed
                // Return a dummy zero UUID and the handler will know not to rely on RLS
                return Ok(Uuid::nil());
            }
        }

        // For other endpoints, X-Project-ID is required
        let project_id = headers
            .get("X-Project-ID")
            .or_else(|| headers.get("Project-ID"))
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or((
                StatusCode::BAD_REQUEST,
                axum::Json(ErrorResponse {
                    error: "X-Project-ID header is required".to_string(),
                    error_type: "BAD_REQUEST".to_string(),
                }),
            ))?;

        // Set project_id for RLS
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

        return Ok(project_id);
    }

    // No valid authentication found
    Err((
    StatusCode::UNAUTHORIZED,
    axum::Json(ErrorResponse {
      error: "Authentication required. Provide either an API key (Bearer sk_...) or a JWT token in cookie".to_string(),
      error_type: "UNAUTHORIZED".to_string(),
    }),
  ))
}
