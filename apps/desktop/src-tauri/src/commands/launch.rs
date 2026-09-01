//! Launch options: the recommended set, and the active profile's own.

use execs_core::SetLaunchResult;

use super::shared::with_profile;
use crate::error::CommandError;
use crate::WriteGate;

#[tauri::command]
pub fn recommended_launch_options() -> String {
    execs_core::recommended_launch_options()
}

#[tauri::command]
pub async fn get_profile_launch_options() -> Result<String, CommandError> {
    with_profile(|root, profile_id| Ok(execs_core::get_profile_launch_options(&root, &profile_id)?))
        .await
}

#[tauri::command]
pub async fn set_profile_launch_options(
    gate: tauri::State<'_, WriteGate>,
    options: String,
) -> Result<SetLaunchResult, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        Ok(execs_core::set_profile_launch_options(
            &root,
            &profile_id,
            &options,
        )?)
    })
    .await
}
