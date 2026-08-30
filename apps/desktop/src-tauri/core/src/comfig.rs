//! Comfig pane helpers: preset, modules, official addons, and package apply (RND-154).
//!
//! Network-free. Fetch GitHub Release bytes in the Tauri host, then call these.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apply::{write_owned_file_to, ProfileDetail, WriteOwnedOptions};
use crate::blob::blob_path;
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, is_forbidden_rel_path, is_shared_file_name, is_shared_rel_path,
    load_library_from, load_manifest, normalize_rel_path, profiles_dir, remove_manifest_files_to,
    FileStorage, ProfileError, ProfileFile,
};
use crate::wizard::{
    file_name_for_rel, pick_release_asset, ComfigPreset, GitHubRelease, OfficialAddon, WizardAsset,
};

const SETUP_HOOK: &str = "tf/cfg/overrides/setup_hook.cfg";
const MODULES_CFG: &str = "tf/cfg/overrides/modules.cfg";
const BASE_VPK: &str = "tf/custom/mastercomfig-base.vpk";
const CUSTOM_PREFIX: &str = "tf/custom/comfig-custom/";

const JUNK_NAMES: &[&str] = &[
    ".ds_store",
    "thumbs.db",
    "desktop.ini",
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "__macosx",
    "sound.cache",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfigState {
    pub preset: ComfigPreset,
    pub modules: BTreeMap<String, String>,
    pub addons: Vec<OfficialAddon>,
    pub has_base_vpk: bool,
    pub has_comfig_custom: bool,
}

pub fn comfig_preset_from_str(value: &str) -> Option<ComfigPreset> {
    match value.trim().to_ascii_lowercase().as_str() {
        "ultra" => Some(ComfigPreset::Ultra),
        "high" => Some(ComfigPreset::High),
        "medium_high" => Some(ComfigPreset::MediumHigh),
        "medium" => Some(ComfigPreset::Medium),
        "medium_low" => Some(ComfigPreset::MediumLow),
        "low" => Some(ComfigPreset::Low),
        "very_low" => Some(ComfigPreset::VeryLow),
        "none" => Some(ComfigPreset::None),
        _ => None,
    }
}

pub fn parse_setup_hook(text: &str) -> ComfigPreset {
    let mut preset = ComfigPreset::Medium;
    for line in text.lines() {
        let trimmed = line.trim();
        let Some(value) = trimmed.strip_prefix("preset=") else {
            continue;
        };
        if let Some(parsed) = comfig_preset_from_str(value) {
            preset = parsed;
        }
    }
    preset
}

pub fn serialize_setup_hook(preset: ComfigPreset, existing: Option<&str>) -> String {
    let mut out = Vec::new();
    let mut wrote = false;
    if let Some(existing) = existing {
        for line in existing.lines() {
            if line.trim().starts_with("preset=") {
                if !wrote {
                    out.push(format!("preset={}", preset.as_str()));
                    wrote = true;
                }
                continue;
            }
            out.push(line.to_string());
        }
    }
    if !wrote {
        out.insert(0, format!("preset={}", preset.as_str()));
    }
    let mut text = out.join("\n");
    text.push('\n');
    text
}

pub fn parse_modules_cfg(text: &str) -> BTreeMap<String, String> {
    let mut modules = BTreeMap::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('#') {
            continue;
        }
        let Some((name, level)) = trimmed.split_once('=') else {
            continue;
        };
        let name = name.trim();
        let level = level.trim();
        if !is_module_name(name) || !is_module_level(level) {
            continue;
        }
        modules.insert(name.to_ascii_lowercase(), level.to_string());
    }
    modules
}

pub fn serialize_modules_cfg(modules: &BTreeMap<String, String>) -> String {
    let mut text = String::new();
    for (name, level) in modules {
        let name = name.trim();
        let level = level.trim();
        if name.is_empty() || level.is_empty() {
            continue;
        }
        text.push_str(name);
        text.push('=');
        text.push_str(level);
        text.push('\n');
    }
    text
}

pub fn addon_from_rel_path(path: &str) -> Option<OfficialAddon> {
    let name = path.replace('\\', "/").rsplit('/').next()?.to_string();
    OfficialAddon::all()
        .iter()
        .copied()
        .find(|addon| addon.vpk_file_name().eq_ignore_ascii_case(&name))
}

