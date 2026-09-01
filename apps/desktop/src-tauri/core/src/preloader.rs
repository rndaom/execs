//! The casual preloader: reversible `gameinfo.txt` bypass plus in-place
//! particle patches inside `tf2_misc_dir.vpk`, with pristine snapshots of
//! every byte we touch so one click restores stock files.
//!
//! Allowed by an explicit product decision (see AGENTS.md, dated 2026-08-31):
//! these are the only official-file edits the app may make, they must stay
//! size-preserving, snapshot-first, and fully revertible, and they never run
//! while the game is open.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::hash::sha256_hex;
use crate::pcf::{
    check_parents, decode_pcf, encode_pcf, extract_elements, find_root_systems,
    get_parent_elements, remove_duplicate_elements, update_materials, PcfFile,
};
use crate::vpk::{map_vpk_entries, patch_vpk_entry, read_vpk_entry, write_vpk_v1, VpkEntryLocation};

pub const PRELOADER_VPK: &str = "execs-preloader.vpk";
pub const MISC_VPK: &str = "tf2_misc_dir.vpk";
/// Official archives holding the assets the pure whitelist trusts.
pub const STOCK_VPKS: [&str; 3] = [
    "tf2_textures_dir.vpk",
    "tf2_misc_dir.vpk",
    "tf2_sound_misc_dir.vpk",
];
/// Roots a loose `tf/custom` file cannot serve from.
///
/// Materials and models are deliberately absent: the gameinfo `type` bypass
/// plus the itemtest preload carry those into the cache before Casual's pure
/// check runs, which is the whole point of the preloader. Particles are here
/// because they are patched into the official VPK in place instead, and sound
/// because the soundscript relocation that would make it work is not built.
const TRUSTED_ROOTS: [&str; 2] = ["particles/", "sound/"];

/// Stock files that carry duplicated copies of systems owned by other files.
/// When particle mods are installed these get rebuilt from vanilla with the
/// duplicates dropped, so the mods aren't shadowed.
pub const DUPLICATE_EFFECT_FILES: [&str; 4] = [
    "item_fx.pcf",
    "halloween.pcf",
    "bigboom.pcf",
    "dirty_explode.pcf",
];

/// Stems that also ship a `_dx80` twin the engine can pick; both copies get
/// the same replacement so the effect can't split by DirectX level.
pub const DX8_TWIN_STEMS: [&str; 22] = [
    "burningplayer",
    "cig_smoke",
    "bigboom",
    "player_recent_teleport",
    "water",
    "bl_killtaunt",
    "blood_trail",
    "class_fx",
    "drg_cowmangler",
    "drg_pyro",
    "explosion",
    "eyeboss",
    "firstperson_weapon_fx",
    "flamethrower",
    "harbor_fx",
    "medicgun_beam",
    "muzzle_flash",
    "rockettrail",
    "shellejection",
    "smoke_blackbillow",
    "soldierbuff",
    "stickybomb",
];

// ---------------------------------------------------------------------------
// gameinfo.txt bypass
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GameinfoBypass {
    pub found: bool,
    pub enabled: bool,
}

fn gameinfo_path(tf2_root: &Path) -> PathBuf {
    tf2_root.join("tf").join("gameinfo.txt")
}

fn split_lines_inclusive(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut lines = Vec::new();
    let mut start = 0;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            lines.push(bytes[start..=index].to_vec());
            start = index + 1;
        }
    }
    if start < bytes.len() {
        lines.push(bytes[start..].to_vec());
    }
    lines
}

fn line_has(line: &[u8], needle: &[u8]) -> bool {
    line.windows(needle.len()).any(|window| window == needle)
}

/// Whether the `type multiplayer_only` line is currently commented out.
pub fn gameinfo_bypass_state(tf2_root: &Path) -> Result<GameinfoBypass, String> {
    let path = gameinfo_path(tf2_root);
    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(GameinfoBypass {
            found: false,
            enabled: false,
        });
    };
    let enabled = split_lines_inclusive(&bytes).iter().any(|line| {
        line_has(line, b"type") && line_has(line, b"multiplayer_only") && line_has(line, b"//")
    });
    Ok(GameinfoBypass {
        found: true,
        enabled,
    })
}

/// Toggle the bypass by commenting/uncommenting the `type multiplayer_only`
/// line, byte-preserving everything else. A pristine copy is kept in the app
/// data folder before the first edit. Returns whether the file changed.
pub fn set_gameinfo_bypass(
    tf2_root: &Path,
    data_dir: &Path,
    enabled: bool,
) -> Result<bool, String> {
    let path = gameinfo_path(tf2_root);
    let bytes = std::fs::read(&path)
        .map_err(|err| format!("Could not read gameinfo.txt: {err}"))?;

    let mut lines = split_lines_inclusive(&bytes);
    let mut changed = false;
    for line in &mut lines {
        if !(line_has(line, b"type") && line_has(line, b"multiplayer_only")) {
            continue;
        }
        let commented = line_has(line, b"//");
        if enabled && !commented {
            if let Some(pos) = line
                .windows(4)
                .position(|window| window == b"type")
            {
                line.splice(pos..pos, b"//".iter().copied());
                changed = true;
            }
        } else if !enabled && commented {
            if let Some(pos) = line.windows(2).position(|window| window == b"//") {
                line.drain(pos..pos + 2);
                changed = true;
            }
        }
    }
    if !changed {
        return Ok(false);
    }

    let backup_dir = preloader_dir(data_dir);
    std::fs::create_dir_all(&backup_dir)
        .map_err(|err| format!("Could not prepare the preloader folder: {err}"))?;
    let backup = backup_dir.join("gameinfo.original.txt");
    if !backup.exists() {
        std::fs::write(&backup, &bytes)
            .map_err(|err| format!("Could not back up gameinfo.txt: {err}"))?;
    }

    let updated: Vec<u8> = lines.concat();
    std::fs::write(&path, updated)
        .map_err(|err| format!("Could not write gameinfo.txt: {err}"))?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// State: snapshots of patched entries
// ---------------------------------------------------------------------------

fn preloader_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("preloader")
}

fn originals_dir(data_dir: &Path) -> PathBuf {
    preloader_dir(data_dir).join("originals")
}

fn state_path(data_dir: &Path) -> PathBuf {
    preloader_dir(data_dir).join("state.json")
}

