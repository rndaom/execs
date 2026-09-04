//! On-disk preloader state: where snapshots live, what we patched, and the
//! game-update fingerprint that invalidates them.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::hash::{sha256_hex, write_atomic};
use crate::vpk::{crc32, patch_vpk_entry, read_vpk_entry, VpkEntryLocation};

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

/// Snapshots are named by `sha256(rel)`. The old `/` -> `__` mangling was not
/// injective: any entry path containing `__` round-tripped to a different rel,
/// so `adopt_orphaned_snapshots` inserted a bogus entry while the real snapshot
/// was orphaned and never restored.
pub(crate) fn snapshot_path(data_dir: &Path, rel: &str) -> PathBuf {
    originals_dir(data_dir).join(sha256_hex(rel.as_bytes()))
}

/// The sidecar that makes a snapshot self-describing: `<hash>.json` beside
/// `<hash>`, carrying the rel the hash was made from and what the bytes are.
pub(crate) fn sidecar_path(data_dir: &Path, rel: &str) -> PathBuf {
    originals_dir(data_dir).join(format!("{}.json", sha256_hex(rel.as_bytes())))
}

/// What a snapshot file holds, written beside it at snapshot time. `state.json`
/// is the index, but a crash in the middle of writing it (or a user deleting
/// it) must not turn pristine snapshots into unexplained files: from the
/// sidecar alone the tracking can be rebuilt and every byte put back.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotSidecar {
    pub rel: String,
    pub original_sha256: String,
    pub size: u64,
    /// Whether the bytes hashed to the directory's stock CRC when taken.
    pub pristine: bool,
}

/// Write a snapshot and its sidecar, both atomically, sidecar last so a
/// sidecar on disk always describes a complete snapshot.
pub(crate) fn write_snapshot(
    data_dir: &Path,
    rel: &str,
    bytes: &[u8],
    pristine: bool,
) -> Result<(), String> {
    write_atomic(&snapshot_path(data_dir, rel), bytes)
        .map_err(|err| format!("Could not snapshot {rel}: {err}"))?;
    let sidecar = SnapshotSidecar {
        rel: rel.to_string(),
        original_sha256: sha256_hex(bytes),
        size: bytes.len() as u64,
        pristine,
    };
    let json = serde_json::to_vec_pretty(&sidecar).map_err(|err| err.to_string())?;
    write_atomic(&sidecar_path(data_dir, rel), &json)
        .map_err(|err| format!("Could not describe the snapshot of {rel}: {err}"))
}

/// Delete a snapshot the restore has consumed, sidecar included.
pub(crate) fn remove_snapshot(data_dir: &Path, rel: &str) {
    let _ = std::fs::remove_file(snapshot_path(data_dir, rel));
    let _ = std::fs::remove_file(sidecar_path(data_dir, rel));
}

/// Clear the snapshot folder of what cannot matter (torn `.execs-part`
/// writes, sidecars whose snapshot is gone) and remove it once it is empty.
/// A snapshot still there is one no restore could explain, and it stays: it
/// may be the only copy of a stock file.
pub(crate) fn tidy_originals_dir(data_dir: &Path) {
    let dir = originals_dir(data_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let torn = name.ends_with(crate::hash::PART_SUFFIX);
        let orphan_sidecar = name
            .strip_suffix(".json")
            .is_some_and(|stem| !dir.join(stem).is_file());
        if torn || orphan_sidecar {
            let _ = std::fs::remove_file(&path);
        }
    }
    // Fails while anything is left, which is the point.
    let _ = std::fs::remove_dir(&dir);
}

