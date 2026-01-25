// Integration tests for wait database operations
use crate::common::{
  create_test_deployment, create_test_project, create_test_workflow, setup_test_db,
};
use chrono::Utc;
use sqlx::Row;

#[tokio::test]
async fn test_wait_step_creation() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");
  let deployment_id = create_test_deployment(&db, &project.id)
    .await
    .expect("Failed to create test deployment");
  let workflow_id = create_test_workflow(&db, &deployment_id, &project.id)
    .await
    .expect("Failed to create test workflow");

  let (exec_id, _) = db
    .create_execution(
      &workflow_id,
      serde_json::json!({}),
      &deployment_id,
      None,
      None,
      None,
      workflow_id.clone(),
      None,
      false,
      None,
      None,
      None,
      &project.id,
      None,
      None,
    )
    .await
    .expect("Failed to create execution");

  // Set waiting
  let wait_until = Utc::now() + chrono::Duration::seconds(60);
  db.set_waiting(
    &exec_id,
    "step1",
    Some(wait_until),
    Some("time"),
    None,
    None,
  )
  .await
  .expect("Failed to set waiting");

  // Verify execution is waiting
  let exec = db
    .get_execution(&exec_id)
    .await
    .expect("Failed to get execution");
  assert_eq!(exec.status, "waiting");

  // Verify wait step was created
  let row = sqlx::query(
    "SELECT wait_type, wait_until FROM wait_steps WHERE execution_id = $1 AND step_key = $2",
  )
  .bind(exec_id)
  .bind("step1")
  .fetch_optional(&db.pool)
  .await
  .expect("Failed to query wait step");

  assert!(row.is_some());
  let row = row.unwrap();
  assert_eq!(
    row.get::<Option<String>, _>("wait_type"),
    Some("time".to_string())
  );
}

#[tokio::test]
async fn test_wait_step_resolution() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");
  let deployment_id = create_test_deployment(&db, &project.id)
    .await
    .expect("Failed to create test deployment");
  let workflow_id = create_test_workflow(&db, &deployment_id, &project.id)
    .await
    .expect("Failed to create test workflow");

  let (exec_id, _) = db
    .create_execution(
      &workflow_id,
      serde_json::json!({}),
      &deployment_id,
      None,
      None,
      None,
      workflow_id.clone(),
      None,
      false,
      None,
      None,
      None,
      &project.id,
      None,
      None,
    )
    .await
    .expect("Failed to create execution");

  // Set waiting
  db.set_waiting(
    &exec_id,
    "step1",
    None,
    Some("event"),
    Some("test-topic"),
    None,
  )
  .await
  .expect("Failed to set waiting");

  // Resume from wait
  db.resume_execution_from_wait(
    &exec_id,
    &exec_id,
    "step1",
    "event",
    None,
    Some("test-topic"),
    None,
  )
  .await
  .expect("Failed to resume from wait");

  // Verify execution is queued
  let exec = db
    .get_execution(&exec_id)
    .await
    .expect("Failed to get execution");
  assert_eq!(exec.status, "queued");
}
