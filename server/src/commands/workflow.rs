use anyhow::Result;
use colored::Colorize;

use crate::client;

pub async fn list() -> Result<()> {
    let orch = client::create_client()?;

    let workflows = orch.list_workflows().await?;
    let has_workers = orch.has_active_workers().await;

    if workflows.is_empty() {
        println!("No workflows registered.");
        println!("Start a worker to register workflows: polos dev");
        return Ok(());
    }

    println!(
        "{:<30} {:<15} {}",
        "ID".bold(),
        "TYPE".bold(),
        "STATUS".bold()
    );

    for wf in &workflows {
        let wf_type = wf.workflow_type.as_deref().unwrap_or("-");
        let status = if has_workers {
            "online".green().to_string()
        } else {
            "offline".dimmed().to_string()
        };

        println!("{:<30} {:<15} {}", wf.workflow_id, wf_type, status);
    }

    Ok(())
}

pub async fn describe(workflow_id: &str) -> Result<()> {
    let orch = client::create_client()?;

    let wf = orch.get_workflow(workflow_id).await?;

    println!("{}: {}", "Workflow".bold(), wf.workflow_id);
    if let Some(ref wf_type) = wf.workflow_type {
        println!("{}: {}", "Type".bold(), wf_type);
    }
    if let Some(ref deployment_id) = wf.deployment_id {
        println!("{}: {}", "Deployment".bold(), deployment_id);
    }

    Ok(())
}
