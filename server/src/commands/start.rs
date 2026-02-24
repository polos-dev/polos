use anyhow::{Context, Result};
use std::fs;
use std::process::{Command, Stdio};
use tokio::time::Duration;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::config::ServerConfig;
use crate::init;
use crate::utils;

pub async fn run() -> Result<()> {
    println!("🚀 Starting Polos server...");

    // Check if already running
    let pids_dir = ServerConfig::pids_dir()?;
    let orchestrator_pid_file = pids_dir.join("orchestrator.pid");
    let ui_pid_file = pids_dir.join("ui.pid");

    if orchestrator_pid_file.exists() || ui_pid_file.exists() {
        // Check if processes are actually running
        let orchestrator_running = check_pid_running(&orchestrator_pid_file);
        let ui_running = check_pid_running(&ui_pid_file);

        if orchestrator_running || ui_running {
            println!("⚠️  Polos server appears to be already running.");
            println!("   Run 'polos server status' to check or 'polos server stop' to stop it.");
            return Ok(());
        } else {
            // Clean up stale PID files
            let _ = fs::remove_file(&orchestrator_pid_file);
            let _ = fs::remove_file(&ui_pid_file);
        }
    }

    // Check if initialized, if not, run initialization
    if !ServerConfig::is_initialized()? {
        println!("📦 Server not initialized. Running initialization...");
        tracing::info!("Server not initialized. Running initialization...");
        initialize().await?;
        println!("✅ Initialization complete!");
    }

    let config = ServerConfig::load()?.context("Config file not found after initialization")?;

    // Start orchestrator as background process
    println!("🔧 Starting orchestrator...");
    let orchestrator_pid = start_orchestrator(&config).await?;
    println!("✅ Orchestrator started (PID: {})", orchestrator_pid);

    // Start UI server as background process
    println!("🎨 Starting UI server...");
    let ui_pid = start_ui_server(&config).await?;
    println!("✅ UI server started (PID: {})", ui_pid);

    // Save PIDs
    fs::write(&orchestrator_pid_file, orchestrator_pid.to_string())?;
    fs::write(&ui_pid_file, ui_pid.to_string())?;

    // Wait a moment for services to start
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Print success message
    println!();
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("🎉 Polos server is running in background!");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!(
        "📡 Orchestrator API: http://127.0.0.1:{}",
        config.orchestrator_port
    );
    println!("🌐 UI:               http://127.0.0.1:{}", config.ui_port);
    println!("🔑 Project ID:       {}", config.project_id);
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();
    println!("To stop the server, run: polos server stop");
    println!("To check status, run:    polos server status");

    Ok(())
}

fn check_pid_running(pid_file: &std::path::Path) -> bool {
    if let Ok(pid_str) = fs::read_to_string(pid_file) {
        if let Ok(pid) = pid_str.trim().parse::<u32>() {
            #[cfg(unix)]
            {
                return unsafe { libc::kill(pid as libc::pid_t, 0) } == 0;
            }
            #[cfg(not(unix))]
            {
                // On Windows, assume it's running if PID file exists
                return true;
            }
        }
    }
    false
}

async fn start_orchestrator(config: &ServerConfig) -> Result<u32> {
    let binary_path = utils::get_orchestrator_path()?;

    // Build environment variables
    let bind_address = format!("127.0.0.1:{}", config.orchestrator_port);
    let cors_origin = format!("http://127.0.0.1:{}", config.ui_port);

    // Get HMAC_SECRET from config or generate if missing
    let hmac_secret = if !config.hmac_secret.is_empty() {
        config.hmac_secret.clone()
    } else {
        std::env::var("HMAC_SECRET").unwrap_or_else(|_| {
            use rand::distributions::Alphanumeric;
            use rand::Rng;
            let mut rng = rand::thread_rng();
            (0..64).map(|_| rng.sample(Alphanumeric) as char).collect()
        })
    };

    // Load ~/.polos/.env if it exists (user-managed secrets like SLACK_SIGNING_SECRET)
    let mut dotenv_vars = std::collections::HashMap::new();
    let env_path = ServerConfig::config_dir()?.join(".env");
    if env_path.exists() {
        for item in dotenvy::from_path_iter(&env_path)? {
            let (key, value) = item?;
            dotenv_vars.insert(key, value);
        }
    }

    // Get logs directory
    let logs_dir = ServerConfig::config_dir()?.join("logs");
    fs::create_dir_all(&logs_dir)?;

    let stdout_log = fs::File::create(logs_dir.join("orchestrator.log"))?;
    let stderr_log = stdout_log.try_clone()?;

    let mut cmd = Command::new(&binary_path);
    cmd.env("POLOS_LOCAL_MODE", "true")
        .env("DATABASE_URL", &config.database_url)
        .env("POLOS_BIND_ADDRESS", &bind_address)
        .env("CORS_ORIGIN", &cors_origin)
        .env("HMAC_SECRET", &hmac_secret);

    // Pass ~/.polos/.env variables to the orchestrator
    for (key, value) in &dotenv_vars {
        cmd.env(key, value);
    }

    // Pass extra [env] variables from config.toml (overrides .env if both set same key)
    for (key, value) in &config.env {
        cmd.env(key, value);
    }

    #[cfg(unix)]
    cmd.process_group(0); // Create its own process group for clean shutdown

    let child = cmd
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log))
        .spawn()
        .with_context(|| format!("Failed to start orchestrator: {:?}", binary_path))?;

    let pid = child.id();

    // Wait briefly and check if process is still running
    tokio::time::sleep(Duration::from_millis(200)).await;

    #[cfg(unix)]
    {
        if unsafe { libc::kill(pid as libc::pid_t, 0) } != 0 {
            anyhow::bail!(
                "Orchestrator process exited immediately. Check logs at {:?}",
                logs_dir.join("orchestrator.log")
            );
        }
    }

    Ok(pid)
}

