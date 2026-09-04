//! On-disk preloader state: where snapshots live, what we patched, and the
//! game-update fingerprint that invalidates them.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::archive::read_regular_file_bounded;
use crate::hash::{
    metadata_is_link, remove_dir_within, remove_file_force_within, sha256_hex,
    validate_file_within, write_atomic_within,
};
use crate::pcf::MAX_PCF_BYTES;
use crate::process_lock::WriteLockError;
use crate::vpk::{crc32, patch_vpk_entry_if_unchanged, read_vpk_entry, VpkEntryLocation, VpkError};

use super::{MISC_VPK, PRELOADER_VPK};

const MAX_STATE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_SIDECAR_BYTES: u64 = 64 * 1024;
const MAX_SNAPSHOT_BYTES: u64 = MAX_PCF_BYTES as u64;
const MAX_ORIGINAL_ENTRIES: usize = 20_000;
const MAX_ORIGINAL_BYTES_SCANNED: u64 = 512 * 1024 * 1024;
const MAX_STATE_LIST_ENTRIES: usize = 20_000;
const PRELOADER_STATE_SCHEMA: u32 = 1;

pub(crate) fn preloader_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("preloader")
}

pub(crate) fn originals_dir(data_dir: &Path) -> PathBuf {
    preloader_dir(data_dir).join("originals")
}

pub(crate) fn state_path(data_dir: &Path) -> PathBuf {
    preloader_dir(data_dir).join("state.json")
}

/// Validate every existing app-data component without following links or
/// junctions. Missing components are created one at a time only when `create`
/// is true. The returned boolean says whether the complete directory existed
/// before this call.
pub(crate) fn app_dir_within(data_dir: &Path, dir: &Path, create: bool) -> Result<bool, String> {
    if !data_dir.exists() {
        if !create {
            return Ok(false);
        }
        fs::create_dir_all(data_dir)
            .map_err(|err| format!("Could not prepare the execs data folder: {err}"))?;
    }
    let root_meta = fs::symlink_metadata(data_dir)
        .map_err(|err| format!("Could not inspect the execs data folder: {err}"))?;
    if metadata_is_link(&root_meta) || !root_meta.is_dir() {
        return Err("The execs data folder is linked or is not a directory.".into());
    }
    let canonical_root = fs::canonicalize(data_dir)
        .map_err(|err| format!("Could not resolve the execs data folder: {err}"))?;
    let rel = dir
        .strip_prefix(data_dir)
        .map_err(|_| "A preloader path escapes the execs data folder.".to_string())?;
    let mut current = data_dir.to_path_buf();
    let mut existed = true;
    for component in rel.components() {
        let Component::Normal(component) = component else {
            return Err("A preloader path contains an invalid component.".into());
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata_is_link(&metadata) || !metadata.is_dir() {
                    return Err(format!(
                        "Refusing to traverse a linked or non-directory preloader path: {}",
                        current.display()
                    ));
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound && create => {
                existed = false;
                fs::create_dir(&current).map_err(|err| {
                    format!("Could not create {} safely: {err}", current.display())
                })?;
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(err) => return Err(format!("Could not inspect {}: {err}", current.display())),
        }
        let canonical = fs::canonicalize(&current)
            .map_err(|err| format!("Could not resolve {}: {err}", current.display()))?;
        if !canonical.starts_with(&canonical_root) {
            return Err(format!(
                "Refusing a preloader path outside the execs data folder: {}",
                current.display()
            ));
        }
    }
    Ok(existed)
}

/// Read an optional app-data file only after proving every parent remains
/// inside the configured data directory. The file itself is opened with the
/// archive module's no-follow, bounded, identity-checked reader.
pub(crate) fn read_app_file_bounded(
    data_dir: &Path,
    path: &Path,
    max_bytes: u64,
) -> Result<Option<Vec<u8>>, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "A preloader file has no parent directory.".to_string())?;
    if !app_dir_within(data_dir, parent, false)? {
        return Ok(None);
    }
    match fs::symlink_metadata(path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Could not inspect {}: {err}", path.display())),
        Ok(metadata) if metadata_is_link(&metadata) || !metadata.is_file() => {
            return Err(format!(
                "Refusing to read a linked or non-file preloader path: {}",
                path.display()
            ))
        }
        Ok(_) => {}
    }
    validate_file_within(data_dir, path)
        .map_err(|err| format!("Could not validate {}: {err}", path.display()))?;
    match read_regular_file_bounded(path, max_bytes).map_err(|err| err.message())? {
        Some(bytes) => Ok(Some(bytes)),
        None => Err(format!(
            "{} exceeds its {} byte safety limit",
            path.display(),
            max_bytes
        )),
    }
}

