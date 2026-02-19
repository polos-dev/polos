use anyhow::{Context, Result};
use colored::Colorize;
use futures::StreamExt;
use std::io::Write;

use crate::client::{self, OrchestratorClient, SubmitWorkflowRequest};
use crate::commands::suspend;

pub async fn run(agent_id: &str, input: Option<String>, file: Option<String>) -> Result<()> {
    let prompt = resolve_input(input, file)?;

    match prompt {
        Some(text) => one_shot(agent_id, &text).await,
        None => repl(agent_id).await,
    }
}

/// One-shot mode: submit, stream, exit
async fn one_shot(agent_id: &str, input: &str) -> Result<()> {
    let orch = client::create_client()?;

    let request = SubmitWorkflowRequest {
        payload: serde_json::json!({
            "input": input,
            "streaming": true,
        }),
        session_id: None,
        deployment_id: None,
    };

    let response = orch.submit_workflow(agent_id, &request).await?;

    stream_execution(&orch, agent_id, &response.execution_id).await?;
    println!();

    Ok(())
}

/// REPL mode: interactive prompt loop
async fn repl(agent_id: &str) -> Result<()> {
    let orch = client::create_client()?;

    // Get agent info for banner
    let agent_info = orch.get_agent(agent_id).await;
    let model = agent_info
        .as_ref()
        .ok()
        .and_then(|a| a.model.clone())
        .unwrap_or_else(|| "unknown".to_string());

    println!("Connected to {} ({})\n", agent_id.bold(), model.dimmed());
    println!(
        "Send a message to start chatting. Type {} to exit.\n",
        "/exit".bold()
    );

    let mut session_id = uuid::Uuid::new_v4().to_string();

    let mut rl = rustyline::DefaultEditor::new()?;

    loop {
        let readline = rl.readline(&format!("{} ", "You:".bold().cyan()));

        match readline {
            Ok(line) => {
                let line = line.trim().to_string();

                if line.is_empty() {
                    continue;
                }

                let _ = rl.add_history_entry(&line);

                // Handle REPL commands
                match line.as_str() {
                    "/quit" | "/exit" => {
                        println!("Goodbye!");
                        return Ok(());
                    }
                    "/reset" => {
                        session_id = uuid::Uuid::new_v4().to_string();
                        println!("{}", "Session reset. Starting fresh conversation.".dimmed());
                        continue;
                    }
                    "/clear" => {
                        print!("\x1B[2J\x1B[1;1H");
                        std::io::stdout().flush()?;
                        continue;
                    }
                    "/status" => {
                        println!("Agent: {}", agent_id);
                        println!("Model: {}", model);
                        println!("Session: {}", session_id);
                        continue;
                    }
                    _ if line.starts_with('/') => {
                        println!(
                            "{}",
                            format!(
                                "Unknown command: {}. Available: /exit, /reset, /clear, /status",
                                line
                            )
                            .yellow()
                        );
                        continue;
                    }
                    _ => {}
                }

                // Submit and stream
                let request = SubmitWorkflowRequest {
                    payload: serde_json::json!({
                        "input": line,
                        "streaming": true,
                    }),
                    session_id: Some(session_id.clone()),
                    deployment_id: None,
                };

                match orch.submit_workflow(agent_id, &request).await {
                    Ok(response) => {
                        match stream_execution(&orch, agent_id, &response.execution_id).await {
                            Ok(_) => println!("\n"),
                            Err(e) => eprintln!("{}: {}", "Stream error".red(), e),
                        }
                    }
                    Err(e) => {
                        eprintln!("{}: {}", "Error".red(), e);
                    }
                }
            }
            Err(rustyline::error::ReadlineError::Interrupted) => {
                println!("Interrupted. Type /exit to exit.");
            }
            Err(rustyline::error::ReadlineError::Eof) => {
                println!("Goodbye!");
                return Ok(());
            }
            Err(e) => {
                eprintln!("{}: {}", "Readline error".red(), e);
                return Err(e.into());
            }
        }
    }
}

