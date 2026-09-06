//! Fetch hud-db catalog entries and pinned HUD zips. Core stays network-free.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use execs_core::hud::catalog_cache_file;
use execs_core::{catalog_entry_from_json, schema_file_name, HudCatalogEntry, HudInstallKind};
use serde::{Deserialize, Serialize};

use crate::net::{self, RemoteSource, MIB};

const TREE_URL: &str =
    "https://api.github.com/repos/mastercomfig/hud-db/git/trees/main?recursive=1";
const RAW_HUD_DB: &str = "https://raw.githubusercontent.com/mastercomfig/hud-db";

/// TF2HUD.Editor's schema JSON, pinned like every other remote asset in the
/// app. Read off a moving `master` and cached under a filename with no version
/// in it, a bad fetch is served for good and an upstream fix never arrives.
/// The SHA is part of the cache filename, so bumping this constant invalidates
/// the cache by construction.
const SCHEMA_COMMIT: &str = "17bccd15d818d12707ce89574318acbc23c85a9f";
const RAW_SCHEMA_BASE: &str = "https://raw.githubusercontent.com/CriticalFlaw/TF2HUD.Editor";

const CATALOG_WORKERS: usize = 12;
const CATALOG_MAX_DOCUMENTS: usize = 1024;
const CATALOG_CACHE_MAX_BYTES: u64 = 16 * MIB;
const CATALOG_DOCUMENT_MAX_BYTES: u64 = 256 * 1024;
const CATALOG_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const PARTIAL_CATALOG_TTL: Duration = Duration::from_secs(60 * 60);
const CATALOG_DEADLINE: Duration = Duration::from_secs(120);
const ALBUM_CACHE_MAX_BYTES: u64 = 4 * MIB;
const SCHEMA_CACHE_MAX_BYTES: u64 = 4 * MIB;
const MAX_ALBUM_IMAGES: usize = 256;
const MAX_ALBUM_URL_BYTES: usize = 4096;
const MAX_MARKDOWN_IMAGE_TOKEN_BYTES: usize = 8192;

/// HUD repos are big (budhud is ~200 MB unpacked) but nothing legitimate on
/// hud-db approaches this. Also the ceiling on an imported archive: a file
/// past it on disk cannot unpack to less.
pub const HUD_ZIP_MAX_BYTES: u64 = 512 * MIB;

#[derive(Debug, Deserialize)]
struct GitTree {
    sha: String,
    #[serde(default)]
    truncated: bool,
    tree: Vec<GitTreeEntry>,
}

#[derive(Debug, Deserialize)]
struct GitTreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

/// The catalog cache on disk: core's `HudCatalogCache` shape (same file,
/// same keys, so core can still read it) plus how many documents the run
/// that produced it failed to fetch. A refresh tolerates a minority of
/// failures so one 429 does not cost the user the other 199 HUDs, but the
/// result is then a partial catalog under the tree's SHA — and a later
/// refresh must not take that SHA match as "nothing to do".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogCache {
    tree_sha: String,
    entries: Vec<HudCatalogEntry>,
    /// Caches written before this field existed load as complete: at the
    /// time, a partial run was indistinguishable from a whole one anyway.
    #[serde(default)]
    failures: usize,
    #[serde(default)]
    fetched_at: u64,
}

impl CatalogCache {
    /// Whether the cache can stand in for a fresh read of the same tree.
    fn covers(&self, tree_sha: &str) -> bool {
        self.tree_sha == tree_sha && !self.entries.is_empty() && self.failures == 0
    }

    fn is_fresh(&self, now: u64) -> bool {
        let ttl = if self.failures == 0 {
            CATALOG_TTL
        } else {
            PARTIAL_CATALOG_TTL
        };
        self.fetched_at <= now.saturating_add(60 * 60)
            && now.saturating_sub(self.fetched_at) < ttl.as_secs()
            && !self.entries.is_empty()
    }
}

fn load_catalog_cache(root: &Path, dir: &Path) -> Result<Option<CatalogCache>, String> {
    let path = catalog_cache_file(dir);
    match std::fs::symlink_metadata(&path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.to_string()),
        Ok(_) => {}
    }
    execs_core::hash::validate_file_within(root, &path).map_err(|err| err.to_string())?;
    let cache = net::read_cache_file_capped(root, &path, CATALOG_CACHE_MAX_BYTES)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<CatalogCache>(&bytes).ok());
    let Some(cache) = cache else {
        return Ok(None);
    };
    let valid = valid_git_sha(&cache.tree_sha)
        && !cache.entries.is_empty()
        && cache.entries.len() <= CATALOG_MAX_DOCUMENTS
        && cache.failures <= CATALOG_MAX_DOCUMENTS
        && cache.entries.iter().all(|entry| valid_hud_id(&entry.id));
    if !valid {
        return Ok(None);
    }
    Ok(Some(cache))
}

pub fn load_cached_catalog() -> Result<Option<Vec<HudCatalogEntry>>, String> {
    let root = execs_core::try_execs_data_dir()?;
    Ok(load_catalog_cache(&root, &root.join("hud-catalog"))?.map(|cache| cache.entries))
}