/// Snapshots are named by `sha256(rel)`. The old `/` -> `__` mangling was not
/// injective: any entry path containing `__` round-tripped to a different rel,
/// so `adopt_orphaned_snapshots` inserted a bogus entry while the real snapshot
/// was orphaned and never restored.
pub(crate) fn snapshot_path(data_dir: &Path, rel: &str) -> PathBuf {
    originals_dir(data_dir).join(sha256_hex(rel.as_bytes()))
}

pub(crate) fn read_snapshot_bounded(data_dir: &Path, rel: &str) -> Result<Vec<u8>, String> {
    read_app_file_bounded(data_dir, &snapshot_path(data_dir, rel), MAX_SNAPSHOT_BYTES)
        .map_err(|err| format!("Could not read the recovery snapshot for {rel}: {err}"))?
        .ok_or_else(|| format!("The recovery snapshot for {rel} is missing."))
}

pub(crate) fn read_particle_entry_bounded(
    vpk_path: &Path,
    entry: &VpkEntryLocation,
) -> Result<Vec<u8>, String> {
    if u64::from(entry.length) > MAX_SNAPSHOT_BYTES {
        return Err(format!(
            "{} exceeds the {} MiB particle safety limit.",
            entry.rel,
            MAX_SNAPSHOT_BYTES / (1024 * 1024)
        ));
    }
    read_vpk_entry(vpk_path, entry).map_err(|err| err.message())
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
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(format!(
            "Could not snapshot {rel}: particle data exceeds the {} MiB recovery limit.",
            MAX_SNAPSHOT_BYTES / (1024 * 1024)
        ));
    }
    app_dir_within(data_dir, &originals_dir(data_dir), true)?;
    write_atomic_within(data_dir, &snapshot_path(data_dir, rel), bytes)
        .map_err(|err| format!("Could not snapshot {rel}: {err}"))?;
    let sidecar = SnapshotSidecar {
        rel: rel.to_string(),
        original_sha256: sha256_hex(bytes),
        size: bytes.len() as u64,
        pristine,
    };
    let json = serde_json::to_vec_pretty(&sidecar).map_err(|err| err.to_string())?;
    write_atomic_within(data_dir, &sidecar_path(data_dir, rel), &json)
        .map_err(|err| format!("Could not describe the snapshot of {rel}: {err}"))
}

/// Delete a snapshot the restore has consumed, sidecar included. Cleanup is
/// part of the recovery transaction: if it fails, tracking stays in state so
/// the next restore retries instead of later adopting a stale leftover as a
/// fresh orphan.
pub(crate) fn remove_snapshot(data_dir: &Path, rel: &str) -> Result<(), String> {
    if !app_dir_within(data_dir, &originals_dir(data_dir), false)? {
        return Ok(());
    }
    for path in [snapshot_path(data_dir, rel), sidecar_path(data_dir, rel)] {
        match remove_file_force_within(data_dir, &path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                return Err(format!(
                    "Could not remove the recovery snapshot for {rel}: {err}"
                ));
            }
        }
    }
    Ok(())
}

