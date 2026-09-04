//! The Files pane: reading and writing the active profile's own cfg files.

use execs_core::{ProfileDetail, ProfileFileContent};

use super::shared::{with_profile, with_root};
use crate::error::CommandError;
use crate::WriteGate;

/// The editor is for human-sized cfg files, not arbitrary profile payloads.
/// Keep this below core's import ceiling because the string exists in the
/// renderer, the IPC decoder, and Rust during a save.
const MAX_EDITOR_FILE_BYTES: usize = 1024 * 1024;
const MAX_EDITOR_PATH_BYTES: usize = 1024;

fn validate_editor_path(path: &str) -> Result<(), CommandError> {
    if path.is_empty() || path.len() > MAX_EDITOR_PATH_BYTES {
        return Err(CommandError::new(
            "InvalidPath",
            "That profile file path is too long for the editor.",
        ));
    }
    Ok(())
}

fn validate_editor_text(text: &str) -> Result<(), CommandError> {
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
pub async fn read_profile_file(path: String) -> Result<ProfileFileContent, CommandError> {
    validate_editor_path(&path)?;
    with_profile(move |root, profile_id| {
        let content = execs_core::read_profile_file(&root, &profile_id, &path)?;
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
) -> Result<ProfileDetail, CommandError> {
    // Validate the already-decoded request before moving it into a blocking
    // closure or handing its buffer to core.
    validate_editor_path(&path)?;
    validate_editor_text(&text)?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        Ok(execs_core::write_owned_file(
            &root,
            &profile_id,
            &path,
            text.as_bytes(),
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
