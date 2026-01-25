// Integration tests for tools database operations
use crate::common::{create_test_deployment, create_test_project, setup_test_db};

#[tokio::test]
async fn test_tool_registration() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");
  let deployment_id = create_test_deployment(&db, &project.id)
    .await
    .expect("Failed to create test deployment");

  // Create tool definition
  db.create_or_update_tool_definition(
    "test-tool",
    &deployment_id,
    "function",
    Some("Test tool description"),
    Some(&serde_json::json!({"type": "object"})),
    Some(&serde_json::json!({"version": "1.0"})),
    &project.id,
  )
  .await
  .expect("Failed to create tool definition");

  // Verify tool was created
  let tool = db
    .get_tool_definition("test-tool", &deployment_id)
    .await
    .expect("Failed to get tool definition");

  assert!(tool.is_some());
  let tool = tool.unwrap();
  assert_eq!(tool.id, "test-tool");
  assert_eq!(tool.deployment_id, deployment_id);
  assert_eq!(tool.tool_type, "function");
  assert_eq!(tool.description, Some("Test tool description".to_string()));
}

#[tokio::test]
async fn test_tool_retrieval() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");
  let deployment_id = create_test_deployment(&db, &project.id)
    .await
    .expect("Failed to create test deployment");

  // Create multiple tools
  db.create_or_update_tool_definition(
    "tool1",
    &deployment_id,
    "function",
    None,
    None,
    None,
    &project.id,
  )
  .await
  .expect("Failed to create tool1");
  db.create_or_update_tool_definition(
    "tool2",
    &deployment_id,
    "function",
    None,
    None,
    None,
    &project.id,
  )
  .await
  .expect("Failed to create tool2");

  // Get all tools by project
  let tools = db
    .get_tools_by_project(&project.id)
    .await
    .expect("Failed to get tools by project");

  assert!(tools.len() >= 2);
  let tool_ids: Vec<&str> = tools.iter().map(|t| t.id.as_str()).collect();
  assert!(tool_ids.contains(&"tool1"));
  assert!(tool_ids.contains(&"tool2"));
}

#[tokio::test]
async fn test_tool_update() {
  let db = setup_test_db()
    .await
    .expect("Failed to setup test database");

  let project = create_test_project(&db)
    .await
    .expect("Failed to create test project");
  let deployment_id = create_test_deployment(&db, &project.id)
    .await
    .expect("Failed to create test deployment");

  // Create tool
  db.create_or_update_tool_definition(
    "update-tool",
    &deployment_id,
    "function",
    Some("Old description"),
    None,
    None,
    &project.id,
  )
  .await
  .expect("Failed to create tool");

  // Update tool
  db.create_or_update_tool_definition(
    "update-tool",
    &deployment_id,
    "function",
    Some("New description"),
    Some(&serde_json::json!({"updated": true})),
    None,
    &project.id,
  )
  .await
  .expect("Failed to update tool");

  // Verify tool was updated
  let tool = db
    .get_tool_definition("update-tool", &deployment_id)
    .await
    .expect("Failed to get tool definition");

  assert!(tool.is_some());
  assert_eq!(
    tool.unwrap().description,
    Some("New description".to_string())
  );
}