pub fn official_package_rel_paths(addons: &[OfficialAddon]) -> Vec<String> {
    let mut paths = vec![BASE_VPK.to_string()];
    for addon in addons {
        let path = addon.rel_path();
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
}

pub fn official_download_urls(
    rel_paths: &[String],
    release: &GitHubRelease,
) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for rel in rel_paths {
        let name = file_name_for_rel(rel);
        let Some(asset) = pick_release_asset(release, name) else {
            return Err(format!("Official mastercomfig release is missing {name}."));
        };
        out.push((rel.clone(), asset.browser_download_url.clone()));
    }
    Ok(out)
}

pub fn read_comfig_state(tf2_root: &Path, profile_id: &str) -> Result<ComfigState, ProfileError> {
    read_comfig_state_from(&profiles_dir(), tf2_root, profile_id)
}

pub fn read_active_comfig_state(tf2_root: &Path) -> Result<Option<ComfigState>, ProfileError> {
    read_active_comfig_state_from(&profiles_dir(), tf2_root)
}

pub fn read_active_comfig_state_from(
    profiles_dir: &Path,
    tf2_root: &Path,
) -> Result<Option<ComfigState>, ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let Some(id) = library.active_profile_id else {
        return Ok(None);
    };
    Ok(Some(read_comfig_state_from(profiles_dir, tf2_root, &id)?))
}

pub fn read_comfig_state_from(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
) -> Result<ComfigState, ProfileError> {
    let _ = load_library_from(profiles_dir, Some(tf2_root))?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let hook = read_profile_text(profiles_dir, profile_id, &manifest.files, SETUP_HOOK)?;
    let modules_text = read_profile_text(profiles_dir, profile_id, &manifest.files, MODULES_CFG)?;
    let mut addons = Vec::new();
    let mut has_base_vpk = false;
    let mut has_comfig_custom = false;
    for file in &manifest.files {
        let lower = file.path.to_ascii_lowercase();
        if is_shared_file_name(file.path.rsplit('/').next().unwrap_or(&file.path)) {
            has_base_vpk = true;
        }
        if lower.starts_with(CUSTOM_PREFIX) {
            has_comfig_custom = true;
        }
        if let Some(addon) = addon_from_rel_path(&file.path) {
            if !addons.contains(&addon) {
                addons.push(addon);
            }
        }
    }
    Ok(ComfigState {
        preset: hook
            .as_deref()
            .map(parse_setup_hook)
            .unwrap_or(ComfigPreset::Medium),
        modules: modules_text
            .as_deref()
            .map(parse_modules_cfg)
            .unwrap_or_default(),
        addons,
        has_base_vpk,
        has_comfig_custom,
    })
}

pub fn write_comfig_preset(
    tf2_root: &Path,
    profile_id: &str,
    preset: ComfigPreset,
) -> Result<ProfileDetail, ProfileError> {
    write_comfig_preset_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        preset,
        live_process_names(),
    )
}

pub fn write_comfig_preset_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    preset: ComfigPreset,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let existing = read_profile_text_from(profiles_dir, tf2_root, profile_id, SETUP_HOOK)?;
    let text = serialize_setup_hook(preset, existing.as_deref());
    write_owned_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        SETUP_HOOK,
        text.as_bytes(),
        &running,
        WriteOwnedOptions::default(),
    )
}

pub fn write_comfig_modules(
    tf2_root: &Path,
    profile_id: &str,
    modules: &BTreeMap<String, String>,
) -> Result<ProfileDetail, ProfileError> {
    write_comfig_modules_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        modules,
        live_process_names(),
    )
}

pub fn write_comfig_modules_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    modules: &BTreeMap<String, String>,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let text = serialize_modules_cfg(modules);
    write_owned_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        MODULES_CFG,
        text.as_bytes(),
        &running,
        WriteOwnedOptions::default(),
    )
}

pub fn set_comfig_addons(
    tf2_root: &Path,
    profile_id: &str,
    addons: &[OfficialAddon],
    assets: &[WizardAsset<'_>],
) -> Result<ProfileDetail, ProfileError> {
    set_comfig_addons_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        addons,
        assets,
        live_process_names(),
    )
}

