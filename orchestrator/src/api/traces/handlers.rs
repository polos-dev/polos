use axum::{
  extract::{Path, Query, State},
  http::{HeaderMap, StatusCode},
  Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

use crate::api::auth::helpers::authenticate_api_key;
use crate::api::common::{ErrorResponse, ProjectId};
use crate::AppState;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct GetTracesQuery {
  start_time: Option<String>,
  end_time: Option<String>,
  root_span_type: Option<String>,
  root_span_name: Option<String>,
  has_error: Option<bool>,
  limit: Option<i64>,
  offset: Option<i64>,
}

/// Merge a span's data into a linked_span object.
/// Combines attributes, events, errors, and updates timing (min started_at, max ended_at).
/// Also sets parent_span_id, input, and output (last span wins for input/output).
async fn merge_span_into_linked(
  linked_obj: &mut serde_json::Map<String, serde_json::Value>,
  span_obj: &serde_json::Value,
  attrs_vec: &[(String, serde_json::Value)],
  span_parent_id: Option<serde_json::Value>,
) {
  // Combine attributes (excluding .previous_span_id)
  if let Some(linked_attrs) = linked_obj
    .get_mut("attributes")
    .and_then(|v| v.as_object_mut())
  {
    for (key, value) in attrs_vec {
      if !key.ends_with(".previous_span_id") {
        linked_attrs.insert(key.clone(), value.clone());
      }
    }
  }

  // Combine events
  if let Some(events) = span_obj.get("events").and_then(|v| v.as_array()) {
    let linked_events_val = linked_obj.get_mut("events");
    if let Some(linked_events_val) = linked_events_val {
      if let Some(linked_events) = linked_events_val.as_array_mut() {
        for event in events {
          linked_events.push(event.clone());
        }
      } else {
        *linked_events_val = serde_json::json!(events);
      }
    }
  }

  // Combine errors (take first non-null error)
  if linked_obj.get("error").is_none() || linked_obj.get("error") == Some(&serde_json::Value::Null)
  {
    if let Some(error) = span_obj.get("error") {
      if error != &serde_json::Value::Null {
        linked_obj.insert("error".to_string(), error.clone());
      }
    }
  }

  // Update started_at (min)
  if let Some(started_str) = span_obj.get("started_at").and_then(|v| v.as_str()) {
    if let Ok(started_dt) = DateTime::parse_from_rfc3339(started_str) {
      let started = started_dt.with_timezone(&Utc);
      if let Some(existing_str) = linked_obj.get("started_at").and_then(|v| v.as_str()) {
        if let Ok(existing_dt) = DateTime::parse_from_rfc3339(existing_str) {
          let existing = existing_dt.with_timezone(&Utc);
          if started < existing {
            linked_obj.insert(
              "started_at".to_string(),
              serde_json::json!(started.to_rfc3339()),
            );
          }
        }
      } else {
        linked_obj.insert(
          "started_at".to_string(),
          serde_json::json!(started.to_rfc3339()),
        );
      }
    }
  }

  // Update ended_at (max)
  if let Some(ended_value) = span_obj.get("ended_at") {
    if let Some(ended_str) = ended_value.as_str() {
      if let Ok(ended_dt) = DateTime::parse_from_rfc3339(ended_str) {
        let ended = ended_dt.with_timezone(&Utc);
        if let Some(existing_str) = linked_obj.get("ended_at").and_then(|v| v.as_str()) {
          if let Ok(existing_dt) = DateTime::parse_from_rfc3339(existing_str) {
            let existing = existing_dt.with_timezone(&Utc);
            if ended > existing {
              linked_obj.insert(
                "ended_at".to_string(),
                serde_json::json!(ended.to_rfc3339()),
              );
            }
          }
        } else {
          linked_obj.insert(
            "ended_at".to_string(),
            serde_json::json!(ended.to_rfc3339()),
          );
        }
      }
    }
  }

  // Set parent_span_id
  linked_obj.insert(
    "parent_span_id".to_string(),
    span_parent_id.clone().unwrap_or(serde_json::Value::Null),
  );

  // Set input and output from current span (last span wins)
  if let Some(input) = span_obj.get("input") {
    linked_obj.insert("input".to_string(), input.clone());
  }
  if let Some(output) = span_obj.get("output") {
    linked_obj.insert("output".to_string(), output.clone());
  }
  if let Some(initial_state) = span_obj.get("initial_state") {
    linked_obj.insert("initial_state".to_string(), initial_state.clone());
  }
  if let Some(final_state) = span_obj.get("final_state") {
    linked_obj.insert("final_state".to_string(), final_state.clone());
  }
}

pub async fn get_trace_by_id(
  State(state): State<Arc<AppState>>,
  ProjectId(project_id): ProjectId,
  Path(trace_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
  let mut spans = state
    .db
    .get_spans_by_trace_id(&trace_id, &project_id)
    .await
    .map_err(|e| {
      tracing::error!("Failed to get spans for trace {}: {}", trace_id, e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  // Build maps for quick lookup
  let mut span_id_to_span: HashMap<String, &serde_json::Value> = HashMap::new();
  let mut span_id_to_idx: HashMap<String, usize> = HashMap::new();
  for (idx, span) in spans.iter().enumerate() {
    if let Some(span_id) = span.get("span_id").and_then(|v| v.as_str()) {
      span_id_to_span.insert(span_id.to_string(), span);
      span_id_to_idx.insert(span_id.to_string(), idx);
    }
  }

  // Detect linked spans and create linked_span groups
  let mut linked_spans: Vec<serde_json::Value> = Vec::new();
  let mut linked_spans_map: HashMap<String, usize> = HashMap::new();
  let mut parent_updates: HashMap<String, String> = HashMap::new();

  for span_obj in spans.iter() {
    if let Some(span_id) = span_obj.get("span_id").and_then(|v| v.as_str()) {
      let span_parent_id = span_obj.get("parent_span_id").cloned();

      // Check for .previous_span_id attribute
      if let Some(attrs) = span_obj.get("attributes").and_then(|v| v.as_object()) {
        let attrs_vec: Vec<(String, serde_json::Value)> =
          attrs.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let attrs_vec_clone = attrs_vec.clone();
        for (key, value) in attrs_vec {
          if key.ends_with(".previous_span_id") {
            if let Some(previous_span_id) = value.as_str() {
              if let Some(previous_span_obj) = span_id_to_span.get(previous_span_id) {
                let prev_parent_id = previous_span_obj.get("parent_span_id");
                let parents_match = prev_parent_id == span_parent_id.as_ref();

                if parents_match {
                  let linked_span_idx = if let Some(&idx) = linked_spans_map.get(previous_span_id) {
                    idx
                  } else {
                    let mut linked_span_attrs = serde_json::Map::new();
                    if let Some(prev_attrs) = previous_span_obj
                      .get("attributes")
                      .and_then(|v| v.as_object())
                    {
                      for (key, value) in prev_attrs {
                        if !key.ends_with(".previous_span_id") {
                          linked_span_attrs.insert(key.clone(), value.clone());
                        }
                      }
                    }
                    let linked_span = serde_json::json!({
                      "trace_id": trace_id,
                      "span_id": format!("linked_{}", previous_span_id),
                      "parent_span_id": span_parent_id,
                      "name": previous_span_obj.get("name").and_then(|v| v.as_str()).unwrap_or("linked_span").to_string(),
                      "span_type": previous_span_obj.get("span_type").and_then(|v| v.as_str()).unwrap_or("linked").to_string(),
                      "attributes": linked_span_attrs,
                      "events": previous_span_obj.get("events").cloned().unwrap_or(serde_json::Value::Null),
                      "input": previous_span_obj.get("input").cloned(),
                      "output": previous_span_obj.get("output").cloned(),
                      "error": previous_span_obj.get("error").cloned(),
                      "initial_state": previous_span_obj.get("initial_state").cloned(),
                      "final_state": previous_span_obj.get("final_state").cloned(),
                      "started_at": previous_span_obj.get("started_at").and_then(|v| v.as_str()).map(|s| s.to_string()),
                      "ended_at": previous_span_obj.get("ended_at").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    });
                    let idx = linked_spans.len();
                    linked_spans.push(linked_span);
                    linked_spans_map.insert(previous_span_id.to_string(), idx);
                    idx
                  };

                  linked_spans_map.insert(span_id.to_string(), linked_span_idx);

                  let linked_span = &mut linked_spans[linked_span_idx];
                  if let Some(linked_obj) = linked_span.as_object_mut() {
                    merge_span_into_linked(
                      linked_obj,
                      span_obj,
                      &attrs_vec_clone,
                      span_parent_id.clone(),
                    )
                    .await;
                  }

                  let linked_span_id = linked_spans[linked_span_idx]
                    .get("span_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                  parent_updates.insert(span_id.to_string(), linked_span_id.clone());
                  parent_updates.insert(previous_span_id.to_string(), linked_span_id);
                }
              }
            }
          }
        }
      }
    }
  }

  // Apply parent_span_id updates
  for (span_id, linked_span_id) in parent_updates {
    if let Some(span_idx) = span_id_to_idx.get(&span_id) {
      if let Some(span_obj) = spans[*span_idx].as_object_mut() {
        span_obj.insert(
          "parent_span_id".to_string(),
          serde_json::json!(linked_span_id),
        );
      }
    }
  }

  // Add linked_spans to the spans vector
  spans.extend(linked_spans);

  // Re-sort spans by started_at after adding linked spans
  spans.sort_by(|a, b| {
    let a_start = a
      .get("started_at")
      .and_then(|v| v.as_str())
      .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
      .map(|dt| dt.with_timezone(&Utc));
    let b_start = b
      .get("started_at")
      .and_then(|v| v.as_str())
      .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
      .map(|dt| dt.with_timezone(&Utc));

    let time_cmp = a_start.cmp(&b_start);
    if time_cmp == std::cmp::Ordering::Equal {
      let a_is_linked = a
        .get("span_id")
        .and_then(|v| v.as_str())
        .map(|s| s.starts_with("linked_"))
        .unwrap_or(false);
      let b_is_linked = b
        .get("span_id")
        .and_then(|v| v.as_str())
        .map(|s| s.starts_with("linked_"))
        .unwrap_or(false);

      match (a_is_linked, b_is_linked) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => std::cmp::Ordering::Equal,
      }
    } else {
      time_cmp
    }
  });

  // Calculate trace metadata
  let mut trace_start_time: Option<DateTime<Utc>> = None;
  let mut trace_end_time: Option<DateTime<Utc>> = None;
  let mut error_count = 0;
  let mut root_span_name: Option<String> = None;

  for span in &spans {
    if let Some(span_obj) = span.as_object() {
      if let Some(started_str) = span_obj.get("started_at").and_then(|v| v.as_str()) {
        if let Ok(started_dt) = DateTime::parse_from_rfc3339(started_str) {
          let started = started_dt.with_timezone(&Utc);
          trace_start_time = Some(trace_start_time.map(|t| t.min(started)).unwrap_or(started));
        }
      }

      if let Some(ended_value) = span_obj.get("ended_at") {
        if let Some(ended_str) = ended_value.as_str() {
          if let Ok(ended_dt) = DateTime::parse_from_rfc3339(ended_str) {
            let ended = ended_dt.with_timezone(&Utc);
            trace_end_time = Some(trace_end_time.map(|t| t.max(ended)).unwrap_or(ended));
          }
        }
      }

      if span_obj.get("error").and_then(|v| v.as_object()).is_some() {
        error_count += 1;
      }
    }
  }

  if let Some(first_span) = spans.first() {
    if let Some(span_obj) = first_span.as_object() {
      if let Some(name) = span_obj.get("name").and_then(|v| v.as_str()) {
        root_span_name = Some(name.to_string());
      }
    }
  }

  // Get execution status from trace_id (execution_id without hyphens)
  let execution_status = if trace_id.len() == 32 {
    let execution_id_str = format!(
      "{}-{}-{}-{}-{}",
      &trace_id[0..8],
      &trace_id[8..12],
      &trace_id[12..16],
      &trace_id[16..20],
      &trace_id[20..32]
    );

    if let Ok(execution_id) = Uuid::parse_str(&execution_id_str) {
      state
        .db
        .get_execution(&execution_id)
        .await
        .ok()
        .map(|execution| execution.status)
    } else {
      None
    }
  } else {
    None
  };

  let response = serde_json::json!({
    "trace_id": trace_id,
    "spans": spans,
    "trace_start_time": trace_start_time.map(|t| t.to_rfc3339()),
    "trace_end_time": trace_end_time.map(|t| t.to_rfc3339()),
    "span_count": spans.len(),
    "error_count": error_count,
    "root_span_name": root_span_name,
    "status": execution_status.unwrap_or_else(|| "unknown".to_string()),
  });

  Ok(Json(response))
}

pub async fn get_traces(
  State(state): State<Arc<AppState>>,
  ProjectId(project_id): ProjectId,
  Query(params): Query<GetTracesQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
  let start_time = params
    .start_time
    .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
    .map(|dt| dt.with_timezone(&Utc));

  let end_time = params
    .end_time
    .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
    .map(|dt| dt.with_timezone(&Utc));

  let limit = params.limit.unwrap_or(50);
  let offset = params.offset.unwrap_or(0);

  let traces = state
    .db
    .get_traces(
      &project_id,
      start_time,
      end_time,
      params.root_span_type.as_deref(),
      params.root_span_name.as_deref(),
      params.has_error,
      limit,
      offset,
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to get traces: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  let response = serde_json::json!({
    "traces": traces,
  });

  Ok(Json(response))
}

#[derive(Deserialize)]
pub struct StoreSpanRequest {
  trace_id: String,
  span_id: String,
  parent_span_id: Option<String>,
  name: String,
  span_type: String,
  attributes: Option<serde_json::Value>,
  events: Option<serde_json::Value>,
  input: Option<serde_json::Value>,
  output: Option<serde_json::Value>,
  error: Option<serde_json::Value>,
  initial_state: Option<serde_json::Value>,
  final_state: Option<serde_json::Value>,
  started_at: String,
  ended_at: Option<String>,
}

#[derive(Deserialize)]
pub struct StoreSpansBatchRequest {
  spans: Vec<StoreSpanRequest>,
}

pub async fn store_spans_batch(
  State(state): State<Arc<AppState>>,
  headers: HeaderMap,
  Json(req): Json<StoreSpansBatchRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
  // Authenticate API key and get project_id
  let api_key_project_id = authenticate_api_key(&state, &headers).await?;

  // Validate that all spans belong to executions in the same project
  // trace_id is execution UUID without hyphens, so we need to convert it
  for span_req in &req.spans {
    // Convert trace_id (UUID without hyphens) to execution_id (UUID with hyphens)
    // UUID format: 8-4-4-4-12 (32 hex chars total)
    let trace_id = &span_req.trace_id;
    if trace_id.len() != 32 {
      return Err((
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
          error: format!(
            "Invalid trace_id format: expected 32 hex characters, got {}",
            trace_id.len()
          ),
          error_type: "BAD_REQUEST".to_string(),
        }),
      ));
    }

    // Insert hyphens at positions 8, 13, 18, 23
    let execution_id_str = format!(
      "{}-{}-{}-{}-{}",
      &trace_id[0..8],
      &trace_id[8..12],
      &trace_id[12..16],
      &trace_id[16..20],
      &trace_id[20..32]
    );

    let execution_id = Uuid::parse_str(&execution_id_str).map_err(|e| {
      (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
          error: format!("Invalid trace_id format: {}", e),
          error_type: "BAD_REQUEST".to_string(),
        }),
      )
    })?;

    // Get project_id from execution and verify it matches API key's project_id
    let execution_project_id = state
      .db
      .get_project_id_from_execution(&execution_id)
      .await
      .map_err(|e| {
        tracing::error!("Failed to get project_id from execution: {}", e);
        (
          StatusCode::INTERNAL_SERVER_ERROR,
          Json(ErrorResponse {
            error: "Failed to get execution".to_string(),
            error_type: "INTERNAL_ERROR".to_string(),
          }),
        )
      })?;

    if api_key_project_id != execution_project_id {
      return Err((
        StatusCode::FORBIDDEN,
        Json(ErrorResponse {
          error: "API key project does not match execution project".to_string(),
          error_type: "FORBIDDEN".to_string(),
        }),
      ));
    }
  }

  // Set project_id for RLS
  state
    .db
    .set_project_id(&api_key_project_id, false)
    .await
    .map_err(|e| {
      tracing::error!("Failed to set project_id: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
          error: "Failed to set project_id".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  for span_req in req.spans {
    state
      .db
      .store_span(
        &span_req.trace_id,
        &span_req.span_id,
        span_req.parent_span_id.as_deref(),
        &span_req.name,
        &span_req.span_type,
        span_req.attributes,
        span_req.events,
        span_req.input,
        span_req.output,
        span_req.error,
        span_req.initial_state,
        span_req.final_state,
        &span_req.started_at,
        span_req.ended_at.as_deref(),
        &api_key_project_id,
      )
      .await
      .map_err(|e| {
        tracing::error!("Failed to store span in batch: {}", e);
        (
          StatusCode::INTERNAL_SERVER_ERROR,
          Json(ErrorResponse {
            error: "Failed to store span".to_string(),
            error_type: "INTERNAL_ERROR".to_string(),
          }),
        )
      })?;
  }

  Ok(StatusCode::OK)
}
