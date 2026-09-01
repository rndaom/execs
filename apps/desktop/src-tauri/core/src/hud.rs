//! HUD pack detection, zip extract, catalog helpers, and one-HUD install.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

use crate::absorb::pack_key;
use crate::apply::{detail_from_manifest, write_owned_file_to, ProfileDetail};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, load_library_from, load_manifest, profiles_dir, put_exclusive_file_to,
    remove_manifest_files_to, save_manifest, HudRecord, HudSource, ProfileError, ProfileFile,
    ProfileManifest,
};
use crate::settings::execs_data_dir;
use crate::vdf::{parse_vdf, VdfValue};

pub const SUPPORTED_SCHEMA_HUDS: &[&str] = &[
    "rayshud",
    "budhud",
    "flawhud",
    "m0rehud",
    "kbnhud",
    "hypnotize-hud",
];

const RAW_HUD_DB: &str = "https://raw.githubusercontent.com/mastercomfig/hud-db/main";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HudTree {
    pub files: BTreeMap<String, Vec<u8>>,
}

impl HudTree {
    pub fn get(&self, path: &str) -> Option<&[u8]> {
        self.files.get(&normalize_hud_rel(path)).map(Vec::as_slice)
    }

    pub fn insert(&mut self, path: impl Into<String>, bytes: Vec<u8>) {
        self.files.insert(normalize_hud_rel(&path.into()), bytes);
    }

    pub fn remove(&mut self, path: &str) -> Option<Vec<u8>> {
        self.files.remove(&normalize_hud_rel(path))
    }

