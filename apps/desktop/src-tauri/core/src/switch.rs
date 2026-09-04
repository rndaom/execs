//! Exact-replace profile switch with real progress steps (RND-149).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::absorb::{
    absorb_added_packs_for_switch_to, absorb_owned_to, pack_key, write_config_cfg_dual_to,
    AbsorbOptions,
};
use crate::blob::blob_path;
use crate::hash::{
    copy_verified_atomic_within, read_small_file_bounded, remove_dir_within,
    remove_file_force_within, sha256_file, validate_dir_within, validate_file_within,
    MAX_CFG_FILE_BYTES,
};
use crate::hud::{hud_packs, live_hud_keys};
use crate::launch::LaunchWriteReason;
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    begin_switch_to, clear_launch_sync_pending_if_matches, exclusive_file_path,
    is_profile_ownable_rel_path, is_shared_rel_path, load_library_from, load_manifest,
    mark_launch_sync_pending, pending_switch_to, portable_path_key, profiles_dir,
    recover_profile_mutation_to, set_active_profile_to, FileStorage, ProfileError, ProfileFile,
    ProfileLibrary, ProfileManifest, SwitchCleanupFile,
};
use crate::surface::is_stock_custom_entry;

const CONFIG_CFG: &str = "tf/cfg/config.cfg";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwitchStep {
    Closed,
    Pack,
    Remove,
    Write,
    Cloud,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchProgress {
    pub step: SwitchStep,
    pub detail: Option<String>,
}

impl SwitchProgress {
    fn new(step: SwitchStep) -> Self {
        Self { step, detail: None }
    }

    fn with_detail(step: SwitchStep, detail: impl Into<String>) -> Self {
        Self {
            step,
            detail: Some(detail.into()),
        }
    }
}

/// A switch's full result. `steam_write` says whether the profile's launch
/// options actually reached `localconfig.vdf`, or were skipped because Steam
/// was open / no account was found — the same first-class reason every other
/// launch-options path reports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchOutcome {
    pub library: ProfileLibrary,
    /// `None` when the write failed outright; `steam_write_error` says why.
    /// A failed launch-options write never fails the switch itself — the live
    /// tree is already correct by this point.
    pub steam_write: Option<LaunchWriteReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steam_write_error: Option<String>,
}

pub fn switch_profile(tf2_root: &Path, profile_id: &str) -> Result<ProfileLibrary, ProfileError> {
    switch_profile_with_progress(tf2_root, profile_id, |_| {})
}

pub fn switch_profile_with_progress<F>(
    tf2_root: &Path,
    profile_id: &str,
    progress: F,
) -> Result<ProfileLibrary, ProfileError>
where
    F: FnMut(SwitchProgress),
{
    Ok(switch_profile_outcome(tf2_root, profile_id, progress)?.library)
}

/// Same as [`switch_profile_with_progress`], but keeps the `localconfig.vdf`
/// write reason instead of discarding it.
pub fn switch_profile_outcome<F>(
    tf2_root: &Path,
    profile_id: &str,
    progress: F,
) -> Result<SwitchOutcome, ProfileError>
where
    F: FnMut(SwitchProgress),
{
    // The Cloud copy is the only place a `config.cfg` may live, so the pack
    // step has to see it here exactly as `absorb_owned` does.
    let cloud = crate::launch::find_cloud_config();
    switch_profile_to_outcome(
        &profiles_dir(),
        tf2_root,
        profile_id,
        live_process_names(),
        AbsorbOptions {
            cloud_config: cloud.as_deref(),
            ..AbsorbOptions::default()
        },
        progress,
    )
}

pub fn switch_profile_to<I, S, F>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
    options: AbsorbOptions<'_>,
    progress: F,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    F: FnMut(SwitchProgress),
{
    Ok(switch_profile_to_outcome(
        profiles_dir,
        tf2_root,
        profile_id,
        running_names,
        options,
        progress,
    )?
    .library)
}

