//! Viewmodel pack install (imported or built) + Casual itemtest preload.
//! This module never edits gameinfo.txt or official VPKs — the preloader
//! module owns those (snapshot-first, revertible; see AGENTS.md).

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::path::{Path, PathBuf};

use crate::apply::{cfg_layer_from_files, detail_from_manifest, ProfileDetail};
use crate::finder::discover_steam_roots;
use crate::hash::{metadata_is_link, validate_dir_within, validate_file_within};
use crate::launch::{
    sanitize_launch_options, sync_committed_profile_launch_options,
    write_launch_options_to_localconfig, write_launch_options_to_localconfig_from,
    LaunchWriteReason,
};
use crate::preloader::preload_is_wanted;
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, load_library_from, load_manifest, mutate_profile_files_to, profile_dir,
    profiles_dir, FileSource, FileStorage, ProfileError, ProfileLiveProjection, ProfileManifest,
    ViewmodelRecord, ViewmodelSource,
};
use crate::surface::CfgLayer;
use crate::vpk::validate_vpk_dir_bytes;
#[cfg(test)]
use crate::vpk::write_vpk_v1;

pub const EXECS_VIEWMODELS_PACK: &str = "execs-viewmodels";
pub const EXECS_VIEWMODELS_VPK: &str = "tf/custom/execs-viewmodels.vpk";
pub const EXECS_PRELOAD_STEM: &str = "execs_preload";
pub const EXECS_PRELOAD_OVERRIDES_STEM: &str = "overrides/execs_preload";
const EXECS_PRELOAD_VANILLA_PATH: &str = "tf/cfg/execs_preload.cfg";
const EXECS_PRELOAD_COMFIG_PATH: &str = "tf/cfg/overrides/execs_preload.cfg";
const MAX_VIEWMODEL_VPK_BYTES: u64 = crate::mods::MAX_MOD_BYTES;
const MAX_VIEWMODEL_OPTIONS: usize = 64;
const MAX_VIEWMODEL_OPTION_KEY_BYTES: usize = 128;
const MAX_VIEWMODEL_OPTION_VALUE_BYTES: usize = 16 * 1024;
const MAX_VIEWMODEL_OPTIONS_BYTES: usize = 64 * 1024;
const MAX_LIVE_VIEWMODEL_ENTRIES: usize = 20_000;
const MAX_VIEWMODEL_TRANSACTION_SNAPSHOT_BYTES: u64 = 512 * 1024 * 1024;
pub fn serialize_preload_cfg() -> String {
    [
        "// execs preload — managed, do not edit by hand",
        // -1 loads without any pure whitelist; the point_servercommand cvar
        // must be set before the map loads or Casual resets it.
        "sv_pure -1",
        "sv_allow_point_servercommand always",
        "map itemtest",
        // wait counts frames; 10 gives heavier animation packs margin to finish caching.
        "wait 10; disconnect",
        // A beat for the disconnect to settle, then clean the console and
        // restart the menu music the map load cut off. TF2 has no
        // `playmenumusic` command — it logs as unknown; the menu music is a
        // VScript entry point.
        "wait 1; clear",
        "script_execute randommenumusic",
        "",
    ]
    .join("\n")
}

pub fn has_preload_launch(options: &str) -> bool {
    let tokens: Vec<&str> = options.split_whitespace().collect();
    tokens
        .windows(2)
        .any(|pair| pair[0] == "+exec" && is_preload_stem(pair[1]))
}

pub fn with_preload_launch(options: &str, enabled: bool) -> String {
    with_preload_launch_stem(options, enabled, EXECS_PRELOAD_STEM)
}

fn with_preload_launch_stem(options: &str, enabled: bool, stem: &str) -> String {
    let tokens: Vec<&str> = options.split_whitespace().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        if tokens[i] == "+exec"
            && tokens
                .get(i + 1)
                .is_some_and(|candidate| is_preload_stem(candidate))
        {
            i += 2;
            continue;
        }
        out.push(tokens[i].to_string());
        i += 1;
    }
    if enabled {
        out.push("+exec".into());
        out.push(stem.into());
    }
    sanitize_launch_options(&out.join(" "))
}

fn is_preload_stem(value: &str) -> bool {
    value == EXECS_PRELOAD_STEM || value == EXECS_PRELOAD_OVERRIDES_STEM
}

pub fn import_viewmodel_vpk(
    tf2_root: &Path,
    profile_id: &str,
    vpk_bytes: &[u8],
    preload: bool,
) -> Result<ProfileDetail, ProfileError> {
    let process_names = live_process_names();
    let steam_roots = discover_steam_roots();
    import_viewmodel_vpk_to_with_launch(
        &profiles_dir(),
        &crate::settings::execs_data_dir(),
        tf2_root,
        profile_id,
        vpk_bytes,
        preload,
        ViewmodelSource::Imported,
        BTreeMap::new(),
        process_names.clone(),
        process_names,
        &steam_roots,
        true,
    )
}

