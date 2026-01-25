use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worker {
  pub id: Uuid,
  pub status: String,
  pub last_heartbeat: DateTime<Utc>,
  pub capabilities: Option<serde_json::Value>,
  pub current_deployment_id: Option<String>,
  pub created_at: DateTime<Utc>,
  // Push-based worker fields
  pub mode: Option<String>, // "push" or "pull", default: "push"
  pub push_endpoint_url: Option<String>,
  pub max_concurrent_executions: Option<i32>,
  pub current_execution_count: Option<i32>,
  pub last_push_attempt_at: Option<DateTime<Utc>>,
  pub push_failure_count: Option<i32>,
  pub push_failure_threshold: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Execution {
  pub id: Uuid,
  pub workflow_id: String,
  pub status: String,
  pub payload: serde_json::Value,
  pub result: Option<serde_json::Value>,
  pub error: Option<String>,
  pub created_at: DateTime<Utc>,
  pub started_at: Option<DateTime<Utc>>,
  pub completed_at: Option<DateTime<Utc>>,
  pub deployment_id: Option<String>,
  pub assigned_to_worker: Option<Uuid>,
  pub parent_execution_id: Option<Uuid>,
  pub root_execution_id: Option<Uuid>,
  pub retry_count: i32,
  pub step_key: Option<String>,
  pub queue_name: String,
  pub concurrency_key: Option<String>,
  pub batch_id: Option<Uuid>,
  pub session_id: Option<String>,
  pub user_id: Option<String>,
  pub output_schema_name: Option<String>,
  pub otel_traceparent: Option<String>,
  pub otel_span_id: Option<String>,
  pub claimed_at: Option<DateTime<Utc>>,
  pub queued_at: Option<DateTime<Utc>>,
  pub initial_state: Option<serde_json::Value>,
  pub final_state: Option<serde_json::Value>,
  pub run_timeout_seconds: Option<i32>,
  pub cancelled_at: Option<DateTime<Utc>>,
  pub cancelled_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
  pub id: Uuid,
  pub sequence_id: i64,
  pub topic: String,
  pub event_type: Option<String>,
  pub data: serde_json::Value,
  pub status: String,
  pub execution_id: Option<Uuid>,
  pub attempt_number: i32,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct EventTopic {
  pub id: Uuid,
  pub topic: String,
  pub description: Option<String>,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDefinition {
  pub id: String,
  pub deployment_id: String,
  pub provider: String,
  pub model: String,
  pub system_prompt: Option<String>,
  pub tools: Option<serde_json::Value>,
  pub temperature: Option<f64>,
  pub max_output_tokens: Option<i32>,
  pub config: Option<serde_json::Value>,
  pub metadata: Option<serde_json::Value>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
  pub id: String,
  pub deployment_id: String,
  pub tool_type: String, // "default", "code_interpreter", etc.
  pub description: Option<String>,
  pub parameters: Option<serde_json::Value>,
  pub metadata: Option<serde_json::Value>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentWorkflow {
  pub workflow_id: String,
  pub deployment_id: String,
  pub workflow_type: String,
  pub trigger_on_event: bool,
  pub scheduled: bool,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ExpiredWait {
  pub execution_id: Uuid,
  pub root_execution_id: Uuid,
  pub wait_type: String,
  pub step_key: String,
  pub wait_until: Option<DateTime<Utc>>,
  pub wait_topic: Option<String>,
  pub expires_at: Option<DateTime<Utc>>,
}

/// Data structure for batch execution creation
pub struct ExecutionData {
  pub workflow_id: String,
  pub payload: serde_json::Value,
  pub parent_execution_id: Option<Uuid>,
  pub root_execution_id: Option<Uuid>,
  pub step_key: Option<String>,
  pub queue_name: Option<String>,
  pub concurrency_key: Option<String>,
  pub queue_concurrency_limit: Option<i32>,
  pub wait_for_subworkflow: bool,
  pub batch_id: Option<Uuid>,
  pub session_id: Option<String>,
  pub user_id: Option<String>,
  pub otel_traceparent: Option<String>,
  pub initial_state: Option<serde_json::Value>,
  pub run_timeout_seconds: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deployment {
  pub id: String,
  pub project_id: Uuid,
  pub status: String,
  pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[sqlx(type_name = "project_role", rename_all = "UPPERCASE")]
pub enum ProjectRole {
  #[sqlx(rename = "ADMIN")]
  Admin,
  #[sqlx(rename = "WRITE")]
  Write,
  #[sqlx(rename = "READ")]
  Read,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Project {
  pub id: Uuid,
  pub name: String,
  pub description: Option<String>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
  pub id: String,
  pub email: String,
  pub first_name: String,
  pub last_name: String,
  pub display_name: String,
  pub password_hash: Option<String>,
  pub auth_provider: Option<String>,
  pub external_id: Option<String>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProjectMember {
  pub id: String,
  pub user_id: String,
  pub project_id: Uuid,
  pub role: ProjectRole,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ApiKey {
  pub id: Uuid,
  pub name: String,
  pub key_hash: String, // HMAC-SHA256 hash for lookup
  pub last_four_digits: String,
  pub project_id: Uuid,
  pub created_by_id: Option<String>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
  pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
  pub id: Uuid,
  pub workflow_id: String,
  pub cron: String,
  pub timezone: String,
  pub key: String,
  pub status: String,
  pub last_run_at: Option<DateTime<Utc>>,
  pub next_run_at: DateTime<Utc>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}
