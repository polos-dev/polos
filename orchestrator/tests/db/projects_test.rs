// Integration tests for projects database operations
use crate::common::{create_test_project, setup_test_db};

#[tokio::test]
async fn test_project_creation() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = db
    .create_project("Test Project", Some("Test Description"))
    .await
    .expect("Failed to create project");

  assert_eq!(project.name, "Test Project");
  assert_eq!(project.description, Some("Test Description".to_string()));
}

#[tokio::test]
async fn test_project_retrieval() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");

  // Get project by ID
  let retrieved = db
    .get_project_by_id(&project.id)
    .await
    .expect("Failed to get project by ID");

  assert!(retrieved.is_some());
  let retrieved = retrieved.unwrap();
  assert_eq!(retrieved.id, project.id);
  assert_eq!(retrieved.name, project.name);
}

#[tokio::test]
async fn test_create_project_with_admin() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  // Use unique user ID per test
  use uuid::Uuid;
  let user_id = Uuid::new_v4().to_string();
  let email = format!("test-{}@example.com", user_id);

  // Create user first
  db.create_user(
    &user_id,
    &email,
    "Test",
    "User",
    "Test User",
    None,
    None,
    None,
  )
  .await
  .expect("Failed to create user");

  // Create project with admin
  let project = db
    .create_project_with_admin("Admin Project", None, &user_id)
    .await
    .expect("Failed to create project with admin");

  assert_eq!(project.name, "Admin Project");

  // Verify user is admin member
  let members = db
    .get_project_members_by_project(&project.id)
    .await
    .expect("Failed to get project members");

  assert_eq!(members.len(), 1);
  assert_eq!(members[0].user_id, user_id);
  use polos_orchestrator::db::models::ProjectRole;
  // ProjectRole doesn't implement PartialEq, so we compare the string representation
  assert!(matches!(members[0].role, ProjectRole::Admin));
}
