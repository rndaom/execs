//! App-data profile library. Inactive profiles never live under `tf/custom/`.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::blob::{gc_unreferenced_blobs, put_blob, put_blob_from_path};
use crate::finder::user_path_string;
use crate::hash::{copy_and_sha256, sha256_hex};
use crate::launch::{find_cloud_config, read_launch_options, sanitize_launch_options};
use crate::process_lock::{live_process_names, refuse_if_running_among, WriteLockError};
use crate::settings::execs_data_dir;
use crate::surface::inventory_live_surface_with;

pub const LIBRARY_SCHEMA: u32 = 1;
pub const SHARED_VPK_NAME: &str = "mastercomfig-base.vpk";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileError {
    GameRunning,
    RootMismatch {
        library_root: String,
        confirmed_root: String,
    },
    NotInitialized,
    UnknownProfile,
    ForbiddenPath(String),
    NotShareable(String),
    MustBeShared(String),
    InvalidPath,
    InvalidName,
    NoConfirmedRoot,
    Io(String),
}

impl From<WriteLockError> for ProfileError {
    fn from(_: WriteLockError) -> Self {
        Self::GameRunning
    }
}

impl ProfileError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::GameRunning => "GameRunning",
            Self::RootMismatch { .. } => "RootMismatch",
            Self::NotInitialized => "NotInitialized",
            Self::UnknownProfile => "UnknownProfile",
            Self::ForbiddenPath(_) => "ForbiddenPath",
            Self::NotShareable(_) => "NotShareable",
            Self::MustBeShared(_) => "MustBeShared",
            Self::InvalidPath => "InvalidPath",
            Self::InvalidName => "InvalidName",
            Self::NoConfirmedRoot => "NoConfirmedRoot",
            Self::Io(_) => "Io",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::GameRunning => WriteLockError::GameRunning.message().into(),
            Self::RootMismatch {
                library_root,
                confirmed_root,
            } => {
                format!(
                    "This library belongs to another TF2 install ({library_root}), not {confirmed_root}."
                )
            }
            Self::NotInitialized => "Profile library is not initialized.".into(),
            Self::UnknownProfile => "That profile is not in the library.".into(),
            Self::ForbiddenPath(path) => format!("Refusing to store {path} in a profile."),
            Self::NotShareable(path) => {
                format!("{path} cannot be stored as a shared blob. Only mastercomfig-base.vpk is shared by hash.")
            }
            Self::MustBeShared(path) => {
                format!("{path} is stored by hash across profiles, not copied into each one.")
            }
            Self::InvalidPath => "That file path is not allowed in a profile.".into(),
            Self::InvalidName => "Give the profile a name.".into(),
            Self::NoConfirmedRoot => "Confirm a TF2 install first.".into(),
            Self::Io(err) => format!("Could not update the profile library: {err}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndex {
    pub schema: u32,
    pub tf2_root: String,
    pub active_profile_id: Option<String>,
    pub profiles: Vec<ProfileSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStorage {
    Exclusive,
    Shared,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFile {
    pub path: String,
    pub sha256: String,
    pub storage: FileStorage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HudSource {
    HudDb,
    Local,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudRecord {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    pub source: HudSource,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrosshairRecord {
    pub id: String,
    #[serde(default)]
    pub shape: String,
    #[serde(default)]
    pub assignments: BTreeMap<String, String>,
    /// Baked RGB tint for the first-party shapes; None = white.
    #[serde(default)]
    pub color: Option<[u8; 3]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewmodelSource {
    Compiled,
    Imported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelRecord {
    pub id: String,
    pub source: ViewmodelSource,
    #[serde(default)]
    pub preload: bool,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileManifest {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub tf2_root: String,
    pub launch_options: String,
    pub files: Vec<ProfileFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hud: Option<HudRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crosshair: Option<CrosshairRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewmodel: Option<ViewmodelRecord>,
}

/// Read model for the UI. `profiles` is empty when the library is unusable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileLibrary {
    pub initialized: bool,
    pub usable: bool,
    pub root_mismatch: bool,
    pub tf2_root: Option<String>,
    pub confirmed_root: Option<String>,
    pub active_profile_id: Option<String>,
    pub profiles: Vec<ProfileSummary>,
}

pub fn profiles_dir() -> PathBuf {
    execs_data_dir().join("profiles")
}

pub fn index_file(profiles_dir: &Path) -> PathBuf {
    profiles_dir.join("index.json")
}

pub fn profile_dir(profiles_dir: &Path, id: &str) -> PathBuf {
    profiles_dir.join(id)
}

pub fn manifest_file(profiles_dir: &Path, id: &str) -> PathBuf {
    profile_dir(profiles_dir, id).join("manifest.json")
}

pub fn exclusive_files_dir(profiles_dir: &Path, id: &str) -> PathBuf {
    profile_dir(profiles_dir, id).join("files")
}

pub fn exclusive_file_path(profiles_dir: &Path, id: &str, rel: &str) -> PathBuf {
    let mut path = exclusive_files_dir(profiles_dir, id);
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

pub fn is_shared_file_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(SHARED_VPK_NAME)
}

pub fn is_shared_rel_path(path: &str) -> bool {
    path.rsplit('/').next().is_some_and(is_shared_file_name)
}

pub fn normalize_rel_path(path: &str) -> Result<String, ProfileError> {
    let normalized = path.replace('\\', "/");
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        return Err(ProfileError::InvalidPath);
    }
    for part in &parts {
        if *part == "." || *part == ".." || part.contains('\0') {
            return Err(ProfileError::InvalidPath);
        }
    }
    Ok(parts.join("/"))
}

pub fn is_forbidden_rel_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let file = lower.rsplit('/').next().unwrap_or(lower.as_str());
    if matches!(file, "steam.inf" | "gameinfo.txt" | "video.txt") {
        return true;
    }
    file.starts_with("tf2_") && file.ends_with(".vpk") && !lower.starts_with("tf/custom/")
}

pub fn load_library(confirmed_root: Option<&Path>) -> Result<ProfileLibrary, ProfileError> {
    load_library_from(&profiles_dir(), confirmed_root)
}

pub fn load_library_from(
    profiles_dir: &Path,
    confirmed_root: Option<&Path>,
) -> Result<ProfileLibrary, ProfileError> {
    let confirmed = confirmed_root.map(user_path_string);
    match load_index(profiles_dir)? {
        None => Ok(empty_library(false, confirmed_root.is_some(), confirmed)),
        Some(index) => Ok(library_from_index(index, confirmed_root, confirmed)),
    }
}

pub fn list_profiles_from(
    profiles_dir: &Path,
    confirmed_root: Option<&Path>,
) -> Result<Vec<ProfileSummary>, ProfileError> {
    Ok(load_library_from(profiles_dir, confirmed_root)?.profiles)
}

pub fn init_library(tf2_root: &Path) -> Result<ProfileLibrary, ProfileError> {
    init_library_to(&profiles_dir(), tf2_root, live_process_names())
}

pub fn init_library_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    init_unlocked(profiles_dir, tf2_root)?;
    load_library_from(profiles_dir, Some(tf2_root))
}

pub fn create_profile_record(tf2_root: &Path, name: &str) -> Result<ProfileLibrary, ProfileError> {
    create_profile_record_to(&profiles_dir(), tf2_root, name, live_process_names())
}

pub fn create_profile_record_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    name: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let name = normalize_name(name)?;
    let mut index = init_unlocked(profiles_dir, tf2_root)?;
    let now = utc_rfc3339();
    let summary = ProfileSummary {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        created_at: now.clone(),
        updated_at: now,
    };
    let manifest = ProfileManifest {
        schema: LIBRARY_SCHEMA,
        id: summary.id.clone(),
        name,
        tf2_root: index.tf2_root.clone(),
        launch_options: String::new(),
        files: Vec::new(),
        hud: None,
        crosshair: None,
        viewmodel: None,
    };
    write_json(&manifest_file(profiles_dir, &summary.id), &manifest)?;
    fs::create_dir_all(exclusive_files_dir(profiles_dir, &summary.id))
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    index.profiles.push(summary);
    write_json(&index_file(profiles_dir), &index)?;
    load_library_from(profiles_dir, Some(tf2_root))
}

#[derive(Debug, Clone, Default)]
pub struct SaveCurrentOptions<'a> {
    pub launch_options: Option<&'a str>,
    pub cloud_config: Option<&'a Path>,
}

pub fn save_current_as(tf2_root: &Path, name: &str) -> Result<ProfileLibrary, ProfileError> {
    let cloud = find_cloud_config();
    save_current_as_to(
        &profiles_dir(),
        tf2_root,
        name,
        live_process_names(),
        SaveCurrentOptions {
            launch_options: None,
            cloud_config: cloud.as_deref(),
        },
    )
}

pub fn save_current_as_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    name: &str,
    running_names: I,
    options: SaveCurrentOptions<'_>,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_writes(&running)?;
    let name = normalize_name(name)?;
    let mut index = init_unlocked(profiles_dir, tf2_root)?;
    let profile_id = if let Some(existing) = reusable_empty_profile(profiles_dir, &index) {
        rename_profile(profiles_dir, &mut index, &existing, &name)?;
        existing
    } else {
        create_empty_record(profiles_dir, &mut index, &name)?
    };

    let inventory = inventory_live_surface_with(tf2_root, options.cloud_config)?;
    for entry in inventory.entries {
        if is_shared_rel_path(&entry.dest_rel) {
            put_shared_blob_from_path_to(
                profiles_dir,
                tf2_root,
                &profile_id,
                &entry.dest_rel,
                &entry.source,
                &running,
            )?;
        } else {
            put_exclusive_file_from_path_to(
                profiles_dir,
                tf2_root,
                &profile_id,
                &entry.dest_rel,
                &entry.source,
                &running,
            )?;
        }
    }

    let launch = match options.launch_options {
        Some(raw) => sanitize_launch_options(raw),
        None => read_launch_options(),
    };
    let mut index = usable_index(profiles_dir, tf2_root)?;
    set_manifest_launch_options(profiles_dir, &mut index, &profile_id, launch)?;
    if index.active_profile_id.is_none() {
        index.active_profile_id = Some(profile_id);
        write_json(&index_file(profiles_dir), &index)?;
    }
    load_library_from(profiles_dir, Some(tf2_root))
}

pub fn put_exclusive_file_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    bytes: &[u8],
    running_names: I,
) -> Result<String, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let path = checked_rel_path(rel_path)?;
    if is_shared_rel_path(&path) {
        return Err(ProfileError::MustBeShared(path));
    }
    let mut index = usable_index(profiles_dir, tf2_root)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let dest = exclusive_file_path(profiles_dir, profile_id, &path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| ProfileError::Io(e.to_string()))?;
    }
    fs::write(&dest, bytes).map_err(|e| ProfileError::Io(e.to_string()))?;
    let hash = sha256_hex(bytes);
    upsert_file(
        &mut manifest,
        ProfileFile {
            path,
            sha256: hash.clone(),
            storage: FileStorage::Exclusive,
        },
    );
    write_json(&manifest_file(profiles_dir, profile_id), &manifest)?;
    touch_profile(&mut index, profile_id);
    write_json(&index_file(profiles_dir), &index)?;
    Ok(hash)
}

