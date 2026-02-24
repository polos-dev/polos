// Session-related database operations for the Sessions UI
use chrono::{DateTime, Utc};
use sqlx::QueryBuilder;
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;

impl Database {
    /// Get a list of agent sessions (root-level agent executions)
    #[allow(clippy::too_many_arguments)]
    pub async fn get_sessions_list(
        &self,
        project_id: &Uuid,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
        status: Option<&str>,
        agent_id: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<serde_json::Value>> {
        let mut query_builder = QueryBuilder::new(
            "SELECT
                e.id as execution_id,
                e.workflow_id as agent_id,
                e.session_id,
                e.status,
                e.created_at,
                e.payload,
                e.error,
                COALESCE((
                    SELECT SUM(
                        COALESCE((s.output->'usage'->>'total_tokens')::bigint, 0)
                    )::bigint
                    FROM spans s
                    WHERE s.trace_id = REPLACE(e.id::text, '-', '')
                      AND s.span_type = 'agent'
                      AND s.project_id = e.project_id
                ), 0)::bigint as total_tokens,
                (
                    SELECT COUNT(*)
                    FROM events ev
                    WHERE ev.topic = CONCAT('workflow/', e.workflow_id, '/', e.id::text)
                      AND ev.event_type = 'tool_call'
                      AND ev.project_id = e.project_id
                ) as tool_call_count,
                (
                    SELECT COUNT(*)
                    FROM events ev
                    WHERE ev.topic = CONCAT('workflow/', e.workflow_id, '/', e.id::text)
                      AND ev.event_type LIKE 'suspend_%'
                      AND ev.project_id = e.project_id
                ) as approval_count
            FROM workflow_executions e
            JOIN deployment_workflows dw ON dw.workflow_id = e.workflow_id
                AND dw.deployment_id = e.deployment_id
                AND dw.project_id = e.project_id
            WHERE e.parent_execution_id IS NULL
              AND dw.workflow_type = 'agent'
              AND e.project_id = ",
        );
        query_builder.push_bind(project_id);

        if let Some(start) = start_time {
            query_builder.push(" AND e.created_at >= ");
            query_builder.push_bind(start);
        }
        if let Some(end) = end_time {
            query_builder.push(" AND e.created_at <= ");
            query_builder.push_bind(end);
        }
        if let Some(s) = status {
            query_builder.push(" AND e.status = ");
            query_builder.push_bind(s);
        }
        if let Some(aid) = agent_id {
            query_builder.push(" AND e.workflow_id = ");
            query_builder.push_bind(aid);
        }

        query_builder.push(" ORDER BY e.created_at DESC LIMIT ");
        query_builder.push_bind(limit);
        query_builder.push(" OFFSET ");
        query_builder.push_bind(offset);

        let query = query_builder.build();
        let rows = query.fetch_all(&self.pool).await?;

        // Parse each row into a temporary struct for grouping
        struct ExecRow {
            execution_id: String,
            agent_id: String,
            session_id: Option<String>,
            status: String,
            created_at: DateTime<Utc>,
            payload: serde_json::Value,
            total_tokens: i64,
            tool_call_count: i64,
            approval_count: i64,
            error: Option<String>,
        }

        let exec_rows: Vec<ExecRow> = rows
            .into_iter()
            .map(|row| {
                let execution_id: Uuid = row.get("execution_id");
                ExecRow {
                    execution_id: execution_id.to_string(),
                    agent_id: row.get::<String, _>("agent_id"),
                    session_id: row.get::<Option<String>, _>("session_id"),
                    status: row.get::<String, _>("status"),
                    created_at: row.get("created_at"),
                    payload: row.get("payload"),
                    total_tokens: row.get::<i64, _>("total_tokens"),
                    tool_call_count: row.get::<i64, _>("tool_call_count"),
                    approval_count: row.get::<i64, _>("approval_count"),
                    error: row.get::<Option<String>, _>("error"),
                }
            })
            .collect();

        // Group executions by session_id (or treat each as its own group if no session_id)
        let mut group_order: Vec<String> = Vec::new();
        let mut groups: std::collections::HashMap<String, Vec<ExecRow>> =
            std::collections::HashMap::new();

        for exec in exec_rows {
            let group_key = exec
                .session_id
                .as_deref()
                .map(|s| s.to_string())
                .unwrap_or_else(|| exec.execution_id.clone());

            if !groups.contains_key(&group_key) {
                group_order.push(group_key.clone());
            }
            groups.entry(group_key).or_default().push(exec);
        }

        let mut sessions: Vec<serde_json::Value> = Vec::new();

        for key in &group_order {
            let execs = groups.remove(key).unwrap();

            // Sort by created_at ascending within group
            let mut execs = execs;
            execs.sort_by(|a, b| a.created_at.cmp(&b.created_at));

            let first = &execs[0];
            let last = &execs[execs.len() - 1];
            let execution_count = execs.len();

            let total_tokens: i64 = execs.iter().map(|e| e.total_tokens).sum();
            let total_tool_calls: i64 = execs.iter().map(|e| e.tool_call_count).sum();
            let total_approvals: i64 = execs.iter().map(|e| e.approval_count).sum();

            let user_message_preview = extract_message_preview(&first.payload, 200);

            sessions.push(serde_json::json!({
                "execution_id": last.execution_id,
                "agent_id": first.agent_id,
                "session_id": first.session_id,
                "status": last.status,
                "user_message_preview": user_message_preview,
                "created_at": first.created_at.to_rfc3339(),
                "total_tokens": total_tokens,
                "tool_call_count": total_tool_calls,
                "approval_count": total_approvals,
                "error": last.error,
                "execution_count": execution_count,
            }));
        }

        // Already sorted by created_at desc from SQL; group order preserves that
        // since the first execution in each group determines its position
        Ok(sessions)
    }

    /// Get detailed session data including timeline and approvals
    pub async fn get_session_detail(
        &self,
        execution_id: &Uuid,
        project_id: &Uuid,
    ) -> anyhow::Result<Option<serde_json::Value>> {
        // 1. Get the execution record
        let execution_row = sqlx::query(
            "SELECT id, workflow_id, status, payload, result, error,
                    created_at, started_at, completed_at, session_id
             FROM workflow_executions
             WHERE id = $1 AND project_id = $2",
        )
        .bind(execution_id)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;

        let execution_row = match execution_row {
            Some(row) => row,
            None => return Ok(None),
        };

        let workflow_id: String = execution_row.get("workflow_id");
        let status: String = execution_row.get("status");
        let payload: serde_json::Value = execution_row.get("payload");
        let result: Option<serde_json::Value> = execution_row.get("result");
        let error: Option<String> = execution_row.get("error");
        let created_at: DateTime<Utc> = execution_row.get("created_at");
        let started_at: Option<DateTime<Utc>> = execution_row.get("started_at");
        let completed_at: Option<DateTime<Utc>> = execution_row.get("completed_at");
        let session_id: Option<String> = execution_row.get("session_id");

        let duration_ms = if let (Some(start), Some(end)) = (started_at, completed_at) {
            Some((end - start).num_milliseconds())
        } else {
            None
        };

        let trace_id = execution_id.to_string().replace('-', "");

        // 2. Get agent executions in this session to build conversation messages.
        // Only agent-type workflows represent conversation turns (user -> assistant).
        // Tool/workflow executions (e.g. "write", "read") are sub-tasks, not turns.
        let session_execution_rows = if let Some(ref sid) = session_id {
            sqlx::query(
                "SELECT e.id, e.workflow_id, e.payload, e.result,
                        e.created_at, e.started_at, e.completed_at,
                        e.root_execution_id
                 FROM workflow_executions e
                 JOIN deployment_workflows dw ON dw.workflow_id = e.workflow_id
                   AND dw.deployment_id = e.deployment_id
                   AND dw.project_id = e.project_id
                 WHERE e.session_id = $1 AND e.project_id = $2
                   AND dw.workflow_type = 'agent'
                 ORDER BY e.created_at ASC",
            )
            .bind(sid)
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?
        } else {
            // No session_id — single execution
            sqlx::query(
                "SELECT e.id, e.workflow_id, e.payload, e.result,
                        e.created_at, e.started_at, e.completed_at,
                        e.root_execution_id
                 FROM workflow_executions e
                 JOIN deployment_workflows dw ON dw.workflow_id = e.workflow_id
                   AND dw.deployment_id = e.deployment_id
                   AND dw.project_id = e.project_id
                 WHERE e.id = $1 AND e.project_id = $2
                   AND dw.workflow_type = 'agent'
                 ORDER BY e.created_at ASC",
            )
            .bind(execution_id)
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?
        };

        // 3. Get events (tool calls, approvals) for all executions in the session
        let event_rows = if let Some(ref sid) = session_id {
            // Get events for all executions in this session
            sqlx::query(
                "SELECT ev.event_type, ev.data, ev.created_at
                 FROM events ev
                 JOIN workflow_executions we ON ev.topic = CONCAT('workflow/', we.workflow_id, '/', we.id::text)
                   AND we.project_id = ev.project_id
                 WHERE we.session_id = $1 AND we.project_id = $2
                 ORDER BY ev.created_at ASC",
            )
            .bind(sid)
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?
        } else {
            let topic = format!("workflow/{}/{}", workflow_id, execution_id);
            sqlx::query(
                "SELECT event_type, data, created_at
                 FROM events
                 WHERE topic = $1 AND project_id = $2
                 ORDER BY created_at ASC",
            )
            .bind(&topic)
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?
        };

        // 4. Get token usage from spans
        let token_row = sqlx::query(
            "SELECT
                COALESCE(SUM(COALESCE((output->'usage'->>'input_tokens')::bigint, 0)), 0)::bigint as total_input_tokens,
                COALESCE(SUM(COALESCE((output->'usage'->>'output_tokens')::bigint, 0)), 0)::bigint as total_output_tokens,
                COALESCE(SUM(COALESCE((output->'usage'->>'total_tokens')::bigint, 0)), 0)::bigint as total_tokens
             FROM spans
             WHERE trace_id = $1
               AND span_type IN ('agent', 'step')
               AND project_id = $2",
        )
        .bind(&trace_id)
        .bind(project_id)
        .fetch_one(&self.pool)
        .await?;

        let total_input_tokens: i64 = token_row.get("total_input_tokens");
        let total_output_tokens: i64 = token_row.get("total_output_tokens");
        let total_tokens: i64 = token_row.get("total_tokens");

        // 5. Build timeline from execution payload/result pairs.
        // Each execution represents one turn: user message -> tool calls -> assistant response.
        let mut timeline: Vec<serde_json::Value> = Vec::new();
        let mut tool_call_count: i64 = 0;

        for exec_row in &session_execution_rows {
            let exec_id: Uuid = exec_row.get("id");
            let exec_root_id: Option<Uuid> = exec_row.get("root_execution_id");
            let exec_payload: serde_json::Value = exec_row.get("payload");
            let exec_result: Option<serde_json::Value> = exec_row.get("result");
            let exec_created: DateTime<Utc> = exec_row.get("created_at");
            let exec_started: Option<DateTime<Utc>> = exec_row.get("started_at");
            let exec_completed: Option<DateTime<Utc>> = exec_row.get("completed_at");

            // Use root_execution_id if present, otherwise fall back to the execution's own id
            let entry_root_id = exec_root_id.unwrap_or(exec_id).to_string();

            // User message from payload
            let user_content = extract_user_input(&exec_payload);
            if let Some(content) = user_content {
                timeline.push(serde_json::json!({
                    "entry_type": "user_message",
                    "timestamp": exec_created.to_rfc3339(),
                    "data": {
                        "role": "user",
                        "content": content,
                        "root_execution_id": entry_root_id,
                    }
                }));
            }

            // Tool calls from result.tool_results
            if let Some(ref res) = exec_result {
                if let Some(tool_results) = res.get("tool_results").and_then(|v| v.as_array()) {
                    // Place tool calls between user message and assistant response
                    let base_ts = exec_started.unwrap_or(exec_created);
                    for (i, tr) in tool_results.iter().enumerate() {
                        tool_call_count += 1;
                        let tool_name = tr
                            .get("tool_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let tool_status = tr
                            .get("status")
                            .and_then(|v| v.as_str())
                            .unwrap_or("completed");
                        // Offset by index to preserve ordering
                        let ts = base_ts + chrono::Duration::milliseconds(i as i64);
                        timeline.push(serde_json::json!({
                            "entry_type": "tool_call",
                            "timestamp": ts.to_rfc3339(),
                            "data": {
                                "tool_name": tool_name,
                                "status": tool_status,
                                "result": tr.get("result"),
                                "root_execution_id": entry_root_id,
                            }
                        }));
                    }
                }
            }

            // Assistant response from result.result
            if let Some(ref res) = exec_result {
                let assistant_content = res
                    .get("result")
                    .cloned()
                    .or_else(|| res.get("content").cloned());
                if let Some(content) = assistant_content {
                    if !content.is_null() {
                        let ts = exec_completed.unwrap_or(exec_created);
                        timeline.push(serde_json::json!({
                            "entry_type": "assistant_message",
                            "timestamp": ts.to_rfc3339(),
                            "data": {
                                "role": "assistant",
                                "content": content,
                                "root_execution_id": entry_root_id,
                            }
                        }));
                    }
                }
            }
        }

        // Add approval events from the events table
        let mut approval_count: i64 = 0;

        for row in &event_rows {
            let event_type: String = row.get("event_type");
            let data: serde_json::Value = row.get("data");
            let ts: DateTime<Utc> = row.get("created_at");

            if event_type.starts_with("suspend_") {
                approval_count += 1;
                timeline.push(serde_json::json!({
                    "entry_type": "approval_request",
                    "timestamp": ts.to_rfc3339(),
                    "data": {
                        "event_type": event_type,
                        "payload": data,
                    }
                }));
            } else if event_type.starts_with("resume_") {
                timeline.push(serde_json::json!({
                    "entry_type": "approval_response",
                    "timestamp": ts.to_rfc3339(),
                    "data": {
                        "event_type": event_type,
                        "payload": data,
                    }
                }));
            }
        }

        // Sort timeline by timestamp
        timeline.sort_by(|a, b| {
            let a_ts = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            let b_ts = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            a_ts.cmp(b_ts)
        });

        // 6. Build approval audit trail
        let mut approvals: Vec<serde_json::Value> = Vec::new();
        let mut suspend_map: std::collections::HashMap<String, (DateTime<Utc>, serde_json::Value)> =
            std::collections::HashMap::new();

        for row in &event_rows {
            let event_type: String = row.get("event_type");
            let data: serde_json::Value = row.get("data");
            let ts: DateTime<Utc> = row.get("created_at");

            if let Some(step_key) = event_type.strip_prefix("suspend_") {
                suspend_map.insert(step_key.to_string(), (ts, data));
            } else if let Some(step_key) = event_type.strip_prefix("resume_") {
                let (requested_at, req_data) = suspend_map
                    .remove(step_key)
                    .unwrap_or((ts, serde_json::Value::Null));

                approvals.push(serde_json::json!({
                    "step_key": step_key,
                    "requested_at": requested_at.to_rfc3339(),
                    "resolved_at": ts.to_rfc3339(),
                    "status": "resolved",
                    "data": {
                        "request": req_data,
                        "response": data,
                    }
                }));
            }
        }

        // Add any unresolved suspends
        for (step_key, (requested_at, req_data)) in &suspend_map {
            approvals.push(serde_json::json!({
                "step_key": step_key,
                "requested_at": requested_at.to_rfc3339(),
                "resolved_at": null,
                "status": "pending",
                "data": {
                    "request": req_data,
                }
            }));
        }

        Ok(Some(serde_json::json!({
            "execution_id": execution_id.to_string(),
            "agent_id": workflow_id,
            "session_id": session_id,
            "status": status,
            "created_at": created_at.to_rfc3339(),
            "started_at": started_at.map(|dt| dt.to_rfc3339()),
            "completed_at": completed_at.map(|dt| dt.to_rfc3339()),
            "duration_ms": duration_ms,
            "error": error,
            "payload": payload,
            "result": result,
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "total_tokens": total_tokens,
            "tool_call_count": tool_call_count,
            "approval_count": approval_count,
            "timeline": timeline,
            "approvals": approvals,
        })))
    }
}

/// Extract user input from an execution payload as a JSON value.
/// The payload can have the input in various fields: "input", "message", "content", "prompt",
/// or it can be a bare string.
fn extract_user_input(payload: &serde_json::Value) -> Option<serde_json::Value> {
    // Try common message fields — return the raw value (string or structured)
    for key in &["input", "message", "content", "prompt"] {
        if let Some(val) = payload.get(*key) {
            if !val.is_null() {
                // If the value is a string, return it directly
                if val.is_string() {
                    return Some(val.clone());
                }
                // If it's an array/object, it might be a structured message list;
                // return as-is and let the UI handle it
                return Some(val.clone());
            }
        }
    }
    // Bare string payload
    if payload.is_string() {
        return Some(payload.clone());
    }
    None
}

/// Extract a message preview from a JSON value, truncated to max_len chars
fn extract_message_preview(value: &serde_json::Value, max_len: usize) -> Option<String> {
    // Try common message fields
    let text = if let Some(s) = value.get("message").and_then(|v| v.as_str()) {
        Some(s.to_string())
    } else if let Some(s) = value.get("content").and_then(|v| v.as_str()) {
        Some(s.to_string())
    } else if let Some(s) = value.get("input").and_then(|v| v.as_str()) {
        Some(s.to_string())
    } else if let Some(s) = value.get("prompt").and_then(|v| v.as_str()) {
        Some(s.to_string())
    } else if let Some(s) = value.as_str() {
        Some(s.to_string())
    } else {
        let serialized = serde_json::to_string(value).ok()?;
        Some(serialized)
    };

    text.map(|t| {
        if t.len() > max_len {
            format!("{}...", &t[..max_len])
        } else {
            t
        }
    })
}
