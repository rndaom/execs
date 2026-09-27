//! Global app-data preferences, independent of profiles and the TF2 write lock.

use execs_core::settings::{app_preferences_from, set_app_preferences_to, AppPreferences};
use serde::Serialize;

use super::shared::blocking;
use crate::error::CommandError;
use crate::WriteGate;

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