/// Install a pack built from Yttrium-style hidden groups. Same machinery as
/// import; the record remembers the hidden set for re-editing.
pub fn install_built_viewmodel_pack(
    tf2_root: &Path,
    profile_id: &str,
    vpk_bytes: &[u8],
    hidden_groups: &std::collections::BTreeSet<String>,
    mode: crate::viewmodel_build::ViewmodelHideMode,
    preload: bool,
) -> Result<ProfileDetail, ProfileError> {
    let mut options = BTreeMap::new();
    options.insert(
        "hidden".into(),
        hidden_groups.iter().cloned().collect::<Vec<_>>().join(","),
    );
    options.insert("mode".into(), mode.as_str().into());
    options.insert("schema".into(), "yttrium-1".into());
    let process_names = live_process_names();
    let steam_roots = discover_steam_roots();
    import_viewmodel_vpk_to_with_launch(
        &profiles_dir(),
        &crate::settings::execs_data_dir(),
        tf2_root,
        profile_id,
        vpk_bytes,
        preload,
        ViewmodelSource::Compiled,
        options,
        process_names.clone(),
        process_names,
        &steam_roots,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn import_viewmodel_vpk_to<I, S>(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    vpk_bytes: &[u8],
    preload: bool,
    source: ViewmodelSource,
    options: BTreeMap<String, String>,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    import_viewmodel_vpk_to_with_launch(
        profiles_dir,
        data_dir,
        tf2_root,
        profile_id,
        vpk_bytes,
        preload,
        source,
        options,
        running_names,
        std::iter::empty::<String>(),
        &[],
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn import_viewmodel_vpk_to_with_launch<I, J, S, T>(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    vpk_bytes: &[u8],
    preload: bool,
    source: ViewmodelSource,
    options: BTreeMap<String, String>,
    running_names: I,
    steam_names: J,
    steam_roots: &[PathBuf],
    fresh_steam_process_check: bool,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    J: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let steam: Vec<String> = steam_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    validate_viewmodel_import_metadata(vpk_bytes.len(), &options)?;
    validate_vpk_dir_bytes(vpk_bytes).map_err(|err| ProfileError::Io(err.message()))?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    refuse_untracked_live_viewmodel_files(profiles_dir, tf2_root, profile_id, &manifest)?;
    // Importing without preload must not strip the shared cfg and launch
    // token out from under the mods preloader — the same guard `remove` and
    // `set_viewmodel_preload` carry. With preload on, the cfg is rewritten
    // below either way.
    let keep_preload =
        !preload && preload_is_wanted(data_dir, tf2_root).map_err(ProfileError::Io)?;
    let preload_cfg = serialize_preload_cfg();
    let mut puts = vec![(
        EXECS_VIEWMODELS_VPK.to_string(),
        FileSource::Bytes(vpk_bytes),
    )];
    let mut remove_paths = viewmodel_paths(&manifest, !keep_preload);
    let next_launch = if keep_preload {
        None
    } else {
        let plan = preload_plan(&manifest, preload);
        remove_paths.extend(plan.remove_paths);
        if let Some(path) = plan.put_path {
            puts.push((path.to_string(), FileSource::Bytes(preload_cfg.as_bytes())));
        }
        Some(plan.next_launch_options)
    };
    remove_paths.sort();
    remove_paths.dedup();
    validate_viewmodel_snapshot_budget(
        profiles_dir,
        tf2_root,
        profile_id,
        &manifest,
        &remove_paths,
    )?;

    let record = ViewmodelRecord {
        id: EXECS_VIEWMODELS_PACK.into(),
        source,
        preload,
        options,
    };
    let expected_launch = next_launch.clone();
    let manifest = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &puts,
        &remove_paths,
        ProfileLiveProjection::MirrorIfActive,
        running.iter().map(String::as_str),
        move |manifest| {
            manifest.viewmodel = Some(record);
            if let Some(next) = next_launch {
                manifest.launch_options = next;
                manifest.launch_sync_pending = true;
            }
            Ok(())
        },
    )?;
    if let Some(expected) = expected_launch {
        sync_launch_after_commit(
            profiles_dir,
            tf2_root,
            profile_id,
            &expected,
            &running,
            &steam,
            steam_roots,
            fresh_steam_process_check,
        )?;
    }
    Ok(detail_from_manifest(&manifest))
}

pub fn remove_viewmodels(tf2_root: &Path, profile_id: &str) -> Result<ProfileDetail, ProfileError> {
    let process_names = live_process_names();
    let steam_roots = discover_steam_roots();
    remove_viewmodels_to_with_launch(
        &profiles_dir(),
        &crate::settings::execs_data_dir(),
        tf2_root,
        profile_id,
        process_names.clone(),
        process_names,
        &steam_roots,
        true,
    )
}

pub fn remove_viewmodels_to<I, S>(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    remove_viewmodels_to_with_launch(
        profiles_dir,
        data_dir,
        tf2_root,
        profile_id,
        running_names,
        std::iter::empty::<String>(),
        &[],
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn remove_viewmodels_to_with_launch<I, J, S, T>(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
    steam_names: J,
    steam_roots: &[PathBuf],
    fresh_steam_process_check: bool,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    J: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let steam: Vec<String> = steam_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    // The preload cfg is shared with the mods preloader. Removing the
    // viewmodel pack must leave it alone while patched particles or addon
    // content are still installed, or those mods silently stop working on
    // Casual (AGENTS.md: "unless a viewmodel pack still uses it" — this is
    // the mirror of that rule).
    let keep_preload = preload_is_wanted(data_dir, tf2_root).map_err(ProfileError::Io)?;
    let before = load_manifest(profiles_dir, profile_id)?;
    refuse_untracked_live_viewmodel_files(profiles_dir, tf2_root, profile_id, &before)?;
    let preload_was = before
        .viewmodel
        .as_ref()
        .is_some_and(|record| record.preload);
    let update_preload = preload_was && !keep_preload;
    let mut remove_paths = viewmodel_paths(&before, update_preload);
    let next_launch = update_preload.then(|| {
        let plan = preload_plan(&before, false);
        remove_paths.extend(plan.remove_paths);
        plan.next_launch_options
    });
    remove_paths.sort();
    remove_paths.dedup();
    validate_viewmodel_snapshot_budget(profiles_dir, tf2_root, profile_id, &before, &remove_paths)?;
    let expected_launch = next_launch.clone();
    let manifest = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[],
        &remove_paths,
        ProfileLiveProjection::MirrorIfActive,
        running.iter().map(String::as_str),
        move |manifest| {
            manifest.viewmodel = None;
            if let Some(next) = next_launch {
                manifest.launch_options = next;
                manifest.launch_sync_pending = true;
            }
            Ok(())
        },
    )?;
    if let Some(expected) = expected_launch {
        sync_launch_after_commit(
            profiles_dir,
            tf2_root,
            profile_id,
            &expected,
            &running,
            &steam,
            steam_roots,
            fresh_steam_process_check,
        )?;
    }
    Ok(detail_from_manifest(&manifest))
}

/// Whether the profile carries the shared preload cfg (either layer).
pub fn profile_has_preload(manifest: &crate::profile::ProfileManifest) -> bool {
    manifest
        .files
        .iter()
        .any(|file| is_preload_path(&file.path))
}

/// The one Casual-preload switch (Mods pane): write or remove the shared
/// preload cfg and launch token for the active profile, regardless of what
/// wants it. A viewmodel record present on the profile follows the choice so
/// the two can never disagree.
pub fn set_profile_preload(
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
) -> Result<ProfileDetail, ProfileError> {
    let profiles_dir = profiles_dir();
    let running: Vec<String> = live_process_names();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let steam = running.clone();
    let steam_roots = discover_steam_roots();
    let before = load_manifest(&profiles_dir, profile_id)?;
    let preload_cfg = serialize_preload_cfg();
    let plan = preload_plan(&before, enabled);
    let puts = plan
        .put_path
        .map(|path| vec![(path.to_string(), FileSource::Bytes(preload_cfg.as_bytes()))])
        .unwrap_or_default();
    let expected_launch = plan.next_launch_options.clone();
    let manifest = mutate_profile_files_to(
        &profiles_dir,
        tf2_root,
        profile_id,
        &puts,
        &plan.remove_paths,
        ProfileLiveProjection::MirrorIfActive,
        running.iter().map(String::as_str),
        move |manifest| {
            if let Some(record) = manifest.viewmodel.as_mut() {
                record.preload = enabled;
            }
            manifest.launch_options = plan.next_launch_options;
            manifest.launch_sync_pending = true;
            Ok(())
        },
    )?;
    sync_launch_after_commit(
        &profiles_dir,
        tf2_root,
        profile_id,
        &expected_launch,
        &running,
        &steam,
        &steam_roots,
        true,
    )?;
    Ok(detail_from_manifest(&manifest))
}

/// The mods preloader needs the shared preload cfg + launch token too, with
/// or without a viewmodel pack installed.
pub fn ensure_profile_preload(tf2_root: &Path, profile_id: &str) -> Result<(), ProfileError> {
    let running: Vec<String> = live_process_names();
    let steam = running.clone();
    let steam_roots = discover_steam_roots();
    set_preload_state(
        &profiles_dir(),
        tf2_root,
        profile_id,
        true,
        &running,
        &steam,
        &steam_roots,
    )?;
    Ok(())
}

/// Remove the preload cfg + launch token unless a viewmodel pack still wants
/// it. Used when the mods preloader is fully reverted.
pub fn remove_profile_preload_if_unused(
    tf2_root: &Path,
    profile_id: &str,
) -> Result<(), ProfileError> {
    let manifest = load_manifest(&profiles_dir(), profile_id)?;
    if manifest
        .viewmodel
        .as_ref()
        .is_some_and(|record| record.preload)
    {
        return Ok(());
    }
    let running: Vec<String> = live_process_names();
    let steam = running.clone();
    let steam_roots = discover_steam_roots();
    set_preload_state(
        &profiles_dir(),
        tf2_root,
        profile_id,
        false,
        &running,
        &steam,
        &steam_roots,
    )?;
    Ok(())
}

pub fn set_viewmodel_preload(
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
) -> Result<ProfileDetail, ProfileError> {
    let process_names = live_process_names();
    let steam_roots = discover_steam_roots();
    set_viewmodel_preload_to_with_launch(
        &profiles_dir(),
        &crate::settings::execs_data_dir(),
        tf2_root,
        profile_id,
        enabled,
        process_names.clone(),
        process_names,
        &steam_roots,
        true,
    )
}

pub fn set_viewmodel_preload_to<I, S>(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    set_viewmodel_preload_to_with_launch(
        profiles_dir,
        data_dir,
        tf2_root,
        profile_id,
        enabled,
        running_names,
        std::iter::empty::<String>(),
        &[],
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn set_viewmodel_preload_to_with_launch<I, J, S, T>(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
    running_names: I,
    steam_names: J,
    steam_roots: &[PathBuf],
    fresh_steam_process_check: bool,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    J: IntoIterator<Item = T>,
    T: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let steam: Vec<String> = steam_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    if enabled && manifest.viewmodel.is_none() {
        return Err(ProfileError::Io(
            "Import or build a viewmodel pack before enabling preload.".into(),
        ));
    }
    // Turning the viewmodel pack's preload off must not strip the shared cfg
    // and launch token out from under the mods preloader.
    let update_shared_preload =
        enabled || !preload_is_wanted(data_dir, tf2_root).map_err(ProfileError::Io)?;
    let preload_cfg = serialize_preload_cfg();
    let (puts, remove_paths, next_launch) = if update_shared_preload {
        let plan = preload_plan(&manifest, enabled);
        let puts = plan
            .put_path
            .map(|path| vec![(path.to_string(), FileSource::Bytes(preload_cfg.as_bytes()))])
            .unwrap_or_default();
        (puts, plan.remove_paths, Some(plan.next_launch_options))
    } else {
        (Vec::new(), Vec::new(), None)
    };
    let expected_launch = next_launch.clone();
    let manifest = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &puts,
        &remove_paths,
        ProfileLiveProjection::MirrorIfActive,
        running.iter().map(String::as_str),
        move |manifest| {
            if let Some(record) = manifest.viewmodel.as_mut() {
                record.preload = enabled;
            }
            if let Some(next) = next_launch {
                manifest.launch_options = next;
                manifest.launch_sync_pending = true;
            }
            Ok(())
        },
    )?;
    if let Some(expected) = expected_launch {
        sync_launch_after_commit(
            profiles_dir,
            tf2_root,
            profile_id,
            &expected,
            &running,
            &steam,
            steam_roots,
            fresh_steam_process_check,
        )?;
    }
    Ok(detail_from_manifest(&manifest))
}

fn set_preload_state(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    enabled: bool,
    running: &[String],
    steam: &[String],
    steam_roots: &[PathBuf],
) -> Result<ProfileManifest, ProfileError> {
    refuse_if_running_among(running).map_err(ProfileError::from)?;
    let before = load_manifest(profiles_dir, profile_id)?;
    let preload_cfg = serialize_preload_cfg();
    let plan = preload_plan(&before, enabled);
    let puts = plan
        .put_path
        .map(|path| vec![(path.to_string(), FileSource::Bytes(preload_cfg.as_bytes()))])
        .unwrap_or_default();
    let expected_launch = plan.next_launch_options.clone();
    let result = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &puts,
        &plan.remove_paths,
        ProfileLiveProjection::MirrorIfActive,
        running.iter().map(String::as_str),
        move |manifest| {
            manifest.launch_options = plan.next_launch_options;
            manifest.launch_sync_pending = true;
            Ok(())
        },
    )?;
    sync_launch_after_commit(
        profiles_dir,
        tf2_root,
        profile_id,
        &expected_launch,
        running,
        steam,
        steam_roots,
        true,
    )?;
    Ok(result)
}

struct PreloadPlan {
    put_path: Option<&'static str>,
    remove_paths: Vec<String>,
    next_launch_options: String,
}

fn preload_plan(manifest: &ProfileManifest, enabled: bool) -> PreloadPlan {
    let (path, launch_stem) = preload_target(manifest);
    PreloadPlan {
        put_path: enabled.then_some(path),
        remove_paths: manifest
            .files
            .iter()
            .filter(|file| is_preload_path(&file.path))
            .map(|file| file.path.clone())
            .collect(),
        next_launch_options: with_preload_launch_stem(
            &manifest.launch_options,
            enabled,
            launch_stem,
        ),
    }
}

/// Steam owns `localconfig.vdf`, so it cannot join the profile mutation
/// journal. The profile's launch options and pending marker commit first;
/// only an exact successful projection clears that marker. Deferred or failed
/// writes leave a durable, retryable source of truth instead of rolling the
/// already-committed viewmodel files back.
#[allow(clippy::too_many_arguments)]
fn sync_launch_after_commit(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    expected_launch_options: &str,
    running: &[String],
    steam: &[String],
    steam_roots: &[PathBuf],
    fresh_steam_process_check: bool,
) -> Result<(), ProfileError> {
    let result = sync_committed_profile_launch_options(
        profiles_dir,
        tf2_root,
        profile_id,
        expected_launch_options,
        running,
        || {
            if fresh_steam_process_check {
                write_launch_options_to_localconfig(steam_roots, expected_launch_options)
            } else {
                write_launch_options_to_localconfig_from(
                    steam_roots,
                    expected_launch_options,
                    steam.iter().map(String::as_str),
                )
            }
        },
    );
    if result.reason == LaunchWriteReason::WriteFailed {
        Err(ProfileError::Io(
            "The viewmodel change was saved, but Steam launch-option sync is still pending and can be retried."
                .into(),
        ))
    } else {
        Ok(())
    }
}

fn preload_target(manifest: &crate::profile::ProfileManifest) -> (&'static str, &'static str) {
    match cfg_layer_from_files(&manifest.files) {
        CfgLayer::Comfig => (EXECS_PRELOAD_COMFIG_PATH, EXECS_PRELOAD_OVERRIDES_STEM),
        CfgLayer::Vanilla => (EXECS_PRELOAD_VANILLA_PATH, EXECS_PRELOAD_STEM),
    }
}

fn validate_viewmodel_import_metadata(
    vpk_len: usize,
    options: &BTreeMap<String, String>,
) -> Result<(), ProfileError> {
    if u64::try_from(vpk_len).unwrap_or(u64::MAX) > MAX_VIEWMODEL_VPK_BYTES {
        return Err(ProfileError::Io(format!(
            "A viewmodel VPK may be at most {} MiB.",
            MAX_VIEWMODEL_VPK_BYTES / (1024 * 1024)
        )));
    }
    if options.len() > MAX_VIEWMODEL_OPTIONS {
        return Err(ProfileError::Io(format!(
            "A viewmodel record may have at most {MAX_VIEWMODEL_OPTIONS} options."
        )));
    }
    let mut total = 0usize;
    for (key, value) in options {
        if key.is_empty()
            || key.len() > MAX_VIEWMODEL_OPTION_KEY_BYTES
            || value.len() > MAX_VIEWMODEL_OPTION_VALUE_BYTES
            || key.chars().any(char::is_control)
            || value.chars().any(char::is_control)
        {
            return Err(ProfileError::Io(
                "Viewmodel option keys or values are invalid or too long.".into(),
            ));
        }
        total = total
            .checked_add(key.len())
            .and_then(|bytes| bytes.checked_add(value.len()))
            .ok_or_else(|| ProfileError::Io("Viewmodel option size overflowed.".into()))?;
        if total > MAX_VIEWMODEL_OPTIONS_BYTES {
            return Err(ProfileError::Io(format!(
                "Viewmodel options may total at most {} KiB.",
                MAX_VIEWMODEL_OPTIONS_BYTES / 1024
            )));
        }
    }
    Ok(())
}

/// The fixed legacy folder is still on TF2's search path beside the generated
/// VPK. A transaction can safely replace tracked entries, but silently leaving
/// unknown files there would mount customization the profile does not own.
fn refuse_untracked_live_viewmodel_files(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    manifest: &ProfileManifest,
) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() != Some(profile_id) {
        return Ok(());
    }
    let canonical_vpk = tf2_root
        .join("tf")
        .join("custom")
        .join("execs-viewmodels.vpk");
    match std::fs::symlink_metadata(&canonical_vpk) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(ProfileError::Io(err.to_string())),
        Ok(metadata) => {
            if metadata_is_link(&metadata) || !metadata.is_file() {
                return Err(ProfileError::Io(
                    "Refusing to replace a linked or invalid live viewmodel VPK.".into(),
                ));
            }
            validate_file_within(tf2_root, &canonical_vpk)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            if !manifest
                .files
                .iter()
                .any(|file| file.path.eq_ignore_ascii_case(EXECS_VIEWMODELS_VPK))
            {
                return Err(ProfileError::Io(
                    "The live execs-viewmodels.vpk is not tracked by this profile. Remove or save it before changing viewmodels."
                        .into(),
                ));
            }
        }
    }
    let dir = tf2_root
        .join("tf")
        .join("custom")
        .join(EXECS_VIEWMODELS_PACK);
    let metadata = match std::fs::symlink_metadata(&dir) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(ProfileError::Io(err.to_string())),
        Ok(metadata) => metadata,
    };
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return Err(ProfileError::Io(
            "Refusing to traverse a linked or invalid live viewmodel folder.".into(),
        ));
    }
    let prefix = format!("tf/custom/{EXECS_VIEWMODELS_PACK}/");
    let tracked: BTreeSet<String> = manifest
        .files
        .iter()
        .filter(|file| file.path.to_ascii_lowercase().starts_with(&prefix))
        .map(|file| file.path.to_ascii_lowercase())
        .collect();
    let mut pending = vec![dir];
    let mut entries = 0usize;
    while let Some(current) = pending.pop() {
        validate_dir_within(tf2_root, &current).map_err(|err| ProfileError::Io(err.to_string()))?;
        for entry in std::fs::read_dir(&current).map_err(|err| ProfileError::Io(err.to_string()))? {
            let path = entry
                .map_err(|err| ProfileError::Io(err.to_string()))?
                .path();
            let metadata = std::fs::symlink_metadata(&path)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            entries = entries.saturating_add(1);
            if entries > MAX_LIVE_VIEWMODEL_ENTRIES {
                return Err(ProfileError::Io(format!(
                    "The live viewmodel folder contains more than {MAX_LIVE_VIEWMODEL_ENTRIES} entries."
                )));
            }
            if metadata_is_link(&metadata) {
                return Err(ProfileError::Io(
                    "Refusing to traverse a link or junction in the live viewmodel folder.".into(),
                ));
            }
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            if !metadata.is_file() {
                return Err(ProfileError::Io(
                    "The live viewmodel folder contains an invalid entry.".into(),
                ));
            }
            let rel = path
                .strip_prefix(tf2_root)
                .map_err(|_| ProfileError::InvalidPath)?
                .to_string_lossy()
                .replace('\\', "/")
                .to_ascii_lowercase();
            if !tracked.contains(&rel) && !rel.ends_with(crate::hash::PART_SUFFIX) {
                return Err(ProfileError::Io(format!(
                    "The live viewmodel folder contains an untracked file: {rel}. Remove or save it before applying."
                )));
            }
        }
    }
    Ok(())
}

