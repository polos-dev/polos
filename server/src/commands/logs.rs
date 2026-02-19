use anyhow::Result;
use colored::Colorize;
use futures::StreamExt;

use crate::client;

/// Tail logs for a specific execution by execution ID
pub async fn execution_logs(execution_id: &str, last: Option<i32>) -> Result<()> {
    let orch = client::create_client()?;

    // Look up execution to get workflow_id
    let execution = orch.get_execution(execution_id).await?;
    let workflow_id = execution.workflow_id.as_deref().unwrap_or(execution_id);

    let topic = format!("workflow/{}/{}", workflow_id, execution_id);

    if let Some(n) = last {
        // Non-streaming: fetch last N events (newest first, then reverse for display)
        let resp = orch
            .get_events(&[
                ("topic", topic.as_str()),
                ("limit", &n.to_string()),
                ("sort", "desc"),
            ])
            .await?;

        for event in resp.events.iter().rev() {
            print_event(event);
        }
    } else {
        // Streaming: SSE
        println!(
            "{}",
            format!("Streaming events for execution {}...", execution_id).dimmed()
        );

        let stream = orch
            .stream_events(&[
                ("workflow_id", workflow_id),
                ("workflow_run_id", execution_id),
            ])
            .await?;

        stream_sse_events(stream, execution_id).await?;
    }

    Ok(())
}

/// Tail logs for the most recent execution of an agent
pub async fn agent_logs(agent_id: &str, last: Option<i32>) -> Result<()> {
    latest_logs("agent", agent_id, last).await
}

/// Tail logs for the most recent execution of a workflow
pub async fn workflow_logs(workflow_id: &str, last: Option<i32>) -> Result<()> {
    latest_logs("workflow", workflow_id, last).await
}

/// Tail logs for the most recent execution of a tool
pub async fn tool_logs(tool_id: &str, last: Option<i32>) -> Result<()> {
    latest_logs("tool", tool_id, last).await
}

/// Shared: find the latest execution for a given workflow type + ID and show its logs
async fn latest_logs(workflow_type: &str, id: &str, last: Option<i32>) -> Result<()> {
    let orch = client::create_client()?;

    let runs = orch
        .get_workflow_runs(&[
            ("workflow_id", id),
            ("workflow_type", workflow_type),
            ("limit", "1"),
        ])
        .await?;

    if runs.is_empty() {
        println!("No executions found for {} '{}'.", workflow_type, id);
        return Ok(());
    }

    let run = &runs[0];
    println!(
        "{}",
        format!(
            "Showing logs for latest execution: {} (status: {})",
            run.execution_id, run.status
        )
        .dimmed()
    );

    execution_logs(&run.execution_id, last).await
}

fn print_event(event: &client::EventData) {
    let timestamp = event
        .created_at
        .as_deref()
        .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "??:??:??".to_string());

    let event_type = event.event_type.as_deref().unwrap_or("unknown");

    let data_str = event
        .data
        .as_ref()
        .map(|d| {
            if let Some(s) = d.as_str() {
                s.to_string()
            } else {
                serde_json::to_string(d).unwrap_or_default()
            }
        })
        .unwrap_or_default();

    println!(
        "{} {} {}",
        format!("[{}]", timestamp).dimmed(),
        format!("[{}]", event_type).cyan(),
        data_str
    );
}

/// Stream SSE events and print them as log lines.
/// Parses the orchestrator's envelope format:
///   data: {"id":"...","sequence_id":...,"event_type":"text_delta","data":{...},"created_at":"..."}
/// Terminates when a finish event with matching execution_id is received.
async fn stream_sse_events(
    stream: impl futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>>,
    execution_id: &str,
) -> Result<()> {
    tokio::pin!(stream);

    let mut buffer = String::new();
    let mut current_data: Option<String> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        let lines: Vec<String> = buffer.split('\n').map(|s| s.to_string()).collect();
        buffer = lines.last().cloned().unwrap_or_default();

        for raw_line in &lines[..lines.len().saturating_sub(1)] {
            let line = raw_line.trim_end_matches('\r');

            if line.is_empty() {
                if let Some(ref data_str) = current_data {
                    if data_str == "keepalive" {
                        current_data = None;
                        continue;
                    }

                    if let Ok(envelope) = serde_json::from_str::<serde_json::Value>(data_str) {
                        let event_type = envelope
                            .get("event_type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let created_at = envelope
                            .get("created_at")
                            .and_then(|v| v.as_str())
                            .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
                            .map(|dt| dt.format("%H:%M:%S").to_string())
                            .unwrap_or_else(|| chrono::Local::now().format("%H:%M:%S").to_string());
                        let inner_data = envelope
                            .get("data")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);

                        let data_str = if let Some(s) = inner_data.as_str() {
                            s.to_string()
                        } else {
                            serde_json::to_string(&inner_data).unwrap_or_default()
                        };

                        println!(
                            "{} {} {}",
                            format!("[{}]", created_at).dimmed(),
                            format!("[{}]", event_type).cyan(),
                            data_str
                        );

                        // Terminate on finish event with matching execution_id
                        if matches!(
                            event_type,
                            "workflow_finish" | "agent_finish" | "tool_finish"
                        ) {
                            if let Some(metadata) = inner_data.get("_metadata") {
                                if metadata.get("execution_id").and_then(|v| v.as_str())
                                    == Some(execution_id)
                                {
                                    return Ok(());
                                }
                            }
                        }
                    }

                    current_data = None;
                }
                continue;
            }

            if let Some(value) = line.strip_prefix("data:") {
                current_data = Some(value.trim().to_string());
            }
        }
    }

    Ok(())
}