    pub fn rename(&mut self, from: &str, to: &str) -> bool {
        if let Some(bytes) = self.remove(from) {
            self.insert(to, bytes);
            true
        } else {
            false
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedHud {
    pub tree: HudTree,
    pub ui_version: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudCatalogEntry {
    pub id: String,
    pub name: String,
    pub author: String,
    pub repo: String,
    pub hash: String,
    pub github: bool,
    pub flags: Vec<String>,
    pub banner: Option<String>,
    /// Full-size screenshot URLs from hud-db's `resources` (image names only).
    #[serde(default)]
    pub screenshots: Vec<String>,
    /// Optional external album page (e.g. Imgur) from hud-db's `social.album`.
    #[serde(default)]
    pub album: Option<String>,
    pub comfig_url: String,
    pub tf2huds_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudCatalogCache {
    pub tree_sha: String,
    pub entries: Vec<HudCatalogEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudStatus {
    pub record: HudRecord,
    pub inferred: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudUiState {
    pub installed: Option<HudRecord>,
    pub inferred: bool,
    pub schema_supported: bool,
    pub catalog_hash: Option<String>,
    pub update_available: bool,
}

pub fn is_hud_marker(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("tf/custom/") else {
        return false;
    };
    let Some((_, after)) = rest.split_once('/') else {
        return false;
    };
    after == "info.vdf" || after.starts_with("resource/ui/")
}

pub fn is_hud_dir(path: &Path) -> bool {
    path.join("info.vdf").is_file() || path.join("resource").join("ui").is_dir()
}

pub fn hud_packs(files: &[ProfileFile]) -> Vec<String> {
    let mut packs = Vec::new();
    for file in files {
        let Some(pack) = pack_key(&file.path) else {
            continue;
        };
        if !is_hud_marker(&file.path) {
            continue;
        }
        if !packs.contains(&pack) {
            packs.push(pack);
        }
    }
    packs
}

pub fn live_hud_names(tf2_root: &Path) -> Vec<String> {
    let custom = tf2_root.join("tf").join("custom");
    let Ok(entries) = fs::read_dir(&custom) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !is_hud_dir(&path) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let key = name
            .strip_prefix('-')
            .unwrap_or(name.as_str())
            .to_ascii_lowercase();
        if !key.is_empty() && !names.contains(&key) {
            names.push(key);
        }
    }
    names
}

pub fn schema_supported(id: &str) -> bool {
    SUPPORTED_SCHEMA_HUDS
        .iter()
        .any(|known| known.eq_ignore_ascii_case(id))
}

pub fn schema_file_name(id: &str) -> Option<&'static str> {
    match id.to_ascii_lowercase().as_str() {
        "rayshud" => Some("rayshud.json"),
        "budhud" => Some("budhud.json"),
        "flawhud" => Some("flawhud.json"),
        "m0rehud" => Some("m0rehud-classic.json"),
        "kbnhud" => Some("kbnhud.json"),
        "hypnotize-hud" => Some("hypnotize-hud.json"),
        _ => None,
    }
}

pub fn sanitize_hud_id(id: &str) -> Result<String, ProfileError> {
    let id = id.trim().to_ascii_lowercase();
    if id.is_empty()
        || id.starts_with('-')
        || id
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
    {
        return Err(ProfileError::Io(
            "Give that HUD a valid folder name.".into(),
        ));
    }
    Ok(id)
}

pub fn is_github_hud_repo(repo: &str) -> bool {
    github_repo_parts(repo).is_some()
}

pub fn hud_zip_url(repo: &str, hash: &str) -> Option<String> {
    let (owner, name) = github_repo_parts(repo)?;
    if hash.trim().is_empty() {
        return None;
    }
    Some(format!(
        "https://codeload.github.com/{owner}/{name}/legacy.zip/{hash}"
    ))
}

pub fn github_repo_parts(repo: &str) -> Option<(String, String)> {
    let trimmed = repo.trim().trim_end_matches('/');
    let rest = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))?;
    let mut parts = rest.split('/');
    let owner = parts.next()?.trim();
    let name = parts.next()?.trim().trim_end_matches(".git");
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return None;
    }
    Some((owner.to_string(), name.to_string()))
}

pub fn catalog_entry_from_json(id: &str, raw: &str) -> Result<HudCatalogEntry, ProfileError> {
    #[derive(Deserialize)]
    struct RawSocial {
        #[serde(default)]
        album: Option<String>,
    }
    #[derive(Deserialize)]
    struct RawHud {
        name: String,
        author: String,
        repo: String,
        hash: serde_json::Value,
        #[serde(default)]
        flags: Vec<String>,
        #[serde(default)]
        resources: Vec<String>,
        #[serde(default)]
        social: Option<RawSocial>,
    }
    let parsed: RawHud =
        serde_json::from_str(raw).map_err(|err| ProfileError::Io(err.to_string()))?;
    let hash = match parsed.hash {
        serde_json::Value::String(text) => text,
        serde_json::Value::Number(number) => number.to_string(),
        _ => String::new(),
    };
    let id = sanitize_hud_id(id)?;
    // `resources` mixes image names with full video URLs — only names are
    // hud-db-hosted webp screenshots.
    let screenshots: Vec<String> = parsed
        .resources
        .iter()
        .filter(|name| !name.contains("://"))
        .map(|name| format!("{RAW_HUD_DB}/hud-resources/{id}/{name}.webp"))
        .collect();
    let banner = screenshots.first().cloned();
    let album = parsed
        .social
        .and_then(|social| social.album)
        .filter(|album| album.starts_with("https://") || album.starts_with("http://"));
    Ok(HudCatalogEntry {
        comfig_url: format!("https://comfig.app/huds/page/{id}/"),
        tf2huds_url: format!("https://tf2huds.dev/hud/{id}"),
        github: is_github_hud_repo(&parsed.repo),
        id,
        name: parsed.name,
        author: parsed.author,
        repo: parsed.repo,
        hash,
        flags: parsed.flags,
        banner,
        screenshots,
        album,
    })
}

pub fn catalog_cache_dir() -> PathBuf {
    execs_data_dir().join("hud-catalog")
}

pub fn catalog_cache_file(dir: &Path) -> PathBuf {
    // v2: entries gained screenshots/album; old caches are ignored and refetched.
    dir.join("catalog-v2.json")
}

pub fn load_catalog_cache_from(dir: &Path) -> Option<HudCatalogCache> {
    let text = fs::read_to_string(catalog_cache_file(dir)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_catalog_cache_to(dir: &Path, cache: &HudCatalogCache) -> Result<(), ProfileError> {
    fs::create_dir_all(dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    let json =
        serde_json::to_string_pretty(cache).map_err(|err| ProfileError::Io(err.to_string()))?;
    fs::write(catalog_cache_file(dir), format!("{json}\n"))
        .map_err(|err| ProfileError::Io(err.to_string()))
}

pub fn extract_hud_zip(bytes: &[u8]) -> Result<ExtractedHud, ProfileError> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|err| ProfileError::Io(err.to_string()))?;
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let rel = sanitize_zip_entry(entry.name())?;
        let mut data = Vec::new();
        entry
            .read_to_end(&mut data)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        raw.push((rel, data));
    }
    let stripped = strip_wrapper_folder(raw);
    let mut tree = HudTree::default();
    for (path, data) in stripped {
        tree.insert(path, data);
    }
    if tree.get("info.vdf").is_none() {
        return Err(ProfileError::Io(
            "That zip is not a HUD (missing info.vdf at the root).".into(),
        ));
    }
    let ui_version = tree
        .get("info.vdf")
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .and_then(parse_ui_version);
    Ok(ExtractedHud { tree, ui_version })
}

pub fn hud_ui_state(manifest: &ProfileManifest, catalog: &[HudCatalogEntry]) -> HudUiState {
    let status = resolve_hud(manifest);
    let installed = status.as_ref().map(|item| item.record.clone());
    let inferred = status.as_ref().is_some_and(|item| item.inferred);
    let id = installed.as_ref().map(|hud| hud.id.as_str());
    let catalog_hash = id.and_then(|id| {
        catalog
            .iter()
            .find(|entry| entry.id.eq_ignore_ascii_case(id))
            .map(|entry| entry.hash.clone())
    });
    let update_available = match (&installed, &catalog_hash) {
        (Some(record), Some(hash)) => {
            record.source == HudSource::HudDb
                && record
                    .hash
                    .as_deref()
                    .is_some_and(|current| current != hash)
        }
        _ => false,
    };
    HudUiState {
        schema_supported: id.is_some_and(schema_supported),
        installed,
        inferred,
        catalog_hash,
        update_available,
    }
}

pub fn resolve_hud(manifest: &ProfileManifest) -> Option<HudStatus> {
    if let Some(record) = &manifest.hud {
        return Some(HudStatus {
            record: record.clone(),
            inferred: false,
        });
    }
    let mut packs = hud_packs(&manifest.files);
    if packs.is_empty() {
        return None;
    }
    packs.sort();
    Some(HudStatus {
        record: HudRecord {
            id: packs.into_iter().next()?,
            hash: None,
            source: HudSource::Local,
            options: BTreeMap::new(),
        },
        inferred: true,
    })
}

pub fn install_hud_pack(
    tf2_root: &Path,
    profile_id: &str,
    tree: &HudTree,
    record: HudRecord,
) -> Result<ProfileDetail, ProfileError> {
    install_hud_pack_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        tree,
        record,
        live_process_names(),
    )
}

pub fn install_hud_pack_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    tree: &HudTree,
    record: HudRecord,
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
    let id = sanitize_hud_id(&record.id)?;
    if tree.get("info.vdf").is_none() {
        return Err(ProfileError::Io(
            "That zip is not a HUD (missing info.vdf at the root).".into(),
        ));
    }

    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let previous = hud_packs(&manifest.files);
    let remove: Vec<String> = manifest
        .files
        .iter()
        .filter(|file| {
            pack_key(&file.path).is_some_and(|pack| previous.iter().any(|hud| hud == &pack))
        })
        .map(|file| file.path.clone())
        .collect();
    if !remove.is_empty() {
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &remove, &running)?;
    }

    for (rel, bytes) in &tree.files {
        let dest = format!("tf/custom/{id}/{rel}");
        put_exclusive_file_to(profiles_dir, tf2_root, profile_id, &dest, bytes, &running)?;
    }

    manifest = load_manifest(profiles_dir, profile_id)?;
    let mut stored = record;
    stored.id = id.clone();
    manifest.hud = Some(stored);
    save_manifest(profiles_dir, tf2_root, &manifest, &running)?;

    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() == Some(profile_id) {
        apply_hud_replace_live(tf2_root, profiles_dir, profile_id, &id, &previous)?;
    }
    profile_detail_fallback(profiles_dir, tf2_root, profile_id)
}