fn save_catalog_cache(root: &Path, dir: &Path, cache: &CatalogCache) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cache).map_err(|err| err.to_string())?;
    if json.len() as u64 > CATALOG_CACHE_MAX_BYTES {
        return Err("The HUD catalog is too large to cache.".into());
    }
    net::write_cache_file_within(
        root,
        &catalog_cache_file(dir),
        format!("{json}\n").as_bytes(),
    )
}

pub fn load_or_fetch_catalog(refresh: bool) -> Result<Vec<HudCatalogEntry>, String> {
    let root = execs_core::try_execs_data_dir()?;
    let dir = root.join("hud-catalog");
    let cached = load_catalog_cache(&root, &dir)?;
    if !refresh {
        if let Some(cache) = &cached {
            if cache.is_fresh(now_secs()) {
                return Ok(cache.entries.clone());
            }
        }
    }
    match refresh_catalog(&root, &dir, cached.as_ref()) {
        Ok(entries) => Ok(entries),
        // An automatic refresh may use a semantically valid stale catalog
        // when the network is unavailable. Explicit Refresh reports failure.
        Err(_) if !refresh && cached.is_some() => Ok(cached.unwrap().entries),
        Err(err) => Err(err),
    }
}

fn refresh_catalog(
    root: &Path,
    dir: &Path,
    cached: Option<&CatalogCache>,
) -> Result<Vec<HudCatalogEntry>, String> {
    let client = net::api_client()?;
    let tree: GitTree = net::get_json_for(&client, TREE_URL, RemoteSource::GitHubApi)
        .map_err(|err| format!("Could not read hud-db ({err})"))?;
    if tree.truncated {
        return Err("GitHub returned a truncated hud-db tree.".into());
    }
    if !valid_git_sha(&tree.sha) {
        return Err("GitHub returned an invalid hud-db commit.".into());
    }
    // A whole cache of the same tree is the same catalog: the documents are
    // addressed by that SHA. A partial one is re-read so Refresh repairs it.
    if let Some(cache) = cached {
        if cache.covers(&tree.sha) {
            let mut renewed = cache.clone();
            renewed.fetched_at = now_secs();
            save_catalog_cache(root, dir, &renewed)?;
            return Ok(renewed.entries);
        }
    }
    let documents = catalog_documents(&tree.sha, &tree.tree);
    if documents.is_empty() || documents.len() > CATALOG_MAX_DOCUMENTS {
        return Err(format!(
            "GitHub returned an unexpected hud-db tree ({} documents).",
            documents.len()
        ));
    }
    let (mut entries, failures) =
        fetch_catalog_entries(&client, &documents, Instant::now() + CATALOG_DEADLINE)?;
    entries.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    save_catalog_cache(
        root,
        dir,
        &CatalogCache {
            tree_sha: tree.sha,
            entries: entries.clone(),
            failures,
            fetched_at: now_secs(),
        },
    )?;
    Ok(entries)
}

