use anyhow::Result;
use colored::Colorize;
use std::io::{self, Write};

use crate::client::OrchestratorClient;

/// Parsed suspend event extracted from SSE stream
pub struct SuspendEvent {
    pub execution_id: String,
    pub step_key: String,
    pub data: serde_json::Value,
}

/// Result of handling a suspend
#[allow(dead_code)]
pub enum SuspendResult {
    Submitted,
    Skipped,
}

/// Handle an inline suspend by prompting the user in the terminal.
///
/// Detects the suspend type from the event data and renders an appropriate
/// prompt. Supports:
/// - Form-based suspends (`_form` field with structured fields)
/// - Simple approval (boolean approved/rejected)
/// - Free-text input (ask_user)
/// - Raw data display for unknown formats
pub async fn handle_suspend(
    orch: &OrchestratorClient,
    event: &SuspendEvent,
) -> Result<SuspendResult> {
    let mut stdout = io::stdout();

    writeln!(stdout)?;
    writeln!(stdout, "{}", "━".repeat(50).dimmed())?;

    let data = &event.data;

    // Detect source type for specialized handling
    let source = data.get("_source").and_then(|s| s.as_str()).unwrap_or("");

    match source {
        "ask_user" => handle_ask_user(orch, event).await,
        "tool_approval" | "path_approval" | "exec_security" => {
            handle_tool_approval(orch, event).await
        }
        _ if data.get("_form").is_some() => {
            handle_form_suspend(orch, event, data.get("_form").unwrap()).await
        }
        _ => handle_generic_suspend(orch, event).await,
    }
}

/// Handle tool/exec/path approval — simplified prompt without allowlist or unnecessary fields
async fn handle_tool_approval(
    orch: &OrchestratorClient,
    event: &SuspendEvent,
) -> Result<SuspendResult> {
    let mut stdout = io::stdout();

    let tool = event
        .data
        .get("_tool")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");

    // Show title from form, or build one
    let title = event
        .data
        .get("_form")
        .and_then(|f| f.get("title"))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    if !title.is_empty() {
        writeln!(stdout, "{}", title.bold())?;
    } else {
        writeln!(stdout, "{}", format!("Approve tool: {}", tool).bold())?;
    }

    // Show description
    if let Some(desc) = event
        .data
        .get("_form")
        .and_then(|f| f.get("description"))
        .and_then(|d| d.as_str())
    {
        writeln!(stdout, "{}", desc.dimmed())?;
    }

    // Show context (tool name, command, path, etc.) — summarized
    if let Some(context) = event
        .data
        .get("_form")
        .and_then(|f| f.get("context"))
        .and_then(|c| c.as_object())
    {
        for (key, val) in context {
            let val_str = if let Some(s) = val.as_str() {
                truncate_str(s, 200)
            } else {
                truncate_str(&val.to_string(), 200)
            };
            writeln!(stdout, "  {}: {}", key.dimmed(), val_str)?;
        }
    }

    writeln!(stdout)?;

    let approved = prompt_confirm("Approve?")?;

    let mut response = serde_json::Map::new();
    response.insert("approved".to_string(), serde_json::Value::Bool(approved));

    // Only ask for feedback if rejected
    if !approved {
        let feedback = prompt_text_optional("Feedback for the agent (optional)")?;
        if let Some(fb) = feedback {
            response.insert("feedback".to_string(), serde_json::Value::String(fb));
        }
    }

    writeln!(stdout, "{}", "━".repeat(50).dimmed())?;

    orch.submit_approval(
        &event.execution_id,
        &event.step_key,
        serde_json::Value::Object(response),
    )
    .await?;

    let msg = if approved { "Approved." } else { "Denied." };
    writeln!(stdout, "{}", msg.green())?;
    Ok(SuspendResult::Submitted)
}

