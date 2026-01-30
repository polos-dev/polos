// Integration tests for traces database operations
use crate::common::{create_test_project, setup_test_db};
use chrono::Utc;
use uuid::Uuid;

#[tokio::test]
async fn test_trace_creation() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    // Create test project
    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");

    // Generate a valid UUID for trace_id (32 hex characters without hyphens)
    let trace_id = Uuid::new_v4().to_string().replace("-", "");
    let span_id = "span-1";
    let started_at = Utc::now().to_rfc3339();

    // Store span
    db.store_span(
        &trace_id,
        span_id,
        None, // parent_span_id
        "test-span",
        "workflow",
        Some(serde_json::json!({"key": "value"})),
        None,
        Some(serde_json::json!({"input": "data"})),
        None,
        None,
        None,
        None,
        &started_at,
        None,
        &project.id,
    )
    .await
    .expect("Failed to store span");

    // Verify span was stored
    let spans = db
        .get_spans_by_trace_id(&trace_id, &project.id)
        .await
        .expect("Failed to get spans by trace ID");

    assert_eq!(spans.len(), 1);
    assert_eq!(spans[0]["trace_id"], trace_id);
    assert_eq!(spans[0]["span_id"], span_id);
    assert_eq!(spans[0]["name"], "test-span");
}

#[tokio::test]
async fn test_trace_retrieval() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    // Create test project
    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");

    // Generate a valid UUID for trace_id (32 hex characters without hyphens)
    let trace_id = Uuid::new_v4().to_string().replace("-", "");
    let started_at = Utc::now().to_rfc3339();
    let ended_at = (Utc::now() + chrono::Duration::seconds(10)).to_rfc3339();

    // Store root span
    db.store_span(
        &trace_id,
        "root-span",
        None,
        "root",
        "workflow",
        None,
        None,
        Some(serde_json::json!({"input": "test"})),
        Some(serde_json::json!({"output": "result"})),
        None,
        None,
        None,
        &started_at,
        Some(&ended_at),
        &project.id,
    )
    .await
    .expect("Failed to store root span");

    // Store child span
    db.store_span(
        &trace_id,
        "child-span",
        Some("root-span"),
        "child",
        "step",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &started_at,
        Some(&ended_at),
        &project.id,
    )
    .await
    .expect("Failed to store child span");

    // Get all spans for trace
    let spans = db
        .get_spans_by_trace_id(&trace_id, &project.id)
        .await
        .expect("Failed to get spans by trace ID");

    assert_eq!(spans.len(), 2);
    assert_eq!(spans[0]["span_id"], "root-span");
    assert_eq!(spans[1]["span_id"], "child-span");
    assert_eq!(spans[1]["parent_span_id"], "root-span");
}

#[tokio::test]
async fn test_trace_querying() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    // Create test project
    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");

    // Generate a valid UUID for trace_id (32 hex characters without hyphens)
    let trace_id = Uuid::new_v4().to_string().replace("-", "");
    let started_at = Utc::now();
    let ended_at = Utc::now() + chrono::Duration::seconds(5);

    // Store span with error
    db.store_span(
        &trace_id,
        "error-span",
        None,
        "error-workflow",
        "workflow",
        None,
        None,
        Some(serde_json::json!({"input": "test"})),
        None,
        Some(serde_json::json!({"error": "Something went wrong"})),
        None,
        None,
        &started_at.to_rfc3339(),
        Some(&ended_at.to_rfc3339()),
        &project.id,
    )
    .await
    .expect("Failed to store span with error");

    // Query traces with error filter
    let traces = db
        .get_traces(
            &project.id,
            None,             // start_time
            None,             // end_time
            Some("workflow"), // root_span_type
            None,             // root_span_name
            Some(true),       // has_error
            10,               // limit
            0,                // offset
        )
        .await
        .expect("Failed to get traces");

    // Should find our trace with error
    let found = traces.iter().find(|t| t["trace_id"] == trace_id);
    assert!(found.is_some());
    let trace = found.unwrap();
    assert!(trace["root_error"].is_object());
}
