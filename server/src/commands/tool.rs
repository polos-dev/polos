use anyhow::Result;
use colored::Colorize;

use crate::client;

pub async fn list() -> Result<()> {
    let orch = client::create_client()?;

    let tools = orch.list_tools().await?;
    let has_workers = orch.has_active_workers().await;

    if tools.is_empty() {
        println!("No tools registered.");
        println!("Start a worker to register tools: polos dev");
        return Ok(());
    }

    println!(
        "{:<25} {:<15} {:<35} {}",
        "ID".bold(),
        "TYPE".bold(),
        "DESCRIPTION".bold(),
        "STATUS".bold()
    );

    for tool in &tools {
        let tool_type = tool.tool_type.as_deref().unwrap_or("-");
        let description = tool
            .description
            .as_deref()
            .map(|d| {
                if d.len() > 32 {
                    format!("{}...", &d[..32])
                } else {
                    d.to_string()
                }
            })
            .unwrap_or_else(|| "-".to_string());
        let status = if has_workers {
            "online".green().to_string()
        } else {
            "offline".dimmed().to_string()
        };

        println!(
            "{:<25} {:<15} {:<35} {}",
            tool.id, tool_type, description, status
        );
    }

    Ok(())
}

pub async fn describe(tool_id: &str) -> Result<()> {
    let orch = client::create_client()?;

    let tool = orch.get_tool(tool_id).await?;

    println!("{}: {}", "Tool".bold(), tool.id);
    if let Some(ref tool_type) = tool.tool_type {
        println!("{}: {}", "Type".bold(), tool_type);
    }
    if let Some(ref desc) = tool.description {
        println!("{}: {}", "Description".bold(), desc);
    }
    if let Some(ref deployment_id) = tool.deployment_id {
        println!("{}: {}", "Deployment".bold(), deployment_id);
    }
    if let Some(ref params) = tool.parameters {
        if !params.is_null() {
            println!(
                "{}: {}",
                "Parameters".bold(),
                serde_json::to_string_pretty(params)?
            );
        }
    }
    if let Some(ref metadata) = tool.metadata {
        if !metadata.is_null() {
            println!(
                "{}: {}",
                "Metadata".bold(),
                serde_json::to_string_pretty(metadata)?
            );
        }
    }

    Ok(())
}
