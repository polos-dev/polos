use anyhow::{Context, Result};
use axum::{
    http::{StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::signal;
use tower_http::services::ServeDir;

use crate::utils;

/// Run the UI server as a standalone process (used by start command)
pub async fn run(port: u16, orchestrator_port: u16) -> Result<()> {
    let ui_dist = utils::get_ui_dist_path()?;

    if !ui_dist.exists() {
        anyhow::bail!("UI dist directory does not exist: {:?}", ui_dist);
    }

    tracing::info!("Serving UI from: {:?}", ui_dist);

    // Build the router
    let app = Router::new()
        .route(
            "/",
            get({
                let ui_dist = ui_dist.clone();
                move || serve_index_html(orchestrator_port, ui_dist.clone())
            }),
        )
        .route(
            "/index.html",
            get({
                let ui_dist = ui_dist.clone();
                move || serve_index_html(orchestrator_port, ui_dist.clone())
            }),
        )
        .fallback_service(ServeDir::new(&ui_dist).fallback(get({
            let ui_dist = ui_dist.clone();
            move |uri: Uri| spa_fallback(uri, orchestrator_port, ui_dist.clone())
        })));

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Failed to bind UI server to {}", addr))?;

    tracing::info!("UI server listening on {}", addr);

    // Run server with graceful shutdown on SIGTERM/SIGINT
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("UI server error")?;

    tracing::info!("UI server stopped");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

/// Serve index.html with injected API base URL
async fn serve_index_html(orchestrator_port: u16, ui_dist: PathBuf) -> Response {
    let index_path = ui_dist.join("index.html");

    match tokio::fs::read_to_string(&index_path).await {
        Ok(mut html) => {
            inject_api_base_url(&mut html, orchestrator_port);
            Html(html).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to read index.html from {:?}: {}", index_path, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to read index.html",
            )
                .into_response()
        }
    }
}

/// SPA fallback: serve index.html for client-side routes, 404 for missing files
async fn spa_fallback(uri: Uri, orchestrator_port: u16, ui_dist: PathBuf) -> Response {
    let path = uri.path();

    // If path looks like a file (has extension), it's a missing asset - return 404
    if path.contains('.') && !path.ends_with('/') {
        tracing::warn!("Static file not found: {}", path);
        return (StatusCode::NOT_FOUND, format!("File not found: {}", path)).into_response();
    }

    // Otherwise, it's a client-side route - serve index.html
    tracing::debug!("SPA fallback for route: {}", path);
    serve_index_html(orchestrator_port, ui_dist).await
}

/// Inject API base URL script into HTML
fn inject_api_base_url(html: &mut String, orchestrator_port: u16) {
    let api_base_url = format!("http://127.0.0.1:{}", orchestrator_port);

    let script_tag = format!(
        r#"<script>window.VITE_API_BASE_URL='{}';console.log('[polos-server] Injected API base URL:', window.VITE_API_BASE_URL);</script>"#,
        api_base_url
    );

    if let Some(head_pos) = html.find("<head>") {
        let insert_pos = head_pos + "<head>".len();
        html.insert_str(insert_pos, &script_tag);
    } else if let Some(body_pos) = html.find("<body>") {
        let insert_pos = body_pos + "<body>".len();
        html.insert_str(insert_pos, &script_tag);
    }
}
