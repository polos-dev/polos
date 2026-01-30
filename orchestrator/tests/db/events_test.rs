// Integration tests for events database operations
use crate::common::{create_test_project, setup_test_db};

#[tokio::test]
async fn test_event_publishing() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");

    // Use unique topic name per test
    use uuid::Uuid;
    let topic_name = format!("test-topic-{}", Uuid::new_v4());

    // Publish events (topic will be created automatically)
    let events = vec![(
        Some("test.event".to_string()),
        serde_json::json!({"key": "value"}),
        None,
        1,
    )];
    let sequence_ids = db
        .publish_events_batch(topic_name.clone(), events, None, None, &project.id)
        .await
        .expect("Failed to publish events");

    assert_eq!(sequence_ids.len(), 1);
    assert!(sequence_ids[0] > 0);
}

#[tokio::test]
async fn test_create_or_get_event_topic() {
    let db = setup_test_db()
        .await
        .expect("Failed to setup test database");

    let project = create_test_project(&db)
        .await
        .expect("Failed to create test project");

    // Use unique topic name per test
    use uuid::Uuid;
    let topic_name = format!("test-topic-{}", Uuid::new_v4());

    // Create topic
    let topic_id1 = db
        .create_or_get_event_topic(&topic_name, &project.id)
        .await
        .expect("Failed to create event topic");

    // Get same topic (should return same ID)
    let topic_id2 = db
        .create_or_get_event_topic(&topic_name, &project.id)
        .await
        .expect("Failed to get event topic");

    assert_eq!(topic_id1, topic_id2);
}
