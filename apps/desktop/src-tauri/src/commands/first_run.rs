//! First-run classification and the setup wizard.

use std::path::Path;

use execs_core::{
    materialize_wizard_profile, FirstRunClass, ProfileLibrary, StartFrom, SwitchProgress,
    WizardAsset, WizardSpec,
};
use tauri::{AppHandle, Emitter};

use super::shared::with_root;
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
    // First run has no active profile to start from, so it is always Fresh TF2.
    with_root(move |root| apply_wizard_and_switch(&app, &root, spec, StartFrom::Fresh)).await
}

#[tauri::command]
pub async fn create_fresh_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    spec: WizardSpec,
    start_from: StartFrom,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.0.lock().await;
    with_root(move |root| apply_wizard_and_switch(&app, &root, spec, start_from)).await
}

pub(crate) fn apply_wizard_and_switch(
    app: &AppHandle,
    root: &Path,
    spec: WizardSpec,
    start_from: StartFrom,
) -> Result<ProfileLibrary, CommandError> {
    let owned = crate::comfig_fetch::fetch_wizard_assets(&spec)?;
    let assets: Vec<WizardAsset<'_>> = owned
        .iter()
        .map(|(path, bytes)| WizardAsset { path, bytes })
        .collect();
    let result = materialize_wizard_profile(root, &spec, start_from, &assets)?;
    Ok(execs_core::switch_profile_with_progress(
        root,
        &result.profile_id,
        |progress: SwitchProgress| {
            let _ = app.emit("profile-switch-progress", progress);
        },
    )?)
}