async fn start_ui_server(config: &ServerConfig) -> Result<u32> {
    // Get the path to our own executable
    let exe_path = std::env::current_exe().context("Failed to get current executable path")?;

    // Get logs directory
    let logs_dir = ServerConfig::config_dir()?.join("logs");
    fs::create_dir_all(&logs_dir)?;

    let stdout_log = fs::File::create(logs_dir.join("ui.log"))?;
    let stderr_log = stdout_log.try_clone()?;

    let mut ui_cmd = Command::new(&exe_path);
    ui_cmd
        .arg("serve-ui")
        .arg("--port")
        .arg(config.ui_port.to_string())
        .arg("--orchestrator-port")
        .arg(config.orchestrator_port.to_string())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log));

    #[cfg(unix)]
    ui_cmd.process_group(0); // Create its own process group for clean shutdown

    let child = ui_cmd
        .spawn()
        .with_context(|| format!("Failed to start UI server: {:?}", exe_path))?;

    let pid = child.id();

    // Wait briefly and check if process is still running
    tokio::time::sleep(Duration::from_millis(200)).await;

    #[cfg(unix)]
    {
        if unsafe { libc::kill(pid as libc::pid_t, 0) } != 0 {
            let logs_path = ServerConfig::config_dir()?.join("logs").join("ui.log");
            anyhow::bail!(
                "UI server process exited immediately. Check logs at {:?}",
                logs_path
            );
        }
    }

    Ok(pid)
}

pub async fn initialize() -> Result<()> {
    // Default database URL
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost/polos".to_string());

    println!("  📊 Connecting to database...");
    tracing::info!("Initializing Polos server...");
    tracing::info!(
        "Database URL: {}",
        database_url.replace(":postgres@", ":****@")
    );

    // Ensure database exists
    println!("  📦 Creating database if needed...");
    init::database::ensure_database_exists(&database_url).await?;

    // Run migrations
    println!("  🔄 Running migrations...");
    init::database::run_migrations(&database_url).await?;

    // Get database pool for seeding
    let pool = init::database::get_database_pool(&database_url).await?;

    // Create default user and project
    println!("  👤 Creating default user and project...");
    let (user_id, project_id, api_key) = init::seed::create_default_user_and_project(&pool).await?;

    // Generate HMAC_SECRET if not provided
    let hmac_secret = std::env::var("HMAC_SECRET").unwrap_or_else(|_| {
        use rand::distributions::Alphanumeric;
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..64).map(|_| rng.sample(Alphanumeric) as char).collect()
    });

    // Get ports from environment variables or use defaults
    let orchestrator_port = std::env::var("POLOS_ORCHESTRATOR_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);

    let ui_port = std::env::var("POLOS_UI_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5173);

    // Read deployment ID from environment if set
    let deployment_id = std::env::var("POLOS_DEPLOYMENT_ID").ok();

    // Save config
    let config = ServerConfig {
        database_url,
        api_key,
        project_id: project_id.to_string(),
        orchestrator_port,
        ui_port,
        hmac_secret,
        deployment_id,
        env: Default::default(),
    };
    config.save()?;

    tracing::info!("Initialization complete!");
    tracing::info!("Default user ID: {}", user_id);
    tracing::info!("Default project ID: {}", project_id);

    Ok(())
}
