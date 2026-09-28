//! Global app-data preferences, independent of profiles and the TF2 write lock.

use execs_core::settings::{app_preferences_from, set_app_preferences_to, AppPreferences};
use serde::Serialize;

use super::shared::{blocking, with_root, RootContext};
use crate::error::CommandError;
use crate::WriteGate;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsPayload {
    preferences: AppPreferences,
    data_directory: String,
}

#[tauri::command]
pub async fn get_app_settings() -> Result<AppSettingsPayload, CommandError> {
    blocking(|| {
        let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
        let preferences = app_preferences_from(&data_dir.join("settings.json"))
            .map_err(|err| CommandError::new("AppSettingsRead", err))?;
        Ok(AppSettingsPayload {
            preferences,
            data_directory: execs_core::finder::user_path_string(&data_dir),
        })
    })
    .await
}

#[tauri::command]
pub async fn set_app_preferences(
    gate: tauri::State<'_, WriteGate>,
    preferences: AppPreferences,
) -> Result<AppSettingsPayload, CommandError> {
    // Serialize against root confirmation without acquiring the live-surface
    // or lifecycle guards: these preferences do not touch TF2 or any profile.
    let _guard = gate.writes.lock().await;
    blocking(move || {
        let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
        let preferences = set_app_preferences_to(&data_dir.join("settings.json"), preferences)
            .map_err(|err| CommandError::new("AppSettingsWrite", err))?;
        Ok(AppSettingsPayload {
            preferences,
            data_directory: execs_core::finder::user_path_string(&data_dir),
        })
    })
    .await
}

/// Read-only sizes of the data directory, grouped by what each entry is for.
#[tauri::command]
pub async fn get_storage_usage() -> Result<execs_core::storage::StorageReport, CommandError> {
    blocking(|| {
        let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
        execs_core::storage::inspect_storage(&data_dir)
            .map_err(|err| CommandError::new("StorageRead", err.to_string()))
    })
    .await
}

/// Delete rebuildable downloads and retired leftovers. This is app data, not
/// the TF2 surface, so it is allowed while the game runs; the write gate keeps
/// it from racing a switch or Casual apply that reads those downloads.
#[tauri::command]
pub async fn clear_download_caches(
    gate: tauri::State<'_, WriteGate>,
) -> Result<execs_core::storage::ClearReport, CommandError> {
    let _guard = gate.writes.lock().await;
    blocking(|| {
        let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
        execs_core::storage::clear_download_caches(&data_dir)
            .map_err(|err| CommandError::new("StorageClear", err.to_string()))
    })
    .await
}

#[tauri::command]
pub async fn get_hud_backups() -> Result<execs_core::hud_backups::HudBackupReport, CommandError> {
    with_root(|root| {
        Ok(execs_core::hud_backups::list_hud_backups_to(
            &execs_core::profiles_dir(),
            &root,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn delete_hud_backup(
    gate: tauri::State<'_, WriteGate>,
    id: String,
    revision: String,
) -> Result<(), CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        execs_core::hud_backups::delete_hud_backup_to(
            &execs_core::profiles_dir(),
            &root,
            &id,
            &revision,
            &execs_core::process_lock::live_process_names(),
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn restore_hud_backup(
    gate: tauri::State<'_, WriteGate>,
    app: tauri::AppHandle,
    id: String,
    revision: String,
) -> Result<Option<String>, CommandError> {
    let context = with_root(|root| {
        execs_core::refuse_if_running()?;
        Ok(RootContext::capture(&root))
    })
    .await?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a folder for recovered HUD files")
            .blocking_pick_folder()
    })
    .await
    .map_err(|error| CommandError::unknown(error.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let parent = picked
        .into_path()
        .map_err(|error| CommandError::unknown(error.to_string()))?;
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        context.ensure_current(&root)?;
        let restored = execs_core::hud_backups::restore_hud_backup_to(
            &execs_core::profiles_dir(),
            &root,
            &id,
            &revision,
            &parent,
            &execs_core::process_lock::live_process_names(),
        )?;
        Ok(Some(execs_core::finder::user_path_string(&restored)))
    })
    .await
}
