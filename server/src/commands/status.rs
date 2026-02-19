use anyhow::Result;
use std::fs;
use std::process::Command;

use crate::config::ServerConfig;

pub async fn run() -> Result<()> {
    let config = ServerConfig::load()?;

    if config.is_none() {
        println!("Server not initialized. Run 'polos server start' to initialize.");
        return Ok(());
    }

    let config = config.unwrap();
    let pids_dir = ServerConfig::pids_dir()?;
    let orchestrator_pid_file = pids_dir.join("orchestrator.pid");
    let ui_pid_file = pids_dir.join("ui.pid");

    println!("Polos Server Status");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Check orchestrator (uses /health endpoint)
    let orchestrator_pid = read_pid(&orchestrator_pid_file);
    let orchestrator_running = orchestrator_pid.map(is_pid_running).unwrap_or(false);
    let orchestrator_responding = check_http_health(&format!(
        "http://127.0.0.1:{}/health",
        config.orchestrator_port
    ))
    .await;

    print_service_status(
        "Orchestrator",
        config.orchestrator_port,
        orchestrator_pid,
        orchestrator_running,
        orchestrator_responding,
    );

    // Check UI server
    let ui_pid = read_pid(&ui_pid_file);
    let ui_running = ui_pid.map(is_pid_running).unwrap_or(false);
    let ui_responding = check_http_health(&format!("http://127.0.0.1:{}", config.ui_port)).await;

    print_service_status(
        "UI Server",
        config.ui_port,
        ui_pid,
        ui_running,
        ui_responding,
    );

    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("\nConfiguration:");
    println!("  Project ID: {}", config.project_id);
    println!(
        "  API Key:    {}...",
        &config.api_key[..8.min(config.api_key.len())]
    );

    // Show logs location
    let logs_dir = ServerConfig::config_dir()?.join("logs");
    if logs_dir.exists() {
        println!("\nLogs:");
        println!("  Orchestrator: {:?}", logs_dir.join("orchestrator.log"));
        println!("  UI Server:    {:?}", logs_dir.join("ui.log"));
    }

    Ok(())
}

fn read_pid(pid_file: &std::path::Path) -> Option<u32> {
    fs::read_to_string(pid_file)
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

fn is_pid_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let output = Command::new("kill").arg("-0").arg(pid.to_string()).output();
        output.map(|o| o.status.success()).unwrap_or(false)
    }

    #[cfg(not(unix))]
    {
        // On Windows, assume running if we have a PID
        true
    }
}

async fn check_http_health(url: &str) -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap_or_default();
    match client.get(url).send().await {
        Ok(resp) => resp.status().is_success() || resp.status() == 404,
        Err(_) => false,
    }
}

fn print_service_status(name: &str, port: u16, pid: Option<u32>, running: bool, responding: bool) {
    let status_icon = if running && responding {
        "✅"
    } else if running {
        "⚠️ "
    } else {
        "❌"
    };

    let status_text = if running && responding {
        "Running"
    } else if running {
        "Running (not responding)"
    } else {
        "Not running"
    };

    let pid_text = pid
        .map(|p| format!("PID: {}", p))
        .unwrap_or_else(|| "No PID".to_string());

    println!(
        "{} {}: {} on port {} ({})",
        status_icon, name, status_text, port, pid_text
    );
}
