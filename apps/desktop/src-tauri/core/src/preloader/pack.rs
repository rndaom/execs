//! Building the global `tf/custom/execs-preloader.vpk`: `$ignorez` scrubbing,
//! moving model materials under `console/`, synthesizing missing VMTs, and
//! working out which stock paths a pack would shadow.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::vpk::{map_vpk_entries, read_vpk_entry, VpkEntryLocation};

use super::{STOCK_VPKS, TRUSTED_ROOTS};

pub(crate) const IGNOREZ_PATTERNS: [&[u8]; 8] = [
    b"\"$ignorez\"\t\"1\"",
    b"\"$ignorez\"\t1",
    b"$ignorez\t\"1\"",
    b"$ignorez\t1",
    b"\"$ignorez\" \"1\"",
    b"\"$ignorez\" 1",
    b"$ignorez \"1\"",
    b"$ignorez 1",
];

pub(crate) const SCRUB_PREFIXES: [&str; 6] = [
    "materials/effects/",
    "materials/models/",
    "materials/particle/",
    "materials/particles/",
    "materials/prediction/",
    "materials/sprites/healbeam",
];

pub(crate) fn scrub_ignorez(rel: &str, bytes: &mut [u8]) {
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
pub(crate) const RELOCATE_PREFIX: &str = "console";

/// Move the materials a staged model owns under [`RELOCATE_PREFIX`] and point
/// the model at the new location, keeping its original path as a fallback so
/// anything the mod does not ship still resolves to stock.
///
/// Only directories the mod actually ships materials for are moved; world and
/// brush materials are left alone, since those ride the gameinfo bypass.
/// Returns how many files moved.
pub(crate) fn relocate_model_materials(custom: &mut BTreeMap<String, Vec<u8>>) -> usize {
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
        let Some(dirs) = custom
            .get(model)
            .and_then(|bytes| crate::mdl::material_dirs(bytes))
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
pub(crate) fn rewrite_vmt_refs(text: &str, moved_textures: &BTreeSet<String>) -> String {
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
pub(crate) fn stock_entry_tables(
    tf2_root: &Path,
) -> Vec<(PathBuf, BTreeMap<String, VpkEntryLocation>)> {
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
pub(crate) fn synthesize_missing_vmts(
    tf2_root: &Path,
    custom: &mut BTreeMap<String, Vec<u8>>,
) -> usize {
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
pub(crate) fn default_vmt(vmt: &str) -> Vec<u8> {
    let texture = vmt
        .trim_start_matches("materials/")
        .trim_end_matches(".vmt");
    let shader = if vmt.starts_with("materials/models/") {
        "VertexLitGeneric"
    } else {
        "LightmappedGeneric"
    };
    format!(
        "\"{shader}\"
{{
	\"$basetexture\"	\"{texture}\"
}}
"
    )
    .into_bytes()
}

/// Paths in `files` that replace an asset the pure whitelist trusts, and so
/// cannot be served from `tf/custom`. Paths outside the trusted roots (a mod's
/// own new materials, scripts) are left alone.
pub(crate) fn stock_shadowing_paths(
    tf2_root: &Path,
    files: &BTreeMap<String, Vec<u8>>,
) -> Vec<String> {
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

pub(crate) fn is_excluded_addon_file(inner: &str) -> bool {
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
