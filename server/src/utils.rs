use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

// Include the embedded orchestrator binary
include!(concat!(env!("OUT_DIR"), "/orchestrator_binary.rs"));

pub fn get_embedded_orchestrator_binary() -> Result<Vec<u8>> {
    // Return the embedded binary as a Vec<u8>
    Ok(ORCHESTRATOR_BINARY.to_vec())
}

pub fn get_ui_dist_path() -> Option<PathBuf> {
    option_env!("UI_DIST_PATH").map(PathBuf::from)
}

pub fn extract_orchestrator_binary() -> Result<PathBuf> {
    use std::io::Write;

    let binary_data = get_embedded_orchestrator_binary()?;
    let temp_dir = std::env::temp_dir();
    let binary_name = if cfg!(target_os = "windows") {
        "polos-orchestrator.exe"
    } else {
        "polos-orchestrator"
    };

    let binary_path = temp_dir
        .join(format!("polos-orchestrator-{}", uuid::Uuid::new_v4()))
        .with_file_name(binary_name);

    let mut file = fs::File::create(&binary_path)?;
    file.write_all(&binary_data)?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file.metadata()?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&binary_path, perms)?;
    }

    Ok(binary_path)
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
