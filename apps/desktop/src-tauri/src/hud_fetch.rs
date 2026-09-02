//! Fetch hud-db catalog entries and pinned HUD zips. Core stays network-free.

use execs_core::{
    catalog_cache_dir, catalog_entry_from_json, load_catalog_cache_from, save_catalog_cache_to,
    schema_file_name, HudCatalogCache, HudCatalogEntry, HudInstallKind,
};
use serde::{Deserialize, Serialize};

use crate::net::{self, MIB};

const TREE_URL: &str =
    "https://api.github.com/repos/mastercomfig/hud-db/git/trees/main?recursive=1";
const RAW_HUD_DB: &str = "https://raw.githubusercontent.com/mastercomfig/hud-db/main";

/// TF2HUD.Editor's schema JSON, pinned like every other remote asset in the
/// app. Read off a moving `master` and cached under a filename with no version
/// in it, a bad fetch is served for good and an upstream fix never arrives.
/// The SHA is part of the cache filename, so bumping this constant invalidates
/// the cache by construction.
const SCHEMA_COMMIT: &str = "17bccd15d818d12707ce89574318acbc23c85a9f";
const RAW_SCHEMA_BASE: &str = "https://raw.githubusercontent.com/CriticalFlaw/TF2HUD.Editor";

const CATALOG_WORKERS: usize = 12;

/// HUD repos are big (budhud is ~200 MB unpacked) but nothing legitimate on
/// hud-db approaches this.
const HUD_ZIP_MAX_BYTES: u64 = 512 * MIB;

#[derive(Debug, Deserialize)]
struct GitTree {
    sha: String,
    tree: Vec<GitTreeEntry>,
}

#[derive(Debug, Deserialize)]
struct GitTreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

pub fn load_or_fetch_catalog(refresh: bool) -> Result<Vec<HudCatalogEntry>, String> {
    let dir = catalog_cache_dir();
    if !refresh {
        if let Some(cache) = load_catalog_cache_from(&dir) {
            return Ok(cache.entries);
        }
    }
    let client = net::api_client()?;
    let tree: GitTree =
        net::get_json(&client, TREE_URL).map_err(|err| format!("Could not read hud-db ({err})"))?;
    if let Some(cache) = load_catalog_cache_from(&dir) {
        if cache.tree_sha == tree.sha && !cache.entries.is_empty() {
            return Ok(cache.entries);
        }
    }
    let documents = catalog_documents(&tree.tree);
    let mut entries = fetch_catalog_entries(&client, &documents)?;
    entries.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    save_catalog_cache_to(
        &dir,
        &HudCatalogCache {
            tree_sha: tree.sha,
            entries: entries.clone(),
        },
    )
    .map_err(|err| err.message())?;
    Ok(entries)
}

fn catalog_documents(tree: &[GitTreeEntry]) -> Vec<(String, String)> {
    tree.iter()
        .filter_map(|item| {
            if item.kind != "blob" {
                return None;
            }
            let name = item.path.strip_prefix("hud-data/")?;
            let id = name.strip_suffix(".json")?;
            if id.contains('/') {
                return None;
            }
            Some((id.to_string(), format!("{RAW_HUD_DB}/hud-data/{id}.json")))
        })
        .collect()
}

/// A refresh fans ~200 requests at raw.githubusercontent.com across 12
/// workers, so a single 429 or timeout is likely. Losing one document must
/// not cost the user the other 199 — failures are skipped and counted, and
/// only a majority failure is treated as "the refresh did not work".
fn fetch_catalog_entries(
    client: &reqwest::blocking::Client,
    documents: &[(String, String)],
) -> Result<Vec<HudCatalogEntry>, String> {
    if documents.is_empty() {
        return Ok(Vec::new());
    }
    let worker_count = CATALOG_WORKERS.min(documents.len());
    let chunk_size = documents.len().div_ceil(worker_count);

    let (entries, failures) = std::thread::scope(|scope| {
        let handles = documents
            .chunks(chunk_size)
            .map(|chunk| {
                let client = client.clone();
                scope.spawn(move || {
                    let mut entries = Vec::with_capacity(chunk.len());
                    let mut failures = 0usize;
                    for (id, url) in chunk {
                        let Ok(raw) = net::get_text(&client, url) else {
                            failures += 1;
                            continue;
                        };
                        match catalog_entry_from_json(id, &raw) {
                            Ok(entry) => entries.push(entry),
                            // A malformed document is upstream's problem, not
                            // a transport failure — skip it without counting
                            // it against the majority rule.
                            Err(_) => continue,
                        }
                    }
                    (entries, failures)
                })
            })
            .collect::<Vec<_>>();

        let mut entries = Vec::with_capacity(documents.len());
        let mut failures = 0usize;
        for handle in handles {
            let Ok((batch, failed)) = handle.join() else {
                // A panicked worker forfeits its whole chunk.
                failures += chunk_size;
                continue;
            };
            entries.extend(batch);
            failures += failed;
        }
        (entries, failures)
    });

    if failures * 2 > documents.len() {
        return Err(format!(
            "The HUD catalog could not be read ({failures} of {} documents failed).",
            documents.len()
        ));
    }
    Ok(entries)
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
    Ok(bytes)
}