fn snapshot_path(data_dir: &Path, rel: &str) -> PathBuf {
    originals_dir(data_dir).join(rel.replace('/', "__"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PatchedEntry {
    pub owner: String,
    pub original_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkipNotice {
    pub file: String,
    pub mod_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PreloaderState {
    pub schema: u32,
    pub vpk_len: u64,
    pub vpk_mtime_ms: u128,
    #[serde(default)]
    pub addons: Vec<String>,
    #[serde(default)]
    pub particle_mods: Vec<String>,
    #[serde(default)]
    pub patched: BTreeMap<String, PatchedEntry>,
    #[serde(default)]
    pub skipped: Vec<SkipNotice>,
    /// Profiles the shared preload cfg was enabled on for mods, so a revert
    /// can clean them up even after the active profile changed.
    #[serde(default)]
    pub preload_profiles: Vec<String>,
}

fn load_state(data_dir: &Path) -> PreloaderState {
    std::fs::read(state_path(data_dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_state(data_dir: &Path, state: &PreloaderState) -> Result<(), String> {
    std::fs::create_dir_all(preloader_dir(data_dir))
        .map_err(|err| format!("Could not prepare the preloader folder: {err}"))?;
    let json = serde_json::to_vec_pretty(state).map_err(|err| err.to_string())?;
    std::fs::write(state_path(data_dir), json)
        .map_err(|err| format!("Could not save preloader state: {err}"))
}

fn vpk_fingerprint(path: &Path) -> Result<(u64, u128), String> {
    let meta = std::fs::metadata(path)
        .map_err(|err| format!("Could not read {MISC_VPK}: {err}"))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok((meta.len(), mtime))
}

fn misc_vpk_path(tf2_root: &Path) -> PathBuf {
    tf2_root.join("tf").join(MISC_VPK)
}

// ---------------------------------------------------------------------------
// Default mods catalog (mods.zip)
// ---------------------------------------------------------------------------

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

fn zip_archive(zip_path: &Path) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|err| format!("Could not open the mod library: {err}"))?;
    zip::ZipArchive::new(file).map_err(|err| format!("Could not read the mod library: {err}"))
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ModJson {
    #[serde(default)]
    addon_name: String,
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    description: String,
}

/// Split a zip path into (top folder kind, mod name, inner path).
fn split_mod_path(name: &str) -> Option<(&str, &str, &str)> {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreloaderSelection {
    #[serde(default)]
    pub addons: Vec<String>,
    #[serde(default)]
    pub particle_mods: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreloaderReport {
    pub patched_files: Vec<String>,
    pub skipped: Vec<SkipNotice>,
    pub addons_installed: Vec<String>,
    pub particle_mods_installed: Vec<String>,
    pub custom_vpk_written: bool,
    pub gameinfo_bypassed: bool,
    pub baseline_reset: bool,
    /// Materials generated for textures a mod shipped without one.
    #[serde(default)]
    pub synthesized_vmts: usize,
    /// Model materials moved under the console/ root to survive Casual.
    #[serde(default)]
    pub relocated_model_materials: usize,
}

/// The `$ignorez 1` spellings that turn a material into a wallhack; scrubbed
/// (blanked) from any .vmt we pack, same as the original preloader.
const IGNOREZ_PATTERNS: [&[u8]; 8] = [
    b"\"$ignorez\"\t\"1\"",
    b"\"$ignorez\"\t1",
    b"$ignorez\t\"1\"",
    b"$ignorez\t1",
    b"\"$ignorez\" \"1\"",
    b"\"$ignorez\" 1",
    b"$ignorez \"1\"",
    b"$ignorez 1",
];

const SCRUB_PREFIXES: [&str; 6] = [
    "materials/effects/",
    "materials/models/",
    "materials/particle/",
    "materials/particles/",
    "materials/prediction/",
    "materials/sprites/healbeam",
];

fn scrub_ignorez(rel: &str, bytes: &mut Vec<u8>) {
    let lower = rel.to_lowercase();
    if !lower.ends_with(".vmt") || !SCRUB_PREFIXES.iter().any(|prefix| lower.contains(prefix)) {
        return;
    }
    for pattern in IGNOREZ_PATTERNS {
        let mut start = 0;
        while start + pattern.len() <= bytes.len() {
            if &bytes[start..start + pattern.len()] == pattern {
                bytes[start..start + pattern.len()].fill(b' ');
                start += pattern.len();
            } else {
                start += 1;
            }
        }
    }
}

/// True for the sound-script text files the original preloader refuses to
/// copy from addons (they fight the engine's generated sound caches).
/// Material root TF2 treats as user-writable, so a model material served from
/// here is not measured against the stock file at its original path.
const RELOCATE_PREFIX: &str = "console";

/// Move the materials a staged model owns under [`RELOCATE_PREFIX`] and point
/// the model at the new location, keeping its original path as a fallback so
/// anything the mod does not ship still resolves to stock.
///
/// Only directories the mod actually ships materials for are moved; world and
/// brush materials are left alone, since those ride the gameinfo bypass.
/// Returns how many files moved.
fn relocate_model_materials(custom: &mut BTreeMap<String, Vec<u8>>) -> usize {
    let models: Vec<String> = custom
        .iter()
        .filter(|(rel, bytes)| rel.ends_with(".mdl") && crate::mdl::is_mdl(bytes))
        .map(|(rel, _)| rel.clone())
        .collect();
    if models.is_empty() {
        return 0;
    }

    // Which material directories does this mod actually ship files for?
    let mut relocate: BTreeSet<String> = BTreeSet::new();
    let mut rewrites: Vec<(String, Vec<String>)> = Vec::new();
    for model in &models {
        let Some(dirs) = custom.get(model).and_then(|bytes| crate::mdl::material_dirs(bytes))
        else {
            continue;
        };
        let mut prefixed = Vec::new();
        let mut fallback = Vec::new();
        for dir in &dirs {
            let normal = crate::mdl::normalize_dir(dir);
            // An empty entry means "materials/" itself; prefixing it would point
            // the model at a root we do not populate.
            if normal.is_empty() || normal.starts_with(&format!("{RELOCATE_PREFIX}/")) {
                if !fallback.contains(dir) {
                    fallback.push(dir.clone());
                }
                continue;
            }
            let ships = custom
                .keys()
                .any(|rel| rel.starts_with(&format!("materials/{normal}")));
            if ships {
                relocate.insert(normal.clone());
                prefixed.push(format!("{RELOCATE_PREFIX}/{normal}"));
            }
            if !fallback.contains(&normal) {
                fallback.push(normal);
            }
        }
        if prefixed.is_empty() {
            continue;
        }
        prefixed.extend(fallback);
        rewrites.push((model.clone(), prefixed));
    }
    if relocate.is_empty() {
        return 0;
    }

    // Move every material under a relocated directory.
    let moves: Vec<(String, String)> = custom
        .keys()
        .filter_map(|rel| {
            let inner = rel.strip_prefix("materials/")?;
            relocate
                .iter()
                .any(|dir| inner.starts_with(dir.as_str()))
                .then(|| (rel.clone(), format!("materials/{RELOCATE_PREFIX}/{inner}")))
        })
        .collect();
    let moved_textures: BTreeSet<String> = moves
        .iter()
        .filter(|(from, _)| from.ends_with(".vtf"))
        .map(|(from, _)| from.clone())
        .collect();

    let mut moved = 0;
    for (from, to) in &moves {
        let Some(bytes) = custom.remove(from) else {
            continue;
        };
        let bytes = if from.ends_with(".vmt") {
            match String::from_utf8(bytes) {
                Ok(text) => rewrite_vmt_refs(&text, &moved_textures).into_bytes(),
                Err(err) => err.into_bytes(),
            }
        } else {
            bytes
        };
        custom.insert(to.clone(), bytes);
        moved += 1;
    }
    for (model, dirs) in rewrites {
        let Some(bytes) = custom.get(&model) else {
            continue;
        };
        if let Some(out) = crate::mdl::rewrite_material_dirs(bytes, &dirs) {
            custom.insert(model, out);
        }
    }
    moved
}

/// Repoint a material's texture references at the relocated copies. Only paths
/// whose texture actually moved are touched, so stock references stay intact.
fn rewrite_vmt_refs(text: &str, moved_textures: &BTreeSet<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('"') {
        let (head, tail) = rest.split_at(open + 1);
        out.push_str(head);
        let Some(close) = tail.find('"') else {
            out.push_str(tail);
            return out;
        };
        let value = &tail[..close];
        let candidate = format!(
            "materials/{}.vtf",
            value.replace('\\', "/").to_ascii_lowercase()
        );
        if moved_textures.contains(&candidate) {
            out.push_str(&format!("{RELOCATE_PREFIX}/{value}"));
        } else {
            out.push_str(value);
        }
        rest = &tail[close..];
    }
    out.push_str(rest);
    out
}

/// Every `_dir.vpk` entry table for the official archives, read once.
fn stock_entry_tables(tf2_root: &Path) -> Vec<(PathBuf, BTreeMap<String, VpkEntryLocation>)> {
    let mut tables = Vec::new();
    for name in STOCK_VPKS {
        let path = tf2_root.join("tf").join(name);
        if !path.is_file() {
            continue;
        }
        if let Ok(entries) = map_vpk_entries(&path) {
            tables.push((path, entries));
        }
    }
    tables
}

/// A VTF with no VMT beside it renders as the error checkerboard, and mods
/// routinely ship the texture alone. Give each orphan the stock material it is
/// replacing where one exists — that keeps the original shader and parameters —
/// and otherwise a minimal material picked from the path.
fn synthesize_missing_vmts(tf2_root: &Path, custom: &mut BTreeMap<String, Vec<u8>>) -> usize {
    let orphans: Vec<String> = custom
        .keys()
        .filter(|rel| rel.starts_with("materials/") && rel.ends_with(".vtf"))
        .map(|rel| format!("{}.vmt", rel.trim_end_matches(".vtf")))
        .filter(|vmt| !custom.contains_key(vmt))
        .collect();
    if orphans.is_empty() {
        return 0;
    }
    let tables = stock_entry_tables(tf2_root);
    let mut written = 0;
    for vmt in orphans {
        let stock = tables.iter().find_map(|(path, entries)| {
            let entry = entries.get(&vmt)?;
            read_vpk_entry(path, entry).ok()
        });
        let bytes = stock.unwrap_or_else(|| default_vmt(&vmt));
        custom.insert(vmt, bytes);
        written += 1;
    }
    written
}

/// Minimal material for a texture with no stock counterpart. Model materials
/// are lit per-vertex; world surfaces take lightmaps.
fn default_vmt(vmt: &str) -> Vec<u8> {
    let texture = vmt
        .trim_start_matches("materials/")
        .trim_end_matches(".vmt");
    let shader = if vmt.starts_with("materials/models/") {
        "VertexLitGeneric"
    } else {
        "LightmappedGeneric"
    };
    format!("\"{shader}\"
{{
	\"$basetexture\"	\"{texture}\"
}}
").into_bytes()
}

/// Paths in `files` that replace an asset the pure whitelist trusts, and so
/// cannot be served from `tf/custom`. Paths outside the trusted roots (a mod's
/// own new materials, scripts) are left alone.
fn stock_shadowing_paths(tf2_root: &Path, files: &BTreeMap<String, Vec<u8>>) -> Vec<String> {
    let candidates: BTreeSet<&String> = files
        .keys()
        .filter(|rel| TRUSTED_ROOTS.iter().any(|root| rel.starts_with(root)))
        .collect();
    if candidates.is_empty() {
        return Vec::new();
    }
    let mut shadowing = Vec::new();
    for name in STOCK_VPKS {
        let path = tf2_root.join("tf").join(name);
        if !path.is_file() {
            continue;
        }
        let Ok(entries) = map_vpk_entries(&path) else {
            continue;
        };
        for rel in &candidates {
            if entries.contains_key(*rel) {
                shadowing.push((**rel).clone());
            }
        }
    }
    shadowing.sort();
    shadowing.dedup();
    shadowing
}

fn is_excluded_addon_file(inner: &str) -> bool {
    if inner == "mod.json" {
        return true;
    }
    let lower = inner.to_lowercase();
    if lower.ends_with("sound.cache") {
        return true;
    }
    if let Some(rest) = lower.strip_prefix("scripts/") {
        let file = rest.rsplit('/').next().unwrap_or(rest);
        if file.contains("sound") && file.ends_with(".txt") {
            return true;
        }
    }
    false
}

struct WorkItem {
    target: String,
    mod_name: String,
    bytes: Vec<u8>,
}

/// Snapshots left behind by an interrupted run may not be tracked in state
/// (the crash hit between the snapshot write and the state save). Adopt them
/// so the restore pass puts their pristine bytes back; entries that turn out
/// bogus are dropped by the restore pass's own per-entry validation.
fn adopt_orphaned_snapshots(data_dir: &Path, state: &mut PreloaderState) {
    let Ok(dir) = std::fs::read_dir(originals_dir(data_dir)) else {
        return;
    };
    for file in dir.flatten() {
        let Some(name) = file.file_name().to_str().map(|name| name.to_string()) else {
            continue;
        };
        let rel = name.replace("__", "/");
        if state.patched.contains_key(&rel) {
            continue;
        }
        let sha = std::fs::read(file.path())
            .map(|bytes| sha256_hex(&bytes))
            .unwrap_or_default();
        state.patched.insert(
            rel,
            PatchedEntry {
                owner: "recovered".into(),
                original_sha256: sha,
            },
        );
    }
}

/// Restore tracked entries from their snapshots, one at a time, persisting
/// state after every entry. Success (and impossible restores — entry gone or
/// resized by a game update) drop the tracking; a plain I/O failure keeps the
/// entry tracked so a later attempt can finish the job.
fn restore_patched_entries(
    tf2_root: &Path,
    data_dir: &Path,
    state: &mut PreloaderState,
    entries: &BTreeMap<String, VpkEntryLocation>,
) -> Result<Vec<String>, String> {
    let vpk_path = misc_vpk_path(tf2_root);
    let mut failures = Vec::new();
    let tracked: Vec<String> = state.patched.keys().cloned().collect();
    for rel in tracked {
        let snapshot = snapshot_path(data_dir, &rel);
        let Ok(original) = std::fs::read(&snapshot) else {
            failures.push(format!("{rel}: snapshot is missing"));
            state.patched.remove(&rel);
            save_state(data_dir, state)?;
            continue;
        };
        let Some(entry) = entries.get(&rel) else {
            failures.push(format!("{rel}: no longer in {MISC_VPK}"));
            state.patched.remove(&rel);
            let _ = std::fs::remove_file(&snapshot);
            save_state(data_dir, state)?;
            continue;
        };
        if entry.length as usize != original.len() {
            failures.push(format!("{rel}: stock size changed (game update)"));
            state.patched.remove(&rel);
            let _ = std::fs::remove_file(&snapshot);
            save_state(data_dir, state)?;
            continue;
        }
        match patch_vpk_entry(&vpk_path, entry, &original) {
            Ok(()) => {
                state.patched.remove(&rel);
                let _ = std::fs::remove_file(&snapshot);
            }
            Err(err) => {
                failures.push(format!("{rel}: {}", err.message()));
            }
        }
        save_state(data_dir, state)?;
    }
    Ok(failures)
}

fn decode_vanilla(
    tf2_root: &Path,
    entries: &BTreeMap<String, VpkEntryLocation>,
    rel: &str,
) -> Result<PcfFile, String> {
    let entry = entries
        .get(rel)
        .ok_or_else(|| format!("{rel} is missing from {MISC_VPK}"))?;
    let bytes = read_vpk_entry(&misc_vpk_path(tf2_root), entry).map_err(|err| err.message())?;
    decode_pcf(&bytes).map_err(|err| format!("{rel}: {}", err.0))
}

/// Root systems each rebuild file may keep: roots whose only home is that
/// file. A root shared with a non-rebuild file lives on there; one shared
/// only among rebuild files stays with the alphabetically first so it can't
/// vanish from the game.
pub fn rebuild_keep_lists(
    roots_by_file: &BTreeMap<String, Vec<String>>,
) -> BTreeMap<String, Vec<String>> {
    let mut homes: BTreeMap<&String, Vec<&String>> = BTreeMap::new();
    for (file, roots) in roots_by_file {
        for root in roots {
            homes.entry(root).or_default().push(file);
        }
    }
    let mut keep_lists = BTreeMap::new();
    for target in DUPLICATE_EFFECT_FILES {
        let target = target.to_string();
        let Some(roots) = roots_by_file.get(&target) else {
            continue;
        };
        let kept: Vec<String> = roots
            .iter()
            .filter(|root| {
                let owners = &homes[*root];
                owners.len() == 1
                    || (owners
                        .iter()
                        .all(|owner| DUPLICATE_EFFECT_FILES.contains(&owner.as_str()))
                        && owners.iter().min() == Some(&&target))
            })
            .cloned()
            .collect();
        keep_lists.insert(target, kept);
    }
    keep_lists
}

pub fn apply_preloader_selection(
    tf2_root: &Path,
    data_dir: &Path,
    zip_path: &Path,
    selection: &PreloaderSelection,
) -> Result<PreloaderReport, String> {
    let vpk_path = misc_vpk_path(tf2_root);
    if !vpk_path.is_file() {
        return Err(format!("{MISC_VPK} was not found — is the TF2 folder right?"));
    }

    let mut report = PreloaderReport::default();
    let mut state = load_state(data_dir);

    // A resized VPK means a game update replaced our patches wholesale; the
    // old snapshots describe files that no longer exist, so the baseline
    // resets. Mtime drift alone is NOT an update — our own patches and a
    // partially-failed restore both touch mtime while the layout (and our
    // snapshots) stay perfectly valid, and the restore path re-validates
    // every entry by size anyway.
    let fingerprint = vpk_fingerprint(&vpk_path)?;
    if !state.patched.is_empty() && state.vpk_len != 0 && state.vpk_len != fingerprint.0 {
        state.patched.clear();
        let _ = std::fs::remove_dir_all(originals_dir(data_dir));
        report.baseline_reset = true;
    }
    // Record the current length up front so state saved mid-install already
    // carries the right baseline for a crash-recovery run.
    state.vpk_len = fingerprint.0;
    state.vpk_mtime_ms = fingerprint.1;
    save_state(data_dir, &state)?;

    let entries = map_vpk_entries(&vpk_path).map_err(|err| err.message())?;
    adopt_orphaned_snapshots(data_dir, &mut state);
    for failure in restore_patched_entries(tf2_root, data_dir, &mut state, &entries)? {
        report.skipped.push(SkipNotice {
            file: failure.clone(),
            mod_name: String::new(),
            reason: "could not restore the previous patch".into(),
        });
    }

    let catalog = read_mods_catalog(zip_path)?;
    for name in &selection.addons {
        if !catalog.addons.iter().any(|addon| &addon.id == name) {
            return Err(format!("Unknown addon: {name}"));
        }
    }
    for name in &selection.particle_mods {
        if !catalog
            .particle_mods
            .iter()
            .any(|particle| &particle.name == name)
        {
            return Err(format!("Unknown particle mod: {name}"));
        }
    }

    let mut archive = zip_archive(zip_path)?;

    // Particle worklist: selection order, later mods win a contested file.
    let mut work: BTreeMap<String, WorkItem> = BTreeMap::new();
    for mod_name in &selection.particle_mods {
        let prefix = format!("mods/particles/{mod_name}/actual_particles/");
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|err| format!("Could not read the mod library: {err}"))?;
            let path = entry.name().replace('\\', "/");
            let Some(file) = path.strip_prefix(&prefix) else {
                continue;
            };
            if file.contains('/') || !file.ends_with(".pcf") || entry.is_dir() {
                continue;
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|err| format!("Could not read {path}: {err}"))?;
            let target = if file == "blood_trail.pcf" {
                // blood_trail's own slot is too small for any mod; the same
                // systems also load from npc_fx, which has room.
                "npc_fx.pcf".to_string()
            } else {
                file.to_string()
            };
            if let Some(previous) = work.get(&target) {
                report.skipped.push(SkipNotice {
                    file: target.clone(),
                    mod_name: previous.mod_name.clone(),
                    reason: format!("overridden by {mod_name}"),
                });
            }
            work.insert(
                target.clone(),
                WorkItem {
                    target,
                    mod_name: mod_name.clone(),
                    bytes,
                },
            );
        }
    }

    // Rebuild the duplicate-carrier files whenever particle mods are in play
    // and a mod didn't already replace them outright.
    if !selection.particle_mods.is_empty() {
        let mut roots_by_file: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for rel in entries.keys() {
            let Some(name) = rel.strip_prefix("particles/") else {
                continue;
            };
            if name.contains('/') || !name.ends_with(".pcf") || name.ends_with("_dx80.pcf") {
                continue;
            }
            if let Ok(vanilla) = decode_vanilla(tf2_root, &entries, rel) {
                roots_by_file.insert(name.to_string(), find_root_systems(&vanilla));
            }
        }
        let keep_lists = rebuild_keep_lists(&roots_by_file);
        for (target, keep) in keep_lists {
            if work.contains_key(&target) {
                continue;
            }
            let rel = format!("particles/{target}");
            let vanilla = decode_vanilla(tf2_root, &entries, &rel)?;
            let rebuilt = extract_elements(&vanilla, &keep).map_err(|err| err.0)?;
            let bytes = encode_pcf(&rebuilt).map_err(|err| err.0)?;
            work.insert(
                target.clone(),
                WorkItem {
                    target,
                    mod_name: "stock rebuild".into(),
                    bytes,
                },
            );
        }
    }

    // Disguise ground truth for the parent-collision rule.
    let disguise_parents = if work.is_empty() {
        BTreeSet::new()
    } else {
        get_parent_elements(&decode_vanilla(tf2_root, &entries, "particles/disguise.pcf")?)
    };

    for (_, item) in &work {
        let rel = format!("particles/{}", item.target);
        let skip = |reason: String, report: &mut PreloaderReport| {
            report.skipped.push(SkipNotice {
                file: item.target.clone(),
                mod_name: item.mod_name.clone(),
                reason,
            });
        };

        let decoded = match decode_pcf(&item.bytes) {
            Ok(decoded) => decoded,
            Err(err) => {
                skip(format!("could not parse: {}", err.0), &mut report);
                continue;
            }
        };
        let mut processed = if item.target == "disguise.pcf" {
            update_materials(
                &decode_vanilla(tf2_root, &entries, "particles/disguise.pcf")?,
                &decoded,
            )
        } else if check_parents(&decoded, &disguise_parents) {
            skip(
                "redefines spy disguise systems, which must stay stock".into(),
                &mut report,
            );
            continue;
        } else {
            decoded
        };
        remove_duplicate_elements(&mut processed);
        let encoded = match encode_pcf(&processed) {
            Ok(encoded) => encoded,
            Err(err) => {
                skip(format!("could not re-encode: {}", err.0), &mut report);
                continue;
            }
        };

        let mut targets = vec![rel.clone()];
        let stem = item.target.trim_end_matches(".pcf");
        if DX8_TWIN_STEMS.contains(&stem) {
            let twin = format!("particles/{stem}_dx80.pcf");
            if entries.contains_key(&twin) {
                targets.push(twin);
            }
        }

        for target_rel in targets {
            let Some(entry) = entries.get(&target_rel) else {
                skip(
                    format!("{target_rel} is not part of the stock game"),
                    &mut report,
                );
                continue;
            };
            if entry.preload_len != 0 {
                skip(
                    format!("{target_rel} uses an unsupported layout"),
                    &mut report,
                );
                continue;
            }
            if encoded.len() > entry.length as usize {
                skip(
                    format!(
                        "{} is {} bytes over the stock budget even after shrinking",
                        target_rel,
                        encoded.len() - entry.length as usize
                    ),
                    &mut report,
                );
                continue;
            }
            let mut padded = encoded.clone();
            padded.resize(entry.length as usize, b' ');

            if !state.patched.contains_key(&target_rel) {
                std::fs::create_dir_all(originals_dir(data_dir))
                    .map_err(|err| format!("Could not prepare snapshots: {err}"))?;
                let snapshot = snapshot_path(data_dir, &target_rel);
                // A snapshot left behind by an interrupted run holds the
                // pristine bytes while the entry itself may already carry a
                // patch — an existing snapshot of the right size is the
                // truth and must never be overwritten.
                let original = match std::fs::read(&snapshot) {
                    Ok(existing) if existing.len() == entry.length as usize => existing,
                    _ => {
                        let current =
                            read_vpk_entry(&vpk_path, entry).map_err(|err| err.message())?;
                        std::fs::write(&snapshot, &current)
                            .map_err(|err| format!("Could not snapshot {target_rel}: {err}"))?;
                        current
                    }
                };
                state.patched.insert(
                    target_rel.clone(),
                    PatchedEntry {
                        owner: item.mod_name.clone(),
                        original_sha256: sha256_hex(&original),
                    },
                );
            } else if let Some(patched) = state.patched.get_mut(&target_rel) {
                patched.owner = item.mod_name.clone();
            }
            // Track before writing: a crash mid-patch must leave the entry
            // marked patched so the next run restores it from the snapshot.
            save_state(data_dir, &state)?;
            patch_vpk_entry(&vpk_path, entry, &padded).map_err(|err| err.message())?;
            report.patched_files.push(target_rel);
        }
    }

    // Custom content: particle-mod support files plus the selected addons.
    // Inner paths keep their game-relative shape (materials/…, scripts/…).
    let mut custom: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let copy_zip_tree = |archive: &mut zip::ZipArchive<std::fs::File>,
                             prefix: &str,
                             custom: &mut BTreeMap<String, Vec<u8>>,
                             allow: &dyn Fn(&str) -> bool|
     -> Result<(), String> {
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|err| format!("Could not read the mod library: {err}"))?;
            if entry.is_dir() {
                continue;
            }
            let path = entry.name().replace('\\', "/");
            let Some(inner) = path.strip_prefix(prefix) else {
                continue;
            };
            if inner.is_empty() || inner.contains("..") || !allow(inner) {
                continue;
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|err| format!("Could not read {path}: {err}"))?;
            scrub_ignorez(inner, &mut bytes);
            custom.insert(inner.to_string(), bytes);
        }
        Ok(())
    };

    for mod_name in &selection.particle_mods {
        copy_zip_tree(
            &mut archive,
            &format!("mods/particles/{mod_name}/"),
            &mut custom,
            &|inner| inner.starts_with("materials/") || inner.starts_with("scripts/"),
        )?;
    }
    let mut addon_owner: BTreeMap<String, String> = BTreeMap::new();
    for mod_name in &selection.addons {
        let before: BTreeSet<String> = custom.keys().cloned().collect();
        copy_zip_tree(
            &mut archive,
            &format!("mods/addons/{mod_name}/"),
            &mut custom,
            &|inner| !is_excluded_addon_file(inner),
        )?;
        for rel in custom.keys() {
            if !before.contains(rel) {
                addon_owner.insert(rel.clone(), mod_name.clone());
            }
        }
    }

    // Files that duplicate an asset handled by another route (particles are
    // patched in place; sound has no relocation path) would be dead weight or
    // actively conflict, so drop those and say so. Materials and models stay:
    // the preloader exists to carry exactly those into Casual.
    let mut dropped: BTreeMap<String, usize> = BTreeMap::new();
    let shadowing = stock_shadowing_paths(tf2_root, &custom);
    for rel in shadowing {
        custom.remove(&rel);
        let owner = addon_owner.get(&rel).cloned().unwrap_or_default();
        *dropped.entry(owner).or_default() += 1;
    }
    for (mod_name, count) in dropped {
        report.skipped.push(SkipNotice {
            file: format!("{count} file{}", if count == 1 { "" } else { "s" }),
            mod_name,
            reason: "duplicates a stock asset execs handles outside tf/custom".into(),
        });
    }

    // Model materials cannot serve from their stock paths, so move them under
    // the console/ root and repoint the models that reference them.
    let relocated = relocate_model_materials(&mut custom);
    if relocated > 0 {
        report.relocated_model_materials = relocated;
    }

    // A texture with no material beside it is a checkerboard in game, so give
    // every orphan one before the pack is sealed.
    let synthesized = synthesize_missing_vmts(tf2_root, &mut custom);
    if synthesized > 0 {
        report.synthesized_vmts = synthesized;
    }

    let custom_vpk = tf2_root.join("tf").join("custom").join(PRELOADER_VPK);
    if custom.is_empty() {
        let _ = std::fs::remove_file(&custom_vpk);
    } else {
        std::fs::create_dir_all(custom_vpk.parent().expect("custom dir"))
            .map_err(|err| format!("Could not prepare tf/custom: {err}"))?;
        std::fs::write(&custom_vpk, write_vpk_v1(&custom))
            .map_err(|err| format!("Could not write {PRELOADER_VPK}: {err}"))?;
        report.custom_vpk_written = true;
    }

    set_gameinfo_bypass(tf2_root, data_dir, true)?;
    // Report what actually happened: a gameinfo.txt without the expected
    // line means the bypass is not in effect.
    report.gameinfo_bypassed = gameinfo_bypass_state(tf2_root)?.enabled;

    let fingerprint = vpk_fingerprint(&vpk_path)?;
    state.schema = 1;
    state.vpk_len = fingerprint.0;
    state.vpk_mtime_ms = fingerprint.1;
    state.addons = selection.addons.clone();
    state.particle_mods = selection.particle_mods.clone();
    state.skipped = report.skipped.clone();
    save_state(data_dir, &state)?;

    report.addons_installed = selection.addons.clone();
    report.particle_mods_installed = selection.particle_mods.clone();
    Ok(report)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RevertReport {
    pub restored_files: Vec<String>,
    pub failures: Vec<String>,
    pub gameinfo_restored: bool,
    pub custom_vpk_removed: bool,
}

/// Put every stock byte back: restore patched entries from snapshots,
/// uncomment gameinfo.txt, and remove the custom VPK.
pub fn revert_preloader(tf2_root: &Path, data_dir: &Path) -> Result<RevertReport, String> {
    let mut report = RevertReport::default();
    let mut state = load_state(data_dir);
    let vpk_path = misc_vpk_path(tf2_root);

    adopt_orphaned_snapshots(data_dir, &mut state);
    if !state.patched.is_empty() {
        let fingerprint = vpk_fingerprint(&vpk_path)?;
        // Only a resized VPK proves a game update (mtime drifts from our own
        // writes and from partially-failed restores; those snapshots are
        // still exactly right).
        if state.vpk_len != 0 && state.vpk_len != fingerprint.0 {
            state.patched.clear();
            let _ = std::fs::remove_dir_all(originals_dir(data_dir));
            report
                .failures
                .push("The game updated since the last install; stock files are already fresh.".into());
        } else {
            let entries = map_vpk_entries(&vpk_path).map_err(|err| err.message())?;
            let tracked: Vec<String> = state.patched.keys().cloned().collect();
            let failures = restore_patched_entries(tf2_root, data_dir, &mut state, &entries)?;
            for rel in tracked {
                if !failures.iter().any(|failure| failure.starts_with(&rel)) {
                    report.restored_files.push(rel);
                }
            }
            report.failures.extend(failures);
        }
    }

    report.gameinfo_restored = set_gameinfo_bypass(tf2_root, data_dir, false)?;

    let custom_vpk = tf2_root.join("tf").join("custom").join(PRELOADER_VPK);
    if custom_vpk.exists() {
        std::fs::remove_file(&custom_vpk)
            .map_err(|err| format!("Could not remove {PRELOADER_VPK}: {err}"))?;
        report.custom_vpk_removed = true;
    }

    // Snapshots for entries that failed to restore stay on disk so the next
    // attempt can finish; only a fully-clean revert clears everything.
    if state.patched.is_empty() {
        let _ = std::fs::remove_dir_all(originals_dir(data_dir));
        state.vpk_len = 0;
        state.vpk_mtime_ms = 0;
    } else {
        let fingerprint = vpk_fingerprint(&vpk_path)?;
        state.vpk_len = fingerprint.0;
        state.vpk_mtime_ms = fingerprint.1;
    }
    state.addons.clear();
    state.particle_mods.clear();
    state.skipped.clear();
    save_state(data_dir, &state)?;
    Ok(report)
}

/// Remember which profile the shared preload cfg was enabled on, so a later
/// revert can clean it off that profile even if another one is active then.
pub fn record_preload_profile(data_dir: &Path, profile_id: &str) -> Result<(), String> {
    let mut state = load_state(data_dir);
    if !state.preload_profiles.iter().any(|id| id == profile_id) {
        state.preload_profiles.push(profile_id.to_string());
        save_state(data_dir, &state)?;
    }
    Ok(())
}

/// The recorded preload profiles, cleared from state.
pub fn take_preload_profiles(data_dir: &Path) -> Vec<String> {
    let mut state = load_state(data_dir);
    let taken = std::mem::take(&mut state.preload_profiles);
    if !taken.is_empty() {
        let _ = save_state(data_dir, &state);
    }
    taken
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreloaderStatus {
    pub gameinfo_found: bool,
    pub gameinfo_bypassed: bool,
    pub patched_files: Vec<String>,
    pub addons: Vec<String>,
    pub particle_mods: Vec<String>,
    pub skipped: Vec<SkipNotice>,
    pub stale: bool,
    pub custom_vpk_present: bool,
}

pub fn preloader_status(tf2_root: &Path, data_dir: &Path) -> Result<PreloaderStatus, String> {
    let state = load_state(data_dir);
    let gameinfo = gameinfo_bypass_state(tf2_root)?;
    let vpk_path = misc_vpk_path(tf2_root);
    // Only a resized VPK signals a game update; mtime drifts from our own
    // patch writes.
    let stale = !state.patched.is_empty()
        && vpk_fingerprint(&vpk_path)
            .map(|fingerprint| state.vpk_len != 0 && state.vpk_len != fingerprint.0)
            .unwrap_or(true);
    Ok(PreloaderStatus {
        gameinfo_found: gameinfo.found,
        gameinfo_bypassed: gameinfo.enabled,
        patched_files: state.patched.keys().cloned().collect(),
        addons: state.addons,
        particle_mods: state.particle_mods,
        skipped: state.skipped,
        stale,
        custom_vpk_present: tf2_root
            .join("tf")
            .join("custom")
            .join(PRELOADER_VPK)
            .is_file(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pcf::{PcfAttr, PcfElement, PcfValue, PCF_HEADERS};
    use crate::test_temp_dir;
    use crate::vpk::read_vpk_dir_file;
    use std::io::Write;

    fn tiny_pcf(system: &str, radius: f32) -> Vec<u8> {
        let file = PcfFile {
            version: PCF_HEADERS[1].to_string(),
            string_dictionary: vec![
                b"DmeElement".to_vec(),
                b"DmeParticleSystemDefinition".to_vec(),
                b"particleSystemDefinitions".to_vec(),
                b"radius".to_vec(),
            ],
            elements: vec![
                PcfElement {
                    type_name_index: 0,
                    name: b"root".to_vec(),
                    signature: [1; 16],
                    attributes: vec![(
                        b"particleSystemDefinitions".to_vec(),
                        PcfAttr {
                            type_code: crate::pcf::ELEMENT_ARRAY_TYPE,
                            value: PcfValue::Array(vec![PcfValue::Element(1)]),
                        },
                    )],
                },
                PcfElement {
                    type_name_index: 1,
                    name: system.as_bytes().to_vec(),
                    signature: [2; 16],
                    attributes: vec![(
                        b"radius".to_vec(),
                        PcfAttr {
                            type_code: 3,
                            value: PcfValue::Float(radius.to_bits()),
                        },
                    )],
                },
            ],
        };
        encode_pcf(&file).unwrap()
    }

    fn fake_root() -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = test_temp_dir();
        let root = dir.join("game");
        let data = dir.join("data");
        std::fs::create_dir_all(root.join("tf/custom")).unwrap();
        std::fs::write(
            root.join("tf/gameinfo.txt"),
            "\"GameInfo\"\r\n{\r\n\ttype multiplayer_only\r\n}\r\n",
        )
        .unwrap();

        let mut files = BTreeMap::new();
        let vanilla = tiny_pcf("water_effect", 9.0);
        // Padded stock entry so a same-or-smaller mod fits.
        let mut stock = vanilla.clone();
        stock.resize(stock.len() + 64, b' ');
        files.insert("particles/water.pcf".to_string(), stock.clone());
        files.insert("particles/water_dx80.pcf".to_string(), stock.clone());
        files.insert("particles/disguise.pcf".to_string(), {
            let mut disguise = tiny_pcf("spy_smoke", 3.0);
            disguise.resize(disguise.len() + 32, b' ');
            disguise
        });
        write_split_vpk(&root.join("tf").join(MISC_VPK), &files);
        (root, data)
    }

    /// A split VPK like the real tf2_misc: entries in the `_dir.vpk` tree,
    /// data in a `_000.vpk` sibling — the layout the patcher requires.
    fn write_split_vpk(dir_path: &Path, files: &BTreeMap<String, Vec<u8>>) {
        let mut grouped: BTreeMap<String, BTreeMap<String, BTreeMap<String, Vec<u8>>>> =
            BTreeMap::new();
        for (rel, bytes) in files {
            let (path, file) = rel.rsplit_once('/').unwrap_or((" ", rel.as_str()));
            let (name, ext) = file.rsplit_once('.').unwrap_or((file, " "));
            grouped
                .entry(ext.to_string())
                .or_default()
                .entry(path.to_string())
                .or_default()
                .insert(name.to_string(), bytes.clone());
        }
        let mut tree = Vec::new();
        let mut archive = Vec::new();
        let mut cstr = |tree: &mut Vec<u8>, s: &str| {
            tree.extend_from_slice(s.as_bytes());
            tree.push(0);
        };
        for (ext, paths) in &grouped {
            cstr(&mut tree, ext);
            for (path, names) in paths {
                cstr(&mut tree, path);
                for (name, bytes) in names {
                    cstr(&mut tree, name);
                    tree.extend_from_slice(&crate::vpk::crc32(bytes).to_le_bytes());
                    tree.extend_from_slice(&0u16.to_le_bytes());
                    tree.extend_from_slice(&0u16.to_le_bytes());
                    tree.extend_from_slice(&(archive.len() as u32).to_le_bytes());
                    tree.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                    tree.extend_from_slice(&0xffffu16.to_le_bytes());
                    archive.extend_from_slice(bytes);
                }
                tree.push(0);
            }
            tree.push(0);
        }
        tree.push(0);
        let mut dir = Vec::with_capacity(12 + tree.len());
        dir.extend_from_slice(&0x55aa_1234u32.to_le_bytes());
        dir.extend_from_slice(&1u32.to_le_bytes());
        dir.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        dir.extend_from_slice(&tree);
        std::fs::write(dir_path, dir).unwrap();
        let name = dir_path.file_name().unwrap().to_str().unwrap();
        let sibling = dir_path
            .parent()
            .unwrap()
            .join(name.replace("_dir.vpk", "_000.vpk"));
        std::fs::write(sibling, archive).unwrap();
    }

    fn fake_mods_zip(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("mods.zip");
        let file = std::fs::File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer
            .start_file("mods/particles/Blue Water/actual_particles/water.pcf", options)
            .unwrap();
        writer.write_all(&tiny_pcf("water_effect", 4.0)).unwrap();
        writer
            .start_file("mods/particles/Blue Water/materials/water/blue.vmt", options)
            .unwrap();
        writer.write_all(b"\"LightmappedGeneric\" {}").unwrap();
        writer
            .start_file("mods/addons/Flat Look/mod.json", options)
            .unwrap();
        writer
            .write_all(br#"{"addon_name":"Flat Look Pro","type":"Texture","description":"Flat."}"#)
            .unwrap();
        writer
            .start_file("mods/addons/Flat Look/materials/models/flat.vmt", options)
            .unwrap();
        writer
            .write_all(b"\"VertexlitGeneric\"\n{\n\t\"$ignorez\" \"1\"\n}\n")
            .unwrap();
        writer
            .start_file("mods/addons/Flat Look/scripts/game_sounds_custom.txt", options)
            .unwrap();
        writer.write_all(b"ignored").unwrap();
        writer.finish().unwrap();
        path
    }

    #[test]
    fn gameinfo_toggle_roundtrips() {
        let (root, data) = fake_root();
        let before = std::fs::read(root.join("tf/gameinfo.txt")).unwrap();
        assert!(!gameinfo_bypass_state(&root).unwrap().enabled);
        assert!(set_gameinfo_bypass(&root, &data, true).unwrap());
        assert!(gameinfo_bypass_state(&root).unwrap().enabled);
        let bypassed = std::fs::read(root.join("tf/gameinfo.txt")).unwrap();
        assert!(bypassed
            .windows(b"//type multiplayer_only".len())
            .any(|window| window == b"//type multiplayer_only"));
        // Idempotent, and the pristine backup exists.
        assert!(!set_gameinfo_bypass(&root, &data, true).unwrap());
        assert_eq!(
            std::fs::read(data.join("preloader/gameinfo.original.txt")).unwrap(),
            before
        );
        assert!(set_gameinfo_bypass(&root, &data, false).unwrap());
        assert_eq!(std::fs::read(root.join("tf/gameinfo.txt")).unwrap(), before);
    }

    #[test]
    fn addon_materials_that_replace_stock_assets_still_ship_loose() {
        // The gameinfo bypass plus the itemtest preload are what carry a
        // replaced material into Casual, so shipping it is the whole point —
        // dropping it would silently disable every texture mod.
        let (root, data) = fake_root();
        let zip_path = fake_mods_zip(root.parent().unwrap());
        let mut stock = BTreeMap::new();
        stock.insert(
            "materials/models/flat.vmt".to_string(),
            b"\"VertexlitGeneric\"
{
}
".to_vec(),
        );
        write_split_vpk(&root.join("tf").join("tf2_textures_dir.vpk"), &stock);

        let selection = PreloaderSelection {
            addons: vec!["Flat Look".into()],
            particle_mods: Vec::new(),
        };
        let report = apply_preloader_selection(&root, &data, &zip_path, &selection).unwrap();
        assert!(report.skipped.is_empty(), "{:?}", report.skipped);

        let custom = root.join("tf/custom").join(PRELOADER_VPK);
        let archive = read_vpk_dir_file(&custom).unwrap();
        assert!(
            archive.files.contains_key("materials/models/flat.vmt"),
            "a material replacing a stock path must still ship for the preload"
        );
    }

    #[test]
    fn orphan_textures_get_a_material_preferring_the_stock_one() {
        let (root, data) = fake_root();
        let zip_path = fake_mods_zip(root.parent().unwrap());
        // The stock archive owns a material for the path the mod replaces.
        let mut stock = BTreeMap::new();
        stock.insert(
            "materials/models/flat.vmt".to_string(),
            b"\"VertexLitGeneric\"
{
	\"$stockmarker\"	\"1\"
}
".to_vec(),
        );
        write_split_vpk(&root.join("tf").join("tf2_textures_dir.vpk"), &stock);

        let mut custom: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        custom.insert("materials/models/flat.vtf".into(), b"VTF ".to_vec());
        custom.insert("materials/world/new_rock.vtf".into(), b"VTF ".to_vec());
        custom.insert("materials/world/has_one.vtf".into(), b"VTF ".to_vec());
        custom.insert("materials/world/has_one.vmt".into(), b"mine".to_vec());

        let written = synthesize_missing_vmts(&root, &mut custom);

        assert_eq!(written, 2, "only the two orphans get a material");
        assert_eq!(
            custom.get("materials/models/flat.vmt").unwrap(),
            &b"\"VertexLitGeneric\"
{
	\"$stockmarker\"	\"1\"
}
".to_vec(),
            "a replaced texture reuses the stock material verbatim"
        );
        let generated = String::from_utf8(custom["materials/world/new_rock.vmt"].clone()).unwrap();
        assert!(generated.contains("LightmappedGeneric"), "{generated}");
        assert!(generated.contains("world/new_rock"), "{generated}");
        assert_eq!(
            custom.get("materials/world/has_one.vmt").unwrap(),
            &b"mine".to_vec(),
            "a material the mod ships is never overwritten"
        );
        let _ = (zip_path, data);
    }

    /// A model header carrying one material directory, matching the layout
    /// `mdl_probe` verified against the game's own models.
    fn fake_mdl(dir: &str) -> Vec<u8> {
        let mut bytes = vec![0u8; 244];
        bytes[0..4].copy_from_slice(b"IDST");
        bytes[4..8].copy_from_slice(&49i32.to_le_bytes());
        let offset = bytes.len() as i32;
        bytes.extend_from_slice(dir.as_bytes());
        bytes.push(0);
        while bytes.len() % 4 != 0 {
            bytes.push(0);
        }
        let table = bytes.len() as i32;
        bytes.extend_from_slice(&offset.to_le_bytes());
        bytes[212..216].copy_from_slice(&1i32.to_le_bytes());
        bytes[216..220].copy_from_slice(&table.to_le_bytes());
        let length = bytes.len() as i32;
        bytes[76..80].copy_from_slice(&length.to_le_bytes());
        bytes
    }

    #[test]
    fn model_materials_move_under_console_and_the_model_follows() {
        let mut custom: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        custom.insert(
            "models/props_gameplay/locker.mdl".into(),
            // Real models spell the dir with backslashes.
            fake_mdl(r"\models\props_gameplay\"),
        );
        custom.insert(
            "materials/models/props_gameplay/locker.vmt".into(),
            b"\"VertexLitGeneric\"
{
	\"$basetexture\"	\"models/props_gameplay/locker\"
}
"
                .to_vec(),
        );
        custom.insert(
            "materials/models/props_gameplay/locker.vtf".into(),
            b"VTF ".to_vec(),
        );
        // A world material the mod also ships must NOT move: it rides the
        // gameinfo bypass at its stock path.
        custom.insert("materials/wood/wall.vtf".into(), b"VTF ".to_vec());

        let moved = relocate_model_materials(&mut custom);

        assert_eq!(moved, 2, "the vmt and vtf move together");
        assert!(custom.contains_key("materials/console/models/props_gameplay/locker.vtf"));
        assert!(!custom.contains_key("materials/models/props_gameplay/locker.vtf"));
        assert!(custom.contains_key("materials/wood/wall.vtf"), "world stays");

        // The material now points at the relocated texture.
        let vmt = String::from_utf8(
            custom["materials/console/models/props_gameplay/locker.vmt"].clone(),
        )
        .unwrap();
        assert!(vmt.contains("console/models/props_gameplay/locker"), "{vmt}");
        assert!(vmt.contains("VertexLitGeneric"), "{vmt}");

        // The model searches the relocated dir first, stock second.
        let dirs =
            crate::mdl::material_dirs(&custom["models/props_gameplay/locker.mdl"]).unwrap();
        assert_eq!(dirs[0], "console/models/props_gameplay/");
        assert_eq!(dirs[1], "models/props_gameplay/");
    }

    #[test]
    fn relocation_is_a_noop_without_models_or_matching_materials() {
        let mut only_world: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        only_world.insert("materials/wood/wall.vtf".into(), b"VTF ".to_vec());
        assert_eq!(relocate_model_materials(&mut only_world), 0);

        // A model whose materials the mod does not ship must not be rewritten.
        let mut unshipped: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let model = fake_mdl("models/props_gameplay/");
        unshipped.insert("models/props_gameplay/locker.mdl".into(), model.clone());
        assert_eq!(relocate_model_materials(&mut unshipped), 0);
        assert_eq!(unshipped["models/props_gameplay/locker.mdl"], model);
    }

    #[test]
    fn catalog_lists_addons_and_particles() {
        let dir = test_temp_dir();
        let zip_path = fake_mods_zip(&dir);
        let catalog = read_mods_catalog(&zip_path).unwrap();
        assert_eq!(catalog.addons.len(), 1);
        assert_eq!(catalog.addons[0].id, "Flat Look");
        assert_eq!(catalog.addons[0].name, "Flat Look Pro");
        assert_eq!(catalog.addons[0].kind, "Texture");
        assert_eq!(catalog.particle_mods.len(), 1);
        assert_eq!(catalog.particle_mods[0].pcf_files, vec!["water.pcf"]);
    }

    #[test]
    fn apply_patches_and_revert_restores() {
        let (root, data) = fake_root();
        let zip_path = fake_mods_zip(root.parent().unwrap());
        let vpk_path = root.join("tf").join(MISC_VPK);
        let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
        let pristine_dir = std::fs::read(&vpk_path).unwrap();
        let pristine_sibling = std::fs::read(&sibling_path).unwrap();

        let selection = PreloaderSelection {
            addons: vec!["Flat Look".into()],
            particle_mods: vec!["Blue Water".into()],
        };
        let report = apply_preloader_selection(&root, &data, &zip_path, &selection).unwrap();
        assert!(report.gameinfo_bypassed);
        assert!(report.custom_vpk_written);
        assert_eq!(
            report.patched_files,
            vec![
                "particles/water.pcf".to_string(),
                "particles/water_dx80.pcf".to_string()
            ]
        );
        assert!(report.skipped.is_empty(), "{:?}", report.skipped);

        // Patched entry decodes to the mod's content, padded to stock size.
        let archive = read_vpk_dir_file(&vpk_path).unwrap();
        let patched = archive.files.get("particles/water.pcf").unwrap();
        let decoded = decode_pcf(patched).unwrap();
        let system = &decoded.elements[1];
        assert_eq!(
            system.attr(b"radius").unwrap().value,
            PcfValue::Float(4.0f32.to_bits())
        );
        // The directory file must stay byte-pristine — the stock CRCs (over
        // the now-modded data) are what the sv_pure check reads.
        assert_eq!(
            std::fs::read(&vpk_path).unwrap(),
            pristine_dir,
            "patching must never touch the _dir.vpk"
        );
        let entries = map_vpk_entries(&vpk_path).unwrap();
        let crc_entry = entries.get("particles/water.pcf").unwrap();
        assert_ne!(
            crc_entry.crc,
            crate::vpk::crc32(patched),
            "the stock CRC stays stale over modded data by design"
        );

        // Custom VPK carries the addon material with $ignorez scrubbed and
        // skips the sound-script text file.
        let custom =
            read_vpk_dir_file(&root.join("tf/custom").join(PRELOADER_VPK)).unwrap();
        let vmt = custom.files.get("materials/models/flat.vmt").unwrap();
        assert!(!vmt.windows(8).any(|window| window == b"$ignorez"));
        assert!(custom.files.contains_key("materials/water/blue.vmt"));
        assert!(!custom.files.contains_key("scripts/game_sounds_custom.txt"));

        let status = preloader_status(&root, &data).unwrap();
        assert!(status.gameinfo_bypassed);
        assert!(!status.stale);
        assert_eq!(status.particle_mods, vec!["Blue Water".to_string()]);

        // Re-applying with nothing selected restores particles and drops the
        // custom VPK, but keeps the bypass on.
        let report =
            apply_preloader_selection(&root, &data, &zip_path, &PreloaderSelection::default())
                .unwrap();
        assert!(report.patched_files.is_empty());
        assert!(!report.custom_vpk_written);

        let report = revert_preloader(&root, &data).unwrap();
        assert!(report.gameinfo_restored);
        assert_eq!(std::fs::read(&vpk_path).unwrap(), pristine_dir);
        assert_eq!(std::fs::read(&sibling_path).unwrap(), pristine_sibling);
        assert!(!root.join("tf/custom").join(PRELOADER_VPK).exists());
        let status = preloader_status(&root, &data).unwrap();
        assert!(!status.gameinfo_bypassed);
        assert!(status.patched_files.is_empty());
    }

    /// An interrupted apply can leave patched entries with state.json saying
    /// nothing is patched. The pristine snapshots on disk must survive the
    /// retry (never re-snapshotted from modded bytes) so revert still reaches
    /// stock files.
    #[test]
    fn interrupted_apply_cannot_clobber_snapshots() {
        let (root, data) = fake_root();
        let zip_path = fake_mods_zip(root.parent().unwrap());
        let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
        let pristine_sibling = std::fs::read(&sibling_path).unwrap();

        let selection = PreloaderSelection {
            addons: vec![],
            particle_mods: vec!["Blue Water".into()],
        };
        apply_preloader_selection(&root, &data, &zip_path, &selection).unwrap();

        // Simulate the crash: patches and snapshots exist, but tracking was
        // lost before the state save.
        let mut state = load_state(&data);
        assert!(!state.patched.is_empty());
        state.patched.clear();
        save_state(&data, &state).unwrap();

        // Retrying must adopt the orphaned snapshots instead of snapshotting
        // the currently-modded bytes as "stock".
        apply_preloader_selection(&root, &data, &zip_path, &selection).unwrap();
        let report = revert_preloader(&root, &data).unwrap();
        assert!(report.failures.is_empty(), "{:?}", report.failures);
        assert_eq!(std::fs::read(&sibling_path).unwrap(), pristine_sibling);
    }

    /// mtime moves whenever we patch (and when restores half-fail); only a
    /// resized VPK is a game update. Drift alone must not trigger the
    /// baseline reset that throws snapshots away.
    #[test]
    fn mtime_drift_does_not_reset_baseline() {
        let (root, data) = fake_root();
        let zip_path = fake_mods_zip(root.parent().unwrap());
        let vpk_path = root.join("tf").join(MISC_VPK);
        let sibling_path = root.join("tf").join("tf2_misc_000.vpk");
        let pristine_sibling = std::fs::read(&sibling_path).unwrap();

        apply_preloader_selection(
            &root,
            &data,
            &zip_path,
            &PreloaderSelection {
                addons: vec![],
                particle_mods: vec!["Blue Water".into()],
            },
        )
        .unwrap();

        // Touch the file without changing content or length.
        let current = std::fs::read(&vpk_path).unwrap();
        std::fs::write(&vpk_path, &current).unwrap();

        assert!(!preloader_status(&root, &data).unwrap().stale);
        let report = revert_preloader(&root, &data).unwrap();
        assert!(
            !report.restored_files.is_empty(),
            "drift must not skip the restore: {:?}",
            report.failures
        );
        assert_eq!(std::fs::read(&sibling_path).unwrap(), pristine_sibling);
    }

    #[test]
    fn oversized_mod_is_skipped_with_notice() {
        let (root, data) = fake_root();
        let dir = root.parent().unwrap();
        let zip_path = dir.join("big.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer
            .start_file("mods/particles/Big/actual_particles/water.pcf", options)
            .unwrap();
        // A pcf with a huge un-shrinkable payload: binary attr of spaces.
        let mut big = PcfFile {
            version: PCF_HEADERS[1].to_string(),
            string_dictionary: vec![
                b"DmeElement".to_vec(),
                b"particleSystemDefinitions".to_vec(),
                b"payload".to_vec(),
            ],
            elements: vec![PcfElement {
                type_name_index: 0,
                name: b"root".to_vec(),
                signature: [0; 16],
                attributes: vec![(
                    b"particleSystemDefinitions".to_vec(),
                    PcfAttr {
                        type_code: crate::pcf::ELEMENT_ARRAY_TYPE,
                        value: PcfValue::Array(vec![]),
                    },
                )],
            }],
        };
        big.elements[0].attributes.push((
            b"payload".to_vec(),
            PcfAttr {
                type_code: 6,
                value: PcfValue::Binary(vec![b' '; 4096]),
            },
        ));
        writer.write_all(&encode_pcf(&big).unwrap()).unwrap();
        writer.finish().unwrap();

        let vpk_before = std::fs::read(root.join("tf").join(MISC_VPK)).unwrap();
        let sibling_before = std::fs::read(root.join("tf").join("tf2_misc_000.vpk")).unwrap();
        let report = apply_preloader_selection(
            &root,
            &data,
            &zip_path,
            &PreloaderSelection {
                addons: vec![],
                particle_mods: vec!["Big".into()],
            },
        )
        .unwrap();
        assert!(report.patched_files.is_empty());
        assert!(report
            .skipped
            .iter()
            .any(|notice| notice.file == "water.pcf" && notice.reason.contains("over the stock budget")));
        assert_eq!(std::fs::read(root.join("tf").join(MISC_VPK)).unwrap(), vpk_before);
        assert_eq!(
            std::fs::read(root.join("tf").join("tf2_misc_000.vpk")).unwrap(),
            sibling_before
        );
    }

    #[test]
    fn rebuild_keep_lists_prefer_sole_homes() {
        let mut roots = BTreeMap::new();
        roots.insert(
            "bigboom.pcf".to_string(),
            vec!["boom_own".to_string(), "shared".to_string(), "dup_only".to_string()],
        );
        roots.insert("explosion.pcf".to_string(), vec!["shared".to_string()]);
        roots.insert("halloween.pcf".to_string(), vec!["dup_only".to_string()]);
        let keep = rebuild_keep_lists(&roots);
        let bigboom = &keep["bigboom.pcf"];
        assert!(bigboom.contains(&"boom_own".to_string()));
        assert!(!bigboom.contains(&"shared".to_string()));
        // Shared only among rebuild files: alphabetically first keeps it.
        assert!(bigboom.contains(&"dup_only".to_string()));
        assert!(!keep["halloween.pcf"].contains(&"dup_only".to_string()));
    }
}
