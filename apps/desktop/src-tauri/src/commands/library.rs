//! The profile library: init, save-current-as, switch, export, import.

use execs_core::{ProfileError, ProfileLibrary, SwitchProgress};
use std::path::Path;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

use super::shared::{blocking, with_root, RootContext};
use crate::error::CommandError;
use crate::WriteGate;

#[cfg(test)]
#[path = "library_tests.rs"]
mod orchestration_tests;

fn refuse_different_pending_target(
    pending: Option<&str>,
    requested: &str,
) -> Result<(), CommandError> {
    if pending.is_some_and(|pending| pending != requested) {
        return Err(CommandError::new(
            "RecoveryRequired",
            "Re-apply the pending profile before switching to another one.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_profile_library(
    gate: tauri::State<'_, WriteGate>,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.lock_for_library_read().await?;
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
    let _guard = gate.lock_for_write().await?;
    with_root(|root| Ok(execs_core::init_library(&root)?)).await
}

#[tauri::command]
pub async fn save_current_as(
    gate: tauri::State<'_, WriteGate>,
    name: String,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| Ok(execs_core::save_current_as(&root, &name)?)).await
}

#[tauri::command]
pub async fn delete_profile(
    gate: tauri::State<'_, WriteGate>,
    id: String,
    keep_installed: bool,
) -> Result<ProfileLibrary, CommandError> {
    // Deletion must not double as approval to recover a different operation.
    // The serializer still rejects launch, update and Steam-repair leases.
    let _guard = gate.lock_for_interrupted_recovery().await?;
    with_root(move |root| {
        execs_core::refuse_if_running()?;
        super::shared::refuse_pending_switch(&root)?;
        super::shared::refuse_pending_preloader(&root)?;
        if super::shared::profile_recovery_required(&root)? {
            return Err(CommandError::new(
                "RecoveryRequired",
                "Finish the interrupted profile operation before deleting a profile.",
            ));
        }
        Ok(execs_core::profile::delete_profile_to(
            &execs_core::profiles_dir(),
            &root,
            &id,
            keep_installed,
            execs_core::process_lock::live_process_names(),
        )?)
    })
    .await
}

#[tauri::command]
pub async fn plan_custom_folder_repair(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<Vec<execs_core::custom_folders::CustomFolderRepair>, CommandError> {
    let _guard = gate.lock_for_library_read().await?;
    with_root(move |root| {
        Ok(execs_core::custom_folders::plan_custom_folder_repair_to(
            &execs_core::profiles_dir(),
            &root,
            &id,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn repair_custom_folders(
    gate: tauri::State<'_, WriteGate>,
    id: String,
    reviewed: Vec<execs_core::custom_folders::CustomFolderRepair>,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        Ok(execs_core::custom_folders::repair_custom_folders_to(
            &execs_core::profiles_dir(),
            &root,
            &id,
            &reviewed,
            execs_core::process_lock::live_process_names(),
        )?)
    })
    .await
}

#[tauri::command]
pub async fn switch_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    id: String,
) -> Result<ProfileLibrary, CommandError> {
    // The direct author archive is fetched before taking the write gate.
    // Core repeats its exact-byte check during switch preflight, before the
    // previous profile's live files are removed.
    let preflight_id = id.clone();
    let root_context = with_root(move |root| {
        execs_core::refuse_if_running()?;
        let profiles = execs_core::profiles_dir();
        let library = execs_core::profile::load_library_from(&profiles, Some(&root))?;
        refuse_different_pending_target(
            library.pending_switch_profile_id.as_deref(),
            &preflight_id,
        )?;
        let manifest = execs_core::load_manifest(&profiles, &preflight_id)?;
        refuse_missing_legacy_casual_cache(&profiles, &manifest)?;
        if manifest
            .preloader
            .as_ref()
            .is_some_and(execs_core::preloader::PreloaderSelection::uses_flat_textures)
        {
            crate::mods_fetch::ensure_flat_textures_zip()?;
        }
        if manifest
            .preloader
            .as_ref()
            .is_some_and(execs_core::preloader::PreloaderSelection::uses_developer_textures)
        {
            crate::mods_fetch::ensure_developer_textures_7z()?;
        }
        if manifest
            .preloader
            .as_ref()
            .is_some_and(execs_core::preloader::PreloaderSelection::uses_square_overlays)
        {
            crate::mods_fetch::ensure_square_overlays_zip()?;
        }
        Ok(RootContext::capture(&root))
    })
    .await?;
    // This is the sole writer allowed through a durable pending-switch state:
    // re-applying its recorded target is what completes recovery.
    let _guard = gate.lock_for_switch().await?;
    with_root(move |root| {
        root_context.ensure_current(&root)?;
        let cloud = execs_core::launch::find_cloud_config();
        switch_profile_command_to(
            &execs_core::profiles_dir(),
            &root,
            &id,
            execs_core::process_lock::live_process_names(),
            execs_core::absorb::AbsorbOptions {
                cloud_config: cloud.as_deref(),
                ..Default::default()
            },
            |progress: SwitchProgress| {
                let _ = app.emit("profile-switch-progress", progress);
            },
        )
    })
    .await
}

/// Command orchestration stays profile-aware from the first preflight through
/// the final owner marker. No global particle cleanup may run before it.
fn switch_profile_command_to<F>(
    profiles: &Path,
    root: &Path,
    id: &str,
    running: Vec<String>,
    options: execs_core::absorb::AbsorbOptions<'_>,
    progress: F,
) -> Result<ProfileLibrary, CommandError>
where
    F: FnMut(SwitchProgress),
{
    let library = execs_core::profile::load_library_from(profiles, Some(root))?;
    refuse_different_pending_target(library.pending_switch_profile_id.as_deref(), id)?;
    refuse_missing_legacy_casual_cache(profiles, &execs_core::load_manifest(profiles, id)?)?;
    Ok(execs_core::switch::switch_profile_to(
        profiles, root, id, running, options, progress,
    )?)
}

fn refuse_missing_legacy_casual_cache(
    profiles: &Path,
    manifest: &execs_core::profile::ProfileManifest,
) -> Result<(), CommandError> {
    if manifest
        .preloader
        .as_ref()
        .is_some_and(execs_core::preloader::PreloaderSelection::needs_cueki_library)
        && !crate::mods_fetch::is_cached_at(
            profiles.parent().ok_or_else(|| {
                CommandError::new("Io", "The profile library has no data folder.")
            })?,
        )
    {
        return Err(CommandError::new(
            "LegacyCasualSourceMissing",
            "This profile has saved Casual library choices, but their verified source cache is unavailable. Review the exact choices before removing them, or restore the original cache on this device.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn review_retired_casual_profile(
    id: String,
) -> Result<execs_core::preloader::RetiredLibraryReview, CommandError> {
    with_root(move |root| {
        let profiles = execs_core::profiles_dir();
        execs_core::profile::load_library_from(&profiles, Some(&root))?;
        if crate::mods_fetch::is_cached_at(profiles.parent().ok_or_else(|| {
            CommandError::new("Io", "The profile library has no data folder.")
        })?) {
            return Err(CommandError::new(
                "LegacyCasualSourceAvailable",
                "The verified library cache is available. Choose this profile again to switch without changing its saved choices.",
            ));
        }
        execs_core::preloader::retired_library_review(&profiles, &id)?
            .ok_or_else(|| CommandError::new("NoLegacyCasualChoices", "This profile no longer has saved library choices to review."))
    })
    .await
}

#[tauri::command]
pub async fn clear_retired_casual_profile(
    gate: tauri::State<'_, WriteGate>,
    id: String,
    expected_revision: String,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        let profiles = execs_core::profiles_dir();
        if crate::mods_fetch::is_cached_at(profiles.parent().ok_or_else(|| {
            CommandError::new("Io", "The profile library has no data folder.")
        })?) {
            return Err(CommandError::new(
                "LegacyCasualSourceAvailable",
                "The verified library cache is available. Choose this profile again to switch without changing its saved choices.",
            ));
        }
        let running = execs_core::process_lock::live_process_names();
        execs_core::preloader::clear_retired_library_choices(
            &profiles,
            &root,
            &id,
            &expected_revision,
            &running,
        )?;
        Ok(execs_core::profile::load_library_from(&profiles, Some(&root))?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::refuse_different_pending_target;

    #[test]
    fn only_the_recorded_profile_can_retry_an_interrupted_switch() {
        assert!(refuse_different_pending_target(None, "next").is_ok());
        assert!(refuse_different_pending_target(Some("next"), "next").is_ok());
        let error = refuse_different_pending_target(Some("pending"), "other").unwrap_err();
        assert_eq!(error.code, "RecoveryRequired");
    }
}

/// Read-only disclosure for the export review. The ZIP writer rechecks sources.
#[tauri::command]
pub async fn inspect_profile_export(
    id: String,
) -> Result<execs_core::ProfileExportReview, CommandError> {
    with_root(move |root| Ok(execs_core::inspect_profile_export(&root, &id)?)).await
}

/// Zip a profile to a path the user picks. The gate is taken once the save
/// dialog returns, so the zip reads a library no write is changing under it;
/// an open dialog must not block the absorb path behind it.
#[tauri::command]
pub async fn export_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    id: String,
    expected_review_revision: String,
) -> Result<Option<String>, CommandError> {
    let for_name = id.clone();
    let (context, suggested) = with_root(move |root| {
        let library = execs_core::load_library(Some(&root))?;
        let name = library
            .profiles
            .iter()
            .find(|profile| profile.id == for_name)
            .map(|profile| profile.name.clone())
            .ok_or(ProfileError::UnknownProfile)?;
        Ok((
            RootContext::capture(&root),
            execs_core::safe_zip_file_name(&name),
        ))
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
    let _guard = gate.lock_for_write().await?;
    // Zipping a whole profile (all of tf/custom/) does not belong on the
    // async runtime's worker thread.
    with_root(move |root| {
        context.ensure_current(&root)?;
        execs_core::export_profile_reviewed(&root, &id, &path, &expected_review_revision)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

/// The review and source path remain in the backend. The renderer can only
/// accept the single-use token, never substitute its own trusted review.
#[derive(Default)]
pub struct PendingProfileImport(tokio::sync::Mutex<Option<(String, PendingImport)>>);

struct PendingImport {
    context: RootContext,
    path: std::path::PathBuf,
    review: execs_core::ProfileImportReview,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReview {
    token: String,
    name: String,
    files: usize,
    skipped_files: usize,
    creator: bool,
    warnings: Vec<String>,
    notes: Vec<String>,
    huds: Vec<String>,
    selected_hud: Option<String>,
}

#[tauri::command]
pub async fn import_profile(
    gate: tauri::State<'_, WriteGate>,
    pending: tauri::State<'_, PendingProfileImport>,
    app: AppHandle,
) -> Result<Option<ImportReview>, CommandError> {
    // Serialize pick/review requests; a new picker invalidates an old review.
    let mut slot = pending.0.lock().await;
    *slot = None;
    let context = with_root(|root| Ok(RootContext::capture(&root))).await?;
    let picker_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        picker_app
            .dialog()
            .file()
            .set_title("Import profile")
            .add_filter("Zip", &["zip"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    let _ = app.emit("profile-import-reading", ());
    let inspect_path = path.clone();
    let _guard = gate.lock_for_write().await?;
    let (context, review) = with_root(move |root| {
        context.ensure_current(&root)?;
        let review = execs_core::inspect_profile_import(&root, &inspect_path)?;
        Ok((context, review))
    })
    .await?;
    let token = execs_core::hash::random_token();
    let response = ImportReview {
        token: token.clone(),
        name: review.name.clone(),
        files: review.files,
        skipped_files: review.skipped_files,
        creator: review.creator,
        warnings: review.warnings.clone(),
        notes: review.notes.clone(),
        huds: review.huds.clone(),
        selected_hud: review.selected_hud.clone(),
    };
    *slot = Some((
        token,
        PendingImport {
            context,
            path,
            review,
        },
    ));
    Ok(Some(response))
}

fn take_review<T>(slot: &mut Option<(String, T)>, token: &str) -> Result<T, CommandError> {
    if slot.as_ref().is_none_or(|(stored, _)| stored != token) {
        return Err(CommandError::new(
            "ImportReviewExpired",
            "Choose the ZIP again to review this import.",
        ));
    }
    slot.take()
        .map(|(_, review)| review)
        .ok_or_else(|| CommandError::unknown("Import review is missing."))
}

fn cancel_review<T>(slot: &mut Option<(String, T)>, token: &str) {
    if slot.as_ref().is_some_and(|(stored, _)| stored == token) {
        *slot = None;
    }
}

#[tauri::command]
pub async fn confirm_profile_import(
    gate: tauri::State<'_, WriteGate>,
    pending: tauri::State<'_, PendingProfileImport>,
    token: String,
    selected_hud: Option<String>,
) -> Result<ProfileLibrary, CommandError> {
    let mut review = take_review(&mut *pending.0.lock().await, &token)?;
    review.review.select_hud(selected_hud)?;
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        review.context.ensure_current(&root)?;
        Ok(execs_core::import_reviewed_profile(
            &root,
            &review.path,
            &review.review,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn cancel_profile_import(
    pending: tauri::State<'_, PendingProfileImport>,
    token: String,
) -> Result<(), CommandError> {
    let mut slot = pending.0.lock().await;
    cancel_review(&mut *slot, &token);
    Ok(())
}

#[cfg(test)]
mod import_tests {
    use super::{cancel_review, take_review};

    #[test]
    fn approval_is_single_use_and_wrong_tokens_preserve_the_pending_review() {
        let mut slot = Some(("reviewed-zip".into(), "backend-owned bytes"));
        assert_eq!(
            take_review(&mut slot, "forged").unwrap_err().code,
            "ImportReviewExpired"
        );
        assert_eq!(
            take_review(&mut slot, "reviewed-zip").unwrap(),
            "backend-owned bytes"
        );
        assert!(take_review(&mut slot, "reviewed-zip").is_err());
    }

    #[test]
    fn cancelling_an_old_dialog_does_not_discard_a_new_review() {
        let mut slot = Some(("new-review".into(), "new bytes"));
        cancel_review(&mut slot, "old-review");
        assert!(slot.is_some());
        cancel_review(&mut slot, "new-review");
        assert!(take_review(&mut slot, "new-review").is_err());
    }
}
