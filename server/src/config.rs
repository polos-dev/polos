use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub database_url: String,
    pub api_key: String,
    pub project_id: String,
    pub orchestrator_port: u16,
    pub ui_port: u16,
    #[serde(default)]
    pub hmac_secret: String,
    /// Extra environment variables passed to the orchestrator process.
    #[serde(default)]
    pub env: HashMap<String, String>,
}

impl ServerConfig {
    pub fn config_dir() -> Result<PathBuf> {
        let dir = dirs::home_dir()
            .context("Failed to get home directory")?
            .join(".polos");
        Ok(dir)
    }

    pub fn config_path() -> Result<PathBuf> {
        Ok(Self::config_dir()?.join("config.toml"))
    }

    pub fn initialized_flag_path() -> Result<PathBuf> {
        Ok(Self::config_dir()?.join("initialized"))
    }

    pub fn pids_dir() -> Result<PathBuf> {
        let dir = Self::config_dir()?.join("pids");
        if !dir.exists() {
            fs::create_dir_all(&dir)?;
        }
        Ok(dir)
    }

    pub fn load() -> Result<Option<Self>> {
        let path = Self::config_path()?;
        if !path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&path)?;
        let config: ServerConfig = toml::from_str(&content)
            .with_context(|| format!("Failed to parse config file: {:?}", path))?;
        Ok(Some(config))
    }

    pub fn save(&self) -> Result<()> {
        let config_dir = Self::config_dir()?;
        fs::create_dir_all(&config_dir)?;

        let path = Self::config_path()?;
        let content = toml::to_string_pretty(self)?;
        fs::write(&path, content)?;

        // Create initialized flag
        let flag_path = Self::initialized_flag_path()?;
        fs::write(&flag_path, "initialized")?;

        Ok(())
    }

    pub fn is_initialized() -> Result<bool> {
        Ok(Self::initialized_flag_path()?.exists())
    }
}