/// Stream execution events via SSE, handling suspends inline.
///
/// Connects to the orchestrator's SSE stream and processes the event envelope.
/// Terminates when a finish event (`workflow_finish`, `agent_finish`, `tool_finish`)
/// with `_metadata.execution_id` matching our execution ID is received — matching
/// the TypeScript SDK's `streamWorkflow()` behavior.
async fn stream_execution(
    orch: &OrchestratorClient,
    workflow_id: &str,
    execution_id: &str,
) -> Result<()> {
    let mut last_sequence_id: Option<i64> = None;

    loop {
        let mut params = vec![
            ("workflow_id", workflow_id.to_string()),
            ("workflow_run_id", execution_id.to_string()),
        ];
        if let Some(seq) = last_sequence_id {
            params.push(("last_sequence_id", seq.to_string()));
        }
        let params_ref: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();

        let stream = orch.stream_events(&params_ref).await?;

        let result = render_sse_stream(stream, execution_id).await?;

        match result {
            StreamResult::Finished => return Ok(()),
            StreamResult::Suspended { event, seq } => {
                last_sequence_id = Some(seq);
                suspend::handle_suspend(orch, &event).await?;
                // After approval, execution resumes — reconnect past the suspend event
                continue;
            }
            StreamResult::Disconnected { seq } => {
                if let Some(s) = seq {
                    last_sequence_id = Some(s);
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                continue;
            }
        }
    }
}

enum StreamResult {
    /// Received a finish event with matching execution_id
    Finished,
    /// Received a suspend event — needs approval before continuing
    Suspended {
        event: suspend::SuspendEvent,
        seq: i64,
    },
    /// Stream ended without a finish event (connection lost, etc.)
    Disconnected { seq: Option<i64> },
}

/// Process the SSE byte stream from the orchestrator.
///
/// The orchestrator sends events as:
///   data: {"id":"...","sequence_id":...,"event_type":"text_delta","data":{...},"created_at":"..."}
///
/// Keepalive messages are sent as:
///   data: keepalive
async fn render_sse_stream(
    stream: impl futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>>,
    execution_id: &str,
) -> Result<StreamResult> {
    tokio::pin!(stream);

    let mut buffer = String::new();
    let mut current_data: Option<String> = None;
    let mut stdout = std::io::stdout();
    let mut last_seq: Option<i64> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Process line by line (SSE protocol)
        let lines: Vec<String> = buffer.split('\n').map(|s| s.to_string()).collect();
        // Keep the last partial line in the buffer
        buffer = lines.last().cloned().unwrap_or_default();

        for raw_line in &lines[..lines.len().saturating_sub(1)] {
            let line = raw_line.trim_end_matches('\r');

            // Empty line = end of event
            if line.is_empty() {
                if let Some(ref data_str) = current_data {
                    // Skip keepalive
                    if data_str == "keepalive" {
                        current_data = None;
                        continue;
                    }

                    // Parse the envelope JSON
                    if let Ok(envelope) = serde_json::from_str::<serde_json::Value>(data_str) {
                        // Track sequence_id for reconnect
                        if let Some(seq) = envelope.get("sequence_id").and_then(|v| v.as_i64()) {
                            last_seq = Some(seq);
                        }

                        let event_type = envelope
                            .get("event_type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let inner_data = envelope
                            .get("data")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);

                        // Check for finish event with matching execution_id
                        if matches!(
                            event_type,
                            "workflow_finish" | "agent_finish" | "tool_finish"
                        ) {
                            if let Some(metadata) = inner_data.get("_metadata") {
                                if metadata.get("execution_id").and_then(|v| v.as_str())
                                    == Some(execution_id)
                                {
                                    stdout.flush()?;
                                    return Ok(StreamResult::Finished);
                                }
                            }
                        }

                        // Check for suspend events
                        if event_type.starts_with("suspend_") {
                            let inner_str = serde_json::to_string(&inner_data).unwrap_or_default();
                            if let Some(suspend_event) =
                                suspend::parse_suspend_event(event_type, &inner_str, execution_id)
                            {
                                stdout.flush()?;
                                return Ok(StreamResult::Suspended {
                                    event: suspend_event,
                                    seq: last_seq.unwrap_or(0),
                                });
                            }
                        }

                        render_event(event_type, &inner_data, &mut stdout)?;
                    }

                    current_data = None;
                }
                continue;
            }

            // Parse SSE data line
            if let Some(value) = line.strip_prefix("data:") {
                current_data = Some(value.trim().to_string());
            }
            // Skip event:, id:, retry:, and comment lines
        }
    }

    stdout.flush()?;
    Ok(StreamResult::Disconnected { seq: last_seq })
}

