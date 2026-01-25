// Library entry point for tests
pub mod api;
pub mod crypto;
pub mod db;

pub use db::Database;

pub struct AppState {
  pub db: Database,
  pub local_mode: bool,
}
