//! The Files pane: reading and writing the active profile's own cfg files.

use execs_core::{ProfileDetail, ProfileFileContent};

use super::shared::{with_profile, with_root};
use crate::error::CommandError;
use crate::WriteGate;

#[tauri::command]
pub async fn get_active_profile_detail() -> Result<Option<ProfileDetail>, CommandError> {
    with_root(|root| Ok(execs_core::get_active_profile_detail(&root)?)).await
}

#[tauri::command]
pub async fn read_profile_file(path: String) -> Result<ProfileFileContent, CommandError> {
    with_profile(move |root, profile_id| {
        Ok(execs_core::read_profile_file(&root, &profile_id, &path)?)
    })
    .await
}

#[tauri::command]
pub async fn write_owned_file(
    gate: tauri::State<'_, WriteGate>,
    path: String,
    text: String,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        Ok(execs_core::write_owned_file(
            &root,
            &profile_id,
            &path,
            text.as_bytes(),
        )?)
    })
    .await
}
