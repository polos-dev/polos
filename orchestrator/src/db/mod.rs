pub mod agents;
pub mod api_keys;
pub mod common;
pub mod deployments;
pub mod events;
pub mod executions;
pub mod models;
pub mod projects;
pub mod schedules;
pub mod state;
pub mod step_outputs;
pub mod tools;
pub mod traces;
pub mod users;
pub mod wait;
pub mod workers;
pub mod workflows;

pub use models::*;

use sqlx::PgPool;
use std::time::Instant;

#[derive(Clone)]
pub struct Database {
    pub pool: PgPool,
}

impl Database {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Log current pool metrics
    pub async fn log_pool_metrics(&self) {
        let size = self.pool.size();
        let num_idle = self.pool.num_idle();
        let active = size.saturating_sub(num_idle as u32);

        tracing::info!(
            pool_size = size,
            idle_connections = num_idle,
            active_connections = active,
            "Connection pool metrics"
        );
    }

    /// Sample connection acquisition time and log if slow
    pub async fn sample_connection_acquisition_time(&self) {
        let start = Instant::now();
        match self.pool.acquire().await {
            Ok(conn) => {
                let elapsed = start.elapsed();
                // Connection is automatically returned to pool when dropped
                drop(conn);

                if elapsed.as_millis() > 10 {
                    tracing::warn!(
                        acquisition_time_ms = elapsed.as_millis(),
                        "Slow connection acquisition detected"
                    );
                } else {
                    tracing::debug!(
                        acquisition_time_ms = elapsed.as_millis(),
                        "Connection acquisition time"
                    );
                }
            }
            Err(e) => {
                let elapsed = start.elapsed();
                tracing::error!(
                  acquisition_time_ms = elapsed.as_millis(),
                  error = %e,
                  "Failed to acquire connection"
                );
            }
        }
    }
}
