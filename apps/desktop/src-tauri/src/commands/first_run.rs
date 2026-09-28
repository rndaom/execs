//! First-run classification and the setup wizard.

use std::path::Path;

use execs_core::{
    FirstRunClass, ProfileLibrary, StartFrom, SwitchProgress, WizardAsset, WizardSpec,
};
use tauri::{AppHandle, Emitter};

use super::shared::{with_root, ProfileSelectionContext};
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
    run_wizard(&gate, app, spec, StartFrom::Fresh, true).await
}

#[tauri::command]
pub async fn create_fresh_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    spec: WizardSpec,
    start_from: StartFrom,
    switch_after: Option<bool>,
) -> Result<ProfileLibrary, CommandError> {
    run_wizard(&gate, app, spec, start_from, switch_after.unwrap_or(true)).await
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
    switch_after: bool,
) -> Result<ProfileLibrary, CommandError> {
    let for_fetch = spec.clone();
    let (context, owned) = with_root(move |root| {
        execs_core::refuse_if_running()?;
        Ok((
            ProfileSelectionContext::capture(&root)?,
            crate::comfig_fetch::fetch_wizard_assets(&for_fetch)?,
        ))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        context.ensure_current(&root)?;
        apply_wizard_and_switch(&app, &root, spec, start_from, &owned, switch_after)
    })
    .await
}

pub(crate) fn apply_wizard_and_switch(
    app: &AppHandle,
    root: &Path,
    spec: WizardSpec,
    start_from: StartFrom,
    owned: &crate::comfig_fetch::DownloadedRelease,
    switch_after: bool,
) -> Result<ProfileLibrary, CommandError> {
    let assets: Vec<WizardAsset<'_>> = owned
        .files
        .iter()
        .map(|(path, bytes)| WizardAsset { path, bytes })
        .collect();
    let result = execs_core::wizard::materialize_wizard_profile_to(
        &execs_core::profile::profiles_dir(),
        root,
        &spec,
        start_from,
        &assets,
        execs_core::process_lock::live_process_names(),
        execs_core::wizard::WizardOptions {
            launch_options: None,
            comfig_release: Some(&owned.identity),
        },
    )?;
    // Create alone leaves TF2 and the active profile as they are; the new
    // profile waits in the list like a duplicate or import.
    if !switch_after {
        return Ok(result.library);
    }
    Ok(execs_core::switch_profile_with_progress(
        root,
        &result.profile_id,
        |progress: SwitchProgress| {
            let _ = app.emit("profile-switch-progress", progress);
        },
    )?)
}
