//! The Viewmodels pane: Yttrium-style builds and prebuilt VPK imports.

use std::path::{Path, PathBuf};

use execs_core::mods::MAX_MOD_BYTES;
use execs_core::ProfileDetail;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{
    active_manifest, blocking, confirmed_root, read_bounded_file, vpk_too_large, with_profile,
    ActiveContext,
};
use crate::error::CommandError;
use crate::WriteGate;

/// Build a Yttrium-style pack: fetch the animation sources, hide the chosen
/// groups, compile with TF2's own studiomdl in an isolated staging dir, and
/// install the resulting VPK like an import.
///
/// The animations download happens before the write gate is taken, so an
/// autosave is not queued behind it; the running-game check comes first so
/// the user hears "close TF2" before the transfer rather than after the
/// compile. Core re-checks under the gate before it writes.
#[tauri::command]
pub async fn build_viewmodel_pack(
    gate: tauri::State<'_, WriteGate>,
    hidden: Vec<String>,
    preload: bool,
    hide_mode: Option<String>,
) -> Result<ProfileDetail, CommandError> {
    let (context, initial_viewmodel, zip) = with_profile(|root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        Ok((
            ActiveContext::capture(&root, &profile_id),
            manifest.viewmodel,
            crate::viewmodel_fetch::fetch_animations_zip()?,
        ))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_viewmodel_unchanged(&profile_id, initial_viewmodel.as_ref())?;
        let hidden_set: std::collections::BTreeSet<String> = hidden.into_iter().collect();
        let mode = execs_core::ViewmodelHideMode::from_str_or_default(hide_mode.as_deref());
        let studiomdl = studiomdl_path(&root);
        // The core builder owns this dir: it empties it on entry and on every
        // exit path, so nothing is left to clean up here.
        let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
        let staging = data_dir.join("studio").join("staging");
        let vpk = execs_core::build_viewmodel_pack_vpk(
            &zip,
            &hidden_set,
            mode,
            &studiomdl,
            &data_dir,
            &staging,
        )?;
        Ok(execs_core::install_built_viewmodel_pack(
            &root,
            &profile_id,
            &vpk,
            &hidden_set,
            mode,
            preload,
        )?)
    })
    .await
}

/// One of CompVMInstaller's preview screenshots, as raw JPEG bytes (a
/// `Response`, not a JSON array — a 130 KB image would otherwise cross the
/// bridge as half a megabyte of comma-separated numbers).
#[tauri::command]
pub async fn viewmodel_preview_image(name: String) -> Result<tauri::ipc::Response, CommandError> {
    let bytes = blocking(move || Ok(crate::viewmodel_fetch::fetch_preview_image(&name)?)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// TF2's own compiler, inside the install's `bin` folder.
fn studiomdl_path(root: &Path) -> PathBuf {
    root.join("bin").join(execs_core::STUDIOMDL_FILE_NAME)
}

/// Whether this machine can build a viewmodel pack at all. Windows only:
/// TF2 ships `bin/studiomdl.exe` there, and the Linux depot has no native
/// compiler to point at. The pane disables Build rather than letting the
/// user click into a dead end.
#[tauri::command]
pub async fn viewmodel_build_available() -> Result<bool, CommandError> {
    blocking(|| {
        let Some(root) = execs_core::remembered_tf2_root() else {
            return Ok(false);
        };
        Ok(cfg!(windows) && studiomdl_path(&root).is_file())
    })
    .await
}

#[tauri::command]
pub async fn import_viewmodels(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    preload: bool,
) -> Result<ProfileDetail, CommandError> {
    let (context, initial_viewmodel) = with_profile(|root, profile_id| {
        execs_core::refuse_if_running()?;
        let manifest = active_manifest(&profile_id)?;
        Ok((
            ActiveContext::capture(&root, &profile_id),
            manifest.viewmodel,
        ))
    })
    .await?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import viewmodel VPK")
            .add_filter("VPK", &["vpk"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        // Cancelling the picker is a no-op, not an error.
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
    // Own the bounded bytes before reserving the writer; a 512 MiB local VPK
    // should not stall unrelated autosaves while it is being read.
    let bytes =
        blocking(move || read_bounded_file(&path, MAX_MOD_BYTES, vpk_too_large(MAX_MOD_BYTES)))
            .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        ensure_viewmodel_unchanged(&profile_id, initial_viewmodel.as_ref())?;
        Ok(execs_core::import_viewmodel_vpk(
            &root,
            &profile_id,
            &bytes,
            preload,
        )?)
    })
    .await
}

fn ensure_viewmodel_unchanged(
    profile_id: &str,
    expected: Option<&execs_core::ViewmodelRecord>,
) -> Result<(), CommandError> {
    if active_manifest(profile_id)?.viewmodel.as_ref() == expected {
        Ok(())
    } else {
        Err(CommandError::new(
            "ProfileChanged",
            "The installed viewmodel pack changed while that work was running. Try again.",
        ))
    }
}

#[tauri::command]
pub async fn remove_viewmodels(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(|root, profile_id| Ok(execs_core::remove_viewmodels(&root, &profile_id)?)).await
}

#[tauri::command]
pub async fn set_viewmodel_preload(
    gate: tauri::State<'_, WriteGate>,
    enabled: bool,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        Ok(execs_core::set_viewmodel_preload(
            &root,
            &profile_id,
            enabled,
        )?)
    })
    .await
}
