//! The Mods pane: gameinfo bypass, the default mod library, revert.

use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use execs_core::mods::ParticleSource;
use execs_core::preloader::{ModsCatalog, PreloaderReport, PreloaderStatus, RevertReport};
use serde::Serialize;

use super::shared::{
    active_profile_id, blocking, confirmed_root, preloader_recovery_required,
    recover_pending_profile_mutations, refuse_pending_switch, with_root, ProfileSelectionContext,
};
use crate::error::CommandError;
use crate::{complete_durable_operation, handoff_durable_operation, ExclusiveOperation, WriteGate};

const STEAM_REPAIR_QUIESCENCE: Duration = Duration::from_secs(10);
const MAX_REPAIR_DIRECTORY_ENTRIES: usize = 4096;
const MAX_REPAIR_SNAPSHOT_PATH_BYTES: usize = 256 * 1024;

#[derive(Debug, PartialEq, Eq)]
struct RepairFileStamp {
    path: PathBuf,
    len: Option<u64>,
    modified_nanos: Option<u128>,
}

fn repair_file_stamp(path: PathBuf) -> Result<RepairFileStamp, CommandError> {
    match std::fs::metadata(&path) {
        Ok(metadata) => Ok(RepairFileStamp {
            path,
            len: Some(metadata.len()),
            modified_nanos: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|elapsed| elapsed.as_nanos()),
        }),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(RepairFileStamp {
            path,
            len: None,
            modified_nanos: None,
        }),
        Err(err) => Err(CommandError::new(
            "Io",
            format!("Could not inspect Steam's repair state ({err})"),
        )),
    }
}

/// Files whose replacement can overlap execs' sanctioned surfaces. Steam's
/// appmanifest is included because verification updates it as the external
/// job changes state; the two snapshots must have the same complete set and
/// metadata before maintenance can be released.
fn push_repair_snapshot_path(
    paths: &mut Vec<PathBuf>,
    path_bytes: &mut usize,
    path: PathBuf,
) -> Result<(), CommandError> {
    let next = path_bytes
        .checked_add(path.as_os_str().as_encoded_bytes().len())
        .ok_or_else(repair_snapshot_too_large)?;
    if next > MAX_REPAIR_SNAPSHOT_PATH_BYTES {
        return Err(repair_snapshot_too_large());
    }
    *path_bytes = next;
    paths.push(path);
    Ok(())
}

fn repair_snapshot_too_large() -> CommandError {
    CommandError::new(
        "RepairStateTooLarge",
        "TF2 contains too many top-level paths to safely confirm Steam's repair.",
    )
}

