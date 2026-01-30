// Integration tests for executions database operations
use serde_json::json;
use uuid::Uuid;

use crate::common::{
    create_test_deployment, create_test_project, create_test_worker, create_test_workflow,
    setup_test_db,
};

#[tokio::test]
async fn test_cancel_execution_recursively_cancels_children() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    // Create test project, deployment, and workflow in database
    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");
    let deployment_id = create_test_deployment(&db, &project.id)
        .await
        .expect("Failed to create test deployment");
    let workflow_id = create_test_workflow(&db, &deployment_id, &project.id)
        .await
        .expect("Failed to create test workflow");

    // Create parent execution
    let (parent_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
            Some(3600),
        )
        .await
        .expect("Failed to create parent execution");

    // Create child execution
    let (child_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
            &deployment_id,
            Some(parent_id),
            Some(parent_id),
            None,
            workflow_id.clone(),
            None,
            false,
            None,
            None,
            None,
            &project.id,
            None,
            Some(3600),
        )
        .await
        .expect("Failed to create child execution");

    // Cancel parent execution
    let cancelled = db
        .cancel_execution(&parent_id, "test")
        .await
        .expect("Failed to cancel execution");

    // Verify both parent and child are in the cancelled list
    let cancelled_ids: Vec<Uuid> = cancelled.iter().map(|(id, _, _)| *id).collect();
    assert!(cancelled_ids.contains(&parent_id));
    assert!(cancelled_ids.contains(&child_id));

    // Verify statuses are set to pending_cancel
    let parent_exec = db
        .get_execution(&parent_id)
        .await
        .expect("Failed to get parent");
    assert_eq!(parent_exec.status, "pending_cancel");

    let child_exec = db
        .get_execution(&child_id)
        .await
        .expect("Failed to get child");
    assert_eq!(child_exec.status, "pending_cancel");
}

#[tokio::test]
async fn test_cancel_execution_recursively_cancels_parents() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    // Create test project, deployment, and workflow in database
    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");
    let deployment_id = create_test_deployment(&db, &project.id)
        .await
        .expect("Failed to create test deployment");
    let workflow_id = create_test_workflow(&db, &deployment_id, &project.id)
        .await
        .expect("Failed to create test workflow");

    // Create grandparent execution
    let (grandparent_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
            Some(3600),
        )
        .await
        .expect("Failed to create grandparent execution");

    // Create parent execution
    let (parent_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
            &deployment_id,
            Some(grandparent_id),
            Some(grandparent_id),
            None,
            workflow_id.clone(),
            None,
            false,
            None,
            None,
            None,
            &project.id,
            None,
            Some(3600),
        )
        .await
        .expect("Failed to create parent execution");

    // Create child execution
    let (child_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
            &deployment_id,
            Some(parent_id),
            Some(grandparent_id),
            None,
            workflow_id.clone(),
            None,
            false,
            None,
            None,
            None,
            &project.id,
            None,
            Some(3600),
        )
        .await
        .expect("Failed to create child execution");

    // Cancel child execution
    let cancelled = db
        .cancel_execution(&child_id, "test")
        .await
        .expect("Failed to cancel execution");

    // Verify all three are in the cancelled list
    let cancelled_ids: Vec<Uuid> = cancelled.iter().map(|(id, _, _)| *id).collect();
    assert!(cancelled_ids.contains(&grandparent_id));
    assert!(cancelled_ids.contains(&parent_id));
    assert!(cancelled_ids.contains(&child_id));

    // Verify all statuses are set to pending_cancel
    let grandparent_exec = db
        .get_execution(&grandparent_id)
        .await
        .expect("Failed to get grandparent");
    assert_eq!(grandparent_exec.status, "pending_cancel");

    let parent_exec = db
        .get_execution(&parent_id)
        .await
        .expect("Failed to get parent");
    assert_eq!(parent_exec.status, "pending_cancel");

    let child_exec = db
        .get_execution(&child_id)
        .await
        .expect("Failed to get child");
    assert_eq!(child_exec.status, "pending_cancel");
}

