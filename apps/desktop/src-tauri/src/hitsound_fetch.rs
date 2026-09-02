//! Fetch community hit sounds on demand, and hold the user's own picks while
//! they audition them. Core stays network-free.

use std::path::PathBuf;

use crate::net::{self, Verify, MIB};

/// Pinned commit of WishingStardust/TF2Hitsounds so bytes never shift.
const PACK_COMMIT: &str = "f5fea33b36931b9bf908de45d8f725530910457f";
const PACK_RAW_BASE: &str = "https://raw.githubusercontent.com/WishingStardust/TF2Hitsounds";

/// The largest file in the pack is under 1 MiB; 8 MiB matches the core cap.
const WAV_MAX_BYTES: u64 = 8 * MIB;

fn valid_remote_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

fn cache_dir() -> PathBuf {
    execs_core::execs_data_dir().join("hitsound-cache")
}

/// One community WAV by its upstream stem, e.g. `quack`, from cache or the
/// pinned URL. Only the RIFF magic is verified here; the engine-readiness
/// check happens in core when the file is prepared for install.
pub fn fetch_community_wav(name: &str) -> Result<Vec<u8>, String> {
    if !valid_remote_name(name) {
        return Err("Unknown community hit sound.".into());
    }
    let cached = cache_dir().join(format!("{PACK_COMMIT}-{name}.wav"));
    let url = format!("{PACK_RAW_BASE}/{PACK_COMMIT}/TF2Hitsounds/{name}.wav");
    net::download_pinned(&url, &cached, Verify::Magic(b"RIFF"), WAV_MAX_BYTES).map_err(|err| {
        err.replace(
            "The download failed verification.",
            "The downloaded file is not a WAV.",
        )
    })
}

/// Where a picked-and-prepared user file waits between the file dialog and
/// Apply. Tokens are random and the directory is app data, so the frontend
/// never handles a path it could point somewhere else.
fn picked_dir() -> PathBuf {
    cache_dir().join("picked")
}

fn valid_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn stash_picked(wav: &[u8]) -> Result<String, String> {
    let token = uuid_token();
    let dir = picked_dir();
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    std::fs::write(dir.join(format!("{token}.wav")), wav).map_err(|err| err.to_string())?;
    Ok(token)
}

pub fn read_picked(token: &str) -> Result<Vec<u8>, String> {
    if !valid_token(token) {
        return Err("That picked file is no longer available.".into());
    }
    std::fs::read(picked_dir().join(format!("{token}.wav")))
        .map_err(|_| "That picked file is no longer available — choose it again.".to_string())
}

fn uuid_token() -> String {
    // 128 random bits from the OS, hex-encoded. `sha256_hex` of the entropy
    // keeps this dependency-free in the app crate.
    let mut seed = [0u8; 32];
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    seed[..16].copy_from_slice(&nanos.to_le_bytes());
    let pid = std::process::id() as u128;
    seed[16..].copy_from_slice(&pid.rotate_left(17).to_le_bytes());
    let addr = &seed as *const _ as usize as u128;
    for (i, byte) in addr.to_le_bytes().iter().enumerate() {
        seed[i] ^= byte;
    }
    execs_core::hash::sha256_hex(&seed)[..32].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_names_are_restricted_to_plain_stems() {
        assert!(valid_remote_name("quack"));
        assert!(valid_remote_name("m1garand"));
        assert!(!valid_remote_name(""));
        assert!(!valid_remote_name("Quack"));
        assert!(!valid_remote_name("../etc"));
        assert!(!valid_remote_name("a/b"));
    }

    #[test]
    fn tokens_are_32_hex_and_unknown_ones_are_refused() {
        let token = uuid_token();
        assert!(valid_token(&token), "{token}");
        assert_ne!(token, uuid_token());
        assert!(read_picked("../../etc/passwd").is_err());
        assert!(read_picked("0123456789abcdef0123456789abcdef").is_err());
    }
}