fn repair_surface_paths<I>(root: &Path, entries: I) -> Result<Vec<PathBuf>, CommandError>
where
    I: IntoIterator<Item = std::io::Result<PathBuf>>,
{
    let tf = root.join("tf");
    let mut paths = Vec::new();
    let mut path_bytes = 0;
    push_repair_snapshot_path(&mut paths, &mut path_bytes, tf.join("gameinfo.txt"))?;
    push_repair_snapshot_path(&mut paths, &mut path_bytes, tf.join("steam.inf"))?;
    let mut entry_count = 0;
    for entry in entries {
        entry_count += 1;
        if entry_count > MAX_REPAIR_DIRECTORY_ENTRIES {
            return Err(repair_snapshot_too_large());
        }
        let path = entry.map_err(|err| CommandError::new("Io", err.to_string()))?;
        if path.as_os_str().as_encoded_bytes().len()
            > MAX_REPAIR_SNAPSHOT_PATH_BYTES.saturating_sub(path_bytes)
        {
            return Err(repair_snapshot_too_large());
        }
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        if name.starts_with("tf2_misc_") && name.ends_with(".vpk") {
            push_repair_snapshot_path(&mut paths, &mut path_bytes, path)?;
        }
    }
    if let Some(steamapps) = root.parent().and_then(Path::parent) {
        push_repair_snapshot_path(
            &mut paths,
            &mut path_bytes,
            steamapps.join("appmanifest_440.acf"),
        )?;
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn repair_surface_snapshot(root: &Path) -> Result<Vec<RepairFileStamp>, CommandError> {
    let tf = root.join("tf");
    let entries = std::fs::read_dir(&tf).map_err(|err| {
        CommandError::new(
            "Io",
            format!("Could not inspect TF2 while confirming Steam's repair ({err})"),
        )
    })?;
    repair_surface_paths(root, entries.map(|entry| entry.map(|entry| entry.path())))?
        .into_iter()
        .map(repair_file_stamp)
        .collect()
}

fn repair_is_quiescent(root: &Path) -> Result<bool, CommandError> {
    execs_core::refuse_if_running()?;
    if !execs_core::preloader::preloader_status(root, &execs_core::execs_data_dir())?
        .untracked_modified
        .is_empty()
    {
        return Ok(false);
    }
    let before = repair_surface_snapshot(root)?;
    std::thread::sleep(STEAM_REPAIR_QUIESCENCE);
    execs_core::refuse_if_running()?;
    if !execs_core::preloader::preloader_status(root, &execs_core::execs_data_dir())?
        .untracked_modified
        .is_empty()
    {
        return Ok(false);
    }
    Ok(before == repair_surface_snapshot(root)?)
}

fn refuse_repair_cancel_while_processes_run(names: &[String]) -> Result<(), CommandError> {
    execs_core::refuse_if_running_among(names)?;
    if execs_core::process_lock::steam_running_among(names) {
        return Err(CommandError::new(
            "SteamRunning",
            "Close Steam completely before cancelling the repair lock.",
        ));
    }
    Ok(())
}

fn refuse_repair_cancel_unless_stably_closed(
    first: &[String],
    second: &[String],
) -> Result<(), CommandError> {
    refuse_repair_cancel_while_processes_run(first)?;
    refuse_repair_cancel_while_processes_run(second)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreloaderStatusPayload {
    pub status: PreloaderStatus,
    pub mods_cached: bool,
    pub mods_size_bytes: u64,
    /// Steam's stored TF2 launch options carry the preload exec. When the
    /// options could only be saved to the profile (Steam was open), this
    /// stays false and the pane tells the user how to finish the job.
    pub preload_launch_in_steam: bool,
    /// The active profile carries the shared preload cfg (Casual preload on).
    pub profile_preload: bool,
    /// Mods on the active profile that ship their own `particles/*.pcf`, so the
    /// pane can offer them beside the default library's. Empty when no profile
    /// is active.
    pub profile_particle_sources: Vec<ParticleSource>,
    /// Steam verification owns the write surface until a fresh status confirms
    /// that every previously untracked entry is stock again.
    pub repair_in_progress: bool,
    /// A crash left a durable preloader transaction which only a
    /// recovery-aware command (or Steam repair) may resolve.
    pub recovery_required: bool,
}

fn preloader_status_payload(
    root: &Path,
    repair_in_progress: bool,
) -> Result<PreloaderStatusPayload, CommandError> {
    let steam_options = execs_core::launch::read_launch_options();
    // The profile-level preload switch: whether the active profile carries
    // the shared preload cfg. No active profile reads as off.
    let active = active_profile_id(root).ok();
    let profile_preload = active
        .as_deref()
        .and_then(|id| execs_core::load_manifest(&execs_core::profiles_dir(), id).ok())
        .map(|manifest| execs_core::profile_has_preload(&manifest))
        .unwrap_or(false);
    let profile_particle_sources = active
        .as_deref()
        .and_then(|id| {
            execs_core::mods::profile_particle_sources_from(&execs_core::profiles_dir(), id).ok()
        })
        .unwrap_or_default();
    Ok(PreloaderStatusPayload {
        status: execs_core::preloader::preloader_status(root, &execs_core::execs_data_dir())?,
        mods_cached: crate::mods_fetch::is_cached(),
        mods_size_bytes: crate::mods_fetch::MODS_SIZE_BYTES,
        preload_launch_in_steam: steam_options.contains("+exec execs_preload")
            || steam_options.contains("+exec overrides/execs_preload"),
        profile_preload,
        profile_particle_sources,
        repair_in_progress,
        recovery_required: preloader_recovery_required(root)?,
    })
}

fn status_after_committed_change(root: &Path) -> Result<PreloaderStatusPayload, CommandError> {
    preloader_status_payload(root, false).map_err(|error| {
        CommandError::new(
            "CommittedStatusUnavailable",
            format!(
                "The change was applied, but its refreshed status is unavailable: {}",
                error.message
            ),
        )
    })
}

/// The one Casual-preload switch for the active profile (Mods pane).
#[tauri::command]
pub async fn set_profile_preload(
    gate: tauri::State<'_, WriteGate>,
    enabled: bool,
) -> Result<PreloaderStatusPayload, CommandError> {
    let _guard = gate.lock_for_preloader_recovery().await?;
    with_root(move |root| {
        let initial_names = execs_core::process_lock::live_process_names();
        execs_core::preloader::recover_pending_preloader_with_sampler(
            &root,
            &execs_core::execs_data_dir(),
            &initial_names,
            &execs_core::process_lock::live_process_names,
        )
        .map_err(CommandError::preloader)?;
        let profile_id = active_profile_id(&root)?;
        if enabled {
            // Bookkeeping comes first: a later profile-write failure leaves a
            // harmless retry entry instead of an enabled cfg revert can no
            // longer discover.
            execs_core::preloader::record_preload_profile(
                &execs_core::execs_data_dir(),
                &profile_id,
            )?;
        }
        execs_core::set_profile_preload(&root, &profile_id, enabled)?;
        status_after_committed_change(&root)
    })
    .await
}

#[tauri::command]
pub async fn get_preloader_status(
    gate: tauri::State<'_, WriteGate>,
) -> Result<PreloaderStatusPayload, CommandError> {
    let repairing = gate.operation_is(ExclusiveOperation::SteamVerification);
    with_root(move |root| preloader_status_payload(&root, repairing)).await
}

/// Finish a durable preloader transaction without changing the user's
/// selection. This is the explicit restart affordance for a marker left by a
/// crash before Apply had any visible selection change.
#[tauri::command]
pub async fn recover_preloader(
    gate: tauri::State<'_, WriteGate>,
) -> Result<PreloaderStatusPayload, CommandError> {
    let _guard = gate.lock_for_preloader_recovery().await?;
    with_root(|root| {
        let initial_names = execs_core::process_lock::live_process_names();
        execs_core::preloader::recover_pending_preloader_with_sampler(
            &root,
            &execs_core::execs_data_dir(),
            &initial_names,
            &execs_core::process_lock::live_process_names,
        )
        .map_err(CommandError::preloader)?;
        status_after_committed_change(&root)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultModsPayload {
    pub cached: bool,
    pub catalog: Option<ModsCatalog>,
}

/// The catalog if the library zip is already cached; never downloads.
#[tauri::command]
pub async fn get_default_mods() -> Result<DefaultModsPayload, CommandError> {
    blocking(|| {
        if !crate::mods_fetch::is_cached() {
            return Ok(DefaultModsPayload {
                cached: false,
                catalog: None,
            });
        }
        let catalog = execs_core::preloader::read_mods_catalog(&crate::mods_fetch::cache_path())?;
        Ok(DefaultModsPayload {
            cached: true,
            catalog: Some(catalog),
        })
    })
    .await
}

/// Download (or reuse) the pinned library zip and return its catalog.
#[tauri::command]
pub async fn download_default_mods() -> Result<DefaultModsPayload, CommandError> {
    blocking(|| {
        let zip = crate::mods_fetch::ensure_mods_zip()?;
        let catalog = execs_core::preloader::read_mods_catalog(&zip)?;
        Ok(DefaultModsPayload {
            cached: true,
            catalog: Some(catalog),
        })
    })
    .await
}

/// Apply a mod selection: restore previous patches, patch the selected
/// particle files into tf2_misc, pack addon content into tf/custom, and turn
/// the gameinfo bypass on. Refused while the game is running — checked
/// before the 81 MB library download, which runs outside the write gate so
/// an autosave is not queued behind it.
#[tauri::command]
pub async fn apply_preloader_mods(
    gate: tauri::State<'_, WriteGate>,
    addons: Vec<String>,
    particle_mods: Vec<String>,
    profile_particle_mods: Option<Vec<String>>,
) -> Result<PreloaderReport, CommandError> {
    let (context, zip) = with_root(|root| {
        execs_core::refuse_if_running()?;
        Ok((
            ProfileSelectionContext::capture(&root)?,
            crate::mods_fetch::ensure_mods_zip()?,
        ))
    })
    .await?;
    let _guard = gate.lock_for_preloader_recovery().await?;
    with_root(move |root| {
        context.ensure_current(&root)?;
        let selection = execs_core::preloader::PreloaderSelection {
            addons,
            particle_mods,
            profile_particle_mods: profile_particle_mods.unwrap_or_default(),
        };
        let has_content = !selection.addons.is_empty()
            || !selection.particle_mods.is_empty()
            || !selection.profile_particle_mods.is_empty();
        // Re-read the process list AFTER the download: core checks it again
        // right before the first byte goes into an official file.
        let initial_names = execs_core::process_lock::live_process_names();
        execs_core::preloader::recover_pending_preloader_with_sampler(
            &root,
            &execs_core::execs_data_dir(),
            &initial_names,
            &execs_core::process_lock::live_process_names,
        )
        .map_err(CommandError::preloader)?;
        // Persist the cleanup intent and enable the shared preload before any
        // mod bytes land. A crash or profile-sync failure can therefore leave
        // only a harmless enabled preload, never installed mods that silently
        // fail in Casual with no durable record of which profile needs it.
        if has_content {
            let profile_id = active_profile_id(&root)?;
            execs_core::preloader::record_preload_profile(
                &execs_core::execs_data_dir(),
                &profile_id,
            )?;
            execs_core::ensure_profile_preload(&root, &profile_id)?;
            // A committed profile mutation may still have cleanup work after
            // publishing its new state. Finish that journal before creating
            // the independent preloader transaction so a crash can never
            // strand both recovery domains at once.
            recover_pending_profile_mutations(&root)?;
        }
        let report = execs_core::preloader::apply_preloader_selection_with_sampler(
            &root,
            &execs_core::execs_data_dir(),
            &zip,
            &selection,
            &initial_names,
            &execs_core::process_lock::live_process_names,
        )
        .map_err(CommandError::preloader)?;
        Ok(report)
    })
    .await
}

#[tauri::command]
pub async fn set_gameinfo_bypass(
    gate: tauri::State<'_, WriteGate>,
    enabled: bool,
) -> Result<PreloaderStatusPayload, CommandError> {
    let _guard = gate.lock_for_preloader_recovery().await?;
    with_root(move |root| {
        let initial_names = execs_core::process_lock::live_process_names();
        execs_core::preloader::recover_pending_preloader_with_sampler(
            &root,
            &execs_core::execs_data_dir(),
            &initial_names,
            &execs_core::process_lock::live_process_names,
        )
        .map_err(CommandError::preloader)?;
        execs_core::preloader::set_gameinfo_bypass_with_sampler(
            &root,
            &execs_core::execs_data_dir(),
            enabled,
            &initial_names,
            &execs_core::process_lock::live_process_names,
        )
        .map_err(CommandError::preloader)?;
        status_after_committed_change(&root)
    })
    .await
}

/// Hand the stale-patch problem to the only thing that holds stock bytes:
/// Steam's own file verification. `steam://validate/440` starts "Verify
/// integrity of game files" for TF2; the pane polls status until the
/// untracked entries read as stock again and then re-applies the selection.
#[tauri::command]
pub async fn repair_game_files(gate: tauri::State<'_, WriteGate>) -> Result<(), CommandError> {
    // Resolve fallible process-wide state before reserving the gate. Startup
    // preflights this too, but keeping this order prevents a runtime
    // environment failure from stranding an in-memory verification lease.
    let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
    let operation = gate.begin_preloader_repair().await?;
    let preflight_data_dir = data_dir.clone();
    let preflight = blocking(move || {
        let root = confirmed_root()?;
        refuse_pending_switch(&root)?;
        execs_core::refuse_if_running()?;
        // A Prepared journal is retained while Steam owns the official files.
        // Cleanup-only state may be removed here; malformed, linked or
        // root-mismatched recovery input fails before the external handoff.
        execs_core::preloader::prepare_preloader_steam_repair(&root, &preflight_data_dir)
            .map_err(CommandError::preloader)?;
        Ok(())
    })
    .await;
    if let Err(error) = preflight {
        operation.finish();
        return Err(error);
    }
    let handoff_token = operation.clone();
    let result = blocking(move || {
        handoff_durable_operation(&data_dir, &handoff_token, || {
            tauri_plugin_opener::open_url("steam://validate/440", None::<&str>).map_err(|err| {
                CommandError::unknown(format!("Could not ask Steam to verify ({err})"))
            })
        })
    })
    .await;
    // An opener error is ambiguous: Steam may still have accepted the URI.
    // The durable helper retains maintenance unless persistence itself failed.
    result
}

/// Release Steam-verification maintenance only after the user says Steam has
/// completed and two backend snapshots remain clean and unchanged across a
/// conservative quiescence interval.
#[tauri::command]
pub async fn complete_game_file_repair(
    gate: tauri::State<'_, WriteGate>,
    steam_reports_complete: bool,
) -> Result<bool, CommandError> {
    if !steam_reports_complete {
        return Err(CommandError::new(
            "ConfirmationRequired",
            "Wait until Steam reports that verification finished, then confirm again.",
        ));
    }
    let Some(operation) = gate.current_token(ExclusiveOperation::SteamVerification) else {
        return Ok(true);
    };
    let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
    blocking(move || {
        let root = confirmed_root()?;
        complete_durable_operation(&data_dir, &operation, || {
            if !repair_is_quiescent(&root)? {
                return Ok(false);
            }
            let initial_names = execs_core::process_lock::live_process_names();
            execs_core::preloader::reconcile_preloader_after_steam_repair_with_sampler(
                &root,
                &data_dir,
                &initial_names,
                &execs_core::process_lock::live_process_names,
            )
            .map_err(CommandError::preloader)?;
            Ok(true)
        })
    })
    .await
}

/// Escape hatch for a verification the user cancelled. Closing both Steam and
/// TF2 is the proof that no external writer can still resume after the lease
/// is released; a renderer confirmation alone is intentionally insufficient.
#[tauri::command]
pub async fn cancel_game_file_repair(
    gate: tauri::State<'_, WriteGate>,
) -> Result<bool, CommandError> {
    let Some(operation) = gate.current_token(ExclusiveOperation::SteamVerification) else {
        return Ok(false);
    };
    let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
    blocking(move || {
        complete_durable_operation(&data_dir, &operation, || {
            // Steam self-updates by briefly exiting and replacing itself. A
            // single empty process snapshot could therefore unlock while its
            // verification resumes; require the same stable-closed interval
            // as launch cancellation.
            let first = execs_core::process_lock::live_process_names();
            refuse_repair_cancel_while_processes_run(&first)?;
            std::thread::sleep(Duration::from_secs(2));
            let second = execs_core::process_lock::live_process_names();
            refuse_repair_cancel_unless_stably_closed(&first, &second)?;
            Ok(true)
        })
    })
    .await
}

/// Restore every stock byte: particle snapshots, gameinfo.txt, custom VPK.
#[tauri::command]
pub async fn revert_preloader(
    gate: tauri::State<'_, WriteGate>,
) -> Result<RevertReport, CommandError> {
    let _guard = gate.lock_for_preloader_recovery().await?;
    with_root(|root| {
        let initial_names = execs_core::process_lock::live_process_names();
        let report = execs_core::preloader::revert_preloader_with_sampler(
            &root,
            &execs_core::execs_data_dir(),
            &initial_names,
            &execs_core::process_lock::live_process_names,
        )
        .map_err(CommandError::preloader)?;
        // Drop the shared preload cfg from every profile the mods install
        // touched (plus the active one), unless a viewmodel pack wants it.
        // A profile deleted in the meantime just fails its own cleanup.
        let data_dir = execs_core::execs_data_dir();
        let mut profiles = execs_core::preloader::preload_profiles(&data_dir)
            .map_err(CommandError::preloader)?;
        if let Ok(active) = active_profile_id(&root) {
            if !profiles.contains(&active) {
                profiles.push(active);
            }
        }
        let mut failures = Vec::new();
        for profile_id in profiles {
            match execs_core::remove_profile_preload_if_unused(&root, &profile_id) {
                Ok(()) => {
                    if let Err(err) =
                        execs_core::preloader::forget_preload_profile(&data_dir, &profile_id)
                    {
                        failures.push(format!("{profile_id}: {err}"));
                    }
                }
                Err(err) => failures.push(format!("{profile_id}: {}", err.message())),
            }
        }
        if !failures.is_empty() {
            return Err(CommandError::new(
                "CleanupIncomplete",
                format!(
                    "Stock files were restored, but profile preload cleanup is incomplete and will be retried: {}",
                    failures.join("; ")
                ),
            ));
        }
        Ok(report)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        refuse_repair_cancel_unless_stably_closed, refuse_repair_cancel_while_processes_run,
        repair_surface_paths, MAX_REPAIR_DIRECTORY_ENTRIES, MAX_REPAIR_SNAPSHOT_PATH_BYTES,
    };

    #[test]
    fn cancelled_repair_can_only_unlock_after_steam_and_tf2_exit() {
        assert!(refuse_repair_cancel_while_processes_run(&[]).is_ok());

        let steam = vec![if cfg!(windows) {
            "steam.exe".to_string()
        } else {
            "steam".to_string()
        }];
        let error = refuse_repair_cancel_while_processes_run(&steam).unwrap_err();
        assert_eq!(error.code, "SteamRunning");

        let game = vec![if cfg!(windows) {
            "tf_win64.exe".to_string()
        } else {
            "tf_linux64".to_string()
        }];
        let error = refuse_repair_cancel_while_processes_run(&game).unwrap_err();
        assert_eq!(error.code, "GameRunning");

        // A transient gap followed by Steam's replacement process must still
        // refuse cancellation.
        let error = refuse_repair_cancel_unless_stably_closed(&[], &steam).unwrap_err();
        assert_eq!(error.code, "SteamRunning");
    }

    #[test]
    fn repair_snapshot_refuses_excess_top_level_entries() {
        let root = std::path::Path::new("steamapps/common/Team Fortress 2");
        let entries = (0..=MAX_REPAIR_DIRECTORY_ENTRIES)
            .map(|index| Ok(root.join("tf").join(format!("junk-{index}"))));

        let error = repair_surface_paths(root, entries).unwrap_err();
        assert_eq!(error.code, "RepairStateTooLarge");
    }

    #[test]
    fn repair_snapshot_refuses_excess_aggregated_path_bytes() {
        let root = std::path::Path::new("steamapps/common/Team Fortress 2");
        let component = "x".repeat(MAX_REPAIR_SNAPSHOT_PATH_BYTES);
        let entries = std::iter::once(Ok(root
            .join("tf")
            .join(format!("tf2_misc_{component}.vpk"))));

        let error = repair_surface_paths(root, entries).unwrap_err();
        assert_eq!(error.code, "RepairStateTooLarge");
    }

    #[test]
    fn profile_preload_recovery_precedes_the_preloader_transaction() {
        let source = include_str!("preloader.rs");
        let ensure = source
            .find("execs_core::ensure_profile_preload(&root, &profile_id)?;")
            .unwrap();
        let recover = source[ensure..]
            .find("recover_pending_profile_mutations(&root)?;")
            .map(|offset| ensure + offset)
            .unwrap();
        let apply = source[recover..]
            .find("apply_preloader_selection_with_sampler")
            .map(|offset| recover + offset)
            .unwrap();

        assert!(ensure < recover && recover < apply);
    }
}
