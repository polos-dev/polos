use anyhow::{Context, Result};
use axum::{
    http::{StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::sync::oneshot;
use tower_http::services::ServeDir;

use crate::config::ServerConfig;
use crate::utils;

pub struct UiHandle {
    pub shutdown_tx: oneshot::Sender<()>,
    pub task_handle: tokio::task::JoinHandle<Result<()>>,
}

pub async fn start(config: &ServerConfig) -> Result<UiHandle> {
    let ui_dist =
        utils::get_ui_dist_path().context("UI dist directory not found. Make sure UI is built.")?;

    if !ui_dist.exists() {
        anyhow::bail!("UI dist directory does not exist: {:?}", ui_dist);
    }

    tracing::info!("Serving UI from: {:?}", ui_dist);

    // Log contents for debugging
    log_directory_contents(&ui_dist);

    let orchestrator_port = config.orchestrator_port;

    // Build the router:
    // 1. Explicit routes for / and /index.html to inject API base URL
    // 2. ServeDir for static assets (js, css, images, etc.)
    // 3. Fallback to index.html for SPA client-side routes
    let app = Router::new()
        .route("/", get({
            let ui_dist = ui_dist.clone();
            move || serve_index_html(orchestrator_port, ui_dist.clone())
        }))
        .route("/index.html", get({
            let ui_dist = ui_dist.clone();
            move || serve_index_html(orchestrator_port, ui_dist.clone())
        }))
        .fallback_service(
            ServeDir::new(&ui_dist)
                .fallback(get({
                    let ui_dist = ui_dist.clone();
                    move |uri: Uri| spa_fallback(uri, orchestrator_port, ui_dist.clone())
                }))
        );

    let addr = SocketAddr::from(([127, 0, 0, 1], config.ui_port));
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Failed to bind UI server to {}", addr))?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    let task_handle = tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async {
            shutdown_rx.await.ok();
        });

        server.await.context("UI server error")
    });

    tracing::info!("Started UI server on {}", addr);

    Ok(UiHandle {
        shutdown_tx,
        task_handle,
    })
}

fn log_directory_contents(dir: &PathBuf) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                tracing::debug!("  [dir] {:?}", path.file_name());
                // Also log assets directory contents
                if path.file_name().map(|n| n == "assets").unwrap_or(false) {
                    if let Ok(assets) = std::fs::read_dir(&path) {
                        for asset in assets.flatten().take(5) {
                            tracing::debug!("    {:?}", asset.file_name());
                        }
                    }
                }
            } else {
                tracing::debug!("  {:?}", path.file_name());
            }
        }
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
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read index.html").into_response()
        }
    }
}

/// SPA fallback: serve index.html for client-side routes, 404 for missing files
async fn spa_fallback(uri: Uri, orchestrator_port: u16, ui_dist: PathBuf) -> Response {
    let path = uri.path();

    // If path looks like a file (has extension), it's a missing asset - return 404
    // ServeDir already tried to serve it and failed
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

    // Synchronous inline script that runs before any module scripts
    let script_tag = format!(
        r#"<script>window.VITE_API_BASE_URL='{}';console.log('[polos-server] Injected API base URL:', window.VITE_API_BASE_URL);</script>"#,
        api_base_url
    );

    // Insert right after <head> tag
    if let Some(head_pos) = html.find("<head>") {
        let insert_pos = head_pos + "<head>".len();
        html.insert_str(insert_pos, &script_tag);
        tracing::debug!("Injected API base URL: {}", api_base_url);
    } else if let Some(body_pos) = html.find("<body>") {
        // Fallback: insert at start of body
        let insert_pos = body_pos + "<body>".len();
        html.insert_str(insert_pos, &script_tag);
        tracing::debug!("Injected API base URL (in body): {}", api_base_url);
    } else {
        tracing::warn!("Could not find <head> or <body> tag to inject API base URL");
    }
}

pub async fn stop(handle: UiHandle) -> Result<()> {
    // Send shutdown signal
    if handle.shutdown_tx.send(()).is_err() {
        tracing::warn!("UI server shutdown channel already closed");
    }

    // Wait for the server to shut down
    let task_handle = handle.task_handle;
    let abort_handle = task_handle.abort_handle();

    match tokio::time::timeout(tokio::time::Duration::from_secs(5), task_handle).await {
        Ok(Ok(_)) => {
            tracing::info!("UI server stopped gracefully");
        }
        Ok(Err(e)) => {
            tracing::warn!("UI server task returned error: {:?}", e);
        }
        Err(_) => {
            tracing::warn!("UI server shutdown timed out, aborting");
            abort_handle.abort();
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    Ok(())
}
