//! First-run classification and the setup wizard.

use std::path::Path;

use execs_core::{
    materialize_wizard_profile, BindSource, FirstRunClass, ProfileLibrary, SwitchProgress,
    WizardAsset, WizardSpec,
};
use tauri::{AppHandle, Emitter};

use super::shared::{blocking, with_root};
use crate::error::CommandError;
use crate::WriteGate;

#[tauri::command]
pub async fn classify_first_run() -> Result<FirstRunClass, CommandError> {
    with_root(|root| Ok(execs_core::classify_first_run(&root)?)).await
}

#[tauri::command]
pub async fn apply_unused_wizard(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    spec: WizardSpec,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(move |root| apply_wizard_and_switch(&app, &root, spec, BindSource::Stock)).await
}

#[tauri::command]
pub async fn create_fresh_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    spec: WizardSpec,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(move |root| {
        let binds = fresh_bind_source(&root)?;
        apply_wizard_and_switch(&app, &root, spec, binds)
    })
    .await
}

#[tauri::command]
pub async fn get_inherit_binds() -> Result<bool, CommandError> {
    blocking(|| Ok(execs_core::inherit_binds())).await
}

#[tauri::command]
pub async fn set_inherit_binds(inherit: bool) -> Result<bool, CommandError> {
    blocking(move || {
        execs_core::set_inherit_binds(inherit)?;
        Ok(execs_core::inherit_binds())
    })
    .await
}

fn fresh_bind_source(root: &Path) -> Result<BindSource, CommandError> {
    if !execs_core::inherit_binds() {
        return Ok(BindSource::Stock);
    }
    let library = execs_core::load_library(Some(root))?;
    let Some(from_profile_id) = library.active_profile_id else {
        return Err(CommandError::unknown(
            "Save or switch to a profile before inheriting binds.",
        ));
    };
    Ok(BindSource::Inherit { from_profile_id })
}

pub(crate) fn apply_wizard_and_switch(
    app: &AppHandle,
    root: &Path,
    spec: WizardSpec,
    binds: BindSource,
) -> Result<ProfileLibrary, CommandError> {
    let owned = crate::comfig_fetch::fetch_wizard_assets(&spec)?;
    let assets: Vec<WizardAsset<'_>> = owned
        .iter()
        .map(|(path, bytes)| WizardAsset { path, bytes })
        .collect();
    let result = materialize_wizard_profile(root, &spec, &binds, &assets)?;
    Ok(execs_core::switch_profile_with_progress(
        root,
        &result.profile_id,
        |progress: SwitchProgress| {
            let _ = app.emit("profile-switch-progress", progress);
        },
    )?)
}
