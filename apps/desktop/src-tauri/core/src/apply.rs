//! Incremental apply of one owned file to the library and, if active, live TF2.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::absorb::write_config_cfg_dual_to;
use crate::blob::blob_path;
use crate::finder::discover_steam_roots;
use crate::process_lock::live_process_names;
use crate::profile::{
    exclusive_file_path, is_shared_rel_path, load_library_from, load_manifest, normalize_rel_path,
    profiles_dir, put_exclusive_file_to, put_shared_blob_to, CrosshairRecord, FileStorage,
    HudRecord, ProfileError, ProfileFile, ViewmodelRecord,
};
use crate::surface::CfgLayer;

const CONFIG_CFG: &str = "tf/cfg/config.cfg";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDetail {
    pub id: String,
    pub name: String,
    pub launch_options: String,
    pub layer: CfgLayer,
    pub files: Vec<ProfileFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hud: Option<HudRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crosshair: Option<CrosshairRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewmodel: Option<ViewmodelRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hitsound: Option<crate::hitsound::HitsoundRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mods: Vec<crate::mods::ModRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFileContent {
    pub path: String,
    pub text: Option<String>,
    pub sha256: String,
    pub binary: bool,
}

#[derive(Debug, Clone, Default)]
pub struct WriteOwnedOptions<'a> {
    pub steam_roots: Option<&'a [PathBuf]>,
}

pub use crate::profile::is_file_safe_rel_path;

pub fn detail_from_manifest(manifest: &crate::profile::ProfileManifest) -> ProfileDetail {
    ProfileDetail {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        launch_options: manifest.launch_options.clone(),
        layer: cfg_layer_from_files(&manifest.files),
        files: manifest.files.clone(),
        hud: manifest.hud.clone(),
        crosshair: manifest.crosshair.clone(),
        viewmodel: manifest.viewmodel.clone(),
        hitsound: manifest.hitsound.clone(),
        mods: manifest.mods.clone(),
    }
}

pub fn cfg_layer_from_files(files: &[ProfileFile]) -> CfgLayer {
    if files.iter().any(|file| file_implies_comfig(&file.path)) {
        CfgLayer::Comfig
    } else {
        CfgLayer::Vanilla
    }
}

fn file_implies_comfig(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if lower.starts_with("tf/cfg/overrides/") {
        return true;
    }
    if let Some(name) = lower.rsplit('/').next() {
        return lower.starts_with("tf/custom/")
            && name.starts_with("mastercomfig-")
            && name.ends_with(".vpk");
    }
    false
}

pub fn get_active_profile_detail(tf2_root: &Path) -> Result<Option<ProfileDetail>, ProfileError> {
    get_active_profile_detail_from(&profiles_dir(), tf2_root)
}

pub fn get_active_profile_detail_from(
    profiles_dir: &Path,
    tf2_root: &Path,
) -> Result<Option<ProfileDetail>, ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let Some(id) = library.active_profile_id else {
        return Ok(None);
    };
    Ok(Some(profile_detail_from(profiles_dir, &id)?))
}

pub fn list_profile_files_from(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
) -> Result<Vec<ProfileFile>, ProfileError> {
    let _ = load_library_from(profiles_dir, Some(tf2_root))?;
    Ok(load_manifest(profiles_dir, profile_id)?.files)
}

/// Raw bytes of one file a profile owns, straight from its manifest source
/// (exclusive tree or shared blob). Unlike [`read_profile_file`] this never
/// lossily decodes, so callers that copy a file verbatim get exactly the bytes.
pub fn profile_file_bytes_from(
    profiles_dir: &Path,
    profile_id: &str,
    rel_path: &str,
) -> Result<Vec<u8>, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let file = manifest
        .files
        .iter()
        .find(|file| file.path == rel_path)
        .ok_or(ProfileError::InvalidPath)?;
    let source = source_path(profiles_dir, &manifest.id, file)?;
    fs::read(&source).map_err(|err| ProfileError::Io(err.to_string()))
}

pub fn read_profile_file(
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
) -> Result<ProfileFileContent, ProfileError> {
    read_profile_file_from(&profiles_dir(), tf2_root, profile_id, rel_path)
}

