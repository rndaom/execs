//! Fetch community crosshair VTFs (Venom Crosshairs pack) on demand.
//! Core stays network-free; downloads cache under the execs data dir.

use std::path::PathBuf;

use crate::net::{self, Verify, MIB};

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
    if !valid_remote_file(file) {
        return Err("Unknown community crosshair.".into());
    }
    let cached = cache_dir().join(format!("{VENOM_LIST_COMMIT}-{file}.vtf"));
    let url = format!("{VENOM_RAW_BASE}/{VENOM_LIST_COMMIT}/{file}.vtf");
    net::download_pinned(&url, &cached, Verify::Magic(b"VTF\0"), VTF_MAX_BYTES).map_err(|err| {
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

pub fn fetch_crosshair_vtfs(files: &[String]) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut out = std::collections::BTreeMap::new();
    if files.is_empty() {
        return out;
    }
    let worker_count = PREVIEW_WORKERS.min(files.len());
    let chunk_size = files.len().div_ceil(worker_count);
    std::thread::scope(|scope| {
        let handles: Vec<_> = files
            .chunks(chunk_size)
            .map(|chunk| {
                scope.spawn(move || {
                    let mut fetched = Vec::with_capacity(chunk.len());
                    for file in chunk {
                        if let Ok(bytes) = fetch_crosshair_vtf(file) {
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
    fn remote_file_names_are_restricted_to_plain_stems() {
        assert!(valid_remote_file("seekerOL"));
        assert!(valid_remote_file("cross_a-1"));
        assert!(!valid_remote_file(""));
        assert!(!valid_remote_file("../etc/passwd"));
        assert!(!valid_remote_file("a/b"));
        assert!(!valid_remote_file(&"x".repeat(81)));
    }
}
