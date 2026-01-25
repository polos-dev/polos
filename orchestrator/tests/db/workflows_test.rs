// Integration tests for workflows database operations
use crate::common::{
  create_test_deployment, create_test_project, create_test_workflow, setup_test_db,
};

#[tokio::test]
async fn test_workflow_creation() {
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

  // Verify workflow was created
  let workflows = db
    .get_workflows_by_project(&project.id)
    .await
    .expect("Failed to get workflows");
  let workflow = workflows.iter().find(|w| w.workflow_id == workflow_id);
  assert!(workflow.is_some());
  let workflow = workflow.unwrap();
  assert_eq!(workflow.workflow_id, workflow_id);
  assert_eq!(workflow.deployment_id, deployment_id);
  assert_eq!(workflow.workflow_type, "workflow");
}

#[tokio::test]
async fn test_get_workflow_by_id() {
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

  // Get workflow by ID
  let workflow = db
    .get_workflow_by_id(&project.id, &workflow_id)
    .await
    .expect("Failed to get workflow by ID");

  assert!(workflow.is_some());
  let workflow = workflow.unwrap();
  assert_eq!(workflow.workflow_id, workflow_id);
  assert_eq!(workflow.deployment_id, deployment_id);
}
