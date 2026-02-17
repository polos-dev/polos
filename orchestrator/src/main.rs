use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, post, put},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{prelude::*, EnvFilter};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod api;
mod crypto;
mod db;

pub use db::Database;

pub struct AppState {
    pub db: Database,     // API handlers (short-lived requests)
    pub db_sse: Database, // SSE streaming + long-polling
    pub db_bg: Database,  // Background tasks
    pub local_mode: bool,
}

/// Polos Orchestrator API
#[derive(OpenApi)]
#[openapi(
    info(
        title = "Polos Orchestrator API",
        version = "1.0.0",
        description = "API for the Polos durable execution platform for AI agents",
        contact(
            name = "Polos Team",
            url = "https://github.com/polos-dev/polos"
        )
    ),
    servers(
        (url = "/", description = "Current server")
    ),
    paths(
        // Health
        api::health::health,
        // Projects
        api::projects::handlers::create_project,
        api::projects::handlers::get_projects,
        api::projects::handlers::get_project_by_id,
        api::projects::handlers::get_project_members,
        // Agents
        api::agents::handlers::register_agent,
        api::agents::handlers::get_agents,
        api::agents::handlers::get_agent_definition,
        // Tools
        api::tools::handlers::register_tool,
        api::tools::handlers::get_tools,
        api::tools::handlers::get_tool_definition,
        // Workflows
        api::workflows::handlers::register_queues,
        api::workflows::handlers::get_workflows,
        api::workflows::handlers::get_workflow,
        api::workflows::handlers::get_workflow_runs,
        // Executions
        api::executions::handlers::submit_workflow,
        api::executions::handlers::submit_workflows,
        api::executions::handlers::get_execution,
        api::executions::handlers::cancel_execution,
        // Traces
        api::traces::handlers::get_traces,
        api::traces::handlers::get_trace_by_id,
        // Events
        api::events::handlers::publish_event,
        api::events::handlers::get_events,
        api::events::handlers::stream_events,
        api::events::handlers::register_event_trigger,
        // Schedules
        api::schedules::handlers::create_schedule,
        api::schedules::handlers::get_schedules_for_workflow,
        api::schedules::handlers::get_scheduled_workflows,
        // Workers
        api::workers::handlers::register_worker,
        api::workers::handlers::register_worker_deployment,
        api::workers::handlers::get_worker_status,
        // Deployments
        api::deployments::handlers::register_deployment_workflow,
        api::deployments::handlers::get_deployment,
    ),
    components(
        schemas(
            // Common
            api::common::ErrorResponse,
            // Health
            api::health::HealthResponse,
            // Projects
            api::projects::handlers::CreateProjectRequest,
            api::projects::handlers::ProjectResponse,
            api::projects::handlers::ProjectsResponse,
            api::projects::handlers::ProjectMemberResponse,
            api::projects::handlers::UserInfo,
            // Agents
            api::agents::handlers::RegisterAgentRequest,
            api::agents::handlers::RegisterAgentResponse,
            // Tools
            api::tools::handlers::RegisterToolRequest,
            api::tools::handlers::RegisterToolResponse,
            // Workflows
            api::workflows::handlers::RegisterQueuesRequest,
            api::workflows::handlers::QueueInfo,
            api::workflows::handlers::WorkflowRunSummary,
            // Executions
            api::executions::handlers::SubmitWorkflowRequest,
            api::executions::handlers::SubmitWorkflowResponse,
            api::executions::handlers::SubmitWorkflowsRequest,
            api::executions::handlers::WorkflowRequest,
            api::executions::handlers::SubmitWorkflowsResponse,
            api::executions::handlers::ExecutionResponse,
            api::executions::handlers::CancelExecutionResponse,
            // Events
            api::events::handlers::EventData,
            api::events::handlers::PublishEventRequest,
            api::events::handlers::PublishEventResponse,
            api::events::handlers::EventResponse,
            api::events::handlers::GetEventsResponse,
            api::events::handlers::RegisterEventTriggerRequest,
            // Schedules
            api::schedules::handlers::CreateScheduleRequest,
            api::schedules::handlers::CreateScheduleResponse,
            api::schedules::handlers::ScheduleResponse,
            api::schedules::handlers::GetSchedulesResponse,
            api::schedules::handlers::GetScheduledWorkflowsResponse,
            // Workers
            api::workers::handlers::RegisterWorkerRequest,
            api::workers::handlers::RegisterWorkerDeploymentRequest,
            api::workers::handlers::RegisterWorkerResponse,
            api::workers::handlers::WorkerStatusResponse,
            // Deployments
            api::deployments::handlers::RegisterDeploymentWorkflowRequest,
        )
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "Health", description = "Health check endpoints"),
        (name = "Projects", description = "Project management endpoints"),
        (name = "Agents", description = "Agent definition management"),
        (name = "Tools", description = "Tool definition management"),
        (name = "Workflows", description = "Workflow management"),
        (name = "Executions", description = "Workflow execution management"),
        (name = "Traces", description = "Observability traces"),
        (name = "Events", description = "Event publishing and streaming"),
        (name = "Event Triggers", description = "Event-based workflow triggers"),
        (name = "Schedules", description = "Scheduled workflow execution"),
        (name = "Workers", description = "Worker registration and management"),
        (name = "Deployments", description = "Deployment management"),
    )
)]
struct ApiDoc;

struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::Http::new(
                        utoipa::openapi::security::HttpAuthScheme::Bearer,
                    ),
                ),
            );
            components.add_security_scheme(
                "cookie_auth",
                utoipa::openapi::security::SecurityScheme::ApiKey(
                    utoipa::openapi::security::ApiKey::Cookie(
                        utoipa::openapi::security::ApiKeyValue::new("polos_auth"),
                    ),
                ),
            );
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables from .env file if it exists
    dotenv::dotenv().ok();

    // Check if dev mode is enabled
    let dev_mode = std::env::var("POLOS_DEV_MODE")
        .unwrap_or_else(|_| "false".to_string())
        .to_lowercase()
        == "true";

    // Initialize tracing subscriber
    // Always use fmt subscriber for logs, optionally add console subscriber in dev mode
    if dev_mode {
        let console_layer = console_subscriber::ConsoleLayer::builder()
            .server_addr(([127, 0, 0, 1], 6669)) // Default tokio-console port
            .spawn();

        // build a `Subscriber` by combining layers with a
        // `tracing_subscriber::Registry`:
        tracing_subscriber::registry()
            .with(tracing_subscriber::fmt::layer())
            .with(console_layer)
            .init();

        tracing::info!("Tokio console enabled (connect with: tokio-console)");
    } else {
        // In production: use fmt subscriber with stdout and env filter
        tracing_subscriber::fmt()
            .with_env_filter(
                EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()),
            )
            .init();
    }

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost/polos".to_string());

    // Pool sizes configurable via env vars
    let pool_api_max: u32 = std::env::var("DB_POOL_API_MAX")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);
    let pool_sse_max: u32 = std::env::var("DB_POOL_SSE_MAX")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(15);
    let pool_bg_max: u32 = std::env::var("DB_POOL_BG_MAX")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);

    let pool_api = PgPoolOptions::new()
        .max_connections(pool_api_max)
        .min_connections(2)
        .connect(&database_url)
        .await?;

    let pool_sse = PgPoolOptions::new()
        .max_connections(pool_sse_max)
        .min_connections(2)
        .connect(&database_url)
        .await?;

    let pool_bg = PgPoolOptions::new()
        .max_connections(pool_bg_max)
        .min_connections(2)
        .connect(&database_url)
        .await?;

    tracing::info!(
        api_max = pool_api_max,
        sse_max = pool_sse_max,
        bg_max = pool_bg_max,
        "Connected to database with 3 connection pools"
    );

    // Run migrations on the API pool only (migrations only need to run once)
    sqlx::migrate!("./migrations").run(&pool_api).await?;
    tracing::info!("Migrations complete");

    let db = Database::new(pool_api);
    let db_sse = Database::new(pool_sse);
    let db_bg = Database::new(pool_bg);

    // Check if local mode can be enabled (only allowed for localhost bind addresses)
    let bind_address =
        std::env::var("POLOS_BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:8080".to_string());

    let local_mode_requested = std::env::var("POLOS_LOCAL_MODE")
        .unwrap_or_else(|_| "False".to_string())
        .to_lowercase()
        == "true";

    let is_localhost = bind_address.starts_with("127.0.0.1")
        || bind_address.starts_with("localhost")
        || bind_address.starts_with("[::1]");

    let local_mode = local_mode_requested && is_localhost;

    if local_mode_requested && !is_localhost {
        tracing::warn!(
            "POLOS_LOCAL_MODE=True ignored because bind address ({}) is not localhost.",
            bind_address
        );
    }

    if local_mode {
        tracing::info!("Local mode enabled");
    }

    let state = Arc::new(AppState {
        db,
        db_sse,
        db_bg,
        local_mode,
    });

    // Background task to log connection pool metrics and sample acquisition time (dev mode only)
    if dev_mode {
        let pool_metrics_state = state.clone();
        tokio::task::Builder::new()
            .name("connection-pool-metrics")
            .spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

                    // Log pool metrics for all pools
                    pool_metrics_state.db.log_pool_metrics("api").await;
                    pool_metrics_state.db_sse.log_pool_metrics("sse").await;
                    pool_metrics_state.db_bg.log_pool_metrics("bg").await;

                    // Sample connection acquisition time
                    pool_metrics_state
                        .db
                        .sample_connection_acquisition_time()
                        .await;
                }
            })
            .expect("Failed to spawn connection-pool-metrics task");
    }

    // Background task to clean up stale workers and their executions
    let cleanup_state = state.clone();
    tokio::task::Builder::new()
    .name("cleanup-stale-workers")
    .spawn(async move {
      loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        match cleanup_state.db_bg.cleanup_stale_workers().await {
          Ok((stale_claimed, deleted_workers, marked_offline_workers, orphaned_executions)) => {
            if stale_claimed > 0 || marked_offline_workers > 0 || deleted_workers > 0 || orphaned_executions > 0 {
              tracing::info!(
                "Cleaned up stale workers: {} stale claimed executions reset, {} workers deleted, {} workers marked offline, {} orphaned executions reset",
                stale_claimed, deleted_workers, marked_offline_workers, orphaned_executions
              );
            }
          }
          Err(e) => {
            tracing::error!("Failed to cleanup stale workers: {}", e);
          }
        }
      }
    })
    .expect("Failed to spawn cleanup-stale-workers task");

    // Background task to clean up old executions
    let execution_cleanup_state = state.clone();
    let retention_days = std::env::var("EXECUTION_RETENTION_DAYS")
        .ok()
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(7);
    tokio::task::Builder::new()
        .name("cleanup-old-executions")
        .spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await; // Run every hour
                match execution_cleanup_state
                    .db_bg
                    .cleanup_old_executions(retention_days)
                    .await
                {
                    Ok(count) => {
                        if count > 0 {
                            tracing::info!("Cleaned up {} old executions", count);
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to clean up old executions: {}", e);
                    }
                }
            }
        })
        .expect("Failed to spawn cleanup-old-executions task");

    // Background task to resume expired waits
    // Processes one wait at a time using SELECT FOR UPDATE SKIP LOCKED
    // This allows multiple orchestrators to work in parallel
    let wait_resume_state = state.clone();
    tokio::task::Builder::new()
        .name("resume-expired-waits")
        .spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await; // Check every 5 seconds
                let mut processed_count = 0;

                // Process expired waits one at a time until none remain
                loop {
                    match wait_resume_state.db_bg.get_and_resume_expired_wait().await {
                        Ok(Some(expired_wait)) => {
                            tracing::info!(
                                "Resumed execution {}: {} from expired wait",
                                expired_wait.execution_id,
                                expired_wait.step_key
                            );
                            // Continue to process more expired waits
                        }
                        Ok(None) => {
                            // No more expired waits, break inner loop and wait before next check
                            break;
                        }
                        Err(e) => {
                            tracing::error!("Failed to get and resume expired wait: {}", e);
                            break; // Break on error, will retry on next iteration
                        }
                    }
                }
                processed_count += 1;
                // Small delay every 10 items
                if processed_count % 10 == 0 {
                    tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
                }
            }
        })
        .expect("Failed to spawn resume-expired-waits task");

    // Background task to process event triggers
    // Processes one trigger at a time using SELECT FOR UPDATE SKIP LOCKED
    // This allows multiple orchestrators to work in parallel
    let trigger_state = state.clone();
    tokio::task::Builder::new()
        .name("process-event-triggers")
        .spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await; // Check every 2 seconds
                let mut processed_count = 0;

                // Process event triggers one at a time until none remain
                loop {
                    match trigger_state.db_bg.process_one_event_trigger().await {
                        Ok(Some(count)) => {
                            if count > 0 {
                                tracing::info!("Processed {} event trigger(s)", count);
                            }
                            // Continue to process more triggers
                        }
                        Ok(None) => {
                            // No more triggers to process, break inner loop and wait before next check
                            break;
                        }
                        Err(e) => {
                            tracing::error!("Failed to process event trigger: {}", e);
                            break; // Break on error, will retry on next iteration
                        }
                    };
                    processed_count += 1;
                    // Small delay every 10 items
                    if processed_count % 10 == 0 {
                        tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
                    }
                }
            }
        })
        .expect("Failed to spawn process-event-triggers task");

    // Background task to check for workflows waiting on events and resume them
    // Processes one wait at a time using SELECT FOR UPDATE SKIP LOCKED
    // This allows multiple orchestrators to work in parallel
    // This is a fallback mechanism to catch any workflows that may have been missed during event publishing
    let event_wait_state = state.clone();
    tokio::task::Builder::new()
        .name("resume-event-waits")
        .spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await; // Check every 2 seconds
                let mut processed_count = 0;

                // Process event waits one at a time until none remain
                loop {
                    match event_wait_state
                        .db_bg
                        .check_and_resume_one_event_wait()
                        .await
                    {
                        Ok(Some(count)) => {
                            if count > 0 {
                                tracing::info!("Resumed 1 execution waiting on event");
                            }
                            // Continue to process more event waits
                        }
                        Ok(None) => {
                            // No more event waits to process, break inner loop and wait before next check
                            break;
                        }
                        Err(e) => {
                            tracing::error!("Failed to check and resume event wait: {}", e);
                            break; // Break on error, will retry on next iteration
                        }
                    };
                    processed_count += 1;
                    // Small delay every 10 items
                    if processed_count % 10 == 0 {
                        tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
                    }
                }
            }
        })
        .expect("Failed to spawn resume-event-waits task");

    // Background task to process scheduled workflows
    // Processes one schedule at a time using SELECT FOR UPDATE SKIP LOCKED
    // This allows multiple orchestrators to work in parallel
    let schedule_state = state.clone();
    tokio::task::Builder::new()
        .name("process-scheduled-workflows")
        .spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await; // Check every 5 seconds
                let mut processed_count = 0;

                // Process scheduled workflows one at a time until none remain
                loop {
                    match schedule_state.db_bg.process_one_scheduled_workflow().await {
                        Ok(Some(count)) => {
                            if count > 0 {
                                tracing::info!("Processed 1 scheduled workflow");
                            }
                            // Continue to process more scheduled workflows
                        }
                        Ok(None) => {
                            // No more scheduled workflows to process, break inner loop and wait before next check
                            break;
                        }
                        Err(e) => {
                            tracing::error!("Failed to process scheduled workflow: {}", e);
                            break; // Break on error, will retry on next iteration
                        }
                    }
                    processed_count += 1;
                    // Small delay every 10 items
                    if processed_count % 10 == 0 {
                        tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
                    }
                }
            }
        })
        .expect("Failed to spawn process-scheduled-workflows task");

    // Background task to dispatch work to push-based workers
    let dispatcher_state = state.clone();
    tokio::task::Builder::new()
        .name("dispatch-executions")
        .spawn(async move {
            loop {
                // Try to dispatch all available executions
                if let Err(e) = api::workers::try_dispatch_execution(&dispatcher_state).await {
                    tracing::error!("Failed to dispatch executions: {}", e);
                }

                // Sleep 200ms before next iteration
                tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            }
        })
        .expect("Failed to spawn dispatch-executions task");

    // Background task to monitor and cancel timed-out executions
    let timeout_monitor_state = state.clone();
    tokio::task::Builder::new()
    .name("monitor-execution-timeouts")
    .spawn(async move {
      loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await; // Check every 30 seconds
        let mut processed_count = 0;
        // Process timed-out executions one at a time
        loop {
          match timeout_monitor_state.db_bg.get_timed_out_executions(10).await {
            Ok(timed_out_executions) => {
              if timed_out_executions.is_empty() {
                break; // No more timed-out executions
              }
              for (execution_id, _assigned_to_worker, _push_endpoint_url) in timed_out_executions {
                // Cancel the execution (recursively cancels all children)
                match timeout_monitor_state.db_bg.cancel_execution(&execution_id, "timeout").await {
                  Ok(executions_to_cancel) => {
                    tracing::info!("Cancelled timed-out execution: {} (and {} children)", execution_id, executions_to_cancel.len().saturating_sub(1));
                    // Send cancel requests to all workers for all executions being cancelled
                    for (exec_id, worker_id_opt, push_endpoint_url_opt) in executions_to_cancel {
                      if let (Some(worker_id), Some(endpoint)) = (worker_id_opt, push_endpoint_url_opt) {
                        let exec_id_clone = exec_id;
                        let timeout_state_clone = timeout_monitor_state.clone();
                        tokio::spawn(async move {
                          match api::workers::send_cancel_request_to_worker(&endpoint, &worker_id, &exec_id_clone).await {
                            api::workers::CancelRequestResult::Success => {
                              tracing::info!("Cancel request sent to worker {} for timed-out execution {}", worker_id, exec_id_clone);
                            }
                            api::workers::CancelRequestResult::NotFound => {
                              // Execution not found on worker - mark as cancelled
                              tracing::info!("Timed-out execution {} not found on worker {} - marking as cancelled", exec_id_clone, worker_id);
                              if let Err(e) = timeout_state_clone.db_bg.mark_execution_cancelled(&exec_id_clone).await {
                                tracing::error!("Failed to mark timed-out execution {} as cancelled (not found): {}", exec_id_clone, e);
                              }
                            }
                            api::workers::CancelRequestResult::Error(e) => {
                              tracing::warn!("Failed to send cancel request to worker {} for timed-out execution {}: {:?}", worker_id, exec_id_clone, e);
                            }
                          }
                        });
                      }
                    }
                  }
                  Err(e) => {
                    tracing::error!("Failed to cancel timed-out execution {}: {}", execution_id, e);
                  }
                }
              }
            }
            Err(e) => {
              tracing::error!("Failed to get timed-out executions: {}", e);
              break; // Break on error, will retry on next iteration
            }
          }
          processed_count += 1;
          // Small delay every 10 items
          if processed_count % 10 == 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
          }
        }
      }
    })
    .expect("Failed to spawn monitor-execution-timeouts task");

    // Background task to process pending_cancel executions and contact workers
    let pending_cancel_state = state.clone();
    tokio::task::Builder::new()
        .name("process-pending-cancellations")
        .spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await; // Check every 5 seconds
                let mut processed_count = 0;

                // Process pending_cancel executions
                loop {
                    match pending_cancel_state
                        .db_bg
                        .get_pending_cancel_executions(10)
                        .await
                    {
                        Ok(pending_executions) => {
                            if pending_executions.is_empty() {
                                break; // No more pending cancellations
                            }

                            for (
                                execution_id,
                                assigned_to_worker,
                                push_endpoint_url,
                                cancelled_at,
                            ) in pending_executions
                            {
                                // Check if cancelled_at is more than 2 minutes ago
                                let should_directly_cancel = if let Some(cancelled_at_time) =
                                    cancelled_at
                                {
                                    let now = chrono::Utc::now();
                                    let time_since_cancelled = now - cancelled_at_time;
                                    time_since_cancelled.num_seconds() > 120 // 2 minutes = 120 seconds
                                } else {
                                    false
                                };

                                if should_directly_cancel {
                                    // Cancelled more than 2 minutes ago - directly mark as cancelled
                                    if let Err(e) = pending_cancel_state
                                        .db_bg
                                        .mark_execution_cancelled(&execution_id)
                                        .await
                                    {
                                        tracing::error!(
                      "Failed to mark execution {} as cancelled (timeout): {}",
                      execution_id,
                      e
                    );
                                    } else {
                                        tracing::info!(
                      "Marked execution {} as cancelled (cancelled_at > 2 minutes ago)",
                      execution_id
                    );
                                    }
                                } else if let (Some(worker_id), Some(endpoint)) =
                                    (assigned_to_worker, push_endpoint_url)
                                {
                                    // Execution is assigned to a worker - send cancel request (await directly)
                                    match api::workers::send_cancel_request_to_worker(
                                        &endpoint,
                                        &worker_id,
                                        &execution_id,
                                    )
                                    .await
                                    {
                                        api::workers::CancelRequestResult::Success => {
                                            // Cancel request sent successfully - worker will handle it
                                            tracing::info!(
                                                "Cancel request sent to worker {} for execution {}",
                                                worker_id,
                                                execution_id
                                            );
                                        }
                                        api::workers::CancelRequestResult::NotFound => {
                                            // Execution not found on worker - mark as cancelled
                                            tracing::info!(
                        "Execution {} not found on worker {} - marking as cancelled",
                        execution_id,
                        worker_id
                      );
                                            if let Err(e) = pending_cancel_state
                                                .db_bg
                                                .mark_execution_cancelled(&execution_id)
                                                .await
                                            {
                                                tracing::error!(
                          "Failed to mark execution {} as cancelled (not found): {}",
                          execution_id,
                          e
                        );
                                            }
                                        }
                                        api::workers::CancelRequestResult::Error(
                                            api::workers::PushError::Network(_),
                                        ) => {
                                            // Connection refused or network error - worker is likely down
                                            // Mark execution as cancelled directly since we can't reach the worker
                                            tracing::warn!(
                        "Cannot reach worker {} at {} for execution {} - marking as cancelled",
                        worker_id,
                        endpoint,
                        execution_id
                      );
                                            if let Err(e) = pending_cancel_state
                                                .db_bg
                                                .mark_execution_cancelled(&execution_id)
                                                .await
                                            {
                                                tracing::error!(
                          "Failed to mark execution {} as cancelled after connection error: {}",
                          execution_id,
                          e
                        );
                                            }
                                        }
                                        api::workers::CancelRequestResult::Error(e) => {
                                            tracing::warn!(
                        "Failed to send cancel request to worker {} for execution {}: {:?}",
                        worker_id,
                        execution_id,
                        e
                      );
                                        }
                                    }
                                } else {
                                    // No worker assigned - directly mark as cancelled
                                    if let Err(e) = pending_cancel_state
                                        .db_bg
                                        .mark_execution_cancelled(&execution_id)
                                        .await
                                    {
                                        tracing::error!(
                                            "Failed to mark execution {} as cancelled: {}",
                                            execution_id,
                                            e
                                        );
                                    } else {
                                        tracing::info!(
                                            "Marked execution {} as cancelled (no worker assigned)",
                                            execution_id
                                        );
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("Failed to get pending_cancel executions: {}", e);
                            break; // Break on error, will retry on next iteration
                        }
                    }
                    processed_count += 1;
                    // Small delay every 10 items
                    if processed_count % 10 == 0 {
                        tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
                    }
                }
            }
        })
        .expect("Failed to spawn process-pending-cancellations task");

    let app = Router::new()
        // OpenAPI documentation
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/health", get(api::health))
        // Auth endpoints
        .route("/api/v1/auth/signup", post(api::auth::signup))
        .route("/api/v1/auth/signin", post(api::auth::signin))
        .route("/api/v1/auth/signout", post(api::auth::signout))
        .route("/api/v1/auth/me", get(api::auth::me))
        .route("/api/v1/auth/me", put(api::auth::update_user))
        .route("/api/v1/auth/oauth-signin", post(api::auth::oauth_signin))
        // Project endpoints
        .route("/api/v1/projects", post(api::projects::create_project))
        .route("/api/v1/projects", get(api::projects::get_projects))
        .route(
            "/api/v1/projects/:project_id",
            get(api::projects::get_project_by_id),
        )
        .route(
            "/api/v1/projects/:project_id/members",
            get(api::projects::get_project_members),
        )
        // API Key endpoints
        .route(
            "/api/v1/api-keys/project/:project_id",
            get(api::api_keys::list_api_keys),
        )
        .route("/api/v1/api-keys", post(api::api_keys::create_api_key))
        .route(
            "/api/v1/api-keys/:key_id",
            delete(api::api_keys::delete_api_key),
        )
        .route(
            "/api/v1/workflows/:workflow_id/run",
            post(api::executions::submit_workflow),
        )
        .route(
            "/api/v1/workflows/batch_run",
            post(api::executions::submit_workflows),
        )
        .route(
            "/api/v1/executions/:execution_id",
            get(api::executions::get_execution),
        )
        .route(
            "/api/v1/executions/:execution_id/cancel",
            post(api::executions::cancel_execution),
        )
        .route(
            "/internal/executions/:execution_id/confirm-cancellation",
            post(api::executions::confirm_cancellation),
        )
        .route(
            "/api/v1/deployments/:deployment_id",
            get(api::deployments::get_deployment),
        )
        // Worker endpoints
        .route(
            "/api/v1/workers/status",
            get(api::workers::get_worker_status),
        )
        .route(
            "/api/v1/workers/register",
            post(api::workers::register_worker),
        )
        .route(
            "/api/v1/workers/deployments",
            post(api::workers::register_worker_deployment),
        )
        .route(
            "/api/v1/workers/deployments/:deployment_id/workflows",
            post(api::deployments::register_deployment_workflow),
        )
        .route(
            "/api/v1/workers/queues",
            post(api::workflows::register_queues),
        )
        .route(
            "/api/v1/workers/:worker_id/poll",
            get(api::workers::poll_workflow),
        )
        .route(
            "/api/v1/workers/:worker_id/heartbeat",
            post(api::workers::worker_heartbeat),
        )
        .route(
            "/api/v1/workers/:worker_id/online",
            post(api::workers::mark_worker_online),
        )
        // Execution endpoints
        .route(
            "/internal/executions/:execution_id/wait",
            post(api::executions::set_waiting),
        )
        .route(
            "/internal/executions/:execution_id/otel-span-id",
            put(api::executions::update_execution_otel_span_id),
        )
        .route(
            "/internal/executions/:execution_id/complete",
            post(api::executions::complete_execution),
        )
        .route(
            "/internal/executions/:execution_id/fail",
            post(api::executions::fail_execution),
        )
        // Step endpoints
        .route(
            "/internal/executions/:execution_id/steps",
            post(api::executions::store_step_output),
        )
        .route(
            "/internal/executions/:execution_id/steps",
            get(api::executions::get_all_step_outputs),
        )
        .route(
            "/internal/executions/:execution_id/steps/:step_key",
            get(api::executions::get_step_output),
        )
        .route(
            "/internal/spans/batch",
            post(api::traces::store_spans_batch),
        )
        .route("/api/v1/traces", get(api::traces::get_traces))
        .route(
            "/api/v1/traces/:trace_id",
            get(api::traces::get_trace_by_id),
        )
        // Event system endpoints
        .route("/api/v1/events/publish", post(api::events::publish_event))
        .route("/api/v1/events", get(api::events::get_events))
        .route("/api/v1/events/stream", get(api::events::stream_events))
        // Agent definition endpoints
        .route("/api/v1/agents", get(api::agents::get_agents))
        .route("/api/v1/agents/register", post(api::agents::register_agent))
        .route(
            "/api/v1/agents/:agent_id",
            get(api::agents::get_agent_definition),
        )
        // Workflow endpoints
        .route("/api/v1/workflows", get(api::workflows::get_workflows))
        .route(
            "/api/v1/workflows/:workflow_id",
            get(api::workflows::get_workflow),
        )
        .route(
            "/api/v1/workflows/runs",
            get(api::workflows::get_workflow_runs),
        )
        // Tool endpoints
        .route("/api/v1/tools", get(api::tools::get_tools))
        // Tool definition endpoints
        .route("/api/v1/tools/register", post(api::tools::register_tool))
        .route(
            "/api/v1/tools/:tool_id",
            get(api::tools::get_tool_definition),
        )
        // Event trigger endpoints
        .route(
            "/api/v1/event-triggers/register",
            post(api::events::register_event_trigger),
        )
        // Schedule endpoints
        .route("/api/v1/schedules", post(api::schedules::create_schedule))
        .route(
            "/api/v1/schedules/workflows/:workflow_id",
            get(api::schedules::get_schedules_for_workflow),
        )
        .route(
            "/api/v1/schedules/workflows",
            get(api::schedules::get_scheduled_workflows),
        )
        // State management endpoints
        .route(
            "/internal/conversation/:conversation_id/add",
            post(api::state::add_conversation_history),
        )
        .route(
            "/api/v1/conversation/:conversation_id/get",
            get(api::state::get_conversation_history),
        )
        // Session memory endpoints
        .route(
            "/internal/session/:session_id/memory",
            get(api::state::get_session_memory).put(api::state::put_session_memory),
        )
        // Approval endpoints
        .route(
            "/api/v1/approvals/:execution_id/:step_key",
            get(api::approvals::get_approval),
        )
        .route(
            "/api/v1/approvals/:execution_id/:step_key/submit",
            post(api::approvals::submit_approval),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            api::auth::middleware::authenticate_api_v1_middleware,
        ))
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100MB
        .layer({
            let cors_layer = CorsLayer::new()
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::HeaderName::from_static("x-project-id"),
                    axum::http::header::HeaderName::from_static("project-id"),
                    axum::http::header::HeaderName::from_static("x-is-admin"),
                    axum::http::header::HeaderName::from_static("is-admin"),
                ])
                .allow_credentials(true)
                .expose_headers([axum::http::header::CONTENT_TYPE]);

            // In local mode, allow both localhost and 127.0.0.1 variants
            let local_mode = std::env::var("POLOS_LOCAL_MODE")
                .map(|v| v.to_lowercase() == "true")
                .unwrap_or(false);

            if local_mode {
                // Extract port from CORS_ORIGIN or use default
                let cors_origin = std::env::var("CORS_ORIGIN")
                    .unwrap_or_else(|_| "http://localhost:5173".to_string());
                let port = cors_origin
                    .rsplit(':')
                    .next()
                    .and_then(|p| p.parse::<u16>().ok())
                    .unwrap_or(5173);

                // Allow both localhost and 127.0.0.1
                let origins = [
                    format!("http://localhost:{}", port).parse().unwrap(),
                    format!("http://127.0.0.1:{}", port).parse().unwrap(),
                ];
                cors_layer.allow_origin(tower_http::cors::AllowOrigin::list(origins))
            } else {
                // Production: use exact origin from CORS_ORIGIN env var
                let cors_origin = std::env::var("CORS_ORIGIN")
                    .unwrap_or_else(|_| "http://localhost:5173".to_string());
                let origin_value: axum::http::HeaderValue = cors_origin
                    .parse()
                    .unwrap_or_else(|_| "http://localhost:5173".parse().unwrap());
                cors_layer.allow_origin(tower_http::cors::AllowOrigin::exact(origin_value))
            }
        })
        .with_state(state);

    let bind_address =
        std::env::var("POLOS_BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let listener = tokio::net::TcpListener::bind(&bind_address).await?;
    tracing::info!("Orchestrator listening on {}", listener.local_addr()?);

    axum::serve(listener, app).await?;

    Ok(())
}