fn catalog_documents(commit: &str, tree: &[GitTreeEntry]) -> Vec<(String, String)> {
    if !valid_git_sha(commit) {
        return Vec::new();
    }
    tree.iter()
        .filter_map(|item| {
            if item.kind != "blob" {
                return None;
            }
            let name = item.path.strip_prefix("hud-data/")?;
            let id = name.strip_suffix(".json")?;
            if id.contains('/') || !valid_hud_id(id) {
                return None;
            }
            Some((
                id.to_string(),
                format!("{RAW_HUD_DB}/{commit}/hud-data/{id}.json"),
            ))
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn valid_git_sha(sha: &str) -> bool {
    sha.len() == 40
        && sha
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_hud_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// A refresh fans ~200 requests at raw.githubusercontent.com across 12
/// workers, so a single 429 or timeout is likely. Losing one document must
/// not cost the user the other 199 — failures are skipped and counted, and
/// only a majority failure is treated as "the refresh did not work". The
/// count rides back with the entries so the cache knows it is partial.
fn fetch_catalog_entries(
    client: &reqwest::blocking::Client,
    documents: &[(String, String)],
    deadline: Instant,
) -> Result<(Vec<HudCatalogEntry>, usize), String> {
    if documents.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let worker_count = CATALOG_WORKERS.min(documents.len());
    let chunk_size = documents.len().div_ceil(worker_count);

    let cancelled = AtomicBool::new(false);
    let (entries, failures) = std::thread::scope(|scope| {
        let handles = documents
            .chunks(chunk_size)
            .map(|chunk| {
                let client = client.clone();
                let cancelled = &cancelled;
                let count = chunk.len();
                let handle = scope.spawn(move || {
                    let mut entries = Vec::with_capacity(chunk.len());
                    let mut failures = 0usize;
                    for (id, url) in chunk {
                        if cancelled.load(Ordering::Relaxed) || Instant::now() >= deadline {
                            cancelled.store(true, Ordering::Relaxed);
                            failures += chunk.len() - entries.len() - failures;
                            break;
                        }
                        let Ok(raw) = net::get_text_for_limit(
                            &client,
                            url,
                            RemoteSource::GitHubRaw,
                            CATALOG_DOCUMENT_MAX_BYTES,
                        ) else {
                            failures += 1;
                            continue;
                        };
                        match catalog_entry_from_json(id, &raw) {
                            Ok(entry) => entries.push(entry),
                            Err(_) => failures += 1,
                        }
                    }
                    (entries, failures)
                });
                (count, handle)
            })
            .collect::<Vec<_>>();

        let mut entries = BTreeMap::new();
        let mut failures = 0usize;
        for (count, handle) in handles {
            let Ok((batch, failed)) = handle.join() else {
                // A panicked worker forfeits its whole chunk.
                failures += count;
                continue;
            };
            for entry in batch {
                entries.insert(entry.id.to_ascii_lowercase(), entry);
            }
            failures += failed;
        }
        (entries.into_values().collect::<Vec<_>>(), failures)
    });

    if failures * 2 > documents.len() {
        return Err(format!(
            "The HUD catalog could not be read ({failures} of {} documents failed).",
            documents.len()
        ));
    }
    Ok((entries, failures))
}

pub fn catalog_entry(id: &str) -> Result<HudCatalogEntry, String> {
    let entries = load_or_fetch_catalog(false)?;
    entries
        .into_iter()
        .find(|entry| entry.id.eq_ignore_ascii_case(id))
        .ok_or_else(|| format!("hud-db has no HUD named {id}."))
}

/// The archive for any catalog entry the app can fetch mechanically. GitHub
/// stays the pinned codeload zip; the other hosts are resolved to a direct
/// file URL first (see `HudInstallKind`).
pub fn fetch_hud_archive(entry: &HudCatalogEntry) -> Result<Vec<u8>, String> {
    let url = resolve_hud_download(entry)?;
    let bytes = net::download_bytes(&url, HUD_ZIP_MAX_BYTES)?;
    if !archive_header_is_supported(&bytes) {
        return Err("The HUD download is not a ZIP or 7z archive.".into());
    }
    Ok(bytes)
}

fn archive_header_is_supported(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(&[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
}

/// One wording for the dead end every unfetchable HUD shares. The sites
/// differ in why there is no archive, never in what the user can do next.
pub const OPEN_AUTHORS_PAGE: &str = "open the author's page.";

/// A direct archive URL for the entry, or why there is none.
pub fn resolve_hud_download(entry: &HudCatalogEntry) -> Result<String, String> {
    match entry.install {
        HudInstallKind::Github => {
            if !valid_github_repo(&entry.repo) || !valid_git_sha(&entry.hash) {
                return Err("That HUD is not a pinned GitHub download.".into());
            }
            let url = execs_core::hud_zip_url(&entry.repo, &entry.hash)
                .ok_or_else(|| "That HUD is not a pinned GitHub download.".to_string())?;
            net::validate_url_for(&url, RemoteSource::GitHubCodeload)?;
            Ok(url)
        }
        HudInstallKind::Direct => direct_download_url(&entry.repo),
        HudInstallKind::Gamebanana => crate::gamebanana::download_url_for_page(&entry.repo),
        HudInstallKind::Thread => resolve_thread(&entry.repo),
        HudInstallKind::None => Err(no_download_message()),
    }
}

fn valid_github_repo(repo: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(repo.trim()) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let Some(mut parts) = url.path_segments() else {
        return false;
    };
    let owner = parts.next().unwrap_or_default();
    let raw_repo = parts.next().unwrap_or_default();
    let repo = raw_repo.strip_suffix(".git").unwrap_or(raw_repo);
    !owner.is_empty()
        && !repo.is_empty()
        && owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        && repo.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte == b'.'
        })
        && parts.all(|part| part.is_empty())
}

/// Why a catalog entry cannot be installed. `install_hud_from_catalog`
/// refuses these before any fetch, so it is the message the user sees.
pub fn no_download_message() -> String {
    format!("That HUD has no download this app can fetch — {OPEN_AUTHORS_PAGE}")
}

/// Validate a Dropbox archive link and force its preview switch to `dl=1`.
pub fn direct_download_url(url: &str) -> Result<String, String> {
    let mut parsed = net::validate_url_for(url, RemoteSource::Dropbox)?;
    let lower = parsed.path().to_ascii_lowercase();
    if !lower.ends_with(".zip") && !lower.ends_with(".7z") {
        return Err("That Dropbox link is not a ZIP or 7z archive.".into());
    }
    let mut query: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(key, _)| key != "dl")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    query.push(("dl".into(), "1".into()));
    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.query_pairs_mut().extend_pairs(query);
    Ok(parsed.to_string())
}

/// A teamfortress.tv thread: the last Dropbox archive link posted by the
/// original author. Replies are not trusted to replace an install source.
fn resolve_thread(repo: &str) -> Result<String, String> {
    net::validate_url_for(repo, RemoteSource::TeamFortressTv)?;
    let html = net::get_text_for(
        &net::api_client()?,
        repo.trim(),
        RemoteSource::TeamFortressTv,
    )
    .map_err(|err| format!("Could not read that thread ({err})"))?;
    thread_download_link(&html)
        .and_then(|link| direct_download_url(&link).ok())
        .ok_or_else(|| {
            format!("That thread has no Dropbox download this app can fetch — {OPEN_AUTHORS_PAGE}")
        })
}

fn thread_download_link(html: &str) -> Option<String> {
    let posts = post_slices(html);
    let first = posts.first()?;
    let author = post_author(first)?;
    let mut best: Option<String> = None;
    for post in posts {
        if post_author(post).as_deref() != Some(author.as_str()) {
            continue;
        }
        let Some(body) = post_body(post) else {
            continue;
        };
        for href in anchor_hrefs(body) {
            let href = decode_html_attr(&href);
            let Ok(url) = net::validate_url_for(&href, RemoteSource::Dropbox) else {
                continue;
            };
            let path = url.path().to_ascii_lowercase();
            if path.ends_with(".zip") || path.ends_with(".7z") {
                best = Some(url.to_string());
            }
        }
    }
    best
}

fn post_slices(html: &str) -> Vec<&str> {
    let lower = html.to_ascii_lowercase();
    let mut starts = Vec::new();
    let mut at = 0usize;
    while let Some(relative) = lower[at..].find("<div") {
        let start = at + relative;
        let Some(end) = lower[start..].find('>').map(|end| start + end + 1) else {
            break;
        };
        let tag = &html[start..end];
        if tag_attr(tag, "class").is_some_and(|classes| class_has(classes, "post"))
            && tag_attr(tag, "id").is_some_and(|id| {
                id.strip_prefix("post-id-")
                    .is_some_and(|id| id.bytes().all(|byte| byte.is_ascii_digit()))
            })
        {
            starts.push(start);
        }
        at = end;
    }
    starts
        .iter()
        .enumerate()
        .map(|(index, start)| &html[*start..starts.get(index + 1).copied().unwrap_or(html.len())])
        .collect()
}

fn post_author(post: &str) -> Option<String> {
    tags(post, "a").find_map(|tag| {
        tag_attr(tag, "class")
            .filter(|classes| class_has(classes, "post-author"))
            .and_then(|_| tag_attr(tag, "href"))
            .map(decode_html_attr)
    })
}

fn post_body(post: &str) -> Option<&str> {
    let body_tag = tags(post, "div").find(|tag| {
        tag_attr(tag, "class").is_some_and(|classes| class_has(classes, "post-body"))
    })?;
    let body_start = post.find(body_tag)? + body_tag.len();
    let rest = &post[body_start..];
    let hidden = tags(rest, "div")
        .find(|tag| {
            tag_attr(tag, "class").is_some_and(|classes| class_has(classes, "post-body-hidden"))
        })
        .and_then(|tag| rest.find(tag))
        .unwrap_or(rest.len());
    Some(&rest[..hidden])
}

fn anchor_hrefs(html: &str) -> impl Iterator<Item = String> + '_ {
    tags(html, "a").filter_map(|tag| tag_attr(tag, "href").map(str::to_string))
}

fn tags<'a>(html: &'a str, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
    let needle = format!("<{name}");
    let lower = html.to_ascii_lowercase();
    let mut at = 0usize;
    std::iter::from_fn(move || {
        let relative = lower[at..].find(&needle)?;
        let start = at + relative;
        let end = lower[start..].find('>').map(|end| start + end + 1)?;
        at = end;
        Some(&html[start..end])
    })
}

fn class_has(classes: &str, wanted: &str) -> bool {
    classes
        .split_ascii_whitespace()
        .any(|class| class == wanted)
}

fn tag_attr<'a>(tag: &'a str, wanted: &str) -> Option<&'a str> {
    let bytes = tag.as_bytes();
    let mut at = 1usize;
    while at < bytes.len() && !bytes[at].is_ascii_whitespace() && bytes[at] != b'>' {
        at += 1;
    }
    while at < bytes.len() {
        while at < bytes.len() && (bytes[at].is_ascii_whitespace() || bytes[at] == b'/') {
            at += 1;
        }
        let key_start = at;
        while at < bytes.len()
            && !bytes[at].is_ascii_whitespace()
            && !matches!(bytes[at], b'=' | b'>' | b'/')
        {
            at += 1;
        }
        let key = &tag[key_start..at];
        while at < bytes.len() && bytes[at].is_ascii_whitespace() {
            at += 1;
        }
        if bytes.get(at) != Some(&b'=') {
            if bytes.get(at) == Some(&b'>') {
                break;
            }
            continue;
        }
        at += 1;
        while at < bytes.len() && bytes[at].is_ascii_whitespace() {
            at += 1;
        }
        let quote = bytes
            .get(at)
            .copied()
            .filter(|byte| matches!(byte, b'\'' | b'"'));
        if quote.is_some() {
            at += 1;
        }
        let value_start = at;
        while at < bytes.len()
            && match quote {
                Some(quote) => bytes[at] != quote,
                None => !bytes[at].is_ascii_whitespace() && bytes[at] != b'>',
            }
        {
            at += 1;
        }
        let value = &tag[value_start..at];
        if quote.is_some() && at < bytes.len() {
            at += 1;
        }
        if key.eq_ignore_ascii_case(wanted) {
            return Some(value);
        }
    }
    None
}