pub fn match_hud_catalog(
    tf2_root: &Path,
    profile_id: &str,
    id: &str,
    hash: Option<String>,
) -> Result<ProfileDetail, ProfileError> {
    match_hud_catalog_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        id,
        hash,
        live_process_names(),
    )
}

pub fn match_hud_catalog_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    id: &str,
    hash: Option<String>,
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
    let id = sanitize_hud_id(id)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let options = manifest
        .hud
        .as_ref()
        .map(|hud| hud.options.clone())
        .unwrap_or_default();
    manifest.hud = Some(HudRecord {
        id,
        hash,
        source: HudSource::HudDb,
        options,
    });
    save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
    profile_detail_fallback(profiles_dir, tf2_root, profile_id)
}

pub fn load_hud_tree_from_profile(
    profiles_dir: &Path,
    profile_id: &str,
    hud_id: &str,
) -> Result<HudTree, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let prefix = format!("tf/custom/{hud_id}/");
    let mut tree = HudTree::default();
    for file in &manifest.files {
        let Some(rel) = file.path.strip_prefix(&prefix) else {
            continue;
        };
        let source = exclusive_file_path(profiles_dir, profile_id, &file.path);
        let bytes = fs::read(&source).map_err(|err| ProfileError::Io(err.to_string()))?;
        tree.insert(rel, bytes);
    }
    if tree.files.is_empty() {
        return Err(ProfileError::Io(
            "That profile has no HUD files to edit.".into(),
        ));
    }
    Ok(tree)
}