pub fn read_profile_file_from(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
) -> Result<ProfileFileContent, ProfileError> {
    let _ = load_library_from(profiles_dir, Some(tf2_root))?;
    let path = checked_owned_path(rel_path)?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let file = manifest
        .files
        .iter()
        .find(|file| file.path == path)
        .ok_or(ProfileError::InvalidPath)?;
    let source = source_path(profiles_dir, &manifest.id, file)?;
    let bytes = fs::read(&source).map_err(|err| ProfileError::Io(err.to_string()))?;
    let text = String::from_utf8(bytes.clone()).ok();
    Ok(ProfileFileContent {
        path,
        binary: text.is_none(),
        text,
        sha256: file.sha256.clone(),
    })
}

pub fn write_owned_file(
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    bytes: &[u8],
) -> Result<ProfileDetail, ProfileError> {
    write_owned_file_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        rel_path,
        bytes,
        live_process_names(),
        WriteOwnedOptions::default(),
    )
}

pub fn write_owned_file_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    bytes: &[u8],
    running_names: I,
    options: WriteOwnedOptions<'_>,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    let path = checked_owned_path(rel_path)?;
    if is_shared_rel_path(&path) {
        put_shared_blob_to(profiles_dir, tf2_root, profile_id, &path, bytes, &running)?;
    } else {
        put_exclusive_file_to(profiles_dir, tf2_root, profile_id, &path, bytes, &running)?;
    }

    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() == Some(profile_id) {
        apply_owned_file_to_live(profiles_dir, tf2_root, profile_id, &path, &options)?;
    }
    profile_detail_from(profiles_dir, profile_id)
}

fn profile_detail_from(
    profiles_dir: &Path,
    profile_id: &str,
) -> Result<ProfileDetail, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    Ok(detail_from_manifest(&manifest))
}

fn apply_owned_file_to_live(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    options: &WriteOwnedOptions<'_>,
) -> Result<(), ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let file = manifest
        .files
        .iter()
        .find(|file| file.path == rel_path)
        .ok_or(ProfileError::InvalidPath)?;
    let source = source_path(profiles_dir, &manifest.id, file)?;
    let dest = live_path(tf2_root, rel_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    let bytes = fs::read(&source).map_err(|err| ProfileError::Io(err.to_string()))?;
    // Temp + rename: a crash mid-write would otherwise leave a truncated
    // .cfg/.vpk in the live tree, which the game happily mounts.
    crate::hash::write_atomic(&dest, &bytes).map_err(|err| ProfileError::Io(err.to_string()))?;
    if rel_path == CONFIG_CFG {
        let roots = match options.steam_roots {
            Some(roots) => roots.to_vec(),
            None => discover_steam_roots(),
        };
        write_config_cfg_dual_to(tf2_root, &bytes, &roots)?;
    }
    Ok(())
}

fn source_path(
    profiles_dir: &Path,
    profile_id: &str,
    file: &ProfileFile,
) -> Result<PathBuf, ProfileError> {
    let path = match file.storage {
        FileStorage::Shared => blob_path(profiles_dir, &file.sha256),
        FileStorage::Exclusive => exclusive_file_path(profiles_dir, profile_id, &file.path),
    };
    if !path.is_file() {
        return Err(ProfileError::Io(format!(
            "Profile file missing: {}",
            file.path
        )));
    }
    Ok(path)
}

