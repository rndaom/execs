use std::path::Path;

use execs_core::{
    materialize_wizard_profile, AbsorbDelta, AbsorbOwnedResult, BindSource, FirstRunClass,
    PackChoice, ProfileError, ProfileLibrary, SwitchProgress, Tf2Install, WizardAsset, WizardSpec,
    WriteLock,
};
use tauri::{AppHandle, Emitter};
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

#[tauri::command]
pub fn scan_absorb_delta() -> Result<AbsorbDelta, String> {
    execs_core::scan_absorb_delta(&confirmed_root()?).map_err(|err| err.message())
}

#[tauri::command]
pub fn absorb_owned() -> Result<AbsorbOwnedResult, String> {
    execs_core::absorb_owned(&confirmed_root()?).map_err(|err| err.message())
}

#[tauri::command]
pub fn absorb_packs(choice: PackChoice) -> Result<ProfileLibrary, String> {
    execs_core::absorb_packs(&confirmed_root()?, choice).map_err(|err| err.message())
}

#[tauri::command]
pub async fn switch_profile(app: AppHandle, id: String) -> Result<ProfileLibrary, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::switch_profile_with_progress(&root, &id, |progress: SwitchProgress| {
            let _ = app.emit("profile-switch-progress", progress);
        })
        .map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn export_profile(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let root = confirmed_root()?;
    let library = execs_core::load_library(Some(&root)).map_err(|err| err.message())?;
    let name = library
        .profiles
        .iter()
        .find(|profile| profile.id == id)
        .map(|profile| profile.name.as_str())
        .ok_or_else(|| ProfileError::UnknownProfile.message())?;
    let suggested = execs_core::safe_zip_file_name(name);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Export profile")
            .add_filter("Zip", &["zip"])
            .set_file_name(&suggested)
            .blocking_save_file()
    })
    .await
    .map_err(|err| err.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let mut path = picked.into_path().map_err(|err| err.to_string())?;
    if path.extension().is_none() {
        path.set_extension("zip");
    }
    execs_core::export_profile(&root, &id, &path).map_err(|err| err.message())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn import_profile(app: AppHandle) -> Result<ProfileLibrary, String> {
    let root = confirmed_root()?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import profile")
            .add_filter("Zip", &["zip"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| err.to_string())?;
    let Some(picked) = picked else {
        return execs_core::load_library(Some(&root)).map_err(|err| err.message());
    };
    let path = picked.into_path().map_err(|err| err.to_string())?;
    execs_core::import_profile(&root, &path).map_err(|err| err.message())
}

#[tauri::command]
pub fn classify_first_run() -> Result<FirstRunClass, String> {
    execs_core::classify_first_run(&confirmed_root()?).map_err(|err| err.message())
}

#[tauri::command]
pub async fn apply_unused_wizard(app: AppHandle, spec: WizardSpec) -> Result<ProfileLibrary, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        apply_wizard_and_switch(&app, &root, spec, BindSource::Stock)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn get_inherit_binds() -> bool {
    execs_core::inherit_binds()
}

#[tauri::command]
pub fn set_inherit_binds(inherit: bool) -> Result<bool, String> {
    execs_core::set_inherit_binds(inherit)?;
    Ok(execs_core::inherit_binds())
}

#[tauri::command]
pub async fn create_fresh_profile(app: AppHandle, spec: WizardSpec) -> Result<ProfileLibrary, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let binds = fresh_bind_source(&root)?;
        apply_wizard_and_switch(&app, &root, spec, binds)
    })
    .await
    .map_err(|err| err.to_string())?
}

fn fresh_bind_source(root: &std::path::Path) -> Result<BindSource, String> {
    if !execs_core::inherit_binds() {
        return Ok(BindSource::Stock);
    }
    let library = execs_core::load_library(Some(root)).map_err(|err| err.message())?;
    let Some(from_profile_id) = library.active_profile_id else {
        return Err("Save or switch to a profile before inheriting binds.".into());
    };
    Ok(BindSource::Inherit { from_profile_id })
}

pub(crate) fn apply_wizard_and_switch(
    app: &AppHandle,
    root: &std::path::Path,
    spec: WizardSpec,
    binds: BindSource,
) -> Result<ProfileLibrary, String> {
    let owned = crate::comfig_fetch::fetch_wizard_assets(&spec)?;
    let assets: Vec<WizardAsset<'_>> = owned
        .iter()
        .map(|(path, bytes)| WizardAsset {
            path,
            bytes,
        })
        .collect();
    let result = materialize_wizard_profile(root, &spec, &binds, &assets).map_err(|err| err.message())?;
    execs_core::switch_profile_with_progress(root, &result.profile_id, |progress: SwitchProgress| {
        let _ = app.emit("profile-switch-progress", progress);
    })
    .map_err(|err| err.message())
}
