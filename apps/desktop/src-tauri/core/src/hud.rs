//! HUD pack detection, zip extract, catalog helpers, and one-HUD install.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

use crate::absorb::pack_key;
use crate::apply::{
    detail_from_manifest, read_profile_file_from, write_owned_file_to, ProfileDetail,
    WriteOwnedOptions,
};
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
    pub tf2huds_url: String,
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
            .or_else(|| lower.strip_prefix("http://"))
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

pub fn live_hud_names(tf2_root: &Path) -> Vec<LiveHud> {
    let custom = tf2_root.join("tf").join("custom");
    let Ok(entries) = fs::read_dir(&custom) else {
        return Vec::new();
    };
    let mut huds: Vec<LiveHud> = Vec::new();
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
        if key.is_empty() || huds.iter().any(|hud| hud.key == key) {
            continue;
        }
        huds.push(LiveHud { name, key });
    }
    huds
}

/// Just the identities, for callers comparing against a manifest.
pub fn live_hud_keys(tf2_root: &Path) -> Vec<String> {
    live_hud_names(tf2_root)
        .into_iter()
        .map(|hud| hud.key)
        .collect()
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
        .filter(|album| album.starts_with("https://") || album.starts_with("http://"));
    Ok(HudCatalogEntry {
        comfig_url: format!("https://comfig.app/huds/page/{id}/"),
        tf2huds_url: format!("https://tf2huds.dev/hud/{id}"),
        github: is_github_hud_repo(&parsed.repo),
        install: HudInstallKind::from_repo(&parsed.repo),
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
    // v3: entries gained the install kind; old caches are ignored and refetched.
    dir.join("catalog-v3.json")
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

/// Ceilings on a HUD zip. The bytes come from a `codeload.github.com` URL
/// whose owner/repo/commit all come from hud-db JSON, and the whole archive is
/// held in memory while it is extracted, so a zip bomb or a merely enormous
/// repo used to take the app down.
const MAX_HUD_ENTRIES: usize = 20_000;
const MAX_HUD_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_HUD_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

const SEVEN_ZIP_MAGIC: [u8; 6] = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];

/// A HUD from a folder on disk (an extracted download, or one the user
/// built), read under the same caps as an archive and with the same
/// wrapper-folder stripping. `sound.cache`, VCS metadata and OS junk are
/// left behind.
pub fn hud_tree_from_dir(dir: &Path) -> Result<ExtractedHud, ProfileError> {
    if !dir.is_dir() {
        return Err(ProfileError::Io("That is not a folder.".into()));
    }
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total: u64 = 0;
    let mut stack = vec![(dir.to_path_buf(), String::new())];
    while let Some((path, rel)) = stack.pop() {
        let entries = fs::read_dir(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_junk_name(&name) {
                continue;
            }
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            let child = entry.path();
            if child.is_dir() {
                stack.push((child, child_rel));
                continue;
            }
            if !child.is_file() {
                continue;
            }
            if raw.len() >= MAX_HUD_ENTRIES {
                return Err(ProfileError::Io(format!(
                    "That folder has more than {MAX_HUD_ENTRIES} files; refusing to import it."
                )));
            }
            let meta = child
                .metadata()
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            if meta.len() > MAX_HUD_ENTRY_BYTES {
                return Err(ProfileError::Io(format!(
                    "{child_rel} is larger than 64 MiB; refusing to import this HUD."
                )));
            }
            total += meta.len();
            if total > MAX_HUD_TOTAL_BYTES {
                return Err(ProfileError::Io(
                    "That folder holds more than 512 MiB; refusing to import it.".into(),
                ));
            }
            let bytes = fs::read(&child).map_err(|err| ProfileError::Io(err.to_string()))?;
            raw.push((sanitize_zip_entry(&child_rel)?, bytes));
        }
    }
    finish_extracted(raw)
}

fn is_junk_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git"
            | ".svn"
            | ".hg"
            | ".ds_store"
            | "thumbs.db"
            | "desktop.ini"
            | "sound.cache"
            | "__macosx"
    )
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
    if bytes.starts_with(b"PK") {
        return extract_hud_zip(bytes);
    }
    if bytes.starts_with(&SEVEN_ZIP_MAGIC) {
        return extract_hud_7z(bytes);
    }
    if bytes.starts_with(b"Rar!") {
        return Err(ProfileError::Io(
            "That HUD is a RAR archive, which this app cannot unpack. Open the author's page to install it by hand.".into(),
        ));
    }
    if bytes.starts_with(b"<") || bytes.starts_with(b"{") {
        return Err(ProfileError::Io(
            "The download returned a web page instead of the HUD archive. Try again later or open the author's page.".into(),
        ));
    }
    Err(ProfileError::Io(
        "The download is not a zip or 7z archive.".into(),
    ))
}

