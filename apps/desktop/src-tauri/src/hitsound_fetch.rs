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

// ---------------------------------------------------------------------------
// comfig.app hits library
// ---------------------------------------------------------------------------

/// The hits index lives in the comfig-app repo (MIT); pinned so the list
/// never shifts under a profile that references an entry by hash.
const COMFIG_INDEX_COMMIT: &str = "3f5fdf9ad7d3952921587169faa368f80fc5b755";
const COMFIG_INDEX_URL: &str =
    "https://raw.githubusercontent.com/mastercomfig/comfig-app/3f5fdf9ad7d3952921587169faa368f80fc5b755/src/ssg/hitsounds.json";
const COMFIG_INDEX_MAX_BYTES: u64 = 4 * MIB;
/// The audio host. Files are addressed by their SHA-512, so the hash is both
/// the id and the verification.
const COMFIG_HITS_BASE: &str = "https://hits.comfig.app";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfigHitsound {
    pub name: String,
    pub hash: String,
    /// Which list upstream files it under; either slot still accepts it.
    pub kind: execs_core::HitsoundKind,
}

#[derive(Debug, serde::Deserialize)]
struct ComfigIndexRaw {
    #[serde(default)]
    hitsounds: Vec<ComfigIndexEntry>,
    #[serde(default)]
    killsounds: Vec<ComfigIndexEntry>,
}

#[derive(Debug, serde::Deserialize)]
struct ComfigIndexEntry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    hash: String,
}

fn valid_comfig_hash(hash: &str) -> bool {
    (32..=128).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The whole library, from the pinned index (cached by commit).
pub fn fetch_comfig_index() -> Result<Vec<ComfigHitsound>, String> {
    let cached = cache_dir().join(format!("comfig-index-{COMFIG_INDEX_COMMIT}.json"));
    let bytes = net::download_pinned(
        COMFIG_INDEX_URL,
        &cached,
        Verify::Magic(b"{"),
        COMFIG_INDEX_MAX_BYTES,
    )?;
    let raw: ComfigIndexRaw = serde_json::from_slice(&bytes)
        .map_err(|err| format!("Could not read the comfig.app hits index ({err})"))?;
    Ok(comfig_entries(raw))
}

fn comfig_entries(raw: ComfigIndexRaw) -> Vec<ComfigHitsound> {
    let mut out = Vec::with_capacity(raw.hitsounds.len() + raw.killsounds.len());
    let mut seen = std::collections::BTreeSet::new();
    for (list, kind) in [
        (raw.hitsounds, execs_core::HitsoundKind::Hit),
        (raw.killsounds, execs_core::HitsoundKind::Kill),
    ] {
        for entry in list {
            let hash = entry.hash.trim().to_ascii_lowercase();
            if !valid_comfig_hash(&hash) || !seen.insert(hash.clone()) {
                continue;
            }
            let name = comfig_display_name(&entry.name);
            if name.is_empty() {
                continue;
            }
            out.push(ComfigHitsound { name, hash, kind });
        }
    }
    out
}

/// Upstream names are upload file names; show them without the extension
/// and with separators turned back into spaces.
fn comfig_display_name(raw: &str) -> String {
    let stem = raw
        .trim()
        .trim_end_matches(".wav")
        .trim_end_matches(".WAV")
        .trim_end_matches(".mp3");
    let spaced: String = stem
        .chars()
        .map(|c| if c == '_' || c == '-' { ' ' } else { c })
        .collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// One comfig.app sound by hash, cached forever (the hash is the content).
pub fn fetch_comfig_wav(hash: &str) -> Result<Vec<u8>, String> {
    let hash = hash.trim().to_ascii_lowercase();
    if !valid_comfig_hash(&hash) {
        return Err("Unknown comfig.app sound.".into());
    }
    let cached = cache_dir().join(format!("comfig-{hash}.wav"));
    let url = format!("{COMFIG_HITS_BASE}/{hash}.wav");
    net::download_pinned(&url, &cached, Verify::Magic(b"RIFF"), WAV_MAX_BYTES).map_err(|err| {
        err.replace(
            "The download failed verification.",
            "comfig.app did not return a WAV for that sound.",
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
    fn comfig_index_entries_are_deduped_validated_and_named_for_people() {
        let raw = ComfigIndexRaw {
            hitsounds: vec![
                ComfigIndexEntry {
                    name: "quake_3-hit.wav".into(),
                    hash: "A".repeat(128),
                },
                ComfigIndexEntry {
                    name: "dupe.wav".into(),
                    hash: "a".repeat(128),
                },
                ComfigIndexEntry {
                    name: "bad".into(),
                    hash: "zz".into(),
                },
            ],
            killsounds: vec![ComfigIndexEntry {
                name: "  Kill  Bell .WAV".into(),
                hash: "b".repeat(64),
            }],
        };
        let entries = comfig_entries(raw);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "quake 3 hit");
        assert_eq!(entries[0].hash, "a".repeat(128));
        assert_eq!(entries[0].kind, execs_core::HitsoundKind::Hit);
        assert_eq!(entries[1].name, "Kill Bell");
        assert_eq!(entries[1].kind, execs_core::HitsoundKind::Kill);
        assert!(fetch_comfig_wav("../x").is_err());
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