pub fn put_exclusive_file_from_path_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    source: &Path,
    running_names: I,
) -> Result<String, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let path = checked_rel_path(rel_path)?;
    if is_shared_rel_path(&path) {
        return Err(ProfileError::MustBeShared(path));
    }
    let mut index = usable_index(profiles_dir, tf2_root)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let dest = exclusive_file_path(profiles_dir, profile_id, &path);
    let hash = copy_and_sha256(source, &dest).map_err(|e| ProfileError::Io(e.to_string()))?;
    upsert_file(
        &mut manifest,
        ProfileFile {
            path,
            sha256: hash.clone(),
            storage: FileStorage::Exclusive,
        },
    );
    write_json(&manifest_file(profiles_dir, profile_id), &manifest)?;
    touch_profile(&mut index, profile_id);
    write_json(&index_file(profiles_dir), &index)?;
    Ok(hash)
}

pub fn put_shared_blob_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    bytes: &[u8],
    running_names: I,
) -> Result<String, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let path = checked_rel_path(rel_path)?;
    if !is_shared_rel_path(&path) {
        return Err(ProfileError::NotShareable(path));
    }
    let mut index = usable_index(profiles_dir, tf2_root)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let hash = put_blob(profiles_dir, bytes)?;
    upsert_file(
        &mut manifest,
        ProfileFile {
            path,
            sha256: hash.clone(),
            storage: FileStorage::Shared,
        },
    );
    write_json(&manifest_file(profiles_dir, profile_id), &manifest)?;
    touch_profile(&mut index, profile_id);
    write_json(&index_file(profiles_dir), &index)?;
    Ok(hash)
}