fn extract_hud_7z(bytes: &[u8]) -> Result<ExtractedHud, ProfileError> {
    let mut reader = sevenz_rust::SevenZReader::new(
        Cursor::new(bytes),
        bytes.len() as u64,
        sevenz_rust::Password::empty(),
    )
    .map_err(|err| ProfileError::Io(format!("Could not read the 7z archive ({err})")))?;
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total: u64 = 0;
    let mut count = 0usize;
    reader
        .for_each_entries(|entry, stream| {
            if entry.is_directory() {
                return Ok(true);
            }
            count += 1;
            if count > MAX_HUD_ENTRIES {
                return Err(sevenz_rust::Error::other(format!(
                    "That HUD archive has more than {MAX_HUD_ENTRIES} files; refusing to unpack it."
                )));
            }
            let rel = sanitize_zip_entry(entry.name())
                .map_err(|err| sevenz_rust::Error::other(err.message()))?;
            if entry.size() > MAX_HUD_ENTRY_BYTES {
                return Err(sevenz_rust::Error::other(format!(
                    "{rel} is larger than 64 MiB; refusing to unpack this HUD."
                )));
            }
            let budget = MAX_HUD_TOTAL_BYTES.saturating_sub(total);
            let mut data = Vec::new();
            stream
                .take(budget.min(MAX_HUD_ENTRY_BYTES) + 1)
                .read_to_end(&mut data)
                .map_err(|err| sevenz_rust::Error::other(err.to_string()))?;
            total += data.len() as u64;
            if total > MAX_HUD_TOTAL_BYTES {
                return Err(sevenz_rust::Error::other(
                    "That HUD archive unpacks to more than 512 MiB; refusing to unpack it.",
                ));
            }
            raw.push((rel, data));
            Ok(true)
        })
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    finish_extracted(raw)
}

fn finish_extracted(raw: Vec<(String, Vec<u8>)>) -> Result<ExtractedHud, ProfileError> {
    let stripped = strip_wrapper_folder(raw);
    let mut tree = HudTree::default();
    for (path, data) in stripped {
        tree.insert(path, data);
    }
    if tree.get("info.vdf").is_none() {
        return Err(ProfileError::Io(
            "That archive is not a HUD (missing info.vdf at the root).".into(),
        ));
    }
    let ui_version = tree
        .get("info.vdf")
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .and_then(parse_ui_version);
    Ok(ExtractedHud { tree, ui_version })
}

pub fn extract_hud_zip(bytes: &[u8]) -> Result<ExtractedHud, ProfileError> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|err| ProfileError::Io(err.to_string()))?;
    if archive.len() > MAX_HUD_ENTRIES {
        return Err(ProfileError::Io(format!(
            "That HUD zip has more than {MAX_HUD_ENTRIES} files; refusing to unpack it."
        )));
    }
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let rel = sanitize_zip_entry(entry.name())?;
        if entry.size() > MAX_HUD_ENTRY_BYTES {
            return Err(ProfileError::Io(format!(
                "{rel} is larger than 64 MiB; refusing to unpack this HUD."
            )));
        }
        let budget = MAX_HUD_TOTAL_BYTES.saturating_sub(total);
        let mut data = Vec::new();
        // `take` also catches an entry whose header understates its real size.
        entry
            .by_ref()
            .take(budget.min(MAX_HUD_ENTRY_BYTES) + 1)
            .read_to_end(&mut data)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        total += data.len() as u64;
        if total > MAX_HUD_TOTAL_BYTES {
            return Err(ProfileError::Io(
                "That HUD zip unpacks to more than 512 MiB; refusing to unpack it.".into(),
            ));
        }
        raw.push((rel, data));
    }
    finish_extracted(raw)
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
    let layer = crate::apply::cfg_layer_from_files(&manifest.files);
    let applied = crate::hud_apply::apply_hud_options_for_layer(
        &mut tree,
        schema,
        &status.record.id,
        &options,
        layer,
    )?;
    // A HUD's option cfgs are only meaningful for that HUD; a leftover
    // `execs_hud_*.cfg` from a previous option set would keep executing.
    remove_stale_hud_cfgs(
        profiles_dir,
        tf2_root,
        profile_id,
        &applied.cfg_writes,
        &running,
    )?;
    write_hud_tree_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &status.record.id,
        &tree,
        &applied.cfg_writes,
        &running,
    )?;
    sync_hud_exec_lines_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &applied.exec_stems,
        &running,
    )?;
    set_hud_options_to(profiles_dir, tf2_root, profile_id, options, &running)
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
    let layer = crate::apply::cfg_layer_from_files(&manifest.files);
    let rel = match layer {
        crate::surface::CfgLayer::Comfig => "tf/cfg/overrides/autoexec.cfg",
        crate::surface::CfgLayer::Vanilla => "tf/cfg/autoexec.cfg",
    };
    let existing = match read_profile_file_from(profiles_dir, tf2_root, profile_id, rel) {
        Ok(content) => content.text.unwrap_or_default(),
        // Not in the manifest yet: start from an empty autoexec.
        Err(ProfileError::InvalidPath) => String::new(),
        Err(err) => return Err(err),
    };
    let next = crate::hud_apply::ensure_hud_exec_lines(&existing, layer, stems);
    if next == existing {
        return Ok(());
    }
    write_owned_file_to(
        profiles_dir,
        tf2_root,
        profile_id,
        rel,
        next.as_bytes(),
        running.iter().cloned(),
        WriteOwnedOptions::default(),
    )?;
    Ok(())
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
        if live.key != new_id.to_ascii_lowercase() {
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

/// Drop every managed `execs_hud_*.cfg` the profile still carries that the new
/// option set does not produce. They used to live under `tf/cfg/<hudid>/` and
/// were never cleaned up at all, so a switched-away HUD left its folder in the
/// profile forever.
fn remove_stale_hud_cfgs(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    keep: &[(String, Vec<u8>)],
    running: &[String],
) -> Result<(), ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let stale: Vec<String> = manifest
        .files
        .iter()
        .map(|file| file.path.clone())
        .filter(|path| is_managed_hud_cfg(path))
        .filter(|path| !keep.iter().any(|(kept, _)| kept == path))
        .collect();
    if stale.is_empty() {
        return Ok(());
    }
    remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &stale, running)?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() == Some(profile_id) {
        for path in &stale {
            let dest = live_path(tf2_root, path);
            if dest.is_file() {
                fs::remove_file(&dest).map_err(|err| ProfileError::Io(err.to_string()))?;
            }
        }
    }
    Ok(())
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