pub fn write_hud_tree_files(
    tf2_root: &Path,
    profile_id: &str,
    hud_id: &str,
    tree: &HudTree,
    cfg_writes: &[(String, Vec<u8>)],
) -> Result<ProfileDetail, ProfileError> {
    write_hud_tree_files_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        hud_id,
        tree,
        cfg_writes,
        live_process_names(),
    )
}

pub fn write_hud_tree_files_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    hud_id: &str,
    tree: &HudTree,
    cfg_writes: &[(String, Vec<u8>)],
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
    let mut last = None;
    for (rel, bytes) in &tree.files {
        let dest = format!("tf/custom/{hud_id}/{rel}");
        last = Some(write_owned_file_to(
            profiles_dir,
            tf2_root,
            profile_id,
            &dest,
            bytes,
            &running,
            crate::apply::WriteOwnedOptions::default(),
        )?);
    }
    for (rel, bytes) in cfg_writes {
        last = Some(write_owned_file_to(
            profiles_dir,
            tf2_root,
            profile_id,
            rel,
            bytes,
            &running,
            crate::apply::WriteOwnedOptions::default(),
        )?);
    }
    last.ok_or_else(|| ProfileError::Io("No HUD files to write.".into()))
}

pub fn apply_schema_options(
    tf2_root: &Path,
    profile_id: &str,
    schema: &crate::hud_apply::HudSchema,
    options: BTreeMap<String, String>,
) -> Result<ProfileDetail, ProfileError> {
    apply_schema_options_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        schema,
        options,
        live_process_names(),
    )
}

