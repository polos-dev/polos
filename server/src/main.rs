mod commands;
mod config;
mod init;
mod migrations;
mod services;
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
    /// Start the Polos server (orchestrator + UI)
    Start,
    /// Stop the running Polos server
    Stop,
    /// Check the status of the Polos server
    Status,
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
    }
}
