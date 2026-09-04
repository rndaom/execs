//! Fetch community hit sounds on demand, and hold the user's own picks while
//! they audition them. Core stays network-free.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::net::{self, RemoteSource, Verify, MIB};

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
/// pinned URL. Both the RIFF envelope and engine-readiness are checked before
/// a fresh or cached file is returned.
pub fn fetch_community_wav(name: &str) -> Result<Vec<u8>, String> {
    if !valid_remote_name(name) {
        return Err("Unknown community hit sound.".into());
    }
    let cached = cache_dir().join(format!("{PACK_COMMIT}-{name}.wav"));
    let url = format!("{PACK_RAW_BASE}/{PACK_COMMIT}/TF2Hitsounds/{name}.wav");
    net::download_pinned_validated_for_timeout(
        &url,
        &cached,
        Verify::Magic(b"RIFF"),
        WAV_MAX_BYTES,
        RemoteSource::GitHubRaw,
        Some(Duration::from_secs(30)),
        validate_wav,
    )
    .map_err(|err| {
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
/// The audio host. Its 128-hex object key looks like SHA-512, but live bytes
/// do not hash to that value (the service transcodes uploads before serving
/// them), so it is an opaque immutable id rather than a delivered-byte digest.
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
    hash.len() == 128
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// The whole library, from the pinned index (cached by commit).
pub fn fetch_comfig_index() -> Result<Vec<ComfigHitsound>, String> {
    let cached = cache_dir().join(format!("comfig-index-{COMFIG_INDEX_COMMIT}.json"));
    let bytes = net::download_pinned_validated_for(
        COMFIG_INDEX_URL,
        &cached,
        Verify::Magic(b"{"),
        COMFIG_INDEX_MAX_BYTES,
        RemoteSource::GitHubRaw,
        validate_comfig_index,
    )?;
    let raw = parse_comfig_index(&bytes)?;
    Ok(comfig_entries(raw))
}

fn parse_comfig_index(bytes: &[u8]) -> Result<ComfigIndexRaw, String> {
    serde_json::from_slice(bytes)
        .map_err(|err| format!("Could not read the comfig.app hits index ({err})"))
}

fn validate_comfig_index(bytes: &[u8]) -> Result<(), String> {
    let raw = parse_comfig_index(bytes)?;
    if comfig_entries(raw).is_empty() {
        return Err("The comfig.app hits index contained no usable sounds.".into());
    }
    Ok(())
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

/// One comfig.app sound by its exact 128-hex immutable object id.
pub fn fetch_comfig_wav(hash: &str) -> Result<Vec<u8>, String> {
    let hash = hash.trim().to_ascii_lowercase();
    if !valid_comfig_hash(&hash) {
        return Err("Unknown comfig.app sound.".into());
    }
    let cached = cache_dir().join(format!("comfig-{hash}.wav"));
    let url = format!("{COMFIG_HITS_BASE}/{hash}.wav");
    net::download_pinned_validated_for_timeout(
        &url,
        &cached,
        Verify::Magic(b"RIFF"),
        WAV_MAX_BYTES,
        RemoteSource::ComfigHits,
        Some(Duration::from_secs(30)),
        validate_comfig_wav,
    )
    .map_err(|err| {
        err.replace(
            "The download failed verification.",
            "comfig.app did not return a WAV for that sound.",
        )
    })
}

fn validate_wav(bytes: &[u8]) -> Result<(), String> {
    execs_core::prepare_hitsound_wav(bytes).map(|_| ())
}

/// comfig's corpus is MS-ADPCM produced by an encoder that writes a nominal
/// (and often noncanonical) byte-rate field. Source/Windows decoders ignore
/// that field, so validate every structural value needed to safely decode the
/// blocks without falsely rejecting the live library.
fn validate_comfig_wav(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("The downloaded file is not a RIFF/WAVE file.".into());
    }
    let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let end = declared
        .checked_add(8)
        .filter(|end| *end <= bytes.len())
        .ok_or("The downloaded WAV is truncated.")?;
    let mut at = 12usize;
    let mut layout: Option<(usize, usize, usize)> = None;
    let mut data = None;
    while at + 8 <= end {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        let start = at + 8;
        let chunk_end = start
            .checked_add(size)
            .filter(|chunk_end| *chunk_end <= end)
            .ok_or("The downloaded WAV has a truncated chunk.")?;
        if id == b"fmt " {
            let fmt = &bytes[start..chunk_end];
            if fmt.len() < 22 || u16::from_le_bytes(fmt[..2].try_into().unwrap()) != 2 {
                return Err("The comfig.app sound is not MS-ADPCM.".into());
            }
            let channels = usize::from(u16::from_le_bytes(fmt[2..4].try_into().unwrap()));
            let sample_rate = u32::from_le_bytes(fmt[4..8].try_into().unwrap());
            let block_align = usize::from(u16::from_le_bytes(fmt[12..14].try_into().unwrap()));
            let bits = u16::from_le_bytes(fmt[14..16].try_into().unwrap());
            let extension = usize::from(u16::from_le_bytes(fmt[16..18].try_into().unwrap()));
            let samples_per_block =
                usize::from(u16::from_le_bytes(fmt[18..20].try_into().unwrap()));
            let coefficients = usize::from(u16::from_le_bytes(fmt[20..22].try_into().unwrap()));
            let extension_end = 18usize
                .checked_add(extension)
                .ok_or("Invalid WAV extension.")?;
            let coefficient_end = 22usize
                .checked_add(
                    coefficients
                        .checked_mul(4)
                        .ok_or("Invalid WAV coefficients.")?,
                )
                .ok_or("Invalid WAV coefficients.")?;
            let header = channels.checked_mul(7).ok_or("Invalid WAV channels.")?;
            if !(1..=2).contains(&channels)
                || ![11_025, 22_050, 44_100].contains(&sample_rate)
                || bits != 4
                || extension < 4
                || extension_end > fmt.len()
                || coefficients == 0
                || coefficients > 256
                || coefficient_end > extension_end
                || block_align < header
            {
                return Err("The comfig.app sound has an invalid MS-ADPCM format.".into());
            }
            let payload_nibbles = (block_align - header)
                .checked_mul(2)
                .ok_or("Invalid WAV block size.")?;
            if !payload_nibbles.is_multiple_of(channels)
                || samples_per_block != 2 + payload_nibbles / channels
            {
                return Err("The comfig.app sound has an invalid MS-ADPCM block layout.".into());
            }
            layout = Some((channels, block_align, coefficients));
        } else if id == b"data" {
            data = Some(&bytes[start..chunk_end]);
        }
        at = chunk_end
            .checked_add(size & 1)
            .filter(|next| *next <= end)
            .ok_or("The downloaded WAV has invalid padding.")?;
    }
    if at != end {
        return Err("The downloaded WAV has a truncated chunk header.".into());
    }
    let (channels, block_align, coefficients) =
        layout.ok_or("The downloaded WAV has no format chunk.")?;
    let data = data
        .filter(|data| !data.is_empty())
        .ok_or("The downloaded WAV is empty.")?;
    if !data.len().is_multiple_of(block_align)
        || data.chunks_exact(block_align).any(|block| {
            block[..channels]
                .iter()
                .any(|value| usize::from(*value) >= coefficients)
        })
    {
        return Err("The comfig.app sound has invalid MS-ADPCM data.".into());
    }
    Ok(())
}

/// Where a picked-and-prepared user file waits between the file dialog and
/// Apply. Tokens are random and the directory is app data, so the frontend
/// never handles a path it could point somewhere else.
fn picked_location() -> Result<(PathBuf, PathBuf), String> {
    let root = execs_core::try_execs_data_dir()?;
    let dir = root.join("hitsound-cache").join("picked");
    Ok((root, dir))
}

fn valid_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn stash_picked(wav: &[u8]) -> Result<String, String> {
    let token = execs_core::hash::random_token();
    let (root, dir) = picked_location()?;
    // Atomic: Apply reads the stash back by token, and a file cut off
    // mid-write would install as a truncated WAV.
    execs_core::hash::write_atomic_within(&root, &dir.join(format!("{token}.wav")), wav)
        .map_err(|err| err.to_string())?;
    Ok(token)
}

pub fn read_picked(token: &str) -> Result<Vec<u8>, String> {
    if !valid_token(token) {
        return Err("That picked file is no longer available.".into());
    }
    let (root, dir) = picked_location()?;
    let path = dir.join(format!("{token}.wav"));
    execs_core::hash::validate_file_within(&root, &path)
        .map_err(|_| "That picked file is no longer available — choose it again.".to_string())?;
    net::read_file_capped(&path, WAV_MAX_BYTES)
        .map_err(|_| "That picked file is no longer available — choose it again.".to_string())
}

/// Delete abandoned file-dialog staging WAVs while preserving every token a
/// profile still references. Command/startup code supplies the references so
/// this networking module never needs to read or mutate profile manifests.
pub fn gc_picked(referenced_tokens: &[String], max_age: Duration) -> Result<(), String> {
    let (root, dir) = picked_location()?;
    gc_picked_in(&root, &dir, referenced_tokens, max_age, SystemTime::now())
}

fn gc_picked_in(
    root: &Path,
    dir: &Path,
    referenced_tokens: &[String],
    max_age: Duration,
    now: SystemTime,
) -> Result<(), String> {
    let referenced: HashSet<&str> = referenced_tokens
        .iter()
        .map(String::as_str)
        .filter(|token| valid_token(token))
        .collect();
    match std::fs::symlink_metadata(dir) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.to_string()),
        Ok(_) => execs_core::hash::validate_dir_within(root, dir).map_err(|err| err.to_string())?,
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !entry.file_type().map_err(|err| err.to_string())?.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(token) = name.strip_suffix(".wav") else {
            continue;
        };
        if !valid_token(token) || referenced.contains(token) {
            continue;
        }
        execs_core::hash::validate_file_within(root, &path).map_err(|err| err.to_string())?;
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map_err(|err| err.to_string())?;
        if now.duration_since(modified).unwrap_or_default() < max_age {
            continue;
        }
        execs_core::hash::remove_file_force_within(root, &path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/j"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "could not create test junction");
    }

    #[cfg(unix)]
    fn unlink_dir(link: &Path) {
        std::fs::remove_file(link).unwrap();
    }

    #[cfg(windows)]
    fn unlink_dir(link: &Path) {
        std::fs::remove_dir(link).unwrap();
    }

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
            killsounds: vec![
                ComfigIndexEntry {
                    name: "  Kill  Bell .WAV".into(),
                    hash: "b".repeat(128),
                },
                ComfigIndexEntry {
                    name: "old short id.wav".into(),
                    hash: "c".repeat(64),
                },
            ],
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
        let token = execs_core::hash::random_token();
        assert!(valid_token(&token), "{token}");
        assert_eq!(token, token.to_ascii_lowercase());
        assert_ne!(token, execs_core::hash::random_token());
        assert!(read_picked("../../etc/passwd").is_err());
        assert!(read_picked("0123456789abcdef0123456789abcdef").is_err());
    }

    #[test]
    fn comfig_object_ids_are_exact_128_hex_values() {
        assert!(valid_comfig_hash(&"a".repeat(128)));
        assert!(!valid_comfig_hash(&"a".repeat(127)));
        assert!(!valid_comfig_hash(&"A".repeat(128)));
        assert!(!valid_comfig_hash(&"g".repeat(128)));
    }

    #[test]
    fn picked_gc_preserves_references_and_young_files() {
        let dir = std::env::temp_dir().join(format!(
            "execs-picked-gc-{}-{}",
            std::process::id(),
            execs_core::hash::random_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let old = "0".repeat(32);
        let kept = "1".repeat(32);
        let young = "2".repeat(32);
        std::fs::write(dir.join(format!("{old}.wav")), b"old").unwrap();
        std::fs::write(dir.join(format!("{kept}.wav")), b"kept").unwrap();
        std::fs::write(dir.join(format!("{young}.wav")), b"young").unwrap();

        gc_picked_in(
            &dir,
            &dir,
            std::slice::from_ref(&kept),
            Duration::from_secs(24 * 60 * 60),
            SystemTime::now(),
        )
        .unwrap();
        assert!(dir.join(format!("{old}.wav")).exists());
        assert!(dir.join(format!("{kept}.wav")).exists());
        assert!(dir.join(format!("{young}.wav")).exists());

        let future = SystemTime::now() + Duration::from_secs(2 * 24 * 60 * 60);
        gc_picked_in(
            &dir,
            &dir,
            std::slice::from_ref(&kept),
            Duration::from_secs(24 * 60 * 60),
            future,
        )
        .unwrap();

        assert!(!dir.join(format!("{old}.wav")).exists());
        assert!(dir.join(format!("{kept}.wav")).exists());
        assert!(!dir.join(format!("{young}.wav")).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn picked_gc_refuses_a_linked_directory_without_touching_the_victim() {
        let root = std::env::temp_dir().join(format!(
            "execs-picked-link-root-{}-{}",
            std::process::id(),
            execs_core::hash::random_token()
        ));
        let victim = std::env::temp_dir().join(format!(
            "execs-picked-link-victim-{}-{}",
            std::process::id(),
            execs_core::hash::random_token()
        ));
        std::fs::create_dir_all(root.join("hitsound-cache")).unwrap();
        std::fs::create_dir_all(&victim).unwrap();
        let token = "3".repeat(32);
        let victim_file = victim.join(format!("{token}.wav"));
        std::fs::write(&victim_file, b"victim bytes").unwrap();
        let linked = root.join("hitsound-cache").join("picked");
        link_dir(&victim, &linked);

        let result = gc_picked_in(
            &root,
            &linked,
            &[],
            Duration::ZERO,
            SystemTime::now() + Duration::from_secs(1),
        );

        assert!(result.is_err());
        assert_eq!(std::fs::read(&victim_file).unwrap(), b"victim bytes");
        unlink_dir(&linked);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(victim).unwrap();
    }

    #[test]
    #[ignore = "live network regression"]
    fn live_comfig_object_id_resolves_to_a_usable_wav() {
        let raw: ComfigIndexRaw = net::get_json_for(
            &net::api_client().unwrap(),
            COMFIG_INDEX_URL,
            RemoteSource::GitHubRaw,
        )
        .unwrap();
        let first = comfig_entries(raw).into_iter().next().unwrap();
        let url = format!("{COMFIG_HITS_BASE}/{}.wav", first.hash);
        let bytes = net::download_bytes_for(&url, WAV_MAX_BYTES, RemoteSource::ComfigHits).unwrap();
        let actual = execs_core::hash::sha512_hex(&bytes);
        println!(
            "url={url} bytes={} prefix={:?} published={} actual={actual}",
            bytes.len(),
            bytes.get(..4),
            first.hash
        );
        assert_ne!(
            actual, first.hash,
            "the published key is intentionally not claimed as a byte digest"
        );
        validate_comfig_wav(&bytes).unwrap();
    }
}