fn is_hashed_name(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Where a snapshot written before the sha256 naming would live. The adopt
/// pass reads such names off disk rather than constructing them, so this only
/// exists to build the legacy fixture in tests.
#[cfg(test)]
pub(crate) fn legacy_snapshot_path(data_dir: &Path, rel: &str) -> PathBuf {
    originals_dir(data_dir).join(rel.replace('/', "__"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PatchedEntry {
    pub owner: String,
    /// Hash of the pristine bytes in the snapshot.
    pub original_sha256: String,
    /// Hash of the bytes we wrote over them. Checked before a restore: if the
    /// entry no longer holds what we wrote, a game update replaced it with
    /// something the same size and writing the snapshot back would corrupt it.
    #[serde(default)]
    pub patched_sha256: String,
    /// The entry path this snapshot belongs to. Snapshot file names are a hash
    /// now, so the rel has to be stored rather than decoded from the name.
    #[serde(default)]
    pub rel: String,
    /// Whether the snapshot's bytes hashed to the directory's stock CRC when
    /// it was taken. False means the entry was already modified before execs
    /// first touched it (an earlier install whose tracking was lost, or
    /// another tool): a restore can only put those bytes back, not stock.
    #[serde(default = "default_true")]
    pub pristine: bool,
}

fn default_true() -> bool {
    true
}

/// True when `bytes` are exactly the stock content of `entry`. The `_dir.vpk`
/// is never rewritten, so its CRC is Valve's own record of what the entry
/// should hold — the ground truth every snapshot decision rests on.
pub(crate) fn is_stock(bytes: &[u8], entry: &VpkEntryLocation) -> bool {
    bytes.len() == entry.length as usize && crc32(bytes) == entry.crc
}

/// Wording shared by the apply report, the revert report and the status for
/// a patched entry execs holds no snapshot for.
pub(crate) const UNTRACKED_REASON: &str = "is modified in tf2_misc but execs has no snapshot for it (an earlier install lost its tracking, or another tool patched it); its effects may point at materials that are no longer installed. Verify game files in Steam to get the stock file back";

/// `particles/*.pcf` entries whose live bytes are not stock and that no
/// snapshot covers. execs cannot restore these: they are stale patches from an
/// install whose tracking was lost, or from another tool, and their effects
/// may reference materials this install does not ship, which the engine
/// reports as an "unimplemented sprite renderer" console flood. Reported so
/// the user knows to verify game files in Steam.
pub(crate) fn untracked_modified_particles(
    vpk_path: &Path,
    entries: &BTreeMap<String, VpkEntryLocation>,
    state: &PreloaderState,
) -> Vec<String> {
    entries
        .iter()
        .filter(|(rel, entry)| {
            rel.starts_with("particles/")
                && rel.ends_with(".pcf")
                && entry.preload_len == 0
                && !state.patched.contains_key(*rel)
        })
        .filter(|(_, entry)| {
            read_vpk_entry(vpk_path, entry).is_ok_and(|bytes| !is_stock(&bytes, entry))
        })
        .map(|(rel, _)| rel.clone())
        .collect()
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
    /// Length of `tf2_misc_dir.vpk` plus every sibling `_NNN.vpk`. The patched
    /// bytes live in the siblings, so watching the directory file alone missed
    /// a content update that rewrote an archive.
    pub vpk_len: u64,
    /// Written by an older build under the abandoned mtime rule. Still
    /// deserialized so an existing `state.json` loads, never read.
    #[serde(default, skip_serializing)]
    pub vpk_mtime_ms: u128,
    #[serde(default)]
    pub addons: Vec<String>,
    #[serde(default)]
    pub particle_mods: Vec<String>,
    /// Ids of the active profile's own mods whose particles are installed, so
    /// the status can name them beside the library's.
    #[serde(default)]
    pub profile_particle_mods: Vec<String>,
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

/// Atomic, like every file that matters: state.json is the index of which
/// official entries hold our bytes, and a truncated index is what turns
/// pristine snapshots into files nothing knows how to use.
pub(crate) fn save_state(data_dir: &Path, state: &PreloaderState) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(state).map_err(|err| err.to_string())?;
    write_atomic(&state_path(data_dir), &json)
        .map_err(|err| format!("Could not save preloader state: {err}"))
}

/// Total length of the directory file and every sibling archive beside it.
///
/// The patched bytes all live in the siblings (`patch_vpk_entry` refuses
/// dir-resident entries), so a fingerprint taken from `tf2_misc_dir.vpk` alone
/// missed a content update that rewrote `_000.vpk` while the directory file
/// kept its length — and the restore pass then wrote stale snapshot bytes at
/// stale offsets into fresh game data. mtime drift is deliberately not part of
/// this: only a resize invalidates snapshots.
pub(crate) fn vpk_fingerprint(path: &Path) -> Result<u64, String> {
    let meta =
        std::fs::metadata(path).map_err(|err| format!("Could not read {MISC_VPK}: {err}"))?;
    let mut total = meta.len();
    let Some(stem) = path.file_name().and_then(|name| name.to_str()) else {
        return Ok(total);
    };
    let Some(prefix) = stem.strip_suffix("_dir.vpk") else {
        return Ok(total);
    };
    let Some(parent) = path.parent() else {
        return Ok(total);
    };
    for index in 0..1000u32 {
        let sibling = parent.join(format!("{prefix}_{index:03}.vpk"));
        match std::fs::metadata(&sibling) {
            Ok(meta) => total = total.wrapping_add(meta.len()),
            // Archives are numbered contiguously from 000.
            Err(_) => break,
        }
    }
    Ok(total)
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

/// Snapshots on disk that state does not track — the crash hit between the
/// snapshot write and the state save, or state.json itself was lost — are
/// adopted so the restore pass puts their pristine bytes back. Entries that
/// turn out not to belong are dropped again when the restore cannot match
/// them. Returns how many were adopted.
///
/// Three ways to know what a snapshot is, tried in order: the sidecar written
/// beside it; failing that, the archive's own entry list (`entries`), since a
/// snapshot is named by the hash of its rel; and for a file from a build that
/// mangled `/` to `__`, the name itself (migrated to the hashed name here).
/// A hashed snapshot none of these explain is left exactly where it is.
pub(crate) fn adopt_orphaned_snapshots(
    data_dir: &Path,
    state: &mut PreloaderState,
    entries: Option<&BTreeMap<String, VpkEntryLocation>>,
) -> usize {
    let Ok(dir) = std::fs::read_dir(originals_dir(data_dir)) else {
        return 0;
    };
    let tracked_files: BTreeSet<PathBuf> = state
        .patched
        .keys()
        .map(|rel| snapshot_path(data_dir, rel))
        .collect();
    // Which particle rel each hashed name would stand for, from the archive.
    let rels_by_hash: BTreeMap<String, &String> = entries
        .map(|entries| {
            entries
                .keys()
                .filter(|rel| rel.starts_with("particles/") && rel.ends_with(".pcf"))
                .map(|rel| (sha256_hex(rel.as_bytes()), rel))
                .collect()
        })
        .unwrap_or_default();
    let mut adopted = 0;
    for file in dir.flatten() {
        let path = file.path();
        if tracked_files.contains(&path) {
            continue;
        }
        let Some(name) = file.file_name().to_str().map(|name| name.to_string()) else {
            continue;
        };
        if name.ends_with(".json") || name.ends_with(crate::hash::PART_SUFFIX) {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let sha = sha256_hex(&bytes);
        let (rel, pristine) = if is_hashed_name(&name) {
            let from_sidecar = std::fs::read(path.with_extension("json"))
                .ok()
                .and_then(|json| serde_json::from_slice::<SnapshotSidecar>(&json).ok())
                .filter(|sidecar| {
                    sha256_hex(sidecar.rel.as_bytes()) == name
                        && sidecar.original_sha256 == sha
                        && sidecar.size == bytes.len() as u64
                })
                .map(|sidecar| (sidecar.rel, sidecar.pristine));
            let from_archive = || {
                let rel = *rels_by_hash.get(&name)?;
                let entry = entries?.get(rel)?;
                Some((rel.clone(), is_stock(&bytes, entry)))
            };
            let Some(found) = from_sidecar.or_else(from_archive) else {
                continue;
            };
            found
        } else {
            // Written by an older build under the `__` mangling.
            let rel = name.replace("__", "/");
            if state.patched.contains_key(&rel) {
                continue;
            }
            // Judged by the directory when it is at hand; otherwise the restore
            // only applies the CRC test to snapshots that claimed to be stock.
            let pristine = entries
                .and_then(|entries| entries.get(&rel))
                .is_some_and(|entry| is_stock(&bytes, entry));
            if write_snapshot(data_dir, &rel, &bytes, pristine).is_err() {
                continue;
            }
            let _ = std::fs::remove_file(&path);
            (rel, pristine)
        };
        if state.patched.contains_key(&rel) {
            continue;
        }
        // A snapshot the archive explained has no sidecar yet; give it one so
        // the next recovery does not depend on the archive being there.
        if !sidecar_path(data_dir, &rel).is_file() {
            let _ = write_snapshot(data_dir, &rel, &bytes, pristine);
        }
        state.patched.insert(
            rel.clone(),
            PatchedEntry {
                owner: "recovered".into(),
                original_sha256: sha,
                // Unknown: an adopted snapshot was never matched to bytes we
                // wrote, so the restore below cannot verify it.
                patched_sha256: String::new(),
                rel,
                pristine,
            },
        );
        adopted += 1;
    }
    adopted
}

/// Restore tracked entries from their snapshots, one at a time, persisting
/// state after every entry. Success (and impossible restores — entry gone or
/// resized by a game update) drop the tracking; a plain I/O failure keeps the
/// entry tracked so a later attempt can finish the job.
///
/// The directory's stock CRC decides each case. An entry that already holds
/// stock bytes (a game update, or Steam's verify, put them back) needs nothing
/// and is simply untracked. A pristine snapshot whose CRC no longer matches
/// the directory describes a file the game has since changed; writing it back
/// would plant old stock bytes under a new CRC, so it is discarded and
/// reported. This per-entry judgement is what makes a resized VPK safe to
/// handle without throwing every snapshot away: a change in what the
/// fingerprint measures reads as a resize too, and discarding tracking on that
/// signal orphans patched files with no snapshots left to restore.
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
        let (expected_patched, pristine) = state
            .patched
            .get(&rel)
            .map(|entry| (entry.patched_sha256.clone(), entry.pristine))
            .unwrap_or_default();
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
            remove_snapshot(data_dir, &rel);
            save_state(data_dir, state)?;
            continue;
        };
        if entry.length as usize != original.len() {
            failures.push(format!("{rel}: stock size changed (game update)"));
            state.patched.remove(&rel);
            remove_snapshot(data_dir, &rel);
            save_state(data_dir, state)?;
            continue;
        }
        let current = match read_vpk_entry(&vpk_path, entry) {
            Ok(current) => current,
            Err(err) => {
                failures.push(format!("{rel}: {}", err.message()));
                continue;
            }
        };
        // Stock bytes are already in place (a game update, or the user ran
        // Steam's verify): nothing to write, and the snapshot has done its job.
        if is_stock(&current, entry) {
            state.patched.remove(&rel);
            remove_snapshot(data_dir, &rel);
            save_state(data_dir, state)?;
            continue;
        }
        // A same-size replacement passes the length check, so confirm the entry
        // still holds exactly what we wrote before putting the snapshot back.
        // Keep the snapshot and report rather than overwriting fresh game data.
        if !expected_patched.is_empty() && sha256_hex(&current) != expected_patched {
            failures.push(format!(
                "{rel}: the game replaced this entry since we patched it; \
                 leaving it alone and keeping the snapshot"
            ));
            continue;
        }
        // Our patch is still there, but the directory now expects different
        // stock content: the old snapshot is not a restore any more.
        if pristine && !is_stock(&original, entry) {
            failures.push(format!(
                "{rel}: the game changed this file since it was snapshotted; \
                 the old snapshot was discarded — verify game files in Steam"
            ));
            state.patched.remove(&rel);
            remove_snapshot(data_dir, &rel);
            save_state(data_dir, state)?;
            continue;
        }
        match patch_vpk_entry(&vpk_path, entry, &original) {
            Ok(()) => {
                state.patched.remove(&rel);
                remove_snapshot(data_dir, &rel);
            }
            Err(err) => {
                failures.push(format!("{rel}: {}", err.message()));
            }
        }
        save_state(data_dir, state)?;
    }
    Ok(failures)
}
