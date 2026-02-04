mod commands;
mod config;
mod init;
mod migrations;
mod utils;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "polos-server")]
#[command(about = "Polos server - easy local development setup")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the Polos server (orchestrator + UI) in background
    Start,
    /// Stop the running Polos server
    Stop,
    /// Check the status of the Polos server
    Status,
    /// Internal: serve UI only (used by start command)
    #[command(hide = true)]
    ServeUi {
        /// Port to serve UI on
        #[arg(long)]
        port: u16,
        /// Orchestrator port for API base URL injection
        #[arg(long)]
        orchestrator_port: u16,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Start => commands::start::run().await,
        Commands::Stop => commands::stop::run().await,
        Commands::Status => commands::status::run().await,
        Commands::ServeUi {
            port,
            orchestrator_port,
        } => commands::serve_ui::run(port, orchestrator_port).await,
    }
}