pub fn switch_profile_to_outcome<I, S, F>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
    options: AbsorbOptions<'_>,
    mut progress: F,
) -> Result<SwitchOutcome, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    F: FnMut(SwitchProgress),
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    progress(SwitchProgress::new(SwitchStep::Closed));
    refuse_if_running_among(&running)?;

    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if !library.usable {
        return Err(ProfileError::NotInitialized);
    }
    if !library
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    let pending = pending_switch_to(profiles_dir, tf2_root)?;
    recover_profile_mutation_to(profiles_dir, tf2_root, profile_id)?;
    let target = load_manifest(profiles_dir, profile_id)?;
    if pending.is_none() && library.active_profile_id.as_deref() == Some(profile_id) {
        let (steam_write, steam_write_error) = if target.launch_sync_pending {
            let steam_roots = match options.steam_roots {
                Some(roots) => roots.to_vec(),
                None => crate::finder::discover_steam_roots(),
            };
            sync_switch_launch_options(
                profiles_dir,
                tf2_root,
                profile_id,
                &target.launch_options,
                &steam_roots,
                &running,
            )
        } else {
            (Some(LaunchWriteReason::Written), None)
        };
        let library = load_library_from(profiles_dir, Some(tf2_root))?;
        progress(SwitchProgress::new(SwitchStep::Done));
        return Ok(SwitchOutcome {
            library,
            steam_write,
            steam_write_error,
        });
    }

    // Everything the target needs is checked before a single live file is
    // removed. A failure discovered mid-write leaves the old profile's files
    // deleted and the new ones half-written.
    preflight_target(profiles_dir, profile_id, &target)?;

    let live_huds = live_hud_keys(tf2_root);
    let previous = library.active_profile_id.clone();
    progress(SwitchProgress::new(SwitchStep::Pack));
    if previous.is_some() {
        absorb_owned_to(profiles_dir, tf2_root, &running, clone_options(&options))?;
        absorb_added_packs_for_switch_to(
            profiles_dir,
            tf2_root,
            &running,
            clone_options(&options),
        )?;
    }

    // The lock was sampled when the switch began. A multi-gigabyte mods
    // profile takes a while to absorb, and the game may have been launched
    // in the meantime: re-read the process table before the first live
    // removal and again before the first live write.
    refuse_if_running_among(live_process_names())?;

    progress(SwitchProgress::new(SwitchStep::Remove));
    // From here on the live tree is mid-rebuild: the index must not be left
    // pointing at a profile whose files are gone, or the next auto-absorb
    // swallows the half-replaced tree into it and destroys it.
    //
    // With no active profile there is still a Remove step to run when a
    // previous switch was cut off: `interrupted_profile_id` names the profile
    // whose files were being removed, and finishing that removal is what
    // makes the retry an exact replace instead of a merge.
    let mut cleanup_profile_ids = pending
        .map(|journal| journal.cleanup_profile_ids)
        .unwrap_or_default();
    if let Some(previous) = previous.clone() {
        cleanup_profile_ids.push(previous);
    }
    if let Some(interrupted) = library.interrupted_profile_id.clone() {
        cleanup_profile_ids.push(interrupted);
    }
    cleanup_profile_ids.push(profile_id.to_string());
    cleanup_profile_ids.sort();
    cleanup_profile_ids.dedup();

    // This is the transaction boundary: after it succeeds, boot-time absorb
    // sees no active profile and every possible partial source/target remains
    // recorded for a deterministic retry.
    let journal = begin_switch_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &cleanup_profile_ids,
        live_process_names(),
    )?;

    let mut result = remove_unmodified_live(tf2_root, &journal.cleanup_files);
    if result.is_ok() {
        result = refuse_if_running_among(live_process_names()).map_err(ProfileError::from);
    }
    if result.is_ok() {
        progress(SwitchProgress::new(SwitchStep::Write));
        result = write_target_live(profiles_dir, tf2_root, &target, &live_huds);
    }
    if result.is_ok() {
        progress(SwitchProgress::new(SwitchStep::Cloud));
        result = dual_write_target_config(tf2_root, profiles_dir, &target, &options);
    }
    if let Err(err) = result {
        return Err(mid_switch_error(&err));
    }

    // The target manifest is authoritative. Publish its retry marker before
    // committing the active id; a crash or Steam/localconfig failure can then
    // be repaired by an idempotent same-profile switch.
    mark_launch_sync_pending(profiles_dir, tf2_root, profile_id, &running)
        .map_err(|err| mid_switch_error(&err))?;
    refuse_if_running_among(live_process_names())?;
    set_active_profile_to(profiles_dir, tf2_root, profile_id, &running)
        .map_err(|err| mid_switch_error(&err))?;
    let steam_roots = match options.steam_roots {
        Some(roots) => roots.to_vec(),
        None => crate::finder::discover_steam_roots(),
    };
    let (steam_write, steam_write_error) = sync_switch_launch_options(
        profiles_dir,
        tf2_root,
        profile_id,
        &target.launch_options,
        &steam_roots,
        &running,
    );
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    progress(SwitchProgress::with_detail(
        SwitchStep::Done,
        launch_write_detail(steam_write, steam_write_error.as_deref()),
    ));
    Ok(SwitchOutcome {
        library,
        steam_write,
        steam_write_error,
    })
}

fn sync_switch_launch_options(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    launch_options: &str,
    steam_roots: &[PathBuf],
    running_names: &[String],
) -> (Option<LaunchWriteReason>, Option<String>) {
    match write_switch_launch_options(steam_roots, launch_options, running_names) {
        Ok(result) => {
            if result.reason == LaunchWriteReason::Written
                && !matches!(
                    clear_launch_sync_pending_if_matches(
                        profiles_dir,
                        tf2_root,
                        profile_id,
                        launch_options,
                        running_names,
                    ),
                    Ok(true)
                )
            {
                // Steam already has the correct value. Retain the durable
                // pending marker and retry idempotently rather than making
                // the completed profile switch look rolled back.
                return (Some(LaunchWriteReason::WriteFailed), None);
            }
            (Some(result.reason), None)
        }
        Err(_) => (Some(LaunchWriteReason::WriteFailed), None),
    }
}

#[cfg(not(test))]
fn write_switch_launch_options(
    steam_roots: &[PathBuf],
    launch_options: &str,
    _test_running: &[String],
) -> Result<crate::launch::LaunchWriteResult, ProfileError> {
    crate::launch::write_launch_options_to_localconfig(steam_roots, launch_options)
}

#[cfg(test)]
fn write_switch_launch_options(
    steam_roots: &[PathBuf],
    launch_options: &str,
    test_running: &[String],
) -> Result<crate::launch::LaunchWriteResult, ProfileError> {
    crate::launch::write_launch_options_to_localconfig_from(
        steam_roots,
        launch_options,
        test_running,
    )
}

fn launch_write_detail(reason: Option<LaunchWriteReason>, error: Option<&str>) -> String {
    if let Some(error) = error {
        return error.to_string();
    }
    match reason {
        Some(LaunchWriteReason::Written) => "Launch options written to Steam.".into(),
        Some(LaunchWriteReason::SteamOpen) => {
            "Steam is open, so the launch options were not written — copy them from the Launch pane."
                .into()
        }
        Some(LaunchWriteReason::NoAccount) => {
            "No Steam account config was found, so the launch options were not written.".into()
        }
        Some(LaunchWriteReason::WriteFailed) => {
            "Launch options are saved to the profile, but Steam sync is still pending.".into()
        }
        None => "Launch options are saved to the profile, but Steam sync is still pending.".into(),
    }
}

fn mid_switch_error(err: &ProfileError) -> ProfileError {
    ProfileError::Io(format!(
        "{} The live folder is mid-switch and no profile is active — re-apply a profile to finish.",
        err.message()
    ))
}

