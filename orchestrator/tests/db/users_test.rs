// Integration tests for users database operations
use crate::common::{create_test_project, setup_test_db};
use uuid::Uuid;

#[tokio::test]
async fn test_user_creation() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let user_id = Uuid::new_v4().to_string();
  let email = format!("test-{}@example.com", user_id);

  let user = db
    .create_user(
      &user_id,
      &email,
      "John",
      "Doe",
      "John Doe",
      Some("hashed_password"),
      Some("local"),
      None,
    )
    .await
    .expect("Failed to create user");

  assert_eq!(user.id, user_id);
  assert_eq!(user.email, email);
  assert_eq!(user.first_name, "John");
  assert_eq!(user.last_name, "Doe");
  assert_eq!(user.display_name, "John Doe");
}

#[tokio::test]
async fn test_user_retrieval() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  // Create user
  let user_id = Uuid::new_v4().to_string();
  let email = format!("retrieve-{}@example.com", user_id);

  db.create_user(
    &user_id,
    &email,
    "Jane",
    "Smith",
    "Jane Smith",
    None,
    None,
    None,
  )
  .await
  .expect("Failed to create user");

  // Get user by email
  let user = db
    .get_user_by_email(&email)
    .await
    .expect("Failed to get user by email");

  assert!(user.is_some());
  let user = user.unwrap();
  assert_eq!(user.id, user_id);
  assert_eq!(user.email, email);

  // Get user by ID
  let user2 = db
    .get_user_by_id(&user_id)
    .await
    .expect("Failed to get user by ID");

  assert!(user2.is_some());
  assert_eq!(user2.unwrap().id, user_id);
}

#[tokio::test]
async fn test_user_update() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  // Create user
  let user_id = Uuid::new_v4().to_string();
  let email = format!("update-{}@example.com", user_id);

  db.create_user(
    &user_id, &email, "Old", "Name", "Old Name", None, None, None,
  )
  .await
  .expect("Failed to create user");

  // Update user
  let updated = db
    .update_user(
      &user_id,
      Some("New"),
      Some("Name"),
      Some("New Name"),
      None,
      None,
    )
    .await
    .expect("Failed to update user");

  assert_eq!(updated.first_name, "New");
  assert_eq!(updated.last_name, "Name");
  assert_eq!(updated.display_name, "New Name");
}

#[tokio::test]
async fn test_project_member_operations() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");

  // Create user
  let user_id = Uuid::new_v4().to_string();
  let email = format!("member-{}@example.com", user_id);
  db.create_user(
    &user_id,
    &email,
    "Member",
    "User",
    "Member User",
    None,
    None,
    None,
  )
  .await
  .expect("Failed to create user");

  // Add project member
  use polos_orchestrator::db::models::ProjectRole;
  let member_id = Uuid::new_v4().to_string();
  db.create_project_member(
    &member_id,
    &user_id,
    &project.id,
    ProjectRole::Read, // Use Read instead of Member
  )
  .await
  .expect("Failed to create project member");

  // Get project members
  let members = db
    .get_project_members_by_project(&project.id)
    .await
    .expect("Failed to get project members");

  assert_eq!(members.len(), 1);
  assert_eq!(members[0].user_id, user_id);
  assert!(matches!(members[0].role, ProjectRole::Read));
}
