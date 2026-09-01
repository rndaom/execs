//! Finding, confirming and locking the TF2 install.

use std::path::Path;

use execs_core::{Tf2Install, WriteLock};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::blocking;
use crate::error::CommandError;
use crate::WriteGate;

#[tauri::command]
pub async fn scan_tf2_installs() -> Result<Vec<Tf2Install>, CommandError> {
    blocking(|| Ok(execs_core::scan_tf2_installs())).await
}

#[tauri::command]
pub async fn browse_tf2_root(app: AppHandle) -> Result<Option<Tf2Install>, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Pick Team Fortress 2")
            .blocking_pick_folder()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    let root = execs_core::normalize_tf2_root(&path)?;
    Ok(Some(Tf2Install {
        path: root.to_string_lossy().into_owned(),
    }))
}

#[tauri::command]
pub async fn confirm_tf2_root(
    gate: tauri::State<'_, WriteGate>,
    path: String,
) -> Result<Tf2Install, CommandError> {
    let _guard = gate.0.lock().await;
    blocking(move || {
        let root = execs_core::remember_tf2_root(Path::new(&path))?;
        Ok(Tf2Install {
            path: root.to_string_lossy().into_owned(),
        })
    })
    .await
}

#[tauri::command]
pub async fn get_tf2_root() -> Result<Option<Tf2Install>, CommandError> {
    blocking(|| {
        Ok(execs_core::remembered_tf2_root().map(|path| Tf2Install {
            path: path.to_string_lossy().into_owned(),
        }))
    })
    .await
}

#[tauri::command]
pub async fn tf2_write_lock() -> Result<WriteLock, CommandError> {
    blocking(|| Ok(execs_core::write_lock_status())).await
}