/// Validate the entire target manifest before the live tree is touched: every
/// path inside the file-safe surface, every source file present.
fn preflight_target(
    profiles_dir: &Path,
    profile_id: &str,
    target: &ProfileManifest,
) -> Result<(), ProfileError> {
    if target.id != profile_id {
        return Err(ProfileError::Io(
            "profile manifest id does not match its library record".into(),
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for file in &target.files {
        if !is_profile_ownable_rel_path(&file.path) {
            return Err(ProfileError::ForbiddenPath(file.path.clone()));
        }
        let key = portable_path_key(&file.path)?;
        if !seen.insert(key) {
            return Err(ProfileError::Io(format!(
                "Profile contains colliding paths: {}",
                file.path
            )));
        }
        if is_shared_rel_path(&file.path) != (file.storage == FileStorage::Shared) {
            return Err(ProfileError::Io(format!(
                "Profile file has invalid storage: {}",
                file.path
            )));
        }
        if file.sha256.len() != 64 || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ProfileError::Io(format!(
                "Profile file has invalid sha256: {}",
                file.path
            )));
        }
        let source = target_source(profiles_dir, target, file)?;
        let actual = sha256_file(&source).map_err(|e| ProfileError::Io(e.to_string()))?;
        if !actual.eq_ignore_ascii_case(&file.sha256) {
            return Err(ProfileError::Io(format!(
                "Profile file failed integrity verification: {}",
                file.path
            )));
        }
    }
    Ok(())
}

fn target_source(
    profiles_dir: &Path,
    target: &ProfileManifest,
    file: &ProfileFile,
) -> Result<PathBuf, ProfileError> {
    let source = match file.storage {
        FileStorage::Shared => blob_path(profiles_dir, &file.sha256),
        FileStorage::Exclusive => exclusive_file_path(profiles_dir, &target.id, &file.path),
    };
    validate_file_within(profiles_dir, &source).map_err(|err| {
        ProfileError::Io(format!(
            "Profile file is missing or unsafe ({}): {err}",
            file.path
        ))
    })?;
    Ok(source)
}

fn clone_options<'a>(options: &'a AbsorbOptions<'a>) -> AbsorbOptions<'a> {
    AbsorbOptions {
        cloud_config: options.cloud_config,
        steam_roots: options.steam_roots,
    }
}

fn remove_unmodified_live(
    tf2_root: &Path,
    files: &[SwitchCleanupFile],
) -> Result<(), ProfileError> {
    for file in files {
        if !is_profile_ownable_rel_path(&file.path) {
            return Err(ProfileError::ForbiddenPath(file.path.clone()));
        }
        for candidate in live_candidates(tf2_root, &file.path) {
            if !candidate.is_file() {
                continue;
            }
            crate::hash::validate_file_within(tf2_root, &candidate)
                .map_err(|e| ProfileError::Io(e.to_string()))?;
            let hash = sha256_file(&candidate).map_err(|e| ProfileError::Io(e.to_string()))?;
            if hash == file.sha256 {
                // Files extracted from some HUD and mod archives carry the
                // read-only attribute; Windows refuses a plain remove on
                // those, which used to fail the switch after preflight.
                refuse_if_running_among(live_process_names())?;
                remove_file_force_within(tf2_root, &candidate)
                    .map_err(|e| ProfileError::Io(e.to_string()))?;
                prune_empty_parents(&candidate, tf2_root);
            }
        }
    }
    Ok(())
}

fn write_target_live(
    profiles_dir: &Path,
    tf2_root: &Path,
    target: &ProfileManifest,
    live_huds: &[String],
) -> Result<(), ProfileError> {
    let preferred_hud = preferred_hud(target, live_huds);
    let extra_huds = extra_hud_packs(&target.files, preferred_hud.as_deref());
    for file in &target.files {
        if !is_profile_ownable_rel_path(&file.path) {
            return Err(ProfileError::ForbiddenPath(file.path.clone()));
        }
        // Valve's own `tf/custom` entries and `.execs-part` leftovers are not
        // profile content. A manifest written before they stopped counting as
        // packs still lists them; writing them would spread junk to every
        // profile the user switches to. Absorb drops them from the manifest.
        if is_stock_custom_entry(&file.path) {
            continue;
        }
        let dest_rel = rewrite_extra_hud_path(&file.path, &extra_huds);
        let source = target_source(profiles_dir, target, file)?;
        let dest = live_path(tf2_root, &dest_rel);
        refuse_if_running_among(live_process_names())?;
        copy_verified_atomic_within(tf2_root, &source, &dest, &file.sha256)
            .map_err(|e| ProfileError::Io(e.to_string()))?;
    }
    Ok(())
}

fn dual_write_target_config(
    tf2_root: &Path,
    profiles_dir: &Path,
    target: &ProfileManifest,
    options: &AbsorbOptions<'_>,
) -> Result<(), ProfileError> {
    let Some(file) = target.files.iter().find(|file| file.path == CONFIG_CFG) else {
        return Ok(());
    };
    let source = target_source(profiles_dir, target, file)?;
    let bytes = read_small_file_bounded(&source, MAX_CFG_FILE_BYTES)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    let actual = crate::hash::sha256_hex(&bytes);
    if !actual.eq_ignore_ascii_case(&file.sha256) {
        return Err(ProfileError::Io(
            "Profile config.cfg failed integrity verification".into(),
        ));
    }
    let roots = match options.steam_roots {
        Some(roots) => roots.to_vec(),
        None => crate::finder::discover_steam_roots(),
    };
    write_config_cfg_dual_to(tf2_root, &bytes, &roots)
}

fn preferred_hud(target: &ProfileManifest, live_huds: &[String]) -> Option<String> {
    let mut target_huds = hud_packs(&target.files);
    if target_huds.is_empty() {
        return None;
    }
    if let Some(hud) = &target.hud {
        if target_huds.iter().any(|pack| pack == &hud.id) {
            return Some(hud.id.clone());
        }
    }
    for live in live_huds {
        if target_huds.iter().any(|hud| hud == live) {
            return Some(live.clone());
        }
    }
    target_huds.sort();
    target_huds.into_iter().next()
}

fn extra_hud_packs(files: &[ProfileFile], preferred: Option<&str>) -> Vec<String> {
    hud_packs(files)
        .into_iter()
        .filter(|hud| preferred != Some(hud.as_str()))
        .collect()
}

fn rewrite_extra_hud_path(rel: &str, extra_huds: &[String]) -> String {
    let Some(pack) = pack_key(rel) else {
        return rel.to_string();
    };
    if !extra_huds.iter().any(|hud| hud == &pack) {
        return rel.to_string();
    }
    let Some(rest) = rel.strip_prefix("tf/custom/") else {
        return rel.to_string();
    };
    let (first, after) = rest.split_once('/').unwrap_or((rest, ""));
    let disabled = if first.starts_with('-') {
        first.to_string()
    } else {
        format!("-{first}")
    };
    if after.is_empty() {
        format!("tf/custom/{disabled}")
    } else {
        format!("tf/custom/{disabled}/{after}")
    }
}

/// Where a manifest path can be found live: its own path, plus the Source
/// disable-prefixed name a user renames a pack to.
pub(crate) fn live_candidates(tf2_root: &Path, rel: &str) -> Vec<PathBuf> {
    let mut out = vec![live_path(tf2_root, rel)];
    if let Some(disabled) = disabled_custom_rel(rel) {
        out.push(live_path(tf2_root, &disabled));
    }
    out
}

fn disabled_custom_rel(rel: &str) -> Option<String> {
    let rest = rel.strip_prefix("tf/custom/")?;
    if rest.starts_with('-') {
        return None;
    }
    Some(format!("tf/custom/-{rest}"))
}

pub(crate) fn live_path(tf2_root: &Path, rel: &str) -> PathBuf {
    let mut path = tf2_root.to_path_buf();
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

/// TF2 writes a `sound.cache` into every `tf/custom` folder it scans. It is the
/// game's own regenerable file, so a pack whose files we removed is left as a
/// husk that still reads as installed — that is how a swapped-away HUD keeps
/// showing up next to the new one.
pub(crate) fn only_game_caches(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let mut saw_one = false;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            return false;
        };
        if crate::hash::metadata_is_link(&meta) {
            return false;
        }
        if meta.is_dir() {
            // A husk nests: oldhud/sound/sound.cache.
            if !only_game_caches(&path) {
                return false;
            }
            saw_one = true;
            continue;
        }
        let name = entry.file_name();
        let disposable = meta.is_file()
            && name
                .to_str()
                .is_some_and(|name| name.eq_ignore_ascii_case("sound.cache"));
        if !disposable {
            return false;
        }
        saw_one = true;
    }
    saw_one
}

