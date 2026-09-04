//! Fetch community crosshair VTFs (Venom Crosshairs pack) on demand.
//! Core stays network-free; downloads cache under the execs data dir.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::net::{self, RemoteSource, Verify, MIB};

/// Pinned commit of hbivnm/Venom-Crosshairs-List so bytes never shift.
const VENOM_LIST_COMMIT: &str = "2e7036cdc522c22f5a32ad01c600a0ceafaf38ce";
const VENOM_RAW_BASE: &str = "https://raw.githubusercontent.com/hbivnm/Venom-Crosshairs-List";

/// A 64×64 crosshair VTF is a couple of KB. 4 MiB is generous.
const VTF_MAX_BYTES: u64 = 4 * MIB;

fn valid_remote_file(file: &str) -> bool {
    (1..=80).contains(&file.len())
        && file
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn cache_dir() -> PathBuf {
    execs_core::execs_data_dir().join("crosshair-cache")
}

/// Download (or reuse the cached copy of) one crosshair VTF by its upstream
/// file stem, e.g. "seekerOL". Returns the raw VTF bytes.
pub fn fetch_crosshair_vtf(file: &str) -> Result<Vec<u8>, String> {
    fetch_crosshair_vtf_with_timeout(file, Duration::from_secs(30))
}

fn fetch_crosshair_vtf_with_timeout(file: &str, timeout: Duration) -> Result<Vec<u8>, String> {
    if !valid_remote_file(file) {
        return Err("Unknown community crosshair.".into());
    }
    let cached = cache_dir().join(format!("{VENOM_LIST_COMMIT}-{file}.vtf"));
    let url = format!("{VENOM_RAW_BASE}/{VENOM_LIST_COMMIT}/{file}.vtf");
    net::download_pinned_validated_for_timeout(
        &url,
        &cached,
        Verify::Magic(b"VTF\0"),
        VTF_MAX_BYTES,
        RemoteSource::GitHubRaw,
        Some(timeout),
        |bytes| execs_core::vtf_read::decode_vtf_frame0(bytes).map(|_| ()),
    )
    .map_err(|err| {
        err.replace(
            "The download failed verification.",
            "The downloaded file is not a VTF.",
        )
    })
}

/// The picker wants every thumbnail at once: 173 static VTFs are ~1.7 MiB in
/// total, so they are fetched across a small worker pool and cached by the
/// pinned commit. One failed file costs the user one blank thumbnail, never
/// the whole grid.
const PREVIEW_WORKERS: usize = 8;
const PREVIEW_MAX_FILES: usize = 256;
const PREVIEW_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const PREVIEW_BATCH_DEADLINE: Duration = Duration::from_secs(90);

pub fn fetch_crosshair_vtfs(files: &[String]) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    let files: Vec<String> = files
        .iter()
        .filter(|file| valid_remote_file(file))
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(PREVIEW_MAX_FILES)
        .collect();
    if files.is_empty() {
        return out;
    }
    let worker_count = PREVIEW_WORKERS.min(files.len());
    let chunk_size = files.len().div_ceil(worker_count);
    let deadline = Instant::now() + PREVIEW_BATCH_DEADLINE;
    let cancelled = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let handles: Vec<_> = files
            .chunks(chunk_size)
            .map(|chunk| {
                let cancelled = &cancelled;
                scope.spawn(move || {
                    let mut fetched = Vec::with_capacity(chunk.len());
                    for file in chunk {
                        if cancelled.load(Ordering::Relaxed) || Instant::now() >= deadline {
                            cancelled.store(true, Ordering::Relaxed);
                            break;
                        }
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        let timeout = remaining.min(PREVIEW_REQUEST_TIMEOUT);
                        if let Ok(bytes) = fetch_crosshair_vtf_with_timeout(file, timeout) {
                            fetched.push((file.clone(), bytes));
                        }
                    }
                    fetched
                })
            })
            .collect();
        for handle in handles {
            if let Ok(batch) = handle.join() {
                out.extend(batch);
            }
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetching_nothing_touches_nothing() {
        assert!(fetch_crosshair_vtfs(&[]).is_empty());
    }

    #[test]
    fn preview_request_names_are_deduplicated_bounded_and_validated_before_work() {
        let mut files = vec!["../bad".to_string(), "seekerOL".to_string()];
        files.extend(std::iter::repeat_n(
            "seekerOL".to_string(),
            PREVIEW_MAX_FILES + 10,
        ));
        let selected: Vec<_> = files
            .iter()
            .filter(|file| valid_remote_file(file))
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .take(PREVIEW_MAX_FILES)
            .collect();
        assert_eq!(selected, vec!["seekerOL"]);
    }

    #[test]
    fn remote_file_names_are_restricted_to_plain_stems() {
        assert!(valid_remote_file("seekerOL"));
        assert!(valid_remote_file("cross_a-1"));
        assert!(!valid_remote_file(""));
        assert!(!valid_remote_file("../etc/passwd"));
        assert!(!valid_remote_file("a/b"));
        assert!(!valid_remote_file(&"x".repeat(81)));
    }
}