fn decode_html_attr(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&#x26;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

// ---------------------------------------------------------------------------
// Screenshot albums
// ---------------------------------------------------------------------------

/// One picture from a HUD's external album, resolved to a direct image URL
/// the lightbox can load (the CSP allows i.imgur.com and GitHub raw hosts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumImage {
    pub url: String,
    #[serde(default)]
    pub thumb: Option<String>,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
}

/// The album behind `social.album`, cached forever by URL (albums are
/// effectively immutable once published; a refresh is a catalog refresh).
pub fn fetch_hud_album(album: &str) -> Result<Vec<AlbumImage>, String> {
    let root = execs_core::try_execs_data_dir()?;
    let cache = root.join("hud-catalog").join("albums").join(format!(
        "{}.json",
        execs_core::hash::sha256_hex(album.as_bytes())
    ));
    if let Ok(bytes) = net::read_cache_file_capped(&root, &cache, ALBUM_CACHE_MAX_BYTES) {
        if let Ok(images) = serde_json::from_slice::<Vec<AlbumImage>>(&bytes) {
            if valid_album_images(&images) {
                return Ok(images);
            }
        }
    }
    let images = fetch_album_uncached(album)?;
    if !valid_album_images(&images) {
        return Err("That album contains no safe image URLs.".into());
    }
    let text = serde_json::to_string(&images).map_err(|err| err.to_string())?;
    net::write_cache_file_within(&root, &cache, text.as_bytes())
        .map_err(|err| format!("Could not save the HUD album ({err})."))?;
    Ok(images)
}

