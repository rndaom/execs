//! Fetch community crosshair VTFs (Venom Crosshairs pack) on demand.
//! Core stays network-free; downloads cache under the execs data dir.

use std::path::PathBuf;

/// Pinned commit of hbivnm/Venom-Crosshairs-List so bytes never shift.
const VENOM_LIST_COMMIT: &str = "2e7036cdc522c22f5a32ad01c600a0ceafaf38ce";
const VENOM_RAW_BASE: &str = "https://raw.githubusercontent.com/hbivnm/Venom-Crosshairs-List";

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
    let cache = cache_dir();
    let cached = cache.join(format!("{VENOM_LIST_COMMIT}-{file}.vtf"));
    if let Ok(bytes) = std::fs::read(&cached) {
        if bytes.starts_with(b"VTF\0") {
            return Ok(bytes);
        }
    }
    let url = format!("{VENOM_RAW_BASE}/{VENOM_LIST_COMMIT}/{file}.vtf");
    let bytes = crate::comfig_fetch::download_bytes(&url)?;
    if !bytes.starts_with(b"VTF\0") {
        return Err("The downloaded file is not a VTF.".into());
    }
    let _ = std::fs::create_dir_all(&cache);
    let _ = std::fs::write(&cached, &bytes);
    Ok(bytes)
}