/// Clear the snapshot folder of what cannot matter (torn `.execs-part`
/// writes, sidecars whose snapshot is gone) and remove it once it is empty.
/// A snapshot still there is one no restore could explain, and it stays: it
/// may be the only copy of a stock file.
pub(crate) fn tidy_originals_dir(data_dir: &Path) {
    let dir = originals_dir(data_dir);
    let Ok(true) = app_dir_within(data_dir, &dir, false) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&dir) else {
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
            let _ = remove_file_force_within(data_dir, &path);
        }
    }
    // Fails while anything is left, which is the point.
    let _ = remove_dir_within(data_dir, &dir);
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
) -> Result<Vec<String>, String> {
    let mut modified = Vec::new();
    for (rel, entry) in entries {
        if !rel.starts_with("particles/")
            || !rel.ends_with(".pcf")
            || entry.preload_len != 0
            || state.patched.contains_key(rel)
        {
            continue;
        }
        let bytes = read_particle_entry_bounded(vpk_path, entry)
            .map_err(|err| format!("Could not verify {rel}: {err}"))?;
        if !is_stock(&bytes, entry) {
            modified.push(rel.clone());
        }
    }
    Ok(modified)
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

pub(crate) fn load_state(data_dir: &Path) -> Result<PreloaderState, String> {
    let Some(bytes) = read_state_bytes(data_dir)? else {
        return Ok(PreloaderState::default());
    };
    let state: PreloaderState = serde_json::from_slice(&bytes)
        .map_err(|err| format!("Could not read preloader state safely: {err}"))?;
    validate_state(&state)?;
    Ok(state)
}

fn read_state_bytes(data_dir: &Path) -> Result<Option<Vec<u8>>, String> {
    read_app_file_bounded(data_dir, &state_path(data_dir), MAX_STATE_BYTES)
}

/// Status and explicit stock restoration can reconstruct particle tracking
/// from pristine snapshots when only the JSON syntax was damaged. Unsafe,
/// linked, unreadable, or oversized state paths still fail closed.
pub(crate) fn load_state_for_snapshot_recovery(data_dir: &Path) -> Result<PreloaderState, String> {
    let Some(bytes) = read_state_bytes(data_dir)? else {
        return Ok(PreloaderState::default());
    };
    match serde_json::from_slice::<PreloaderState>(&bytes) {
        Ok(state) => {
            validate_state(&state)?;
            Ok(state)
        }
        Err(_) => Ok(PreloaderState::default()),
    }
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_particle_rel(rel: &str) -> bool {
    rel.len() <= 4096
        && rel.starts_with("particles/")
        && rel.ends_with(".pcf")
        && !rel.contains('\\')
        && Path::new(rel)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn validate_state(state: &PreloaderState) -> Result<(), String> {
    if state.schema > PRELOADER_STATE_SCHEMA {
        return Err("The preloader state uses an unsupported schema.".into());
    }
    for (label, count) in [
        ("addons", state.addons.len()),
        ("particle mods", state.particle_mods.len()),
        ("profile particle mods", state.profile_particle_mods.len()),
        ("patched files", state.patched.len()),
        ("skipped files", state.skipped.len()),
        ("preload profiles", state.preload_profiles.len()),
    ] {
        if count > MAX_STATE_LIST_ENTRIES {
            return Err(format!("The preloader state contains too many {label}."));
        }
    }
    if state
        .addons
        .iter()
        .chain(&state.particle_mods)
        .chain(&state.profile_particle_mods)
        .chain(&state.preload_profiles)
        .any(|value| value.is_empty() || value.len() > 4096)
    {
        return Err("The preloader state contains an invalid selection value.".into());
    }
    for (rel, entry) in &state.patched {
        if !valid_particle_rel(rel)
            || entry.rel != *rel
            || entry.owner.len() > 4096
            || !valid_sha256(&entry.original_sha256)
            || !(entry.patched_sha256.is_empty() || valid_sha256(&entry.patched_sha256))
        {
            return Err(format!(
                "The preloader state has an unsafe patched entry: {rel}"
            ));
        }
    }
    if state.skipped.iter().any(|notice| {
        notice.file.is_empty()
            || notice.file.len() > 4096
            || notice.mod_name.len() > 4096
            || notice.reason.len() > 16 * 1024
    }) {
        return Err("The preloader state contains an invalid skipped-file record.".into());
    }
    Ok(())
}

/// Atomic, like every file that matters: state.json is the index of which
/// official entries hold our bytes, and a truncated index is what turns
/// pristine snapshots into files nothing knows how to use.
pub(crate) fn save_state(data_dir: &Path, state: &PreloaderState) -> Result<(), String> {
    validate_state(state)?;
    let json = serde_json::to_vec_pretty(state).map_err(|err| err.to_string())?;
    if json.len() as u64 > MAX_STATE_BYTES {
        return Err(format!(
            "Could not save preloader state: it exceeds the {} MiB safety limit.",
            MAX_STATE_BYTES / (1024 * 1024)
        ));
    }
    app_dir_within(data_dir, &preloader_dir(data_dir), true)?;
    write_atomic_within(data_dir, &state_path(data_dir), &json)
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
            Ok(meta) => {
                total = total
                    .checked_add(meta.len())
                    .ok_or_else(|| format!("The {MISC_VPK} archive sizes overflow."))?;
            }
            // Archives are numbered contiguously from 000.
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => break,
            Err(err) => {
                return Err(format!("Could not inspect {}: {err}", sibling.display()));
            }
        }
    }
    Ok(total)
}

pub(crate) fn misc_vpk_path(tf2_root: &Path) -> PathBuf {
    tf2_root.join("tf").join(MISC_VPK)
}

/// Check for a regular file below `root` without following symlinks or Windows
/// reparse points and without creating missing parents. This is the read-only
/// counterpart to the write-oriented `*_within` helpers in `hash`.
pub(crate) fn live_file_exists_within(root: &Path, path: &Path) -> std::io::Result<bool> {
    let rel = path.strip_prefix(root).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path escapes its allowed root",
        )
    })?;
    let root_meta = std::fs::symlink_metadata(root)?;
    if metadata_is_link(&root_meta) || !root_meta.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "refusing to traverse a linked or non-directory root: {}",
                root.display()
            ),
        ));
    }
    let canonical_root = std::fs::canonicalize(root)?;
    let mut components = rel.components().peekable();
    if components.peek().is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "file path names the allowed root",
        ));
    }

    let mut current = root.to_path_buf();
    while let Some(component) = components.next() {
        let Component::Normal(component) = component else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "path contains a non-normal component",
            ));
        };
        current.push(component);
        let meta = match std::fs::symlink_metadata(&current) {
            Ok(meta) => meta,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(err) => return Err(err),
        };
        if metadata_is_link(&meta) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "refusing to traverse a link or reparse point: {}",
                    current.display()
                ),
            ));
        }

        let is_file = components.peek().is_none();
        if (is_file && !meta.is_file()) || (!is_file && !meta.is_dir()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "refusing to traverse a non-directory or non-file: {}",
                    current.display()
                ),
            ));
        }
        let resolved = std::fs::canonicalize(&current)?;
        if !resolved.starts_with(&canonical_root) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "path resolves outside its allowed root: {}",
                    current.display()
                ),
            ));
        }
    }
    Ok(true)
}

