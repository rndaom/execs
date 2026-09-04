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

/// First run has no active profile to start from, so it is always Fresh TF2.
#[tauri::command]
pub async fn apply_unused_wizard(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    spec: WizardSpec,
) -> Result<ProfileLibrary, CommandError> {
    run_wizard(&gate, app, spec, StartFrom::Fresh).await
}

#[tauri::command]
pub async fn create_fresh_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    spec: WizardSpec,
    start_from: StartFrom,
) -> Result<ProfileLibrary, CommandError> {
    run_wizard(&gate, app, spec, start_from).await
}

/// The wizard's preset and addon VPKs are downloaded before the write gate
/// is taken, so nothing else is queued behind the transfer; the running-game
/// check comes first so the user hears "close TF2" before it. Core re-checks
/// under the gate before the switch writes.
async fn run_wizard(
    gate: &WriteGate,
    app: AppHandle,
    spec: WizardSpec,
    start_from: StartFrom,
) -> Result<ProfileLibrary, CommandError> {
    let for_fetch = spec.clone();
    let owned = with_root(move |_root| {
        execs_core::refuse_if_running()?;
        Ok(crate::comfig_fetch::fetch_wizard_assets(&for_fetch)?)
    })
    .await?;
    let _guard = gate.0.lock().await;
    with_root(move |root| apply_wizard_and_switch(&app, &root, spec, start_from, &owned)).await
}

pub(crate) fn apply_wizard_and_switch(
    app: &AppHandle,
    root: &Path,
    spec: WizardSpec,
    start_from: StartFrom,
    owned: &[(String, Vec<u8>)],
) -> Result<ProfileLibrary, CommandError> {
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