pub fn apply_schema_options_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    schema: &crate::hud_apply::HudSchema,
    options: BTreeMap<String, String>,
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
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let status = resolve_hud(&manifest)
        .ok_or_else(|| ProfileError::Io("Install a HUD before saving options.".into()))?;
    let mut tree = load_hud_tree_from_profile(profiles_dir, profile_id, &status.record.id)?;
    let applied =
        crate::hud_apply::apply_hud_options(&mut tree, schema, &status.record.id, &options)?;
    write_hud_tree_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &status.record.id,
        &tree,
        &applied.cfg_writes,
        &running,
    )?;
    set_hud_options_to(profiles_dir, tf2_root, profile_id, options, &running)
}

pub fn set_hud_options(
    tf2_root: &Path,
    profile_id: &str,
    options: BTreeMap<String, String>,
) -> Result<ProfileDetail, ProfileError> {
    set_hud_options_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        options,
        live_process_names(),
    )
}

pub fn set_hud_options_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    options: BTreeMap<String, String>,
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
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let Some(hud) = manifest.hud.as_mut() else {
        return Err(ProfileError::Io(
            "Install a HUD before saving options.".into(),
        ));
    };
    hud.options = options;
    save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
    profile_detail_fallback(profiles_dir, tf2_root, profile_id)
}

fn profile_detail_fallback(
    profiles_dir: &Path,
    _tf2_root: &Path,
    profile_id: &str,
) -> Result<ProfileDetail, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    Ok(detail_from_manifest(&manifest))
}

