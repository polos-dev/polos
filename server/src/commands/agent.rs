use anyhow::Result;
use colored::Colorize;

use crate::client;

pub async fn list() -> Result<()> {
    let orch = client::create_client()?;

    let agents = orch.list_agents().await?;
    let has_workers = orch.has_active_workers().await;

    if agents.is_empty() {
        println!("No agents registered.");
        println!("Start a worker to register agents: polos dev");
        return Ok(());
    }

    // Print table header
    println!(
        "{:<25} {:<30} {:<25} {}",
        "ID".bold(),
        "MODEL".bold(),
        "TOOLS".bold(),
        "STATUS".bold()
    );

    for agent in &agents {
        let model = agent.model.as_deref().unwrap_or("-");
        let tools = format_tools(&agent.tools);
        let status = if has_workers {
            "online".green().to_string()
        } else {
            "offline".dimmed().to_string()
        };

        println!("{:<25} {:<30} {:<25} {}", agent.id, model, tools, status);
    }

    Ok(())
}

pub async fn describe(agent_id: &str) -> Result<()> {
    let orch = client::create_client()?;

    let agent = orch.get_agent(agent_id).await?;

    println!("{}: {}", "Agent".bold(), agent.id);
    if let Some(ref provider) = agent.provider {
        println!("{}: {}", "Provider".bold(), provider);
    }
    if let Some(ref model) = agent.model {
        println!("{}: {}", "Model".bold(), model);
    }

    let tools = format_tools_full(&agent.tools);
    if !tools.is_empty() {
        println!("{}: {}", "Tools".bold(), tools);
    }

    if let Some(ref temp) = agent.temperature {
        println!("{}: {}", "Temperature".bold(), temp);
    }
    if let Some(ref max_tokens) = agent.max_output_tokens {
        println!("{}: {}", "Max Output Tokens".bold(), max_tokens);
    }
    if let Some(ref deployment_id) = agent.deployment_id {
        println!("{}: {}", "Deployment".bold(), deployment_id);
    }
    if let Some(ref prompt) = agent.system_prompt {
        println!("{}: {}", "System Prompt".bold(), truncate(prompt, 200));
    }
    if let Some(ref metadata) = agent.metadata {
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

fn format_tools(tools: &Option<serde_json::Value>) -> String {
    match tools {
        Some(serde_json::Value::Array(arr)) => {
            let names: Vec<String> = arr
                .iter()
                .filter_map(|t| {
                    t.get("name")
                        .or_else(|| t.get("id"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect();

            if names.len() > 3 {
                format!("{}, +{} more", names[..3].join(", "), names.len() - 3)
            } else {
                names.join(", ")
            }
        }
        _ => "-".to_string(),
    }
}

fn format_tools_full(tools: &Option<serde_json::Value>) -> String {
    match tools {
        Some(serde_json::Value::Array(arr)) => {
            let names: Vec<String> = arr
                .iter()
                .filter_map(|t| {
                    t.get("name")
                        .or_else(|| t.get("id"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect();
            names.join(", ")
        }
        _ => String::new(),
    }
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}