/// Handle a form-based suspend with structured fields
async fn handle_form_suspend(
    orch: &OrchestratorClient,
    event: &SuspendEvent,
    form: &serde_json::Value,
) -> Result<SuspendResult> {
    let mut stdout = io::stdout();

    // Display form title and description
    if let Some(title) = form.get("title").and_then(|t| t.as_str()) {
        writeln!(stdout, "{}", title.bold())?;
    } else {
        writeln!(stdout, "{}", "Approval Required".bold())?;
    }
    if let Some(desc) = form.get("description").and_then(|d| d.as_str()) {
        writeln!(stdout, "{}", desc.dimmed())?;
    }

    // Display context if present
    if let Some(context) = form.get("context") {
        if let Some(obj) = context.as_object() {
            for (key, val) in obj {
                let val_str = if let Some(s) = val.as_str() {
                    s.to_string()
                } else {
                    val.to_string()
                };
                writeln!(stdout, "  {}: {}", key.dimmed(), val_str)?;
            }
        }
    }

    writeln!(stdout)?;

    // Collect field responses
    let fields = form
        .get("fields")
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();

    let mut response = serde_json::Map::new();

    for field in &fields {
        let key = field
            .get("key")
            .or_else(|| field.get("name"))
            .and_then(|k| k.as_str())
            .unwrap_or("value");
        let field_type = field.get("type").and_then(|t| t.as_str()).unwrap_or("text");
        let label = field.get("label").and_then(|l| l.as_str()).unwrap_or(key);
        let required = field
            .get("required")
            .and_then(|r| r.as_bool())
            .unwrap_or(false);
        let description = field.get("description").and_then(|d| d.as_str());

        let value = prompt_field(label, field_type, required, description, field)?;
        response.insert(key.to_string(), value);
    }

    // If no fields, treat as simple confirmation
    if fields.is_empty() {
        let confirmed = prompt_confirm("Approve?")?;
        response.insert("approved".to_string(), serde_json::Value::Bool(confirmed));
    }

    writeln!(stdout, "{}", "━".repeat(50).dimmed())?;
    stdout.flush()?;

    // Submit
    orch.submit_approval(
        &event.execution_id,
        &event.step_key,
        serde_json::Value::Object(response),
    )
    .await?;

    writeln!(stdout, "{}", "Response submitted.".green())?;
    Ok(SuspendResult::Submitted)
}

/// Handle ask_user suspend — simple question + text response
async fn handle_ask_user(orch: &OrchestratorClient, event: &SuspendEvent) -> Result<SuspendResult> {
    // ask_user events typically have _form, but fall through here if not
    let mut stdout = io::stdout();

    writeln!(stdout, "{}", "Agent is asking for input:".bold())?;

    // Try to extract the question/message
    if let Some(form) = event.data.get("_form") {
        if let Some(title) = form.get("title").and_then(|t| t.as_str()) {
            writeln!(stdout, "{}", title)?;
        }
        if let Some(desc) = form.get("description").and_then(|d| d.as_str()) {
            writeln!(stdout, "{}", desc)?;
        }
    }

    writeln!(stdout)?;

    let answer = prompt_text("Your response")?;
    writeln!(stdout, "{}", "━".repeat(50).dimmed())?;

    orch.submit_approval(
        &event.execution_id,
        &event.step_key,
        serde_json::json!({ "response": answer }),
    )
    .await?;

    writeln!(stdout, "{}", "Response submitted.".green())?;
    Ok(SuspendResult::Submitted)
}

/// Handle unknown/generic suspend — show raw data and ask for JSON or simple input
async fn handle_generic_suspend(
    orch: &OrchestratorClient,
    event: &SuspendEvent,
) -> Result<SuspendResult> {
    let mut stdout = io::stdout();

    writeln!(
        stdout,
        "{}",
        "Execution suspended — approval required".bold()
    )?;
    writeln!(stdout, "  Step: {}", event.step_key)?;

    // Show data (excluding internal fields), truncated
    let display_data = filter_internal_fields(&event.data);
    if !display_data.is_null() {
        let data_str = serde_json::to_string_pretty(&display_data)?;
        let truncated = truncate_str(&data_str, 200);
        writeln!(stdout, "  Data: {}", truncated.dimmed())?;
    }

    writeln!(stdout)?;

    let approved = prompt_confirm("Approve and resume?")?;

    let response = serde_json::json!({ "approved": approved });

    writeln!(stdout, "{}", "━".repeat(50).dimmed())?;

    orch.submit_approval(&event.execution_id, &event.step_key, response)
        .await?;

    let msg = if approved {
        "Approved and resumed."
    } else {
        "Denied."
    };
    writeln!(stdout, "{}", msg.green())?;
    Ok(SuspendResult::Submitted)
}

// --- Helpers ---

/// Truncate a string to at most `max_len` bytes, ensuring the cut falls on a
/// UTF-8 char boundary so we never panic on multi-byte characters.
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }
    // Walk backwards from max_len to find a char boundary
    let mut end = max_len;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
}

