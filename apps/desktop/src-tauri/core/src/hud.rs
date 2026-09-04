//! HUD pack detection, zip extract, catalog helpers, and one-HUD install.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::absorb::pack_key;
use crate::apply::{
    detail_from_manifest, read_profile_file_from, write_owned_file_to, ProfileDetail,
    WriteOwnedOptions,
};
use crate::archive::{
    extract_archive, extract_zip, read_dir_entries, read_regular_file_bounded,
    read_regular_file_bounded_within, validate_imported_cfg, ArchiveLimits,
};
use crate::hash::{metadata_is_link, random_token, validate_dir_within};
#[cfg(all(test, unix))]
use crate::hash::{remove_dir_within, remove_file_force_within, validate_file_within};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, is_file_safe_rel_path, load_library_from, load_manifest,
    mutate_profile_files_to, mutate_profile_files_with_live_renames_to, normalize_rel_path,
    profiles_dir, save_manifest, FileSource, HudRecord, HudSource, ProfileError, ProfileFile,
    ProfileLiveProjection, ProfileLiveRename, ProfileManifest,
};
use crate::settings::execs_data_dir;
use crate::switch::prune_empty_parents;
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
const MAX_HUD_CATALOG_CACHE_BYTES: u64 = 16 * 1024 * 1024;

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

    /// `get` without caring about ASCII case. HUD authors spell `Info.vdf`
    /// and `Resource/UI` however they like; the game does not care and neither
    /// should detection.
    pub fn get_ignore_case(&self, path: &str) -> Option<&[u8]> {
        let wanted = normalize_hud_rel(path);
        self.files
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(&wanted))
            .map(|(_, bytes)| bytes.as_slice())
    }

    /// The root `info.vdf`, however it is capitalized.
    pub fn info_vdf(&self) -> Option<&[u8]> {
        self.get_ignore_case("info.vdf")
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
    /// How the app can fetch this HUD's files (derived from `repo`'s host).
    /// `none` means the author's page is the only route.
    #[serde(default)]
    pub install: HudInstallKind,
    pub flags: Vec<String>,
    pub banner: Option<String>,
    /// Full-size screenshot URLs from hud-db's `resources` (image names only).
    #[serde(default)]
    pub screenshots: Vec<String>,
    /// Optional external album page (e.g. Imgur) from hud-db's `social.album`.
    #[serde(default)]
    pub album: Option<String>,
    pub comfig_url: String,
}

/// Where a HUD's archive comes from. hud-db's `repo` is only validated as an
/// https URL: 241 entries are GitHub repos, 26 are direct Dropbox `.7z`
/// links, 27 are GameBanana mod pages whose public API lists the file, and a
/// few are forum threads that link a Dropbox file. The rest have no
/// mechanical route.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HudInstallKind {
    Github,
    Direct,
    Gamebanana,
    Thread,
    #[default]
    None,
}

impl HudInstallKind {
    pub fn from_repo(repo: &str) -> Self {
        if is_github_hud_repo(repo) {
            return Self::Github;
        }
        let lower = repo.trim().to_ascii_lowercase();
        let host = lower
            .strip_prefix("https://")
            .and_then(|rest| rest.split('/').next())
            .unwrap_or("");
        match host {
            "www.dropbox.com" | "dropbox.com" | "dl.dropboxusercontent.com" => Self::Direct,
            "gamebanana.com" | "www.gamebanana.com" if lower.contains("/mods/") => Self::Gamebanana,
            "www.teamfortress.tv" | "teamfortress.tv" => Self::Thread,
            _ => Self::None,
        }
    }

    pub fn installable(self) -> bool {
        !matches!(self, Self::None)
    }
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

/// A folder is a HUD when it carries `info.vdf` or `resource/ui/`, spelled in
/// any case: `Info.vdf` and `Resource/UI` are common, and on Linux a
/// case-sensitive `join("info.vdf")` misses them.
pub fn is_hud_dir(path: &Path) -> bool {
    if dir_entry_ignore_case(path, "info.vdf").is_some_and(|file| file.is_file()) {
        return true;
    }
    dir_entry_ignore_case(path, "resource")
        .filter(|dir| dir.is_dir())
        .and_then(|dir| dir_entry_ignore_case(&dir, "ui"))
        .is_some_and(|dir| dir.is_dir())
}

/// The path of `dir/<name>` with whatever ASCII case it has on disk.
fn dir_entry_ignore_case(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    entries
        .flatten()
        .find(|entry| {
            fs::symlink_metadata(entry.path()).is_ok_and(|meta| !metadata_is_link(&meta))
                && entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(name)
        })
        .map(|entry| entry.path())
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

/// A HUD folder found in `tf/custom/`. `name` is the folder as it is spelled
/// on disk — the lowercased `key` alone is not enough to open it on a
/// case-sensitive filesystem, which is how a stray `RaysHUD` stayed mounted
/// next to a newly installed HUD on Linux.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveHud {
    /// Folder name exactly as it appears in `tf/custom/`, disable prefix and all.
    pub name: String,
    /// Lowercased, `-`-stripped identity used to compare against a manifest.
    pub key: String,
}

/// Every HUD folder in `tf/custom/`, one entry per on-disk spelling. `foo`
/// and `-foo` (or `RaysHUD` and `rayshud` on Linux) share a key but are
/// different folders, and each needs handling: deduping on key in directory
/// order used to keep whichever came first — `-foo` sorts before `foo` on
/// NTFS — so the mounted `foo` was dropped and never dashed.
pub fn live_hud_names(tf2_root: &Path) -> Vec<LiveHud> {
    let custom = tf2_root.join("tf").join("custom");
    let Ok(meta) = fs::symlink_metadata(&custom) else {
        return Vec::new();
    };
    if metadata_is_link(&meta) || !meta.is_dir() {
        return Vec::new();
    }
    if validate_dir_within(tf2_root, &custom).is_err() {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&custom) else {
        return Vec::new();
    };
    let mut huds: Vec<LiveHud> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata_is_link(&meta)
            || !meta.is_dir()
            || validate_dir_within(tf2_root, &path).is_err()
            || !is_hud_dir(&path)
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let key = name
            .strip_prefix('-')
            .unwrap_or(name.as_str())
            .to_ascii_lowercase();
        if key.is_empty() {
            continue;
        }
        huds.push(LiveHud { name, key });
    }
    // Enabled folders first so a caller that stops at the first match per key
    // sees the one the game actually mounts.
    huds.sort_by_key(|hud| hud.name.starts_with('-'));
    huds
}

