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
