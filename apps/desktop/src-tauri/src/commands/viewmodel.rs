//! The Viewmodels pane: locally provided VPK imports and saved-pack management.

use execs_core::mods::MAX_MOD_BYTES;
use execs_core::ProfileDetail;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{
    active_manifest, blocking, read_bounded_file, vpk_too_large, with_profile, ActiveContext,
};
use crate::error::CommandError;
use crate::WriteGate;

/// Older frontends may still invoke this command. Refuse before reading a
/// profile, acquiring the write gate, or reaching any third-party source.
#[tauri::command]
pub async fn build_viewmodel_pack(
    hidden: Vec<String>,
    preload: bool,
    hide_mode: Option<String>,
) -> Result<ProfileDetail, CommandError> {
    let _ = (hidden, preload, hide_mode);
    Err(retired_builder_error())
}

fn retired_builder_error() -> CommandError {
    CommandError::new(
        "SourceUnavailable",
        "Viewmodel building is unavailable while source rights are unresolved. Import a model-only VPK instead.",
    )
}

/// Refuse old preview requests before reaching any third-party source.
#[tauri::command]
pub async fn viewmodel_preview_image(name: String) -> Result<tauri::ipc::Response, CommandError> {
    let _ = name;
    Err(retired_builder_error())
}

/// Compatibility response for a cached older frontend.
#[tauri::command]
pub async fn viewmodel_build_available() -> Result<bool, CommandError> {
    Ok(false)
}

#[tauri::command]
pub async fn import_viewmodels(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    preload: bool,
) -> Result<Option<ProfileDetail>, CommandError> {
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
        return Ok(None);
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
    .map(Some)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_builder_and_preview_requests_are_refused_without_io() {
        tauri::async_runtime::block_on(async {
            assert!(!viewmodel_build_available().await.unwrap());
            let build = build_viewmodel_pack(vec!["legacy/one".into()], true, None)
                .await
                .unwrap_err();
            assert_eq!(build.code, "SourceUnavailable");
            let preview = viewmodel_preview_image("legacy_preview".into())
                .await
                .err()
                .expect("preview requests must be rejected");
            assert_eq!(preview.code, "SourceUnavailable");
        });
    }
}
