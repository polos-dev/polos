use anyhow::Result;
use colored::Colorize;

use crate::client;

pub async fn run(execution_id: &str) -> Result<()> {
    let orch = client::create_client()?;

    let execution = orch.get_execution(execution_id).await?;

    let status_colored = match execution.status.as_str() {
        "completed" => execution.status.green().to_string(),
        "failed" => execution.status.red().to_string(),
        "running" => execution.status.yellow().to_string(),
        "pending" => execution.status.dimmed().to_string(),
        "cancelled" => execution.status.dimmed().to_string(),
        _ => execution.status.clone(),
    };

    println!("{}: {}", "Execution".bold(), execution.id);
    if let Some(ref wf) = execution.workflow_id {
        println!("{}: {}", "Agent".bold(), wf);
    }
    println!("{}: {}", "Status".bold(), status_colored);

    if let Some(ref created) = execution.created_at {
        let elapsed = format_elapsed(created);
        println!("{}: {}", "Started".bold(), elapsed);
    }

    if let Some(ref error) = execution.error {
        println!("{}: {}", "Error".bold().red(), error);
    }

    Ok(())
}

fn format_elapsed(timestamp: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(timestamp) {
        Ok(dt) => chrono_humanize::HumanTime::from(dt).to_string(),
        Err(_) => timestamp.to_string(),
    }
}
