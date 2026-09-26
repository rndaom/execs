//! The Files pane: reading and writing the active profile's own cfg files.

use execs_core::files_workspace::{FilesContent, FilesContext, FilesSource};
use execs_core::ProfileDetail;

use super::shared::{with_profile, with_root};
use crate::error::CommandError;
use crate::WriteGate;

/// The editor is for human-sized cfg files, not arbitrary profile payloads.
/// Keep this below core's import ceiling because the string exists in the
/// renderer, the IPC decoder, and Rust during a save.
const MAX_EDITOR_FILE_BYTES: usize = 1024 * 1024;
const MAX_EDITOR_PATH_BYTES: usize = 1024;

pub(super) fn validate_editor_path(path: &str) -> Result<(), CommandError> {
    if path.is_empty() || path.len() > MAX_EDITOR_PATH_BYTES {
        return Err(CommandError::new(
            "InvalidPath",
            "That profile file path is too long for the editor.",
        ));
    }
    Ok(())
}

pub(super) fn validate_editor_text(text: &str) -> Result<(), CommandError> {
    if text.len() > MAX_EDITOR_FILE_BYTES {
        return Err(CommandError::new(
            "FileTooLarge",
            "That cfg is larger than the 1 MiB editor limit.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_active_profile_detail() -> Result<Option<ProfileDetail>, CommandError> {
    with_root(|root| Ok(execs_core::get_active_profile_detail(&root)?)).await
}

#[tauri::command]
pub async fn get_files_context() -> Result<FilesContext, CommandError> {
    with_root(|root| {
        Ok(execs_core::files_workspace::context_from(
            &execs_core::profiles_dir(),
            &root,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn read_profile_file(path: String) -> Result<FilesContent, CommandError> {
    validate_editor_path(&path)?;
    with_profile(move |root, _profile_id| {
        let content =
            execs_core::files_workspace::read_from(&execs_core::profiles_dir(), &root, &path)?;
        if let Some(text) = &content.text {
            // Refuse before serde/IPC makes another copy in the renderer.
            validate_editor_text(text)?;
        }
        Ok(content)
    })
    .await
}

#[tauri::command]
pub async fn write_owned_file(
    gate: tauri::State<'_, WriteGate>,
    path: String,
    text: String,
    expected: FilesSource,
) -> Result<ProfileDetail, CommandError> {
    // Validate the already-decoded request before moving it into a blocking
    // closure or handing its buffer to core.
    validate_editor_path(&path)?;
    validate_editor_text(&text)?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, _profile_id| {
        Ok(execs_core::files_workspace::save_to(
            &execs_core::profiles_dir(),
            &root,
            &path,
            text.as_bytes(),
            &expected,
            execs_core::process_lock::live_process_names(),
            execs_core::apply::WriteOwnedOptions::default(),
        )?)
    })
    .await
}

#[tauri::command]
pub async fn write_managed_cfg(
    gate: tauri::State<'_, WriteGate>,
    path: String,
    text: String,
    expected_profile_id: String,
    scope: Option<execs_core::ManagedCfgScope>,
) -> Result<ProfileDetail, CommandError> {
    validate_editor_path(&path)?;
    validate_editor_text(&text)?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        if profile_id != expected_profile_id {
            return Err(CommandError::new(
                "ProfileChanged",
                "The active profile changed before saving. Try again.",
            ));
        }
        Ok(execs_core::write_managed_cfg(
            &root,
            &profile_id,
            &path,
            text.as_bytes(),
            scope,
        )?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        validate_editor_path, validate_editor_text, MAX_EDITOR_FILE_BYTES, MAX_EDITOR_PATH_BYTES,
    };

    #[test]
    fn editor_requests_are_bounded_by_utf8_bytes() {
        assert!(validate_editor_text(&"x".repeat(MAX_EDITOR_FILE_BYTES)).is_ok());
        let error = validate_editor_text(&"é".repeat(MAX_EDITOR_FILE_BYTES / 2 + 1)).unwrap_err();
        assert_eq!(error.code, "FileTooLarge");
    }

    #[test]
    fn oversized_paths_are_rejected_before_core() {
        assert!(validate_editor_path("tf/cfg/autoexec.cfg").is_ok());
        assert!(validate_editor_path(&"x".repeat(MAX_EDITOR_PATH_BYTES + 1)).is_err());
    }
}