/// Just the identities, deduped, for callers comparing against a manifest.
pub fn live_hud_keys(tf2_root: &Path) -> Vec<String> {
    let mut keys: Vec<String> = Vec::new();
    for hud in live_hud_names(tf2_root) {
        if !keys.contains(&hud.key) {
            keys.push(hud.key);
        }
    }
    keys
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
    let rest = trimmed.strip_prefix("https://github.com/")?;
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
    let repo = parsed.repo.trim().to_string();
    if !repo.starts_with("https://") {
        return Err(ProfileError::Io("HUD catalog links must use HTTPS.".into()));
    }
    let hash = match parsed.hash {
        serde_json::Value::String(text) => text,
        serde_json::Value::Number(number) => number.to_string(),
        _ => String::new(),
    };
    let id = sanitize_hud_id(id)?;
    // `resources` mixes image names with full video URLs — only names are
    // hud-db-hosted webp screenshots.
    // The name is interpolated straight into a URL the frontend loads as an
    // <img>, so it is an allowlist, not a `://` filter: `../` or a `?`/`#`
    // would point the request somewhere else entirely.
    let screenshots: Vec<String> = parsed
        .resources
        .iter()
        .filter(|name| is_safe_screenshot_name(name))
        .map(|name| format!("{RAW_HUD_DB}/hud-resources/{id}/{name}.webp"))
        .collect();
    let banner = screenshots.first().cloned();
    let album = parsed
        .social
        .and_then(|social| social.album)
        .filter(|album| album.starts_with("https://"));
    Ok(HudCatalogEntry {
        comfig_url: format!("https://comfig.app/huds/page/{id}/"),
        github: is_github_hud_repo(&repo),
        install: HudInstallKind::from_repo(&repo),
        id,
        name: parsed.name,
        author: parsed.author,
        repo,
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
    // v3: entries gained the install kind; old caches are ignored and refetched.
    dir.join("catalog-v3.json")
}

pub fn load_catalog_cache_from(dir: &Path) -> Option<HudCatalogCache> {
    let bytes =
        read_regular_file_bounded(&catalog_cache_file(dir), MAX_HUD_CATALOG_CACHE_BYTES).ok()??;
    serde_json::from_slice(&bytes).ok()
}

pub fn save_catalog_cache_to(dir: &Path, cache: &HudCatalogCache) -> Result<(), ProfileError> {
    fs::create_dir_all(dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    let json =
        serde_json::to_string_pretty(cache).map_err(|err| ProfileError::Io(err.to_string()))?;
    let bytes = format!("{json}\n").into_bytes();
    if bytes.len() as u64 > MAX_HUD_CATALOG_CACHE_BYTES {
        return Err(ProfileError::Io(
            "The HUD catalog is too large to cache.".into(),
        ));
    }
    crate::hash::write_atomic(&catalog_cache_file(dir), &bytes)
        .map_err(|err| ProfileError::Io(err.to_string()))
}

/// Ceilings on a HUD zip. The bytes come from a `codeload.github.com` URL
/// whose owner/repo/commit all come from hud-db JSON, and the whole archive is
/// held in memory while it is extracted, so without a ceiling a zip bomb or a
/// merely enormous repo takes the app down.
const MAX_HUD_ENTRIES: usize = 20_000;
const MAX_HUD_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_HUD_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

pub(crate) const HUD_LIMITS: ArchiveLimits =
    ArchiveLimits::new(MAX_HUD_ENTRIES, MAX_HUD_ENTRY_BYTES, MAX_HUD_TOTAL_BYTES);

/// A HUD from a folder on disk (an extracted download, or one the user
/// built), read under the same caps as an archive and with the same
/// wrapper-folder stripping. `sound.cache`, VCS metadata and OS junk are
/// left behind.
pub fn hud_tree_from_dir(dir: &Path) -> Result<ExtractedHud, ProfileError> {
    finish_extracted(read_dir_entries(dir, HUD_LIMITS)?)
}

/// A folder name for a HUD imported from the user's own files, from the
/// archive or folder it came from: lowercased, invalid characters folded to
/// dashes, archive extensions dropped, never empty or leading-dash.
pub fn hud_id_from_name(name: &str) -> String {
    let stem = name
        .trim()
        .trim_end_matches(".zip")
        .trim_end_matches(".7z")
        .trim_end_matches(".ZIP")
        .trim_end_matches(".7Z");
    let mut id = String::new();
    let mut last_dash = true;
    for ch in stem.chars() {
        let ch = ch.to_ascii_lowercase();
        if ch.is_ascii_alphanumeric() || ch == '_' {
            id.push(ch);
            last_dash = false;
        } else if !last_dash {
            id.push('-');
            last_dash = true;
        }
    }
    let id = id.trim_matches('-').to_string();
    if id.is_empty() {
        "custom-hud".to_string()
    } else {
        id
    }
}

/// A HUD archive of whatever kind the host handed back: zip (GitHub,
/// GameBanana), 7z (every Dropbox entry) — sniffed by magic, never by the
/// URL's extension. RAR is named in the error so the user knows why.
pub fn extract_hud_archive(bytes: &[u8]) -> Result<ExtractedHud, ProfileError> {
    finish_extracted(extract_archive(bytes, HUD_LIMITS)?)
}

fn finish_extracted(raw: Vec<(String, Vec<u8>)>) -> Result<ExtractedHud, ProfileError> {
    let stripped = strip_wrapper_folder(raw);
    let mut tree = HudTree::default();
    for (path, data) in stripped {
        if path
            .rsplit('.')
            .next()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("cfg"))
        {
            validate_imported_cfg(&format!("tf/custom/imported-hud/{path}"), &data)?;
        }
        tree.insert(path, data);
    }
    let Some(info) = tree.info_vdf() else {
        return Err(ProfileError::Io(
            "That archive is not a HUD (missing info.vdf at the root).".into(),
        ));
    };
    let ui_version = std::str::from_utf8(info).ok().and_then(parse_ui_version);
    Ok(ExtractedHud { tree, ui_version })
}

pub fn extract_hud_zip(bytes: &[u8]) -> Result<ExtractedHud, ProfileError> {
    finish_extracted(extract_zip(bytes, HUD_LIMITS)?)
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
            id: packs.into_iter().next()?.to_ascii_lowercase(),
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
    install_hud_pack_with_cfgs_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        tree,
        record,
        &[],
        live_process_names(),
    )
}

/// Install a prepared HUD tree and its schema-generated cfg files as one
/// payload/metadata/live transaction. The matching autoexec lines are derived
/// from `cfg_writes`, so a caller cannot inject an arbitrary exec target.
pub fn install_hud_pack_with_cfgs(
    tf2_root: &Path,
    profile_id: &str,
    tree: &HudTree,
    record: HudRecord,
    cfg_writes: &[(String, Vec<u8>)],
) -> Result<ProfileDetail, ProfileError> {
    install_hud_pack_with_cfgs_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        tree,
        record,
        cfg_writes,
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
    install_hud_pack_with_cfgs_to(
        profiles_dir,
        tf2_root,
        profile_id,
        tree,
        record,
        &[],
        running_names,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn install_hud_pack_with_cfgs_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    tree: &HudTree,
    record: HudRecord,
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
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let id = sanitize_hud_id(&record.id)?;
    if tree.info_vdf().is_none() {
        return Err(ProfileError::Io(
            "That zip is not a HUD (missing info.vdf at the root).".into(),
        ));
    }
    // Every destination is checked before the old HUD is touched: a bad entry
    // name must fail here, not after the previous HUD is already gone.
    let mut batch: Vec<(String, FileSource<'_>)> = Vec::with_capacity(tree.files.len());
    for (rel, bytes) in &tree.files {
        let path = normalize_rel_path(&format!("tf/custom/{id}/{rel}"))?;
        if !is_file_safe_rel_path(&path) {
            return Err(ProfileError::ForbiddenPath(path));
        }
        batch.push((path, FileSource::Bytes(bytes)));
    }

    let manifest = load_manifest(profiles_dir, profile_id)?;
    let mut exec_stems = Vec::with_capacity(cfg_writes.len());
    for (rel, bytes) in cfg_writes {
        let path = normalize_rel_path(rel)?;
        if !is_managed_hud_cfg(&path) {
            return Err(ProfileError::ForbiddenPath(path));
        }
        validate_imported_cfg(&path, bytes)?;
        let stem = Path::new(&path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or(ProfileError::InvalidPath)?;
        exec_stems.push(stem.to_string());
        batch.push((path, FileSource::Bytes(bytes)));
    }
    exec_stems.sort();
    exec_stems.dedup();
    let autoexec =
        prepare_hud_autoexec_update(profiles_dir, tf2_root, profile_id, &manifest, &exec_stems)?;
    if let Some((path, bytes)) = &autoexec {
        batch.push((path.clone(), FileSource::Bytes(bytes)));
    }
    let previous = hud_packs(&manifest.files);
    let mut remove: Vec<String> = manifest
        .files
        .iter()
        .filter(|file| {
            pack_key(&file.path).is_some_and(|pack| previous.iter().any(|hud| hud == &pack))
        })
        .map(|file| file.path.clone())
        .collect();
    // The previous HUD's option cfgs mean nothing to the new files. Callers
    // that apply options write the new set right after this returns.
    remove.extend(
        manifest
            .files
            .iter()
            .filter(|file| is_managed_hud_cfg(&file.path))
            .map(|file| file.path.clone()),
    );
    remove.sort();
    remove.dedup();

    let active = load_library_from(profiles_dir, Some(tf2_root))?
        .active_profile_id
        .as_deref()
        == Some(profile_id);
    // Disable every currently mounted HUD before publishing the replacement.
    // The renames preserve the exact old trees (including untracked files) and
    // keep the transaction's live destinations clear, so it never merges a
    // new HUD into a stray or differently-cased folder.
    let live_renames = if active {
        plan_live_hud_renames(tf2_root, &id)?
    } else {
        Vec::new()
    };

    let mut stored = record;
    stored.id = id.clone();
    let manifest = mutate_profile_files_with_live_renames_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &batch,
        &remove,
        &live_renames,
        &running,
        move |manifest| {
            manifest.hud = Some(stored);
            Ok(())
        },
    )?;

    if active {
        for path in &remove {
            prune_empty_parents(&live_path(tf2_root, path), tf2_root);
        }
    }
    Ok(detail_from_manifest(&manifest))
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
    let mut tree = HudTree::default();
    let mut total = 0u64;
    for file in &manifest.files {
        let Some(rel) = hud_file_rel(&file.path, hud_id) else {
            continue;
        };
        if tree.files.len() >= MAX_HUD_ENTRIES {
            return Err(ProfileError::Io(format!(
                "That profile's HUD has more than {MAX_HUD_ENTRIES} files and cannot be edited safely."
            )));
        }
        let source = exclusive_file_path(profiles_dir, profile_id, &file.path);
        let remaining = MAX_HUD_TOTAL_BYTES.saturating_sub(total);
        let read_cap = remaining.min(MAX_HUD_ENTRY_BYTES);
        let Some(bytes) = read_regular_file_bounded_within(profiles_dir, &source, read_cap)? else {
            if remaining < MAX_HUD_ENTRY_BYTES {
                return Err(ProfileError::Io(format!(
                    "That profile's HUD is larger than {} MiB and cannot be edited safely.",
                    MAX_HUD_TOTAL_BYTES / (1024 * 1024)
                )));
            }
            return Err(ProfileError::Io(format!(
                "{} is larger than {} MiB and cannot be edited safely.",
                file.path,
                MAX_HUD_ENTRY_BYTES / (1024 * 1024)
            )));
        };
        total = total
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| ProfileError::Io("That profile's HUD is too large to edit.".into()))?;
        if total > MAX_HUD_TOTAL_BYTES {
            return Err(ProfileError::Io(
                "That profile's HUD is too large to edit.".into(),
            ));
        }
        tree.insert(rel, bytes);
    }
    if tree.files.is_empty() {
        return Err(ProfileError::Io(
            "That profile has no HUD files to edit.".into(),
        ));
    }
    Ok(tree)
}

/// `rel` inside the HUD folder when `path` belongs to the HUD `hud_id`,
/// matched by identity rather than spelling: the id is lowercased but a
/// manifest keeps the folder as it was on disk (`tf/custom/RaysHUD/...` after
/// an absorb), and a case-sensitive prefix strip saw zero files there.
fn hud_file_rel<'a>(path: &'a str, hud_id: &str) -> Option<&'a str> {
    if !pack_key(path)?.eq_ignore_ascii_case(hud_id) {
        return None;
    }
    let rest = path.strip_prefix("tf/custom/")?;
    let (_, rel) = rest.split_once('/')?;
    (!rel.is_empty()).then_some(rel)
}

