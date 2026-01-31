use anyhow::{Context, Result};
use tokio::signal;
use tokio::sync::oneshot;

use crate::config::ServerConfig;
use crate::init;
use crate::services;

pub async fn run() -> Result<()> {
    println!("🚀 Starting Polos server...");

    // Check if initialized, if not, run initialization
    if !ServerConfig::is_initialized()? {
        println!("📦 Server not initialized. Running initialization...");
        tracing::info!("Server not initialized. Running initialization...");
        initialize().await?;
        println!("✅ Initialization complete!");
    }

    let config = ServerConfig::load()?.context("Config file not found after initialization")?;

    println!("🔧 Starting orchestrator...");
    // Start orchestrator
    let orchestrator_handle = services::orchestrator::start(&config).await?;
    println!("✅ Orchestrator started");

    println!("🎨 Starting UI server...");
    // Start UI server
    let ui_handle = services::ui::start(&config).await?;
    println!("✅ UI server started");

    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("🎉 Polos server is running!");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!(
        "📡 Orchestrator API: http://127.0.0.1:{}",
        config.orchestrator_port
    );
    println!("🌐 UI:              http://127.0.0.1:{}", config.ui_port);
    println!("🔑 Project ID:      {}", config.project_id);
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("\nPress Ctrl+C to stop the server\n");

    tracing::info!("Polos server started successfully!");
    tracing::info!(
        "Orchestrator: http://127.0.0.1:{}",
        config.orchestrator_port
    );
    tracing::info!("UI: http://127.0.0.1:{}", config.ui_port);
    tracing::info!("Project ID: {}", config.project_id);

    // Wait for shutdown signal
    let (tx, rx) = oneshot::channel();

    #[cfg(unix)]
    {
        let mut sigterm = signal::unix::signal(signal::unix::SignalKind::terminate())?;
        let mut sigint = signal::unix::signal(signal::unix::SignalKind::interrupt())?;

        tokio::spawn(async move {
            tokio::select! {
                _ = signal::ctrl_c() => {
                    tracing::info!("Received Ctrl+C, shutting down...");
                    let _ = tx.send(());
                }
                _ = sigterm.recv() => {
                    tracing::info!("Received SIGTERM, shutting down...");
                    let _ = tx.send(());
                }
                _ = sigint.recv() => {
                    tracing::info!("Received SIGINT, shutting down...");
                    let _ = tx.send(());
                }
            }
        });
    }

    #[cfg(not(unix))]
    {
        tokio::spawn(async move {
            signal::ctrl_c().await.ok();
            tracing::info!("Received Ctrl+C, shutting down...");
            let _ = tx.send(());
        });
    }

    rx.await.ok();

    println!("\n🛑 Shutting down Polos server...");

    // Shutdown services
    println!("  🔧 Stopping orchestrator...");
    services::orchestrator::stop(orchestrator_handle).await?;
    println!("  ✅ Orchestrator stopped");

    println!("  🎨 Stopping UI server...");
    services::ui::stop(ui_handle).await?;
    println!("  ✅ UI server stopped");

    println!("✅ Polos server stopped");
    tracing::info!("Server stopped");
    Ok(())
}

async fn initialize() -> Result<()> {
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
        let secret: String = (0..64).map(|_| rng.sample(Alphanumeric) as char).collect();
        secret
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

    // Save config
    let config = ServerConfig {
        database_url,
        api_key,
        project_id: project_id.to_string(),
        orchestrator_port,
        ui_port,
        hmac_secret,
    };
    config.save()?;

    tracing::info!("Initialization complete!");
    tracing::info!("Default user ID: {}", user_id);
    tracing::info!("Default project ID: {}", project_id);

    Ok(())
}
