use axum::async_trait;
use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

// Project ID extractor - extracts project_id from headers
pub struct ProjectId(pub Uuid);
pub struct OptionalProjectId(pub Option<Uuid>);

#[async_trait]
impl<S> FromRequestParts<S> for ProjectId
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // Get from header (X-Project-ID or Project-ID)
        let project_id_str = parts
            .headers
            .get("X-Project-ID")
            .or_else(|| parts.headers.get("Project-ID"))
            .and_then(|h| h.to_str().ok())
            .ok_or(StatusCode::BAD_REQUEST)?;

        let project_id = Uuid::parse_str(project_id_str).map_err(|_| StatusCode::BAD_REQUEST)?;

        Ok(ProjectId(project_id))
    }
}

// Optional Project ID extractor - extracts project_id from headers (optional)
#[async_trait]
impl<S> FromRequestParts<S> for OptionalProjectId
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // Get from header (X-Project-ID or Project-ID) - optional
        let project_id = parts
            .headers
            .get("X-Project-ID")
            .or_else(|| parts.headers.get("Project-ID"))
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok());

        Ok(OptionalProjectId(project_id))
    }
}

/// Standard error response
#[derive(Serialize, ToSchema)]
pub struct ErrorResponse {
    /// Human-readable error message
    pub error: String,
    /// Machine-readable error type code
    pub error_type: String,
}
