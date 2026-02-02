use anyhow::{Context, Result};
use std::process::{Child, Stdio};
use tokio::time::Duration;

use crate::config::ServerConfig;
use crate::utils;

pub struct OrchestratorHandle {
    pub process: Child,
}

pub async fn start(config: &ServerConfig) -> Result<OrchestratorHandle> {
    // Extract orchestrator binary
    let binary_path = utils::extract_orchestrator_binary()?;

    // Set up environment variables
    let mut env_vars = std::collections::HashMap::new();
    env_vars.insert("POLOS_LOCAL_MODE", "true");
    env_vars.insert("DATABASE_URL", config.database_url.as_str());
    let bind_address = format!("127.0.0.1:{}", config.orchestrator_port);
    env_vars.insert("BIND_ADDRESS", bind_address.as_str());
    // Set CORS_ORIGIN based on UI port
    let cors_origin = format!("http://127.0.0.1:{}", config.ui_port);
    env_vars.insert("CORS_ORIGIN", cors_origin.as_str());

    println!("🔧 Starting orchestrator with environment variables:");
    println!("  POLOS_LOCAL_MODE=true");
    println!("  BIND_ADDRESS={}", bind_address);
    println!("  CORS_ORIGIN={}", cors_origin);
    tracing::info!("Starting orchestrator with environment variables:");
    tracing::info!("  POLOS_LOCAL_MODE=true");
    tracing::info!("  BIND_ADDRESS={}", bind_address);
    tracing::info!("  CORS_ORIGIN={}", cors_origin);

    // Get HMAC_SECRET from config or generate if missing
    // This must be consistent across restarts for API keys to work
    let hmac_secret = if !config.hmac_secret.is_empty() {
        config.hmac_secret.clone()
    } else {
        // Check environment variable first
        std::env::var("HMAC_SECRET").unwrap_or_else(|_| {
            // Generate a new secret
            use rand::distributions::Alphanumeric;
            use rand::Rng;
            let mut rng = rand::thread_rng();
            let secret: String = (0..64).map(|_| rng.sample(Alphanumeric) as char).collect();
            secret
        })
    };
    env_vars.insert("HMAC_SECRET", &hmac_secret);

    // Save PID
    let pid_file = crate::config::ServerConfig::pids_dir()?.join("orchestrator.pid");
    std::fs::write(&pid_file, std::process::id().to_string())?;

    // Start orchestrator process
    let mut cmd = std::process::Command::new(&binary_path);
    // Set environment variables (this adds to existing env, doesn't replace)
    for (key, value) in &env_vars {
        cmd.env(key, value);
    }
    // Forward stdout and stderr to parent process so we can see orchestrator logs
    cmd.stdout(Stdio::inherit());
    cmd.stderr(Stdio::inherit());

    let mut process = cmd
        .spawn()
        .with_context(|| format!("Failed to start orchestrator: {:?}", binary_path))?;

    println!("✅ Started orchestrator (PID: {})", process.id());
    println!("   (Orchestrator logs will appear below)");
    tracing::info!("Started orchestrator (PID: {})", process.id());

    // Wait a bit and check if process is still running
    tokio::time::sleep(Duration::from_secs(1)).await;
    if let Some(status) = process.try_wait()? {
        anyhow::bail!(
            "Orchestrator process exited immediately with status: {:?}",
            status
        );
    }

    Ok(OrchestratorHandle { process })
}

pub async fn stop(mut handle: OrchestratorHandle) -> Result<()> {
    let pid = handle.process.id();

    // Try graceful shutdown first (SIGTERM)
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .output();

        // Wait up to 5 seconds for graceful shutdown
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if let Ok(Some(_)) = handle.process.try_wait() {
                tracing::info!("Orchestrator stopped gracefully");
                break;
            }
        }

        // Force kill if still running
        if handle.process.try_wait()?.is_none() {
            tracing::warn!("Orchestrator did not stop gracefully, forcing shutdown");
            let _ = std::process::Command::new("kill")
                .arg("-KILL")
                .arg(pid.to_string())
                .output();
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    #[cfg(windows)]
    {
        // On Windows, try to kill gracefully first
        let _ = handle.process.kill();
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    // Remove PID file
    let pid_file = crate::config::ServerConfig::pids_dir()?.join("orchestrator.pid");
    let _ = std::fs::remove_file(&pid_file);

    tracing::info!("Stopped orchestrator");
    Ok(())
}
