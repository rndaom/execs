//! The profile library: init, save-current-as, switch, export, import.

use execs_core::{ProfileError, ProfileLibrary, SwitchProgress};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

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

#[tauri::command]
pub async fn import_profile(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
) -> Result<ProfileLibrary, CommandError> {
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
    // Take the gate only once the user has actually picked something: an open
    // dialog must not block the absorb path behind it.
    let Some(picked) = picked else {
        let _guard = gate.lock_for_library_read().await?;
        return with_root(|root| Ok(execs_core::load_library(Some(&root))?)).await;
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    let inspect_path = path.clone();
    let (context, review) = {
        let _guard = gate.lock_for_write().await?;
        with_root(move |root| {
            context.ensure_current(&root)?;
            let review = execs_core::inspect_profile_import(&root, &inspect_path)?;
            Ok((context, review))
        })
        .await?
    };
    if review.creator {
        let message = creator_import_message(&review);
        let accepted = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .message(message)
                .title("Import creator config")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Trust and import".into(),
                    "Cancel".into(),
                ))
                .blocking_show()
        })
        .await
        .map_err(|err| CommandError::unknown(err.to_string()))?;
        if !accepted {
            let _guard = gate.lock_for_library_read().await?;
            return with_root(|root| Ok(execs_core::load_library(Some(&root))?)).await;
        }
    }
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        context.ensure_current(&root)?;
        Ok(execs_core::import_reviewed_profile(&root, &path, &review)?)
    })
    .await
}

fn creator_import_message(review: &execs_core::ProfileImportReview) -> String {
    let mut message = format!(
        "Create a new profile named \"{}\" with {} cfg and custom files.\n\nYour current profile stays active. Choose the new profile to switch to it.\n\n{} files outside the supported cfg/custom layout, auxiliary files or caches will be left out. Optional mod variants, nested archives and launch-option instructions remain in the source ZIP. Launch options are left empty.",
        review.name, review.files, review.skipped_files,
    );
    for note in review.notes.iter().take(6) {
        message.push_str("\n\n");
        message.extend(note.chars().take(500));
    }
    if !review.warnings.is_empty() {
        message.push_str("\n\nConfig checks flagged these commands (first finding per file):");
        for warning in review.warnings.iter().take(6) {
            message.push_str("\n\n");
            message.extend(warning.chars().take(500));
        }
        if review.warnings.len() > 6 {
            message.push_str(&format!(
                "\n\nAnd {} more files.",
                review.warnings.len() - 6
            ));
        }
    }
    message.push_str("\n\nThe imported cfg commands are kept unchanged and run when TF2 loads them. Saved server credentials, if flagged above, are kept too; exporting a profile with credentials is blocked. Import only if you trust this creator.");
    message
}