fn valid_album_images(images: &[AlbumImage]) -> bool {
    !images.is_empty()
        && images.len() <= MAX_ALBUM_IMAGES
        && images.iter().all(|image| {
            safe_image_url(&image.url)
                && image.thumb.as_deref().is_none_or(safe_image_url)
                && image.width <= 16_384
                && image.height <= 16_384
        })
}

fn safe_image_url(url: &str) -> bool {
    if url.len() > MAX_ALBUM_URL_BYTES {
        return false;
    }
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https"
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return false;
    }
    matches!(
        parsed.host_str(),
        Some("i.imgur.com" | "raw.githubusercontent.com")
    )
}

fn fetch_album_uncached(album: &str) -> Result<Vec<AlbumImage>, String> {
    let trimmed = album.trim();
    if imgur_album_id(trimmed).is_some() {
        // Reading an album needs a registered imgur client id, which this app
        // does not ship; the lightbox offers the album as a browser link.
        return Err("Imgur albums open in your browser.".into());
    }
    if let Some(id) = imgur_image_id(trimmed) {
        let ext = trimmed.rsplit('.').next().unwrap_or("jpg");
        return Ok(vec![AlbumImage {
            url: format!("https://i.imgur.com/{id}.{ext}"),
            thumb: Some(format!("https://i.imgur.com/{id}l.{ext}")),
            width: 0,
            height: 0,
        }]);
    }
    if let Some(raw) = github_blob_to_raw(trimmed) {
        let text = net::get_text_for(&net::api_client()?, &raw, RemoteSource::GitHubRaw)?;
        let images = markdown_images(&text, &raw);
        if images.is_empty() {
            return Err("That showcase page has no images.".into());
        }
        return Ok(images);
    }
    Err("That album is on a site this app cannot read in-app.".into())
}

/// `imgur.com/a/<id>`, `imgur.com/a/<slug>-<id>`, `imgur.com/gallery/<slug>-<id>`.
pub fn imgur_album_id(url: &str) -> Option<String> {
    let lower = url.to_ascii_lowercase();
    if !lower.contains("imgur.com/") {
        return None;
    }
    let path = url.split("imgur.com/").nth(1)?;
    let mut parts = path
        .split(['?', '#'])
        .next()?
        .trim_end_matches('/')
        .split('/');
    let kind = parts.next()?;
    if kind != "a" && kind != "gallery" {
        return None;
    }
    let last = parts.next_back()?;
    let id = last.rsplit('-').next()?;
    if (5..=7).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        Some(id.to_string())
    } else {
        None
    }
}

/// `i.imgur.com/<id>.<ext>` — a single image linked as the whole album.
pub fn imgur_image_id(url: &str) -> Option<String> {
    let rest = url.split("i.imgur.com/").nth(1)?;
    let file = rest.split(['?', '#', '/']).next()?;
    let (id, _ext) = file.rsplit_once('.')?;
    if (5..=7).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        Some(id.to_string())
    } else {
        None
    }
}

/// `github.com/<o>/<r>/blob/<branch>/<path>` → the raw file URL.
pub fn github_blob_to_raw(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url.trim()).ok()?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let mut parts = parsed.path_segments()?;
    let owner = parts.next()?;
    let repo = parts.next()?;
    if parts.next()? != "blob" {
        return None;
    }
    let branch = parts.next()?;
    let path = parts.collect::<Vec<_>>().join("/");
    if owner.is_empty() || repo.is_empty() || branch.is_empty() || path.is_empty() {
        return None;
    }
    let raw = format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}");
    net::validate_url_for(&raw, RemoteSource::GitHubRaw)
        .ok()
        .map(|url| url.to_string())
}

