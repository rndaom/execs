use std::path::Path;

use execs_core::{ProfileError, ProfileLibrary, Tf2Install, WriteLock};
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

fn confirmed_root() -> Result<std::path::PathBuf, String> {
    execs_core::remembered_tf2_root().ok_or_else(|| ProfileError::NoConfirmedRoot.message())
}

#[tauri::command]
pub fn get_profile_library() -> Result<ProfileLibrary, String> {
    let confirmed = execs_core::remembered_tf2_root();
    execs_core::load_library(confirmed.as_deref()).map_err(|err| err.message())
}

#[tauri::command]
pub fn init_profile_library() -> Result<ProfileLibrary, String> {
    execs_core::init_library(&confirmed_root()?).map_err(|err| err.message())
}

#[tauri::command]
pub fn create_profile_record(name: String) -> Result<ProfileLibrary, String> {
    execs_core::create_profile_record(&confirmed_root()?, &name).map_err(|err| err.message())
}

#[tauri::command]
pub fn save_current_as(name: String) -> Result<ProfileLibrary, String> {
    execs_core::save_current_as(&confirmed_root()?, &name).map_err(|err| err.message())
}
