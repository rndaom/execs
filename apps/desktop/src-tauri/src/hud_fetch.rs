//! Fetch hud-db catalog entries and pinned HUD zips. Core stays network-free.

use execs_core::{
    catalog_cache_dir, catalog_entry_from_json, load_catalog_cache_from, save_catalog_cache_to,
    schema_file_name, HudCatalogCache, HudCatalogEntry,
};
use serde::Deserialize;
use std::time::Duration;

const USER_AGENT: &str = "execs";
const TREE_URL: &str =
    "https://api.github.com/repos/mastercomfig/hud-db/git/trees/main?recursive=1";
const RAW_HUD_DB: &str = "https://raw.githubusercontent.com/mastercomfig/hud-db/main";
const RAW_SCHEMA: &str =
    "https://raw.githubusercontent.com/CriticalFlaw/TF2HUD.Editor/master/src/HUDEditor/JSON";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const CATALOG_WORKERS: usize = 12;

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
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|err| err.to_string())
}

fn get_text(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let response = client.get(url).send().map_err(request_error)?;
    if !response.status().is_success() {
        return Err(format!("Could not download {url} ({})", response.status()));
    }
    response.text().map_err(|err| err.to_string())
}

fn request_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "The request timed out. Check your connection and try again.".into()
    } else if err.is_connect() {
        "Could not connect. Check your connection and try again.".into()
    } else {
        format!("The download failed ({err})")
    }
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
    let client = client()?;
    let tree: GitTree = client
        .get(TREE_URL)
        .send()
        .map_err(request_error)?
        .error_for_status()
        .map_err(|err| format!("Could not read hud-db ({err})"))?
        .json()
        .map_err(|err| err.to_string())?;
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

fn fetch_catalog_entries(
    client: &reqwest::blocking::Client,
    documents: &[(String, String)],
) -> Result<Vec<HudCatalogEntry>, String> {
    if documents.is_empty() {
        return Ok(Vec::new());
    }
    let worker_count = CATALOG_WORKERS.min(documents.len());
    let chunk_size = (documents.len() + worker_count - 1) / worker_count;

    std::thread::scope(|scope| {
        let handles = documents
            .chunks(chunk_size)
            .map(|chunk| {
                let client = client.clone();
                scope.spawn(move || {
                    let mut entries = Vec::with_capacity(chunk.len());
                    for (id, url) in chunk {
                        let raw = get_text(&client, url)?;
                        if let Ok(entry) = catalog_entry_from_json(id, &raw) {
                            entries.push(entry);
                        }
                    }
                    Ok::<_, String>(entries)
                })
            })
            .collect::<Vec<_>>();

        let mut entries = Vec::with_capacity(documents.len());
        for handle in handles {
            let batch = handle
                .join()
                .map_err(|_| "The HUD catalog worker stopped unexpectedly.".to_string())??;
            entries.extend(batch);
        }
        Ok(entries)
    })
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
    let text = get_text(&client()?, &url)?;
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
}