/// Image URLs out of a markdown showcase page — `![alt](src)` and
/// `<img src="…">` — resolved against the page's raw URL.
pub fn markdown_images(text: &str, base: &str) -> Vec<AlbumImage> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |src: &str| {
        if out.len() > MAX_ALBUM_IMAGES {
            return;
        }
        let src = src.trim().trim_matches('"').trim_matches('\'');
        if src.is_empty() || src.len() > MAX_ALBUM_URL_BYTES {
            return;
        }
        let url = resolve_relative(src, base);
        if url.len() > MAX_ALBUM_URL_BYTES {
            return;
        }
        let lower = url.to_ascii_lowercase();
        let is_image = [".png", ".jpg", ".jpeg", ".webp", ".gif"]
            .iter()
            .any(|ext| lower.split(['?', '#']).next().unwrap_or("").ends_with(ext));
        if is_image && seen.insert(url.clone()) {
            out.push(AlbumImage {
                url,
                thumb: None,
                width: 0,
                height: 0,
            });
        }
    };
    let bytes = text.as_bytes();
    let mut index = 0;
    while index + 1 < bytes.len() {
        if bytes[index] != b'!' || bytes[index + 1] != b'[' {
            index += 1;
            continue;
        }
        let end = bytes
            .len()
            .min(index.saturating_add(MAX_MARKDOWN_IMAGE_TOKEN_BYTES));
        let mut cursor = index + 2;
        let mut open = None;
        while cursor + 1 < end {
            if bytes[cursor] == b']' && bytes[cursor + 1] == b'(' {
                open = Some(cursor + 2);
                break;
            }
            cursor += 1;
        }
        let Some(start) = open else {
            index = end;
            continue;
        };
        let close_limit = end.min(start.saturating_add(MAX_ALBUM_URL_BYTES + 1));
        let mut close = start;
        while close < close_limit && bytes[close] != b')' {
            close += 1;
        }
        if close < close_limit {
            let src = text[start..close].split_whitespace().next().unwrap_or("");
            push(src);
            index = close + 1;
        } else {
            index = end;
        }
    }
    let mut index = 0;
    while index + 4 <= bytes.len() {
        if &bytes[index..index + 4] != b"src=" {
            index += 1;
            continue;
        }
        let rest = &text[index + 4..];
        let quote = rest.chars().next();
        let src = match quote {
            Some('"') | Some('\'') => {
                let q = quote.unwrap();
                rest[1..].split(q).next().unwrap_or("")
            }
            _ => rest
                .split(|c: char| c.is_whitespace() || c == '>')
                .next()
                .unwrap_or(""),
        };
        push(src);
        index = index.saturating_add(4 + src.len().max(1));
    }
    out
}

fn resolve_relative(src: &str, base: &str) -> String {
    if src.starts_with("http://") || src.starts_with("https://") {
        // GitHub blob links inside a showcase page still need the raw host.
        return github_blob_to_raw(src).unwrap_or_else(|| src.to_string());
    }
    let dir = base.rsplit_once('/').map(|(dir, _)| dir).unwrap_or(base);
    let mut path = dir.to_string();
    let mut src = src;
    while let Some(rest) = src.strip_prefix("./") {
        src = rest;
    }
    while let Some(rest) = src.strip_prefix("../") {
        src = rest;
        if let Some((parent, _)) = path.rsplit_once('/') {
            path = parent.to_string();
        }
    }
    format!("{path}/{src}")
}

