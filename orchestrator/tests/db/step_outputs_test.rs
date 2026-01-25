// Integration tests for step_outputs database operations
use crate::common::{
  create_test_deployment, create_test_project, create_test_workflow, setup_test_db,
};

#[tokio::test]
async fn test_step_output_storage() {
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

  // Store step output
  let outputs = serde_json::json!({"result": "success"});
  db.store_step_output(
    &exec_id,
    "step1",
    Some(outputs.clone()),
    None,
    Some(true),
    None,
    None,
  )
  .await
  .expect("Failed to store step output");

  // Verify output was stored
  let stored = db
    .get_step_output(&exec_id, "step1")
    .await
    .expect("Failed to get step output");

  assert!(stored.is_some());
  let stored = stored.unwrap();
  assert_eq!(stored["outputs"], outputs);
  assert_eq!(stored["success"], true);
}

#[tokio::test]
async fn test_step_output_retrieval() {
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

  // Store multiple step outputs
  db.store_step_output(
    &exec_id,
    "step1",
    Some(serde_json::json!({"a": 1})),
    None,
    Some(true),
    None,
    None,
  )
  .await
  .expect("Failed to store step1");
  db.store_step_output(
    &exec_id,
    "step2",
    Some(serde_json::json!({"b": 2})),
    None,
    Some(true),
    None,
    None,
  )
  .await
  .expect("Failed to store step2");

  // Get all step outputs
  let all_outputs = db
    .get_all_step_outputs(&exec_id)
    .await
    .expect("Failed to get all step outputs");

  assert_eq!(all_outputs.len(), 2);
  assert_eq!(all_outputs[0].0, "step1");
  assert_eq!(all_outputs[1].0, "step2");
}
