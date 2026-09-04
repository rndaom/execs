//! The profile library: init, save-current-as, switch, export, import.

use execs_core::{ProfileError, ProfileLibrary, SwitchProgress};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

use super::shared::{blocking, with_root};
use crate::error::CommandError;
use crate::WriteGate;

#[tauri::command]
pub async fn get_profile_library() -> Result<ProfileLibrary, CommandError> {
    blocking(|| {
        let confirmed = execs_core::remembered_tf2_root();
        Ok(execs_core::load_library(confirmed.as_deref())?)
    })
    .await
}

#[tauri::command]
pub async fn init_profile_library(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(|root| Ok(execs_core::init_library(&root)?)).await
}

#[tauri::command]
pub async fn save_current_as(
    gate: tauri::State<'_, WriteGate>,
    name: String,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(move |root| Ok(execs_core::save_current_as(&root, &name)?)).await
}

#[tauri::command]
pub async fn switch_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    id: String,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(move |root| {
        Ok(execs_core::switch_profile_with_progress(
            &root,
            &id,
            |progress: SwitchProgress| {
                let _ = app.emit("profile-switch-progress", progress);
            },
        )?)
    })
    .await
}

/// Zip a profile to a path the user picks. The gate is taken once the save
/// dialog returns, so the zip reads a library no write is changing under it;
/// an open dialog must not block the absorb path behind it.
#[tauri::command]
pub async fn export_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    id: String,
) -> Result<Option<String>, CommandError> {
    let for_name = id.clone();
    let suggested = with_root(move |root| {
        let library = execs_core::load_library(Some(&root))?;
        let name = library
            .profiles
            .iter()
            .find(|profile| profile.id == for_name)
            .map(|profile| profile.name.clone())
            .ok_or(ProfileError::UnknownProfile)?;
        Ok(execs_core::safe_zip_file_name(&name))
    })
    .await?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Export profile")
            .add_filter("Zip", &["zip"])
            .set_file_name(&suggested)
            .blocking_save_file()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let mut path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    if path.extension().is_none() {
        path.set_extension("zip");
    }
    let _guard = gate.0.lock().await;
    // Zipping a whole profile (all of tf/custom/) does not belong on the
    // async runtime's worker thread.
    with_root(move |root| {
        execs_core::export_profile(&root, &id, &path)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
pub async fn import_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
) -> Result<ProfileLibrary, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import profile")
            .add_filter("Zip", &["zip"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    // Take the gate only once the user has actually picked something: an open
    // dialog must not block the absorb path behind it.
    let _guard = gate.0.lock().await;
    let Some(picked) = picked else {
        return with_root(|root| Ok(execs_core::load_library(Some(&root))?)).await;
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    with_root(move |root| Ok(execs_core::import_profile(&root, &path)?)).await
}
