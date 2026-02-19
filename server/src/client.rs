use anyhow::{Context, Result};
use futures::stream::Stream;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};

use crate::config::ServerConfig;

pub struct OrchestratorClient {
    client: reqwest::Client,
    base_url: String,
    project_id: String,
    api_key: String,
}

// --- Response types ---

#[derive(Debug, Deserialize)]
pub struct AgentDefinition {
    pub id: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub tools: Option<serde_json::Value>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<i32>,
    pub config: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
    pub deployment_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ActiveWorkersResponse {
    pub worker_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SubmitWorkflowRequest {
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitWorkflowResponse {
    pub execution_id: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExecutionResponse {
    pub id: String,
    pub workflow_id: Option<String>,
    pub status: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EventData {
    pub id: Option<String>,
    pub sequence_id: Option<i64>,
    pub topic: Option<String>,
    pub event_type: Option<String>,
    pub data: Option<serde_json::Value>,
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GetEventsResponse {
    pub events: Vec<EventData>,
    pub next_sequence_id: Option<i64>,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
pub struct WorkflowRunSummary {
    pub execution_id: String,
    pub workflow_id: String,
    pub status: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeploymentWorkflow {
    pub workflow_id: String,
    pub workflow_type: Option<String>,
    pub deployment_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ToolDefinition {
    pub id: String,
    pub deployment_id: Option<String>,
    pub tool_type: Option<String>,
    pub description: Option<String>,
    pub parameters: Option<serde_json::Value>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct ApprovalResponse {
    pub execution_id: String,
    pub step_key: String,
    pub status: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct SubmitApprovalRequest {
    pub data: serde_json::Value,
}

impl OrchestratorClient {
    pub fn from_config(config: &ServerConfig) -> Self {
        let base_url = format!("http://127.0.0.1:{}", config.orchestrator_port);

        let mut headers = HeaderMap::new();
        headers.insert(
            "X-Project-ID",
            HeaderValue::from_str(&config.project_id).unwrap(),
        );
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", config.api_key)).unwrap(),
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            base_url,
            project_id: config.project_id.clone(),
            api_key: config.api_key.clone(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    // --- Agent operations ---

    pub async fn list_agents(&self) -> Result<Vec<AgentDefinition>> {
        let resp = self
            .client
            .get(format!("{}/api/v1/agents", self.base_url))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to list agents: {} {}", status, body);
        }

        resp.json().await.context("Failed to parse agents response")
    }

    pub async fn get_agent(&self, agent_id: &str) -> Result<AgentDefinition> {
        let resp = self
            .client
            .get(format!("{}/api/v1/agents/{}", self.base_url, agent_id))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to get agent '{}': {} {}", agent_id, status, body);
        }

        resp.json().await.context("Failed to parse agent response")
    }

    pub async fn has_active_workers(&self) -> bool {
        let resp = self
            .client
            .get(format!("{}/api/v1/workers/active", self.base_url))
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => r
                .json::<ActiveWorkersResponse>()
                .await
                .map(|aw| !aw.worker_ids.is_empty())
                .unwrap_or(false),
            _ => false,
        }
    }

    // --- Execution operations ---

    pub async fn submit_workflow(
        &self,
        workflow_id: &str,
        request: &SubmitWorkflowRequest,
    ) -> Result<SubmitWorkflowResponse> {
        let resp = self
            .client
            .post(format!(
                "{}/api/v1/workflows/{}/run",
                self.base_url, workflow_id
            ))
            .json(request)
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to submit workflow: {} {}", status, body);
        }

        resp.json().await.context("Failed to parse submit response")
    }

    pub async fn get_execution(&self, execution_id: &str) -> Result<ExecutionResponse> {
        let resp = self
            .client
            .get(format!(
                "{}/api/v1/executions/{}",
                self.base_url, execution_id
            ))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to get execution '{}': {} {}",
                execution_id,
                status,
                body
            );
        }

        resp.json()
            .await
            .context("Failed to parse execution response")
    }

    pub async fn cancel_execution(&self, execution_id: &str) -> Result<()> {
        let resp = self
            .client
            .post(format!(
                "{}/api/v1/executions/{}/cancel",
                self.base_url, execution_id
            ))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to cancel execution '{}': {} {}",
                execution_id,
                status,
                body
            );
        }

        Ok(())
    }

    // --- Event operations ---

    pub async fn stream_events(
        &self,
        query_params: &[(&str, &str)],
    ) -> Result<impl Stream<Item = Result<bytes::Bytes, reqwest::Error>>> {
        let resp = self
            .client
            .get(format!("{}/api/v1/events/stream", self.base_url))
            .query(query_params)
            .send()
            .await
            .context("Failed to connect to orchestrator for SSE stream")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to stream events: {} {}", status, body);
        }

        Ok(resp.bytes_stream())
    }

    pub async fn get_events(&self, query_params: &[(&str, &str)]) -> Result<GetEventsResponse> {
        let resp = self
            .client
            .get(format!("{}/api/v1/events", self.base_url))
            .query(query_params)
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to get events: {} {}", status, body);
        }

        resp.json().await.context("Failed to parse events response")
    }

    // --- Approval operations ---

    pub async fn get_approval(
        &self,
        execution_id: &str,
        step_key: &str,
    ) -> Result<ApprovalResponse> {
        let resp = self
            .client
            .get(format!(
                "{}/api/v1/approvals/{}/{}",
                self.base_url, execution_id, step_key
            ))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to get approval for {}/{}: {} {}",
                execution_id,
                step_key,
                status,
                body
            );
        }

        resp.json()
            .await
            .context("Failed to parse approval response")
    }

    pub async fn submit_approval(
        &self,
        execution_id: &str,
        step_key: &str,
        data: serde_json::Value,
    ) -> Result<()> {
        let resp = self
            .client
            .post(format!(
                "{}/api/v1/approvals/{}/{}/submit",
                self.base_url, execution_id, step_key
            ))
            .json(&SubmitApprovalRequest { data })
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        // 409 = already submitted (e.g., SSE replay after reconnect) — treat as success
        if resp.status() == reqwest::StatusCode::CONFLICT {
            return Ok(());
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to submit approval for {}/{}: {} {}",
                execution_id,
                step_key,
                status,
                body
            );
        }

        Ok(())
    }

