use anyhow::{Context, Result};

use crate::client::{self, SubmitWorkflowRequest};

pub async fn run(agent_id: &str, input: Option<String>, file: Option<String>) -> Result<()> {
    let prompt = resolve_input(input, file)?;

    let orch = client::create_client()?;

    let request = SubmitWorkflowRequest {
        payload: serde_json::json!({
            "input": prompt,
        }),
        session_id: None,
        deployment_id: None,
    };

    let response = orch.submit_workflow(agent_id, &request).await?;

    println!("Execution started: {}", response.execution_id);
    println!();
    println!("Track progress:");
    println!("  polos status {}", response.execution_id);
    println!("  polos logs {}", response.execution_id);
    println!("  polos result {}", response.execution_id);

    Ok(())
}

fn resolve_input(input: Option<String>, file: Option<String>) -> Result<String> {
    match (input, file) {
        (Some(text), _) => Ok(text),
        (None, Some(path)) => {
            std::fs::read_to_string(&path).with_context(|| format!("Failed to read file: {}", path))
        }
        (None, None) => {
            anyhow::bail!("Either --input or --file is required for invoke. Use 'polos run' for interactive mode.")
        }
    }
}
