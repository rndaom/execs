//! Read-only local item descriptions and base backpack artwork. No Steam session.
use crate::{
    vdf::{parse_hud_vdf, parse_vdf, VdfMap, VdfValue},
    vpk, vtf_read,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    path::Path,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub name: String,
    pub kind: String,
    pub classes: Vec<String>,
    pub icon: Option<String>,
}

fn text(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        if !bytes.len().is_multiple_of(2) {
            return Err("Truncated UTF-16 item text".into());
        }
        String::from_utf16(
            &bytes[2..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|e| e.to_string())
    } else {
        String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())
    }
}

fn read_text(root: &Path, relative: &str) -> Result<String, String> {
    let path = root.join("tf").join(relative);
    let bytes = if path.is_file() {
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("Item metadata exceeds limit".into());
        }
        bytes
    } else {
        vpk::read_vpk_dir_file_filtered_bounded(
            &root.join("tf/tf2_misc_dir.vpk"),
            &|p| p == relative,
            16 * 1024 * 1024,
            16 * 1024 * 1024,
        )
        .map_err(|e| e.message())?
        .files
        .remove(relative)
        .ok_or("Missing Valve item metadata")?
    };
    text(&bytes)
}

fn object<'a>(map: &'a VdfMap, name: &str) -> Option<&'a VdfMap> {
    map.get(name)?.as_obj()
}
fn string<'a>(map: &'a VdfMap, name: &str) -> Option<&'a str> {
    map.get(name)?.as_str()
}

fn inherited(map: &VdfMap, prefabs: &VdfMap, depth: usize) -> Result<VdfMap, String> {
    if depth > 16 {
        return Err("Item prefab nesting exceeds limit".into());
    }
    let mut result = VdfMap::default();
    for name in string(map, "prefab").unwrap_or("").split_whitespace() {
        if let Some(parent) = object(prefabs, name) {
            result.merge_from(&inherited(parent, prefabs, depth + 1)?);
        }
    }
    result.merge_from(map);
    Ok(result)
}

fn localized(value: &str, tokens: &VdfMap) -> String {
    value
        .strip_prefix('#')
        .and_then(|key| string(tokens, key))
        .unwrap_or(value)
        .to_string()
}

pub fn definitions(root: &Path, ids: &BTreeSet<u32>) -> Result<BTreeMap<u32, Definition>, String> {
    let schema = parse_hud_vdf(&read_text(root, "scripts/items/items_game.txt")?)?;
    let language = parse_vdf(&read_text(root, "resource/tf_english.txt")?)?;
    let tokens = object(&language, "lang")
        .and_then(|m| object(m, "Tokens"))
        .ok_or("Missing item language tokens")?;
    let game = object(&schema, "items_game").ok_or("Missing item schema")?;
    let items = object(game, "items").ok_or("Missing items")?;
    let empty = VdfMap::default();
    let prefabs = object(game, "prefabs").unwrap_or(&empty);
    let mut result = BTreeMap::new();
    for id in ids {
        let Some(item) = object(items, &id.to_string()) else {
            continue;
        };
        let item = inherited(item, prefabs, 0)?;
        let name = localized(
            string(&item, "item_name")
                .or_else(|| string(&item, "name"))
                .unwrap_or("Unknown item"),
            tokens,
        );
        let kind = localized(string(&item, "item_type_name").unwrap_or("Item"), tokens);
        let classes = object(&item, "used_by_classes")
            .map(|m| {
                m.entries
                    .iter()
                    .filter(|(_, v)| matches!(v, VdfValue::Str(s) if s != "0"))
                    .map(|(k, _)| k.clone())
                    .collect()
            })
            .unwrap_or_default();
        let icon = string(&item, "image_inventory")
            .map(|s| format!("materials/{s}.vtf"))
            .filter(|s| valid_icon(s));
        result.insert(
            *id,
            Definition {
                name,
                kind,
                classes,
                icon,
            },
        );
    }
    Ok(result)
}

fn valid_icon(path: &str) -> bool {
    path.len() < 256
        && path.starts_with("materials/backpack/")
        && path.ends_with(".vtf")
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
        && !path.contains(['\\', ':'])
}

#[derive(Serialize)]
pub struct Icon {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

pub fn icons(root: &Path, paths: &[String]) -> Result<BTreeMap<String, Icon>, String> {
    if paths.len() > 50 || paths.iter().any(|p| !valid_icon(p)) {
        return Err("Invalid inventory icon request".into());
    }
    let wanted: BTreeSet<_> = paths.iter().map(String::as_str).collect();
    let archive = vpk::read_vpk_dir_file_filtered_bounded(
        &root.join("tf/tf2_textures_dir.vpk"),
        &|p| wanted.contains(p),
        4 * 1024 * 1024,
        32 * 1024 * 1024,
    )
    .map_err(|e| e.message())?;
    let mut result = BTreeMap::new();
    for (path, bytes) in archive.files {
        if bytes.len() < 20 {
            continue;
        }
        let width = u16::from_le_bytes([bytes[16], bytes[17]]);
        let height = u16::from_le_bytes([bytes[18], bytes[19]]);
        if width > 512 || height > 512 {
            continue;
        }
        let Ok(decoded) = vtf_read::decode_vtf_frame0(&bytes) else {
            continue;
        };
        let width = decoded.width.min(96);
        let height = (decoded.height * width / decoded.width).max(1);
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let offset = (((y * decoded.height / height) * decoded.width
                    + x * decoded.width / width)
                    * 4) as usize;
                rgba.extend_from_slice(&decoded.rgba[offset..offset + 4]);
            }
        }
        result.insert(
            path,
            Icon {
                width,
                height,
                rgba,
            },
        );
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn icon_requests_cannot_escape_backpack_namespace() {
        assert!(valid_icon(
            "materials/backpack/weapons/w_models/w_scattergun.vtf"
        ));
        for path in [
            "materials/backpack/../secret.vtf",
            "materials/backpack/C:/a.vtf",
            "../x.vtf",
            "materials/backpack/a\\b.vtf",
        ] {
            assert!(!valid_icon(path));
        }
    }
    #[test]
    fn prefab_overrides_keep_inherited_fields_and_reject_cycles() {
        let prefabs = parse_hud_vdf(
            "\"base\" { \"item_name\" \"#Base\" \"image_inventory\" \"backpack/base\" }",
        )
        .unwrap();
        let item = parse_hud_vdf("\"prefab\" \"base\" \"item_name\" \"#Child\"").unwrap();
        let merged = inherited(&item, &prefabs, 0).unwrap();
        assert_eq!(string(&merged, "item_name"), Some("#Child"));
        assert_eq!(string(&merged, "image_inventory"), Some("backpack/base"));
        let cycle = parse_hud_vdf("\"base\" { \"prefab\" \"base\" }").unwrap();
        assert!(inherited(&item, &cycle, 0).is_err());
    }
}