fn render_event(
    event_type: &str,
    data: &serde_json::Value,
    stdout: &mut std::io::Stdout,
) -> Result<()> {
    match event_type {
        "text_delta" => {
            // Try common shapes: {"content": "..."}, {"text": "..."}, or just a string
            let text = data
                .get("content")
                .and_then(|c| c.as_str())
                .or_else(|| data.get("text").and_then(|t| t.as_str()))
                .or_else(|| data.as_str());
            if let Some(text) = text {
                write!(stdout, "{}", text)?;
                stdout.flush()?;
            }
        }
        "tool_call" => {
            let tool_call = data.get("tool_call").unwrap_or(data);
            let func = tool_call.get("function");
            let name = func
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .or_else(|| data.get("name").and_then(|n| n.as_str()))
                .unwrap_or("unknown");
            let summary = summarize_tool_args(name, func.and_then(|f| f.get("arguments")));
            if summary.is_empty() {
                writeln!(stdout, "\n  {}", format!("[tool: {}]", name).dimmed())?;
            } else {
                writeln!(
                    stdout,
                    "\n  {}",
                    format!("[tool: {} {}]", name, summary).dimmed()
                )?;
            }
        }
        "tool_result" => {
            let result_str = data.get("result").or_else(|| data.get("output")).map(|r| {
                let s = if let Some(text) = r.as_str() {
                    text.to_string()
                } else {
                    serde_json::to_string(r).unwrap_or_default()
                };
                if s.len() > 100 {
                    format!("{}...", &s[..100])
                } else {
                    s
                }
            });
            if let Some(result) = result_str {
                writeln!(stdout, "  {}", result.dimmed())?;
            }
        }
        _ => {
            // Skip keepalives, pings, and other events
        }
    }

    Ok(())
}

/// Extract a short summary from tool arguments.
/// For file tools, show the path. For exec, show the command. Otherwise truncate.
fn summarize_tool_args(tool_name: &str, args: Option<&serde_json::Value>) -> String {
    let args = match args {
        Some(v) => v,
        None => return String::new(),
    };

    // If args is a string, try to parse it as JSON
    let parsed: serde_json::Value;
    let obj = if let Some(s) = args.as_str() {
        match serde_json::from_str(s) {
            Ok(v) => {
                parsed = v;
                &parsed
            }
            Err(_) => {
                let s = if s.len() > 60 {
                    format!("{}...", &s[..60])
                } else {
                    s.to_string()
                };
                return s;
            }
        }
    } else {
        args
    };

    // Pick the most relevant field based on tool name
    match tool_name {
        "write" | "read" | "edit" | "glob" | "grep" => {
            if let Some(path) = obj.get("path").and_then(|v| v.as_str()) {
                return path.to_string();
            }
            if let Some(pattern) = obj.get("pattern").and_then(|v| v.as_str()) {
                return pattern.to_string();
            }
        }
        "exec" => {
            if let Some(cmd) = obj.get("command").and_then(|v| v.as_str()) {
                let cmd = if cmd.len() > 80 {
                    format!("{}...", &cmd[..80])
                } else {
                    cmd.to_string()
                };
                return cmd;
            }
        }
        "web_search" => {
            if let Some(q) = obj.get("query").and_then(|v| v.as_str()) {
                return format!("\"{}\"", q);
            }
        }
        _ => {}
    }

    // Fallback: show truncated JSON
    let s = serde_json::to_string(obj).unwrap_or_default();
    if s.len() > 80 {
        format!("{}...", &s[..80])
    } else {
        s
    }
}

fn resolve_input(input: Option<String>, file: Option<String>) -> Result<Option<String>> {
    match (input, file) {
        (Some(text), _) => Ok(Some(text)),
        (None, Some(path)) => {
            let content = std::fs::read_to_string(&path)
                .with_context(|| format!("Failed to read file: {}", path))?;
            Ok(Some(content))
        }
        (None, None) => Ok(None), // REPL mode
    }
}
