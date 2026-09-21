//! Read-only local item descriptions and base backpack artwork. No Steam session.
mod paintkits;
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

pub struct ItemInput<'a> {
    pub id: &'a str,
    pub definition: u32,
    pub attributes: Vec<(u32, &'a [u8])>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDescription {
    #[serde(flatten)]
    pub definition: Definition,
    pub details: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub definitions: BTreeMap<u32, Definition>,
    pub item_descriptions: BTreeMap<String, ItemDescription>,
}

fn bits(attributes: &[(u32, &[u8])], id: u32) -> Option<u32> {
    let mut matches = attributes.iter().filter(|(key, _)| *key == id);
    let value = u32::from_le_bytes(matches.next()?.1.try_into().ok()?);
    // Ambiguous values are not a basis for an item identity.
    matches.next().is_none().then_some(value)
}

fn float_id(attributes: &[(u32, &[u8])], id: u32) -> Option<u32> {
    let value = f32::from_bits(bits(attributes, id)?);
    (value.is_finite() && (0.0..=1_000_000.0).contains(&value) && value.fract() == 0.0)
        .then_some(value as u32)
}

fn wear_name(value: f32) -> Option<&'static str> {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return None;
    }
    Some(if value <= 0.2 {
        "Factory New"
    } else if value <= 0.4 {
        "Minimal Wear"
    } else if value <= 0.6 {
        "Field-Tested"
    } else if value <= 0.8 {
        "Well-Worn"
    } else {
        "Battle Scarred"
    })
}

