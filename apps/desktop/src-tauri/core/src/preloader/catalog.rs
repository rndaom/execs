//! Read cueki's pinned `mods.zip` into an addon / particle-mod catalog.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAddon {
    /// Folder name inside the library zip; the stable install id.
    pub id: String,
    /// Display name from mod.json (falls back to the folder name).
    pub name: String,
    pub kind: String,
    pub description: String,
    pub file_count: usize,
    pub bytes: u64,
    pub has_sound: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogParticleMod {
    pub name: String,
    pub pcf_files: Vec<String>,
    pub file_count: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModsCatalog {
    pub addons: Vec<CatalogAddon>,
    pub particle_mods: Vec<CatalogParticleMod>,
}

pub(crate) fn zip_archive(zip_path: &Path) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|err| format!("Could not open the mod library: {err}"))?;
    zip::ZipArchive::new(file).map_err(|err| format!("Could not read the mod library: {err}"))
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct ModJson {
    #[serde(default)]
    addon_name: String,
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    description: String,
}

/// Split a zip path into (top folder kind, mod name, inner path).
pub(crate) fn split_mod_path(name: &str) -> Option<(&str, &str, &str)> {
    let name = name.strip_prefix("mods/")?;
    let (kind, rest) = name.split_once('/')?;
    let (mod_name, inner) = rest.split_once('/')?;
    if mod_name.is_empty() {
        return None;
    }
    Some((kind, mod_name, inner))
}

pub fn read_mods_catalog(zip_path: &Path) -> Result<ModsCatalog, String> {
    let mut archive = zip_archive(zip_path)?;
    let mut addon_meta: BTreeMap<String, ModJson> = BTreeMap::new();
    let mut addon_stats: BTreeMap<String, (usize, u64, bool)> = BTreeMap::new();
    let mut particle_stats: BTreeMap<String, (Vec<String>, usize, u64)> = BTreeMap::new();

    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|err| format!("Could not read the mod library: {err}"))?;
        if entry.is_dir() {
            continue;
        }
        let path = entry.name().replace('\\', "/");
        let Some((kind, mod_name, inner)) = split_mod_path(&path) else {
            continue;
        };
        if inner.is_empty() {
            continue;
        }
        match kind {
            "addons" => {
                let stats = addon_stats.entry(mod_name.to_string()).or_default();
                if inner == "mod.json" {
                    let mut entry = entry;
                    let mut raw = Vec::new();
                    let _ = entry.read_to_end(&mut raw);
                    let parsed: ModJson = serde_json::from_slice(&raw).unwrap_or_default();
                    addon_meta.insert(mod_name.to_string(), parsed);
                } else {
                    stats.0 += 1;
                    stats.1 += entry.size();
                    if inner.starts_with("sound/") {
                        stats.2 = true;
                    }
                }
            }
            "particles" => {
                let stats = particle_stats.entry(mod_name.to_string()).or_default();
                stats.1 += 1;
                stats.2 += entry.size();
                if let Some(pcf) = inner.strip_prefix("actual_particles/") {
                    if pcf.ends_with(".pcf") && !pcf.contains('/') {
                        stats.0.push(pcf.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    let addons = addon_stats
        .into_iter()
        .map(|(id, (file_count, bytes, has_sound))| {
            let meta = addon_meta.remove(&id).unwrap_or_default();
            CatalogAddon {
                kind: if meta.kind.is_empty() {
                    "Misc".to_string()
                } else {
                    meta.kind
                },
                description: meta.description,
                name: if meta.addon_name.is_empty() {
                    id.clone()
                } else {
                    meta.addon_name
                },
                id,
                file_count,
                bytes,
                has_sound,
            }
        })
        .collect();
    let particle_mods = particle_stats
        .into_iter()
        .map(|(name, (mut pcf_files, file_count, bytes))| {
            pcf_files.sort();
            CatalogParticleMod {
                name,
                pcf_files,
                file_count,
                bytes,
            }
        })
        .collect();
    Ok(ModsCatalog {
        addons,
        particle_mods,
    })
}

// ---------------------------------------------------------------------------
// Apply / revert
// ---------------------------------------------------------------------------
