//! Fetch Yttrium's competitive-viewmodel animation sources on demand.
//! Pinned to a commit and sha256-verified; cached under the execs data dir so
//! rebuilding is offline after the first download.

use std::path::PathBuf;
use std::time::Duration;

use crate::net::{self, RemoteSource, Verify, MIB};

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
    net::download_pinned_for(
        &url,
        &cache_path(),
        Verify::Sha256(ANIMATIONS_SHA256),
        ANIMATIONS_MAX_BYTES,
        RemoteSource::GitHubRaw,
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
    net::download_pinned_validated_for_timeout(
        &url,
        &preview_cache_path(name),
        Verify::Magic(&[0xFF, 0xD8, 0xFF]),
        PREVIEW_MAX_BYTES,
        RemoteSource::GitHubRaw,
        Some(Duration::from_secs(30)),
        |bytes| {
            valid_jpeg(bytes)
                .then_some(())
                .ok_or_else(|| "The downloaded preview is not a complete JPEG.".to_string())
        },
    )
    .map_err(|err| {
        err.replace(
            "The download failed verification.",
            "The downloaded preview is not a JPEG.",
        )
    })
}

/// Minimal structural JPEG validation. Requiring an actual Start Of Frame
/// segment and a terminal EOI rejects cached HTML/error bodies with a forged
/// three-byte prefix as well as truncated downloads, without decoding pixels.
fn valid_jpeg(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return false;
    }
    let mut offset = 2usize;
    let mut saw_frame = false;
    while offset + 1 < bytes.len() {
        if bytes[offset] != 0xff {
            return false;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let Some(&marker) = bytes.get(offset) else {
            return false;
        };
        offset += 1;
        match marker {
            0xd9 => return saw_frame && offset == bytes.len(),
            0xda => return saw_frame && bytes.ends_with(&[0xff, 0xd9]),
            0x01 | 0xd0..=0xd7 => continue,
            _ => {}
        }
        let Some(length_bytes) = bytes.get(offset..offset + 2) else {
            return false;
        };
        let length = u16::from_be_bytes([length_bytes[0], length_bytes[1]]) as usize;
        if length < 2 || offset + length > bytes.len() {
            return false;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let Some(frame) = bytes.get(offset + 2..offset + length) else {
                return false;
            };
            if frame.len() < 6 {
                return false;
            }
            let height = u16::from_be_bytes([frame[1], frame[2]]);
            let width = u16::from_be_bytes([frame[3], frame[4]]);
            if width == 0 || height == 0 || width > 8192 || height > 8192 {
                return false;
            }
            saw_frame = true;
        }
        offset += length;
    }
    false
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

    #[test]
    fn preview_cache_requires_a_complete_structural_jpeg() {
        let jpeg = [
            0xff, 0xd8, // SOI
            0xff, 0xc0, 0x00, 0x08, // SOF0, six-byte payload
            0x08, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff, 0xda, 0x00, 0x02, // SOS
            0xff, 0xd9, // EOI
        ];
        assert!(valid_jpeg(&jpeg));
        assert!(!valid_jpeg(&jpeg[..jpeg.len() - 2]));
        assert!(!valid_jpeg(b"\xff\xd8\xff<html>not an image\xff\xd9"));
    }
}
