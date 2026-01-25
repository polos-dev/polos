use axum::{
  extract::State,
  http::{HeaderMap, StatusCode},
  Json,
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use super::helpers::{
  create_access_token, delete_auth_cookie, get_current_user, hash_password, set_auth_cookie,
  verify_password,
};
use crate::api::common::ErrorResponse;
use crate::AppState;

// Request/Response types
#[derive(Deserialize)]
pub struct SignUpRequest {
  first_name: String,
  last_name: String,
  email: String,
  password: String,
}

#[derive(Deserialize)]
pub struct SignInRequest {
  email: String,
  password: String,
}

#[derive(Serialize)]
pub struct UserOut {
  id: String,
  email: String,
  first_name: Option<String>,
  last_name: Option<String>,
  display_name: Option<String>,
  auth_provider: Option<String>,
  external_id: Option<String>,
}

#[derive(Serialize)]
pub struct SignUpResponse {
  message: String,
  user: UserOut,
}

#[derive(Serialize)]
pub struct SignInResponse {
  message: String,
  user: UserOut,
}

#[derive(Serialize)]
pub struct SignOutResponse {
  message: String,
}

#[derive(Deserialize)]
pub struct UpdateUserRequest {
  first_name: Option<String>,
  last_name: Option<String>,
  display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct OAuthSignInRequest {
  provider: String,
  user_id: String,
  email: String,
  first_name: Option<String>,
  last_name: Option<String>,
}

#[derive(Serialize)]
pub struct OAuthSignInResponse {
  message: String,
  user: UserOut,
}

// Auth handlers
pub async fn signup(
  State(state): State<Arc<AppState>>,
  jar: CookieJar,
  Json(body): Json<SignUpRequest>,
) -> Result<(CookieJar, Json<SignUpResponse>), (StatusCode, Json<ErrorResponse>)> {
  // Check if signup is disabled
  let auth_disable_signup = std::env::var("AUTH_DISABLE_SIGNUP")
    .map(|s| s == "true" || s == "1")
    .unwrap_or(false);

  if auth_disable_signup {
    return Err((
      StatusCode::UNPROCESSABLE_ENTITY,
      Json(ErrorResponse {
        error: "Sign up is disabled".to_string(),
        error_type: "SIGNUP_DISABLED".to_string(),
      }),
    ));
  }

  // Check if email/password auth is disabled
  let auth_disable_username_password = std::env::var("AUTH_DISABLE_USERNAME_PASSWORD")
    .map(|s| s == "true" || s == "1")
    .unwrap_or(false);

  if auth_disable_username_password {
    return Err((
      StatusCode::UNPROCESSABLE_ENTITY,
      Json(ErrorResponse {
        error: "Email/password sign up is disabled. Please use SSO.".to_string(),
        error_type: "USERNAME_PASSWORD_DISABLED".to_string(),
      }),
    ));
  }

  // Check if user already exists
  let existing = state.db.get_user_by_email(&body.email).await.map_err(|_| {
    (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(ErrorResponse {
        error: "Internal server error".to_string(),
        error_type: "INTERNAL_ERROR".to_string(),
      }),
    )
  })?;

  if existing.is_some() {
    return Err((
      StatusCode::CONFLICT,
      Json(ErrorResponse {
        error: "Email already in use".to_string(),
        error_type: "EMAIL_ALREADY_EXISTS".to_string(),
      }),
    ));
  }

  // Hash password
  let password_hash = hash_password(&body.password).map_err(|_| {
    (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(ErrorResponse {
        error: "Failed to hash password".to_string(),
        error_type: "INTERNAL_ERROR".to_string(),
      }),
    )
  })?;

  // Create display name
  let display_name = format!("{} {}", body.first_name, body.last_name)
    .trim()
    .to_string();

  // Create user
  let user_id = Uuid::new_v4().to_string();
  let user = state
    .db
    .create_user(
      &user_id,
      &body.email,
      &body.first_name,
      &body.last_name,
      &display_name,
      Some(&password_hash),
      None,
      None,
    )
    .await
    .map_err(|_| {
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to create user".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  // Create JWT token
  let token = create_access_token(&user.id).map_err(|_| {
    (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(ErrorResponse {
        error: "Failed to create access token".to_string(),
        error_type: "INTERNAL_ERROR".to_string(),
      }),
    )
  })?;

  // Set cookie
  let jar = set_auth_cookie(jar, &token);

  Ok((
    jar,
    Json(SignUpResponse {
      message: "User created".to_string(),
      user: UserOut {
        id: user.id,
        email: user.email,
        first_name: Some(user.first_name),
        last_name: Some(user.last_name),
        display_name: Some(user.display_name),
        auth_provider: user.auth_provider,
        external_id: user.external_id,
      },
    }),
  ))
}

pub async fn signin(
  State(state): State<Arc<AppState>>,
  jar: CookieJar,
  Json(body): Json<SignInRequest>,
) -> Result<(CookieJar, Json<SignInResponse>), StatusCode> {
  // Check if email/password auth is disabled
  let auth_disable_username_password = std::env::var("AUTH_DISABLE_USERNAME_PASSWORD")
    .map(|s| s == "true" || s == "1")
    .unwrap_or(false);

  if auth_disable_username_password {
    return Err(StatusCode::UNPROCESSABLE_ENTITY);
  }

  // Get user by email
  let user = state
    .db
    .get_user_by_email(&body.email)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;

  // Verify password
  let password_hash = user
    .password_hash
    .as_ref()
    .ok_or(StatusCode::UNAUTHORIZED)?;
  if !verify_password(&body.password, password_hash) {
    return Err(StatusCode::UNAUTHORIZED);
  }

  // Create JWT token
  let token = create_access_token(&user.id)?;

  // Set cookie
  let jar = set_auth_cookie(jar, &token);

  Ok((
    jar,
    Json(SignInResponse {
      message: "Signed in".to_string(),
      user: UserOut {
        id: user.id,
        email: user.email,
        first_name: Some(user.first_name),
        last_name: Some(user.last_name),
        display_name: Some(user.display_name),
        auth_provider: user.auth_provider,
        external_id: user.external_id,
      },
    }),
  ))
}

pub async fn signout(jar: CookieJar) -> (CookieJar, Json<SignOutResponse>) {
  let jar = delete_auth_cookie(jar);
  (
    jar,
    Json(SignOutResponse {
      message: "Signed out".to_string(),
    }),
  )
}

pub async fn me(
  State(state): State<Arc<AppState>>,
  jar: CookieJar,
  headers: HeaderMap,
) -> Result<Json<UserOut>, StatusCode> {
  let user = get_current_user(&state, &jar, &headers).await?;

  Ok(Json(UserOut {
    id: user.id,
    email: user.email,
    first_name: Some(user.first_name),
    last_name: Some(user.last_name),
    display_name: Some(user.display_name),
    auth_provider: user.auth_provider,
    external_id: user.external_id,
  }))
}

pub async fn update_user(
  State(state): State<Arc<AppState>>,
  jar: CookieJar,
  headers: HeaderMap,
  Json(req): Json<UpdateUserRequest>,
) -> Result<Json<UserOut>, StatusCode> {
  let user = get_current_user(&state, &jar, &headers).await?;

  let updated_user = state
    .db
    .update_user(
      &user.id.to_string(),
      req.first_name.as_deref(),
      req.last_name.as_deref(),
      req.display_name.as_deref(),
      None, // Don't update auth_provider
      None, // Don't update external_id
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

  Ok(Json(UserOut {
    id: updated_user.id,
    email: updated_user.email,
    first_name: Some(updated_user.first_name),
    last_name: Some(updated_user.last_name),
    display_name: Some(updated_user.display_name),
    auth_provider: updated_user.auth_provider,
    external_id: updated_user.external_id,
  }))
}

pub async fn oauth_signin(
  State(state): State<Arc<AppState>>,
  jar: CookieJar,
  Json(body): Json<OAuthSignInRequest>,
) -> Result<(CookieJar, Json<OAuthSignInResponse>), StatusCode> {
  let email = body.email.to_lowercase();

  // Check if user exists by email
  let user = state
    .db
    .get_user_by_email(&email)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

  let user = if let Some(existing_user) = user {
    // Update existing user with provider info if needed
    let mut update_first_name = None;
    let mut update_last_name = None;
    let mut update_display_name = None;
    let mut update_auth_provider = None;
    let mut update_external_id = None;

    if existing_user.auth_provider.is_none() {
      update_auth_provider = Some(body.provider.clone());
    }
    if existing_user.external_id.is_none() && !body.user_id.is_empty() {
      update_external_id = Some(body.user_id.clone());
    }
    if (existing_user.first_name.is_empty() || existing_user.first_name.is_empty())
      && body.first_name.is_some()
    {
      update_first_name = body.first_name.clone();
    }
    if (existing_user.last_name.is_empty() || existing_user.last_name.is_empty())
      && body.last_name.is_some()
    {
      update_last_name = body.last_name.clone();
    }
    if existing_user.display_name.is_empty() || existing_user.display_name.is_empty() {
      let display_name =
        if let (Some(fn_val), Some(ln_val)) = (body.first_name.as_ref(), body.last_name.as_ref()) {
          format!("{} {}", fn_val, ln_val).trim().to_string()
        } else if !email.is_empty() {
          email.split('@').next().unwrap_or("").to_string()
        } else {
          "".to_string()
        };
      if !display_name.is_empty() {
        update_display_name = Some(display_name);
      }
    }

    if update_first_name.is_some()
      || update_last_name.is_some()
      || update_display_name.is_some()
      || update_auth_provider.is_some()
      || update_external_id.is_some()
    {
      state
        .db
        .update_user(
          &existing_user.id,
          update_first_name.as_deref(),
          update_last_name.as_deref(),
          update_display_name.as_deref(),
          update_auth_provider.as_deref(),
          update_external_id.as_deref(),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
      existing_user
    }
  } else {
    // Create new user
    let display_name =
      if let (Some(fn_val), Some(ln_val)) = (body.first_name.as_ref(), body.last_name.as_ref()) {
        format!("{} {}", fn_val, ln_val).trim().to_string()
      } else if !email.is_empty() {
        email.split('@').next().unwrap_or("").to_string()
      } else {
        "".to_string()
      };

    let user_id = Uuid::new_v4().to_string();
    state
      .db
      .create_user(
        &user_id,
        &email,
        body.first_name.as_deref().unwrap_or(""),
        body.last_name.as_deref().unwrap_or(""),
        &display_name,
        None, // No password for OAuth users
        Some(&body.provider),
        Some(&body.user_id),
      )
      .await
      .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
  };

  // Create JWT token
  let token = create_access_token(&user.id)?;

  // Set cookie
  let jar = set_auth_cookie(jar, &token);

  Ok((
    jar,
    Json(OAuthSignInResponse {
      message: "Signed in via OAuth".to_string(),
      user: UserOut {
        id: user.id,
        email: user.email,
        first_name: Some(user.first_name),
        last_name: Some(user.last_name),
        display_name: Some(user.display_name),
        auth_provider: user.auth_provider,
        external_id: user.external_id,
      },
    }),
  ))
}
