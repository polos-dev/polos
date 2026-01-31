use anyhow::{Context, Result};
use axum::{
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    Router,
};
use std::net::SocketAddr;
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

    // Create router to serve static files
    // We need to intercept index.html to inject the API base URL
    let orchestrator_port = config.orchestrator_port;
    let ui_dist_for_static = ui_dist.clone();
    let app = Router::new()
        // Intercept root path to inject API base URL
        .route(
            "/",
            axum::routing::get(move || handle_index_html(orchestrator_port)),
        )
        // Serve static files using ServeDir with a fallback
        // The fallback will handle SPA routes and /index.html
        .fallback_service(
            ServeDir::new(&ui_dist_for_static).fallback(axum::routing::get(
                move |uri: axum::http::Uri| handle_spa_fallback(uri, orchestrator_port),
            )),
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

async fn handle_index_html(orchestrator_port: u16) -> Response {
    // Handle index.html specifically to inject API base URL
    let ui_dist = utils::get_ui_dist_path().unwrap_or_default();
    let index_path = ui_dist.join("index.html");

    if index_path.exists() {
        match tokio::fs::read_to_string(&index_path).await {
            Ok(mut html) => {
                inject_api_base_url(&mut html, orchestrator_port);
                Html(html).into_response()
            }
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to read index.html",
            )
                .into_response(),
        }
    } else {
        (StatusCode::NOT_FOUND, "index.html not found").into_response()
    }
}

fn inject_api_base_url(html: &mut String, orchestrator_port: u16) {
    // Inject API base URL at runtime based on orchestrator port
    let api_base_url = format!("http://127.0.0.1:{}", orchestrator_port);
    // Use a synchronous inline script that runs immediately (no async, no defer)
    // This MUST run before any module scripts load
    let script_tag = format!(
        r#"<script>window.VITE_API_BASE_URL='{}';console.log('[polos-server] Injected API base URL:', window.VITE_API_BASE_URL);</script>"#,
        api_base_url
    );

    tracing::info!("Injecting API base URL into HTML: {}", api_base_url);

    // Insert the script tag as early as possible - right after <head> tag
    // This ensures it runs before any other scripts (including Vite's module scripts)
    let inserted = if let Some(head_start) = html.find("<head>") {
        if let Some(head_tag_end) = html[head_start..].find('>') {
            let insert_pos = head_start + head_tag_end + 1;
            html.insert_str(insert_pos, &script_tag);
            true
        } else {
            false
        }
    } else if let Some(body_start) = html.find("<body>") {
        // Fallback: insert at start of body if no head tag found
        if let Some(body_tag_end) = html[body_start..].find('>') {
            let insert_pos = body_start + body_tag_end + 1;
            html.insert_str(insert_pos, &script_tag);
            true
        } else {
            false
        }
    } else {
        false
    };

    if !inserted {
        tracing::warn!(
            "Failed to inject API base URL script - could not find <head> or <body> tag"
        );
    } else {
        tracing::debug!("Successfully injected API base URL script");
    }
}

async fn handle_spa_fallback(_uri: axum::http::Uri, orchestrator_port: u16) -> Response {
    // For SPA routing, serve index.html for all non-file requests
    let ui_dist = utils::get_ui_dist_path().unwrap_or_default();
    let index_path = ui_dist.join("index.html");

    if index_path.exists() {
        match tokio::fs::read_to_string(&index_path).await {
            Ok(mut html) => {
                inject_api_base_url(&mut html, orchestrator_port);
                Html(html).into_response()
            }
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to read index.html",
            )
                .into_response(),
        }
    } else {
        (StatusCode::NOT_FOUND, "index.html not found").into_response()
    }
}

pub async fn stop(handle: UiHandle) -> Result<()> {
    // Send shutdown signal
    if handle.shutdown_tx.send(()).is_err() {
        tracing::warn!("UI server shutdown channel already closed");
    }

    // Wait for the server to shut down, with a timeout
    // We need to get a reference to abort if timeout occurs
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
            tracing::warn!("UI server shutdown timed out after 5 seconds, aborting task");
            abort_handle.abort();
            // Wait a bit more for the abort to take effect
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    Ok(())
}
