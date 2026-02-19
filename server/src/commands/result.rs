use anyhow::Result;
use colored::Colorize;
use tokio::time::{Duration, Instant};

use crate::client;

pub async fn run(execution_id: &str, timeout_secs: u64) -> Result<()> {
    let orch = client::create_client()?;

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let mut poll_interval = Duration::from_millis(500);
    let max_interval = Duration::from_secs(5);

    loop {
        let execution = orch.get_execution(execution_id).await?;

        match execution.status.as_str() {
            "completed" => {
                if let Some(ref result) = execution.result {
                    println!("{}", serde_json::to_string_pretty(result)?);
                } else {
                    println!("{}", "Execution completed (no result data)".dimmed());
                }
                return Ok(());
            }
            "failed" => {
                if let Some(ref error) = execution.error {
                    eprintln!("{}: {}", "Execution failed".red().bold(), error);
                } else {
                    eprintln!("{}", "Execution failed (no error details)".red().bold());
                }
                std::process::exit(1);
            }
            "cancelled" => {
                eprintln!("{}", "Execution was cancelled".yellow());
                std::process::exit(1);
            }
            _ => {
                // Still running
                if Instant::now() >= deadline {
                    eprintln!(
                        "Timed out after {}s waiting for execution to complete. Status: {}",
                        timeout_secs, execution.status
                    );
                    eprintln!("Check progress: polos status {}", execution_id);
                    std::process::exit(1);
                }

                tokio::time::sleep(poll_interval).await;
                // Exponential backoff up to max
                poll_interval = std::cmp::min(poll_interval * 2, max_interval);
            }
        }
    }
}