pub fn put_shared_blob_from_path_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    source: &Path,
    running_names: I,
) -> Result<String, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let path = checked_rel_path(rel_path)?;
    if !is_shared_rel_path(&path) {
        return Err(ProfileError::NotShareable(path));
    }
    let mut index = usable_index(profiles_dir, tf2_root)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let hash = put_blob_from_path(profiles_dir, source)?;
    upsert_file(
        &mut manifest,
        ProfileFile {
            path,
            sha256: hash.clone(),
            storage: FileStorage::Shared,
        },
    );
    write_json(&manifest_file(profiles_dir, profile_id), &manifest)?;
    touch_profile(&mut index, profile_id);
    write_json(&index_file(profiles_dir), &index)?;
    Ok(hash)
}

pub fn remove_profile_record_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let mut index = usable_index(profiles_dir, tf2_root)?;
    if !index
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    let dir = profile_dir(profiles_dir, profile_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| ProfileError::Io(e.to_string()))?;
    }
    index.profiles.retain(|profile| profile.id != profile_id);
    if index.active_profile_id.as_deref() == Some(profile_id) {
        index.active_profile_id = None;
    }
    write_json(&index_file(profiles_dir), &index)?;
    let referenced = referenced_shared_hashes(profiles_dir, &index)?;
    gc_unreferenced_blobs(profiles_dir, &referenced)?;
    load_library_from(profiles_dir, Some(tf2_root))
}

