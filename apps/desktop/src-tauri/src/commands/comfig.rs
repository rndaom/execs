//! The Comfig pane: preset, modules, official addon VPKs, comfig-custom.

use std::collections::BTreeMap;

use execs_core::{ComfigPreset, ComfigState, OfficialAddon, ProfileDetail, WizardAsset};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{active_profile_id, blocking, confirmed_root, with_profile};
use crate::error::CommandError;
use crate::WriteGate;

#[tauri::command]
pub async fn get_comfig_state() -> Result<Option<ComfigState>, CommandError> {
    blocking(|| {
        let root = confirmed_root()?;
        // No active profile yet is "nothing to show", not an error: the pane
        // renders its empty state.
        let Ok(profile_id) = active_profile_id(&root) else {
            return Ok(None);
        };
        Ok(Some(execs_core::read_comfig_state(&root, &profile_id)?))
    })
    .await
}

#[tauri::command]
pub async fn set_comfig_preset(
    gate: tauri::State<'_, WriteGate>,
    preset: ComfigPreset,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        Ok(execs_core::write_comfig_preset(&root, &profile_id, preset)?)
    })
    .await
}

#[tauri::command]
pub async fn set_comfig_modules(
    gate: tauri::State<'_, WriteGate>,
    modules: BTreeMap<String, String>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        Ok(execs_core::write_comfig_modules(
            &root,
            &profile_id,
            &modules,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn set_comfig_addons(
    gate: tauri::State<'_, WriteGate>,
    addons: Vec<OfficialAddon>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        let state = execs_core::read_comfig_state(&root, &profile_id)?;
        let needed: Vec<String> = addons
            .iter()
            .filter(|addon| !state.addons.contains(addon))
            .map(|addon| addon.rel_path())
            .collect();
        let owned = if needed.is_empty() {
            Vec::new()
        } else {
            crate::comfig_fetch::fetch_official_assets(&needed)?
        };
        let assets: Vec<WizardAsset<'_>> = owned
            .iter()
            .map(|(path, bytes)| WizardAsset { path, bytes })
            .collect();
        Ok(execs_core::set_comfig_addons(
            &root,
            &profile_id,
            &addons,
            &assets,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn update_comfig_vpks(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(|root, profile_id| {
        let state = execs_core::read_comfig_state(&root, &profile_id)?;
        let rels = execs_core::official_package_rel_paths(&state.addons);
        let owned = crate::comfig_fetch::fetch_official_assets(&rels)?;
        let mut last = None;
        for (rel, bytes) in &owned {
            last = Some(execs_core::apply_official_vpk_bytes(
                &root,
                &profile_id,
                rel,
                bytes,
            )?);
        }
        last.ok_or_else(|| {
            CommandError::unknown("Official mastercomfig release had no packages to apply.")
        })
    })
    .await
}

#[tauri::command]
pub async fn import_comfig_custom(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
) -> Result<ProfileDetail, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import comfig-custom")
            .blocking_pick_folder()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let _guard = gate.0.lock().await;
    let Some(picked) = picked else {
        return blocking(|| {
            let root = confirmed_root()?;
            execs_core::get_active_profile_detail(&root)?
                .ok_or_else(|| CommandError::unknown("Save or switch to a profile first."))
        })
        .await;
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    // The recursive folder copy is the expensive part; keep it off the
    // async runtime's worker.
    with_profile(move |root, profile_id| {
        Ok(execs_core::import_comfig_custom(&root, &profile_id, &path)?)
    })
    .await
}
