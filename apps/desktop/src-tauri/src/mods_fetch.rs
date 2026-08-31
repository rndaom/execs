//! Fetch the default mod library (cueki's casual-pre-loader mods.zip) on
//! demand. Pinned to a release and sha256-verified; cached under the execs
//! data dir so installs are offline after the first download.

use std::path::PathBuf;

const MODS_RELEASE: &str = "v1.7.1";
const MODS_URL: &str =
    "https://github.com/cueki/casual-pre-loader/releases/download/v1.7.1/mods.zip";
const MODS_SHA256: &str = "bd132d03eda6db17544cb43b5b4b57dc94e0cb91d1ab3de9571faabfce235388";
/// ~81.5 MB — the UI warns before the first download.
pub const MODS_SIZE_BYTES: u64 = 81_529_475;

pub fn cache_path() -> PathBuf {
    execs_core::execs_data_dir()
        .join("preloader")
        .join(format!("mods-{MODS_RELEASE}.zip"))
}

pub fn is_cached() -> bool {
    cache_path()
        .metadata()
        .map(|meta| meta.len() == MODS_SIZE_BYTES)
        .unwrap_or(false)
}

/// The library zip path, downloading and verifying it first if needed.
pub fn ensure_mods_zip() -> Result<PathBuf, String> {
    let cached = cache_path();
    if let Ok(meta) = cached.metadata() {
        // Hashing 81MB on every install is wasteful; the size check catches
        // truncated downloads and the hash ran when the file was written.
        if meta.len() == MODS_SIZE_BYTES {
            return Ok(cached);
        }
    }
    let bytes = crate::comfig_fetch::download_bytes(MODS_URL)?;
    if execs_core::hash::sha256_hex(&bytes) != MODS_SHA256 {
        return Err("The downloaded mod library failed verification.".into());
    }
    if let Some(parent) = cached.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&cached, &bytes)
        .map_err(|err| format!("Could not cache the mod library: {err}"))?;
    Ok(cached)
}
