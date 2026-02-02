use anyhow::{Context, Result};
use std::path::PathBuf;

/// Get the Polos home directory (~/.polos)
pub fn get_polos_home() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Could not determine home directory")?;
    Ok(home.join(".polos"))
}

/// Get path to the orchestrator binary
pub fn get_orchestrator_path() -> Result<PathBuf> {
    let path = get_polos_home()?.join("bin").join("polos-orchestrator");
    if !path.exists() {
        anyhow::bail!(
            "Orchestrator binary not found at {:?}.\n\
            Please reinstall polos-server: curl -fsSL https://polos.dev/install.sh | bash",
            path
        );
    }
    Ok(path)
}

/// Get path to the UI dist directory
pub fn get_ui_dist_path() -> Result<PathBuf> {
    let path = get_polos_home()?.join("ui");
    if !path.exists() {
        anyhow::bail!(
            "UI dist directory not found at {:?}.\n\
            Please reinstall polos-server: curl -fsSL https://polos.dev/install.sh | bash",
            path
        );
    }
    Ok(path)
}

pub fn generate_api_key() -> String {
    use rand::distributions::Alphanumeric;
    use rand::Rng;

    let mut rng = rand::thread_rng();
    let random_part: String = (0..32).map(|_| rng.sample(Alphanumeric) as char).collect();

    format!("sk_{}", random_part)
}

pub fn hash_api_key(key: &str) -> Result<String> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    // For local mode, use a default secret if HMAC_SECRET is not set
    let secret = std::env::var("HMAC_SECRET")
        .unwrap_or_else(|_| "polos-local-dev-secret-key-change-in-production".to_string());

    let hmac_key = if secret.len() == 64 {
        hex::decode(&secret).context("HMAC_SECRET must be a valid hex string")?
    } else {
        secret.as_bytes().to_vec()
    };

    let mut mac = HmacSha256::new_from_slice(&hmac_key)
        .map_err(|e| anyhow::anyhow!("Failed to create HMAC: {}", e))?;

    mac.update(key.as_bytes());
    let result = mac.finalize();
    let code_bytes = result.into_bytes();

    Ok(hex::encode(code_bytes))
}