/// One wording for the dead end every unfetchable HUD shares. The sites
/// differ in why there is no archive, never in what the user can do next.
pub const OPEN_AUTHORS_PAGE: &str = "open the author's page.";

/// A direct archive URL for the entry, or why there is none.
pub fn resolve_hud_download(entry: &HudCatalogEntry) -> Result<String, String> {
    match entry.install {
        HudInstallKind::Github => execs_core::hud_zip_url(&entry.repo, &entry.hash)
            .ok_or_else(|| "That HUD is not a pinned GitHub download.".to_string()),
        HudInstallKind::Direct => Ok(direct_download_url(&entry.repo)),
        HudInstallKind::Gamebanana => crate::gamebanana::download_url_for_page(&entry.repo),
        HudInstallKind::Thread => resolve_thread(&entry.repo),
        HudInstallKind::None => Err(no_download_message()),
    }
}

/// Why a catalog entry cannot be installed. `install_hud_from_catalog`
/// refuses these before any fetch, so it is the message the user sees.
pub fn no_download_message() -> String {
    format!("That HUD has no download this app can fetch — {OPEN_AUTHORS_PAGE}")
}

/// Dropbox share links serve an HTML preview unless `dl=1` is asked for.
pub fn direct_download_url(url: &str) -> String {
    let trimmed = url.trim();
    if !trimmed.contains("dropbox.com") {
        return trimmed.to_string();
    }
    if trimmed.contains("dl=1") {
        return trimmed.to_string();
    }
    if trimmed.contains("dl=0") {
        return trimmed.replace("dl=0", "dl=1");
    }
    if trimmed.contains('?') {
        format!("{trimmed}&dl=1")
    } else {
        format!("{trimmed}?dl=1")
    }
}

/// A teamfortress.tv thread: the last Dropbox archive link in the post.
fn resolve_thread(repo: &str) -> Result<String, String> {
    let html = net::get_text(&net::api_client()?, repo.trim())
        .map_err(|err| format!("Could not read that thread ({err})"))?;
    thread_download_link(&html)
        .map(|link| direct_download_url(&link))
        .ok_or_else(|| {
            format!("That thread has no Dropbox download this app can fetch — {OPEN_AUTHORS_PAGE}")
        })
}

fn thread_download_link(html: &str) -> Option<String> {
    let mut best: Option<String> = None;
    for (index, _) in html.match_indices("https://www.dropbox.com/") {
        let rest = &html[index..];
        let end = rest
            .find(|c: char| c == '"' || c == '\'' || c == '<' || c == '>' || c.is_whitespace())
            .unwrap_or(rest.len());
        let link = rest[..end].replace("&amp;", "&");
        let lower = link.to_ascii_lowercase();
        let archive = lower.contains(".7z") || lower.contains(".zip");
        if archive {
            // Later links in a thread are newer edits; keep the last archive.
            best = Some(link);
        } else if best.is_none() {
            best = Some(link);
        }
    }
    best
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
    let cache = catalog_cache_dir().join("albums").join(format!(
        "{}.json",
        execs_core::hash::sha256_hex(album.as_bytes())
    ));
    if let Ok(text) = std::fs::read_to_string(&cache) {
        if let Ok(images) = serde_json::from_str::<Vec<AlbumImage>>(&text) {
            if !images.is_empty() {
                return Ok(images);
            }
        }
    }
    let images = fetch_album_uncached(album)?;
    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(&images) {
        let _ = std::fs::write(&cache, text);
    }
    Ok(images)
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
        let text = net::get_text(&net::api_client()?, &raw)?;
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
    let rest = url.split("github.com/").nth(1)?;
    let mut parts = rest.splitn(5, '/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if parts.next()? != "blob" {
        return None;
    }
    let branch = parts.next()?;
    let path = parts.next()?.split(['?', '#']).next()?;
    Some(format!(
        "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
    ))
}

