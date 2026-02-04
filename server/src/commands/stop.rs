use anyhow::Result;
use std::fs;
use std::process::Command;
use std::thread;
use std::time::Duration;

use crate::config::ServerConfig;

pub async fn run() -> Result<()> {
    println!("🛑 Stopping Polos server...");

    let pids_dir = ServerConfig::pids_dir()?;
    let orchestrator_pid_file = pids_dir.join("orchestrator.pid");
    let ui_pid_file = pids_dir.join("ui.pid");

    let mut any_stopped = false;

    // Stop orchestrator
    if orchestrator_pid_file.exists() {
        match stop_process(&orchestrator_pid_file, "Orchestrator") {
            Ok(true) => {
                any_stopped = true;
                println!("  ✅ Orchestrator stopped");
            }
            Ok(false) => {
                println!("  ⚠️  Orchestrator was not running");
            }
            Err(e) => {
                println!("  ❌ Failed to stop orchestrator: {}", e);
            }
        }
        let _ = fs::remove_file(&orchestrator_pid_file);
    }

    // Stop UI server
    if ui_pid_file.exists() {
        match stop_process(&ui_pid_file, "UI server") {
            Ok(true) => {
                any_stopped = true;
                println!("  ✅ UI server stopped");
            }
            Ok(false) => {
                println!("  ⚠️  UI server was not running");
            }
            Err(e) => {
                println!("  ❌ Failed to stop UI server: {}", e);
            }
        }
        let _ = fs::remove_file(&ui_pid_file);
    }

    if !orchestrator_pid_file.exists() && !ui_pid_file.exists() && !any_stopped {
        println!("ℹ️  No running Polos server found.");
        return Ok(());
    }

    println!("✅ Polos server stopped");
    Ok(())
}

fn stop_process(pid_file: &std::path::Path, name: &str) -> Result<bool> {
    let pid_str = fs::read_to_string(pid_file)?;
    let pid: u32 = pid_str.trim().parse()?;

    #[cfg(unix)]
    {
        // Check if process is running
        let check = Command::new("kill").arg("-0").arg(pid.to_string()).output();

        if !check.map(|o| o.status.success()).unwrap_or(false) {
            tracing::info!("{} (PID: {}) was not running", name, pid);
            return Ok(false);
        }

        // Send SIGTERM for graceful shutdown
        tracing::info!("Sending SIGTERM to {} (PID: {})", name, pid);
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .output();

        // Wait up to 5 seconds for graceful shutdown
        for _ in 0..50 {
            thread::sleep(Duration::from_millis(100));
            let check = Command::new("kill").arg("-0").arg(pid.to_string()).output();

            if !check.map(|o| o.status.success()).unwrap_or(false) {
                tracing::info!("{} stopped gracefully", name);
                return Ok(true);
            }
        }

        // Force kill if still running
        tracing::warn!("{} did not stop gracefully, forcing shutdown", name);
        let _ = Command::new("kill")
            .arg("-KILL")
            .arg(pid.to_string())
            .output();

        thread::sleep(Duration::from_millis(100));
        return Ok(true);
    }

    #[cfg(windows)]
    {
        // On Windows, use taskkill
        let result = Command::new("taskkill")
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/F")
            .output();

        match result {
            Ok(output) if output.status.success() => {
                tracing::info!("{} (PID: {}) stopped", name, pid);
                return Ok(true);
            }
            _ => {
                tracing::warn!("Failed to stop {} (PID: {})", name, pid);
                return Ok(false);
            }
        }
    }

    #[allow(unreachable_code)]
    Ok(false)
}
