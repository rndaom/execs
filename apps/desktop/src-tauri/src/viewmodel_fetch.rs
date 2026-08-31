//! Fetch Yttrium's competitive-viewmodel animation sources on demand.
//! Pinned to a commit and sha256-verified; cached under the execs data dir so
//! rebuilding is offline after the first download.

use std::path::PathBuf;

const ANIMATIONS_COMMIT: &str = "b215a5cdfcd809ec3c2d71529e7a1eb22a72a39e";
const ANIMATIONS_URL: &str = "https://raw.githubusercontent.com/Yttrium-tYcLief/CompVMInstaller";
const ANIMATIONS_SHA256: &str = "68b14e6537d1ee3b8b2d0cc1e92f12d4a7fd0f68eb5f12d2f0aa3231a60ee9c3";

fn cache_path() -> PathBuf {
    execs_core::execs_data_dir()
        .join("studio")
        .join(format!("yttrium-animations-{ANIMATIONS_COMMIT}.zip"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    execs_core::hash::sha256_hex(bytes)
}

/// The animation archive, from cache or the pinned upstream URL.
pub fn fetch_animations_zip() -> Result<Vec<u8>, String> {
    let cached = cache_path();
    if let Ok(bytes) = std::fs::read(&cached) {
        if sha256_hex(&bytes) == ANIMATIONS_SHA256 {
            return Ok(bytes);
        }
    }
    let url = format!(
        "{ANIMATIONS_URL}/{ANIMATIONS_COMMIT}/Project/CompVMInstaller/Resources/animations.zip"
    );
    let bytes = crate::comfig_fetch::download_bytes(&url)?;
    if sha256_hex(&bytes) != ANIMATIONS_SHA256 {
        return Err("The downloaded animation archive failed verification.".into());
    }
    if let Some(parent) = cached.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&cached, &bytes);
    Ok(bytes)
}