pub fn fetch_hud_schema(id: &str) -> Result<String, String> {
    let file = schema_file_name(id).ok_or_else(|| {
        "This HUD has no in-app options. Use the author’s page for extras.".to_string()
    })?;
    let root = execs_core::try_execs_data_dir()?;
    let cache = root
        .join("hud-catalog")
        .join("schemas")
        .join(format!("{SCHEMA_COMMIT}-{file}"));
    // "Not empty" was the whole validity check before; a truncated or
    // half-written cache file then broke the options pane for good. Parse it.
    if let Ok(bytes) = net::read_cache_file_capped(&root, &cache, SCHEMA_CACHE_MAX_BYTES) {
        if let Ok(text) = String::from_utf8(bytes) {
            if execs_core::parse_hud_schema(&text).is_ok() {
                return Ok(text);
            }
        }
    }
    let url = format!("{RAW_SCHEMA_BASE}/{SCHEMA_COMMIT}/src/HUDEditor/JSON/{file}");
    let bytes = net::download_bytes_for(&url, SCHEMA_CACHE_MAX_BYTES, RemoteSource::GitHubRaw)?;
    let text =
        String::from_utf8(bytes).map_err(|_| "The HUD options schema is not UTF-8.".to_string())?;
    execs_core::parse_hud_schema(&text).map_err(|err| {
        format!(
            "The HUD options schema could not be read ({}).",
            err.message()
        )
    })?;
    // Atomic: the validity check above is what a half-written file would
    // otherwise fail on every start.
    net::write_cache_file_within(&root, &cache, text.as_bytes())
        .map_err(|err| format!("Could not save the HUD options schema ({err})."))?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_documents_only_selects_top_level_hud_json_blobs() {
        let commit = "0123456789abcdef0123456789abcdef01234567";
        let tree = vec![
            GitTreeEntry {
                path: "hud-data/rayshud.json".into(),
                kind: "blob".into(),
            },
            GitTreeEntry {
                path: "hud-data/nested/ignored.json".into(),
                kind: "blob".into(),
            },
            GitTreeEntry {
                path: "hud-data/readme.md".into(),
                kind: "blob".into(),
            },
            GitTreeEntry {
                path: "hud-data/folder.json".into(),
                kind: "tree".into(),
            },
        ];

        let documents = catalog_documents(commit, &tree);
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].0, "rayshud");
        assert_eq!(
            documents[0].1,
            "https://raw.githubusercontent.com/mastercomfig/hud-db/0123456789abcdef0123456789abcdef01234567/hud-data/rayshud.json"
        );
        assert!(catalog_documents("main", &tree).is_empty());
    }

    #[test]
    fn dropbox_links_are_forced_to_direct_download() {
        assert_eq!(
            direct_download_url("https://www.dropbox.com/s/x/Hud.7z?dl=0").unwrap(),
            "https://www.dropbox.com/s/x/Hud.7z?dl=1"
        );
        assert_eq!(
            direct_download_url("https://www.dropbox.com/scl/fi/a/b.7z?rlkey=k&dl=1").unwrap(),
            "https://www.dropbox.com/scl/fi/a/b.7z?rlkey=k&dl=1"
        );
        assert_eq!(
            direct_download_url("https://www.dropbox.com/s/x/Hud.7z").unwrap(),
            "https://www.dropbox.com/s/x/Hud.7z?dl=1"
        );
        assert!(direct_download_url("https://example.com/hud.zip").is_err());
        assert!(direct_download_url("http://www.dropbox.com/s/x/Hud.7z").is_err());
        assert!(direct_download_url("https://www.dropbox.com/s/x/not-an-archive").is_err());
    }

    #[test]
    fn a_thread_yields_only_the_last_archive_anchor_by_the_original_author() {
        let html = r#"
        <div id="post-id-1" class="post self">
          <a class="post-author" href="/user/owner">owner</a>
          <div class="post-body"><a href="https://www.dropbox.com/s/aaa/Old.7z?dl=0">old</a></div>
          <div class="post-body-hidden">https://www.dropbox.com/s/hidden/Hidden.zip</div>
        </div>
        <div class="post" id="post-id-2">
          <a href="/user/attacker" class="post-author">attacker</a>
          <div class="post-body"><a href="https://www.dropbox.com/s/evil/Evil.zip">evil</a></div>
        </div>
        <div class="post" id="post-id-3">
          <a href="/user/owner" class="post-author">owner</a>
          <div class="post-body">plain https://www.dropbox.com/s/text/Text.zip
            <a title="new" href='https://www.dropbox.com/s/bbb/New.7z?dl=0&amp;x=1'>new</a>
          </div>
        </div>"#;
        assert_eq!(
            thread_download_link(html).as_deref(),
            Some("https://www.dropbox.com/s/bbb/New.7z?dl=0&x=1")
        );
        assert!(thread_download_link("<p>nothing here</p>").is_none());
    }

    #[test]
    fn imgur_ids_come_out_of_every_album_spelling() {
        assert_eq!(
            imgur_album_id("https://imgur.com/a/aJ1K5").as_deref(),
            Some("aJ1K5")
        );
        assert_eq!(
            imgur_album_id("https://imgur.com/a/MpISq3D/").as_deref(),
            Some("MpISq3D")
        );
        assert_eq!(
            imgur_album_id("https://imgur.com/a/isa-hud-MpISq3D").as_deref(),
            Some("MpISq3D")
        );
        assert_eq!(
            imgur_album_id("https://imgur.com/gallery/ahud-cc-9npCWPa").as_deref(),
            Some("9npCWPa")
        );
        assert_eq!(imgur_album_id("https://i.imgur.com/UnERCnT.jpg"), None);
        assert_eq!(
            imgur_image_id("https://i.imgur.com/UnERCnT.jpg").as_deref(),
            Some("UnERCnT")
        );
        assert_eq!(imgur_album_id("https://ibb.co/album/dwngXw"), None);
    }

    #[test]
    fn showcase_pages_resolve_to_raw_image_urls() {
        assert_eq!(
            github_blob_to_raw("https://github.com/o/r/blob/screenshots/showcase.md").as_deref(),
            Some("https://raw.githubusercontent.com/o/r/screenshots/showcase.md")
        );
        assert_eq!(github_blob_to_raw("https://github.com/o/r"), None);
        let base = "https://raw.githubusercontent.com/o/r/screenshots/showcase.md";
        let md = "# Showcase\n![hud](./main.png)\n![again](main.png)\n<img src=\"sub/menu.jpg\">\n![abs](https://github.com/o/r/blob/screenshots/x.webp?raw=true)\n[link](notes.md)";
        let images = markdown_images(md, base);
        let urls: Vec<&str> = images.iter().map(|img| img.url.as_str()).collect();
        assert_eq!(
            urls,
            vec![
                "https://raw.githubusercontent.com/o/r/screenshots/main.png",
                "https://raw.githubusercontent.com/o/r/screenshots/x.webp",
                "https://raw.githubusercontent.com/o/r/screenshots/sub/menu.jpg",
            ]
        );
    }

    #[test]
    fn showcase_parsing_is_bounded_for_hostile_markdown() {
        let base = "https://raw.githubusercontent.com/o/r/main/showcase.md";
        let many = (0..400)
            .map(|index| format!("![x](image-{index}.png)"))
            .collect::<String>();
        assert_eq!(
            markdown_images(&many, base).len(),
            MAX_ALBUM_IMAGES + 1,
            "one overflow sentinel makes the album validator reject the page"
        );
        let unmatched = "![".repeat(100_000);
        assert!(markdown_images(&unmatched, base).is_empty());
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("execs-hud-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(id: &str) -> HudCatalogEntry {
        catalog_entry_from_json(
            id,
            r#"{"name":"Rays","author":"r","repo":"https://github.com/o/r","hash":"abc"}"#,
        )
        .unwrap()
    }

    #[test]
    fn a_partial_catalog_cache_never_stands_in_for_a_refresh() {
        let whole = CatalogCache {
            tree_sha: "sha1".into(),
            entries: vec![entry("rayshud")],
            failures: 0,
            fetched_at: 1,
        };
        assert!(whole.covers("sha1"));
        assert!(!whole.covers("sha2"), "a new tree is a new catalog");

        // 49% of documents failed: tolerated, used, but not "done".
        let partial = CatalogCache {
            failures: 90,
            ..whole.clone()
        };
        assert!(!partial.covers("sha1"));

        let empty = CatalogCache {
            entries: Vec::new(),
            ..whole
        };
        assert!(!empty.covers("sha1"));
    }

    #[test]
    fn the_catalog_cache_round_trips_and_reads_core_shaped_files() {
        let dir = temp_dir("catalog-cache");
        let old_sha = "0123456789abcdef0123456789abcdef01234567";
        let new_sha = "89abcdef0123456789abcdef0123456789abcdef";
        // A file written before `failures` existed (core's own shape).
        let old = execs_core::HudCatalogCache {
            tree_sha: old_sha.into(),
            entries: vec![entry("rayshud")],
        };
        std::fs::write(
            catalog_cache_file(&dir),
            serde_json::to_string(&old).unwrap(),
        )
        .unwrap();
        let loaded = load_catalog_cache(&dir, &dir).unwrap().unwrap();
        assert_eq!(loaded.failures, 0, "an old cache loads as complete");
        assert_eq!(loaded.fetched_at, 0);
        assert!(loaded.covers(old_sha));

        let partial = CatalogCache {
            tree_sha: new_sha.into(),
            entries: vec![entry("budhud")],
            failures: 3,
            fetched_at: 7,
        };
        save_catalog_cache(&dir, &dir, &partial).unwrap();
        assert_eq!(load_catalog_cache(&dir, &dir).unwrap().unwrap(), partial);
        // Core still reads the same file, and the write left no part file.
        let by_core = execs_core::load_catalog_cache_from(&dir).unwrap();
        assert_eq!(by_core.tree_sha, new_sha);
        assert_eq!(by_core.entries.len(), 1);
        let left: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|item| item.unwrap().file_name())
            .collect();
        assert_eq!(left.len(), 1, "{left:?}");
    }

    #[test]
    fn the_schema_url_and_cache_name_are_both_pinned_to_the_commit() {
        let url = format!("{RAW_SCHEMA_BASE}/{SCHEMA_COMMIT}/src/HUDEditor/JSON/rayshud.json");
        assert!(url.contains(SCHEMA_COMMIT));
        assert!(!url.contains("/master/"));
    }

    #[test]
    fn recursive_tree_responses_must_be_complete_and_commit_addressable() {
        let complete: GitTree = serde_json::from_str(
            r#"{"sha":"0123456789abcdef0123456789abcdef01234567","truncated":false,"tree":[]}"#,
        )
        .unwrap();
        assert!(!complete.truncated);
        assert!(valid_git_sha(&complete.sha));
        let truncated: GitTree = serde_json::from_str(
            r#"{"sha":"0123456789abcdef0123456789abcdef01234567","truncated":true,"tree":[]}"#,
        )
        .unwrap();
        assert!(truncated.truncated);
        assert!(!valid_git_sha("main"));
        assert!(!valid_git_sha(&"A".repeat(40)));
    }

    #[test]
    fn github_hud_sources_require_https_exact_repo_and_full_commit() {
        assert!(valid_github_repo("https://github.com/owner/repo"));
        assert!(valid_github_repo("https://github.com/owner/repo.git"));
        assert!(!valid_github_repo("http://github.com/owner/repo"));
        assert!(!valid_github_repo(
            "https://github.com.evil.test/owner/repo"
        ));
        assert!(!valid_github_repo("https://github.com/owner/repo/archive"));
    }

    /// These are the two teamfortress.tv URLs currently published by hud-db.
    /// The live server now returns unrelated, reply-bearing threads at those
    /// ids. The parser sees the whole page but must not promote a reply into
    /// an install source. Kept ignored so ordinary CI remains offline.
    #[test]
    #[ignore = "live network regression"]
    fn stale_live_thread_ids_do_not_resolve_a_reply_as_a_hud_download() {
        for (url, author) in [
            (
                "https://www.teamfortress.tv/59350/flawhud",
                "/user/RAONICALIAS",
            ),
            ("https://www.teamfortress.tv/63029/quartz", "/user/fyg"),
        ] {
            let html = net::get_text_for(
                &net::api_client().unwrap(),
                url,
                RemoteSource::TeamFortressTv,
            )
            .unwrap();
            let posts = post_slices(&html);
            assert!(
                posts.len() > 1,
                "live response should include replies: {url}"
            );
            assert_eq!(post_author(posts[0]).as_deref(), Some(author));
            assert_eq!(thread_download_link(&html), None);
        }
    }
}
