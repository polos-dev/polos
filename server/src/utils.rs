use anyhow::{Context, Result};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

// Include the embedded orchestrator binary
include!(concat!(env!("OUT_DIR"), "/orchestrator_binary.rs"));

pub fn get_embedded_orchestrator_binary() -> Result<Vec<u8>> {
    // Return the embedded binary as a Vec<u8>
    Ok(ORCHESTRATOR_BINARY.to_vec())
}

// Include the embedded UI dist directory
include!(concat!(env!("OUT_DIR"), "/ui_dist.rs"));

pub fn get_ui_dist_path() -> Option<PathBuf> {
    // Extract embedded UI dist to a temp directory at runtime
    
    let temp_dir = std::env::temp_dir();
    let ui_dist_dir = temp_dir.join(format!("polos-ui-dist-{}", uuid::Uuid::new_v4()));
    
    // Create the directory
    if let Err(e) = fs::create_dir_all(&ui_dist_dir) {
        tracing::error!("Failed to create UI dist temp directory: {}", e);
        return None;
    }
    
    // Extract all files from embedded UI_DIST
    extract_dir(&UI_DIST, &ui_dist_dir).ok()?;
    
    Some(ui_dist_dir)
}

// Recursively extract files from include_dir::Dir to filesystem
// Note: file.path() returns the path relative to the ROOT directory, not the current subdirectory.
// So we must always use the same target_path (the root extraction directory) when recursing.
fn extract_dir(dir: &include_dir::Dir, target_path: &PathBuf) -> Result<()> {
    for entry in dir.entries() {
        match entry {
            include_dir::DirEntry::File(file) => {
                // file.path() is relative to root, e.g., "assets/index.js"
                let file_path = target_path.join(file.path());
                if let Some(parent) = file_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut file_handle = fs::File::create(&file_path)?;
                file_handle.write_all(file.contents())?;
                tracing::trace!("Extracted: {:?}", file_path);
            }
            include_dir::DirEntry::Dir(subdir) => {
                // Recurse with the SAME target_path (not joined with subdir.path())
                // because nested files already have the full relative path from root
                extract_dir(subdir, target_path)?;
            }
        }
    }
    Ok(())
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