/// Whether the mods preloader still needs the shared `execs_preload` cfg and
/// its launch token. The cfg is shared with viewmodel packs, so removing a
/// viewmodel pack must not take it away while patched particles or addon
/// content are still installed — that is the "installed but nothing works"
/// failure mode on Valve Casual.
pub fn preload_is_wanted(data_dir: &Path, tf2_root: &Path) -> Result<bool, String> {
    let state = load_state(data_dir)?;
    let originals = originals_dir(data_dir);
    let orphaned_snapshots = if app_dir_within(data_dir, &originals, false)? {
        std::fs::read_dir(&originals)
            .map_err(|err| format!("Could not inspect preloader snapshots: {err}"))?
            .next()
            .transpose()
            .map_err(|err| format!("Could not inspect preloader snapshots: {err}"))?
            .is_some()
    } else {
        false
    };
    Ok(!state.patched.is_empty()
        || !state.addons.is_empty()
        || !state.particle_mods.is_empty()
        || orphaned_snapshots
        || live_file_exists_within(
            tf2_root,
            &tf2_root.join("tf").join("custom").join(PRELOADER_VPK),
        )
        .map_err(|err| format!("Could not inspect the preloader pack safely: {err}"))?)
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
    discover_orphaned_snapshots(data_dir, state, entries, true)
}