// --- Terminal prompt helpers ---

fn prompt_field(
    label: &str,
    field_type: &str,
    required: bool,
    description: Option<&str>,
    field_def: &serde_json::Value,
) -> Result<serde_json::Value> {
    match field_type {
        "boolean" => {
            let val = prompt_confirm(label)?;
            Ok(serde_json::Value::Bool(val))
        }
        "number" => {
            let hint = if required { " (required)" } else { "" };
            loop {
                let input = prompt_text(&format!("{}{}", label, hint))?;
                if input.is_empty() && !required {
                    return Ok(serde_json::Value::Null);
                }
                if let Ok(n) = input.parse::<f64>() {
                    return Ok(serde_json::json!(n));
                }
                eprintln!("{}", "Please enter a valid number.".yellow());
            }
        }
        "select" => {
            let options = field_def
                .get("options")
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();

            if options.is_empty() {
                return prompt_text(label).map(serde_json::Value::String);
            }

            let mut stdout = io::stdout();
            writeln!(stdout, "{}:", label.bold())?;
            if let Some(desc) = description {
                writeln!(stdout, "  {}", desc.dimmed())?;
            }
            for (i, opt) in options.iter().enumerate() {
                let opt_label = opt.get("label").and_then(|l| l.as_str()).unwrap_or("?");
                let opt_value = opt
                    .get("value")
                    .and_then(|v| v.as_str())
                    .unwrap_or(opt_label);
                writeln!(stdout, "  {}) {} [{}]", i + 1, opt_label, opt_value)?;
            }
            stdout.flush()?;

            loop {
                let input = prompt_text("Selection (number)")?;
                if let Ok(n) = input.parse::<usize>() {
                    if n >= 1 && n <= options.len() {
                        let value = options[n - 1]
                            .get("value")
                            .cloned()
                            .unwrap_or(serde_json::Value::String(input));
                        return Ok(value);
                    }
                }
                eprintln!(
                    "{}",
                    format!("Please enter a number between 1 and {}.", options.len()).yellow()
                );
            }
        }
        _ => {
            let hint = if required { " (required)" } else { "" };
            let prompt_label = if let Some(desc) = description {
                format!("{} ({}){}", label, desc, hint)
            } else {
                format!("{}{}", label, hint)
            };

            loop {
                let input = prompt_text(&prompt_label)?;
                if !input.is_empty() || !required {
                    return Ok(if input.is_empty() {
                        serde_json::Value::Null
                    } else {
                        serde_json::Value::String(input)
                    });
                }
                eprintln!("{}", "This field is required.".yellow());
            }
        }
    }
}

fn prompt_confirm(label: &str) -> Result<bool> {
    let mut stdout = io::stdout();
    loop {
        write!(stdout, "{} [y/n]: ", label.bold())?;
        stdout.flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        let input = input.trim().to_lowercase();

        match input.as_str() {
            "y" | "yes" => return Ok(true),
            "n" | "no" => return Ok(false),
            _ => {
                eprintln!("{}", "Please answer y or n.".yellow());
            }
        }
    }
}

fn prompt_text(label: &str) -> Result<String> {
    let mut stdout = io::stdout();
    write!(stdout, "{}: ", label.bold())?;
    stdout.flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

fn prompt_text_optional(label: &str) -> Result<Option<String>> {
    let text = prompt_text(label)?;
    if text.is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

/// Remove internal fields (prefixed with _) for display purposes
fn filter_internal_fields(data: &serde_json::Value) -> serde_json::Value {
    match data {
        serde_json::Value::Object(map) => {
            let filtered: serde_json::Map<String, serde_json::Value> = map
                .iter()
                .filter(|(k, _)| !k.starts_with('_'))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            if filtered.is_empty() {
                serde_json::Value::Null
            } else {
                serde_json::Value::Object(filtered)
            }
        }
        other => other.clone(),
    }
}

/// Try to extract a SuspendEvent from an SSE event type and data.
/// Returns Some if the event is a suspend event, None otherwise.
pub fn parse_suspend_event(
    event_type: &str,
    data: &str,
    execution_id: &str,
) -> Option<SuspendEvent> {
    let step_key = event_type.strip_prefix("suspend_")?;

    let data_json: serde_json::Value = serde_json::from_str(data).ok()?;

    Some(SuspendEvent {
        execution_id: execution_id.to_string(),
        step_key: step_key.to_string(),
        data: data_json,
    })
}