pub fn set_active_profile_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let mut index = usable_index(profiles_dir, tf2_root)?;
    if !index.profiles.iter().any(|profile| profile.id == profile_id) {
        return Err(ProfileError::UnknownProfile);
    }
    index.active_profile_id = Some(profile_id.to_string());
    write_json(&index_file(profiles_dir), &index)?;
    load_library_from(profiles_dir, Some(tf2_root))
}

pub fn remove_manifest_files_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    paths: &[String],
    running_names: I,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let mut index = usable_index(profiles_dir, tf2_root)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let mut changed = false;
    for path in paths {
        let path = normalize_rel_path(path)?;
        let before = manifest.files.len();
        manifest.files.retain(|file| file.path != path);
        if manifest.files.len() != before {
            changed = true;
        }
        let exclusive = exclusive_file_path(profiles_dir, profile_id, &path);
        if exclusive.is_file() {
            fs::remove_file(&exclusive).map_err(|e| ProfileError::Io(e.to_string()))?;
        }
    }
    if !changed {
        return Ok(());
    }
    write_json(&manifest_file(profiles_dir, profile_id), &manifest)?;
    touch_profile(&mut index, profile_id);
    write_json(&index_file(profiles_dir), &index)?;
    let referenced = referenced_shared_hashes(profiles_dir, &index)?;
    gc_unreferenced_blobs(profiles_dir, &referenced)?;
    Ok(())
}

pub fn load_manifest(
    profiles_dir: &Path,
    profile_id: &str,
) -> Result<ProfileManifest, ProfileError> {
    let text = fs::read_to_string(manifest_file(profiles_dir, profile_id))
        .map_err(|_| ProfileError::UnknownProfile)?;
    let mut manifest: ProfileManifest =
        serde_json::from_str(&text).map_err(|e| ProfileError::Io(e.to_string()))?;
    if manifest.schema != LIBRARY_SCHEMA {
        return Err(ProfileError::Io("unsupported profile schema".into()));
    }
    manifest.tf2_root = user_path_string(Path::new(&manifest.tf2_root));
    Ok(manifest)
}

pub(crate) fn save_manifest(
    profiles_dir: &Path,
    tf2_root: &Path,
    manifest: &ProfileManifest,
) -> Result<(), ProfileError> {
    let mut index = usable_index(profiles_dir, tf2_root)?;
    write_json(&manifest_file(profiles_dir, &manifest.id), manifest)?;
    touch_profile(&mut index, &manifest.id);
    write_json(&index_file(profiles_dir), &index)?;
    Ok(())
}

fn reusable_empty_profile(profiles_dir: &Path, index: &LibraryIndex) -> Option<String> {
    if index.profiles.len() != 1 {
        return None;
    }
    let id = index.profiles[0].id.clone();
    let manifest = load_manifest(profiles_dir, &id).ok()?;
    manifest.files.is_empty().then_some(id)
}

fn rename_profile(
    profiles_dir: &Path,
    index: &mut LibraryIndex,
    profile_id: &str,
    name: &str,
) -> Result<(), ProfileError> {
    if let Some(summary) = index
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
    {
        summary.name = name.to_string();
        summary.updated_at = utc_rfc3339();
    }
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.name = name.to_string();
    write_json(&manifest_file(profiles_dir, profile_id), &manifest)?;
    write_json(&index_file(profiles_dir), index)?;
    Ok(())
}

fn create_empty_record(
    profiles_dir: &Path,
    index: &mut LibraryIndex,
    name: &str,
) -> Result<String, ProfileError> {
    let now = utc_rfc3339();
    let summary = ProfileSummary {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    let manifest = ProfileManifest {
        schema: LIBRARY_SCHEMA,
        id: summary.id.clone(),
        name: name.to_string(),
        tf2_root: index.tf2_root.clone(),
        launch_options: String::new(),
        files: Vec::new(),
        hud: None,
        crosshair: None,
        viewmodel: None,
    };
    write_json(&manifest_file(profiles_dir, &summary.id), &manifest)?;
    fs::create_dir_all(exclusive_files_dir(profiles_dir, &summary.id))
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    let id = summary.id.clone();
    index.profiles.push(summary);
    write_json(&index_file(profiles_dir), index)?;
    Ok(id)
}

fn set_manifest_launch_options(
    profiles_dir: &Path,
    index: &mut LibraryIndex,
    profile_id: &str,
    launch_options: String,
) -> Result<(), ProfileError> {
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.launch_options = launch_options;
    write_json(&manifest_file(profiles_dir, profile_id), &manifest)?;
    touch_profile(index, profile_id);
    write_json(&index_file(profiles_dir), index)?;
    Ok(())
}

fn refuse_writes<I, S>(running_names: I) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_if_running_among(running_names).map_err(Into::into)
}