pub fn set_comfig_addons_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    addons: &[OfficialAddon],
    assets: &[WizardAsset<'_>],
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let current = read_comfig_state_from(profiles_dir, tf2_root, profile_id)?;
    let desired: Vec<OfficialAddon> = unique_addons(addons);

    let mut remove = Vec::new();
    for addon in &current.addons {
        if !desired.contains(addon) {
            remove.push(addon.rel_path());
        }
    }
    if !remove.is_empty() {
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &remove, &running)?;
        remove_live_paths_if_active(profiles_dir, tf2_root, profile_id, &remove)?;
    }

    for addon in &desired {
        if current.addons.contains(addon) {
            continue;
        }
        let rel = addon.rel_path();
        let Some(asset) = find_asset(assets, &rel) else {
            return Err(ProfileError::Io(format!(
                "Missing official mastercomfig file: {rel}"
            )));
        };
        write_owned_file_to(
            profiles_dir,
            tf2_root,
            profile_id,
            &rel,
            asset,
            &running,
            WriteOwnedOptions::default(),
        )?;
    }

    profile_detail(profiles_dir, tf2_root, profile_id)
}

pub fn import_comfig_custom(
    tf2_root: &Path,
    profile_id: &str,
    source_dir: &Path,
) -> Result<ProfileDetail, ProfileError> {
    import_comfig_custom_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        source_dir,
        live_process_names(),
    )
}

pub fn import_comfig_custom_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    source_dir: &Path,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    if !source_dir.is_dir() {
        return Err(ProfileError::Io(
            "Pick a comfig-custom folder to import.".into(),
        ));
    }
    let files = collect_import_files(source_dir)?;
    for (rel, bytes) in files {
        write_owned_file_to(
            profiles_dir,
            tf2_root,
            profile_id,
            &rel,
            &bytes,
            &running,
            WriteOwnedOptions::default(),
        )?;
    }
    profile_detail(profiles_dir, tf2_root, profile_id)
}

pub fn apply_official_vpk_bytes(
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    bytes: &[u8],
) -> Result<ProfileDetail, ProfileError> {
    apply_official_vpk_bytes_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        rel_path,
        bytes,
        live_process_names(),
    )
}

pub fn apply_official_vpk_bytes_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    bytes: &[u8],
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let path = normalize_rel_path(rel_path)?;
    if !is_official_vpk_rel(&path) {
        return Err(ProfileError::ForbiddenPath(path));
    }
    write_owned_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &path,
        bytes,
        &running,
        WriteOwnedOptions::default(),
    )
}

fn is_official_vpk_rel(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if !lower.starts_with("tf/custom/") {
        return false;
    }
    let name = lower.rsplit('/').next().unwrap_or("");
    name.starts_with("mastercomfig-") && name.ends_with(".vpk")
}

fn is_module_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn is_module_level(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
}

fn unique_addons(addons: &[OfficialAddon]) -> Vec<OfficialAddon> {
    let mut out = Vec::new();
    for addon in OfficialAddon::all() {
        if addons.contains(addon) && !out.contains(addon) {
            out.push(*addon);
        }
    }
    out
}

fn find_asset<'a>(assets: &'a [WizardAsset<'a>], rel: &str) -> Option<&'a [u8]> {
    let name = file_name_for_rel(rel);
    assets.iter().find_map(|asset| {
        if asset.path == rel || file_name_for_rel(asset.path).eq_ignore_ascii_case(name) {
            Some(asset.bytes)
        } else {
            None
        }
    })
}

fn profile_detail(
    profiles_dir: &Path,
    _tf2_root: &Path,
    profile_id: &str,
) -> Result<ProfileDetail, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    Ok(crate::apply::detail_from_manifest(&manifest))
}

fn read_profile_text_from(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel: &str,
) -> Result<Option<String>, ProfileError> {
    let _ = load_library_from(profiles_dir, Some(tf2_root))?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    read_profile_text(profiles_dir, profile_id, &manifest.files, rel)
}

fn read_profile_text(
    profiles_dir: &Path,
    profile_id: &str,
    files: &[ProfileFile],
    rel: &str,
) -> Result<Option<String>, ProfileError> {
    let Some(file) = files.iter().find(|file| file.path == rel) else {
        return Ok(None);
    };
    let source = match file.storage {
        FileStorage::Shared => blob_path(profiles_dir, &file.sha256),
        FileStorage::Exclusive => exclusive_file_path(profiles_dir, profile_id, &file.path),
    };
    if !source.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&source).map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(String::from_utf8(bytes).ok())
}

fn remove_live_paths_if_active(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    paths: &[String],
) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() != Some(profile_id) {
        return Ok(());
    }
    for rel in paths {
        let dest = live_tf2_path(tf2_root, rel);
        if dest.is_file() {
            fs::remove_file(&dest).map_err(|err| ProfileError::Io(err.to_string()))?;
        }
    }
    Ok(())
}

