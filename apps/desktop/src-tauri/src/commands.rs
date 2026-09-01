use std::path::Path;

use std::collections::BTreeMap;

use execs_core::{
    materialize_wizard_profile, AbsorbDelta, AbsorbOwnedResult, BindSource, ComfigPreset,
    ComfigState, FirstRunClass, HudCatalogEntry, HudSchemaView, HudUiState, OfficialAddon,
    PackChoice, ProfileDetail, ProfileError, ProfileFile, ProfileFileContent, ProfileLibrary,
    SetLaunchResult, SwitchProgress, Tf2Install, WizardAsset,
    WizardSpec, WriteLock,
};
use tauri::{AppHandle, Emitter, Manager};
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
pub async fn save_current_as(name: String) -> Result<ProfileLibrary, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::save_current_as(&root, &name).map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn scan_absorb_delta() -> Result<AbsorbDelta, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::scan_absorb_delta(&root).map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn absorb_owned() -> Result<AbsorbOwnedResult, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::absorb_owned(&root).map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn absorb_packs(choice: PackChoice) -> Result<ProfileLibrary, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::absorb_packs(&root, choice).map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
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
pub async fn match_hud_catalog(id: String) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, None)?;
        let entry = crate::hud_fetch::catalog_entry(&id)?;
        execs_core::match_hud_catalog(&root, &profile_id, &entry.id, Some(entry.hash))
            .map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
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
pub async fn apply_crosshairs(
    shape: String,
    assignments: BTreeMap<String, String>,
    custom_rgba: Option<Vec<u8>>,
    color: Option<[u8; 3]>,
    library: Option<BTreeMap<String, execs_core::CrosshairAsset>>,
    design: Option<String>,
    id: Option<String>,
) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, id)?;
        execs_core::apply_crosshairs(
            &root,
            &profile_id,
            &shape,
            &assignments,
            custom_rgba.as_deref(),
            color,
            &library.unwrap_or_default(),
            design.as_deref(),
        )
        .map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityCrosshair {
    pub file: String,
    pub width: u32,
    pub height: u32,
    /// Frame 0 as unpremultiplied RGBA, for the picker preview.
    pub rgba: Vec<u8>,
    /// The raw VTF bytes to pass back through apply_crosshairs' library.
    pub bytes: Vec<u8>,
}

