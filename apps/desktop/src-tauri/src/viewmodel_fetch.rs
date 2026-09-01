//! Fetch Yttrium's competitive-viewmodel animation sources on demand.
//! Pinned to a commit and sha256-verified; cached under the execs data dir so
//! rebuilding is offline after the first download.

use std::path::PathBuf;

use crate::net::{self, Verify, MIB};

const ANIMATIONS_COMMIT: &str = "b215a5cdfcd809ec3c2d71529e7a1eb22a72a39e";
const ANIMATIONS_URL: &str = "https://raw.githubusercontent.com/Yttrium-tYcLief/CompVMInstaller";
const ANIMATIONS_SHA256: &str = "68b14e6537d1ee3b8b2d0cc1e92f12d4a7fd0f68eb5f12d2f0aa3231a60ee9c3";

const ANIMATIONS_MAX_BYTES: u64 = 256 * MIB;

fn cache_path() -> PathBuf {
    execs_core::execs_data_dir()
        .join("studio")
        .join(format!("yttrium-animations-{ANIMATIONS_COMMIT}.zip"))
}

/// The animation archive, from cache or the pinned upstream URL.
pub fn fetch_animations_zip() -> Result<Vec<u8>, String> {
    let url = format!(
        "{ANIMATIONS_URL}/{ANIMATIONS_COMMIT}/Project/CompVMInstaller/Resources/animations.zip"
    );
    net::download_pinned(
        &url,
        &cache_path(),
        Verify::Sha256(ANIMATIONS_SHA256),
        ANIMATIONS_MAX_BYTES,
    )
    .map_err(|err| {
        err.replace(
            "The download failed verification.",
            "The downloaded animation archive failed verification.",
        )
    })
}
