//! Read-only installation health for App settings. It never writes, starts a
//! Steam verification or fetches anything.

use serde::Serialize;

use crate::commands::shared::blocking;
use crate::error::CommandError;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallHealthPayload {
    #[serde(flatten)]
    report: execs_core::health::HealthReport,
    game_running: bool,
}

#[tauri::command]
pub async fn get_install_health() -> Result<InstallHealthPayload, CommandError> {
    blocking(|| {
        let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
        let root = execs_core::remembered_tf2_root();
        let account =
            execs_core::launch::pick_steam_account_from(&execs_core::discover_steam_roots());
        Ok(InstallHealthPayload {
            report: execs_core::health::inspect_health(
                &data_dir.join("profiles"),
                &data_dir,
                root.as_deref(),
                account.as_ref(),
            ),
            game_running: execs_core::is_tf2_running(),
        })
    })
    .await
}