fn init_unlocked(profiles_dir: &Path, tf2_root: &Path) -> Result<LibraryIndex, ProfileError> {
    fs::create_dir_all(profiles_dir).map_err(|e| ProfileError::Io(e.to_string()))?;
    match load_index(profiles_dir)? {
        Some(index) if roots_match(&index.tf2_root, tf2_root) => Ok(index),
        Some(index) => Err(ProfileError::RootMismatch {
            library_root: index.tf2_root,
            confirmed_root: user_path_string(tf2_root),
        }),
        None => {
            let index = LibraryIndex {
                schema: LIBRARY_SCHEMA,
                tf2_root: user_path_string(tf2_root),
                active_profile_id: None,
                profiles: Vec::new(),
            };
            write_json(&index_file(profiles_dir), &index)?;
            Ok(index)
        }
    }
}

fn usable_index(profiles_dir: &Path, tf2_root: &Path) -> Result<LibraryIndex, ProfileError> {
    match load_index(profiles_dir)? {
        None => Err(ProfileError::NotInitialized),
        Some(index) if roots_match(&index.tf2_root, tf2_root) => Ok(index),
        Some(index) => Err(ProfileError::RootMismatch {
            library_root: index.tf2_root,
            confirmed_root: user_path_string(tf2_root),
        }),
    }
}

fn load_index(profiles_dir: &Path) -> Result<Option<LibraryIndex>, ProfileError> {
    let file = index_file(profiles_dir);
    if !file.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&file).map_err(|e| ProfileError::Io(e.to_string()))?;
    let mut index: LibraryIndex =
        serde_json::from_str(&text).map_err(|e| ProfileError::Io(e.to_string()))?;
    if index.schema != LIBRARY_SCHEMA {
        return Err(ProfileError::Io("unsupported library schema".into()));
    }
    index.tf2_root = user_path_string(Path::new(&index.tf2_root));
    Ok(Some(index))
}

fn library_from_index(
    index: LibraryIndex,
    confirmed_root: Option<&Path>,
    confirmed: Option<String>,
) -> ProfileLibrary {
    let matches = confirmed_root.is_some_and(|root| roots_match(&index.tf2_root, root));
    if matches {
        ProfileLibrary {
            initialized: true,
            usable: true,
            root_mismatch: false,
            tf2_root: Some(index.tf2_root),
            confirmed_root: confirmed,
            active_profile_id: index.active_profile_id,
            profiles: index.profiles,
        }
    } else {
        ProfileLibrary {
            initialized: true,
            usable: false,
            root_mismatch: confirmed_root.is_some(),
            tf2_root: Some(index.tf2_root),
            confirmed_root: confirmed,
            active_profile_id: None,
            profiles: Vec::new(),
        }
    }
}

fn empty_library(initialized: bool, usable: bool, confirmed: Option<String>) -> ProfileLibrary {
    ProfileLibrary {
        initialized,
        usable,
        root_mismatch: false,
        tf2_root: None,
        confirmed_root: confirmed,
        active_profile_id: None,
        profiles: Vec::new(),
    }
}

fn roots_match(stored: &str, confirmed: &Path) -> bool {
    let stored_path = Path::new(stored);
    if stored_path == confirmed {
        return true;
    }
    match (stored_path.canonicalize(), confirmed.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => stored_path.to_string_lossy() == confirmed.to_string_lossy(),
    }
}

fn checked_rel_path(path: &str) -> Result<String, ProfileError> {
    let path = normalize_rel_path(path)?;
    if is_forbidden_rel_path(&path) {
        return Err(ProfileError::ForbiddenPath(path));
    }
    Ok(path)
}

fn normalize_name(name: &str) -> Result<String, ProfileError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(ProfileError::InvalidName);
    }
    Ok(name.to_string())
}

fn upsert_file(manifest: &mut ProfileManifest, file: ProfileFile) {
    if let Some(existing) = manifest
        .files
        .iter_mut()
        .find(|entry| entry.path == file.path)
    {
        *existing = file;
    } else {
        manifest.files.push(file);
    }
}

fn touch_profile(index: &mut LibraryIndex, profile_id: &str) {
    let now = utc_rfc3339();
    if let Some(profile) = index
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
    {
        profile.updated_at = now;
    }
}

