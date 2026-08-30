//! Fetch hud-db catalog entries and pinned HUD zips. Core stays network-free.

use execs_core::{
    catalog_cache_dir, catalog_entry_from_json, load_catalog_cache_from, save_catalog_cache_to,
    schema_file_name, HudCatalogCache, HudCatalogEntry,
};
use serde::Deserialize;

const USER_AGENT: &str = "execs";
const TREE_URL: &str = "https://api.github.com/repos/mastercomfig/hud-db/git/trees/main?recursive=1";
const RAW_HUD_DB: &str = "https://raw.githubusercontent.com/mastercomfig/hud-db/main";
const RAW_SCHEMA: &str =
    "https://raw.githubusercontent.com/CriticalFlaw/TF2HUD.Editor/master/src/HUDEditor/JSON";

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

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|err| err.to_string())
}

fn get_text(url: &str) -> Result<String, String> {
    let response = client()?.get(url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Could not download {url} ({})", response.status()));
    }
    response.text().map_err(|err| err.to_string())
}

pub fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    crate::comfig_fetch::download_bytes(url)
}

pub fn load_or_fetch_catalog(refresh: bool) -> Result<Vec<HudCatalogEntry>, String> {
    let dir = catalog_cache_dir();
    if !refresh {
        if let Some(cache) = load_catalog_cache_from(&dir) {
            return Ok(cache.entries);
        }
    }
    let tree: GitTree = client()?
        .get(TREE_URL)
        .send()
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| format!("Could not read hud-db ({err})"))?
        .json()
        .map_err(|err| err.to_string())?;
    if let Some(cache) = load_catalog_cache_from(&dir) {
        if cache.tree_sha == tree.sha && !cache.entries.is_empty() {
            return Ok(cache.entries);
        }
    }
    let mut entries = Vec::new();
    for item in tree.tree {
        if item.kind != "blob" {
            continue;
        }
        let Some(name) = item.path.strip_prefix("hud-data/") else {
            continue;
        };
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        let url = format!("{RAW_HUD_DB}/hud-data/{id}.json");
        let raw = get_text(&url)?;
        match catalog_entry_from_json(id, &raw) {
            Ok(entry) => entries.push(entry),
            Err(_) => continue,
        }
    }
    entries.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
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

pub fn catalog_entry(id: &str) -> Result<HudCatalogEntry, String> {
    let entries = load_or_fetch_catalog(false)?;
    entries
        .into_iter()
        .find(|entry| entry.id.eq_ignore_ascii_case(id))
        .ok_or_else(|| format!("hud-db has no HUD named {id}."))
}

pub fn fetch_hud_zip(repo: &str, hash: &str) -> Result<Vec<u8>, String> {
    let url = execs_core::hud_zip_url(repo, hash)
        .ok_or_else(|| "That HUD is not a pinned GitHub download.".to_string())?;
    download_bytes(&url)
}

pub fn fetch_hud_schema(id: &str) -> Result<String, String> {
    let file = schema_file_name(id).ok_or_else(|| {
        "This HUD has no in-app options. Use the author’s page for extras.".to_string()
    })?;
    let cache = catalog_cache_dir().join("schemas").join(file);
    if let Ok(text) = std::fs::read_to_string(&cache) {
        if !text.is_empty() {
            return Ok(text);
        }
    }
    let url = format!("{RAW_SCHEMA}/{file}");
    let text = get_text(&url)?;
    if let Some(parent) = cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&cache, &text);
    Ok(text)
}