/// Bound the disk footprint of the generic transaction's old-byte snapshots.
/// Lengths come from the same open file handle and all paths are contained and
/// link-free before they are counted. The transaction itself then streams the
/// bytes through a fixed 64 KiB buffer instead of materializing either tree.
fn validate_viewmodel_snapshot_budget(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    manifest: &ProfileManifest,
    paths: &[String],
) -> Result<(), ProfileError> {
    let paths: BTreeSet<&str> = paths.iter().map(String::as_str).collect();
    let profile_root = profile_dir(profiles_dir, profile_id);
    let mut profile_bytes = 0_u64;
    for file in manifest
        .files
        .iter()
        .filter(|file| file.storage == FileStorage::Exclusive && paths.contains(file.path.as_str()))
    {
        let path = exclusive_file_path(profiles_dir, profile_id, &file.path);
        add_snapshot_file_len(&profile_root, &path, &mut profile_bytes)?;
    }

    let active = load_library_from(profiles_dir, Some(tf2_root))?
        .active_profile_id
        .as_deref()
        == Some(profile_id);
    if active {
        let mut live_bytes = 0_u64;
        for path in paths {
            add_snapshot_file_len(
                tf2_root,
                &crate::switch::live_path(tf2_root, path),
                &mut live_bytes,
            )?;
        }
    }
    Ok(())
}