fn live_path(tf2_root: &Path, rel: &str) -> PathBuf {
    let mut path = tf2_root.to_path_buf();
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn checked_owned_path(path: &str) -> Result<String, ProfileError> {
    let path = normalize_rel_path(path)?;
    if !is_file_safe_rel_path(&path) {
        return Err(ProfileError::ForbiddenPath(path));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::test_temp_dir;

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn unlocked() -> impl Iterator<Item = &'static str> {
        None::<&str>.into_iter()
    }

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
    }

    fn tf2_root(dir: &Path) -> PathBuf {
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf").join("cfg")).unwrap();
        fs::create_dir_all(root.join("tf").join("custom")).unwrap();
        root
    }

    #[test]
    fn file_safe_paths_reject_user_and_official() {
        assert!(is_file_safe_rel_path("tf/cfg/overrides/autoexec.cfg"));
        assert!(is_file_safe_rel_path("tf/cfg/config.cfg"));
        assert!(is_file_safe_rel_path("tf/custom/hud/info.vdf"));
        assert!(!is_file_safe_rel_path("tf/cfg/user/autoexec.cfg"));
        assert!(!is_file_safe_rel_path("tf/steam.inf"));
        assert!(!is_file_safe_rel_path("tf/cfg/gameinfo.txt"));
        assert!(!is_file_safe_rel_path("tf/tf2_misc_dir.vpk"));
        assert!(!is_file_safe_rel_path("../tf/cfg/autoexec.cfg"));
    }

    #[test]
    fn writes_library_and_live_when_active() {
        let dir = test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(&dir);
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();

        let detail = write_owned_file_to(
            &profiles,
            &root,
            &id,
            "tf/cfg/overrides/autoexec.cfg",
            b"fov_desired 90\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap();
        assert_eq!(detail.layer, CfgLayer::Comfig);
        assert_eq!(detail.files[0].path, "tf/cfg/overrides/autoexec.cfg");
        assert_eq!(
            fs::read_to_string(root.join("tf/cfg/overrides/autoexec.cfg")).unwrap(),
            "fov_desired 90\n"
        );
        let read =
            read_profile_file_from(&profiles, &root, &id, "tf/cfg/overrides/autoexec.cfg").unwrap();
        assert_eq!(read.text.as_deref(), Some("fov_desired 90\n"));
        assert!(!read.binary);
        cleanup(&dir);
    }

    #[test]
    fn inactive_profile_does_not_write_live() {
        let dir = test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(&dir);
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();

        write_owned_file_to(
            &profiles,
            &root,
            &id,
            "tf/cfg/autoexec.cfg",
            b"bind w +forward\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap();
        assert!(!root.join("tf/cfg/autoexec.cfg").is_file());
        assert_eq!(
            read_profile_file_from(&profiles, &root, &id, "tf/cfg/autoexec.cfg")
                .unwrap()
                .text
                .as_deref(),
            Some("bind w +forward\n")
        );
        cleanup(&dir);
    }

    #[test]
    fn refuses_forbidden_and_game_running() {
        let dir = test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(&dir);
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();

        let forbidden = write_owned_file_to(
            &profiles,
            &root,
            &id,
            "tf/steam.inf",
            b"appID=440\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap_err();
        assert!(matches!(forbidden, ProfileError::ForbiddenPath(_)));

        let locked = write_owned_file_to(
            &profiles,
            &root,
            &id,
            "tf/cfg/autoexec.cfg",
            b"echo hi\n",
            [tf2_name()],
            WriteOwnedOptions::default(),
        )
        .unwrap_err();
        assert!(matches!(locked, ProfileError::GameRunning));
        cleanup(&dir);
    }

    #[test]
    fn dual_writes_config_cfg_when_active() {
        let dir = test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(&dir);
        let steam = dir.join("Steam");
        fs::create_dir_all(steam.join("userdata/111/440/remote/cfg")).unwrap();
        fs::create_dir_all(steam.join("userdata/111/config")).unwrap();
        fs::write(
            steam.join("userdata/111/config/localconfig.vdf"),
            "\"UserLocalConfigStore\"\n{\n}\n",
        )
        .unwrap();

        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();

        let roots = [steam.clone()];
        write_owned_file_to(
            &profiles,
            &root,
            &id,
            CONFIG_CFG,
            b"bind w +forward\n",
            unlocked(),
            WriteOwnedOptions {
                steam_roots: Some(&roots),
            },
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("tf/cfg/config.cfg")).unwrap(),
            "bind w +forward\n"
        );
        assert_eq!(
            fs::read_to_string(steam.join("userdata/111/440/remote/cfg/config.cfg")).unwrap(),
            "bind w +forward\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn layer_from_comfig_vpk() {
        let files = vec![ProfileFile {
            path: "tf/custom/mastercomfig-base.vpk".into(),
            sha256: "abc".into(),
            storage: FileStorage::Shared,
        }];
        assert_eq!(cfg_layer_from_files(&files), CfgLayer::Comfig);
        assert_eq!(cfg_layer_from_files(&[]), CfgLayer::Vanilla);
    }
}