/// Image URLs out of a markdown showcase page — `![alt](src)` and
/// `<img src="…">` — resolved against the page's raw URL.
pub fn markdown_images(text: &str, base: &str) -> Vec<AlbumImage> {
    let mut out = Vec::new();
    let mut push = |src: &str| {
        let src = src.trim().trim_matches('"').trim_matches('\'');
        if src.is_empty() {
            return;
        }
        let url = resolve_relative(src, base);
        let lower = url.to_ascii_lowercase();
        let is_image = [".png", ".jpg", ".jpeg", ".webp", ".gif"]
            .iter()
            .any(|ext| lower.split(['?', '#']).next().unwrap_or("").ends_with(ext));
        if is_image && !out.iter().any(|img: &AlbumImage| img.url == url) {
            out.push(AlbumImage {
                url,
                thumb: None,
                width: 0,
                height: 0,
            });
        }
    };
    for (index, _) in text.match_indices("![") {
        let rest = &text[index..];
        let Some(open) = rest.find("](") else {
            continue;
        };
        let after = &rest[open + 2..];
        let Some(close) = after.find(')') else {
            continue;
        };
        let src = after[..close].split_whitespace().next().unwrap_or("");
        push(src);
    }
    for (index, _) in text.match_indices("src=") {
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
    let cache = catalog_cache_dir()
        .join("schemas")
        .join(format!("{SCHEMA_COMMIT}-{file}"));
    // "Not empty" was the whole validity check before; a truncated or
    // half-written cache file then broke the options pane for good. Parse it.
    if let Ok(text) = std::fs::read_to_string(&cache) {
        if execs_core::parse_hud_schema(&text).is_ok() {
            return Ok(text);
        }
    }
    let url = format!("{RAW_SCHEMA_BASE}/{SCHEMA_COMMIT}/src/HUDEditor/JSON/{file}");
    let text = net::get_text(&net::api_client()?, &url)?;
    execs_core::parse_hud_schema(&text).map_err(|err| {
        format!(
            "The HUD options schema could not be read ({}).",
            err.message()
        )
    })?;
    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&cache, &text);
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_documents_only_selects_top_level_hud_json_blobs() {
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

        let documents = catalog_documents(&tree);
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].0, "rayshud");
        assert_eq!(
            documents[0].1,
            "https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-data/rayshud.json"
        );
    }

    #[test]
    fn dropbox_links_are_forced_to_direct_download() {
        assert_eq!(
            direct_download_url("https://www.dropbox.com/s/x/Hud.7z?dl=0"),
            "https://www.dropbox.com/s/x/Hud.7z?dl=1"
        );
        assert_eq!(
            direct_download_url("https://www.dropbox.com/scl/fi/a/b.7z?rlkey=k&dl=1"),
            "https://www.dropbox.com/scl/fi/a/b.7z?rlkey=k&dl=1"
        );
        assert_eq!(
            direct_download_url("https://www.dropbox.com/s/x/Hud.7z"),
            "https://www.dropbox.com/s/x/Hud.7z?dl=1"
        );
        assert_eq!(
            direct_download_url("https://example.com/hud.zip"),
            "https://example.com/hud.zip"
        );
    }

    #[test]
    fn a_thread_yields_its_last_dropbox_archive_link() {
        let html = r#"<a href="https://www.dropbox.com/s/aaa/Old.7z?dl=0">old</a>
        text <a href='https://www.dropbox.com/s/bbb/New.7z?dl=0&amp;x=1'>new</a>
        <a href="https://www.dropbox.com/sh/folder">folder</a>"#;
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
    fn the_schema_url_and_cache_name_are_both_pinned_to_the_commit() {
        let url = format!("{RAW_SCHEMA_BASE}/{SCHEMA_COMMIT}/src/HUDEditor/JSON/rayshud.json");
        assert!(url.contains(SCHEMA_COMMIT));
        assert!(!url.contains("/master/"));
    }
}