fn live_tf2_path(tf2_root: &Path, rel: &str) -> PathBuf {
    let mut path = tf2_root.to_path_buf();
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn collect_import_files(source_dir: &Path) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    let mut out = Vec::new();
    walk_import(source_dir, &[], &mut out)?;
    Ok(out)
}

fn walk_import(
    dir: &Path,
    rel_parts: &[String],
    out: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), ProfileError> {
    let entries = fs::read_dir(dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|err| ProfileError::Io(err.to_string()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_junk_name(&name) {
            continue;
        }
        let path = entry.path();
        if is_symlink(&path) {
            continue;
        }
        if path.is_dir() {
            let mut next = rel_parts.to_vec();
            next.push(name);
            walk_import(&path, &next, out)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let mut dest = vec![
            "tf".to_string(),
            "custom".to_string(),
            "comfig-custom".to_string(),
        ];
        dest.extend(rel_parts.iter().cloned());
        dest.push(name);
        let rel = dest.join("/");
        let Ok(rel) = normalize_rel_path(&rel) else {
            continue;
        };
        if is_forbidden_rel_path(&rel) || is_shared_rel_path(&rel) {
            continue;
        }
        let bytes = fs::read(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        out.push((rel, bytes));
    }
    Ok(())
}

fn is_junk_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if JUNK_NAMES.contains(&lower.as_str()) {
        return true;
    }
    lower.ends_with(".cache") || lower.ends_with(".ztmp") || lower.ends_with(".bak")
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{create_profile_record_to, set_active_profile_to, FileStorage};
    use crate::test_temp_dir;
    use std::fs::File;
    use std::io::Write;
    use std::path::Path;

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn unlocked() -> impl Iterator<Item = &'static str> {
        None::<&str>.into_iter()
    }

    fn tf2_root(dir: &Path) -> PathBuf {
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf").join("cfg")).unwrap();
        fs::create_dir_all(root.join("tf").join("custom")).unwrap();
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    fn fresh_profile(dir: &Path) -> (PathBuf, PathBuf, String) {
        let root = tf2_root(dir);
        let profiles = dir.join("execs").join("profiles");
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles[0]
            .id
            .clone();
        (profiles, root, id)
    }

    #[test]
    fn parse_setup_hook_and_modules() {
        assert_eq!(parse_setup_hook("preset=low\n"), ComfigPreset::Low);
        assert_eq!(
            parse_setup_hook("echo hi\npreset=medium_high\n"),
            ComfigPreset::MediumHigh
        );
        assert_eq!(parse_setup_hook(""), ComfigPreset::Medium);
        let modules = parse_modules_cfg("texture_quality=high\nshadows=off\n// skip\n");
        assert_eq!(modules.get("texture_quality").map(String::as_str), Some("high"));
        assert_eq!(modules.get("shadows").map(String::as_str), Some("off"));
        assert_eq!(
            serialize_modules_cfg(&modules),
            "shadows=off\ntexture_quality=high\n"
        );
    }

    #[test]
    fn write_preset_and_modules_round_trip() {
        let dir = test_temp_dir();
        let (profiles, root, id) = fresh_profile(&dir);
        write_owned_file_to(
            &profiles,
            &root,
            &id,
            SETUP_HOOK,
            b"preset=high\necho hello\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap();

        write_comfig_preset_to(&profiles, &root, &id, ComfigPreset::Medium, unlocked()).unwrap();
        let mut modules = BTreeMap::new();
        modules.insert("texture_quality".into(), "high".into());
        write_comfig_modules_to(&profiles, &root, &id, &modules, unlocked()).unwrap();

        let state = read_comfig_state_from(&profiles, &root, &id).unwrap();
        assert_eq!(state.preset, ComfigPreset::Medium);
        assert_eq!(state.modules.get("texture_quality").map(String::as_str), Some("high"));
        let hook = exclusive_file_path(&profiles, &id, SETUP_HOOK);
        assert_eq!(
            fs::read_to_string(&hook).unwrap(),
            "preset=medium\necho hello\n"
        );
        assert_eq!(
            fs::read_to_string(exclusive_file_path(&profiles, &id, MODULES_CFG)).unwrap(),
            "texture_quality=high\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn addon_add_remove_updates_manifest_paths() {
        let dir = test_temp_dir();
        let (profiles, root, id) = fresh_profile(&dir);
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        let addon = OfficialAddon::NoTutorial;
        let rel = addon.rel_path();
        let bytes = b"addon-vpk";
        let assets = [WizardAsset {
            path: "tf/custom/mastercomfig-addon-no-tutorial.vpk",
            bytes,
        }];

        set_comfig_addons_to(&profiles, &root, &id, &[addon], &assets, unlocked()).unwrap();
        let state = read_comfig_state_from(&profiles, &root, &id).unwrap();
        assert_eq!(state.addons, vec![OfficialAddon::NoTutorial]);
        let paths: Vec<String> = load_manifest(&profiles, &id)
            .unwrap()
            .files
            .into_iter()
            .map(|file| file.path)
            .collect();
        assert!(paths.contains(&rel));
        assert_eq!(fs::read(root.join("tf/custom").join(addon.vpk_file_name())).unwrap(), b"addon-vpk");

        set_comfig_addons_to(&profiles, &root, &id, &[], &[], unlocked()).unwrap();
        let state = read_comfig_state_from(&profiles, &root, &id).unwrap();
        assert!(state.addons.is_empty());
        let paths: Vec<String> = load_manifest(&profiles, &id)
            .unwrap()
            .files
            .into_iter()
            .map(|file| file.path)
            .collect();
        assert!(!paths.contains(&rel));
        assert!(!root.join("tf/custom").join(addon.vpk_file_name()).is_file());
        cleanup(&dir);
    }

    #[test]
    fn import_copies_file_under_comfig_custom() {
        let dir = test_temp_dir();
        let (profiles, root, id) = fresh_profile(&dir);
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        let source = dir.join("comfig-custom");
        write_file(&source.join("autoexec.cfg"), "echo imported\n");
        write_file(&source.join(".DS_Store"), "junk");

        import_comfig_custom_to(&profiles, &root, &id, &source, unlocked()).unwrap();
        let rel = "tf/custom/comfig-custom/autoexec.cfg";
        let state = read_comfig_state_from(&profiles, &root, &id).unwrap();
        assert!(state.has_comfig_custom);
        assert_eq!(
            fs::read_to_string(exclusive_file_path(&profiles, &id, rel)).unwrap(),
            "echo imported\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("tf/custom/comfig-custom/autoexec.cfg")).unwrap(),
            "echo imported\n"
        );
        let paths: Vec<String> = load_manifest(&profiles, &id)
            .unwrap()
            .files
            .into_iter()
            .map(|file| file.path)
            .collect();
        assert!(paths.contains(&rel.to_string()));
        assert!(!paths.iter().any(|path| path.to_ascii_lowercase().contains("ds_store")));
        cleanup(&dir);
    }

    #[test]
    fn refuses_while_tf_linux64_running() {
        let dir = test_temp_dir();
        let (profiles, root, id) = fresh_profile(&dir);
        let err = write_comfig_preset_to(
            &profiles,
            &root,
            &id,
            ComfigPreset::High,
            ["tf_linux64"],
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);

        let source = dir.join("comfig-custom");
        write_file(&source.join("note.txt"), "x\n");
        let err = import_comfig_custom_to(&profiles, &root, &id, &source, ["tf_linux64"]).unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);

        let err = apply_official_vpk_bytes_to(
            &profiles,
            &root,
            &id,
            BASE_VPK,
            b"base",
            ["tf_linux64"],
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        cleanup(&dir);
    }

    #[test]
    fn official_vpk_bytes_are_shared_for_base() {
        let dir = test_temp_dir();
        let (profiles, root, id) = fresh_profile(&dir);
        apply_official_vpk_bytes_to(&profiles, &root, &id, BASE_VPK, b"base-vpk", unlocked())
            .unwrap();
        apply_official_vpk_bytes_to(
            &profiles,
            &root,
            &id,
            "tf/custom/mastercomfig-addon-lowmem.vpk",
            b"addon-vpk",
            unlocked(),
        )
        .unwrap();
        let manifest = load_manifest(&profiles, &id).unwrap();
        let base = manifest
            .files
            .iter()
            .find(|file| file.path == BASE_VPK)
            .unwrap();
        assert_eq!(base.storage, FileStorage::Shared);
        let addon = manifest
            .files
            .iter()
            .find(|file| file.path == "tf/custom/mastercomfig-addon-lowmem.vpk")
            .unwrap();
        assert_eq!(addon.storage, FileStorage::Exclusive);
        let state = read_comfig_state_from(&profiles, &root, &id).unwrap();
        assert!(state.has_base_vpk);
        assert_eq!(state.addons, vec![OfficialAddon::Lowmem]);
        cleanup(&dir);
    }
}
