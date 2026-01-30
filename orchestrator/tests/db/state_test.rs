// Integration tests for state database operations
use crate::common::{create_test_deployment, create_test_project, setup_test_db};

#[tokio::test]
async fn test_conversation_history_storage() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");
    let deployment_id = create_test_deployment(&db, &project.id)
        .await
        .expect("Failed to create test deployment");

    let conversation_id = "test-conversation";
    let agent_id = "test-agent";

    // Add conversation history
    db.add_conversation_history(
        conversation_id,
        agent_id,
        "user",
        &serde_json::json!({"text": "Hello"}),
        None,
        None,
        &project.id,
        Some(&deployment_id),
    )
    .await
    .expect("Failed to add conversation history");

    // Retrieve conversation history
    let history = db
        .get_conversation_history(
            conversation_id,
            agent_id,
            &project.id,
            Some(&deployment_id),
            None,
        )
        .await
        .expect("Failed to get conversation history");

    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["role"], "user");
    assert_eq!(history[0]["content"]["text"], "Hello");
}

#[tokio::test]
async fn test_conversation_history_limit() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");
    let deployment_id = create_test_deployment(&db, &project.id)
        .await
        .expect("Failed to create test deployment");

    let conversation_id = "test-conversation-2";
    let agent_id = "test-agent";

    // Add 5 messages
    for i in 0..5 {
        db.add_conversation_history(
            conversation_id,
            agent_id,
            "user",
            &serde_json::json!({"text": format!("Message {}", i)}),
            None,
            Some(3), // Limit to 3
            &project.id,
            Some(&deployment_id),
        )
        .await
        .expect("Failed to add conversation history");
    }

    // Retrieve conversation history (should be limited to 3)
    let history = db
        .get_conversation_history(
            conversation_id,
            agent_id,
            &project.id,
            Some(&deployment_id),
            None,
        )
        .await
        .expect("Failed to get conversation history");

    // Should only have the last 3 messages
    assert_eq!(history.len(), 3);
    assert_eq!(history[0]["content"]["text"], "Message 2");
    assert_eq!(history[2]["content"]["text"], "Message 4");
}