/// The folder name the manifest uses for the HUD `hud_id`, as spelled in its
/// paths. `None` when the profile carries no files for that HUD.
pub fn manifest_hud_folder(files: &[ProfileFile], hud_id: &str) -> Option<String> {
    files.iter().find_map(|file| {
        if !pack_key(&file.path)?.eq_ignore_ascii_case(hud_id) {
            return None;
        }
        let rest = file.path.strip_prefix("tf/custom/")?;
        Some(rest.split('/').next()?.to_string())
    })
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
    if manifest.hud.is_none() {
        return Err(ProfileError::Io(
            "Install a HUD before saving options.".into(),
        ));
    }
    let mut tree = load_hud_tree_from_profile(profiles_dir, profile_id, &status.record.id)?;
    // Write back into the folder the manifest already spells, not the
    // lowercased id: `RaysHUD/` and `rayshud/` are two entries on disk on
    // Linux and two manifest paths everywhere.
    let folder = manifest_hud_folder(&manifest.files, &status.record.id)
        .unwrap_or_else(|| status.record.id.clone());
    let layer = crate::apply::cfg_layer_from_files(&manifest.files);
    let applied = crate::hud_apply::apply_hud_options_for_layer(
        &mut tree,
        schema,
        &status.record.id,
        &options,
        layer,
    )?;
    let autoexec = prepare_hud_autoexec_update(
        profiles_dir,
        tf2_root,
        profile_id,
        &manifest,
        &applied.exec_stems,
    )?;

    // Replace the whole HUD tree, every managed option cfg, its autoexec
    // projection, and the option record in one recoverable commit. This also
    // removes files that a FolderSwap option deleted from the in-memory tree.
    let mut remove: Vec<String> = manifest
        .files
        .iter()
        .filter(|file| {
            hud_file_rel(&file.path, &status.record.id).is_some() || is_managed_hud_cfg(&file.path)
        })
        .map(|file| file.path.clone())
        .collect();
    remove.sort();
    remove.dedup();

    let mut puts: Vec<(String, FileSource<'_>)> = Vec::with_capacity(
        tree.files.len() + applied.cfg_writes.len() + usize::from(autoexec.is_some()),
    );
    for (rel, bytes) in &tree.files {
        let path = normalize_rel_path(&format!("tf/custom/{folder}/{rel}"))?;
        if !is_file_safe_rel_path(&path) {
            return Err(ProfileError::ForbiddenPath(path));
        }
        puts.push((path, FileSource::Bytes(bytes)));
    }
    for (rel, bytes) in &applied.cfg_writes {
        let path = normalize_rel_path(rel)?;
        if !is_managed_hud_cfg(&path) {
            return Err(ProfileError::ForbiddenPath(path));
        }
        validate_imported_cfg(&path, bytes)?;
        puts.push((path, FileSource::Bytes(bytes)));
    }
    if let Some((path, bytes)) = &autoexec {
        puts.push((path.clone(), FileSource::Bytes(bytes)));
    }

    let manifest = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &puts,
        &remove,
        ProfileLiveProjection::MirrorIfActive,
        &running,
        move |manifest| {
            let Some(hud) = manifest.hud.as_mut() else {
                return Err(ProfileError::Io(
                    "Install a HUD before saving options.".into(),
                ));
            };
            hud.options = options;
            Ok(())
        },
    )?;
    let active = load_library_from(profiles_dir, Some(tf2_root))?
        .active_profile_id
        .as_deref()
        == Some(profile_id);
    if active {
        for path in &remove {
            prune_empty_parents(&live_path(tf2_root, path), tf2_root);
        }
    }
    Ok(detail_from_manifest(&manifest))
}

/// Keep the managed autoexec executing exactly the HUD option cfgs in `stems`
/// (see `hud_apply::ensure_hud_exec_lines`). The engine resolves `exec` from
/// tf/cfg, so the line is layer-addressed; without it the WriteCfg files the
/// schema produced would never run in game.
pub fn sync_hud_exec_lines(
    tf2_root: &Path,
    profile_id: &str,
    stems: &[String],
) -> Result<(), ProfileError> {
    let running = live_process_names();
    sync_hud_exec_lines_to(&profiles_dir(), tf2_root, profile_id, stems, &running)
}

pub fn sync_hud_exec_lines_to(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    stems: &[String],
    running: &[String],
) -> Result<(), ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let Some((rel, next)) =
        prepare_hud_autoexec_update(profiles_dir, tf2_root, profile_id, &manifest, stems)?
    else {
        return Ok(());
    };
    write_owned_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &rel,
        &next,
        running.iter().cloned(),
        WriteOwnedOptions::default(),
    )?;
    Ok(())
}

