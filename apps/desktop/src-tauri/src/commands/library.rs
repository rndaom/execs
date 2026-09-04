//! The profile library: init, save-current-as, switch, export, import.

use execs_core::{ProfileError, ProfileLibrary, SwitchProgress};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

use super::shared::{blocking, with_root, RootContext};
use crate::error::CommandError;
use crate::WriteGate;

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
pub async fn switch_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
    id: String,
) -> Result<ProfileLibrary, CommandError> {
    // This is the sole writer allowed through a durable pending-switch state:
    // re-applying its recorded target is what completes recovery.
    let _guard = gate.lock_for_switch().await?;
    with_root(move |root| {
        let library = execs_core::load_library(Some(&root))?;
        refuse_different_pending_target(library.pending_switch_profile_id.as_deref(), &id)?;
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
        execs_core::export_profile(&root, &id, &path)?;
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
) -> Result<ProfileLibrary, CommandError> {
    let review = take_review(&mut *pending.0.lock().await, &token)?;
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
