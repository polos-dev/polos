use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::Arc;
use uuid::Uuid;

use crate::api::common::ProjectId;
use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(serde::Deserialize)]
struct SlackAction {
    action_id: String,
    value: Option<String>,
}

#[derive(serde::Deserialize)]
struct SlackUser {
    username: Option<String>,
}

#[derive(serde::Deserialize)]
struct SlackMessage {
    blocks: Option<Vec<serde_json::Value>>,
}

#[derive(serde::Deserialize)]
struct SlackInteractionPayload {
    actions: Vec<SlackAction>,
    user: Option<SlackUser>,
    response_url: Option<String>,
    message: Option<SlackMessage>,
}

#[derive(serde::Deserialize)]
struct ActionValue {
    #[serde(rename = "executionId")]
    execution_id: String,
    #[serde(rename = "stepKey")]
    step_key: String,
    approved: bool,
}

/// Handle Slack interactive component callbacks (button clicks).
///
/// Slack sends a URL-encoded body: `payload=<url-encoded-json>`.
/// We verify the request signature, parse the payload, and resume the execution.
pub async fn handle_interaction(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let body_str = std::str::from_utf8(&body).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Verify Slack signature
    verify_slack_signature(&headers, body_str)?;

    // Parse URL-encoded body to extract payload JSON
    let payload_json = extract_payload(body_str)?;
    let payload: SlackInteractionPayload = serde_json::from_str(&payload_json).map_err(|e| {
        tracing::error!("Failed to parse Slack interaction payload: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    let action = payload.actions.first().ok_or(StatusCode::BAD_REQUEST)?;

    // Only handle our approve/reject actions
    if action.action_id != "polos_approve" && action.action_id != "polos_reject" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let value_str = action.value.as_deref().ok_or(StatusCode::BAD_REQUEST)?;
    let action_value: ActionValue = serde_json::from_str(value_str).map_err(|e| {
        tracing::error!("Failed to parse action value: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    let username = payload
        .user
        .as_ref()
        .and_then(|u| u.username.as_deref())
        .unwrap_or("unknown")
        .to_string();

    let response_url = payload.response_url.clone();
    let original_blocks = payload.message.and_then(|m| m.blocks).unwrap_or_default();

    let execution_id_uuid =
        Uuid::parse_str(&action_value.execution_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Spawn async work so we can respond to Slack within 3 seconds.
    // We use response_url to update the original message after processing.
    let state_clone = state.clone();
    let approved = action_value.approved;
    let step_key = action_value.step_key.clone();
    tokio::spawn(async move {
        let result = process_interaction(
            &state_clone,
            &execution_id_uuid,
            &step_key,
            approved,
            &username,
            response_url.as_deref(),
            &original_blocks,
        )
        .await;
        if let Err(e) = result {
            tracing::error!(
                "Failed to process Slack interaction for execution {}: {}",
                execution_id_uuid,
                e
            );
        }
    });

    // Return 200 immediately — the original message will be updated via response_url
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Process the Slack interaction asynchronously and update the original message
/// via Slack's `response_url`.
async fn process_interaction(
    state: &Arc<AppState>,
    execution_id_uuid: &Uuid,
    step_key: &str,
    approved: bool,
    username: &str,
    response_url: Option<&str>,
    original_blocks: &[serde_json::Value],
) -> Result<(), String> {
    // Get project_id from execution and set RLS
    let project_id = state
        .db
        .get_project_id_from_execution(execution_id_uuid)
        .await
        .map_err(|e| format!("Failed to get project_id: {}", e))?;

    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| format!("Failed to set project_id: {}", e))?;

    // Verify execution is still waiting
    let execution = state
        .db
        .get_execution(execution_id_uuid)
        .await
        .map_err(|e| format!("Failed to get execution: {}", e))?;

    if execution.status != "waiting" {
        let message = format!(
            "This request has already been handled (status: {}).",
            execution.status
        );
        if let Some(url) = response_url {
            update_slack_message(url, &message, &[]).await;
        }
        return Ok(());
    }

    // Publish resume event
    let topic = format!("workflow/{}/{}", execution.workflow_id, execution_id_uuid);
    let event_type = format!("resume_{}", step_key);
    let event_data = serde_json::json!({ "approved": approved });
    let events: Vec<(Option<String>, serde_json::Value, Option<Uuid>, i32)> =
        vec![(Some(event_type), event_data, None, 0)];

    state
        .db
        .publish_events_batch(topic, events, None, None, &project_id)
        .await
        .map_err(|e| format!("Failed to publish resume event: {}", e))?;

    // Build replacement: keep original blocks but replace action buttons with status
    let action_text = if approved { "Approved" } else { "Rejected" };
    let emoji = if approved {
        "\u{2705}" // check mark
    } else {
        "\u{274C}" // X mark
    };
    let status_text = format!("{} {} by @{}", emoji, action_text, username);

    // Keep original blocks (header, description, context) but strip the actions block,
    // then append a status line so the user can still see what was approved/rejected.
    let mut replacement_blocks: Vec<serde_json::Value> = original_blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) != Some("actions"))
        .cloned()
        .collect();
    replacement_blocks.push(serde_json::json!({
        "type": "context",
        "elements": [{ "type": "mrkdwn", "text": status_text }]
    }));

    if let Some(url) = response_url {
        update_slack_message(url, &status_text, &replacement_blocks).await;
    }

    Ok(())
}

/// POST a replacement message to Slack's `response_url` to update the original message.
async fn update_slack_message(
    response_url: &str,
    fallback_text: &str,
    blocks: &[serde_json::Value],
) {
    let client = reqwest::Client::new();
    let body = if blocks.is_empty() {
        serde_json::json!({
            "replace_original": "true",
            "text": fallback_text,
            "blocks": [{
                "type": "section",
                "text": { "type": "mrkdwn", "text": fallback_text }
            }]
        })
    } else {
        serde_json::json!({
            "replace_original": "true",
            "text": fallback_text,
            "blocks": blocks,
        })
    };

    match client.post(response_url).json(&body).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                tracing::warn!(
                    "Slack response_url returned status {}: {:?}",
                    resp.status(),
                    resp.text().await.ok()
                );
            }
        }
        Err(e) => {
            tracing::error!("Failed to POST to Slack response_url: {}", e);
        }
    }
}

/// Extract the `payload` field from URL-encoded body.
///
/// Slack sends the body as `application/x-www-form-urlencoded` where spaces
/// are encoded as `+`.  `urlencoding::decode` only handles `%XX` sequences,
/// so we first replace `+` with `%20` before decoding.
fn extract_payload(body: &str) -> Result<String, StatusCode> {
    for pair in body.split('&') {
        if let Some(value) = pair.strip_prefix("payload=") {
            // Convert form-urlencoded '+' → '%20' so urlencoding::decode handles spaces
            let value = value.replace('+', "%20");
            let decoded = urlencoding::decode(&value).map_err(|e| {
                tracing::error!("Failed to URL-decode payload: {}", e);
                StatusCode::BAD_REQUEST
            })?;
            return Ok(decoded.into_owned());
        }
    }
    tracing::error!("No payload field found in Slack interaction body");
    Err(StatusCode::BAD_REQUEST)
}

/// Verify the Slack request signature using HMAC-SHA256.
///
/// Protocol: https://api.slack.com/authentication/verifying-requests-from-slack
fn verify_slack_signature(headers: &HeaderMap, body: &str) -> Result<(), StatusCode> {
    let signing_secret = std::env::var("SLACK_SIGNING_SECRET").map_err(|_| {
        tracing::error!("SLACK_SIGNING_SECRET env var not set");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let timestamp = headers
        .get("X-Slack-Request-Timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Reject requests older than 5 minutes
    let ts: i64 = timestamp.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let now = chrono::Utc::now().timestamp();
    if (now - ts).unsigned_abs() > 300 {
        tracing::warn!("Slack request timestamp too old: {} (now: {})", ts, now);
        return Err(StatusCode::UNAUTHORIZED);
    }

    let sig_basestring = format!("v0:{}:{}", timestamp, body);

    let mut mac = HmacSha256::new_from_slice(signing_secret.as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    mac.update(sig_basestring.as_bytes());
    let expected = format!("v0={}", hex::encode(mac.finalize().into_bytes()));

    let actual = headers
        .get("X-Slack-Signature")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if expected != actual {
        tracing::warn!("Slack signature mismatch");
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(())
}

// ── Slack Events API (app_mention) ────────────────────────────────────

#[derive(serde::Deserialize)]
struct SlackUrlVerification {
    r#type: String,
    challenge: Option<String>,
}

#[derive(serde::Deserialize)]
struct SlackEventWrapper {
    api_app_id: String,
    event: SlackEvent,
}

#[derive(serde::Deserialize)]
struct SlackEvent {
    r#type: String,
    channel: String,
    text: String,
    user: String,
    ts: String,
    thread_ts: Option<String>,
}

// ── Slack App Registration ─────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct RegisterSlackAppRequest {
    pub api_app_id: String,
}

/// Register a Slack app for a project (authenticated).
pub async fn register_slack_app(
    State(state): State<Arc<AppState>>,
    ProjectId(project_id): ProjectId,
    Json(req): Json<RegisterSlackAppRequest>,
) -> Result<StatusCode, StatusCode> {
    state
        .db
        .upsert_slack_app(&req.api_app_id, &project_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to register Slack app: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::OK)
}

// ── Agent ID Parsing ──────────────────────────────────────────────

/// Parse the agent ID from a Slack message text.
///
/// Expects the pattern: `<@UBOT> @research-agent do something`
/// Skips Slack user-mention tokens (`<@U...>`) and returns the first
/// `@word` token stripped of its `@` prefix.
/// Returns `Some("research-agent")` if found, `None` otherwise.
fn parse_agent_id(text: &str) -> Option<&str> {
    for token in text.split_whitespace() {
        // Skip Slack user/bot mentions like <@U123ABC>
        if token.starts_with("<@") {
            continue;
        }
        if let Some(stripped) = token.strip_prefix('@') {
            if !stripped.is_empty() {
                return Some(stripped);
            }
        }
    }
    None
}

/// Handle Slack Events API callbacks (e.g., app_mention).
///
/// Supports URL verification challenges and app_mention events that trigger
/// agent workflows with bidirectional channel context.
///
/// Two flows:
/// - **New thread**: parses `@agent-id` from message text, looks up deployment
/// - **Follow-up**: finds existing execution by channel+thread, reuses agent/session
pub async fn handle_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let body_str = std::str::from_utf8(&body).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Handle URL verification challenge (one-time Slack setup)
    if let Ok(challenge) = serde_json::from_str::<SlackUrlVerification>(body_str) {
        if challenge.r#type == "url_verification" {
            if let Some(challenge_value) = challenge.challenge {
                return Ok(Json(serde_json::json!({ "challenge": challenge_value })));
            }
        }
    }

    // Verify Slack signature
    verify_slack_signature(&headers, body_str)?;

    // Parse event wrapper
    let event_wrapper: SlackEventWrapper = serde_json::from_str(body_str).map_err(|e| {
        tracing::error!("Failed to parse Slack event: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    // Only handle app_mention events
    if event_wrapper.event.r#type != "app_mention" {
        return Ok(Json(serde_json::json!({ "ok": true })));
    }

    let event = &event_wrapper.event;

    // Look up project_id from slack_apps table using api_app_id
    let project_id = state
        .db
        .get_slack_app(&event_wrapper.api_app_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to look up Slack app: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or_else(|| {
            tracing::warn!(
                "No project registered for Slack app {}",
                event_wrapper.api_app_id
            );
            StatusCode::NOT_FOUND
        })?;

    state
        .db
        .set_project_id(&project_id, false)
        .await
        .map_err(|e| {
            tracing::error!("Failed to set project_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Determine new thread vs follow-up:
    //   thread_ts is None or thread_ts == ts → new thread
    //   thread_ts is Some and thread_ts != ts → follow-up in existing thread
    let is_follow_up = event.thread_ts.as_ref().is_some_and(|tts| tts != &event.ts);

    // The thread timestamp for channel_context: use thread_ts if it's a
    // follow-up, otherwise use ts (which starts a new thread).
    let thread_ts = if is_follow_up {
        event.thread_ts.as_deref().unwrap()
    } else {
        &event.ts
    };

    let (agent_id, deployment_id, session_id);

    if is_follow_up {
        // ── Follow-up in existing thread ──────────────────────────
        let prev = state
            .db
            .get_execution_by_channel_thread(&event.channel, thread_ts)
            .await
            .map_err(|e| {
                tracing::error!("Failed to look up previous execution: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?
            .ok_or_else(|| {
                tracing::warn!(
                    "No previous execution for channel={} thread_ts={}",
                    event.channel,
                    thread_ts
                );
                StatusCode::NOT_FOUND
            })?;

        agent_id = prev.workflow_id;
        deployment_id = prev.deployment_id.unwrap_or_default();
        session_id = prev
            .session_id
            .unwrap_or_else(|| Uuid::new_v4().to_string());
    } else {
        // ── New thread ────────────────────────────────────────────
        let parsed_agent = parse_agent_id(&event.text).ok_or_else(|| {
            tracing::warn!("No @agent-id found in message: {}", event.text);
            StatusCode::BAD_REQUEST
        })?;

        let dep_id = state
            .db
            .get_latest_deployment_id_for_agent(parsed_agent, &project_id)
            .await
            .map_err(|e| {
                tracing::error!("Failed to look up deployment for agent: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?
            .ok_or_else(|| {
                tracing::warn!(
                    "No deployment found for agent {} in project {}",
                    parsed_agent,
                    project_id
                );
                StatusCode::NOT_FOUND
            })?;

        agent_id = parsed_agent.to_string();
        deployment_id = dep_id;
        session_id = Uuid::new_v4().to_string();
    }

    // Build channel context for bidirectional routing
    let channel_context = serde_json::json!({
        "channel_id": "slack",
        "source": {
            "channel": event.channel,
            "threadTs": thread_ts,
            "user": event.user,
        }
    });

    // Create execution
    let payload = serde_json::json!({ "input": event.text });
    let queue_name = agent_id.clone();

    let (_execution_id, _created_at) = state
        .db
        .create_execution(
            &agent_id,
            payload,
            &deployment_id,
            None,
            None,
            None,
            queue_name,
            None,
            false,
            Some(&session_id),
            None,
            None,
            &project_id,
            None,
            None,
            Some(channel_context),
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to create execution from Slack event: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Trigger dispatch
    let state_clone = state.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::api::workers::try_dispatch_execution(&state_clone).await {
            tracing::error!("Failed to dispatch execution: {}", e);
        }
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use std::sync::Mutex;

    /// Guards env-var mutations so signature tests don't race.
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    // ── extract_payload ────────────────────────────────────────────────

    #[test]
    fn extract_payload_decodes_url_encoded_json() {
        let body = "payload=%7B%22actions%22%3A%5B%5D%7D";
        let result = extract_payload(body).unwrap();
        assert_eq!(result, r#"{"actions":[]}"#);
    }

    #[test]
    fn extract_payload_handles_multiple_fields() {
        let body = "token=abc&payload=%7B%22ok%22%3Atrue%7D&trigger_id=123";
        let result = extract_payload(body).unwrap();
        assert_eq!(result, r#"{"ok":true}"#);
    }

    #[test]
    fn extract_payload_fails_when_no_payload_field() {
        let body = "token=abc&trigger_id=123";
        let result = extract_payload(body);
        assert_eq!(result.unwrap_err(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn extract_payload_handles_special_characters() {
        // payload containing spaces encoded as '+' (form-urlencoded)
        let body = "payload=%7B%22text%22%3A%22hello+world%22%7D";
        let result = extract_payload(body).unwrap();
        assert_eq!(result, r#"{"text":"hello world"}"#);
    }

    // ── verify_slack_signature ─────────────────────────────────────────

    /// Helper: compute a valid Slack signature for given secret, timestamp, body.
    fn compute_signature(secret: &str, timestamp: &str, body: &str) -> String {
        let basestring = format!("v0:{}:{}", timestamp, body);
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC init");
        mac.update(basestring.as_bytes());
        format!("v0={}", hex::encode(mac.finalize().into_bytes()))
    }

    #[test]
    fn verify_signature_accepts_valid_request() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let secret = "test_signing_secret_abc123";
        let timestamp = chrono::Utc::now().timestamp().to_string();
        let body = "payload=%7B%7D";
        let signature = compute_signature(secret, &timestamp, body);

        std::env::set_var("SLACK_SIGNING_SECRET", secret);

        let mut headers = HeaderMap::new();
        headers.insert("X-Slack-Request-Timestamp", timestamp.parse().unwrap());
        headers.insert("X-Slack-Signature", signature.parse().unwrap());

        let result = verify_slack_signature(&headers, body);
        std::env::remove_var("SLACK_SIGNING_SECRET");
        assert!(result.is_ok());
    }

    #[test]
    fn verify_signature_rejects_wrong_signature() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let secret = "test_signing_secret_abc123";
        let timestamp = chrono::Utc::now().timestamp().to_string();
        let body = "payload=%7B%7D";

        std::env::set_var("SLACK_SIGNING_SECRET", secret);

        let mut headers = HeaderMap::new();
        headers.insert("X-Slack-Request-Timestamp", timestamp.parse().unwrap());
        headers.insert("X-Slack-Signature", "v0=bad_signature".parse().unwrap());

        let result = verify_slack_signature(&headers, body);
        std::env::remove_var("SLACK_SIGNING_SECRET");
        assert_eq!(result.unwrap_err(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn verify_signature_rejects_old_timestamp() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let secret = "test_signing_secret_abc123";
        // 10 minutes ago — exceeds 5-minute window
        let old_ts = (chrono::Utc::now().timestamp() - 600).to_string();
        let body = "payload=%7B%7D";
        let signature = compute_signature(secret, &old_ts, body);

        std::env::set_var("SLACK_SIGNING_SECRET", secret);

        let mut headers = HeaderMap::new();
        headers.insert("X-Slack-Request-Timestamp", old_ts.parse().unwrap());
        headers.insert("X-Slack-Signature", signature.parse().unwrap());

        let result = verify_slack_signature(&headers, body);
        std::env::remove_var("SLACK_SIGNING_SECRET");
        assert_eq!(result.unwrap_err(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn verify_signature_rejects_missing_timestamp_header() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let secret = "test_signing_secret_abc123";
        std::env::set_var("SLACK_SIGNING_SECRET", secret);

        let mut headers = HeaderMap::new();
        headers.insert("X-Slack-Signature", "v0=abc".parse().unwrap());

        let result = verify_slack_signature(&headers, "body");
        std::env::remove_var("SLACK_SIGNING_SECRET");
        assert_eq!(result.unwrap_err(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn verify_signature_rejects_missing_signature_header() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let secret = "test_signing_secret_abc123";
        let timestamp = chrono::Utc::now().timestamp().to_string();
        std::env::set_var("SLACK_SIGNING_SECRET", secret);

        let mut headers = HeaderMap::new();
        headers.insert("X-Slack-Request-Timestamp", timestamp.parse().unwrap());

        let result = verify_slack_signature(&headers, "body");
        std::env::remove_var("SLACK_SIGNING_SECRET");
        assert_eq!(result.unwrap_err(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn verify_signature_returns_500_when_secret_not_set() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::remove_var("SLACK_SIGNING_SECRET");

        let mut headers = HeaderMap::new();
        headers.insert("X-Slack-Request-Timestamp", "12345".parse().unwrap());
        headers.insert("X-Slack-Signature", "v0=abc".parse().unwrap());

        let result = verify_slack_signature(&headers, "body");
        assert_eq!(result.unwrap_err(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    // ── Deserialization ────────────────────────────────────────────────

    #[test]
    fn action_value_deserializes_from_camel_case() {
        let json = r#"{"executionId":"exec-1","stepKey":"step-1","approved":true}"#;
        let v: ActionValue = serde_json::from_str(json).unwrap();
        assert_eq!(v.execution_id, "exec-1");
        assert_eq!(v.step_key, "step-1");
        assert!(v.approved);
    }

    #[test]
    fn action_value_deserializes_rejected() {
        let json = r#"{"executionId":"exec-2","stepKey":"s","approved":false}"#;
        let v: ActionValue = serde_json::from_str(json).unwrap();
        assert!(!v.approved);
    }

    #[test]
    fn slack_interaction_payload_deserializes() {
        let json = r#"{
            "actions": [{
                "action_id": "polos_approve",
                "value": "{\"executionId\":\"e\",\"stepKey\":\"s\",\"approved\":true}"
            }],
            "user": { "username": "alice" }
        }"#;
        let p: SlackInteractionPayload = serde_json::from_str(json).unwrap();
        assert_eq!(p.actions.len(), 1);
        assert_eq!(p.actions[0].action_id, "polos_approve");
        assert_eq!(p.user.unwrap().username.unwrap(), "alice");
    }

    #[test]
    fn slack_interaction_payload_works_without_user() {
        let json = r#"{ "actions": [{ "action_id": "polos_reject" }] }"#;
        let p: SlackInteractionPayload = serde_json::from_str(json).unwrap();
        assert_eq!(p.actions[0].action_id, "polos_reject");
        assert!(p.user.is_none());
    }

    // ── Slack Events API types ───────────────────────────────────────

    #[test]
    fn url_verification_deserializes() {
        let json = r#"{"type":"url_verification","challenge":"abc123"}"#;
        let v: SlackUrlVerification = serde_json::from_str(json).unwrap();
        assert_eq!(v.r#type, "url_verification");
        assert_eq!(v.challenge.unwrap(), "abc123");
    }

    #[test]
    fn url_verification_without_challenge() {
        let json = r#"{"type":"event_callback"}"#;
        let v: SlackUrlVerification = serde_json::from_str(json).unwrap();
        assert_eq!(v.r#type, "event_callback");
        assert!(v.challenge.is_none());
    }

    #[test]
    fn slack_event_wrapper_deserializes() {
        let json = r#"{
            "api_app_id": "A12345",
            "event": {
                "type": "app_mention",
                "channel": "C123456",
                "text": "<@U123> hello",
                "user": "U456",
                "ts": "1234567890.123456"
            }
        }"#;
        let w: SlackEventWrapper = serde_json::from_str(json).unwrap();
        assert_eq!(w.api_app_id, "A12345");
        assert_eq!(w.event.r#type, "app_mention");
        assert_eq!(w.event.channel, "C123456");
        assert_eq!(w.event.text, "<@U123> hello");
        assert_eq!(w.event.user, "U456");
        assert_eq!(w.event.ts, "1234567890.123456");
        assert!(w.event.thread_ts.is_none());
    }

    #[test]
    fn slack_event_with_thread_ts() {
        let json = r#"{
            "api_app_id": "A12345",
            "event": {
                "type": "app_mention",
                "channel": "C123456",
                "text": "reply",
                "user": "U456",
                "ts": "1234567890.999999",
                "thread_ts": "1234567890.123456"
            }
        }"#;
        let w: SlackEventWrapper = serde_json::from_str(json).unwrap();
        assert_eq!(w.api_app_id, "A12345");
        assert_eq!(w.event.thread_ts.unwrap(), "1234567890.123456");
    }

    // ── parse_agent_id ───────────────────────────────────────────────

    #[test]
    fn parse_agent_id_extracts_at_token() {
        assert_eq!(
            parse_agent_id("<@U123> @research-agent do something"),
            Some("research-agent")
        );
    }

    #[test]
    fn parse_agent_id_returns_none_when_no_at() {
        assert_eq!(parse_agent_id("<@U123> hello world"), None);
    }

    #[test]
    fn parse_agent_id_ignores_bare_at() {
        assert_eq!(parse_agent_id("<@U123> @ something"), None);
    }

    #[test]
    fn parse_agent_id_takes_first_match() {
        assert_eq!(parse_agent_id("<@U123> @first @second"), Some("first"));
    }

    #[test]
    fn parse_agent_id_skips_slack_user_mentions() {
        // <@U123> is a Slack user mention, not an agent ID
        assert_eq!(
            parse_agent_id("<@U123> <@U456> @my-agent hello"),
            Some("my-agent")
        );
    }
}