fn apply_hud_replace_live(
    tf2_root: &Path,
    profiles_dir: &Path,
    profile_id: &str,
    new_id: &str,
    previous: &[String],
) -> Result<(), ProfileError> {
    for pack in previous {
        remove_live_pack(tf2_root, pack)?;
    }
    for live in live_hud_names(tf2_root) {
        if live != new_id {
            dash_live_hud(tf2_root, &live)?;
        }
    }
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let prefix = format!("tf/custom/{new_id}/");
    for file in &manifest.files {
        if !file.path.starts_with(&prefix) {
            continue;
        }
        let source = exclusive_file_path(profiles_dir, profile_id, &file.path);
        let dest = live_path(tf2_root, &file.path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|err| ProfileError::Io(err.to_string()))?;
        }
        fs::copy(&source, &dest).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

fn remove_live_pack(tf2_root: &Path, pack: &str) -> Result<(), ProfileError> {
    for name in [pack.to_string(), format!("-{pack}")] {
        let dir = tf2_root.join("tf").join("custom").join(name);
        if dir.is_dir() {
            fs::remove_dir_all(&dir).map_err(|err| ProfileError::Io(err.to_string()))?;
        }
    }
    Ok(())
}

fn dash_live_hud(tf2_root: &Path, pack: &str) -> Result<(), ProfileError> {
    let custom = tf2_root.join("tf").join("custom");
    let enabled = custom.join(pack);
    let disabled = custom.join(format!("-{pack}"));
    if enabled.is_dir() && !disabled.exists() {
        fs::rename(&enabled, &disabled).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

fn live_path(tf2_root: &Path, rel: &str) -> PathBuf {
    let mut path = tf2_root.to_path_buf();
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn sanitize_zip_entry(raw: &str) -> Result<String, ProfileError> {
    if raw.contains('\0') {
        return Err(ProfileError::InvalidPath);
    }
    let name = raw.replace('\\', "/");
    let name = name.trim_start_matches("./");
    if name.starts_with('/') {
        return Err(ProfileError::InvalidPath);
    }
    let mut chars = name.chars();
    if let (Some(drive), Some(':')) = (chars.next(), chars.next()) {
        if drive.is_ascii_alphabetic() {
            return Err(ProfileError::InvalidPath);
        }
    }
    let parts: Vec<&str> = name.split('/').filter(|part| !part.is_empty()).collect();
    if parts.iter().any(|part| *part == "." || *part == "..") {
        return Err(ProfileError::InvalidPath);
    }
    if parts.is_empty() {
        return Err(ProfileError::InvalidPath);
    }
    Ok(parts.join("/"))
}

fn strip_wrapper_folder(entries: Vec<(String, Vec<u8>)>) -> Vec<(String, Vec<u8>)> {
    let mut first: Option<String> = None;
    for (path, _) in &entries {
        let Some(root) = path.split('/').next() else {
            return entries;
        };
        match &first {
            None => first = Some(root.to_string()),
            Some(expected) if expected == root => {}
            _ => return entries,
        }
    }
    let Some(wrapper) = first else {
        return entries;
    };
    if wrapper.eq_ignore_ascii_case("info.vdf") {
        return entries;
    }
    let prefix = format!("{wrapper}/");
    let mut stripped = Vec::new();
    for (path, bytes) in entries {
        if let Some(rest) = path.strip_prefix(&prefix) {
            if !rest.is_empty() {
                stripped.push((rest.to_string(), bytes));
            }
        }
    }
    stripped
}

fn parse_ui_version(text: &str) -> Option<u32> {
    let vdf = parse_vdf(text).ok()?;
    for (_, value) in &vdf.entries {
        if let Some(version) = value.as_str() {
            if let Ok(parsed) = version.parse() {
                return Some(parsed);
            }
        }
        if let Some(obj) = value.as_obj() {
            if let Some(version) = obj.get("ui_version").and_then(VdfValue::as_str) {
                return version.parse().ok();
            }
        }
    }
    None
}

pub(crate) fn normalize_hud_rel(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .trim_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apply::WriteOwnedOptions;
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::test_temp_dir;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

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

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            for (name, bytes) in entries {
                zip.start_file(*name, options).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    fn info_vdf() -> &'static [u8] {
        br#""rayshud"
{
	"ui_version"		"3"
}
"#
    }

    #[test]
    fn extract_strips_wrapper_and_reads_ui_version() {
        let bytes = zip_bytes(&[
            ("rayshud-abc/info.vdf", info_vdf()),
            ("rayshud-abc/resource/ui/hudlayout.res", b"hud\n"),
        ]);
        let extracted = extract_hud_zip(&bytes).unwrap();
        assert_eq!(extracted.ui_version, Some(3));
        assert_eq!(extracted.tree.get("info.vdf"), Some(info_vdf()));
        assert_eq!(
            extracted.tree.get("resource/ui/hudlayout.res"),
            Some(b"hud\n".as_slice())
        );
    }

    #[test]
    fn extract_rejects_zip_slip_and_missing_info() {
        let slip = zip_bytes(&[("../evil.txt", b"nope\n")]);
        assert!(matches!(
            extract_hud_zip(&slip),
            Err(ProfileError::InvalidPath)
        ));
        let missing = zip_bytes(&[("wrapper/resource/ui/hudlayout.res", b"hud\n")]);
        let err = extract_hud_zip(&missing).unwrap_err();
        assert!(matches!(err, ProfileError::Io(message) if message.contains("info.vdf")));
    }

    #[test]
    fn catalog_entry_marks_github_and_toonhud() {
        let rays = catalog_entry_from_json(
            "rayshud",
            r#"{"name":"rayshud","author":"raysfire","repo":"https://github.com/raysfire/rayshud","hash":"abc123","resources":["banner"]}"#,
        )
        .unwrap();
        assert!(rays.github);
        assert_eq!(
            hud_zip_url(&rays.repo, &rays.hash).as_deref(),
            Some("https://codeload.github.com/raysfire/rayshud/legacy.zip/abc123")
        );
        assert_eq!(
            rays.banner.as_deref(),
            Some("https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-resources/rayshud/banner.webp")
        );
        let toon = catalog_entry_from_json(
            "toonhud",
            r#"{"name":"ToonHUD","author":"toonhud","repo":"https://toonhud.com/","hash":"11.4"}"#,
        )
        .unwrap();
        assert!(!toon.github);
        assert!(hud_zip_url(&toon.repo, &toon.hash).is_none());
        assert!(toon.screenshots.is_empty());
        assert_eq!(toon.album, None);
    }

    #[test]
    fn catalog_entry_collects_screenshots_and_skips_video_urls() {
        let entry = catalog_entry_from_json(
            "budhud",
            r#"{"name":"budhud","author":"whisker","repo":"https://github.com/rbjaxter/budhud","hash":"def456","resources":["https://youtu.be/abc","menu","hud-minmode"],"social":{"album":"https://imgur.com/a/vsxPG"}}"#,
        )
        .unwrap();
        // The first resource is a video URL — the banner must skip it.
        assert_eq!(
            entry.banner.as_deref(),
            Some("https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-resources/budhud/menu.webp")
        );
        assert_eq!(
            entry.screenshots,
            vec![
                "https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-resources/budhud/menu.webp",
                "https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-resources/budhud/hud-minmode.webp",
            ]
        );
        assert_eq!(entry.album.as_deref(), Some("https://imgur.com/a/vsxPG"));
    }

    #[test]
    fn install_replaces_previous_hud_and_dashes_stray() {
        let dir = test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(&dir);
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/custom/oldhud/info.vdf",
            b"old\n",
            unlocked(),
        )
        .unwrap();
        write_owned_file_to(
            &profiles,
            &root,
            &id,
            "tf/custom/oldhud/info.vdf",
            b"old\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap();
        fs::create_dir_all(root.join("tf/custom/stray/resource/ui")).unwrap();
        fs::write(
            root.join("tf/custom/stray/resource/ui/hudlayout.res"),
            b"x\n",
        )
        .unwrap();

        let mut tree = HudTree::default();
        tree.insert("info.vdf", info_vdf().to_vec());
        tree.insert("resource/ui/hudlayout.res", b"new\n".to_vec());
        let detail = install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &tree,
            HudRecord {
                id: "rayshud".into(),
                hash: Some("abc123".into()),
                source: HudSource::HudDb,
                options: BTreeMap::new(),
            },
            unlocked(),
        )
        .unwrap();
        assert_eq!(
            detail.hud.as_ref().map(|hud| hud.id.as_str()),
            Some("rayshud")
        );
        assert!(!detail
            .files
            .iter()
            .any(|file| file.path.starts_with("tf/custom/oldhud/")));
        assert_eq!(
            fs::read(root.join("tf/custom/rayshud/resource/ui/hudlayout.res")).unwrap(),
            b"new\n"
        );
        assert!(!root.join("tf/custom/oldhud").exists());
        assert!(root
            .join("tf/custom/-stray/resource/ui/hudlayout.res")
            .is_file());
        cleanup(&dir);
    }

    #[test]
    fn infer_local_hud_and_match_catalog() {
        let dir = test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(&dir);
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();
        put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/custom/budhud/info.vdf",
            info_vdf(),
            unlocked(),
        )
        .unwrap();
        let manifest = load_manifest(&profiles, &id).unwrap();
        let status = resolve_hud(&manifest).unwrap();
        assert!(status.inferred);
        assert_eq!(status.record.id, "budhud");
        assert_eq!(status.record.source, HudSource::Local);

        let detail = match_hud_catalog_to(
            &profiles,
            &root,
            &id,
            "budhud",
            Some("def456".into()),
            unlocked(),
        )
        .unwrap();
        assert_eq!(detail.hud.as_ref().unwrap().source, HudSource::HudDb);
        assert_eq!(detail.hud.as_ref().unwrap().hash.as_deref(), Some("def456"));
        cleanup(&dir);
    }

    #[test]
    fn install_refuses_while_running() {
        let dir = test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(&dir);
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();
        let mut tree = HudTree::default();
        tree.insert("info.vdf", info_vdf().to_vec());
        let err = install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &tree,
            HudRecord {
                id: "rayshud".into(),
                hash: None,
                source: HudSource::HudDb,
                options: BTreeMap::new(),
            },
            [tf2_name()],
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        cleanup(&dir);
    }

    #[test]
    fn persist_options_and_reapply_after_update() {
        let dir = test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(&dir);
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();

        let mut tree = HudTree::default();
        tree.insert("info.vdf", info_vdf().to_vec());
        tree.insert(
            "resource/clientscheme_colors.res",
            b"\"Scheme\"\n{\n\t\"Colors\"\n\t{\n\t\t\"bh_Health_Buff\"\t\t\"255 0 0 255\"\n\t}\n}\n"
                .to_vec(),
        );
        tree.insert("#customization/minmode.res", b"off\n".to_vec());
        let mut options = BTreeMap::new();
        options.insert("bh_Health_Buff".into(), "0 153 255 255".into());
        options.insert("minmode".into(), "true".into());
        install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &tree,
            HudRecord {
                id: "budhud".into(),
                hash: Some("old".into()),
                source: HudSource::HudDb,
                options: options.clone(),
            },
            unlocked(),
        )
        .unwrap();

        let schema = crate::hud_apply::parse_hud_schema(
            r##"{
  "Author": "Test",
  "CustomizationsFolder": "#customization",
  "EnabledFolder": "#customization//_enabled",
  "Controls": {
    "Colors": [
      {
        "Name": "bh_Health_Buff",
        "Type": "ColorPicker",
        "Value": "0 153 255 255",
        "Files": {
          "resource/clientscheme_colors.res": {
            "Scheme": { "Colors": { "bh_Health_Buff": "$value" } }
          }
        }
      }
    ],
    "Extras": [
      {
        "Name": "minmode",
        "Type": "CheckBox",
        "Value": "false",
        "FileName": "minmode.res",
        "WriteCfg": {
          "FileName": "hud_minmode.cfg",
          "TrueText": "cl_hud_minmode 1\n",
          "FalseText": "cl_hud_minmode 0\n"
        }
      }
    ]
  }
}"##,
        )
        .unwrap();
        apply_schema_options_to(&profiles, &root, &id, &schema, options.clone(), unlocked())
            .unwrap();

        let mut fresh = HudTree::default();
        fresh.insert("info.vdf", info_vdf().to_vec());
        fresh.insert(
            "resource/clientscheme_colors.res",
            b"\"Scheme\"\n{\n\t\"Colors\"\n\t{\n\t\t\"bh_Health_Buff\"\t\t\"255 0 0 255\"\n\t}\n}\n"
                .to_vec(),
        );
        fresh.insert("#customization/minmode.res", b"off\n".to_vec());
        crate::hud_apply::apply_hud_options(&mut fresh, &schema, "budhud", &options).unwrap();
        install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &fresh,
            HudRecord {
                id: "budhud".into(),
                hash: Some("new".into()),
                source: HudSource::HudDb,
                options: options.clone(),
            },
            unlocked(),
        )
        .unwrap();
        apply_schema_options_to(&profiles, &root, &id, &schema, options, unlocked()).unwrap();

        let colors =
            fs::read_to_string(root.join("tf/custom/budhud/resource/clientscheme_colors.res"))
                .unwrap();
        assert!(colors.contains("0 153 255 255"));
        assert_eq!(
            fs::read(root.join("tf/cfg/budhud/hud_minmode.cfg")).unwrap(),
            b"cl_hud_minmode 1\n"
        );
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert_eq!(manifest.hud.as_ref().unwrap().hash.as_deref(), Some("new"));
        assert_eq!(
            manifest
                .hud
                .as_ref()
                .unwrap()
                .options
                .get("minmode")
                .map(String::as_str),
            Some("true")
        );
        cleanup(&dir);
    }
}