/// Download (with local cache) one Venom-pack crosshair and decode a preview.
#[tauri::command]
pub async fn fetch_community_crosshair(file: String) -> Result<CommunityCrosshair, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = crate::crosshair_fetch::fetch_crosshair_vtf(&file)?;
        let decoded = execs_core::vtf_read::decode_vtf_frame0(&bytes)?;
        if decoded.frames > 1 {
            return Err("Animated crosshairs are not supported yet.".into());
        }
        Ok(CommunityCrosshair {
            file,
            width: decoded.width,
            height: decoded.height,
            rgba: decoded.rgba,
            bytes,
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Decode the active profile's installed library crosshairs for previews.
#[tauri::command]
pub async fn get_pack_crosshair_previews(
) -> Result<BTreeMap<String, execs_core::StockCrosshairSprite>, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, None)?;
        let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), &profile_id)
            .map_err(|err| err.message())?;
        let mut out = BTreeMap::new();
        if let Some(record) = manifest.crosshair {
            for name in record.library.keys() {
                let Some(bytes) =
                    execs_core::stored_pack_crosshair(&execs_core::profiles_dir(), &profile_id, name)
                else {
                    continue;
                };
                if let Ok(decoded) = execs_core::vtf_read::decode_vtf_frame0(&bytes) {
                    out.insert(
                        name.clone(),
                        execs_core::StockCrosshairSprite {
                            width: decoded.width,
                            height: decoded.height,
                            rgba: decoded.rgba,
                        },
                    );
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_stock_crosshair_sprites(
) -> Result<BTreeMap<String, execs_core::StockCrosshairSprite>, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::extract_stock_crosshair_sprites(&root).map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn remove_crosshairs(id: Option<String>) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, id)?;
        execs_core::remove_crosshairs(&root, &profile_id).map_err(|err| err.message())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Build a Yttrium-style pack: fetch the animation sources, hide the chosen
/// groups, compile with TF2's own studiomdl in an isolated staging dir, and
/// install the resulting VPK like an import.
#[tauri::command]
pub async fn build_viewmodel_pack(
    hidden: Vec<String>,
    preload: bool,
    hide_mode: Option<String>,
    id: Option<String>,
) -> Result<ProfileDetail, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = resolve_profile_id(&root, id)?;
        let hidden_set: std::collections::BTreeSet<String> = hidden.into_iter().collect();
        let mode = execs_core::ViewmodelHideMode::from_str_or_default(hide_mode.as_deref());
        let zip = crate::viewmodel_fetch::fetch_animations_zip()?;
        let studiomdl = root.join("bin").join("studiomdl.exe");
        let staging = execs_core::execs_data_dir().join("studio").join("staging");
        let vpk =
            execs_core::build_viewmodel_pack_vpk(&zip, &hidden_set, mode, &studiomdl, &staging)
                .map_err(|err| err.message())?;
        let detail = execs_core::install_built_viewmodel_pack(
            &root,
            &profile_id,
            &vpk,
            &hidden_set,
            mode,
            preload,
        )
        .map_err(|err| err.message())?;
        let _ = std::fs::remove_dir_all(&staging);
        Ok(detail)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn import_viewmodels(
    app: AppHandle,
    preload: bool,
    id: Option<String>,
) -> Result<ProfileDetail, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import viewmodel VPK")
            .add_filter("VPK", &["vpk"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| err.to_string())?;
    let root = confirmed_root()?;
    let Some(picked) = picked else {
        // Cancelling the picker is a no-op, not an error.
        return execs_core::get_active_profile_detail(&root)
            .map_err(|err| err.message())?
            .ok_or_else(|| "Save or switch to a profile first.".to_string());
    };
    let path = picked.into_path().map_err(|err| err.to_string())?;
    let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
    let profile_id = resolve_profile_id(&root, id)?;
    execs_core::import_viewmodel_vpk(&root, &profile_id, &bytes, preload)
        .map_err(|err| err.message())
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

/// In-app windows for mastercomfig web surfaces. The pages are remote content
/// and get no Tauri IPC (they are never added to any capability).
#[tauri::command]
pub async fn open_embedded_page(app: AppHandle, page: String) -> Result<(), String> {
    let (label, url, title) = match page.as_str() {
        "comfig-extras" => (
            "comfig-extras",
            "https://comfig.app/app/",
            "mastercomfig extras",
        ),
        "comfig-docs" => (
            "comfig-docs",
            "https://docs.comfig.app/latest/",
            "mastercomfig preset guide",
        ),
        _ => return Err("Unknown embedded page.".into()),
    };
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    let url: tauri::Url = url.parse().map_err(|_| "Invalid URL.".to_string())?;
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(url))
        .title(title)
        .inner_size(1160.0, 820.0)
        .background_color(tauri::window::Color(18, 18, 18, 255))
        .build()
        .map_err(|err| err.to_string())?;
    Ok(())
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

// ---------------------------------------------------------------------------
// Preloader (gameinfo bypass + default mod library)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreloaderStatusPayload {
    pub status: execs_core::preloader::PreloaderStatus,
    pub mods_cached: bool,
    pub mods_size_bytes: u64,
    /// Steam's stored TF2 launch options carry the preload exec. When the
    /// options could only be saved to the profile (Steam was open), this
    /// stays false and the pane tells the user how to finish the job.
    pub preload_launch_in_steam: bool,
}

fn preloader_status_payload(
    root: &std::path::Path,
) -> Result<PreloaderStatusPayload, String> {
    let steam_options = execs_core::launch::read_launch_options();
    Ok(PreloaderStatusPayload {
        status: execs_core::preloader::preloader_status(root, &execs_core::execs_data_dir())?,
        mods_cached: crate::mods_fetch::is_cached(),
        mods_size_bytes: crate::mods_fetch::MODS_SIZE_BYTES,
        preload_launch_in_steam: steam_options.contains("+exec execs_preload")
            || steam_options.contains("+exec overrides/execs_preload"),
    })
}

#[tauri::command]
pub async fn get_preloader_status() -> Result<PreloaderStatusPayload, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || preloader_status_payload(&root))
        .await
        .map_err(|err| err.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultModsPayload {
    pub cached: bool,
    pub catalog: Option<execs_core::preloader::ModsCatalog>,
}

/// The catalog if the library zip is already cached; never downloads.
#[tauri::command]
pub async fn get_default_mods() -> Result<DefaultModsPayload, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !crate::mods_fetch::is_cached() {
            return Ok(DefaultModsPayload {
                cached: false,
                catalog: None,
            });
        }
        let catalog = execs_core::preloader::read_mods_catalog(&crate::mods_fetch::cache_path())?;
        Ok(DefaultModsPayload {
            cached: true,
            catalog: Some(catalog),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Download (or reuse) the pinned library zip and return its catalog.
#[tauri::command]
pub async fn download_default_mods() -> Result<DefaultModsPayload, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let zip = crate::mods_fetch::ensure_mods_zip()?;
        let catalog = execs_core::preloader::read_mods_catalog(&zip)?;
        Ok(DefaultModsPayload {
            cached: true,
            catalog: Some(catalog),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Apply a mod selection: restore previous patches, patch the selected
/// particle files into tf2_misc, pack addon content into tf/custom, and turn
/// the gameinfo bypass on. Refused while the game is running.
#[tauri::command]
pub async fn apply_preloader_mods(
    addons: Vec<String>,
    particle_mods: Vec<String>,
) -> Result<execs_core::preloader::PreloaderReport, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::refuse_if_running().map_err(|err| err.message())?;
        let zip = crate::mods_fetch::ensure_mods_zip()?;
        let selection = execs_core::preloader::PreloaderSelection {
            addons,
            particle_mods,
        };
        let has_content = !selection.addons.is_empty() || !selection.particle_mods.is_empty();
        let report = execs_core::preloader::apply_preloader_selection(
            &root,
            &execs_core::execs_data_dir(),
            &zip,
            &selection,
        )?;
        // Mods only survive Valve Casual when the shared preload cfg runs at
        // launch, so installing content turns it on for the active profile —
        // and records which profile that was, so revert can undo it later
        // even if a different profile is active by then.
        if has_content {
            if let Ok(profile_id) = resolve_profile_id(&root, None) {
                execs_core::ensure_profile_preload(&root, &profile_id)
                    .map_err(|err| err.message())?;
                execs_core::preloader::record_preload_profile(
                    &execs_core::execs_data_dir(),
                    &profile_id,
                )?;
            }
        }
        Ok(report)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn set_gameinfo_bypass(enabled: bool) -> Result<PreloaderStatusPayload, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::refuse_if_running().map_err(|err| err.message())?;
        execs_core::preloader::set_gameinfo_bypass(&root, &execs_core::execs_data_dir(), enabled)?;
        preloader_status_payload(&root)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Restore every stock byte: particle snapshots, gameinfo.txt, custom VPK.
#[tauri::command]
pub async fn revert_preloader() -> Result<execs_core::preloader::RevertReport, String> {
    let root = confirmed_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        execs_core::refuse_if_running().map_err(|err| err.message())?;
        let report =
            execs_core::preloader::revert_preloader(&root, &execs_core::execs_data_dir())?;
        // Drop the shared preload cfg from every profile the mods install
        // touched (plus the active one), unless a viewmodel pack wants it.
        // A profile deleted in the meantime just fails its own cleanup.
        let mut profiles =
            execs_core::preloader::take_preload_profiles(&execs_core::execs_data_dir());
        if let Ok(active) = resolve_profile_id(&root, None) {
            if !profiles.contains(&active) {
                profiles.push(active);
            }
        }
        for profile_id in profiles {
            let _ = execs_core::remove_profile_preload_if_unused(&root, &profile_id);
        }
        Ok(report)
    })
    .await
    .map_err(|err| err.to_string())?
}
