// Integration tests for schedules database operations
use crate::common::{
  create_test_deployment, create_test_project, create_test_workflow, setup_test_db,
};
use sqlx::Row;

#[tokio::test]
async fn test_schedule_creation() {
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

  // Mark workflow as scheduled
  sqlx::query("UPDATE deployment_workflows SET scheduled = TRUE WHERE workflow_id = $1 AND deployment_id = $2 AND project_id = $3")
        .bind(&workflow_id)
        .bind(&deployment_id)
        .bind(&project.id)
        .execute(&db.pool)
        .await
        .expect("Failed to mark workflow as scheduled");

  // Create schedule (use unique key per test to avoid conflicts)
  use uuid::Uuid;
  let schedule_key = format!("key-{}", Uuid::new_v4());
  let schedule_id = db
    .create_or_update_schedule(
      &workflow_id,
      "0 9 * * *", // Every day at 9 AM
      "UTC",
      &schedule_key,
      &project.id,
    )
    .await
    .expect("Failed to create schedule");

  // Verify schedule was created
  let row =
    sqlx::query("SELECT id, workflow_id, cron, timezone, status FROM schedules WHERE id = $1")
      .bind(schedule_id)
      .fetch_optional(&db.pool)
      .await
      .expect("Failed to query schedule");

  assert!(row.is_some());
  let row = row.unwrap();
  assert_eq!(row.get::<String, _>("workflow_id"), workflow_id);
  assert_eq!(row.get::<String, _>("cron"), "0 9 * * *");
  assert_eq!(row.get::<String, _>("timezone"), "UTC");
  assert_eq!(row.get::<String, _>("status"), "active");
}