fn prepare_hud_autoexec_update(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    manifest: &ProfileManifest,
    stems: &[String],
) -> Result<Option<(String, Vec<u8>)>, ProfileError> {
    let layer = crate::apply::cfg_layer_from_files(&manifest.files);
    let rel = match layer {
        crate::surface::CfgLayer::Comfig => "tf/cfg/overrides/autoexec.cfg",
        crate::surface::CfgLayer::Vanilla => "tf/cfg/autoexec.cfg",
    };
    let existing = match read_profile_file_from(profiles_dir, tf2_root, profile_id, rel) {
        // A non-UTF-8 autoexec is not an empty one: treating it as empty
        // would replace the user's file with a single exec line. With nothing
        // to add it is left exactly as it is.
        Ok(content) if content.binary => {
            if stems.is_empty() {
                return Ok(None);
            }
            return Err(ProfileError::Io(format!(
                "{rel} is not a text file, so HUD option exec lines cannot be added to it."
            )));
        }
        Ok(content) => content.text.unwrap_or_default(),
        // Not in the manifest yet: start from an empty autoexec.
        Err(ProfileError::InvalidPath) => String::new(),
        Err(err) => return Err(err),
    };
    let next = crate::hud_apply::ensure_hud_exec_lines(&existing, layer, stems);
    if next == existing {
        return Ok(None);
    }
    Ok(Some((rel.to_string(), next.into_bytes())))
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

fn is_managed_hud_cfg(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if !lower.ends_with(".cfg") {
        return false;
    }
    matches!(lower.as_str(), _ if lower.starts_with("tf/cfg/"))
        && lower
            .rsplit('/')
            .next()
            .is_some_and(|name| name.starts_with(crate::hud_apply::HUD_CFG_PREFIX))
}

/// Remove every live folder whose identity is `pack`, however it is spelled
/// or dashed on disk. `pack` is a lowercased key; on Linux `join(pack)` would
/// miss the `RaysHUD` folder it names.
#[cfg(all(test, unix))]
fn remove_live_pack(tf2_root: &Path, pack: &str) -> Result<(), ProfileError> {
    let custom = tf2_root.join("tf").join("custom");
    match fs::symlink_metadata(&custom) {
        Ok(meta) if metadata_is_link(&meta) || !meta.is_dir() => {
            return Err(ProfileError::Io(format!(
                "Refusing to traverse a linked or non-directory custom folder: {}",
                custom.display()
            )));
        }
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(ProfileError::Io(err.to_string())),
    }
    validate_dir_within(tf2_root, &custom).map_err(|err| ProfileError::Io(err.to_string()))?;
    let Ok(entries) = fs::read_dir(&custom) else {
        return Ok(());
    };
    let wanted = pack.to_ascii_lowercase();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if pack_key(&format!("tf/custom/{name}")).as_deref() != Some(wanted.as_str()) {
            continue;
        }
        let dir = entry.path();
        let meta = fs::symlink_metadata(&dir).map_err(|err| ProfileError::Io(err.to_string()))?;
        if metadata_is_link(&meta) {
            return Err(ProfileError::Io(format!(
                "Refusing to traverse a linked live HUD folder: {}",
                dir.display()
            )));
        }
        if meta.is_dir() {
            refuse_if_running_among(live_process_names()).map_err(ProfileError::from)?;
            remove_live_tree_within(tf2_root, &dir)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        }
    }
    Ok(())
}

fn plan_live_hud_renames(
    tf2_root: &Path,
    target_id: &str,
) -> Result<Vec<ProfileLiveRename>, ProfileError> {
    let custom = tf2_root.join("tf").join("custom");
    match fs::symlink_metadata(&custom) {
        Ok(meta) if metadata_is_link(&meta) || !meta.is_dir() => {
            return Err(ProfileError::Io(format!(
                "Refusing to traverse a linked or non-directory custom folder: {}",
                custom.display()
            )));
        }
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(ProfileError::Io(err.to_string())),
    }
    validate_dir_within(tf2_root, &custom).map_err(|err| ProfileError::Io(err.to_string()))?;

    let mut huds = Vec::new();
    for entry in fs::read_dir(&custom).map_err(|err| ProfileError::Io(err.to_string()))? {
        let entry = entry.map_err(|err| ProfileError::Io(err.to_string()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('-') {
            continue;
        }
        let is_target = name.eq_ignore_ascii_case(target_id);
        let path = entry.path();
        let meta = fs::symlink_metadata(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        if metadata_is_link(&meta) || !meta.is_dir() {
            if is_target {
                return Err(ProfileError::Io(format!(
                    "Refusing to replace a linked or non-directory HUD destination: {}",
                    path.display()
                )));
            }
            continue;
        }
        validate_dir_within(tf2_root, &path).map_err(|err| ProfileError::Io(err.to_string()))?;
        if is_target || is_hud_dir(&path) {
            huds.push(LiveHud {
                key: name.to_ascii_lowercase(),
                name,
            });
        }
    }
    huds.sort_by(|left, right| left.name.cmp(&right.name));
    huds.iter()
        .map(|hud| plan_live_hud_rename(tf2_root, hud))
        .collect()
}

fn plan_live_hud_rename(tf2_root: &Path, hud: &LiveHud) -> Result<ProfileLiveRename, ProfileError> {
    let custom = tf2_root.join("tf").join("custom");
    let enabled = custom.join(&hud.name);
    if hud.name.starts_with('-') {
        return Err(ProfileError::Io("That HUD is already disabled.".into()));
    }
    match fs::symlink_metadata(&enabled) {
        Ok(meta) if metadata_is_link(&meta) || !meta.is_dir() => {
            return Err(ProfileError::Io(format!(
                "Refusing to traverse a linked or non-directory HUD folder: {}",
                enabled.display()
            )));
        }
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(ProfileError::Io(format!(
                "A live HUD disappeared while preparing its replacement: {}",
                enabled.display()
            )))
        }
        Err(err) => return Err(ProfileError::Io(err.to_string())),
    }
    validate_dir_within(tf2_root, &custom).map_err(|err| ProfileError::Io(err.to_string()))?;
    validate_dir_within(tf2_root, &enabled).map_err(|err| ProfileError::Io(err.to_string()))?;
    let preferred = custom.join(format!("-{}", hud.name));
    let disabled = match fs::symlink_metadata(&preferred) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => preferred,
        Ok(_) => {
            let mut destination = None;
            for _ in 0..8 {
                let candidate = custom.join(format!("-execs-disabled-{}", random_token()));
                match fs::symlink_metadata(&candidate) {
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                        destination = Some(candidate);
                        break;
                    }
                    Ok(_) => {}
                    Err(err) => return Err(ProfileError::Io(err.to_string())),
                }
            }
            destination.ok_or_else(|| {
                ProfileError::Io("Could not reserve a unique disabled HUD folder.".into())
            })?
        }
        Err(err) => return Err(ProfileError::Io(err.to_string())),
    };
    let from = format!("tf/custom/{}", hud.name);
    let to = disabled
        .strip_prefix(tf2_root)
        .map_err(|_| ProfileError::InvalidPath)?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(ProfileLiveRename { from, to })
}

/// Disable one live HUD without deleting a pre-existing disabled twin.
#[cfg(test)]
fn dash_live_hud(tf2_root: &Path, hud: &LiveHud) -> Result<(), ProfileError> {
    if hud.name.starts_with('-') {
        return Ok(());
    }
    let plan = plan_live_hud_rename(tf2_root, hud)?;
    let from = live_path(tf2_root, &plan.from);
    let to = live_path(tf2_root, &plan.to);
    validate_dir_within(tf2_root, &from).map_err(|err| ProfileError::Io(err.to_string()))?;
    match fs::symlink_metadata(&to) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Ok(_) => return Err(ProfileError::Io("Disabled HUD destination exists.".into())),
        Err(err) => return Err(ProfileError::Io(err.to_string())),
    }
    refuse_if_running_among(live_process_names()).map_err(ProfileError::from)?;
    fs::rename(from, to).map_err(|err| ProfileError::Io(err.to_string()))
}

#[cfg(all(test, unix))]
fn validate_live_tree_within(root: &Path, dir: &Path) -> std::io::Result<()> {
    validate_dir_within(root, dir)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)?;
        if metadata_is_link(&meta) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("refusing to traverse a linked HUD path: {}", path.display()),
            ));
        }
        if meta.is_dir() {
            validate_live_tree_within(root, &path)?;
        } else if meta.is_file() {
            validate_file_within(root, &path)?;
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("refusing to remove a special HUD path: {}", path.display()),
            ));
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
fn remove_live_tree_within(root: &Path, dir: &Path) -> std::io::Result<()> {
    // Validate the complete tree before deleting its first child so a linked
    // descendant cannot turn a safe refusal into a partially removed HUD.
    validate_live_tree_within(root, dir)?;
    fn remove_validated(root: &Path, dir: &Path) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            let meta = fs::symlink_metadata(&path)?;
            if meta.is_dir() && !metadata_is_link(&meta) {
                remove_validated(root, &path)?;
            } else {
                remove_file_force_within(root, &path)?;
            }
        }
        remove_dir_within(root, dir)
    }
    remove_validated(root, dir)
}

