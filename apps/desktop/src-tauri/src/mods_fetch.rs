//! Fetch the default mod library (cueki's casual-pre-loader mods.zip) on
//! demand. Pinned to a release and sha256-verified; cached under the execs
//! data dir so installs are offline after the first download.

use std::path::PathBuf;

use crate::net::{self, Verify};

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

/// A cheap "has the user already paid the 81 MB" probe for the pane. Not a
/// verification — `ensure_mods_zip` hashes before handing the path out.
pub fn is_cached() -> bool {
    cache_path()
        .metadata()
        .map(|meta| meta.len() == MODS_SIZE_BYTES)
        .unwrap_or(false)
}

/// The library zip path, downloading and verifying it first if needed. The
/// hash is checked on a cache hit too: a truncated or tampered cache file is
/// re-downloaded rather than unzipped into the user's game.
pub fn ensure_mods_zip() -> Result<PathBuf, String> {
    let cached = cache_path();
    net::download_pinned(
        MODS_URL,
        &cached,
        Verify::Sha256(MODS_SHA256),
        MODS_SIZE_BYTES,
    )
    .map_err(|err| {
        err.replace(
            "The download failed verification.",
            "The downloaded mod library failed verification.",
        )
    })?;
    Ok(cached)
}
