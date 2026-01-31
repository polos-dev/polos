use anyhow::Result;
use reqwest;

pub async fn run() -> Result<()> {
    let config = crate::config::ServerConfig::load()?;

    if let Some(config) = config {
        // Check orchestrator health (try root endpoint)
        let orchestrator_url = format!("http://127.0.0.1:{}", config.orchestrator_port);
        match reqwest::get(&orchestrator_url).await {
            Ok(resp) if resp.status().is_success() || resp.status() == 404 => {
                // 404 is OK, means server is responding
                println!(
                    "✓ Orchestrator: Running on port {}",
                    config.orchestrator_port
                );
            }
            _ => {
                println!(
                    "✗ Orchestrator: Not responding on port {}",
                    config.orchestrator_port
                );
            }
        }

        // Check UI
        let ui_url = format!("http://127.0.0.1:{}", config.ui_port);
        match reqwest::get(&ui_url).await {
            Ok(resp) if resp.status().is_success() => {
                println!("✓ UI: Running on port {}", config.ui_port);
            }
            _ => {
                println!("✗ UI: Not responding on port {}", config.ui_port);
            }
        }

        println!("\nConfiguration:");
        println!("  Project ID: {}", config.project_id);
        println!("  API Key: {}...", &config.api_key[..8]);
    } else {
        println!("Server not initialized. Run 'polos-server start' to initialize.");
    }

    Ok(())
}