fn live_path(tf2_root: &Path, rel: &str) -> PathBuf {
    let mut path = tf2_root.to_path_buf();
    for part in rel.split('/') {
        path.push(part);
    }
    path
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
    // Only a wrapper if what is left is itself a HUD. A zip whose entries all
    // live under one real content folder (`resource/`, say) would otherwise
    // have that folder stripped off.
    if !entries
        .iter()
        .filter_map(|(path, _)| path.strip_prefix(&prefix))
        .any(|path| path.eq_ignore_ascii_case("info.vdf"))
    {
        return entries;
    }

    // Move payloads out of the wrapper. HUD archives routinely carry hundreds
    // of MiB, so cloning every Vec here briefly doubled their resident size.
    entries
        .into_iter()
        .filter_map(|(path, bytes)| {
            let rest = path.strip_prefix(&prefix)?;
            (!rest.is_empty()).then(|| (rest.to_string(), bytes))
        })
        .collect()
}

/// hud-db screenshot names are plain file stems. Anything else is refused
/// rather than escaped, because there is no legitimate case for it.
fn is_safe_screenshot_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        && !name.contains("..")
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

    /// A three-file HUD inside a wrapper folder, written with py7zr (LZMA2).
    const HUD_MIN_7Z: &[u8] = include_bytes!("../fixtures/hud-min.7z");

    #[test]
    fn a_7z_hud_archive_unpacks_like_a_zip_with_its_wrapper_stripped() {
        let extracted = extract_hud_archive(HUD_MIN_7Z).unwrap();
        assert_eq!(extracted.ui_version, Some(3));
        assert!(extracted.tree.get("info.vdf").is_some());
        assert!(extracted.tree.get("resource/ui/hudlayout.res").is_some());
        assert_eq!(
            extracted.tree.get("resource/ui/nested/child.res").unwrap(),
            b"#base ../hudlayout.res\n"
        );
        assert_eq!(extracted.tree.files.len(), 3);
    }

    #[test]
    fn archives_are_sniffed_by_magic_and_rar_is_named() {
        let err = extract_hud_archive(b"Rar!\x1a\x07\x01\x00rest").unwrap_err();
        assert!(err.message().contains("RAR"), "{}", err.message());
        let err = extract_hud_archive(b"<!doctype html><html>").unwrap_err();
        assert!(err.message().contains("web page"), "{}", err.message());
        let err = extract_hud_archive(b"garbage").unwrap_err();
        assert!(
            err.message().contains("not a zip or 7z"),
            "{}",
            err.message()
        );
        // A truncated 7z is an error, not a panic.
        assert!(extract_hud_archive(&HUD_MIN_7Z[..40]).is_err());
    }

    #[test]
    fn a_folder_imports_like_an_archive_and_gets_a_safe_id() {
        let root = crate::test_temp_dir();
        let hud = root.join("My HUD (v2)");
        std::fs::create_dir_all(hud.join("resource/ui")).unwrap();
        std::fs::create_dir_all(hud.join(".git")).unwrap();
        std::fs::write(
            hud.join("info.vdf"),
            "\"Root\"\n{\n\t\"ui_version\"\t\"3\"\n}\n",
        )
        .unwrap();
        std::fs::write(hud.join("resource/ui/hudlayout.res"), "x").unwrap();
        std::fs::write(hud.join("sound.cache"), "stale").unwrap();
        std::fs::write(hud.join(".git/HEAD"), "ref").unwrap();
        let extracted = hud_tree_from_dir(&hud).unwrap();
        assert_eq!(extracted.ui_version, Some(3));
        assert_eq!(extracted.tree.files.len(), 2);
        assert!(extracted.tree.get("resource/ui/hudlayout.res").is_some());
        assert!(hud_tree_from_dir(&root.join("missing")).is_err());
        // A folder that is not a HUD is refused by the same rule as an archive.
        let not_hud = root.join("pictures");
        std::fs::create_dir_all(&not_hud).unwrap();
        std::fs::write(not_hud.join("a.png"), "p").unwrap();
        assert!(hud_tree_from_dir(&not_hud).is_err());
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(hud_id_from_name("My HUD (v2).zip"), "my-hud-v2");
        assert_eq!(hud_id_from_name("rayshud-master.7z"), "rayshud-master");
        assert_eq!(hud_id_from_name("--!!"), "custom-hud");
        assert_eq!(hud_id_from_name("flawhud_2024"), "flawhud_2024");
        assert!(sanitize_hud_id(&hud_id_from_name("weird name?")).is_ok());
    }

    #[test]
    fn install_kind_follows_the_repo_host() {
        assert_eq!(
            HudInstallKind::from_repo("https://github.com/raysfire/rayshud"),
            HudInstallKind::Github
        );
        assert_eq!(
            HudInstallKind::from_repo("https://www.dropbox.com/s/x/Hud.7z?dl=1"),
            HudInstallKind::Direct
        );
        assert_eq!(
            HudInstallKind::from_repo("https://gamebanana.com/mods/461758"),
            HudInstallKind::Gamebanana
        );
        assert_eq!(
            HudInstallKind::from_repo("https://gamebanana.com/guis/25711"),
            HudInstallKind::None
        );
        assert_eq!(
            HudInstallKind::from_repo("https://www.teamfortress.tv/53194/arekk-hud"),
            HudInstallKind::Thread
        );
        assert_eq!(
            HudInstallKind::from_repo("https://toonhud.com/"),
            HudInstallKind::None
        );
        assert_eq!(
            HudInstallKind::from_repo("https://steamcommunity.com/groups/axhud"),
            HudInstallKind::None
        );
        assert!(HudInstallKind::Direct.installable());
        assert!(!HudInstallKind::None.installable());
    }

    #[test]
    fn catalog_cache_and_editable_hud_reads_are_bounded() {
        let dir = test_temp_dir();
        let cache = dir.join("catalog");
        fs::create_dir_all(&cache).unwrap();
        fs::File::create(catalog_cache_file(&cache))
            .unwrap()
            .set_len(MAX_HUD_CATALOG_CACHE_BYTES + 1)
            .unwrap();
        assert!(load_catalog_cache_from(&cache).is_none());

        let (profiles, root, id) = active_profile(&dir);
        install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &rays_tree(),
            rays_record(),
            unlocked(),
        )
        .unwrap();
        let source = exclusive_file_path(
            &profiles,
            &id,
            "tf/custom/rayshud/resource/ui/hudlayout.res",
        );
        fs::OpenOptions::new()
            .write(true)
            .open(source)
            .unwrap()
            .set_len(MAX_HUD_ENTRY_BYTES + 1)
            .unwrap();
        let err = load_hud_tree_from_profile(&profiles, &id, "rayshud").unwrap_err();
        assert!(err.message().contains("larger than"), "{err:?}");
        cleanup(&dir);
    }

    use crate::apply::WriteOwnedOptions;
    use crate::profile::{create_profile_record_to, put_exclusive_file_to, set_active_profile_to};
    use crate::test_temp_dir;
    use std::io::{Cursor, Write};
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

    /// AGENTS.md: "At most one HUD folder is mounted." A lowercased key never
    /// matched a mixed-case folder on a case-sensitive filesystem, so the stray
    /// HUD stayed mounted next to the new one.
    #[test]
    fn live_hud_names_keep_the_real_folder_spelling() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let custom = root.join("tf").join("custom");
        fs::create_dir_all(custom.join("RaysHUD").join("resource")).unwrap();
        fs::write(custom.join("RaysHUD").join("info.vdf"), info_vdf()).unwrap();

        let huds = live_hud_names(&root);
        assert_eq!(huds.len(), 1);
        assert_eq!(huds[0].name, "RaysHUD");
        assert_eq!(huds[0].key, "rayshud");

        dash_live_hud(&root, &huds[0]).unwrap();
        assert!(!custom.join("RaysHUD").exists());
        assert!(custom.join("-RaysHUD").is_dir());
        cleanup(&dir);
    }

    /// With both `foo` and `-foo` on disk the game mounts `foo`. Disabling it
    /// must preserve both differing trees instead of deleting either one.
    #[test]
    fn dashing_preserves_both_trees_when_a_disabled_twin_exists() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let custom = root.join("tf").join("custom");
        fs::create_dir_all(custom.join("foo")).unwrap();
        fs::create_dir_all(custom.join("-foo")).unwrap();
        fs::write(custom.join("foo/info.vdf"), b"enabled").unwrap();
        fs::write(custom.join("-foo/info.vdf"), b"already disabled").unwrap();

        let hud = LiveHud {
            name: "foo".into(),
            key: "foo".into(),
        };
        dash_live_hud(&root, &hud).unwrap();
        assert!(!custom.join("foo").exists());
        assert_eq!(
            fs::read(custom.join("-foo/info.vdf")).unwrap(),
            b"already disabled"
        );
        let preserved = fs::read_dir(&custom)
            .unwrap()
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("-execs-disabled-")
            })
            .expect("enabled twin should receive a unique disabled name")
            .path();
        assert_eq!(fs::read(preserved.join("info.vdf")).unwrap(), b"enabled");

        // A folder that is already dashed is left exactly as it is.
        let dashed = LiveHud {
            name: "-foo".into(),
            key: "foo".into(),
        };
        dash_live_hud(&root, &dashed).unwrap();
        assert!(custom.join("-foo").is_dir());
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn live_hud_removal_refuses_linked_trees() {
        use std::os::unix::fs::symlink;

        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let custom = root.join("tf/custom");
        let outside = dir.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.txt"), b"keep").unwrap();

        // A linked pack root must not make remove_live_pack recurse into its
        // target, even when the target looks like a HUD.
        symlink(&outside, custom.join("evil-hud")).unwrap();
        let err = remove_live_pack(&root, "evil-hud").unwrap_err();
        assert!(err.message().contains("linked"), "{err:?}");
        assert_eq!(fs::read(outside.join("keep.txt")).unwrap(), b"keep");

        // Nor may a linked descendant cause a partly removed real HUD tree.
        let real = custom.join("real-hud");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("info.vdf"), info_vdf()).unwrap();
        symlink(outside.join("keep.txt"), real.join("linked.res")).unwrap();
        let err = remove_live_tree_within(&root, &real).unwrap_err();
        assert!(err.to_string().contains("linked"), "{err}");
        assert!(real.join("info.vdf").is_file());
        assert_eq!(fs::read(outside.join("keep.txt")).unwrap(), b"keep");
        cleanup(&dir);
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

    /// "The wrapper is not named info.vdf" is not guard enough on its own: a
    /// zip whose entries all sit under one real content folder must keep that
    /// folder.
    #[test]
    fn extract_only_strips_a_wrapper_that_actually_wraps_a_hud() {
        let bytes = zip_bytes(&[
            ("info.vdf", info_vdf()),
            ("resource/ui/hudlayout.res", b"hud\n"),
            ("resource/ui/hudplayerhealth.res", b"health\n"),
        ]);
        let extracted = extract_hud_zip(&bytes).unwrap();
        assert_eq!(extracted.tree.get("info.vdf"), Some(info_vdf()));
        assert_eq!(
            extracted.tree.get("resource/ui/hudlayout.res"),
            Some(b"hud\n".as_slice())
        );

        // Every entry under one real content folder. Stripping it would not
        // leave an info.vdf behind, so the folder is content, not a wrapper,
        // and the entries come back untouched.
        let entries = vec![
            ("resource/ui/hudlayout.res".to_string(), b"hud\n".to_vec()),
            (
                "resource/ui/hudplayerhealth.res".to_string(),
                b"hp\n".to_vec(),
            ),
        ];
        assert_eq!(strip_wrapper_folder(entries.clone()), entries);

        // A genuine wrapper leaves info.vdf at the root once stripped.
        let wrapped = vec![
            ("rayshud-abc/info.vdf".to_string(), info_vdf().to_vec()),
            ("rayshud-abc/resource/x.res".to_string(), b"x\n".to_vec()),
        ];
        assert_eq!(
            strip_wrapper_folder(wrapped),
            vec![
                ("info.vdf".to_string(), info_vdf().to_vec()),
                ("resource/x.res".to_string(), b"x\n".to_vec()),
            ]
        );
    }

    #[test]
    fn extract_refuses_too_many_entries() {
        let payload = b"x\n".to_vec();
        let entries: Vec<(String, Vec<u8>)> = (0..(MAX_HUD_ENTRIES + 1))
            .map(|index| (format!("resource/f{index}.res"), payload.clone()))
            .collect();
        let borrowed: Vec<(&str, &[u8])> = entries
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
            .collect();
        let bytes = zip_bytes(&borrowed);
        let err = extract_hud_zip(&bytes).unwrap_err();
        assert!(
            matches!(err, ProfileError::Io(ref msg) if msg.contains("more than")),
            "{err:?}"
        );
    }

    #[test]
    fn extract_refuses_an_oversized_entry() {
        // Declared size is what is checked, before anything is decompressed.
        let big = vec![0u8; (MAX_HUD_ENTRY_BYTES + 1) as usize];
        let bytes = zip_bytes(&[("info.vdf", info_vdf()), ("resource/huge.res", &big)]);
        let err = extract_hud_zip(&bytes).unwrap_err();
        assert!(
            matches!(err, ProfileError::Io(ref msg) if msg.contains("64 MiB")),
            "{err:?}"
        );
    }

    #[test]
    fn screenshot_names_are_allowlisted() {
        assert!(is_safe_screenshot_name("preview1"));
        assert!(is_safe_screenshot_name("main-menu_2"));
        assert!(!is_safe_screenshot_name("../../../etc/passwd"));
        assert!(!is_safe_screenshot_name("a?b"));
        assert!(!is_safe_screenshot_name("a#b"));
        assert!(!is_safe_screenshot_name("a/b"));
        assert!(!is_safe_screenshot_name(""));
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
    fn extract_rejects_hostile_cfg_hidden_in_a_hud() {
        let bytes = zip_bytes(&[
            ("hud/info.vdf", b"\"hud\" { \"ui_version\" \"3\" }"),
            (
                "hud/cfg/autoexec.cfg",
                b"bind mouse1 \"echo ready; connect bad.example\"",
            ),
        ]);
        let err = extract_hud_zip(&bytes).unwrap_err();
        assert!(err.message().contains("connect"), "{}", err.message());
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
        crate::hud_apply::apply_hud_options_for_layer(
            &mut fresh,
            &schema,
            "budhud",
            &options,
            crate::surface::CfgLayer::Vanilla,
        )
        .unwrap();
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
            fs::read(root.join("tf/cfg/execs_hud_hud_minmode.cfg")).unwrap(),
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

    fn active_profile(dir: &Path) -> (PathBuf, PathBuf, String) {
        let profiles = dir.join("execs").join("profiles");
        let root = tf2_root(dir);
        create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&root)).unwrap().profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        (profiles, root, id)
    }

    fn rays_tree() -> HudTree {
        let mut tree = HudTree::default();
        tree.insert("info.vdf", info_vdf().to_vec());
        tree.insert("resource/ui/hudlayout.res", b"new\n".to_vec());
        tree
    }

    fn rays_record() -> HudRecord {
        HudRecord {
            id: "rayshud".into(),
            hash: Some("abc123".into()),
            source: HudSource::HudDb,
            options: BTreeMap::new(),
        }
    }

    /// A manually installed `tf/custom/RaysHUD/` absorbed into the profile
    /// resolves as `rayshud`, and "Apply options" must find its files: the
    /// prefix strip was case-sensitive, so it found none.
    #[test]
    fn hud_tree_from_profile_matches_by_key_not_folder_spelling() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        for (rel, bytes) in [
            ("tf/custom/RaysHUD/info.vdf", info_vdf()),
            (
                "tf/custom/RaysHUD/resource/ui/hudlayout.res",
                b"x\n".as_slice(),
            ),
            ("tf/custom/otherpack/materials/a.vmt", b"vmt\n".as_slice()),
        ] {
            put_exclusive_file_to(&profiles, &root, &id, rel, bytes, unlocked()).unwrap();
        }
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert_eq!(resolve_hud(&manifest).unwrap().record.id, "rayshud");
        assert_eq!(
            manifest_hud_folder(&manifest.files, "rayshud").as_deref(),
            Some("RaysHUD")
        );
        assert_eq!(manifest_hud_folder(&manifest.files, "budhud"), None);
        assert_eq!(
            hud_file_rel("tf/custom/RaysHUD/resource/ui/hudlayout.res", "rayshud"),
            Some("resource/ui/hudlayout.res")
        );
        assert_eq!(hud_file_rel("tf/custom/otherpack/a.vmt", "rayshud"), None);
        assert_eq!(hud_file_rel("tf/custom/RaysHUD", "rayshud"), None);

        let tree = load_hud_tree_from_profile(&profiles, &id, "rayshud").unwrap();
        assert_eq!(tree.files.len(), 2);
        assert_eq!(
            tree.get("resource/ui/hudlayout.res"),
            Some(b"x\n".as_slice())
        );
        cleanup(&dir);
    }

    /// Saving options for an absorbed `RaysHUD` must write back into the
    /// folder the manifest spells, not open a second `rayshud/` entry.
    #[test]
    fn schema_options_write_into_the_manifest_folder_spelling() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        let colors = b"\"Scheme\"\n{\n\t\"Colors\"\n\t{\n\t\t\"bh_Health_Buff\"\t\t\"255 0 0 255\"\n\t}\n}\n";
        for (rel, bytes) in [
            ("tf/custom/RaysHUD/info.vdf", info_vdf()),
            (
                "tf/custom/RaysHUD/resource/clientscheme_colors.res",
                colors.as_slice(),
            ),
        ] {
            put_exclusive_file_to(&profiles, &root, &id, rel, bytes, unlocked()).unwrap();
        }
        let schema = crate::hud_apply::parse_hud_schema(
            r##"{
  "Author": "Test",
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
    ]
  }
}"##,
        )
        .unwrap();
        let mut options = BTreeMap::new();
        options.insert("bh_Health_Buff".into(), "0 153 255 255".into());
        // The inferred HUD has no record yet; give it one so options persist.
        match_hud_catalog_to(&profiles, &root, &id, "rayshud", None, unlocked()).unwrap();
        apply_schema_options_to(&profiles, &root, &id, &schema, options, unlocked()).unwrap();

        let manifest = load_manifest(&profiles, &id).unwrap();
        let paths: Vec<&str> = manifest
            .files
            .iter()
            .map(|file| file.path.as_str())
            .filter(|path| path.starts_with("tf/custom/"))
            .collect();
        assert!(
            paths
                .iter()
                .all(|path| path.starts_with("tf/custom/RaysHUD/")),
            "{paths:?}"
        );
        let written = fs::read_to_string(exclusive_file_path(
            &profiles,
            &id,
            "tf/custom/RaysHUD/resource/clientscheme_colors.res",
        ))
        .unwrap();
        assert!(written.contains("0 153 255 255"), "{written}");
        cleanup(&dir);
    }

    /// Catalog Update on a profile whose HUD was absorbed as `RaysHUD`: the
    /// live folder with the same identity but another spelling must not stay
    /// mounted next to the fresh `rayshud/`. Exercises `remove_live_pack` by
    /// key on Linux; on Windows the two names are one folder and the result
    /// is the same.
    #[test]
    fn install_replaces_a_live_folder_that_differs_only_in_case() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/custom/RaysHUD/info.vdf",
            b"old\n",
            unlocked(),
        )
        .unwrap();
        let custom = root.join("tf").join("custom");
        fs::create_dir_all(custom.join("RaysHUD")).unwrap();
        fs::write(custom.join("RaysHUD").join("info.vdf"), b"old\n").unwrap();

        install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &rays_tree(),
            rays_record(),
            unlocked(),
        )
        .unwrap();

        let mounted: Vec<LiveHud> = live_hud_names(&root)
            .into_iter()
            .filter(|hud| !hud.name.starts_with('-'))
            .collect();
        assert_eq!(mounted.len(), 1, "{mounted:?}");
        assert_eq!(mounted[0].name, "rayshud");
        assert_eq!(
            fs::read(custom.join("rayshud").join("info.vdf")).unwrap(),
            info_vdf()
        );
        assert!(custom.join("-RaysHUD").exists());
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest
            .files
            .iter()
            .all(|file| !file.path.starts_with("tf/custom/RaysHUD/")));
        cleanup(&dir);
    }

    /// A stray `RaysHUD` the profile never absorbed shares the new HUD's key
    /// but not its folder: it is dashed, not left mounted.
    #[test]
    fn install_dashes_a_stray_folder_that_shares_the_key() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        let custom = root.join("tf").join("custom");
        fs::create_dir_all(custom.join("RaysHUD")).unwrap();
        fs::write(custom.join("RaysHUD").join("info.vdf"), b"stray\n").unwrap();

        install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &rays_tree(),
            rays_record(),
            unlocked(),
        )
        .unwrap();

        assert!(custom.join("-RaysHUD").is_dir());
        assert_eq!(
            fs::read(custom.join("rayshud").join("info.vdf")).unwrap(),
            info_vdf()
        );
        let mounted: Vec<LiveHud> = live_hud_names(&root)
            .into_iter()
            .filter(|hud| !hud.name.starts_with('-'))
            .collect();
        assert_eq!(mounted.len(), 1, "{mounted:?}");
        cleanup(&dir);
    }

    /// A drifted target folder may no longer contain a HUD marker, but it
    /// still has to be moved out of the destination before the fresh HUD is
    /// projected. Otherwise its untracked files are silently merged into the
    /// newly mounted pack.
    #[test]
    fn install_preserves_a_non_hud_target_without_merging_its_files() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        let custom = root.join("tf").join("custom");
        let stale = custom.join("RaysHUD");
        fs::create_dir_all(stale.join("materials")).unwrap();
        fs::write(stale.join("materials/leftover.vmt"), b"untracked\n").unwrap();

        install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &rays_tree(),
            rays_record(),
            unlocked(),
        )
        .unwrap();

        assert!(!custom
            .join("rayshud")
            .join("materials/leftover.vmt")
            .exists());
        assert_eq!(
            fs::read(custom.join("-RaysHUD/materials/leftover.vmt")).unwrap(),
            b"untracked\n"
        );
        assert_eq!(
            fs::read(custom.join("rayshud/info.vdf")).unwrap(),
            info_vdf()
        );
        cleanup(&dir);
    }

    /// Live HUD files land through temp + rename: no `.execs-part` sibling
    /// survives and the bytes match the library copy.
    #[test]
    fn install_writes_live_files_atomically() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &rays_tree(),
            rays_record(),
            unlocked(),
        )
        .unwrap();
        let live = root.join("tf/custom/rayshud/resource/ui/hudlayout.res");
        assert_eq!(fs::read(&live).unwrap(), b"new\n");
        assert!(!crate::hash::part_path(&live).exists());
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/rayshud/resource/ui/hudlayout.res"
            ))
            .unwrap(),
            b"new\n"
        );
        cleanup(&dir);
    }

    /// `-foo` sorts before `foo` on NTFS. Deduping on key kept the dashed
    /// copy and dropped the mounted one, so it was never dashed.
    #[test]
    fn live_hud_names_keep_every_spelling_and_the_enabled_one_is_dashed() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        let custom = root.join("tf").join("custom");
        for name in ["-foo", "foo"] {
            fs::create_dir_all(custom.join(name)).unwrap();
            fs::write(custom.join(name).join("info.vdf"), info_vdf()).unwrap();
        }
        let huds = live_hud_names(&root);
        assert_eq!(huds.len(), 2, "{huds:?}");
        assert_eq!(huds[0].name, "foo");
        assert_eq!(huds[1].name, "-foo");
        assert_eq!(live_hud_keys(&root), vec!["foo".to_string()]);

        install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &rays_tree(),
            rays_record(),
            unlocked(),
        )
        .unwrap();
        assert!(!custom.join("foo").exists());
        assert!(custom.join("-foo").is_dir());
        assert!(custom.join("rayshud").is_dir());
        cleanup(&dir);
    }

    /// Every destination is validated before the previous HUD is removed, so
    /// a bad entry name leaves the profile exactly as it was.
    #[test]
    fn install_refuses_a_bad_entry_before_removing_the_old_hud() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/custom/oldhud/info.vdf",
            b"old\n",
            unlocked(),
        )
        .unwrap();
        let before = load_manifest(&profiles, &id).unwrap();

        let mut escaping = rays_tree();
        escaping.insert("../evil.res", b"nope\n".to_vec());
        let err = install_hud_pack_to(&profiles, &root, &id, &escaping, rays_record(), unlocked())
            .unwrap_err();
        assert_eq!(err, ProfileError::InvalidPath);

        let mut forbidden = rays_tree();
        forbidden.insert("steam.inf", b"appID=1\n".to_vec());
        let err = install_hud_pack_to(&profiles, &root, &id, &forbidden, rays_record(), unlocked())
            .unwrap_err();
        assert!(matches!(err, ProfileError::ForbiddenPath(_)), "{err:?}");

        let after = load_manifest(&profiles, &id).unwrap();
        assert_eq!(after.files, before.files);
        assert!(exclusive_file_path(&profiles, &id, "tf/custom/oldhud/info.vdf").is_file());
        assert!(!root.join("tf/custom/rayshud").exists());
        cleanup(&dir);
    }

    /// A live-path failure after the library files were staged must restore
    /// both the old payload and HUD record instead of leaving a half-install.
    #[cfg(unix)]
    #[test]
    fn install_rolls_back_profile_and_record_when_live_projection_fails() {
        use std::os::unix::fs::symlink;

        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        let before = load_manifest(&profiles, &id).unwrap();
        let custom = root.join("tf/custom");
        let outside = dir.join("outside-custom");
        fs::create_dir_all(&outside).unwrap();
        fs::remove_dir(&custom).unwrap();
        symlink(&outside, &custom).unwrap();

        let err = install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &rays_tree(),
            rays_record(),
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("link"), "{err:?}");
        let after = load_manifest(&profiles, &id).unwrap();
        assert_eq!(after.files, before.files);
        assert_eq!(after.hud, before.hud);
        assert!(!exclusive_file_path(&profiles, &id, "tf/custom/rayshud/info.vdf").exists());
        assert!(!outside.join("rayshud/info.vdf").exists());
        cleanup(&dir);
    }

    /// Tree edits, generated cfgs, autoexec lines, and the option record are a
    /// single transaction. A failure publishing to the active live pack must
    /// restore every library byte and metadata field.
    #[cfg(unix)]
    #[test]
    fn option_apply_rolls_back_tree_cfg_autoexec_and_record_together() {
        use std::os::unix::fs::symlink;

        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        let mut tree = HudTree::default();
        tree.insert("info.vdf", info_vdf().to_vec());
        tree.insert(
            "resource/clientscheme_colors.res",
            b"\"Scheme\" { \"Colors\" { \"Health\" \"255 0 0 255\" } }\n".to_vec(),
        );
        install_hud_pack_to(&profiles, &root, &id, &tree, rays_record(), unlocked()).unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let before_bytes = fs::read(exclusive_file_path(
            &profiles,
            &id,
            "tf/custom/rayshud/resource/clientscheme_colors.res",
        ))
        .unwrap();

        let live_pack = root.join("tf/custom/rayshud");
        fs::remove_dir_all(&live_pack).unwrap();
        let outside = dir.join("outside-options");
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, &live_pack).unwrap();

        let schema = crate::hud_apply::parse_hud_schema(
            r##"{
              "Author":"Test",
              "Controls":{"Colors":[{
                "Name":"Health","Type":"ColorPicker","Value":"0 255 0 255",
                "Files":{"resource/clientscheme_colors.res":{
                  "Scheme":{"Colors":{"Health":"$value"}}
                }}
              }]}
            }"##,
        )
        .unwrap();
        let mut options = BTreeMap::new();
        options.insert("Health".into(), "0 255 0 255".into());
        let err = apply_schema_options_to(&profiles, &root, &id, &schema, options, unlocked())
            .unwrap_err();
        assert!(err.message().contains("link"), "{err:?}");

        let after = load_manifest(&profiles, &id).unwrap();
        assert_eq!(after.files, before.files);
        assert_eq!(after.hud, before.hud);
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/rayshud/resource/clientscheme_colors.res",
            ))
            .unwrap(),
            before_bytes
        );
        assert!(!outside.join("resource/clientscheme_colors.res").exists());
        assert!(!exclusive_file_path(&profiles, &id, "tf/cfg/execs_hud_Health.cfg").exists());
        cleanup(&dir);
    }

    /// A non-UTF-8 autoexec is not an empty one. Adding exec lines is refused
    /// with a clear error; with nothing to add it is left untouched.
    #[test]
    fn sync_hud_exec_lines_refuses_a_binary_autoexec() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        let binary: &[u8] = &[0xff, 0xfe, 0x00, 0x80, b'x'];
        put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/cfg/autoexec.cfg",
            binary,
            unlocked(),
        )
        .unwrap();
        let stems = vec!["execs_hud_minmode".to_string()];
        let err = sync_hud_exec_lines_to(&profiles, &root, &id, &stems, &[]).unwrap_err();
        assert!(
            matches!(err, ProfileError::Io(ref msg) if msg.contains("not a text file")),
            "{err:?}"
        );
        sync_hud_exec_lines_to(&profiles, &root, &id, &[], &[]).unwrap();
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &id, "tf/cfg/autoexec.cfg")).unwrap(),
            binary
        );
        cleanup(&dir);
    }

    /// `Info.vdf` and `Resource/UI` are HUDs too, in a folder, an archive and
    /// a tree handed to install.
    #[test]
    fn hud_detection_ignores_ascii_case() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        let by_info = dir.join("ByInfo");
        fs::create_dir_all(&by_info).unwrap();
        fs::write(by_info.join("Info.vdf"), info_vdf()).unwrap();
        assert!(is_hud_dir(&by_info));
        let by_ui = dir.join("ByUi");
        fs::create_dir_all(by_ui.join("Resource").join("UI")).unwrap();
        assert!(is_hud_dir(&by_ui));
        let neither = dir.join("Neither");
        fs::create_dir_all(neither.join("materials")).unwrap();
        assert!(!is_hud_dir(&neither));
        assert!(!is_hud_dir(&dir.join("missing")));

        let bytes = zip_bytes(&[
            ("wrapper/Info.vdf", info_vdf()),
            ("wrapper/Resource/UI/hudlayout.res", b"hud\n"),
        ]);
        let extracted = extract_hud_zip(&bytes).unwrap();
        assert_eq!(extracted.ui_version, Some(3));
        assert_eq!(extracted.tree.info_vdf(), Some(info_vdf()));
        assert_eq!(extracted.tree.get("info.vdf"), None);

        let detail = install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &extracted.tree,
            rays_record(),
            unlocked(),
        )
        .unwrap();
        assert!(detail
            .files
            .iter()
            .any(|file| file.path == "tf/custom/rayshud/Info.vdf"));
        assert!(is_hud_dir(&root.join("tf/custom/rayshud")));
        cleanup(&dir);
    }

    /// Installing a HUD prunes the previous HUD's managed option cfgs from the
    /// profile and the live tree; whoever applies options writes the new set.
    #[test]
    fn install_prunes_stale_hud_option_cfgs() {
        let dir = test_temp_dir();
        let (profiles, root, id) = active_profile(&dir);
        write_owned_file_to(
            &profiles,
            &root,
            &id,
            "tf/cfg/execs_hud_old.cfg",
            b"cl_hud_minmode 1\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap();
        write_owned_file_to(
            &profiles,
            &root,
            &id,
            "tf/cfg/autoexec.cfg",
            b"bind f +duck\n",
            unlocked(),
            WriteOwnedOptions::default(),
        )
        .unwrap();
        assert!(root.join("tf/cfg/execs_hud_old.cfg").is_file());

        let detail = install_hud_pack_to(
            &profiles,
            &root,
            &id,
            &rays_tree(),
            rays_record(),
            unlocked(),
        )
        .unwrap();
        assert!(!detail
            .files
            .iter()
            .any(|file| file.path == "tf/cfg/execs_hud_old.cfg"));
        assert!(detail
            .files
            .iter()
            .any(|file| file.path == "tf/cfg/autoexec.cfg"));
        assert!(!root.join("tf/cfg/execs_hud_old.cfg").exists());
        assert!(root.join("tf/cfg/autoexec.cfg").is_file());
        cleanup(&dir);
    }
}