fn remove_game_cache_tree(dir: &Path, tf2_root: &Path) -> std::io::Result<()> {
    validate_dir_within(tf2_root, dir)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)?;
        if crate::hash::metadata_is_link(&meta) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "refusing to traverse a linked cache path",
            ));
        }
        if meta.is_dir() {
            remove_game_cache_tree(&path, tf2_root)?;
        } else if meta.is_file()
            && entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.eq_ignore_ascii_case("sound.cache"))
        {
            refuse_if_running_among(live_process_names()).map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "TF2 started while pruning profile files",
                )
            })?;
            remove_file_force_within(tf2_root, &path)?;
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "cache tree contains a non-cache entry",
            ));
        }
    }
    refuse_if_running_among(live_process_names()).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "TF2 started while pruning profile files",
        )
    })?;
    remove_dir_within(tf2_root, dir)
}

pub(crate) fn prune_empty_parents(start: &Path, tf2_root: &Path) {
    let stop = [
        tf2_root.to_path_buf(),
        tf2_root.join("tf"),
        tf2_root.join("tf").join("cfg"),
        // Deleting overrides/ flips detect_layer to Vanilla for any inventory
        // taken before write_target_live recreates it.
        tf2_root.join("tf").join("cfg").join("overrides"),
        tf2_root.join("tf").join("custom"),
    ];
    let mut current = start.parent().map(Path::to_path_buf);
    while let Some(dir) = current {
        if stop.iter().any(|root| root == &dir) {
            break;
        }
        if validate_dir_within(tf2_root, &dir).is_err() {
            break;
        }
        let empty = fs::read_dir(&dir)
            .ok()
            .is_some_and(|mut entries| entries.next().is_none());
        if !empty {
            // Only the game's own caches stand between us and an empty husk.
            if !dir.starts_with(tf2_root.join("tf").join("custom")) || !only_game_caches(&dir) {
                break;
            }
            let parent = dir.parent().map(Path::to_path_buf);
            if remove_game_cache_tree(&dir, tf2_root).is_err() {
                break;
            }
            current = parent;
            continue;
        }
        let parent = dir.parent().map(Path::to_path_buf);
        if refuse_if_running_among(live_process_names()).is_err()
            || remove_dir_within(tf2_root, &dir).is_err()
        {
            break;
        }
        current = parent;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{
        create_profile_record_to, put_exclusive_file_to, save_current_as_to, SaveCurrentOptions,
    };
    use std::io::Write;

    #[test]
    fn pruning_clears_a_husk_left_by_the_game_sound_cache() {
        let dir = crate::test_temp_dir();
        let tf2 = dir.join("tf2");
        let pack = tf2.join("tf/custom/oldhud");
        std::fs::create_dir_all(pack.join("resource/ui")).unwrap();
        std::fs::create_dir_all(pack.join("sound")).unwrap();
        // TF2 writes this itself; execs never owns it.
        std::fs::write(pack.join("sound/sound.cache"), b"cache").unwrap();
        let removed = pack.join("resource/ui/hudlayout.res");
        std::fs::write(&removed, b"{}").unwrap();
        std::fs::remove_file(&removed).unwrap();

        prune_empty_parents(&removed, &tf2);

        assert!(
            !pack.exists(),
            "the husk must not survive as a fake install"
        );
        assert!(tf2.join("tf/custom").is_dir(), "tf/custom itself stays");
    }

    #[test]
    fn pruning_leaves_a_folder_that_still_has_real_files() {
        let dir = crate::test_temp_dir();
        let tf2 = dir.join("tf2");
        let pack = tf2.join("tf/custom/keepme");
        std::fs::create_dir_all(pack.join("sound")).unwrap();
        std::fs::write(pack.join("sound/sound.cache"), b"cache").unwrap();
        std::fs::write(pack.join("sound/hitsound.wav"), b"wav").unwrap();
        let removed = pack.join("sound/gone.wav");

        prune_empty_parents(&removed, &tf2);

        assert!(pack.join("sound/hitsound.wav").is_file());
        assert!(pack.join("sound/sound.cache").is_file());
    }

    /// Never `AbsorbOptions::default()` in a test: `steam_roots: None`
    /// discovers the developer's real Steam install, and the dual write and
    /// launch-options write then land in their actual Steam Cloud
    /// `config.cfg` and `localconfig.vdf`. An empty slice means no Steam.
    fn no_steam() -> AbsorbOptions<'static> {
        static NO_STEAM: [PathBuf; 0] = [];
        AbsorbOptions {
            cloud_config: None,
            steam_roots: Some(&NO_STEAM),
        }
    }

    fn unlocked() -> [&'static str; 1] {
        ["bash"]
    }

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
    }

    fn write_live(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    fn localconfig(options: &str) -> String {
        format!(
            r#""UserLocalConfigStore"
{{
	"Software"
	{{
		"Valve"
		{{
			"Steam"
			{{
				"apps"
				{{
					"440"
					{{
						"LaunchOptions"		"{options}"
					}}
				}}
			}}
		}}
	}}
}}
"#
        )
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn save(profiles: &Path, root: &Path, name: &str) -> String {
        save_current_as_to(
            profiles,
            root,
            name,
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap()
        .profiles
        .last()
        .unwrap()
        .id
        .clone()
    }

    fn library_profile(
        profiles: &Path,
        root: &Path,
        name: &str,
        files: &[(&str, &[u8])],
    ) -> String {
        let library = create_profile_record_to(profiles, root, name, unlocked()).unwrap();
        let id = library.profiles.last().unwrap().id.clone();
        for (path, bytes) in files {
            put_exclusive_file_to(profiles, root, &id, path, bytes, unlocked()).unwrap();
        }
        id
    }

    fn steps_of(progress: &[SwitchProgress]) -> Vec<SwitchStep> {
        progress.iter().map(|item| item.step).collect()
    }

    /// The `localconfig.vdf` write result rides on the outcome and on the final
    /// progress step: dropped with `let _`, a switch never tells the user their
    /// launch options were skipped because Steam was open.
    #[test]
    fn switch_surfaces_the_launch_options_write_reason() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let steam = dir.join("Steam");
        write_live(&root.join("tf/steam.inf"), "appID=440\n");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        let _a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[("tf/cfg/config.cfg", b"binds-b\n")],
        );

        let mut steps = Vec::new();
        let outcome = switch_profile_to_outcome(
            &profiles,
            &root,
            &b,
            unlocked(),
            AbsorbOptions {
                steam_roots: Some(std::slice::from_ref(&steam)),
                ..no_steam()
            },
            |step| steps.push(step),
        )
        .unwrap();

        // No Steam account exists under this root, so the write is skipped —
        // reported, not swallowed.
        assert_eq!(outcome.steam_write, Some(LaunchWriteReason::NoAccount));
        assert_eq!(outcome.steam_write_error, None);
        let done = steps.last().unwrap();
        assert_eq!(done.step, SwitchStep::Done);
        assert!(done
            .detail
            .as_deref()
            .is_some_and(|text| text.contains("not written")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_active_switch_retries_and_clears_pending_launch_sync() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let steam = dir.join("Steam");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        let a = save(&profiles, &root, "A");
        crate::profile::set_manifest_launch_options(
            &profiles,
            &root,
            &a,
            "-novid -console".into(),
            &unlocked().map(str::to_string),
        )
        .unwrap();
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-old"),
        );

        let mut steps = Vec::new();
        let outcome = switch_profile_to_outcome(
            &profiles,
            &root,
            &a,
            unlocked(),
            AbsorbOptions {
                steam_roots: Some(std::slice::from_ref(&steam)),
                ..no_steam()
            },
            |step| steps.push(step),
        )
        .unwrap();

        assert_eq!(outcome.steam_write, Some(LaunchWriteReason::Written));
        assert_eq!(steps_of(&steps), vec![SwitchStep::Closed, SwitchStep::Done]);
        assert_eq!(
            crate::launch::read_launch_options_from(std::slice::from_ref(&steam)),
            "-novid -console"
        );
        assert!(!load_manifest(&profiles, &a).unwrap().launch_sync_pending);
        cleanup(&dir);
    }

    #[test]
    fn full_switch_keeps_launch_sync_pending_until_same_active_retry() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let missing_steam = dir.join("missing-steam");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        let _a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[("tf/cfg/config.cfg", b"binds-b\n")],
        );
        crate::profile::set_manifest_launch_options(
            &profiles,
            &root,
            &b,
            "-console".into(),
            &unlocked().map(str::to_string),
        )
        .unwrap();

        let switched = switch_profile_to_outcome(
            &profiles,
            &root,
            &b,
            unlocked(),
            AbsorbOptions {
                steam_roots: Some(std::slice::from_ref(&missing_steam)),
                ..no_steam()
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(switched.steam_write, Some(LaunchWriteReason::NoAccount));
        assert_eq!(
            switched.library.active_profile_id.as_deref(),
            Some(b.as_str())
        );
        assert!(load_manifest(&profiles, &b).unwrap().launch_sync_pending);

        let steam = dir.join("Steam");
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-old"),
        );
        let retried = switch_profile_to_outcome(
            &profiles,
            &root,
            &b,
            unlocked(),
            AbsorbOptions {
                steam_roots: Some(std::slice::from_ref(&steam)),
                ..no_steam()
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(retried.steam_write, Some(LaunchWriteReason::Written));
        assert_eq!(
            crate::launch::read_launch_options_from(std::slice::from_ref(&steam)),
            "-console"
        );
        assert!(!load_manifest(&profiles, &b).unwrap().launch_sync_pending);
        cleanup(&dir);
    }

    #[test]
    fn switch_replaces_surface_and_keeps_official_files() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/steam.inf"), "appID=440\n");
        write_live(&root.join("tf/tf2_misc_dir.vpk"), "official\n");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_live(
            &root.join("tf/custom/hud/resource/ui/hudlayout.res"),
            "hud-a\n",
        );
        let _a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[
                ("tf/cfg/config.cfg", b"binds-b\n"),
                ("tf/cfg/overrides/autoexec.cfg", b"fov_desired 110\n"),
                ("tf/custom/alt/note.txt", b"alt\n"),
            ],
        );

        let mut steps = Vec::new();
        let library = switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |step| {
            steps.push(step)
        })
        .unwrap();
        assert_eq!(library.active_profile_id.as_deref(), Some(b.as_str()));
        assert_eq!(
            steps_of(&steps),
            vec![
                SwitchStep::Closed,
                SwitchStep::Pack,
                SwitchStep::Remove,
                SwitchStep::Write,
                SwitchStep::Cloud,
                SwitchStep::Done,
            ]
        );
        assert_eq!(
            fs::read(root.join("tf/cfg/overrides/autoexec.cfg")).unwrap(),
            b"fov_desired 110\n"
        );
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            b"binds-b\n"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/alt/note.txt")).unwrap(),
            b"alt\n"
        );
        assert!(!root
            .join("tf/custom/hud/resource/ui/hudlayout.res")
            .exists());
        assert_eq!(fs::read(root.join("tf/steam.inf")).unwrap(), b"appID=440\n");
        assert_eq!(
            fs::read(root.join("tf/tf2_misc_dir.vpk")).unwrap(),
            b"official\n"
        );
        assert!(root.join("tf/cfg").is_dir());
        cleanup(&dir);
    }

    #[test]
    fn remove_keeps_modified_and_unknown_files() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(&root.join("tf/cfg/overrides/keep.cfg"), "original\n");
        write_live(&root.join("tf/custom/pack/a.txt"), "a\n");
        let a = save(&profiles, &root, "A");
        write_live(&root.join("tf/custom/pack/a.txt"), "user-changed\n");
        write_live(&root.join("tf/custom/stray/extra.txt"), "stray\n");

        let files: Vec<SwitchCleanupFile> = load_manifest(&profiles, &a)
            .unwrap()
            .files
            .into_iter()
            .map(|file| SwitchCleanupFile {
                path: file.path,
                sha256: file.sha256,
            })
            .collect();
        remove_unmodified_live(&root, &files).unwrap();
        assert_eq!(
            fs::read(root.join("tf/custom/pack/a.txt")).unwrap(),
            b"user-changed\n"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/stray/extra.txt")).unwrap(),
            b"stray\n"
        );
        assert!(!root.join("tf/cfg/overrides/keep.cfg").exists());
        assert!(!root.join("tf/cfg/config.cfg").exists());
        cleanup(&dir);
    }

    #[test]
    fn extra_hud_writes_with_disable_prefix() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/ahud/info.vdf"), "a\n");
        write_live(&root.join("tf/custom/zhud/info.vdf"), "z\n");
        let both = save(&profiles, &root, "Both");
        let plain = library_profile(
            &profiles,
            &root,
            "Plain",
            &[
                ("tf/cfg/config.cfg", b"unbindall\n"),
                ("tf/custom/plain/note.txt", b"plain\n"),
            ],
        );
        switch_profile_to(&profiles, &root, &plain, unlocked(), no_steam(), |_| {}).unwrap();
        switch_profile_to(&profiles, &root, &both, unlocked(), no_steam(), |_| {}).unwrap();

        assert!(root.join("tf/custom/ahud/info.vdf").is_file());
        assert!(root.join("tf/custom/-zhud/info.vdf").is_file());
        assert!(!root.join("tf/custom/zhud/info.vdf").exists());
        cleanup(&dir);
    }

    #[test]
    fn prefers_currently_live_hud() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/ahud/info.vdf"), "a\n");
        write_live(&root.join("tf/custom/zhud/info.vdf"), "z\n");
        let both = save(&profiles, &root, "Both");
        let plain = library_profile(
            &profiles,
            &root,
            "Plain",
            &[("tf/cfg/config.cfg", b"unbindall\n")],
        );
        switch_profile_to(&profiles, &root, &plain, unlocked(), no_steam(), |_| {}).unwrap();
        write_live(&root.join("tf/custom/zhud/info.vdf"), "z\n");
        switch_profile_to(&profiles, &root, &both, unlocked(), no_steam(), |_| {}).unwrap();

        assert!(root.join("tf/custom/zhud/info.vdf").is_file());
        assert!(root.join("tf/custom/-ahud/info.vdf").is_file());
        cleanup(&dir);
    }

    #[test]
    fn dual_write_on_switch() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let steam = dir.join("Steam");
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-novid"),
        );
        fs::create_dir_all(steam.join("userdata").join("111").join("440")).unwrap();
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        let _a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[("tf/cfg/config.cfg", b"binds-b\n")],
        );

        switch_profile_to(
            &profiles,
            &root,
            &b,
            unlocked(),
            AbsorbOptions {
                cloud_config: None,
                steam_roots: Some(std::slice::from_ref(&steam)),
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            b"binds-b\n"
        );
        assert_eq!(
            fs::read(
                steam
                    .join("userdata")
                    .join("111")
                    .join("440")
                    .join("remote")
                    .join("cfg")
                    .join("config.cfg")
            )
            .unwrap(),
            b"binds-b\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn refuse_while_running_and_unknown_profile() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "x\n");
        let a = save(&profiles, &root, "A");
        let err =
            switch_profile_to(&profiles, &root, &a, [tf2_name()], no_steam(), |_| {}).unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        let err = switch_profile_to(&profiles, &root, "missing", unlocked(), no_steam(), |_| {})
            .unwrap_err();
        assert_eq!(err, ProfileError::UnknownProfile);
        cleanup(&dir);
    }

    #[test]
    fn switching_to_active_is_noop() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "x\n");
        let a = save(&profiles, &root, "A");
        let mut steps = Vec::new();
        let library = switch_profile_to(&profiles, &root, &a, unlocked(), no_steam(), |step| {
            steps.push(step)
        })
        .unwrap();
        assert_eq!(library.active_profile_id.as_deref(), Some(a.as_str()));
        assert_eq!(steps_of(&steps), vec![SwitchStep::Closed, SwitchStep::Done]);
        cleanup(&dir);
    }

    #[test]
    fn a_missing_source_file_fails_before_any_live_file_is_removed() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(&root.join("tf/cfg/overrides/autoexec.cfg"), "fov 90\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud-a\n");
        let a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[
                ("tf/cfg/config.cfg", b"binds-b\n"),
                ("tf/custom/alt/note.txt", b"alt\n"),
            ],
        );
        // The library lost one of B's files (deleted app data, failed import).
        fs::remove_file(exclusive_file_path(&profiles, &b, "tf/custom/alt/note.txt")).unwrap();
        let before = (
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            fs::read(root.join("tf/cfg/overrides/autoexec.cfg")).unwrap(),
            fs::read(root.join("tf/custom/hud/info.vdf")).unwrap(),
        );

        let mut steps = Vec::new();
        let err = switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |step| {
            steps.push(step)
        })
        .unwrap_err();

        assert!(err.message().contains("tf/custom/alt/note.txt"), "{err:?}");
        // Pre-flight, so nothing was removed and the pointer is intact.
        assert!(!steps.contains(&SwitchProgress::new(SwitchStep::Remove)));
        assert_eq!(
            (
                fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
                fs::read(root.join("tf/cfg/overrides/autoexec.cfg")).unwrap(),
                fs::read(root.join("tf/custom/hud/info.vdf")).unwrap(),
            ),
            before
        );
        assert_eq!(
            load_library_from(&profiles, Some(&root))
                .unwrap()
                .active_profile_id
                .as_deref(),
            Some(a.as_str())
        );
        cleanup(&dir);
    }

    #[test]
    fn a_corrupt_target_source_fails_before_remove() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(&root.join("tf/custom/ahud/info.vdf"), "hud-a\n");
        let a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[("tf/cfg/config.cfg", b"binds-b\n")],
        );
        fs::write(
            exclusive_file_path(&profiles, &b, "tf/cfg/config.cfg"),
            b"tampered",
        )
        .unwrap();

        let mut steps = Vec::new();
        let err = switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |step| {
            steps.push(step)
        })
        .unwrap_err();
        assert!(err.message().contains("integrity verification"), "{err:?}");
        assert!(!steps.iter().any(|step| step.step == SwitchStep::Remove));
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            b"binds-a\n"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/ahud/info.vdf")).unwrap(),
            b"hud-a\n"
        );
        assert_eq!(
            load_library_from(&profiles, Some(&root))
                .unwrap()
                .active_profile_id
                .as_deref(),
            Some(a.as_str())
        );
        cleanup(&dir);
    }

    #[test]
    fn a_failure_after_the_remove_step_clears_the_active_profile() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(&root.join("tf/cfg/overrides/autoexec.cfg"), "fov 90\n");
        let a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[
                ("tf/cfg/config.cfg", b"binds-b\n"),
                ("tf/custom/alt/note.txt", b"alt\n"),
            ],
        );
        assert_eq!(
            load_library_from(&profiles, Some(&root))
                .unwrap()
                .active_profile_id
                .as_deref(),
            Some(a.as_str())
        );
        // A directory sitting where one of B's files must land: the write fails
        // after the remove step, exactly like an AV lock or a full disk.
        fs::create_dir_all(root.join("tf/custom/alt/note.txt/blocker")).unwrap();

        let err =
            switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |_| {}).unwrap_err();

        assert!(err.message().contains("mid-switch"), "{err:?}");
        // A's files are gone from the live tree. If the index still named A,
        // the next auto-absorb would absorb their absence into A and destroy it.
        assert!(!root.join("tf/cfg/overrides/autoexec.cfg").exists());
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        assert_eq!(
            library.active_profile_id, None,
            "a half-replaced live tree must not stay pointed at the old profile"
        );
        cleanup(&dir);
    }

    #[test]
    fn active_commit_failure_keeps_a_durable_snapshot_and_never_emits_done() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        let _a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[("tf/cfg/config.cfg", b"binds-b\n")],
        );
        let index_part = crate::hash::part_path(&crate::profile::index_file(&profiles));
        let mut steps = Vec::new();
        let err = switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |step| {
            if step.step == SwitchStep::Cloud {
                fs::create_dir_all(&index_part).unwrap();
            }
            steps.push(step);
        })
        .unwrap_err();

        assert!(err.message().contains("mid-switch"), "{err:?}");
        assert!(!steps.iter().any(|step| step.step == SwitchStep::Done));
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        assert_eq!(library.active_profile_id, None);
        assert_eq!(
            library.pending_switch_profile_id.as_deref(),
            Some(b.as_str())
        );
        let pending = pending_switch_to(&profiles, &root).unwrap().unwrap();
        assert!(pending.cleanup_files.iter().any(|file| {
            file.path == "tf/cfg/config.cfg" && file.sha256 == crate::hash::sha256_hex(b"binds-b\n")
        }));

        // Even if B changes while recovery is pending, the immutable journal
        // still knows how to remove bytes written by the failed attempt.
        fs::remove_dir_all(&index_part).unwrap();
        put_exclusive_file_to(
            &profiles,
            &root,
            &b,
            "tf/cfg/config.cfg",
            b"binds-b-new\n",
            unlocked(),
        )
        .unwrap();
        let mut active_at_done = false;
        switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |step| {
            if step.step == SwitchStep::Done {
                active_at_done = load_library_from(&profiles, Some(&root))
                    .unwrap()
                    .active_profile_id
                    .as_deref()
                    == Some(b.as_str());
            }
        })
        .unwrap();
        assert!(
            active_at_done,
            "Done must follow the durable active-id commit"
        );
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            b"binds-b-new\n"
        );
        assert_eq!(
            load_library_from(&profiles, Some(&root))
                .unwrap()
                .pending_switch_profile_id,
            None
        );
        cleanup(&dir);
    }

    /// A switch used to answer Update to a prompt the user never saw: a pack
    /// missing from the live tree was deleted from the old profile's library
    /// and its Keep list was wiped. The pack step now takes only what was
    /// added; a removed pack comes back when the user switches back.
    #[test]
    fn switching_away_keeps_a_removed_packs_library_copy_and_the_keep_list() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(&root.join("tf/custom/old/pack.txt"), "old\n");
        let a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[("tf/cfg/config.cfg", b"binds-b\n")],
        );
        // The user kept `extra` out of the profile, then deleted `old`, and
        // switched without answering the prompt about it.
        write_live(&root.join("tf/custom/extra/note.txt"), "extra\n");
        crate::absorb::absorb_packs_to(
            &profiles,
            &root,
            crate::absorb::PackChoice::Keep,
            unlocked(),
            no_steam(),
        )
        .unwrap();
        fs::remove_dir_all(root.join("tf/custom/old")).unwrap();
        write_live(&root.join("tf/custom/new/pack.txt"), "new\n");

        switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |_| {}).unwrap();

        let manifest = load_manifest(&profiles, &a).unwrap();
        assert!(
            manifest
                .files
                .iter()
                .any(|f| f.path == "tf/custom/old/pack.txt"),
            "the removed pack must keep its library copy"
        );
        assert!(
            exclusive_file_path(&profiles, &a, "tf/custom/old/pack.txt").is_file(),
            "the removed pack's bytes must survive the switch"
        );
        assert!(
            manifest
                .files
                .iter()
                .any(|f| f.path == "tf/custom/new/pack.txt"),
            "an added pack is absorbed so it does not leak into B"
        );
        assert!(
            !root.join("tf/custom/new").exists(),
            "and then removed from the live tree"
        );
        assert_eq!(manifest.ignored_packs, vec!["extra".to_string()]);
        assert!(
            root.join("tf/custom/extra/note.txt").is_file(),
            "Keep means keep"
        );

        // Switching back writes the removed pack out again: exact replace.
        switch_profile_to(&profiles, &root, &a, unlocked(), no_steam(), |_| {}).unwrap();
        assert_eq!(
            fs::read(root.join("tf/custom/old/pack.txt")).unwrap(),
            b"old\n"
        );
        cleanup(&dir);
    }

    /// With no active profile a switch had nothing to remove, so the retry
    /// after a failed switch merged the two profiles' packs. The index now
    /// remembers whose Remove step was cut off.
    #[test]
    fn a_retry_after_a_failed_switch_finishes_the_remove_step() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        write_live(&root.join("tf/custom/ahud/info.vdf"), "a\n");
        write_live(&root.join("tf/custom/ahud/resource/ui/z.res"), "z\n");
        let a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[
                ("tf/cfg/config.cfg", b"binds-b\n"),
                ("tf/custom/alt/note.txt", b"alt\n"),
            ],
        );
        // Fail the write step after the removal of `ahud` began but before
        // every file went: block B's write.
        fs::create_dir_all(root.join("tf/custom/alt/note.txt/blocker")).unwrap();
        // ... and make one of A's files un-removable by hashing differently.
        write_live(
            &root.join("tf/custom/ahud/resource/ui/z.res"),
            "edited-after\n",
        );
        let err =
            switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |_| {}).unwrap_err();
        assert!(err.message().contains("mid-switch"), "{err:?}");
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        assert_eq!(library.active_profile_id, None);
        assert_eq!(library.interrupted_profile_id.as_deref(), Some(a.as_str()));

        // The pack step absorbed the edit into A before the failure, so the
        // live file now hashes as A's again. Unblock and retry.
        fs::remove_dir_all(root.join("tf/custom/alt/note.txt")).unwrap();
        switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |_| {}).unwrap();

        assert!(
            !root.join("tf/custom/ahud").exists(),
            "the retry must finish removing A's files instead of merging"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/alt/note.txt")).unwrap(),
            b"alt\n"
        );
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        assert_eq!(library.active_profile_id.as_deref(), Some(b.as_str()));
        assert_eq!(library.interrupted_profile_id, None);
        cleanup(&dir);
    }

    #[test]
    fn a_manifest_path_outside_the_file_safe_surface_is_refused() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "binds-a\n");
        let _a = save(&profiles, &root, "A");
        let b = library_profile(
            &profiles,
            &root,
            "B",
            &[("tf/cfg/config.cfg", b"binds-b\n")],
        );

        // Hand-edited / legacy manifest naming a game binary.
        let mut manifest = load_manifest(&profiles, &b).unwrap();
        manifest.files.push(ProfileFile {
            path: "bin/x64/client.dll".into(),
            sha256: crate::hash::sha256_hex(b"x"),
            storage: FileStorage::Exclusive,
        });
        let json = serde_json::to_string_pretty(&manifest).unwrap();
        fs::write(
            crate::profile::manifest_file(&profiles, &b),
            format!("{json}\n"),
        )
        .unwrap();

        let err =
            switch_profile_to(&profiles, &root, &b, unlocked(), no_steam(), |_| {}).unwrap_err();
        assert_eq!(
            err,
            ProfileError::ForbiddenPath("bin/x64/client.dll".into())
        );
        assert!(!root.join("bin/x64/client.dll").exists());
        cleanup(&dir);
    }

    #[test]
    fn rewrite_extra_hud_path_prefixes() {
        assert_eq!(
            rewrite_extra_hud_path("tf/custom/zhud/info.vdf", &["zhud".into()]),
            "tf/custom/-zhud/info.vdf"
        );
        assert_eq!(
            rewrite_extra_hud_path("tf/custom/ahud/info.vdf", &["zhud".into()]),
            "tf/custom/ahud/info.vdf"
        );
    }
}