fn referenced_shared_hashes(
    profiles_dir: &Path,
    index: &LibraryIndex,
) -> Result<HashSet<String>, ProfileError> {
    let mut hashes = HashSet::new();
    for profile in &index.profiles {
        if let Ok(manifest) = load_manifest(profiles_dir, &profile.id) {
            for file in manifest.files {
                if file.storage == FileStorage::Shared {
                    hashes.insert(file.sha256);
                }
            }
        }
    }
    Ok(hashes)
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), ProfileError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ProfileError::Io(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| ProfileError::Io(e.to_string()))?;
    fs::write(path, format!("{json}\n")).map_err(|e| ProfileError::Io(e.to_string()))
}

fn utc_rfc3339() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let (year, month, day, hour, minute, second) = unix_to_ymd_hms(secs);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn unix_to_ymd_hms(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (year, month, day) = civil_from_unix_days(days);
    (
        year,
        month,
        day,
        (rem / 3600) as u32,
        ((rem % 3600) / 60) as u32,
        (rem % 60) as u32,
    )
}

/// Howard Hinnant civil-from-days, days since 1970-01-01.
fn civil_from_unix_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = (z.rem_euclid(146097)) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob::blob_path;
    use std::fs;

    fn unlocked() -> [&'static str; 1] {
        ["bash"]
    }

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn profiles_dir_sits_next_to_settings() {
        let dir = profiles_dir();
        assert!(dir.ends_with(Path::new("execs").join("profiles")));
    }

    #[test]
    fn load_missing_library_does_not_write() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        assert!(!library.initialized);
        assert!(library.usable);
        assert!(library.profiles.is_empty());
        assert!(!profiles.exists());
        cleanup(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn legacy_verbatim_roots_are_clean_on_read_and_next_authorized_write() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let created = create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = created.profiles[0].id.clone();
        let legacy = format!(r"\\?\{}", root.display());

        let mut index: LibraryIndex =
            serde_json::from_str(&fs::read_to_string(index_file(&profiles)).unwrap()).unwrap();
        index.tf2_root = legacy.clone();
        write_json(&index_file(&profiles), &index).unwrap();
        let mut manifest: ProfileManifest = serde_json::from_str(
            &fs::read_to_string(manifest_file(&profiles, &id)).unwrap(),
        )
        .unwrap();
        manifest.tf2_root = legacy;
        write_json(&manifest_file(&profiles, &id), &manifest).unwrap();

        let index_before = fs::read(index_file(&profiles)).unwrap();
        let manifest_before = fs::read(manifest_file(&profiles, &id)).unwrap();
        let loaded = load_library_from(&profiles, Some(&root)).unwrap();
        assert!(loaded.usable);
        assert!(!loaded.root_mismatch);
        assert_eq!(loaded.tf2_root.as_deref(), Some(root.to_string_lossy().as_ref()));
        assert_eq!(fs::read(index_file(&profiles)).unwrap(), index_before);

        let loaded_manifest = load_manifest(&profiles, &id).unwrap();
        assert_eq!(loaded_manifest.tf2_root, root.to_string_lossy());
        assert_eq!(fs::read(manifest_file(&profiles, &id)).unwrap(), manifest_before);

        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        let persisted: LibraryIndex =
            serde_json::from_str(&fs::read_to_string(index_file(&profiles)).unwrap()).unwrap();
        assert_eq!(persisted.tf2_root, root.to_string_lossy());
        cleanup(&dir);
    }

    #[test]
    fn init_and_create_record() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let live_custom = root.join("tf").join("custom");
        fs::create_dir_all(&live_custom).unwrap();

        let library = init_library_to(&profiles, &root, unlocked()).unwrap();
        assert!(library.initialized);
        assert!(library.usable);
        assert_eq!(library.profiles.len(), 0);
        assert!(index_file(&profiles).is_file());

        let library = create_profile_record_to(&profiles, &root, "  Main  ", unlocked()).unwrap();
        assert_eq!(library.profiles.len(), 1);
        assert_eq!(library.profiles[0].name, "Main");
        let id = &library.profiles[0].id;
        assert!(manifest_file(&profiles, id).is_file());
        assert!(exclusive_files_dir(&profiles, id).is_dir());
        assert!(live_custom.read_dir().unwrap().next().is_none());

        let parsed: LibraryIndex =
            serde_json::from_str(&fs::read_to_string(index_file(&profiles)).unwrap()).unwrap();
        assert_eq!(parsed.schema, 1);
        assert!(parsed.tf2_root.contains("Team Fortress 2"));
        assert!(parsed.active_profile_id.is_none());
        cleanup(&dir);
    }

    #[test]
    fn exclusive_and_shared_storage() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let live_custom = root.join("tf").join("custom");
        fs::create_dir_all(&live_custom).unwrap();

        create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        create_profile_record_to(&profiles, &root, "B", unlocked()).unwrap();
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        let a = &library.profiles[0].id;
        let b = &library.profiles[1].id;

        let cfg_hash = put_exclusive_file_to(
            &profiles,
            &root,
            a,
            "tf/cfg/overrides/autoexec.cfg",
            b"fov_desired 90\n",
            unlocked(),
        )
        .unwrap();
        assert_eq!(cfg_hash, sha256_hex(b"fov_desired 90\n"));
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                a,
                "tf/cfg/overrides/autoexec.cfg"
            ))
            .unwrap(),
            b"fov_desired 90\n"
        );

        let vpk = b"vpk-bytes";
        let shared_a = put_shared_blob_to(
            &profiles,
            &root,
            a,
            "tf/custom/mastercomfig-base.vpk",
            vpk,
            unlocked(),
        )
        .unwrap();
        let shared_b = put_shared_blob_to(
            &profiles,
            &root,
            b,
            r"tf\custom\Mastercomfig-Base.vpk",
            vpk,
            unlocked(),
        )
        .unwrap();
        assert_eq!(shared_a, shared_b);
        assert!(blob_path(&profiles, &shared_a).is_file());
        assert!(!exclusive_file_path(&profiles, a, "tf/custom/mastercomfig-base.vpk").exists());

        let err = put_exclusive_file_to(
            &profiles,
            &root,
            a,
            "tf/custom/mastercomfig-base.vpk",
            vpk,
            unlocked(),
        )
        .unwrap_err();
        assert_eq!(err.code(), "MustBeShared");
        let err = put_shared_blob_to(
            &profiles,
            &root,
            a,
            "tf/cfg/config.cfg",
            b"unbindall\n",
            unlocked(),
        )
        .unwrap_err();
        assert_eq!(err.code(), "NotShareable");

        remove_profile_record_to(&profiles, &root, a, unlocked()).unwrap();
        assert!(blob_path(&profiles, &shared_a).is_file());
        remove_profile_record_to(&profiles, &root, b, unlocked()).unwrap();
        assert!(!blob_path(&profiles, &shared_a).is_file());
        assert!(live_custom.read_dir().unwrap().next().is_none());
        cleanup(&dir);
    }

    #[test]
    fn refuses_writes_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let err = init_library_to(&profiles, &root, [tf2_name()]).unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        assert!(!profiles.exists());
        cleanup(&dir);
    }

    #[test]
    fn root_mismatch_hides_profiles() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let old = dir.join("old").join("Team Fortress 2");
        let new = dir.join("new").join("Team Fortress 2");
        create_profile_record_to(&profiles, &old, "Old", unlocked()).unwrap();

        let library = load_library_from(&profiles, Some(&new)).unwrap();
        assert!(library.initialized);
        assert!(!library.usable);
        assert!(library.root_mismatch);
        assert!(library.profiles.is_empty());

        let err = create_profile_record_to(&profiles, &new, "New", unlocked()).unwrap_err();
        match err {
            ProfileError::RootMismatch { library_root, .. } => {
                assert!(library_root.contains("old"));
            }
            other => panic!("expected RootMismatch, got {other:?}"),
        }
        cleanup(&dir);
    }

    #[test]
    fn rejects_forbidden_and_traversal_paths() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "Safe", unlocked()).unwrap();
        let id = &library.profiles[0].id;

        for path in [
            "tf/steam.inf",
            "tf/gameinfo.txt",
            "tf/cfg/video.txt",
            "tf/tf2_misc_dir.vpk",
            "../outside.cfg",
        ] {
            let err =
                put_exclusive_file_to(&profiles, &root, id, path, b"x", unlocked()).unwrap_err();
            assert!(
                matches!(
                    err,
                    ProfileError::ForbiddenPath(_) | ProfileError::InvalidPath
                ),
                "{path} => {err:?}"
            );
        }

        let hash = put_exclusive_file_to(
            &profiles,
            &root,
            id,
            "tf/custom/tf2_lookalike.vpk",
            b"custom",
            unlocked(),
        )
        .unwrap();
        assert_eq!(hash, sha256_hex(b"custom"));
        cleanup(&dir);
    }

    #[test]
    fn create_requires_a_name() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let err = create_profile_record_to(&profiles, &root, "   ", unlocked()).unwrap_err();
        assert_eq!(err, ProfileError::InvalidName);
        cleanup(&dir);
    }

    fn write_live(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn snapshot_tree(root: &Path) -> std::collections::BTreeMap<String, String> {
        let mut out = std::collections::BTreeMap::new();
        fn walk(dir: &Path, root: &Path, out: &mut std::collections::BTreeMap<String, String>) {
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, root, out);
                    continue;
                }
                if path.is_file() {
                    let rel = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    out.insert(rel, sha256_hex(&fs::read(&path).unwrap()));
                }
            }
        }
        if root.exists() {
            walk(root, root, &mut out);
        }
        out
    }

    #[test]
    fn save_current_copies_surface_and_leaves_live_untouched() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_live(&root.join("tf/cfg/user/autoexec.cfg"), "old autoexec\n");
        write_live(
            &root.join("tf/custom/hud/resource/ui/hudlayout.res"),
            "hud\n",
        );
        write_live(&root.join("tf/custom/mastercomfig-base.vpk"), "shared-vpk");
        write_live(&root.join("tf/cfg/video.txt"), "video\n");
        write_live(&root.join("tf/steam.inf"), "appID=440\n");
        let before = snapshot_tree(&root);

        let library = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-novid -autoconfig -dxlevel 90 +quit -console"),
                cloud_config: None,
            },
        )
        .unwrap();
        assert_eq!(library.profiles.len(), 1);
        assert_eq!(library.profiles[0].name, "Main");
        assert_eq!(
            library.active_profile_id.as_deref(),
            Some(library.profiles[0].id.as_str())
        );
        assert_eq!(snapshot_tree(&root), before);

        let id = &library.profiles[0].id;
        let manifest = load_manifest(&profiles, id).unwrap();
        assert_eq!(manifest.launch_options, "-novid -console");
        let paths: Vec<_> = manifest
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        assert!(paths.contains(&"tf/cfg/config.cfg"));
        assert!(paths.contains(&"tf/cfg/overrides/autoexec.cfg"));
        assert!(paths.contains(&"tf/cfg/overrides/.migrated/user/autoexec.cfg"));
        assert!(paths.contains(&"tf/custom/hud/resource/ui/hudlayout.res"));
        assert!(paths.contains(&"tf/custom/mastercomfig-base.vpk"));
        assert!(!paths.iter().any(|path| path.contains("video.txt")));
        assert!(!paths.iter().any(|path| path.contains("steam.inf")));

        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                id,
                "tf/cfg/overrides/autoexec.cfg"
            ))
            .unwrap(),
            b"fov_desired 90\n"
        );
        let shared = manifest
            .files
            .iter()
            .find(|file| file.path == "tf/custom/mastercomfig-base.vpk")
            .unwrap();
        assert_eq!(shared.storage, FileStorage::Shared);
        assert_eq!(shared.sha256, sha256_hex(b"shared-vpk"));
        assert!(crate::blob::blob_path(&profiles, &shared.sha256).is_file());
        assert!(!exclusive_file_path(&profiles, id, "tf/custom/mastercomfig-base.vpk").exists());
        cleanup(&dir);
    }

    #[test]
    fn first_save_sets_active_second_does_not_steal() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/autoexec.cfg"), "fov_desired 90\n");

        let first = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap();
        let first_id = first.profiles[0].id.clone();
        assert_eq!(first.active_profile_id.as_deref(), Some(first_id.as_str()));

        write_live(&root.join("tf/custom/alt/pack.txt"), "alt\n");
        let second = save_current_as_to(
            &profiles,
            &root,
            "Alt",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-novid"),
                cloud_config: None,
            },
        )
        .unwrap();
        assert_eq!(second.profiles.len(), 2);
        assert_eq!(second.active_profile_id.as_deref(), Some(first_id.as_str()));
        cleanup(&dir);
    }

    #[test]
    fn save_reuses_empty_singleton_and_uses_cloud_config() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        let created =
            create_profile_record_to(&profiles, &root, "Placeholder", unlocked()).unwrap();
        let empty_id = created.profiles[0].id.clone();
        let cloud = dir.join("cloud.cfg");
        write_live(&cloud, "cloud bytes\n");

        let library = save_current_as_to(
            &profiles,
            &root,
            "Live",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-console"),
                cloud_config: Some(&cloud),
            },
        )
        .unwrap();
        assert_eq!(library.profiles.len(), 1);
        assert_eq!(library.profiles[0].id, empty_id);
        assert_eq!(library.profiles[0].name, "Live");
        let manifest = load_manifest(&profiles, &empty_id).unwrap();
        assert_eq!(manifest.launch_options, "-console");
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.files[0].path, "tf/cfg/config.cfg");
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &empty_id,
                "tf/cfg/config.cfg"
            ))
            .unwrap(),
            b"cloud bytes\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn save_current_refuses_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/autoexec.cfg"), "x\n");
        let err = save_current_as_to(
            &profiles,
            &root,
            "Main",
            [tf2_name()],
            SaveCurrentOptions::default(),
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        assert!(!profiles.exists());
        cleanup(&dir);
    }
}