fn remove_live_pack(tf2_root: &Path, pack: &str) -> Result<(), ProfileError> {
    for name in [pack.to_string(), format!("-{pack}")] {
        let dir = tf2_root.join("tf").join("custom").join(name);
        if dir.is_dir() {
            fs::remove_dir_all(&dir).map_err(|err| ProfileError::Io(err.to_string()))?;
        }
    }
    Ok(())
}

/// Disable a live HUD folder by renaming it to Source's `-name` disable form.
///
/// Uses the folder's real on-disk spelling — a lowercased key never matched a
/// `RaysHUD` folder on Linux, so the stray HUD stayed mounted. When the folder
/// is already dashed there is nothing to do; when a `-name` twin already exists
/// the enabled copy is removed rather than left mounted beside it.
fn dash_live_hud(tf2_root: &Path, hud: &LiveHud) -> Result<(), ProfileError> {
    let custom = tf2_root.join("tf").join("custom");
    let enabled = custom.join(&hud.name);
    if hud.name.starts_with('-') || !enabled.is_dir() {
        return Ok(());
    }
    let disabled = custom.join(format!("-{}", hud.name));
    if disabled.exists() {
        // Both copies on disk means the enabled one is what the game mounts.
        // "At most one HUD folder is mounted" wins over keeping a duplicate.
        return fs::remove_dir_all(&enabled).map_err(|err| ProfileError::Io(err.to_string()));
    }
    fs::rename(&enabled, &disabled).map_err(|err| ProfileError::Io(err.to_string()))
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
    for (path, bytes) in &entries {
        if let Some(rest) = path.strip_prefix(&prefix) {
            if !rest.is_empty() {
                stripped.push((rest.to_string(), bytes.clone()));
            }
        }
    }
    // Only a wrapper if what is left is itself a HUD. A zip whose entries all
    // live under one real content folder (`resource/`, say) would otherwise
    // have that folder stripped off.
    if stripped
        .iter()
        .any(|(path, _)| path.eq_ignore_ascii_case("info.vdf"))
    {
        stripped
    } else {
        entries
    }
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

    /// With both `foo` and `-foo` on disk the game mounts `foo`, so dashing
    /// must not silently no-op and leave it mounted.
    #[test]
    fn dashing_removes_the_enabled_copy_when_a_dashed_twin_exists() {
        let dir = crate::test_temp_dir();
        let root = tf2_root(&dir);
        let custom = root.join("tf").join("custom");
        for name in ["foo", "-foo"] {
            fs::create_dir_all(custom.join(name)).unwrap();
            fs::write(custom.join(name).join("info.vdf"), info_vdf()).unwrap();
        }

        let hud = LiveHud {
            name: "foo".into(),
            key: "foo".into(),
        };
        dash_live_hud(&root, &hud).unwrap();
        assert!(!custom.join("foo").exists());
        assert!(custom.join("-foo").is_dir());

        // A folder that is already dashed is left exactly as it is.
        let dashed = LiveHud {
            name: "-foo".into(),
            key: "foo".into(),
        };
        dash_live_hud(&root, &dashed).unwrap();
        assert!(custom.join("-foo").is_dir());
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

    /// The only guard used to be "the wrapper is not named info.vdf", so a zip
    /// whose entries all sat under one real content folder had that folder
    /// stripped off.
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
}
