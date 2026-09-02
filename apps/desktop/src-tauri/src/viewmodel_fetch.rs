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

/// CompVMInstaller's "visual image guide": one 960×540 in-game screenshot per
/// option (what you see with the weapon out) plus one blank per class (what
/// you see once it is hidden). Fetched from the same pinned commit as the
/// animation sources, one image at a time, and cached forever by commit.
const PREVIEW_MAX_BYTES: u64 = 4 * MIB;

fn valid_preview_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn preview_cache_path(name: &str) -> PathBuf {
    execs_core::execs_data_dir()
        .join("studio")
        .join("previews")
        .join(format!("{ANIMATIONS_COMMIT}-{name}.jpg"))
}

/// One preview JPEG by its upstream resource stem, e.g. `scout_scattergun`.
pub fn fetch_preview_image(name: &str) -> Result<Vec<u8>, String> {
    if !valid_preview_name(name) {
        return Err("Unknown viewmodel preview.".into());
    }
    let url = format!(
        "{ANIMATIONS_URL}/{ANIMATIONS_COMMIT}/Project/CompVMInstaller/Resources/{name}.jpg"
    );
    net::download_pinned(
        &url,
        &preview_cache_path(name),
        Verify::Magic(&[0xFF, 0xD8, 0xFF]),
        PREVIEW_MAX_BYTES,
    )
    .map_err(|err| {
        err.replace(
            "The download failed verification.",
            "The downloaded preview is not a JPEG.",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_names_are_plain_lowercase_stems() {
        assert!(valid_preview_name("scout_scattergun"));
        assert!(valid_preview_name("pyro_flamethrower_inspect"));
        assert!(!valid_preview_name(""));
        assert!(!valid_preview_name("Scout_Blank"));
        assert!(!valid_preview_name("../x"));
        assert!(!valid_preview_name("a/b"));
        assert!(!valid_preview_name(&"x".repeat(65)));
    }

    #[test]
    fn preview_cache_is_keyed_by_the_pinned_commit() {
        let path = preview_cache_path("scout_blank");
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with(ANIMATIONS_COMMIT));
        assert!(name.ends_with("-scout_blank.jpg"));
    }
}
