use std::path::Path;

use execs_core::{Tf2Install, WriteLock};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn scan_tf2_installs() -> Vec<Tf2Install> {
    execs_core::scan_tf2_installs()
}

#[tauri::command]
pub fn validate_tf2_root(path: String) -> Result<Tf2Install, String> {
    let root = execs_core::normalize_tf2_root(Path::new(&path)).map_err(|err| err.message())?;
    Ok(Tf2Install {
        path: root.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn browse_tf2_root(app: AppHandle) -> Result<Option<Tf2Install>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Pick Team Fortress 2")
            .blocking_pick_folder()
    })
    .await
    .map_err(|err| err.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|err| err.to_string())?;
    let root = execs_core::normalize_tf2_root(&path).map_err(|err| err.message())?;
    Ok(Some(Tf2Install {
        path: root.to_string_lossy().into_owned(),
    }))
}

#[tauri::command]
pub fn confirm_tf2_root(path: String) -> Result<Tf2Install, String> {
    let root = execs_core::remember_tf2_root(Path::new(&path)).map_err(|err| err.message())?;
    Ok(Tf2Install {
        path: root.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn get_tf2_root() -> Option<Tf2Install> {
    execs_core::remembered_tf2_root().map(|path| Tf2Install {
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn tf2_write_lock() -> WriteLock {
    execs_core::write_lock_status()
}