fn add_snapshot_file_len(root: &Path, path: &Path, total: &mut u64) -> Result<(), ProfileError> {
    match std::fs::symlink_metadata(path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(ProfileError::Io(err.to_string())),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(ProfileError::InvalidPath)
        }
        Ok(_) => {}
    }
    validate_file_within(root, path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let file = File::open(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let len = file
        .metadata()
        .map_err(|err| ProfileError::Io(err.to_string()))?
        .len();
    *total = total.checked_add(len).ok_or_else(|| {
        ProfileError::Io("Viewmodel transaction snapshot size overflowed.".into())
    })?;
    if *total > MAX_VIEWMODEL_TRANSACTION_SNAPSHOT_BYTES {
        return Err(ProfileError::Io(format!(
            "Viewmodel transaction snapshots may not exceed {} MiB per tree.",
            MAX_VIEWMODEL_TRANSACTION_SNAPSHOT_BYTES / (1024 * 1024)
        )));
    }
    Ok(())
}

fn viewmodel_paths(manifest: &ProfileManifest, include_preload: bool) -> Vec<String> {
    manifest
        .files
        .iter()
        .filter(|file| {
            file.path == EXECS_VIEWMODELS_VPK
                || file.path.starts_with("tf/custom/execs-viewmodels/")
                || (include_preload && is_preload_path(&file.path))
        })
        .map(|file| file.path.clone())
        .collect()
}

fn is_preload_path(path: &str) -> bool {
    path == EXECS_PRELOAD_VANILLA_PATH || path == EXECS_PRELOAD_COMFIG_PATH
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apply::{write_owned_file_to, WriteOwnedOptions};
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::test_temp_dir;

    fn unlocked() -> Vec<String> {
        Vec::new()
    }

    fn locked() -> Vec<String> {
        vec![if cfg!(windows) {
            "tf_win64.exe".into()
        } else {
            "tf_linux64".into()
        }]
    }

    fn setup() -> (
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
        String,
    ) {
        let root = test_temp_dir();
        let tf2 = root.join("tf2");
        std::fs::create_dir_all(tf2.join("tf/cfg")).unwrap();
        std::fs::create_dir_all(tf2.join("tf/custom")).unwrap();
        std::fs::write(tf2.join("tf/steam.inf"), "appID=440\n").unwrap();
        let profiles = root.join("profiles");
        create_profile_record_to(&profiles, &tf2, "Main", unlocked()).unwrap();
        let id = crate::profile::load_library_from(&profiles, Some(&tf2))
            .unwrap()
            .profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &tf2, &id, unlocked()).unwrap();
        (root, profiles, tf2, id)
    }

    fn cleanup(root: &Path) {
        let _ = std::fs::remove_dir_all(root);
    }

    /// An app-data dir with no preloader state: nothing else wants the cfg.
    fn no_mods(root: &Path) -> PathBuf {
        root.join("data")
    }

    fn write_steam_account(steam: &Path, launch_options: &str) -> PathBuf {
        let localconfig = steam
            .join("userdata")
            .join("111")
            .join("config")
            .join("localconfig.vdf");
        std::fs::create_dir_all(localconfig.parent().unwrap()).unwrap();
        std::fs::write(
            &localconfig,
            format!(
                "\"UserLocalConfigStore\"\n{{\n  \"Software\"\n  {{\n    \"Valve\"\n    {{\n      \"Steam\"\n      {{\n        \"apps\"\n        {{\n          \"440\"\n          {{\n            \"LaunchOptions\" \"{launch_options}\"\n          }}\n        }}\n      }}\n    }}\n  }}\n}}\n"
            ),
        )
        .unwrap();
        localconfig
    }

    #[test]
    fn preload_cfg_is_itemtest_and_never_mentions_gameinfo() {
        let cfg = serialize_preload_cfg();
        assert!(cfg.contains("sv_pure -1"));
        assert!(cfg.contains("sv_allow_point_servercommand always"));
        assert!(cfg.contains("map itemtest"));
        assert!(cfg.contains("disconnect"));
        assert!(cfg.contains("script_execute randommenumusic"));
        assert!(!cfg.contains("gameinfo"));
        assert!(!cfg.contains("+quit"));
        let enabled = with_preload_launch("-novid -nojoy", true);
        assert!(has_preload_launch(&enabled));
        assert!(!with_preload_launch(&enabled, false).contains("execs_preload"));
        let comfig = format!("-novid +exec {EXECS_PRELOAD_OVERRIDES_STEM}");
        assert!(has_preload_launch(&comfig));
        assert_eq!(with_preload_launch(&comfig, false), "-novid");
        assert!(!with_preload_launch("-novid -autoconfig +quit", true).contains("+quit"));
    }

    #[test]
    fn import_installs_vpk_and_preload() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert(
            "models/weapons/c_models/c_scout_animations.mdl".into(),
            b"mdl".to_vec(),
        );
        let vpk = write_vpk_v1(&files);
        let detail = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &vpk,
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        assert_eq!(
            detail.viewmodel.as_ref().unwrap().source,
            ViewmodelSource::Imported
        );
        assert!(detail.viewmodel.as_ref().unwrap().preload);
        assert!(tf2.join("tf/custom/execs-viewmodels.vpk").is_file());
        assert!(tf2.join("tf/cfg/execs_preload.cfg").is_file());
        assert!(detail.launch_options.contains("execs_preload"));
        remove_viewmodels_to(&profiles, &no_mods(&root), &tf2, &id, unlocked()).unwrap();
        assert!(!tf2.join("tf/custom/execs-viewmodels.vpk").exists());
        assert!(!tf2.join("tf/cfg/execs_preload.cfg").exists());
        cleanup(&root);
    }

    #[test]
    fn enabling_preload_without_viewmodels_is_side_effect_free() {
        let (root, profiles, tf2, id) = setup();
        let before = load_manifest(&profiles, &id).unwrap();
        let err = set_viewmodel_preload_to(&profiles, &no_mods(&root), &tf2, &id, true, unlocked())
            .unwrap_err();
        assert!(err.message().contains("Import or build"));
        let after = load_manifest(&profiles, &id).unwrap();
        assert_eq!(after.launch_options, before.launch_options);
        assert_eq!(after.files, before.files);
        assert!(!tf2.join("tf/cfg/execs_preload.cfg").exists());
        assert!(!tf2.join("tf/cfg/overrides/execs_preload.cfg").exists());
        cleanup(&root);
    }

    #[test]
    fn disabling_preload_removes_the_managed_cfg_and_launch_token() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();

        let detail =
            set_viewmodel_preload_to(&profiles, &no_mods(&root), &tf2, &id, false, unlocked())
                .unwrap();
        assert!(!detail.viewmodel.as_ref().unwrap().preload);
        assert!(!detail.launch_options.contains("execs_preload"));
        assert!(!tf2.join("tf/cfg/execs_preload.cfg").exists());
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest
            .files
            .iter()
            .any(|file| file.path.ends_with("execs_preload.cfg")));
        cleanup(&root);
    }

    #[test]
    fn comfig_preload_uses_the_overrides_exec_target() {
        let (root, profiles, tf2, id) = setup();
        write_owned_file_to(
            &profiles,
            &tf2,
            &id,
            "tf/cfg/overrides/modules.cfg",
            b"lighting=high\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        let detail = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        assert!(tf2.join(EXECS_PRELOAD_COMFIG_PATH).is_file());
        assert!(detail
            .launch_options
            .contains("+exec overrides/execs_preload"));
        assert!(!detail.launch_options.contains("+exec execs_preload"));
        cleanup(&root);
    }

    #[test]
    fn preload_updates_steam_launch_options_when_steam_is_closed() {
        let (root, profiles, tf2, id) = setup();
        let steam = root.join("Steam");
        let localconfig = write_steam_account(&steam, "-novid");
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        import_viewmodel_vpk_to_with_launch(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
            unlocked(),
            &[steam],
            false,
        )
        .unwrap();
        let text = std::fs::read_to_string(localconfig).unwrap();
        assert!(text.contains("\"LaunchOptions\"\t\t\"+exec execs_preload\""));
        assert!(!load_manifest(&profiles, &id).unwrap().launch_sync_pending);
        cleanup(&root);
    }

    #[test]
    fn malformed_localconfig_leaves_the_committed_change_pending_for_retry() {
        let (root, profiles, tf2, id) = setup();
        let mut old_files = BTreeMap::new();
        old_files.insert("models/old.mdl".into(), b"old".to_vec());
        let old_vpk = write_vpk_v1(&old_files);
        import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &old_vpk,
            false,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        let before_manifest = load_manifest(&profiles, &id).unwrap();
        let before_live = std::fs::read(tf2.join(EXECS_VIEWMODELS_VPK)).unwrap();

        let steam = root.join("Steam");
        let localconfig = write_steam_account(&steam, "-novid");
        std::fs::write(&localconfig, "{{{ malformed").unwrap();
        let mut new_files = BTreeMap::new();
        new_files.insert("models/new.mdl".into(), b"new".to_vec());
        let new_vpk = write_vpk_v1(&new_files);
        let err = import_viewmodel_vpk_to_with_launch(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &new_vpk,
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
            unlocked(),
            &[steam],
            false,
        )
        .unwrap_err();

        let message = err.message().to_ascii_lowercase();
        assert!(message.contains("saved"), "{err:?}");
        assert!(message.contains("pending"), "{err:?}");
        let after = load_manifest(&profiles, &id).unwrap();
        assert_ne!(after, before_manifest);
        assert!(after.launch_sync_pending);
        assert!(after.viewmodel.as_ref().unwrap().preload);
        assert!(after.launch_options.contains("execs_preload"));
        assert_eq!(
            std::fs::read(tf2.join(EXECS_VIEWMODELS_VPK)).unwrap(),
            new_vpk
        );
        assert_ne!(before_live, new_vpk);
        assert!(tf2.join(EXECS_PRELOAD_VANILLA_PATH).exists());
        assert_eq!(
            std::fs::read_to_string(localconfig).unwrap(),
            "{{{ malformed"
        );
        cleanup(&root);
    }

    #[test]
    fn import_transaction_rolls_back_pack_preload_record_and_launch_together() {
        let (root, profiles, tf2, id) = setup();
        let mut old_files = BTreeMap::new();
        old_files.insert("models/old.mdl".into(), b"old".to_vec());
        let old_vpk = write_vpk_v1(&old_files);
        let mut old_options = BTreeMap::new();
        old_options.insert("generation".into(), "old".into());
        import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &old_vpk,
            false,
            ViewmodelSource::Imported,
            old_options,
            unlocked(),
        )
        .unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let before_live = std::fs::read(tf2.join(EXECS_VIEWMODELS_VPK)).unwrap();
        let before_profile = std::fs::read(crate::profile::exclusive_file_path(
            &profiles,
            &id,
            EXECS_VIEWMODELS_VPK,
        ))
        .unwrap();

        // The journal is already durable and both trees have been projected
        // when manifest.json is committed. Blocking its atomic part file
        // deterministically exercises the transaction's recovery path.
        let blocker = crate::hash::part_path(&crate::profile::manifest_file(&profiles, &id));
        std::fs::create_dir_all(&blocker).unwrap();
        let mut new_files = BTreeMap::new();
        new_files.insert("models/new.mdl".into(), b"new".to_vec());
        let new_vpk = write_vpk_v1(&new_files);
        let mut new_options = BTreeMap::new();
        new_options.insert("generation".into(), "new".into());
        let err = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &new_vpk,
            true,
            ViewmodelSource::Compiled,
            new_options.clone(),
            unlocked(),
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::Io(_)), "{err:?}");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(
            std::fs::read(tf2.join(EXECS_VIEWMODELS_VPK)).unwrap(),
            before_live
        );
        assert_eq!(
            std::fs::read(crate::profile::exclusive_file_path(
                &profiles,
                &id,
                EXECS_VIEWMODELS_VPK,
            ))
            .unwrap(),
            before_profile
        );
        assert!(!tf2.join(EXECS_PRELOAD_VANILLA_PATH).exists());

        // Once the filesystem fault is gone, the same action retries cleanly;
        // there is no half-action left to merge with it.
        std::fs::remove_dir(&blocker).unwrap();
        let detail = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &new_vpk,
            true,
            ViewmodelSource::Compiled,
            new_options,
            unlocked(),
        )
        .unwrap();
        assert_eq!(
            detail.viewmodel.as_ref().unwrap().source,
            ViewmodelSource::Compiled
        );
        assert!(detail.viewmodel.as_ref().unwrap().preload);
        assert_eq!(
            std::fs::read(tf2.join(EXECS_VIEWMODELS_VPK)).unwrap(),
            new_vpk
        );
        assert!(tf2.join(EXECS_PRELOAD_VANILLA_PATH).is_file());
        assert!(detail.launch_options.contains("execs_preload"));
        cleanup(&root);
    }

    #[test]
    fn oversized_prior_live_pack_is_rejected_without_materializing_a_snapshot() {
        let (root, profiles, tf2, id) = setup();
        let mut old_files = BTreeMap::new();
        old_files.insert("models/old.mdl".into(), b"old".to_vec());
        import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&old_files),
            false,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let live = tf2.join(EXECS_VIEWMODELS_VPK);
        std::fs::OpenOptions::new()
            .write(true)
            .open(&live)
            .unwrap()
            .set_len(MAX_VIEWMODEL_TRANSACTION_SNAPSHOT_BYTES + 1)
            .unwrap();

        let mut replacement = BTreeMap::new();
        replacement.insert("models/new.mdl".into(), b"new".to_vec());
        let err = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&replacement),
            false,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("512 MiB"), "{err:?}");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(
            std::fs::metadata(&live).unwrap().len(),
            MAX_VIEWMODEL_TRANSACTION_SNAPSHOT_BYTES + 1
        );
        cleanup(&root);
    }

    #[test]
    fn remove_preserves_drifted_live_viewmodel_files() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        let live_vpk = tf2.join(EXECS_VIEWMODELS_VPK);
        let live_preload = tf2.join(EXECS_PRELOAD_VANILLA_PATH);
        std::fs::write(&live_vpk, b"user drift").unwrap();
        std::fs::write(&live_preload, b"user drift\n").unwrap();

        let detail =
            remove_viewmodels_to(&profiles, &no_mods(&root), &tf2, &id, unlocked()).unwrap();
        assert_eq!(std::fs::read(live_vpk).unwrap(), b"user drift");
        assert_eq!(std::fs::read(live_preload).unwrap(), b"user drift\n");
        assert!(detail.viewmodel.is_none());
        assert!(!detail.launch_options.contains("execs_preload"));
        cleanup(&root);
    }

    /// A preloader state file that says mods are installed. The cfg and the
    /// launch token are then shared property, not the viewmodel pack's.
    fn mods_installed(root: &Path) -> PathBuf {
        let data = root.join("mods-data");
        std::fs::create_dir_all(data.join("preloader")).unwrap();
        std::fs::write(
            data.join("preloader/state.json"),
            br#"{"schema":1,"vpkLen":0,"vpk_len":0,"vpk_mtime_ms":0,"particle_mods":["Blue Water"]}"#,
        )
        .unwrap();
        assert!(crate::preloader::preload_is_wanted(&data, root).unwrap());
        data
    }

    /// AGENTS.md: full revert removes the preload cfg "unless a viewmodel pack
    /// still uses it" — and the mirror, which this covers: removing the
    /// viewmodel pack must not remove it while the mods preloader wants it.
    #[test]
    fn removing_a_viewmodel_pack_keeps_the_preload_the_mods_preloader_needs() {
        let (root, profiles, tf2, id) = setup();
        let data = mods_installed(&tf2);
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        import_viewmodel_vpk_to(
            &profiles,
            &data,
            &tf2,
            &id,
            &write_vpk_v1(&files),
            true,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        let live_preload = tf2.join(EXECS_PRELOAD_VANILLA_PATH);
        assert!(live_preload.is_file());

        let detail = remove_viewmodels_to(&profiles, &data, &tf2, &id, unlocked()).unwrap();
        assert!(detail.viewmodel.is_none());
        assert!(
            !tf2.join(EXECS_VIEWMODELS_VPK).exists(),
            "pack still removed"
        );
        // The shared cfg, its manifest entry, and the launch token all survive.
        assert!(live_preload.is_file(), "shared preload cfg must survive");
        assert!(detail.launch_options.contains("execs_preload"));
        assert!(load_manifest(&profiles, &id)
            .unwrap()
            .files
            .iter()
            .any(|file| is_preload_path(&file.path)));

        // Turning the (now absent) viewmodel preload off must not take it
        // either.
        let detail =
            set_viewmodel_preload_to(&profiles, &data, &tf2, &id, false, unlocked()).unwrap();
        assert!(live_preload.is_file());
        assert!(detail.launch_options.contains("execs_preload"));

        // Nor must importing a pack with preload off — whether it is the
        // first import or a re-import over a pack that had preload on.
        for preload_was in [false, true] {
            if preload_was {
                import_viewmodel_vpk_to(
                    &profiles,
                    &data,
                    &tf2,
                    &id,
                    &write_vpk_v1(&files),
                    true,
                    ViewmodelSource::Imported,
                    BTreeMap::new(),
                    unlocked(),
                )
                .unwrap();
                assert!(live_preload.is_file());
            }
            let detail = import_viewmodel_vpk_to(
                &profiles,
                &data,
                &tf2,
                &id,
                &write_vpk_v1(&files),
                false,
                ViewmodelSource::Imported,
                BTreeMap::new(),
                unlocked(),
            )
            .unwrap();
            assert!(!detail.viewmodel.as_ref().unwrap().preload);
            assert!(tf2.join(EXECS_VIEWMODELS_VPK).is_file());
            assert!(
                live_preload.is_file(),
                "import with preload off (was {preload_was}) must keep the shared cfg"
            );
            assert!(detail.launch_options.contains("execs_preload"));
            assert!(load_manifest(&profiles, &id)
                .unwrap()
                .files
                .iter()
                .any(|file| is_preload_path(&file.path)));
        }

        // Without the mods preloader, the same import does take it away.
        let detail = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&files),
            false,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        assert!(!live_preload.exists());
        assert!(!detail.launch_options.contains("execs_preload"));
        cleanup(&root);
    }

    #[test]
    fn import_refuses_untracked_legacy_viewmodel_content_without_mutating() {
        let (root, profiles, tf2, id) = setup();
        let untracked = tf2
            .join("tf/custom")
            .join(EXECS_VIEWMODELS_PACK)
            .join("cfg/autoexec.cfg");
        std::fs::create_dir_all(untracked.parent().unwrap()).unwrap();
        std::fs::write(&untracked, b"echo user-owned\n").unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());

        let err = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&files),
            false,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("untracked file"), "{err:?}");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert!(!tf2.join(EXECS_VIEWMODELS_VPK).exists());
        assert_eq!(std::fs::read(&untracked).unwrap(), b"echo user-owned\n");
        cleanup(&root);
    }

    #[test]
    fn remove_refuses_an_untracked_canonical_viewmodel_vpk_without_mutating() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("models/orphan.mdl".into(), b"user-owned".to_vec());
        let orphan = write_vpk_v1(&files);
        let live_vpk = tf2.join(EXECS_VIEWMODELS_VPK);
        std::fs::write(&live_vpk, &orphan).unwrap();
        let before = load_manifest(&profiles, &id).unwrap();

        let err =
            remove_viewmodels_to(&profiles, &no_mods(&root), &tf2, &id, unlocked()).unwrap_err();
        assert!(err.message().contains("not tracked"), "{err:?}");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(std::fs::read(&live_vpk).unwrap(), orphan);
        cleanup(&root);
    }

    #[test]
    fn remove_refuses_untracked_legacy_viewmodel_content_without_mutating() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&files),
            false,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            unlocked(),
        )
        .unwrap();
        let untracked = tf2
            .join("tf/custom")
            .join(EXECS_VIEWMODELS_PACK)
            .join("cfg/autoexec.cfg");
        std::fs::create_dir_all(untracked.parent().unwrap()).unwrap();
        std::fs::write(&untracked, b"echo user-owned\n").unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let before_vpk = std::fs::read(tf2.join(EXECS_VIEWMODELS_VPK)).unwrap();

        let err =
            remove_viewmodels_to(&profiles, &no_mods(&root), &tf2, &id, unlocked()).unwrap_err();
        assert!(err.message().contains("untracked file"), "{err:?}");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(
            std::fs::read(tf2.join(EXECS_VIEWMODELS_VPK)).unwrap(),
            before_vpk
        );
        assert_eq!(std::fs::read(&untracked).unwrap(), b"echo user-owned\n");
        cleanup(&root);
    }

    #[test]
    fn direct_import_metadata_has_practical_bounds() {
        let empty = BTreeMap::new();
        let err = validate_viewmodel_import_metadata(
            usize::try_from(MAX_VIEWMODEL_VPK_BYTES).unwrap() + 1,
            &empty,
        )
        .unwrap_err();
        assert!(err.message().contains("512 MiB"), "{err:?}");

        let too_many: BTreeMap<String, String> = (0..=MAX_VIEWMODEL_OPTIONS)
            .map(|index| (format!("key-{index}"), "value".into()))
            .collect();
        assert!(validate_viewmodel_import_metadata(0, &too_many).is_err());
        let controls = BTreeMap::from([("mode".into(), "full\nmalicious".into())]);
        assert!(validate_viewmodel_import_metadata(0, &controls).is_err());
    }

    #[test]
    fn game_running_wins_before_invalid_or_oversized_import_validation() {
        let (root, profiles, tf2, id) = setup();
        let options = BTreeMap::from([("bad\nkey".into(), "value".into())]);
        let err = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            b"not a vpk",
            false,
            ViewmodelSource::Imported,
            options,
            locked(),
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        cleanup(&root);
    }

    #[test]
    fn refuses_while_tf2_is_running() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("models/a.mdl".into(), b"x".to_vec());
        let err = import_viewmodel_vpk_to(
            &profiles,
            &no_mods(&root),
            &tf2,
            &id,
            &write_vpk_v1(&files),
            false,
            ViewmodelSource::Imported,
            BTreeMap::new(),
            locked(),
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        cleanup(&root);
    }
}
