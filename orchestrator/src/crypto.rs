use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

// Get HMAC key from environment variable
// The key should be a secret used for HMAC signing
fn get_hmac_key() -> Result<Vec<u8>> {
  let key_str =
    std::env::var("HMAC_SECRET").context("HMAC_SECRET environment variable must be set")?;

  // Convert hex string to bytes if it's 64 chars (32 bytes)
  if key_str.len() == 64 {
    hex::decode(&key_str).context("HMAC_SECRET must be a valid hex string")
  } else {
    // Otherwise use the string as bytes directly
    Ok(key_str.as_bytes().to_vec())
  }
}

/// Hash an API key using HMAC-SHA256 for lookup and verification
pub fn hash_api_key(key: &str) -> Result<String> {
  let hmac_key = get_hmac_key()?;
  let mut mac = HmacSha256::new_from_slice(&hmac_key)
    .map_err(|e| anyhow::anyhow!("Failed to create HMAC: {}", e))?;

  mac.update(key.as_bytes());
  let result = mac.finalize();
  let code_bytes = result.into_bytes();

  Ok(hex::encode(code_bytes))
}

/// Generate a secure API key
pub fn generate_api_key(prefix: &str, length: usize) -> String {
  use rand::distributions::Alphanumeric;
  use rand::Rng;

  let mut rng = rand::thread_rng();
  let random_part: String = (0..length)
    .map(|_| rng.sample(Alphanumeric) as char)
    .collect();

  format!("{}{}", prefix, random_part)
}