/// Read-only form used by status. It reports recoverable snapshots in a cloned
/// state but never migrates files, writes sidecars, or persists state.json.
pub(crate) fn discover_orphaned_snapshots_readonly(
    data_dir: &Path,
    state: &mut PreloaderState,
    entries: Option<&BTreeMap<String, VpkEntryLocation>>,
) -> usize {
    discover_orphaned_snapshots(data_dir, state, entries, false)
}

fn discover_orphaned_snapshots(
    data_dir: &Path,
    state: &mut PreloaderState,
    entries: Option<&BTreeMap<String, VpkEntryLocation>>,
    persist_repairs: bool,
) -> usize {
    let originals = originals_dir(data_dir);
    let Ok(true) = app_dir_within(data_dir, &originals, false) else {
        return 0;
    };
    let Ok(dir) = fs::read_dir(&originals) else {
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
    let mut inspected_entries = 0usize;
    let mut inspected_bytes = 0u64;
    for file in dir.flatten() {
        inspected_entries = inspected_entries.saturating_add(1);
        if inspected_entries > MAX_ORIGINAL_ENTRIES {
            break;
        }
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
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata_is_link(&metadata) || !metadata.is_file() || metadata.len() > MAX_SNAPSHOT_BYTES
        {
            continue;
        }
        inspected_bytes = match inspected_bytes.checked_add(metadata.len()) {
            Some(total) if total <= MAX_ORIGINAL_BYTES_SCANNED => total,
            _ => break,
        };
        let Ok(Some(bytes)) = read_app_file_bounded(data_dir, &path, MAX_SNAPSHOT_BYTES) else {
            continue;
        };
        let sha = sha256_hex(&bytes);
        let (rel, pristine) = if is_hashed_name(&name) {
            let from_sidecar =
                read_app_file_bounded(data_dir, &path.with_extension("json"), MAX_SIDECAR_BYTES)
                    .ok()
                    .flatten()
                    .and_then(|json| serde_json::from_slice::<SnapshotSidecar>(&json).ok())
                    .and_then(|sidecar| {
                        if !valid_particle_rel(&sidecar.rel)
                            || sha256_hex(sidecar.rel.as_bytes()) != name
                            || sidecar.original_sha256 != sha
                            || sidecar.size != bytes.len() as u64
                        {
                            return None;
                        }
                        let entry = entries?.get(&sidecar.rel)?;
                        Some((sidecar.rel, is_stock(&bytes, entry)))
                    });
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
            if !valid_particle_rel(&rel) || state.patched.contains_key(&rel) {
                continue;
            }
            let Some(entry) = entries.and_then(|entries| entries.get(&rel)) else {
                continue;
            };
            let pristine = is_stock(&bytes, entry);
            if persist_repairs {
                if write_snapshot(data_dir, &rel, &bytes, pristine).is_err() {
                    continue;
                }
                let _ = remove_file_force_within(data_dir, &path);
            }
            (rel, pristine)
        };
        if state.patched.contains_key(&rel) {
            continue;
        }
        // A snapshot the archive explained has no sidecar yet; give it one so
        // the next recovery does not depend on the archive being there.
        if persist_repairs
            && read_app_file_bounded(data_dir, &sidecar_path(data_dir, &rel), MAX_SIDECAR_BYTES)
                .ok()
                .flatten()
                .is_none()
        {
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
    before_write: &dyn Fn() -> Result<(), String>,
) -> Result<Vec<String>, String> {
    validate_state(state)?;
    let vpk_path = misc_vpk_path(tf2_root);
    let mut failures = Vec::new();
    let tracked: Vec<String> = state.patched.keys().cloned().collect();
    for rel in tracked {
        let (expected_original, expected_patched, pristine) = state
            .patched
            .get(&rel)
            .map(|entry| {
                (
                    entry.original_sha256.clone(),
                    entry.patched_sha256.clone(),
                    entry.pristine,
                )
            })
            .unwrap_or_default();
        let snapshot = snapshot_path(data_dir, &rel);
        let original = match read_app_file_bounded(data_dir, &snapshot, MAX_SNAPSHOT_BYTES) {
            Ok(Some(original)) => original,
            Ok(None) => {
                failures.push(format!("{rel}: snapshot is missing"));
                if let Err(cleanup) = remove_snapshot(data_dir, &rel) {
                    failures.push(format!("{rel}: {cleanup}"));
                    continue;
                }
                state.patched.remove(&rel);
                save_state(data_dir, state)?;
                continue;
            }
            Err(err) => {
                failures.push(format!(
                    "{rel}: could not read its recovery snapshot: {err}"
                ));
                continue;
            }
        };
        if !expected_original.is_empty() && sha256_hex(&original) != expected_original {
            failures.push(format!(
                "{rel}: snapshot hash does not match its recovery record; leaving it untouched"
            ));
            continue;
        }
        let Some(entry) = entries.get(&rel) else {
            failures.push(format!("{rel}: no longer in {MISC_VPK}"));
            if let Err(cleanup) = remove_snapshot(data_dir, &rel) {
                failures.push(format!("{rel}: {cleanup}"));
                continue;
            }
            state.patched.remove(&rel);
            save_state(data_dir, state)?;
            continue;
        };
        if entry.length as usize != original.len() {
            failures.push(format!("{rel}: stock size changed (game update)"));
            if let Err(cleanup) = remove_snapshot(data_dir, &rel) {
                failures.push(format!("{rel}: {cleanup}"));
                continue;
            }
            state.patched.remove(&rel);
            save_state(data_dir, state)?;
            continue;
        }
        let current = match read_particle_entry_bounded(&vpk_path, entry) {
            Ok(current) => current,
            Err(err) => {
                failures.push(format!("{rel}: {err}"));
                continue;
            }
        };
        // Stock bytes are already in place (a game update, or the user ran
        // Steam's verify): nothing to write, and the snapshot has done its job.
        if is_stock(&current, entry) {
            if let Err(cleanup) = remove_snapshot(data_dir, &rel) {
                failures.push(format!("{rel}: {cleanup}"));
                continue;
            }
            state.patched.remove(&rel);
            save_state(data_dir, state)?;
            continue;
        }
        if expected_patched.is_empty() {
            failures.push(format!(
                "{rel}: recovery cannot prove these live bytes were written by execs; verify game files in Steam"
            ));
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
            if let Err(cleanup) = remove_snapshot(data_dir, &rel) {
                failures.push(format!("{rel}: {cleanup}"));
                continue;
            }
            state.patched.remove(&rel);
            save_state(data_dir, state)?;
            continue;
        }
        match patch_vpk_entry_if_unchanged(&vpk_path, entry, Some(&current), &original, || {
            before_write().map_err(VpkError)
        }) {
            Ok(()) => {
                if let Err(cleanup) = remove_snapshot(data_dir, &rel) {
                    failures.push(format!("{rel}: {cleanup}"));
                    save_state(data_dir, state)?;
                    continue;
                }
                state.patched.remove(&rel);
            }
            Err(err) => {
                if err.message() == WriteLockError::GameRunning.message() {
                    return Err(err.message());
                }
                failures.push(format!("{rel}: {}", err.message()));
            }
        }
        save_state(data_dir, state)?;
    }
    Ok(failures)
}
