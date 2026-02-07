// Library entry point for tests
pub mod api;
pub mod crypto;
pub mod db;

pub use db::Database;

pub struct AppState {
    pub db: Database,     // API handlers (short-lived requests)
    pub db_sse: Database, // SSE streaming + long-polling
    pub db_bg: Database,  // Background tasks
    pub local_mode: bool,
}