#[tokio::test]
async fn test_get_timed_out_executions() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    // Create test project, deployment, and workflow in database
    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");
    let deployment_id = create_test_deployment(&db, &project.id)
        .await
        .expect("Failed to create test deployment");
    let workflow_id = create_test_workflow(&db, &deployment_id, &project.id)
        .await
        .expect("Failed to create test workflow");

    // Create an execution with a short timeout
    let (exec_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
            Some(1), // 1 second timeout
        )
        .await
        .expect("Failed to create execution");

    // Create a test worker
    let worker_id = create_test_worker(&db, &project.id, Some(&deployment_id))
        .await
        .expect("Failed to create test worker");

    // Manually set status to running and started_at to past (simulating a timed-out execution)
    sqlx::query(
        "UPDATE workflow_executions 
         SET status = 'running', 
             started_at = NOW() - INTERVAL '2 seconds',
             assigned_to_worker = $1
         WHERE id = $2",
    )
    .bind(worker_id)
    .bind(exec_id)
    .execute(&db.pool)
    .await
    .expect("Failed to update execution");

    // Get timed out executions
    let timed_out = db
        .get_timed_out_executions(10)
        .await
        .expect("Failed to get timed out executions");

    // Verify the execution is in the list
    let timed_out_ids: Vec<Uuid> = timed_out.iter().map(|(id, _, _)| *id).collect();
    assert!(timed_out_ids.contains(&exec_id));
}

#[tokio::test]
async fn test_mark_execution_cancelled() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    // Create test project, deployment, and workflow in database
    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");
    let deployment_id = create_test_deployment(&db, &project.id)
        .await
        .expect("Failed to create test deployment");
    let workflow_id = create_test_workflow(&db, &deployment_id, &project.id)
        .await
        .expect("Failed to create test workflow");

    // Create and cancel an execution
    let (exec_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
            Some(3600),
        )
        .await
        .expect("Failed to create execution");

    // Cancel it
    db.cancel_execution(&exec_id, "test")
        .await
        .expect("Failed to cancel execution");

    // Mark as cancelled
    db.mark_execution_cancelled(&exec_id)
        .await
        .expect("Failed to mark execution as cancelled");

    // Verify status is cancelled
    let exec = db
        .get_execution(&exec_id)
        .await
        .expect("Failed to get execution");
    assert_eq!(exec.status, "cancelled");
}

#[tokio::test]
async fn test_create_execution() {
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

    let payload = json!({"key": "value"});
    let (exec_id, created_at) = db
        .create_execution(
            &workflow_id,
            payload.clone(),
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
            Some(3600),
        )
        .await
        .expect("Failed to create execution");

    // Verify execution was created
    let exec = db
        .get_execution(&exec_id)
        .await
        .expect("Failed to get execution");
    assert_eq!(exec.workflow_id, workflow_id);
    assert_eq!(exec.status, "queued");
    assert_eq!(exec.payload, payload);
    assert_eq!(exec.deployment_id, Some(deployment_id.clone()));
    assert_eq!(exec.run_timeout_seconds, Some(3600));
    assert!(exec.created_at <= created_at);
}

#[tokio::test]
async fn test_get_execution() {
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
            json!({"test": "data"}),
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

    let exec = db
        .get_execution(&exec_id)
        .await
        .expect("Failed to get execution");
    assert_eq!(exec.id, exec_id);
    assert_eq!(exec.workflow_id, workflow_id);
}