    // --- Workflow operations ---

    pub async fn list_workflows(&self) -> Result<Vec<DeploymentWorkflow>> {
        let resp = self
            .client
            .get(format!("{}/api/v1/workflows", self.base_url))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to list workflows: {} {}", status, body);
        }

        resp.json()
            .await
            .context("Failed to parse workflows response")
    }

    pub async fn get_workflow(&self, workflow_id: &str) -> Result<DeploymentWorkflow> {
        let resp = self
            .client
            .get(format!(
                "{}/api/v1/workflows/{}",
                self.base_url, workflow_id
            ))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to get workflow '{}': {} {}",
                workflow_id,
                status,
                body
            );
        }

        resp.json()
            .await
            .context("Failed to parse workflow response")
    }

    pub async fn get_workflow_runs(
        &self,
        query_params: &[(&str, &str)],
    ) -> Result<Vec<WorkflowRunSummary>> {
        let resp = self
            .client
            .get(format!("{}/api/v1/workflows/runs", self.base_url))
            .query(query_params)
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to get workflow runs: {} {}", status, body);
        }

        resp.json()
            .await
            .context("Failed to parse workflow runs response")
    }
    // --- Tool operations ---

    pub async fn list_tools(&self) -> Result<Vec<ToolDefinition>> {
        let resp = self
            .client
            .get(format!("{}/api/v1/tools", self.base_url))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to list tools: {} {}", status, body);
        }

        resp.json().await.context("Failed to parse tools response")
    }

    pub async fn get_tool(&self, tool_id: &str) -> Result<ToolDefinition> {
        let resp = self
            .client
            .get(format!("{}/api/v1/tools/{}", self.base_url, tool_id))
            .send()
            .await
            .context("Failed to connect to orchestrator")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Failed to get tool '{}': {} {}", tool_id, status, body);
        }

        resp.json().await.context("Failed to parse tool response")
    }
}

/// Load config and create client, with user-friendly error message
pub fn create_client() -> Result<OrchestratorClient> {
    let config =
        ServerConfig::load()?.context("Polos not initialized. Run 'polos server start' first.")?;
    Ok(OrchestratorClient::from_config(&config))
}
