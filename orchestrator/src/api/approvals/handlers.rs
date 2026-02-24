use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Html,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;

#[derive(Serialize)]
pub struct ApprovalResponse {
    pub execution_id: String,
    pub step_key: String,
    pub status: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct SubmitApprovalRequest {
    pub data: serde_json::Value,
}

/// Get approval data for a suspended execution step.
/// The execution_id in the URL is the root execution ID.
pub async fn get_approval(
    State(state): State<Arc<AppState>>,
    Path((execution_id, step_key)): Path<(String, String)>,
) -> Result<Json<ApprovalResponse>, StatusCode> {
    let execution_id_uuid = Uuid::parse_str(&execution_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Get project_id from execution and set RLS
    let project_id = state
        .db
        .get_project_id_from_execution(&execution_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get project_id from execution: {}", e);
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

    let execution = state
        .db
        .get_execution(&execution_id_uuid)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // If not waiting, return status without data so UI can show "already handled"
    if execution.status != "waiting" {
        return Ok(Json(ApprovalResponse {
            execution_id,
            step_key,
            status: execution.status,
            data: None,
        }));
    }

    // Construct event topic and look up the specific suspend event
    let topic = format!("workflow/{}/{}", execution.workflow_id, execution_id_uuid);
    let suspend_event_type = format!("suspend_{}", step_key);

    let suspend_event = state
        .db
        .get_event_by_type(&topic, &suspend_event_type, &project_id)
        .await
        .map_err(|e| {
            tracing::error!(
                "Failed to get suspend event for topic={}, event_type={}: {}",
                topic,
                suspend_event_type,
                e
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(ApprovalResponse {
        execution_id,
        step_key,
        status: execution.status,
        data: suspend_event.map(|e| e.data),
    }))
}

/// Submit approval response for a suspended execution step (unauthenticated).
/// The execution_id in the URL is the root execution ID.
pub async fn submit_approval(
    State(state): State<Arc<AppState>>,
    Path((execution_id, step_key)): Path<(String, String)>,
    Json(req): Json<SubmitApprovalRequest>,
) -> Result<StatusCode, StatusCode> {
    let execution_id_uuid = Uuid::parse_str(&execution_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Get project_id from execution and set RLS
    let project_id = state
        .db
        .get_project_id_from_execution(&execution_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get project_id from execution: {}", e);
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

    // Verify execution is still waiting
    let execution = state
        .db
        .get_execution(&execution_id_uuid)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    if execution.status != "waiting" {
        return Err(StatusCode::CONFLICT);
    }

    // Publish resume event
    let topic = format!("workflow/{}/{}", execution.workflow_id, execution_id_uuid);
    let event_type = format!("resume_{}", step_key);
    let events: Vec<(Option<String>, serde_json::Value, Option<Uuid>, i32)> =
        vec![(Some(event_type), req.data.clone(), None, 0)];

    state
        .db
        .publish_events_batch(topic.clone(), events, None, None, &project_id)
        .await
        .map_err(|e| {
            tracing::error!(
                "Failed to publish resume event for execution {}: {}",
                execution_id_uuid,
                e
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Update Slack notification message if one was posted.
    // The SDK publishes a `notification_meta_{step_key}` event with Slack message metadata.
    let approved = req
        .data
        .get("approved")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    tokio::spawn(update_slack_notification(
        state.clone(),
        topic,
        step_key,
        project_id,
        approved,
    ));

    Ok(StatusCode::OK)
}

/// Look up Slack notification metadata and update the original Slack message
/// to replace action buttons with a status line.
async fn update_slack_notification(
    state: Arc<AppState>,
    topic: String,
    step_key: String,
    project_id: Uuid,
    approved: bool,
) {
    let meta_event_type = format!("notification_meta_{}", step_key);
    let meta_event = match state
        .db
        .get_event_by_type(&topic, &meta_event_type, &project_id)
        .await
    {
        Ok(Some(evt)) => evt,
        _ => return, // No notification metadata — nothing to update
    };

    // Find Slack channel entry in the metadata
    let channels = match meta_event.data.get("channels").and_then(|c| c.as_array()) {
        Some(c) => c,
        None => return,
    };

    let slack_entry = channels
        .iter()
        .find(|c| c.get("channelId").and_then(|id| id.as_str()) == Some("slack"));
    let slack_entry = match slack_entry {
        Some(e) => e,
        None => return,
    };

    let slack_channel = match slack_entry.get("slack_channel").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return,
    };
    let message_ts = match slack_entry.get("slack_message_ts").and_then(|v| v.as_str()) {
        Some(ts) => ts,
        None => return,
    };
    let original_blocks = slack_entry
        .get("slack_blocks")
        .and_then(|b| b.as_array())
        .cloned()
        .unwrap_or_default();

    let bot_token = match std::env::var("SLACK_BOT_TOKEN") {
        Ok(t) => t,
        Err(_) => {
            tracing::warn!("SLACK_BOT_TOKEN not set — cannot update Slack notification");
            return;
        }
    };

    // Build replacement blocks: keep original blocks but strip actions, append status
    let action_text = if approved { "Approved" } else { "Rejected" };
    let emoji = if approved {
        "\u{2705}" // check mark
    } else {
        "\u{274C}" // X mark
    };
    let status_text = format!("{} {} via approval page", emoji, action_text);

    let mut replacement_blocks: Vec<serde_json::Value> = original_blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) != Some("actions"))
        .cloned()
        .collect();
    replacement_blocks.push(serde_json::json!({
        "type": "context",
        "elements": [{ "type": "mrkdwn", "text": status_text }]
    }));

    let body = serde_json::json!({
        "channel": slack_channel,
        "ts": message_ts,
        "text": status_text,
        "blocks": replacement_blocks,
    });

    let client = reqwest::Client::new();
    match client
        .post("https://slack.com/api/chat.update")
        .header("Authorization", format!("Bearer {}", bot_token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            if !resp.status().is_success() {
                tracing::warn!(
                    "Slack chat.update returned status {}: {:?}",
                    resp.status(),
                    resp.text().await.ok()
                );
            }
        }
        Err(e) => {
            tracing::error!("Failed to call Slack chat.update: {}", e);
        }
    }
}

/// Serve a self-contained HTML approval page.
/// This is the URL embedded in Slack "View Details" buttons.
pub async fn approval_page(
    State(state): State<Arc<AppState>>,
    Path((execution_id, step_key)): Path<(String, String)>,
) -> Result<Html<String>, StatusCode> {
    let execution_id_uuid = Uuid::parse_str(&execution_id).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Look up execution to verify it exists
    let project_id = state
        .db
        .get_project_id_from_execution(&execution_id_uuid)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get project_id from execution: {}", e);
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

    let execution = state
        .db
        .get_execution(&execution_id_uuid)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // Get suspend event data if waiting
    let suspend_data = if execution.status == "waiting" {
        let topic = format!("workflow/{}/{}", execution.workflow_id, execution_id_uuid);
        let suspend_event_type = format!("suspend_{}", step_key);
        state
            .db
            .get_event_by_type(&topic, &suspend_event_type, &project_id)
            .await
            .ok()
            .flatten()
            .map(|e| e.data)
    } else {
        None
    };

    // Extract display fields from suspend event data
    let title = suspend_data
        .as_ref()
        .and_then(|d| d.get("_form"))
        .and_then(|f| f.get("title"))
        .and_then(|t| t.as_str())
        .unwrap_or("Agent needs your input");

    let description = suspend_data
        .as_ref()
        .and_then(|d| {
            d.get("_notify")
                .and_then(|n| n.get("message"))
                .and_then(|m| m.as_str())
                .or_else(|| {
                    d.get("_form")
                        .and_then(|f| f.get("description"))
                        .and_then(|d| d.as_str())
                })
        })
        .unwrap_or("");

    let tool_name = suspend_data
        .as_ref()
        .and_then(|d| d.get("_tool"))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    let source = suspend_data
        .as_ref()
        .and_then(|d| d.get("_source"))
        .and_then(|s| s.as_str())
        .unwrap_or("");

    // Extract context (tool arguments)
    let context_json = suspend_data
        .as_ref()
        .and_then(|d| d.get("_form"))
        .and_then(|f| f.get("context"))
        .map(|c| serde_json::to_string_pretty(c).unwrap_or_default())
        .unwrap_or_default();

    // Check if it's a simple boolean approval
    let is_simple_approval = suspend_data
        .as_ref()
        .and_then(|d| d.get("_form"))
        .and_then(|f| f.get("fields"))
        .and_then(|f| f.as_array())
        .map(|fields| {
            fields
                .iter()
                .any(|f| f.get("key").and_then(|k| k.as_str()) == Some("approved"))
        })
        .unwrap_or(false);

    let status = &execution.status;

    let html = format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;padding:2rem;color:#333}}
.card{{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden}}
.header{{background:#1a1a2e;color:#fff;padding:1.5rem 2rem}}
.header h1{{font-size:1.25rem;font-weight:600}}
.body{{padding:2rem}}
.meta{{display:flex;gap:1rem;margin-bottom:1rem;font-size:.875rem;color:#666}}
.meta span{{background:#f0f0f0;padding:.25rem .75rem;border-radius:4px}}
.desc{{margin-bottom:1.5rem;line-height:1.6}}
.context{{background:#f8f9fa;border:1px solid #e9ecef;border-radius:8px;padding:1rem;margin-bottom:1.5rem;font-family:monospace;font-size:.8rem;white-space:pre-wrap;overflow-x:auto;max-height:400px}}
.actions{{display:flex;gap:.75rem}}
.btn{{padding:.625rem 1.5rem;border:none;border-radius:6px;font-size:.9rem;font-weight:500;cursor:pointer;transition:opacity .15s}}
.btn:disabled{{opacity:.5;cursor:not-allowed}}
.btn-approve{{background:#22c55e;color:#fff}}.btn-approve:hover:not(:disabled){{background:#16a34a}}
.btn-reject{{background:#ef4444;color:#fff}}.btn-reject:hover:not(:disabled){{background:#dc2626}}
.status{{padding:1rem 2rem;text-align:center;font-weight:500}}
.status.waiting{{background:#fef9c3;color:#854d0e}}
.status.completed{{background:#dcfce7;color:#166534}}
.status.handled{{background:#e0e7ff;color:#3730a3}}
#result{{margin-top:1rem;padding:1rem;border-radius:8px;display:none}}
#result.success{{display:block;background:#dcfce7;color:#166534}}
#result.error{{display:block;background:#fee2e2;color:#991b1b}}
</style>
</head>
<body>
<div class="card">
  <div class="header"><h1>{title}</h1></div>
  <div class="body">
    {meta_html}
    {desc_html}
    {context_html}
    {action_html}
    <div id="result"></div>
  </div>
  <div class="status {status_class}">{status_text}</div>
</div>
<script>
const API = window.location.origin;
const EXEC = "{execution_id}";
const STEP = "{step_key}";
async function submitApproval(approved) {{
  const btns = document.querySelectorAll('.btn');
  btns.forEach(b => b.disabled = true);
  const res = document.getElementById('result');
  try {{
    const r = await fetch(API + '/api/v1/approvals/' + EXEC + '/' + STEP + '/submit', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ data: {{ approved }} }}),
    }});
    if (r.ok) {{
      res.className = 'success';
      res.textContent = approved ? '\u2705 Approved successfully' : '\u274c Rejected';
      res.style.display = 'block';
    }} else if (r.status === 409) {{
      res.className = 'error';
      res.textContent = 'This request has already been handled.';
      res.style.display = 'block';
    }} else {{
      throw new Error('HTTP ' + r.status);
    }}
  }} catch (e) {{
    res.className = 'error';
    res.textContent = 'Error: ' + e.message;
    res.style.display = 'block';
    btns.forEach(b => b.disabled = false);
  }}
}}
</script>
</body>
</html>"##,
        title = html_escape(title),
        execution_id = execution_id,
        step_key = step_key,
        meta_html = if !tool_name.is_empty() || !source.is_empty() {
            let mut parts = Vec::new();
            if !source.is_empty() {
                parts.push(format!("<span>Source: {}</span>", html_escape(source)));
            }
            if !tool_name.is_empty() {
                parts.push(format!(
                    "<span>Tool: <code>{}</code></span>",
                    html_escape(tool_name)
                ));
            }
            format!(r#"<div class="meta">{}</div>"#, parts.join(""))
        } else {
            String::new()
        },
        desc_html = if !description.is_empty() {
            format!(r#"<p class="desc">{}</p>"#, html_escape(description))
        } else {
            String::new()
        },
        context_html = if !context_json.is_empty() {
            format!(
                r#"<div class="context">{}</div>"#,
                html_escape(&context_json)
            )
        } else {
            String::new()
        },
        action_html = if status == "waiting" && is_simple_approval {
            r#"<div class="actions"><button class="btn btn-approve" onclick="submitApproval(true)">Approve</button><button class="btn btn-reject" onclick="submitApproval(false)">Reject</button></div>"#.to_string()
        } else if status == "waiting" {
            format!(
                r#"<p>This approval requires a custom response. Submit via the API:</p>
<code>POST /api/v1/approvals/{}/{}/submit</code>"#,
                execution_id, step_key
            )
        } else {
            String::new()
        },
        status_class = match status.as_str() {
            "waiting" => "waiting",
            "completed" => "completed",
            _ => "handled",
        },
        status_text = match status.as_str() {
            "waiting" => "Waiting for approval",
            "completed" => "Completed",
            "running" => "Running",
            "failed" => "Failed",
            s => s,
        },
    );

    Ok(Html(html))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