pub fn metadata(root: &Path, inputs: &[ItemInput<'_>]) -> Result<Metadata, String> {
    if inputs.len() > 100_000 || inputs.iter().any(|i| i.attributes.len() > 256) {
        return Err("Inventory metadata limit exceeded".into());
    }
    let schema = parse_hud_vdf(&read_text(root, "scripts/items/items_game.txt")?)?;
    let language = parse_vdf(&read_text(root, "resource/tf_english.txt")?)?;
    let tokens = object(&language, "lang")
        .and_then(|m| object(m, "Tokens"))
        .ok_or("Missing item language tokens")?;
    let game = object(&schema, "items_game").ok_or("Missing item schema")?;
    let attributes: Vec<_> = inputs
        .iter()
        .map(|input| resolved_attributes(game, input))
        .collect::<Result<_, _>>()?;
    let mut ids: BTreeSet<_> = inputs.iter().map(|i| i.definition).collect();
    for attributes in &attributes {
        let attributes: Vec<_> = attributes
            .iter()
            .map(|(id, value)| (*id, value.as_slice()))
            .collect();
        if let Some(target) = float_id(&attributes, 2012) {
            ids.insert(target);
        }
    }
    let definitions = definitions_from(game, tokens, &ids)?;
    let paint_names = read_bytes(root, "scripts/protodefs/proto_defs.vpd")
        .and_then(|bytes| paintkits::names(&bytes))
        .unwrap_or_default();
    let paint_language = read_text(root, "resource/tf_proto_obj_defs_english.txt")
        .and_then(|text| parse_vdf(&text))
        .unwrap_or_default();
    let empty = VdfMap::default();
    let paint_tokens = object(&paint_language, "lang")
        .and_then(|m| object(m, "Tokens"))
        .unwrap_or(&empty);
    let mut item_descriptions = BTreeMap::new();
    for (input, attributes) in inputs.iter().zip(&attributes) {
        let Some(base) = definitions.get(&input.definition) else {
            continue;
        };
        let mut description = ItemDescription {
            definition: base.clone(),
            details: Vec::new(),
        };
        let attributes: Vec<_> = attributes
            .iter()
            .map(|(id, value)| (*id, value.as_slice()))
            .collect();
        enrich(
            &mut description,
            &attributes,
            &definitions,
            &paint_names,
            paint_tokens,
            tokens,
        );
        item_descriptions.insert(input.id.to_string(), description);
    }
    Ok(Metadata {
        definitions,
        item_descriptions,
    })
}

fn resolved_attributes(
    game: &VdfMap,
    input: &ItemInput<'_>,
) -> Result<Vec<(u32, Vec<u8>)>, String> {
    let mut result: Vec<_> = input
        .attributes
        .iter()
        .map(|(id, value)| (*id, value.to_vec()))
        .collect();
    if let Some(output) = recipe_output(&input.attributes) {
        for (id, value) in output {
            if !result.iter().any(|(key, _)| *key == id) {
                result.push((id, value));
            }
        }
    }
    let Some(item) =
        object(game, "items").and_then(|items| object(items, &input.definition.to_string()))
    else {
        return Ok(result);
    };
    let empty = VdfMap::default();
    let item = inherited(item, object(game, "prefabs").unwrap_or(&empty), 0)?;
    let definitions = object(game, "attributes").unwrap_or(&empty);
    for id in [834, 725, 2012, 2013, 2014, 2025, 134] {
        if result.iter().any(|(key, _)| *key == id) {
            continue;
        }
        let Some(attribute) = object(definitions, &id.to_string()) else {
            continue;
        };
        let Some(name) = string(attribute, "name") else {
            continue;
        };
        let value = object(&item, "static_attrs")
            .and_then(|attrs| string(attrs, name))
            .or_else(|| {
                object(&item, "attributes")
                    .and_then(|attrs| object(attrs, name))
                    .and_then(|attr| string(attr, "value"))
            });
        let Some(value) = value else {
            continue;
        };
        let bits = if string(attribute, "stored_as_integer") == Some("1") {
            value.parse::<u32>().ok()
        } else {
            value
                .parse::<f32>()
                .ok()
                .filter(|value| value.is_finite())
                .map(f32::to_bits)
        };
        if let Some(bits) = bits {
            result.push((id, bits.to_le_bytes().to_vec()));
        }
    }
    Ok(result)
}

// The fabricator output describes the resulting kit, including its target and
// sheen. Inputs must never be mistaken for the output. Wire fields and separator
// are specified by Valve's tf_gcmessages.proto / econ_dynamic_recipe.cpp.
fn recipe_output(attributes: &[(u32, &[u8])]) -> Option<Vec<(u32, Vec<u8>)>> {
    use paintkits::Field;
    let mut output = None;
    for (_, bytes) in attributes
        .iter()
        .filter(|(id, _)| (2000..=2009).contains(id))
    {
        let mut flags = None;
        let mut encoded = None;
        for (id, value) in paintkits::fields(bytes).ok()? {
            match (id, value) {
                (3, Field::Number(value)) => {
                    if flags.is_some() {
                        return None;
                    }
                    flags = Some(value);
                }
                (4, Field::Bytes(value)) => {
                    if encoded.is_some() {
                        return None;
                    }
                    encoded = Some(std::str::from_utf8(value).ok()?);
                }
                _ => {}
            }
        }
        if flags.unwrap_or(0) & 1 == 0 {
            continue;
        }
        if output.is_some() {
            return None;
        }
        let mut values = Vec::new();
        if let Some(encoded) = encoded {
            let parts: Vec<_> = encoded
                .split("|\u{1}\u{2}\u{1}\u{3}|\u{1}\u{2}\u{1}\u{3}|")
                .filter(|part| !part.is_empty())
                .collect();
            if !parts.len().is_multiple_of(2) || parts.len() > 256 {
                return None;
            }
            for pair in parts.as_chunks::<2>().0 {
                let id = pair[0].parse::<u32>().ok()?;
                if ![2012, 2013, 2014, 2025].contains(&id) {
                    continue;
                }
                if values.iter().any(|(key, _)| *key == id) {
                    return None;
                }
                let value = pair[1].parse::<f32>().ok()?;
                if !value.is_finite() {
                    return None;
                }
                values.push((id, value.to_le_bytes().to_vec()));
            }
        }
        output = Some(values);
    }
    output
}

fn enrich(
    description: &mut ItemDescription,
    attributes: &[(u32, &[u8])],
    definitions: &BTreeMap<u32, Definition>,
    paint_names: &BTreeMap<u32, paintkits::Paint>,
    paint_tokens: &VdfMap,
    tokens: &VdfMap,
) {
    if let Some(paint) = bits(attributes, 834) {
        let name = paint_names.get(&paint).and_then(|paint| {
            string(
                paint_tokens,
                paint.name.strip_prefix('#').unwrap_or(&paint.name),
            )
        });
        description.definition.name = format!(
            "{} {}",
            name.map(str::to_owned)
                .unwrap_or_else(|| format!("Pattern {paint}")),
            description.definition.name
        );
        description.definition.icon = paint_names.get(&paint).and_then(|paint| paint.icon.clone());
        description.details.push(
            if description.definition.icon.is_some() {
                "Pattern swatch · wear not shown"
            } else {
                "Pattern preview unavailable"
            }
            .into(),
        );
    }
    if let Some(wear) = bits(attributes, 725).and_then(|v| wear_name(f32::from_bits(v))) {
        description.details.insert(0, wear.into());
    }
    if let Some(target) = float_id(attributes, 2012).and_then(|id| definitions.get(&id)) {
        description.definition.name = format!("{} · {}", description.definition.name, target.name);
        description.details.push(format!("For {}", target.name));
    }
    if let Some(tier) = float_id(attributes, 2025) {
        let prefix = match tier {
            1 => Some("Killstreak"),
            2 => Some("Specialized Killstreak"),
            3 => Some("Professional Killstreak"),
            _ => None,
        };
        if let Some(prefix) = prefix {
            if !description.definition.name.starts_with(prefix) {
                description.definition.name = format!("{prefix} {}", description.definition.name);
            }
        }
    }
    for (id, token, label) in [
        (2013, "Attrib_KillStreakEffect", "Killstreaker"),
        (2014, "Attrib_KillStreakIdleEffect", "Sheen"),
        (134, "Attrib_Particle", "Effect"),
    ] {
        if let Some(effect) = float_id(attributes, id) {
            if let Some(name) = string(tokens, &format!("{token}{effect}")) {
                description.details.push(format!("{label}: {name}"));
            }
        }
    }
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
    text(&read_bytes(root, relative)?)
}

fn read_bytes(root: &Path, relative: &str) -> Result<Vec<u8>, String> {
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
    Ok(bytes)
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
    definitions_from(game, tokens, ids)
}

fn definitions_from(
    game: &VdfMap,
    tokens: &VdfMap,
    ids: &BTreeSet<u32>,
) -> Result<BTreeMap<u32, Definition>, String> {
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
        && (path.starts_with("materials/backpack/") || path.starts_with("materials/patterns/"))
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
        // Pattern layers can be larger than backpack icons. Bound the decoded
        // frame to 16 MiB before invoking the decoder; returned artwork is small.
        if width == 0 || height == 0 || width > 2048 || height > 2048 {
            continue;
        }
        let Ok(decoded) = vtf_read::decode_vtf_frame0(&bytes) else {
            continue;
        };
        let longest = decoded.width.max(decoded.height);
        let width = (decoded.width * longest.min(192) / longest).max(1);
        let height = (decoded.height * longest.min(192) / longest).max(1);
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
    fn description(name: &str) -> ItemDescription {
        ItemDescription {
            definition: Definition {
                name: name.into(),
                kind: "Item".into(),
                classes: vec![],
                icon: Some("materials/backpack/base.vtf".into()),
            },
            details: vec![],
        }
    }

    #[test]
    fn variants_use_exact_pattern_and_target_with_validated_numbers() {
        let tokens = parse_hud_vdf(
            "\"PaintName\" \"Woodland\" \"Attrib_KillStreakIdleEffect7\" \"Hot Rod\"",
        )
        .unwrap();
        let paint = 42u32.to_le_bytes();
        let wear = 0.3f32.to_le_bytes();
        let target = 18f32.to_le_bytes();
        let tier = 3f32.to_le_bytes();
        let sheen = 7f32.to_le_bytes();
        let definitions = [(18, description("Rocket Launcher").definition)]
            .into_iter()
            .collect();
        let names = [(
            42,
            paintkits::Paint {
                name: "#PaintName".into(),
                icon: None,
            },
        )]
        .into_iter()
        .collect();
        let mut painted = description("War Paint");
        enrich(
            &mut painted,
            &[(834, &paint), (725, &wear)],
            &definitions,
            &names,
            &tokens,
            &tokens,
        );
        assert_eq!(painted.definition.name, "Woodland War Paint");
        assert!(painted.definition.icon.is_none());
        assert!(painted.details.contains(&"Minimal Wear".into()));
        let mut kit = description("Kit");
        enrich(
            &mut kit,
            &[(2012, &target), (2025, &tier), (2014, &sheen)],
            &definitions,
            &names,
            &tokens,
            &tokens,
        );
        assert_eq!(
            kit.definition.name,
            "Professional Killstreak Kit · Rocket Launcher"
        );
        assert!(kit.details.contains(&"Sheen: Hot Rod".into()));
        assert!(float_id(&[(2012, &f32::NAN.to_le_bytes())], 2012).is_none());
        assert!(float_id(&[(2012, &18.5f32.to_le_bytes())], 2012).is_none());
        assert!(bits(&[(834, &paint), (834, &paint)], 834).is_none());
        assert!(wear_name(f32::NAN).is_none());
        assert!(wear_name(1.1).is_none());
    }

    #[test]
    fn schema_static_attributes_resolve_without_overriding_instance_data() {
        let game = parse_hud_vdf(
            r#"
            "prefabs" { "paint" { "static_attrs" { "paintkit_proto_def_index" "42" } } }
            "items" { "9" { "prefab" "paint" } }
            "attributes" { "834" { "name" "paintkit_proto_def_index" "stored_as_integer" "1" } }
        "#,
        )
        .unwrap();
        let mut input = ItemInput {
            id: "test",
            definition: 9,
            attributes: vec![],
        };
        assert_eq!(
            resolved_attributes(&game, &input).unwrap(),
            vec![(834, 42u32.to_le_bytes().to_vec())]
        );
        let bytes = 21u32.to_le_bytes();
        input.attributes.push((834, &bytes));
        assert_eq!(
            resolved_attributes(&game, &input).unwrap(),
            vec![(834, bytes.to_vec())]
        );
    }

    #[test]
    fn fabricator_reads_output_target_and_rejects_ambiguous_or_malformed_recipes() {
        let separator = "|\u{1}\u{2}\u{1}\u{3}|\u{1}\u{2}\u{1}\u{3}|";
        let encoded =
            format!("2012{separator}18{separator}2025{separator}3{separator}2014{separator}7");
        let mut output = vec![24, 1, 34, encoded.len() as u8];
        output.extend(encoded.bytes());
        let values = recipe_output(&[(2000, &[24, 0]), (2001, &output)]).unwrap();
        let refs: Vec<_> = values
            .iter()
            .map(|(id, value)| (*id, value.as_slice()))
            .collect();
        assert_eq!(float_id(&refs, 2012), Some(18));
        assert_eq!(float_id(&refs, 2025), Some(3));
        assert_eq!(float_id(&refs, 2014), Some(7));
        assert!(recipe_output(&[(2000, &output), (2001, &output)]).is_none());
        assert!(recipe_output(&[(2000, &output[..output.len() - 1])]).is_none());
        assert!(recipe_output(&[(2000, &[24, 0])]).is_none());
        let mut duplicate_flags = output.clone();
        duplicate_flags.extend([24, 1]);
        assert!(recipe_output(&[(2000, &duplicate_flags)]).is_none());
        let mut duplicate_string = output.clone();
        duplicate_string.extend([34, 0]);
        assert!(recipe_output(&[(2000, &duplicate_string)]).is_none());
        let encoded = format!("2012{separator}18{separator}2012{separator}19");
        let mut duplicate_target = vec![24, 1, 34, encoded.len() as u8];
        duplicate_target.extend(encoded.bytes());
        assert!(recipe_output(&[(2000, &duplicate_target)]).is_none());
    }

    #[test]
    fn icon_requests_cannot_escape_backpack_namespace() {
        assert!(valid_icon(
            "materials/backpack/weapons/w_models/w_scattergun.vtf"
        ));
        assert!(valid_icon("materials/patterns/workshop/wood.vtf"));
        for path in [
            "materials/backpack/../secret.vtf",
            "materials/backpack/C:/a.vtf",
            "../x.vtf",
            "materials/backpack/a\\b.vtf",
            "materials/patterns/../secret.vtf",
            "materials/models/player.vtf",
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
