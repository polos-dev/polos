use anyhow::{Context, Result};
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::fs;
use std::io::BufRead;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use crate::config::ServerConfig;

pub async fn run(worker_port: u16) -> Result<()> {
    println!("Starting Polos development mode...");

    // Start orchestrator + UI via "polos server start" (writes PID files)
    let server_was_already_running = is_server_running()?;
    if !server_was_already_running {
        println!("Starting server (orchestrator + UI)...");
        crate::commands::start::run().await?;
    } else {
        println!("Server already running.");
    }

    let config = ServerConfig::load()?.context("Config file not found after initialization")?;

    // Detect worker command
    let (cmd, args) = detect_worker_command()?;
    println!("Running: {} {}", cmd, args.join(" "));

    // Set up Ctrl+C handler
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    ctrlc::set_handler(move || {
        shutdown_clone.store(true, Ordering::SeqCst);
    })?;

    // Set up file watcher for hot-reload
    let (fs_tx, fs_rx) = mpsc::channel();
    let mut debouncer = new_debouncer(Duration::from_millis(500), fs_tx)?;

    // Watch src/ directory and common entry files
    let watch_paths = determine_watch_paths();
    for path in &watch_paths {
        if Path::new(path).exists() {
            if let Err(e) = debouncer
                .watcher()
                .watch(Path::new(path), notify::RecursiveMode::Recursive)
            {
                tracing::warn!("Could not watch {}: {}", path, e);
            }
        }
    }

    println!("Watching for changes in: {}", watch_paths.join(", "));
    println!();

    // Build worker env vars (includes .env file + Polos overrides)
    let worker_env = build_worker_env(&config, worker_port);

    // Spawn initial worker
    let mut worker = spawn_worker(&cmd, &args, &worker_env)?;

    // Main loop: watch for shutdown, worker exit, or file changes
    loop {
        if shutdown.load(Ordering::SeqCst) {
            println!("\nShutting down...");
            kill_worker(&mut worker);
            if !server_was_already_running {
                let _ = crate::commands::stop::run().await;
            }
            println!("Development mode stopped.");
            return Ok(());
        }

        // Check for file changes (non-blocking)
        match fs_rx.try_recv() {
            Ok(Ok(events)) => {
                // Filter to actual file changes (not just metadata)
                let has_relevant_change = events
                    .iter()
                    .any(|e| e.kind == DebouncedEventKind::Any && is_source_file(&e.path));

                if has_relevant_change {
                    let changed_files: Vec<String> = events
                        .iter()
                        .filter(|e| e.kind == DebouncedEventKind::Any && is_source_file(&e.path))
                        .filter_map(|e| e.path.file_name().map(|f| f.to_string_lossy().to_string()))
                        .collect();

                    println!(
                        "\n\u{21bb} Restarting worker (changed: {})...",
                        changed_files.join(", ")
                    );

                    // Kill current worker and all its children
                    kill_worker(&mut worker);

                    // Respawn
                    match spawn_worker(&cmd, &args, &worker_env) {
                        Ok(new_worker) => {
                            worker = new_worker;
                            println!("Worker restarted.\n");
                        }
                        Err(e) => {
                            eprintln!("Failed to restart worker: {}", e);
                            eprintln!("Waiting for next file change...\n");
                            continue;
                        }
                    }
                }
            }
            Ok(Err(err)) => {
                tracing::warn!("File watch error: {:?}", err);
            }
            Err(mpsc::TryRecvError::Empty) => {}
            Err(mpsc::TryRecvError::Disconnected) => {
                tracing::warn!("File watcher disconnected");
            }
        }

        // Check if worker exited
        match worker.try_wait() {
            Ok(Some(status)) => {
                if shutdown.load(Ordering::SeqCst) {
                    if !server_was_already_running {
                        let _ = crate::commands::stop::run().await;
                    }
                    return Ok(());
                }

                if status.success() {
                    println!("\nWorker exited. Waiting for file changes to restart...");
                } else {
                    eprintln!(
                        "\nWorker exited with status: {}. Waiting for file changes to restart...",
                        status
                    );
                }

                // Wait for file change or shutdown to restart
                loop {
                    if shutdown.load(Ordering::SeqCst) {
                        if !server_was_already_running {
                            let _ = crate::commands::stop::run().await;
                        }
                        println!("Development mode stopped.");
                        return Ok(());
                    }

                    if let Ok(Ok(events)) = fs_rx.try_recv() {
                        let has_relevant = events
                            .iter()
                            .any(|e| e.kind == DebouncedEventKind::Any && is_source_file(&e.path));
                        if has_relevant {
                            println!("File change detected. Restarting worker...");
                            match spawn_worker(&cmd, &args, &worker_env) {
                                Ok(new_worker) => {
                                    worker = new_worker;
                                    println!("Worker restarted.\n");
                                    break;
                                }
                                Err(e) => {
                                    eprintln!("Failed to restart worker: {}", e);
                                    continue;
                                }
                            }
                        }
                    }

                    std::thread::sleep(Duration::from_millis(100));
                }
            }
            Ok(None) => {
                // Still running
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                if !server_was_already_running {
                    let _ = crate::commands::stop::run().await;
                }
                anyhow::bail!("Error waiting for worker: {}", e);
            }
        }
    }
}

