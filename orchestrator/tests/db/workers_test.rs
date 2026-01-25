// Integration tests for workers database operations
use crate::common::{
  create_test_deployment, create_test_project, create_test_worker, setup_test_db,
};
use sqlx::Row;
use uuid::Uuid;

#[tokio::test]
async fn test_worker_registration() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");
  let deployment_id = create_test_deployment(&db, &project.id)
    .await
    .expect("Failed to create test deployment");

  let worker_id = Uuid::new_v4();
  db.register_worker(
    &worker_id,
    &project.id,
    None,
    Some("push"),
    Some("http://localhost:8000"),
    Some(100),
    Some(&deployment_id),
  )
  .await
  .expect("Failed to register worker");

  // Verify worker was registered (check via query since we don't have a get_worker function)
  let row = sqlx::query("SELECT id, status, mode, push_endpoint_url FROM workers WHERE id = $1")
    .bind(worker_id)
    .fetch_optional(&db.pool)
    .await
    .expect("Failed to query worker");

  assert!(row.is_some());
  let row = row.unwrap();
  assert_eq!(row.get::<Uuid, _>("id"), worker_id);
  assert_eq!(row.get::<String, _>("status"), "offline");
  assert_eq!(row.get::<String, _>("mode"), "push");
  assert_eq!(
    row.get::<Option<String>, _>("push_endpoint_url"),
    Some("http://localhost:8000".to_string())
  );
}

#[tokio::test]
async fn test_worker_heartbeat() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");
  let deployment_id = create_test_deployment(&db, &project.id)
    .await
    .expect("Failed to create test deployment");
  let worker_id = create_test_worker(&db, &project.id, Some(&deployment_id))
    .await
    .expect("Failed to create test worker");

  // Get initial heartbeat
  let initial_row = sqlx::query("SELECT last_heartbeat FROM workers WHERE id = $1")
    .bind(worker_id)
    .fetch_one(&db.pool)
    .await
    .expect("Failed to query worker");
  let initial_heartbeat: chrono::DateTime<chrono::Utc> = initial_row.get("last_heartbeat");

  // Wait a bit to ensure timestamp difference
  tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

  // Update heartbeat
  db.update_worker_heartbeat(&worker_id)
    .await
    .expect("Failed to update heartbeat");

  // Verify heartbeat was updated
  let updated_row = sqlx::query("SELECT last_heartbeat FROM workers WHERE id = $1")
    .bind(worker_id)
    .fetch_one(&db.pool)
    .await
    .expect("Failed to query worker");
  let updated_heartbeat: chrono::DateTime<chrono::Utc> = updated_row.get("last_heartbeat");

  assert!(updated_heartbeat > initial_heartbeat);
}

#[tokio::test]
async fn test_update_worker_status() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");
  let deployment_id = create_test_deployment(&db, &project.id)
    .await
    .expect("Failed to create test deployment");
  let worker_id = create_test_worker(&db, &project.id, Some(&deployment_id))
    .await
    .expect("Failed to create test worker");

  // Update status to online
  db.update_worker_status(&worker_id, "online")
    .await
    .expect("Failed to update worker status");

  // Verify status was updated
  let row = sqlx::query("SELECT status FROM workers WHERE id = $1")
    .bind(worker_id)
    .fetch_one(&db.pool)
    .await
    .expect("Failed to query worker");
  assert_eq!(row.get::<String, _>("status"), "online");
}
