//! On-disk preloader state: where snapshots live, what we patched, and the
//! game-update fingerprint that invalidates them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::hash::sha256_hex;
use crate::vpk::{patch_vpk_entry, VpkEntryLocation};

use super::{MISC_VPK, PRELOADER_VPK};

pub(crate) fn preloader_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("preloader")
}

pub(crate) fn originals_dir(data_dir: &Path) -> PathBuf {
    preloader_dir(data_dir).join("originals")
}

pub(crate) fn state_path(data_dir: &Path) -> PathBuf {
    preloader_dir(data_dir).join("state.json")
}

pub(crate) fn snapshot_path(data_dir: &Path, rel: &str) -> PathBuf {
    originals_dir(data_dir).join(rel.replace('/', "__"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PatchedEntry {
    pub owner: String,
    pub original_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkipNotice {
    pub file: String,
    pub mod_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PreloaderState {
    pub schema: u32,
    pub vpk_len: u64,
    pub vpk_mtime_ms: u128,
    #[serde(default)]
    pub addons: Vec<String>,
    #[serde(default)]
    pub particle_mods: Vec<String>,
    #[serde(default)]
    pub patched: BTreeMap<String, PatchedEntry>,
    #[serde(default)]
    pub skipped: Vec<SkipNotice>,
    /// Profiles the shared preload cfg was enabled on for mods, so a revert
    /// can clean them up even after the active profile changed.
    #[serde(default)]
    pub preload_profiles: Vec<String>,
}

pub(crate) fn load_state(data_dir: &Path) -> PreloaderState {
    std::fs::read(state_path(data_dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn save_state(data_dir: &Path, state: &PreloaderState) -> Result<(), String> {
    std::fs::create_dir_all(preloader_dir(data_dir))
        .map_err(|err| format!("Could not prepare the preloader folder: {err}"))?;
    let json = serde_json::to_vec_pretty(state).map_err(|err| err.to_string())?;
    std::fs::write(state_path(data_dir), json)
        .map_err(|err| format!("Could not save preloader state: {err}"))
}

pub(crate) fn vpk_fingerprint(path: &Path) -> Result<(u64, u128), String> {
    let meta =
        std::fs::metadata(path).map_err(|err| format!("Could not read {MISC_VPK}: {err}"))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok((meta.len(), mtime))
}

pub(crate) fn misc_vpk_path(tf2_root: &Path) -> PathBuf {
    tf2_root.join("tf").join(MISC_VPK)
}

/// Whether the mods preloader still needs the shared `execs_preload` cfg and
/// its launch token. The cfg is shared with viewmodel packs, so removing a
/// viewmodel pack must not take it away while patched particles or addon
/// content are still installed — that is the "installed but nothing works"
/// failure mode on Valve Casual.
pub fn preload_is_wanted(data_dir: &Path, tf2_root: &Path) -> bool {
    let state = load_state(data_dir);
    !state.patched.is_empty()
        || !state.addons.is_empty()
        || !state.particle_mods.is_empty()
        || tf2_root
            .join("tf")
            .join("custom")
            .join(PRELOADER_VPK)
            .is_file()
}

/// Snapshots left behind by an interrupted run may not be tracked in state
/// (the crash hit between the snapshot write and the state save). Adopt them
/// so the restore pass puts their pristine bytes back; entries that turn out
/// not to belong are dropped again when the restore cannot match them.
pub(crate) fn adopt_orphaned_snapshots(data_dir: &Path, state: &mut PreloaderState) {
    let Ok(dir) = std::fs::read_dir(originals_dir(data_dir)) else {
        return;
    };
    for file in dir.flatten() {
        let Some(name) = file.file_name().to_str().map(|name| name.to_string()) else {
            continue;
        };
        let rel = name.replace("__", "/");
        if state.patched.contains_key(&rel) {
            continue;
        }
        let sha = std::fs::read(file.path())
            .map(|bytes| sha256_hex(&bytes))
            .unwrap_or_default();
        state.patched.insert(
            rel,
            PatchedEntry {
                owner: "recovered".into(),
                original_sha256: sha,
            },
        );
    }
}

/// Restore tracked entries from their snapshots, one at a time, persisting
/// state after every entry. Success (and impossible restores — entry gone or
/// resized by a game update) drop the tracking; a plain I/O failure keeps the
/// entry tracked so a later attempt can finish the job.
pub(crate) fn restore_patched_entries(
    tf2_root: &Path,
    data_dir: &Path,
    state: &mut PreloaderState,
    entries: &BTreeMap<String, VpkEntryLocation>,
) -> Result<Vec<String>, String> {
    let vpk_path = misc_vpk_path(tf2_root);
    let mut failures = Vec::new();
    let tracked: Vec<String> = state.patched.keys().cloned().collect();
    for rel in tracked {
        let snapshot = snapshot_path(data_dir, &rel);
        let Ok(original) = std::fs::read(&snapshot) else {
            failures.push(format!("{rel}: snapshot is missing"));
            state.patched.remove(&rel);
            save_state(data_dir, state)?;
            continue;
        };
        let Some(entry) = entries.get(&rel) else {
            failures.push(format!("{rel}: no longer in {MISC_VPK}"));
            state.patched.remove(&rel);
            let _ = std::fs::remove_file(&snapshot);
            save_state(data_dir, state)?;
            continue;
        };
        if entry.length as usize != original.len() {
            failures.push(format!("{rel}: stock size changed (game update)"));
            state.patched.remove(&rel);
            let _ = std::fs::remove_file(&snapshot);
            save_state(data_dir, state)?;
            continue;
        }
        match patch_vpk_entry(&vpk_path, entry, &original) {
            Ok(()) => {
                state.patched.remove(&rel);
                let _ = std::fs::remove_file(&snapshot);
            }
            Err(err) => {
                failures.push(format!("{rel}: {}", err.message()));
            }
        }
        save_state(data_dir, state)?;
    }
    Ok(failures)
}
