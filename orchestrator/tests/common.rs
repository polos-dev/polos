// Common test utilities and helpers
use sqlx::PgPool;
use uuid::Uuid;

use polos_orchestrator::{db::models::Project, Database};

/// Setup test database using TEST_DATABASE_URL from environment
///
/// This function reads TEST_DATABASE_URL from environment variables (via .env file or env vars).
/// It creates a connection pool and runs migrations.
///
/// **Test Isolation**: Tests are isolated by using unique UUIDs for all test data (projects, deployments, etc.)
pub async fn setup_test_db() -> anyhow::Result<Database> {
  // Load environment variables from .env file if it exists
  dotenv::dotenv().ok();

  // Get TEST_DATABASE_URL from environment
  let database_url =
    std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL must be set for tests");

  use sqlx::postgres::PgPoolOptions;
  let pool = PgPoolOptions::new()
    .max_connections(20)
    .connect(&database_url)
    .await?;

  sqlx::migrate!("./migrations").run(&pool).await?;

  Ok(Database::new(pool))
}

/// Create a Database instance from a PgPool
/// Used with sqlx::test which provides the pool
pub fn create_db_from_pool(pool: PgPool) -> Database {
  Database::new(pool)
}

/// Create a test project in the database
pub async fn create_test_project(db: &Database) -> anyhow::Result<Project> {
  let project_name = format!("test-project-{}", Uuid::new_v4());
  db.create_project(&project_name, Some("Test project")).await
}

/// Create a test deployment in the database
pub async fn create_test_deployment(db: &Database, project_id: &Uuid) -> anyhow::Result<String> {
  let deployment_id = format!("test-deployment-{}", Uuid::new_v4());
  db.create_deployment(&deployment_id, project_id).await?;
  Ok(deployment_id)
}

/// Create a test workflow in the database
/// Registers the workflow in deployment_workflows table
pub async fn create_test_workflow(
  db: &Database,
  deployment_id: &str,
  project_id: &Uuid,
) -> anyhow::Result<String> {
  let workflow_id = format!("test-workflow-{}", Uuid::new_v4());
  // register_deployment_workflow_with_type is in the Database impl
  db.register_deployment_workflow_with_type(
    deployment_id,
    &workflow_id,
    "workflow",
    false, // not event-triggered
    false, // not scheduled
    project_id,
  )
  .await?;
  Ok(workflow_id)
}

/// Create a test worker in the database
pub async fn create_test_worker(
  db: &Database,
  project_id: &Uuid,
  deployment_id: Option<&str>,
) -> anyhow::Result<Uuid> {
  let worker_id = Uuid::new_v4();
  db.register_worker(
    &worker_id,
    project_id,
    None,                          // capabilities
    Some("push"),                  // mode
    Some("http://localhost:8000"), // push_endpoint_url
    Some(100),                     // max_concurrent_executions
    deployment_id,                 // current_deployment_id
  )
  .await?;
  Ok(worker_id)
}

/// Helper to set project_id in a transaction (for RLS)
pub async fn set_project_id_in_tx(pool: &PgPool, project_id: &Uuid) -> Result<(), sqlx::Error> {
  sqlx::query(&format!("SET LOCAL app.project_id = '{}'", project_id))
    .execute(pool)
    .await?;
  Ok(())
}

/// Helper to set admin mode in a transaction
pub async fn set_admin_mode_in_tx(pool: &PgPool) -> Result<(), sqlx::Error> {
  sqlx::query("SET LOCAL app.is_admin = 'true'")
    .execute(pool)
    .await?;
  Ok(())
}
