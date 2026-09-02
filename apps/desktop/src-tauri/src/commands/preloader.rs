//! The Mods pane: gameinfo bypass, the default mod library, revert.

use std::path::Path;

use execs_core::preloader::{ModsCatalog, PreloaderReport, PreloaderStatus, RevertReport};
use serde::Serialize;

use super::shared::{active_profile_id, blocking, with_root};
use crate::error::CommandError;
use crate::WriteGate;

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
}

fn preloader_status_payload(root: &Path) -> Result<PreloaderStatusPayload, CommandError> {
    let steam_options = execs_core::launch::read_launch_options();
    Ok(PreloaderStatusPayload {
        status: execs_core::preloader::preloader_status(root, &execs_core::execs_data_dir())?,
        mods_cached: crate::mods_fetch::is_cached(),
        mods_size_bytes: crate::mods_fetch::MODS_SIZE_BYTES,
        preload_launch_in_steam: steam_options.contains("+exec execs_preload")
            || steam_options.contains("+exec overrides/execs_preload"),
    })
}

#[tauri::command]
pub async fn get_preloader_status() -> Result<PreloaderStatusPayload, CommandError> {
    with_root(|root| preloader_status_payload(&root)).await
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
/// the gameinfo bypass on. Refused while the game is running.
#[tauri::command]
pub async fn apply_preloader_mods(
    gate: tauri::State<'_, WriteGate>,
    addons: Vec<String>,
    particle_mods: Vec<String>,
) -> Result<PreloaderReport, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(move |root| {
        execs_core::refuse_if_running()?;
        let zip = crate::mods_fetch::ensure_mods_zip()?;
        let selection = execs_core::preloader::PreloaderSelection {
            addons,
            particle_mods,
        };
        let has_content = !selection.addons.is_empty() || !selection.particle_mods.is_empty();
        // Re-read the process list AFTER the download: core checks it again
        // right before the first byte goes into an official file.
        let report = execs_core::preloader::apply_preloader_selection(
            &root,
            &execs_core::execs_data_dir(),
            &zip,
            &selection,
            &execs_core::process_lock::live_process_names(),
        )?;
        // Mods only survive Valve Casual when the shared preload cfg runs at
        // launch, so installing content turns it on for the active profile —
        // and records which profile that was, so revert can undo it later
        // even if a different profile is active by then.
        if has_content {
            if let Ok(profile_id) = active_profile_id(&root) {
                execs_core::ensure_profile_preload(&root, &profile_id)?;
                execs_core::preloader::record_preload_profile(
                    &execs_core::execs_data_dir(),
                    &profile_id,
                )?;
            }
        }
        Ok(report)
    })
    .await
}

#[tauri::command]
pub async fn set_gameinfo_bypass(
    gate: tauri::State<'_, WriteGate>,
    enabled: bool,
) -> Result<PreloaderStatusPayload, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(move |root| {
        execs_core::preloader::set_gameinfo_bypass(
            &root,
            &execs_core::execs_data_dir(),
            enabled,
            &execs_core::process_lock::live_process_names(),
        )?;
        preloader_status_payload(&root)
    })
    .await
}

/// Hand the stale-patch problem to the only thing that holds stock bytes:
/// Steam's own file verification. `steam://validate/440` starts "Verify
/// integrity of game files" for TF2; the pane polls status until the
/// untracked entries read as stock again and then re-applies the selection.
#[tauri::command]
pub async fn repair_game_files() -> Result<(), CommandError> {
    blocking(|| {
        execs_core::refuse_if_running()?;
        tauri_plugin_opener::open_url("steam://validate/440", None::<&str>)
            .map_err(|err| CommandError::unknown(format!("Could not ask Steam to verify ({err})")))
    })
    .await
}

/// Restore every stock byte: particle snapshots, gameinfo.txt, custom VPK.
#[tauri::command]
pub async fn revert_preloader(
    gate: tauri::State<'_, WriteGate>,
) -> Result<RevertReport, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(|root| {
        let report = execs_core::preloader::revert_preloader(
            &root,
            &execs_core::execs_data_dir(),
            &execs_core::process_lock::live_process_names(),
        )?;
        // Drop the shared preload cfg from every profile the mods install
        // touched (plus the active one), unless a viewmodel pack wants it.
        // A profile deleted in the meantime just fails its own cleanup.
        let mut profiles =
            execs_core::preloader::take_preload_profiles(&execs_core::execs_data_dir());
        if let Ok(active) = active_profile_id(&root) {
            if !profiles.contains(&active) {
                profiles.push(active);
            }
        }
        for profile_id in profiles {
            let _ = execs_core::remove_profile_preload_if_unused(&root, &profile_id);
        }
        Ok(report)
    })
    .await
}
