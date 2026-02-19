#[allow(dead_code)]
mod client;
mod commands;
mod config;
mod init;
mod migrations;
mod utils;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "polos")]
#[command(about = "Polos CLI — build, run, and manage AI agents")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Manage the Polos server (orchestrator + UI)
    Server {
        #[command(subcommand)]
        command: ServerCommands,
    },
    /// Start development mode — orchestrator + worker
    Dev {
        /// Worker port (default: 8000)
        #[arg(long, default_value = "8000")]
        port: u16,
    },
    /// Manage agents
    Agent {
        #[command(subcommand)]
        command: AgentCommands,
    },
    /// Manage workflows
    Workflow {
        #[command(subcommand)]
        command: WorkflowCommands,
    },
    /// Manage tools
    Tool {
        #[command(subcommand)]
        command: ToolCommands,
    },
    /// Run an agent interactively or one-shot
    Run {
        /// Agent ID to run
        agent_id: String,
        /// One-shot input (skip REPL)
        #[arg(long)]
        input: Option<String>,
        /// Read input from file
        #[arg(long)]
        file: Option<String>,
    },
    /// Invoke an agent in the background (fire-and-forget)
    Invoke {
        /// Agent ID to invoke
        agent_id: String,
        /// Input prompt
        #[arg(long)]
        input: Option<String>,
        /// Read input from file
        #[arg(long)]
        file: Option<String>,
    },
    /// Check execution status
    Status {
        /// Execution ID
        execution_id: String,
    },
    /// Get execution result (waits if still running)
    Result {
        /// Execution ID
        execution_id: String,
        /// Timeout in seconds (default: 300)
        #[arg(long, default_value = "300")]
        timeout: u64,
    },
    /// Tail logs for an execution
    Logs {
        /// Execution ID
        execution_id: String,
        /// Show last N events
        #[arg(long)]
        last: Option<i32>,
    },
    /// Internal: serve UI only (used by server start)
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

#[derive(Subcommand)]
enum ServerCommands {
    /// Start the Polos server (orchestrator + UI) in background
    Start,
    /// Stop the running Polos server
    Stop,
    /// Check the status of the Polos server
    Status,
}

#[derive(Subcommand)]
enum AgentCommands {
    /// List all registered agents
    List,
    /// Show agent details
    Describe {
        /// Agent ID
        agent_id: String,
    },
    /// Tail logs for the most recent execution of an agent
    Logs {
        /// Agent ID
        agent_id: String,
        /// Show last N events
        #[arg(long)]
        last: Option<i32>,
    },
}

#[derive(Subcommand)]
enum WorkflowCommands {
    /// List all registered workflows
    List,
    /// Show workflow details
    Describe {
        /// Workflow ID
        workflow_id: String,
    },
    /// Tail logs for the most recent execution of a workflow
    Logs {
        /// Workflow ID
        workflow_id: String,
        /// Show last N events
        #[arg(long)]
        last: Option<i32>,
    },
}

#[derive(Subcommand)]
enum ToolCommands {
    /// List all registered tools
    List,
    /// Show tool details
    Describe {
        /// Tool ID
        tool_id: String,
    },
    /// Tail logs for the most recent execution of a tool
    Logs {
        /// Tool ID
        tool_id: String,
        /// Show last N events
        #[arg(long)]
        last: Option<i32>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Server { command } => match command {
            ServerCommands::Start => commands::start::run().await,
            ServerCommands::Stop => commands::stop::run().await,
            ServerCommands::Status => commands::status::run().await,
        },
        Commands::Dev { port } => commands::dev::run(port).await,
        Commands::Agent { command } => match command {
            AgentCommands::List => commands::agent::list().await,
            AgentCommands::Describe { agent_id } => commands::agent::describe(&agent_id).await,
            AgentCommands::Logs { agent_id, last } => {
                commands::logs::agent_logs(&agent_id, last).await
            }
        },
        Commands::Workflow { command } => match command {
            WorkflowCommands::List => commands::workflow::list().await,
            WorkflowCommands::Describe { workflow_id } => {
                commands::workflow::describe(&workflow_id).await
            }
            WorkflowCommands::Logs { workflow_id, last } => {
                commands::logs::workflow_logs(&workflow_id, last).await
            }
        },
        Commands::Tool { command } => match command {
            ToolCommands::List => commands::tool::list().await,
            ToolCommands::Describe { tool_id } => commands::tool::describe(&tool_id).await,
            ToolCommands::Logs { tool_id, last } => commands::logs::tool_logs(&tool_id, last).await,
        },
        Commands::Run {
            agent_id,
            input,
            file,
        } => commands::run::run(&agent_id, input, file).await,
        Commands::Invoke {
            agent_id,
            input,
            file,
        } => commands::invoke::run(&agent_id, input, file).await,
        Commands::Status { execution_id } => commands::execution_status::run(&execution_id).await,
        Commands::Result {
            execution_id,
            timeout,
        } => commands::result::run(&execution_id, timeout).await,
        Commands::Logs { execution_id, last } => {
            commands::logs::execution_logs(&execution_id, last).await
        }
        Commands::ServeUi {
            port,
            orchestrator_port,
        } => commands::serve_ui::run(port, orchestrator_port).await,
    }
}
