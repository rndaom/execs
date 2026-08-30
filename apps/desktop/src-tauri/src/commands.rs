use std::path::Path;

use std::collections::BTreeMap;

use execs_core::{
    materialize_wizard_profile, AbsorbDelta, AbsorbOwnedResult, BindSource, ComfigPreset,
    ComfigState, FirstRunClass, HudCatalogEntry, HudSchemaView, HudUiState, OfficialAddon,
    PackChoice, ProfileDetail, ProfileError, ProfileFile, ProfileFileContent, ProfileLibrary,
    SetLaunchResult, SwitchProgress, Tf2Install, WizardAsset, WizardSpec, WriteLock,
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

#[tauri::command]
pub fn get_active_profile_detail() -> Result<Option<ProfileDetail>, String> {
    execs_core::get_active_profile_detail(&confirmed_root()?).map_err(|err| err.message())
}

#[tauri::command]
pub fn list_profile_files(id: Option<String>) -> Result<Vec<ProfileFile>, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::list_profile_files(&root, &profile_id).map_err(|err| err.message())
}

#[tauri::command]
pub fn read_profile_file(path: String, id: Option<String>) -> Result<ProfileFileContent, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::read_profile_file(&root, &profile_id, &path).map_err(|err| err.message())
}

#[tauri::command]
pub fn write_owned_file(
    path: String,
    text: String,
    id: Option<String>,
) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::write_owned_file(&root, &profile_id, &path, text.as_bytes()).map_err(|err| err.message())
}

#[tauri::command]
pub fn get_comfig_state(id: Option<String>) -> Result<Option<ComfigState>, String> {
    let root = confirmed_root()?;
    let Ok(profile_id) = resolve_profile_id(&root, id) else {
        return Ok(None);
    };
    execs_core::read_comfig_state(&root, &profile_id)
        .map(Some)
        .map_err(|err| err.message())
}

#[tauri::command]
pub fn set_comfig_preset(preset: ComfigPreset, id: Option<String>) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::write_comfig_preset(&root, &profile_id, preset).map_err(|err| err.message())
}

#[tauri::command]
pub fn set_comfig_modules(
    modules: BTreeMap<String, String>,
    id: Option<String>,
) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::write_comfig_modules(&root, &profile_id, &modules).map_err(|err| err.message())
}

#[tauri::command]
pub async fn set_comfig_addons(
    addons: Vec<OfficialAddon>,
    id: Option<String>,
) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, id)?;
        let state = execs_core::read_comfig_state(&root, &profile_id).map_err(|err| err.message())?;
        let needed: Vec<String> = addons
            .iter()
            .filter(|addon| !state.addons.contains(addon))
            .map(|addon| addon.rel_path())
            .collect();
        let owned = if needed.is_empty() {
            Vec::new()
        } else {
            crate::comfig_fetch::fetch_official_assets(&needed)?
        };
        let assets: Vec<WizardAsset<'_>> = owned
            .iter()
            .map(|(path, bytes)| WizardAsset { path, bytes })
            .collect();
        execs_core::set_comfig_addons(&root, &profile_id, &addons, &assets).map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn update_comfig_vpks(id: Option<String>) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, id)?;
        let state = execs_core::read_comfig_state(&root, &profile_id).map_err(|err| err.message())?;
        let rels = execs_core::official_package_rel_paths(&state.addons);
        let owned = crate::comfig_fetch::fetch_official_assets(&rels)?;
        let mut last = None;
        for (rel, bytes) in &owned {
            last = Some(
                execs_core::apply_official_vpk_bytes(&root, &profile_id, rel, bytes)
                    .map_err(|err| err.message())?,
            );
        }
        last.ok_or_else(|| "Official mastercomfig release had no packages to apply.".to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn import_comfig_custom(app: AppHandle, id: Option<String>) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import comfig-custom")
            .blocking_pick_folder()
    })
    .await
    .map_err(|err| err.to_string())?;
    let Some(picked) = picked else {
        return execs_core::get_active_profile_detail(&root)
            .map_err(|err| err.message())?
            .ok_or_else(|| "Save or switch to a profile first.".to_string());
    };
    let path = picked.into_path().map_err(|err| err.to_string())?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::import_comfig_custom(&root, &profile_id, &path).map_err(|err| err.message())
}

#[tauri::command]
pub fn recommended_launch_options() -> String {
    execs_core::recommended_launch_options()
}

#[tauri::command]
pub fn get_profile_launch_options(id: Option<String>) -> Result<String, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::get_profile_launch_options(&root, &profile_id).map_err(|err| err.message())
}

#[tauri::command]
pub fn set_profile_launch_options(
    options: String,
    id: Option<String>,
) -> Result<SetLaunchResult, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::set_profile_launch_options(&root, &profile_id, &options).map_err(|err| err.message())
}

#[tauri::command]
pub async fn get_hud_catalog(refresh: bool) -> Result<Vec<HudCatalogEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::hud_fetch::load_or_fetch_catalog(refresh))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_hud_state() -> Result<HudUiState, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, None)?;
        let catalog = crate::hud_fetch::load_or_fetch_catalog(false).unwrap_or_default();
        let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), &profile_id)
            .map_err(|err| err.message())?;
        Ok(execs_core::hud_ui_state(&manifest, &catalog))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn install_hud(id: String) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, None)?;
        install_hud_from_catalog(&root, &profile_id, &id, false)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn match_hud_catalog(id: String) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, None)?;
    let entry = crate::hud_fetch::catalog_entry(&id)?;
    execs_core::match_hud_catalog(&root, &profile_id, &entry.id, Some(entry.hash))
        .map_err(|err| err.message())
}

