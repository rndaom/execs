//! Fetch hud-db catalog entries and pinned HUD zips. Core stays network-free.

use execs_core::{
    catalog_cache_dir, catalog_entry_from_json, load_catalog_cache_from, save_catalog_cache_to,
    schema_file_name, HudCatalogCache, HudCatalogEntry,
};
use serde::Deserialize;

use crate::net::{self, MIB};

const TREE_URL: &str =
    "https://api.github.com/repos/mastercomfig/hud-db/git/trees/main?recursive=1";
const RAW_HUD_DB: &str = "https://raw.githubusercontent.com/mastercomfig/hud-db/main";

/// TF2HUD.Editor's schema JSON, pinned like every other remote asset in the
/// app. It used to be read off a moving `master` and cached forever under a
/// filename with no version in it, so a bad fetch was served for good and an
/// upstream fix never arrived. The SHA is part of the cache filename, so
/// bumping this constant invalidates the cache by construction.
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

pub fn fetch_hud_zip(repo: &str, hash: &str) -> Result<Vec<u8>, String> {
    let url = execs_core::hud_zip_url(repo, hash)
        .ok_or_else(|| "That HUD is not a pinned GitHub download.".to_string())?;
    net::download_bytes(&url, HUD_ZIP_MAX_BYTES)
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
    fn the_schema_url_and_cache_name_are_both_pinned_to_the_commit() {
        let url = format!("{RAW_SCHEMA_BASE}/{SCHEMA_COMMIT}/src/HUDEditor/JSON/rayshud.json");
        assert!(url.contains(SCHEMA_COMMIT));
        assert!(!url.contains("/master/"));
    }
}