/// Check if the server is already running by looking at PID files
fn is_server_running() -> Result<bool> {
    let pids_dir = ServerConfig::pids_dir()?;
    let orchestrator_pid_file = pids_dir.join("orchestrator.pid");

    if !orchestrator_pid_file.exists() {
        return Ok(false);
    }

    // Check if the process is actually running
    if let Ok(pid_str) = fs::read_to_string(&orchestrator_pid_file) {
        if let Ok(pid) = pid_str.trim().parse::<u32>() {
            #[cfg(unix)]
            {
                let check = Command::new("kill").arg("-0").arg(pid.to_string()).output();
                return Ok(check.map(|o| o.status.success()).unwrap_or(false));
            }
            #[cfg(not(unix))]
            {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

fn build_worker_env(config: &ServerConfig, worker_port: u16) -> Vec<(String, String)> {
    // Load .env file from the project directory first
    let mut env_map = load_dotenv();

    // Polos-specific vars override anything from .env
    env_map.insert("POLOS_LOCAL_MODE".to_string(), "true".to_string());
    env_map.insert(
        "POLOS_API_URL".to_string(),
        format!("http://127.0.0.1:{}", config.orchestrator_port),
    );
    env_map.insert(
        "POLOS_UI_URL".to_string(),
        format!("http://127.0.0.1:{}", config.ui_port),
    );
    env_map.insert("POLOS_PROJECT_ID".to_string(), config.project_id.clone());
    env_map.insert("POLOS_API_KEY".to_string(), config.api_key.clone());
    env_map.insert(
        "POLOS_DEPLOYMENT_ID".to_string(),
        config.effective_deployment_id(),
    );
    env_map.insert("POLOS_WORKER_PORT".to_string(), worker_port.to_string());

    env_map.into_iter().collect()
}

/// Parse a .env file from the current directory.
/// Supports KEY=VALUE, quotes, comments, and empty lines.
fn load_dotenv() -> HashMap<String, String> {
    let mut vars = HashMap::new();

    let dotenv_path = Path::new(".env");
    if !dotenv_path.exists() {
        return vars;
    }

    let file = match fs::File::open(dotenv_path) {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!("Could not read .env file: {}", e);
            return vars;
        }
    };

    for line in std::io::BufReader::new(file).lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        let trimmed = line.trim();

        // Skip empty lines and comments
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Skip export prefix
        let trimmed = trimmed.strip_prefix("export ").unwrap_or(trimmed);

        // Split on first '='
        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim().to_string();
            let mut value = value.trim().to_string();

            // Strip surrounding quotes (single or double)
            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                value = value[1..value.len() - 1].to_string();
            }

            if !key.is_empty() {
                vars.insert(key, value);
            }
        }
    }

    vars
}

fn spawn_worker(cmd: &str, args: &[String], env_vars: &[(String, String)]) -> Result<Child> {
    let mut command = Command::new(cmd);
    command
        .args(args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    // Create a new process group so we can kill all children on restart
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    for (key, value) in env_vars {
        command.env(key, value);
    }

    command
        .spawn()
        .with_context(|| format!("Failed to start worker process: {}", cmd))
}

/// Kill the worker and all its child processes by killing the process group.
fn kill_worker(worker: &mut Child) {
    #[cfg(unix)]
    {
        // Kill the entire process group (negative PID)
        let pid = worker.id() as i32;
        unsafe {
            libc::kill(-pid, libc::SIGTERM);
        }
        // Give processes a moment to clean up, then force kill
        std::thread::sleep(Duration::from_millis(200));
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }

    #[cfg(not(unix))]
    {
        let _ = worker.kill();
    }

    let _ = worker.wait();
}

fn determine_watch_paths() -> Vec<String> {
    let mut paths = Vec::new();

    for dir in &["src", "lib", "agents", "workflows", "tools", "."] {
        if Path::new(dir).exists() {
            paths.push(dir.to_string());
        }
    }

    if paths.is_empty() {
        paths.push(".".to_string());
    }

    paths
}

fn is_source_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    matches!(
        ext,
        "ts" | "tsx" | "js" | "jsx" | "py" | "rs" | "json" | "toml" | "yaml" | "yml"
    ) && !path.to_string_lossy().contains("node_modules")
        && !path.to_string_lossy().contains(".git")
        && !path.to_string_lossy().contains("__pycache__")
}

fn detect_worker_command() -> Result<(String, Vec<String>)> {
    if Path::new("package.json").exists() {
        let entry = find_ts_entry();
        Ok(("npx".to_string(), vec!["tsx".to_string(), entry]))
    } else if Path::new("pyproject.toml").exists() || Path::new("main.py").exists() {
        let entry = if Path::new("main.py").exists() {
            "main.py".to_string()
        } else {
            "src/main.py".to_string()
        };
        let cmd = if which_exists("uv") { "uv" } else { "python" };
        let mut args = vec![];
        if cmd == "uv" {
            args.push("run".to_string());
            args.push("python".to_string());
        }
        args.push(entry);
        Ok((cmd.to_string(), args))
    } else {
        anyhow::bail!(
            "Could not detect project type. Expected package.json (TypeScript) or pyproject.toml/main.py (Python)."
        );
    }
}

fn find_ts_entry() -> String {
    for candidate in &["src/main.ts", "main.ts", "src/index.ts", "index.ts"] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "src/main.ts".to_string()
}

fn which_exists(cmd: &str) -> bool {
    Command::new("which")
        .arg(cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
