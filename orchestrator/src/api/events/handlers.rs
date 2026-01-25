use axum::{
  extract::{Query, State},
  http::{HeaderMap, StatusCode},
  response::sse::{Event as SseEvent, Sse},
  Json,
};
use chrono::{DateTime, Utc};
use futures::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::api::common::{ErrorResponse, OptionalProjectId, ProjectId};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct EventData {
  pub event_type: Option<String>,
  pub data: serde_json::Value,
  #[serde(default)]
  pub execution_id: Option<String>,
  #[serde(default)]
  pub attempt_number: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct PublishEventRequest {
  pub topic: String,
  pub events: Vec<EventData>,
  pub durable: Option<bool>,
  pub execution_id: Option<String>,
  pub root_execution_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PublishEventResponse {
  pub sequence_ids: Vec<i64>,
  pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct EventResponse {
  pub id: String,
  pub sequence_id: i64,
  pub topic: String,
  pub event_type: Option<String>,
  pub data: serde_json::Value,
  pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct GetEventsResponse {
  pub events: Vec<EventResponse>,
  pub next_sequence_id: Option<i64>,
  pub has_more: bool,
}

pub async fn publish_event(
  State(state): State<Arc<AppState>>,
  OptionalProjectId(project_id_from_header): OptionalProjectId,
  Json(req): Json<PublishEventRequest>,
) -> Result<Json<PublishEventResponse>, StatusCode> {
  if req.events.is_empty() {
    return Err(StatusCode::BAD_REQUEST);
  }

  let durable = req.durable.unwrap_or(false);

  let source_execution_id = if durable {
    req
      .execution_id
      .as_ref()
      .and_then(|s| Uuid::parse_str(s).ok())
  } else {
    None
  };
  let root_execution_id = if durable {
    req
      .root_execution_id
      .as_ref()
      .and_then(|s| Uuid::parse_str(s).ok())
  } else {
    None
  };

  if durable
    && (req.execution_id.is_none()
      || req.root_execution_id.is_none()
      || source_execution_id.is_none()
      || root_execution_id.is_none())
  {
    return Err(StatusCode::BAD_REQUEST);
  }

  let project_id = if let Some(header_id) = project_id_from_header {
    tracing::debug!("Using project_id from header: {}", header_id);
    header_id
  } else if let Some(ref exec_id) = source_execution_id {
    tracing::debug!("Getting project_id from execution: {}", exec_id);
    state
      .db
      .get_project_id_from_execution(exec_id)
      .await
      .map_err(|e| {
        tracing::error!("Failed to get project_id from execution {}: {}", exec_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
      })?
  } else if let Some(first_event) = req.events.first() {
    if let Some(exec_id_str) = &first_event.execution_id {
      if let Ok(exec_id) = Uuid::parse_str(exec_id_str) {
        tracing::debug!("Getting project_id from event execution_id: {}", exec_id);
        state
          .db
          .get_project_id_from_execution(&exec_id)
          .await
          .map_err(|e| {
            tracing::error!(
              "Failed to get project_id from event execution_id {}: {}",
              exec_id_str,
              e
            );
            StatusCode::INTERNAL_SERVER_ERROR
          })?
      } else {
        tracing::error!("Invalid execution_id format in event: {}", exec_id_str);
        return Err(StatusCode::BAD_REQUEST);
      }
    } else {
      tracing::error!(
        "No project_id header, no durable execution_id, and no execution_id in first event"
      );
      return Err(StatusCode::BAD_REQUEST);
    }
  } else {
    tracing::error!("No project_id header, no durable execution_id, and no events in request");
    return Err(StatusCode::BAD_REQUEST);
  };

  tracing::debug!("Using project_id: {} for event publishing", project_id);

  state
    .db
    .set_project_id(&project_id, false)
    .await
    .map_err(|e| {
      tracing::error!("Failed to set project_id: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  let events: Vec<(Option<String>, serde_json::Value, Option<Uuid>, i32)> = req
    .events
    .into_iter()
    .map(|e| {
      let execution_id = e
        .execution_id
        .as_ref()
        .and_then(|s| Uuid::parse_str(s).ok());
      let attempt_number = e.attempt_number.unwrap_or(0);
      (e.event_type, e.data, execution_id, attempt_number)
    })
    .collect();

  let sequence_ids = state
    .db
    .publish_events_batch(
      req.topic.clone(),
      events,
      source_execution_id.as_ref(),
      root_execution_id.as_ref(),
      &project_id,
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to publish events: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  let created_at = chrono::Utc::now().to_rfc3339();

  Ok(Json(PublishEventResponse {
    sequence_ids,
    created_at,
  }))
}

pub async fn get_events(
  State(state): State<Arc<AppState>>,
  Query(params): Query<HashMap<String, String>>,
  headers: HeaderMap,
) -> Result<Json<GetEventsResponse>, StatusCode> {
  let topic = params.get("topic").ok_or(StatusCode::BAD_REQUEST)?;
  let last_sequence_id = params
    .get("last_sequence_id")
    .and_then(|s| s.parse::<i64>().ok());
  let last_timestamp = params
    .get("last_timestamp")
    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
    .map(|dt| dt.with_timezone(&Utc));
  let limit = params
    .get("limit")
    .and_then(|s| s.parse::<i32>().ok())
    .unwrap_or(100);

  // Extract project_id from query param or header
  let project_id = params
    .get("project_id")
    .and_then(|s| Uuid::parse_str(s).ok())
    .or_else(|| {
      headers
        .get("X-Project-ID")
        .or_else(|| headers.get("Project-ID"))
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
    })
    .ok_or(StatusCode::BAD_REQUEST)?;

  // Set project_id for RLS - required, error if it fails
  state
    .db
    .set_project_id(&project_id, false)
    .await
    .map_err(|e| {
      tracing::error!("Failed to set project_id in get_events: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  let events = state
    .db
    .get_events(topic, &project_id, last_sequence_id, last_timestamp, limit)
    .await
    .map_err(|e| {
      tracing::error!("Failed to get events: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  let event_responses: Vec<EventResponse> = events
    .iter()
    .map(|e| EventResponse {
      id: e.id.to_string(),
      sequence_id: e.sequence_id,
      topic: e.topic.clone(),
      event_type: e.event_type.clone(),
      data: e.data.clone(),
      created_at: e.created_at.to_rfc3339(),
    })
    .collect();

  let next_sequence_id = event_responses.last().map(|e| e.sequence_id);
  let has_more = event_responses.len() as i32 == limit;

  Ok(Json(GetEventsResponse {
    events: event_responses,
    next_sequence_id,
    has_more,
  }))
}

pub async fn stream_events(
  State(state): State<Arc<AppState>>,
  Query(params): Query<HashMap<String, String>>,
  headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<SseEvent, axum::Error>>>, (StatusCode, Json<ErrorResponse>)>
{
  // Extract project_id from query param or header - required
  let project_id = params
    .get("project_id")
    .and_then(|s| Uuid::parse_str(s).ok())
    .or_else(|| {
      headers
        .get("X-Project-ID")
        .or_else(|| headers.get("Project-ID"))
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
    })
    .ok_or((
      StatusCode::BAD_REQUEST,
      axum::Json(ErrorResponse {
        error: "project_id query parameter or X-Project-ID header is required".to_string(),
        error_type: "BAD_REQUEST".to_string(),
      }),
    ))?;

  // Set project_id for RLS - required, error if it fails
  state
    .db
    .set_project_id(&project_id, false)
    .await
    .map_err(|e| {
      tracing::error!("Failed to set project_id in stream_events: {}", e);
      (
        StatusCode::INTERNAL_SERVER_ERROR,
        axum::Json(ErrorResponse {
          error: "Failed to set project_id for RLS".to_string(),
          error_type: "INTERNAL_ERROR".to_string(),
        }),
      )
    })?;

  let workflow_run_id = params
    .get("workflow_run_id")
    .and_then(|s| Uuid::parse_str(s).ok());
  let topic = if let Some(run_id) = workflow_run_id {
    format!("workflow:{}", run_id)
  } else {
    params.get("topic").cloned().unwrap_or_default()
  };

  let last_sequence_id_param = params
    .get("last_sequence_id")
    .and_then(|s| s.parse::<i64>().ok());
  let last_timestamp = params
    .get("last_timestamp")
    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
    .map(|dt| dt.with_timezone(&Utc));

  let last_sequence_id =
    if workflow_run_id.is_some() && last_sequence_id_param.is_none() && last_timestamp.is_none() {
      Some(0)
    } else {
      last_sequence_id_param
    };

  let (tx, rx) = tokio::sync::mpsc::unbounded_channel();

  let state_clone = state.clone();
  let topic_clone = topic.clone();
  let initial_last_timestamp = last_timestamp;
  let workflow_run_id_clone = workflow_run_id;
  let project_id_clone = project_id;
  tokio::spawn(async move {
    let mut last_sequence_id_local = last_sequence_id;
    let mut last_timestamp_local = initial_last_timestamp;
    let mut execution_completed = false;

    loop {
      let events = match state_clone
        .db
        .get_events(
          &topic_clone,
          &project_id_clone,
          last_sequence_id_local,
          last_timestamp_local,
          100,
        )
        .await
      {
        Ok(events) => events,
        Err(_) => {
          let _ = tx.send(Ok(SseEvent::default().data("keepalive")));
          // Wait before retrying on error
          tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
          continue;
        }
      };

      if events.is_empty() {
        if let Some(execution_id) = workflow_run_id_clone {
          if !execution_completed {
            match state_clone.db.get_execution(&execution_id).await {
              Ok(execution) => {
                match execution.status.as_str() {
                  "failed" => {
                    let _ = tx.send(Ok(SseEvent::default().data(serde_json::json!({
                      "type": "error",
                      "message": execution.error.unwrap_or_else(|| "Execution failed".to_string())
                    }).to_string())));
                    return;
                  }
                  "completed" => {
                    execution_completed = true;
                    let _ = tx.send(Ok(SseEvent::default().data("keepalive")));
                    // Wait before checking again
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                    continue;
                  }
                  "running" => {
                    let _ = tx.send(Ok(SseEvent::default().data("keepalive")));
                    // Wait before checking again
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                    continue;
                  }
                  _ => {
                    let _ = tx.send(Ok(SseEvent::default().data("keepalive")));
                    // Wait before checking again
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                    continue;
                  }
                }
              }
              Err(_) => {
                let _ = tx.send(Ok(SseEvent::default().data("keepalive")));
                // Wait before retrying on error
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                continue;
              }
            }
          } else {
            let _ = tx.send(Ok(SseEvent::default().data("keepalive")));
            // Wait before checking again
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            continue;
          }
        } else {
          let _ = tx.send(Ok(SseEvent::default().data("keepalive")));
            // Wait before checking again when no events found
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
          continue;
        }
      }

      for e in events {
        last_sequence_id_local = Some(e.sequence_id);
        last_timestamp_local = Some(e.created_at);
        let event_json = serde_json::json!({
          "id": e.id.to_string(),
          "sequence_id": e.sequence_id,
          "topic": e.topic,
          "event_type": e.event_type,
          "data": e.data,
          "created_at": e.created_at.to_rfc3339(),
        });
        let sse_event = SseEvent::default().json_data(event_json).unwrap();
        if tx.send(Ok(sse_event)).is_err() {
          return;
        }
      }
    }
  });

  let stream = stream::unfold(rx, |mut rx| async move {
    rx.recv().await.map(|item| (item, rx))
  });

  Ok(Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default()))
}

#[derive(Deserialize)]
pub struct RegisterEventTriggerRequest {
  pub workflow_id: String,
  pub deployment_id: String,
  pub event_topic: String,
  pub batch_size: i32,
  pub batch_timeout_seconds: Option<i32>,
}

pub async fn register_event_trigger(
  State(state): State<Arc<AppState>>,
  ProjectId(project_id): ProjectId,
  Json(req): Json<RegisterEventTriggerRequest>,
) -> Result<StatusCode, StatusCode> {
  // Validate project_id exists
  let project_exists = state
    .db
    .validate_project_id(&project_id)
    .await
    .map_err(|e| {
      tracing::error!("Failed to validate project_id: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  if !project_exists {
    return Err(StatusCode::NOT_FOUND);
  }

  // Set project_id session variable for RLS
  state
    .db
    .set_project_id(&project_id, false)
    .await
    .map_err(|e| {
      tracing::error!("Failed to set project_id: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  state
    .db
    .create_or_update_event_trigger(
      &req.workflow_id,
      &req.deployment_id,
      &req.event_topic,
      req.batch_size,
      req.batch_timeout_seconds,
      &project_id,
    )
    .await
    .map_err(|e| {
      tracing::error!("Failed to register event trigger: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR
    })?;

  tracing::info!(
    "Registered event trigger for workflow {} on topic {}",
    req.workflow_id,
    req.event_topic
  );
  Ok(StatusCode::OK)
}