#[tokio::test]
async fn test_complete_execution() {
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
    let worker_id = create_test_worker(&db, &project.id, Some(&deployment_id))
        .await
        .expect("Failed to create test worker");

    let (exec_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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

    // Mark as running first
    db.mark_execution_running(&exec_id)
        .await
        .expect("Failed to mark execution as running");

    // Complete the execution
    let result = json!({"output": "success"});
    db.complete_execution(&exec_id, result.clone(), None, &worker_id, None)
        .await
        .expect("Failed to complete execution");

    // Verify execution is completed
    let exec = db
        .get_execution(&exec_id)
        .await
        .expect("Failed to get execution");
    assert_eq!(exec.status, "completed");
    assert_eq!(exec.result, Some(result));
    assert!(exec.completed_at.is_some());
}

#[tokio::test]
async fn test_fail_execution() {
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
    let worker_id = create_test_worker(&db, &project.id, Some(&deployment_id))
        .await
        .expect("Failed to create test worker");

    let (exec_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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

    // Claim and mark as running first (fail_execution requires execution to be claimed/running)
    // First, manually set status to claimed and assign to worker
    sqlx::query(
        "UPDATE workflow_executions SET status = 'claimed', assigned_to_worker = $1 WHERE id = $2",
    )
    .bind(worker_id)
    .bind(exec_id)
    .execute(&db.pool)
    .await
    .expect("Failed to claim execution");

    db.mark_execution_running(&exec_id)
        .await
        .expect("Failed to mark execution as running");

    // Fail the execution
    let error = "Test error";

    // Fail the execution with retry_count=3
    db.fail_execution(&exec_id, error, 3, &worker_id, None)
        .await
        .expect("Failed to fail execution");

    // Verify execution is queued again
    let exec = db
        .get_execution(&exec_id)
        .await
        .expect("Failed to get execution");
    assert_eq!(exec.status, "queued");
    assert!(exec.completed_at.is_none());

    // Fail the execution with retry_count=0
    db.fail_execution(&exec_id, error, 0, &worker_id, None)
        .await
        .expect("Failed to fail execution");

    // Verify execution is failed
    let exec = db
        .get_execution(&exec_id)
        .await
        .expect("Failed to get execution");
    assert_eq!(exec.status, "failed");
    assert_eq!(exec.error, Some(error.to_string()));
    assert!(exec.completed_at.is_some());
}

#[tokio::test]
async fn test_reset_execution_for_retry() {
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
    let worker_id = create_test_worker(&db, &project.id, Some(&deployment_id))
        .await
        .expect("Failed to create test worker");

    let (exec_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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

    // Mark as running and fail it
    db.mark_execution_running(&exec_id)
        .await
        .expect("Failed to mark execution as running");
    db.fail_execution(&exec_id, "Error", 3, &worker_id, None)
        .await
        .expect("Failed to fail execution");

    // Reset for retry
    db.reset_execution_for_retry(&exec_id)
        .await
        .expect("Failed to reset execution");

    // Verify execution is queued again
    let exec = db
        .get_execution(&exec_id)
        .await
        .expect("Failed to get execution");
    assert_eq!(exec.status, "queued");
    assert_eq!(exec.assigned_to_worker, None);
    assert_eq!(exec.error, None);
}

#[tokio::test]
async fn test_get_executions_by_project() {
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

    // Create multiple executions
    let (exec1_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
        .expect("Failed to create execution 1");

    let (exec2_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
        .expect("Failed to create execution 2");

    // Get executions by project
    let executions = db
        .get_executions_by_project(&project.id, "workflow", None, None, None, 100, 0)
        .await
        .expect("Failed to get executions");

    // Verify both executions are returned
    let exec_ids: Vec<Uuid> = executions.iter().map(|e| e.id).collect();
    assert!(exec_ids.contains(&exec1_id));
    assert!(exec_ids.contains(&exec2_id));
}

#[tokio::test]
async fn test_get_pending_cancel_executions() {
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
            json!({}),
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
            Some(3600),
        )
        .await
        .expect("Failed to create execution");

    // Cancel the execution
    let cancelled = db
        .cancel_execution(&exec_id, "test")
        .await
        .expect("Failed to cancel execution");

    // Verify execution is in the cancelled list returned by cancel_execution
    let cancelled_ids: Vec<Uuid> = cancelled.iter().map(|(id, _, _)| *id).collect();
    assert!(cancelled_ids.contains(&exec_id));

    // Also verify status is pending_cancel
    let exec = db
        .get_execution(&exec_id)
        .await
        .expect("Failed to get execution");
    assert_eq!(exec.status, "pending_cancel");
}

#[tokio::test]
async fn test_child_execution_creation_sets_parent_waiting() {
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

    // Create parent execution
    let (parent_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
        .expect("Failed to create parent execution");

    // Create child execution with wait_for_subworkflow=true
    let step_key = "child_step";
    let (_child_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
            &deployment_id,
            Some(parent_id),
            Some(parent_id),
            Some(step_key),
            workflow_id.clone(),
            None,
            true, // wait_for_subworkflow
            None,
            None,
            None,
            &project.id,
            None,
            None,
        )
        .await
        .expect("Failed to create child execution");

    // Verify parent status is "waiting"
    let parent_exec = db
        .get_execution(&parent_id)
        .await
        .expect("Failed to get parent execution");
    assert_eq!(parent_exec.status, "waiting");

    // Verify wait_steps row exists with execution_id=parent_id and wait_type="subworkflow"
    let wait_row = sqlx::query(
        "SELECT execution_id, step_key, wait_type FROM wait_steps WHERE execution_id = $1 AND step_key = $2"
    )
        .bind(parent_id)
        .bind(step_key)
        .fetch_optional(&db.pool)
        .await
        .expect("Failed to query wait_steps");

    assert!(wait_row.is_some());
    use sqlx::Row;
    let wait_row = wait_row.unwrap();
    assert_eq!(wait_row.get::<Uuid, _>("execution_id"), parent_id);
    assert_eq!(wait_row.get::<String, _>("step_key"), step_key);
    assert_eq!(
        wait_row.get::<Option<String>, _>("wait_type"),
        Some("subworkflow".to_string())
    );
}

#[tokio::test]
async fn test_child_execution_completion_resumes_parent() {
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
    let worker_id = create_test_worker(&db, &project.id, Some(&deployment_id))
        .await
        .expect("Failed to create test worker");

    // Create parent execution
    let (parent_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
        .expect("Failed to create parent execution");

    // Create child execution with wait_for_subworkflow=true
    let step_key = "child_step";
    let (child_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
            &deployment_id,
            Some(parent_id),
            Some(parent_id),
            Some(step_key),
            workflow_id.clone(),
            None,
            true, // wait_for_subworkflow
            None,
            None,
            None,
            &project.id,
            None,
            None,
        )
        .await
        .expect("Failed to create child execution");

    // Mark child as running
    db.mark_execution_running(&child_id)
        .await
        .expect("Failed to mark child as running");

    // Complete child execution
    let result = json!({"output": "success"});
    db.complete_execution(&child_id, result.clone(), None, &worker_id, None)
        .await
        .expect("Failed to complete child execution");

    // Verify parent status is "queued"
    let parent_exec = db
        .get_execution(&parent_id)
        .await
        .expect("Failed to get parent execution");
    assert_eq!(parent_exec.status, "queued");

    // Verify wait_steps row has wait_type=NULL
    use sqlx::Row;
    let wait_row =
        sqlx::query("SELECT wait_type FROM wait_steps WHERE execution_id = $1 AND step_key = $2")
            .bind(parent_id)
            .bind(step_key)
            .fetch_optional(&db.pool)
            .await
            .expect("Failed to query wait_steps");

    assert!(wait_row.is_some());
    let wait_row = wait_row.unwrap();
    assert_eq!(wait_row.get::<Option<String>, _>("wait_type"), None);

    // Verify execution_step_outputs row exists with execution_id=parent_id
    let step_output = db
        .get_step_output(&parent_id, step_key)
        .await
        .expect("Failed to get step output");

    assert!(step_output.is_some());
    let step_output = step_output.unwrap();
    assert_eq!(step_output["step_key"], step_key);
    assert_eq!(step_output["outputs"], result);
    assert_eq!(step_output["success"], true);
    // Verify source_execution_id is the child_id
    let source_exec_id: Uuid = serde_json::from_value(step_output["source_execution_id"].clone())
        .expect("Failed to parse source_execution_id");
    assert_eq!(source_exec_id, child_id);
}

#[tokio::test]
async fn test_child_execution_failure_resumes_parent() {
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
    let worker_id = create_test_worker(&db, &project.id, Some(&deployment_id))
        .await
        .expect("Failed to create test worker");

    // Create parent execution
    let (parent_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
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
        .expect("Failed to create parent execution");

    // Create child execution with wait_for_subworkflow=true
    let step_key = "child_step";
    let (child_id, _) = db
        .create_execution(
            &workflow_id,
            json!({}),
            &deployment_id,
            Some(parent_id),
            Some(parent_id),
            Some(step_key),
            workflow_id.clone(),
            None,
            true, // wait_for_subworkflow
            None,
            None,
            None,
            &project.id,
            None,
            None,
        )
        .await
        .expect("Failed to create child execution");

    // Mark child as running
    db.mark_execution_running(&child_id)
        .await
        .expect("Failed to mark child as running");

    // Fail child execution (with max_retries=0 so it doesn't retry)
    let error = "Child execution failed";
    db.fail_execution(&child_id, error, 0, &worker_id, None)
        .await
        .expect("Failed to fail child execution");

    // Verify parent status is "queued"
    let parent_exec = db
        .get_execution(&parent_id)
        .await
        .expect("Failed to get parent execution");
    assert_eq!(parent_exec.status, "queued");

    // Verify wait_steps row has wait_type=NULL
    use sqlx::Row;
    let wait_row =
        sqlx::query("SELECT wait_type FROM wait_steps WHERE execution_id = $1 AND step_key = $2")
            .bind(parent_id)
            .bind(step_key)
            .fetch_optional(&db.pool)
            .await
            .expect("Failed to query wait_steps");

    assert!(wait_row.is_some());
    let wait_row = wait_row.unwrap();
    assert_eq!(wait_row.get::<Option<String>, _>("wait_type"), None);

    // Verify execution_step_outputs row exists with execution_id=parent_id, success=false, and error
    let step_output = db
        .get_step_output(&parent_id, step_key)
        .await
        .expect("Failed to get step output");

    assert!(step_output.is_some());
    let step_output = step_output.unwrap();
    assert_eq!(step_output["step_key"], step_key);
    assert_eq!(step_output["success"], false);
    assert!(step_output["error"].is_object());
    // Verify source_execution_id is the child_id
    let source_exec_id: Uuid = serde_json::from_value(step_output["source_execution_id"].clone())
        .expect("Failed to parse source_execution_id");
    assert_eq!(source_exec_id, child_id);
}