#[tauri::command]
pub async fn update_hud() -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, None)?;
        let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), &profile_id)
            .map_err(|err| err.message())?;
        let status = execs_core::resolve_hud(&manifest)
            .ok_or_else(|| "Install a HUD first.".to_string())?;
        install_hud_from_catalog(&root, &profile_id, &status.record.id, true)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_hud_schema() -> Result<Option<HudSchemaView>, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, None)?;
        let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), &profile_id)
            .map_err(|err| err.message())?;
        let Some(status) = execs_core::resolve_hud(&manifest) else {
            return Ok(None);
        };
        if !execs_core::schema_supported(&status.record.id) {
            return Ok(None);
        }
        let raw = crate::hud_fetch::fetch_hud_schema(&status.record.id)?;
        let schema = execs_core::parse_hud_schema(&raw).map_err(|err| err.message())?;
        Ok(Some(execs_core::schema_view(&schema)))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn apply_hud_options(
    options: BTreeMap<String, String>,
) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, None)?;
        let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), &profile_id)
            .map_err(|err| err.message())?;
        let status = execs_core::resolve_hud(&manifest)
            .ok_or_else(|| "Install a HUD first.".to_string())?;
        if !execs_core::schema_supported(&status.record.id) {
            return Err("This HUD has no in-app options.".into());
        }
        let raw = crate::hud_fetch::fetch_hud_schema(&status.record.id)?;
        let schema = execs_core::parse_hud_schema(&raw).map_err(|err| err.message())?;
        execs_core::apply_schema_options(&root, &profile_id, &schema, options)
            .map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

fn install_hud_from_catalog(
    root: &Path,
    profile_id: &str,
    id: &str,
    preserve_options: bool,
) -> Result<ProfileDetail, String> {
    let entry = crate::hud_fetch::catalog_entry(id)?;
    if !entry.github {
        return Err("Open the author’s page for that HUD — it is not a GitHub zip.".into());
    }
    let bytes = crate::hud_fetch::fetch_hud_zip(&entry.repo, &entry.hash)?;
    let extracted = execs_core::extract_hud_zip(&bytes).map_err(|err| err.message())?;
    let mut tree = extracted.tree;
    let mut options = BTreeMap::new();
    if preserve_options {
        if let Ok(manifest) = execs_core::load_manifest(&execs_core::profiles_dir(), profile_id) {
            if let Some(hud) = manifest.hud {
                options = hud.options;
            }
        }
    }
    let mut cfg_writes = Vec::new();
    if execs_core::schema_supported(&entry.id) && !options.is_empty() {
        let raw = crate::hud_fetch::fetch_hud_schema(&entry.id)?;
        let schema = execs_core::parse_hud_schema(&raw).map_err(|err| err.message())?;
        let applied = execs_core::apply_hud_options(&mut tree, &schema, &entry.id, &options)
            .map_err(|err| err.message())?;
        cfg_writes = applied.cfg_writes;
    }
    let detail = execs_core::install_hud_pack(
        root,
        profile_id,
        &tree,
        execs_core::HudRecord {
            id: entry.id.clone(),
            hash: Some(entry.hash),
            source: execs_core::HudSource::HudDb,
            options,
        },
    )
    .map_err(|err| err.message())?;
    for (path, bytes) in cfg_writes {
        execs_core::write_owned_file(root, profile_id, &path, &bytes).map_err(|err| err.message())?;
    }
    Ok(detail)
}

#[tauri::command]
pub fn apply_crosshairs(
    shape: String,
    assignments: BTreeMap<String, String>,
    custom_rgba: Option<Vec<u8>>,
    id: Option<String>,
) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::apply_crosshairs(
        &root,
        &profile_id,
        &shape,
        &assignments,
        custom_rgba.as_deref(),
    )
    .map_err(|err| err.message())
}

#[tauri::command]
pub fn remove_crosshairs(id: Option<String>) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::remove_crosshairs(&root, &profile_id).map_err(|err| err.message())
}

#[tauri::command]
pub fn compile_viewmodels(
    options: BTreeMap<String, String>,
    preload: bool,
    id: Option<String>,
) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::compile_viewmodels(&root, &profile_id, &options, preload).map_err(|err| err.message())
}

#[tauri::command]
pub async fn import_viewmodels(app: AppHandle, id: Option<String>) -> Result<ProfileDetail, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import viewmodel VPK")
            .add_filter("VPK", &["vpk"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| err.to_string())?;
    let Some(picked) = picked else {
        return Err("Pick a VPK to import.".into());
    };
    let path = picked.into_path().map_err(|err| err.to_string())?;
    let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::import_viewmodel_vpk(&root, &profile_id, &bytes, true).map_err(|err| err.message())
}

#[tauri::command]
pub fn remove_viewmodels(id: Option<String>) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::remove_viewmodels(&root, &profile_id).map_err(|err| err.message())
}

#[tauri::command]
pub fn set_viewmodel_preload(enabled: bool, id: Option<String>) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::set_viewmodel_preload(&root, &profile_id, enabled).map_err(|err| err.message())
}

fn resolve_profile_id(root: &Path, id: Option<String>) -> Result<String, String> {
    if let Some(id) = id.filter(|value| !value.is_empty()) {
        return Ok(id);
    }
    let library = execs_core::load_library(Some(root)).map_err(|err| err.message())?;
    library
        .active_profile_id
        .ok_or_else(|| "Save or switch to a profile first.".into())
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
