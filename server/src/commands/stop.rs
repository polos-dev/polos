use anyhow::Result;
use std::fs;

pub async fn run() -> Result<()> {
    let pids_dir = crate::config::ServerConfig::pids_dir()?;

    // Read PID files and kill processes
    let orchestrator_pid_file = pids_dir.join("orchestrator.pid");
    if orchestrator_pid_file.exists() {
        let pid_str = fs::read_to_string(&orchestrator_pid_file)?;
        let pid: u32 = pid_str.trim().parse()?;

        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .arg("-TERM")
                .arg(pid.to_string())
                .output();
        }

        #[cfg(windows)]
        {
            // On Windows, we'd need to use taskkill or similar
            tracing::warn!("Process termination on Windows not yet implemented");
        }

        fs::remove_file(&orchestrator_pid_file)?;
        tracing::info!("Stopped orchestrator (PID: {})", pid);
    }

    // Note: UI server is managed by tokio task, so we'd need to track it differently
    // For now, we'll just clean up PID files
    tracing::info!("Stop command completed");
    Ok(())
}
