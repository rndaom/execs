//! Fetch the default mod library (cueki's casual-pre-loader mods.zip) on
//! demand. Pinned to a release and sha256-verified; cached under the execs
//! data dir so installs are offline after the first download.

use std::path::PathBuf;

use crate::net::{self, RemoteSource, Verify};

use execs_core::preloader::{MODS_RELEASE, MODS_SHA256};
const MODS_URL: &str =
    "https://github.com/cueki/casual-pre-loader/releases/download/v1.7.1/mods.zip";
/// ~81.5 MB — the UI warns before the first download.
pub const MODS_SIZE_BYTES: u64 = 81_529_475;

pub fn cache_path() -> PathBuf {
    execs_core::execs_data_dir()
        .join("preloader")
        .join(format!("mods-{MODS_RELEASE}.zip"))
}

/// Whether the complete, hash-verified release archive is already cached.
/// This is intentionally not just a length probe: a same-sized corrupt file
/// must not make the UI promise an offline install that will later fail.
pub fn is_cached() -> bool {
    net::cached_file_accepts(&cache_path(), Verify::Sha256(MODS_SHA256), MODS_SIZE_BYTES)
}

/// The library zip path, downloading and verifying it first if needed. The
/// hash is checked on a cache hit too: a truncated or tampered cache file is
/// re-downloaded rather than unzipped into the user's game.
pub fn ensure_mods_zip() -> Result<PathBuf, String> {
    let cached = cache_path();
    net::download_pinned_for(
        MODS_URL,
        &cached,
        Verify::Sha256(MODS_SHA256),
        MODS_SIZE_BYTES,
        RemoteSource::GitHubRelease,
    )
    .map_err(|err| {
        err.replace(
            "The download failed verification.",
            "The downloaded mod library failed verification.",
        )
    })?;
    // Do not return a stale/unverified path if the cache was replaced between
    // the download and this hand-off.
    if !net::cached_file_accepts(&cached, Verify::Sha256(MODS_SHA256), MODS_SIZE_BYTES) {
        return Err("The cached mod library failed verification.".into());
    }
    Ok(cached)
}
