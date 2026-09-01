//! First-party HUD option apply. MIT schemas are data; this is our engine.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::hud::{normalize_hud_rel, HudTree};
use crate::profile::ProfileError;
use crate::vdf::{parse_vdf, serialize_vdf, VdfMap, VdfValue};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HudSchema {
    #[serde(rename = "Author", default)]
    pub author: String,
    #[serde(rename = "CustomizationsFolder", default)]
    pub customizations_folder: Option<String>,
    #[serde(rename = "EnabledFolder", default)]
    pub enabled_folder: Option<String>,
    #[serde(rename = "Controls", default)]
    pub controls: BTreeMap<String, Vec<HudControl>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HudControl {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Label", default)]
    pub label: String,
    #[serde(rename = "Type", default)]
    pub control_type: String,
    #[serde(rename = "Value", default)]
    pub value: String,
    #[serde(rename = "Files")]
    pub files: Option<serde_json::Value>,
    #[serde(rename = "FileName")]
    pub file_name: Option<String>,
    #[serde(rename = "RenameFile")]
    pub rename_file: Option<RenameFile>,
    #[serde(rename = "WriteFile")]
    pub write_file: Option<WriteSnippet>,
    #[serde(rename = "WriteCfg")]
    pub write_cfg: Option<WriteSnippet>,
    #[serde(rename = "Options")]
    pub options: Option<Vec<HudControl>>,
    #[serde(rename = "Minimum")]
    pub minimum: Option<serde_json::Value>,
    #[serde(rename = "Maximum")]
    pub maximum: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenameFile {
    #[serde(rename = "OldName")]
    pub old_name: String,
    #[serde(rename = "NewName")]
    pub new_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteSnippet {
    #[serde(rename = "FileName")]
    pub file_name: String,
    #[serde(rename = "TrueText", default)]
    pub true_text: String,
    #[serde(rename = "FalseText", default)]
    pub false_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudSchemaView {
    pub author: String,
    pub supported: bool,
    pub sections: Vec<HudSchemaSection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudSchemaSection {
    pub name: String,
    pub controls: Vec<HudSchemaControl>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudSchemaControl {
    pub name: String,
    pub label: String,
    pub control_type: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub choices: Vec<HudSchemaChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudSchemaChoice {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HudApplyResult {
    pub cfg_writes: Vec<(String, Vec<u8>)>,
}

pub fn parse_hud_schema(raw: &str) -> Result<HudSchema, ProfileError> {
    serde_json::from_str(raw).map_err(|err| ProfileError::Io(err.to_string()))
}

pub fn schema_view(schema: &HudSchema) -> HudSchemaView {
    let sections = schema
        .controls
        .iter()
        .map(|(name, controls)| HudSchemaSection {
            name: name.clone(),
            controls: controls.iter().filter_map(view_control).collect(),
        })
        .filter(|section| !section.controls.is_empty())
        .collect();
    HudSchemaView {
        author: schema.author.clone(),
        supported: true,
        sections,
    }
}

pub fn apply_hud_options(
    tree: &mut HudTree,
    schema: &HudSchema,
    hud_id: &str,
    options: &BTreeMap<String, String>,
) -> Result<HudApplyResult, ProfileError> {
    let custom = schema
        .customizations_folder
        .as_deref()
        .map(normalize_folder);
    let enabled = schema.enabled_folder.as_deref().map(normalize_folder);
    let mut cfg_writes = Vec::new();
    for controls in schema.controls.values() {
        for control in controls {
            apply_control(
                tree,
                control,
                options,
                custom.as_deref(),
                enabled.as_deref(),
                hud_id,
                &mut cfg_writes,
            )?;
        }
    }
    Ok(HudApplyResult { cfg_writes })
}

fn view_control(control: &HudControl) -> Option<HudSchemaControl> {
    let kind = normalize_type(&control.control_type);
    if !matches!(kind, "checkbox" | "color" | "combo" | "number") {
        return None;
    }
    let choices = control
        .options
        .as_ref()
        .map(|options| {
            options
                .iter()
                .map(|option| HudSchemaChoice {
                    label: if option.label.is_empty() {
                        option.value.clone()
                    } else {
                        option.label.clone()
                    },
                    value: option.value.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(HudSchemaControl {
        name: control.name.clone(),
        label: if control.label.is_empty() {
            control.name.clone()
        } else {
            control.label.clone()
        },
        control_type: kind.to_string(),
        value: control.value.clone(),
        choices,
        minimum: control.minimum.as_ref().map(json_to_string),
        maximum: control.maximum.as_ref().map(json_to_string),
    })
}

fn apply_control(
    tree: &mut HudTree,
    control: &HudControl,
    options: &BTreeMap<String, String>,
    custom: Option<&str>,
    enabled: Option<&str>,
    hud_id: &str,
    cfg_writes: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), ProfileError> {
    let kind = normalize_type(&control.control_type);
    let current = options
        .get(&control.name)
        .cloned()
        .unwrap_or_else(|| control.value.clone());
    match kind {
        "checkbox" => {
            let on = is_truthy(&current);
            if let (Some(file_name), Some(custom), Some(enabled)) =
                (control.file_name.as_deref(), custom, enabled)
            {
                swap_custom_file(tree, custom, enabled, file_name, on);
            }
            if let Some(rename) = &control.rename_file {
                if on {
                    tree.rename(
                        &normalize_folder(&rename.old_name),
                        &normalize_folder(&rename.new_name),
                    );
                } else {
                    tree.rename(
                        &normalize_folder(&rename.new_name),
                        &normalize_folder(&rename.old_name),
                    );
                }
            }
            if let Some(files) = &control.files {
                merge_files(tree, files, if on { "1" } else { "0" })?;
            }
            if let Some(write) = &control.write_file {
                let text = if on {
                    &write.true_text
                } else {
                    &write.false_text
                };
                tree.insert(normalize_folder(&write.file_name), text.as_bytes().to_vec());
            }
            if let Some(write) = &control.write_cfg {
                let text = if on {
                    &write.true_text
                } else {
                    &write.false_text
                };
                cfg_writes.push((
                    format!("tf/cfg/{hud_id}/{}", normalize_folder(&write.file_name)),
                    text.as_bytes().to_vec(),
                ));
            }
        }
        "color" | "number" => {
            apply_value_files(tree, control, &current, custom, enabled, hud_id, cfg_writes)?;
        }
        "combo" => {
            if let Some(choice) = control
                .options
                .as_ref()
                .and_then(|options| options.iter().find(|option| option.value == current))
            {
                apply_control(tree, choice, options, custom, enabled, hud_id, cfg_writes)?;
            } else {
                apply_value_files(tree, control, &current, custom, enabled, hud_id, cfg_writes)?;
            }
        }
        _ => {
            apply_value_files(tree, control, &current, custom, enabled, hud_id, cfg_writes)?;
        }
    }
    Ok(())
}

fn apply_value_files(
    tree: &mut HudTree,
    control: &HudControl,
    current: &str,
    custom: Option<&str>,
    enabled: Option<&str>,
    hud_id: &str,
    cfg_writes: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), ProfileError> {
    if let (Some(file_name), Some(custom), Some(enabled)) =
        (control.file_name.as_deref(), custom, enabled)
    {
        swap_custom_file(tree, custom, enabled, file_name, true);
    }
    if let Some(files) = &control.files {
        merge_files(tree, files, current)?;
    }
    if let Some(write) = &control.write_file {
        tree.insert(
            normalize_folder(&write.file_name),
            write.true_text.as_bytes().to_vec(),
        );
    }
    if let Some(write) = &control.write_cfg {
        cfg_writes.push((
            format!("tf/cfg/{hud_id}/{}", normalize_folder(&write.file_name)),
            write.true_text.as_bytes().to_vec(),
        ));
    }
    Ok(())
}

fn swap_custom_file(tree: &mut HudTree, custom: &str, enabled: &str, file_name: &str, on: bool) {
    let from = if on {
        format!("{custom}/{file_name}")
    } else {
        format!("{enabled}/{file_name}")
    };
    let to = if on {
        format!("{enabled}/{file_name}")
    } else {
        format!("{custom}/{file_name}")
    };
    tree.rename(&from, &to);
}

fn merge_files(
    tree: &mut HudTree,
    files: &serde_json::Value,
    value: &str,
) -> Result<(), ProfileError> {
    let Some(map) = files.as_object() else {
        return Ok(());
    };
    for (path, patch) in map {
        let rel = normalize_hud_rel(path);
        if let Some(base) = patch.get("#base") {
            write_base_file(tree, &rel, base, value)?;
            continue;
        }
        let (existing, encoding) = match tree.get(&rel) {
            Some(bytes) => decode_hud_text(&rel, bytes)?,
            None => (String::new(), TextEncoding::Utf8),
        };
        let (bases, rest) = split_base_lines(&existing);
        let mut vdf = if rest.trim().is_empty() {
            VdfMap::default()
        } else {
            parse_vdf(&rest).map_err(ProfileError::Io)?
        };
        let patch_map = json_to_vdf(patch, value);
        vdf.merge_from(&patch_map);
        let mut out = String::new();
        for line in bases {
            out.push_str(&line);
            out.push('\n');
        }
        out.push_str(&serialize_vdf(&vdf));
        tree.insert(rel, encode_hud_text(&out, encoding));
    }
    Ok(())
}

/// Which encoding a HUD `.res` file arrived in. Plenty of shipped HUD resource
/// files are UTF-16 with a BOM; decoding them as UTF-8 and falling back to `""`
/// silently replaced the whole file with the schema patch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextEncoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
}

fn decode_hud_text(rel: &str, bytes: &[u8]) -> Result<(String, TextEncoding), ProfileError> {
    let decode_utf16 = |chunks: &mut dyn Iterator<Item = u16>| -> Option<String> {
        char::decode_utf16(chunks.collect::<Vec<_>>())
            .collect::<Result<String, _>>()
            .ok()
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let mut units = rest
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| u16::from_le_bytes([p[0], p[1]]));
        return decode_utf16(&mut units)
            .map(|text| (text, TextEncoding::Utf16Le))
            .ok_or_else(|| ProfileError::Io(format!("{rel} is not valid UTF-16LE")));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let mut units = rest
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| u16::from_be_bytes([p[0], p[1]]));
        return decode_utf16(&mut units)
            .map(|text| (text, TextEncoding::Utf16Be))
            .ok_or_else(|| ProfileError::Io(format!("{rel} is not valid UTF-16BE")));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return std::str::from_utf8(rest)
            .map(|text| (text.to_string(), TextEncoding::Utf8Bom))
            .map_err(|err| ProfileError::Io(format!("{rel} is not valid UTF-8: {err}")));
    }
    std::str::from_utf8(bytes)
        .map(|text| (text.to_string(), TextEncoding::Utf8))
        // Never patch over content we could not read.
        .map_err(|err| {
            ProfileError::Io(format!(
                "{rel} is not text we can edit ({err}). Its HUD options were left alone."
            ))
        })
}

fn encode_hud_text(text: &str, encoding: TextEncoding) -> Vec<u8> {
    match encoding {
        TextEncoding::Utf8 => text.as_bytes().to_vec(),
        TextEncoding::Utf8Bom => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        TextEncoding::Utf16Le => {
            let mut out = vec![0xFF, 0xFE];
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            out
        }
        TextEncoding::Utf16Be => {
            let mut out = vec![0xFE, 0xFF];
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
            out
        }
    }
}

/// Replace the `#base` line the schema owns, keeping the rest of the file.
/// Writing the bare line over the target replaced e.g. rayshud's whole
/// `mainmenuoverride.res` — hundreds of lines of main-menu layout — with one
/// `#base`, so picking a menu background emptied the main menu.
fn write_base_file(
    tree: &mut HudTree,
    path: &str,
    base: &serde_json::Value,
    value: &str,
) -> Result<(), ProfileError> {
    let template = match base {
        serde_json::Value::String(text) => text.clone(),
        other => json_to_string(other),
    };
    let line = format!("#base \"{}\"", substitute(&template, value));
    let Some(bytes) = tree.get(path) else {
        tree.insert(path, format!("{line}\n").into_bytes());
        return Ok(());
    };
    let (existing, encoding) = decode_hud_text(path, bytes)?;
    let (mut bases, rest) = split_base_lines(&existing);
    match bases
        .iter_mut()
        .find(|current| base_line_matches(current, &template))
    {
        Some(slot) => *slot = line,
        None => bases.push(line),
    }
    let mut out = String::new();
    for base_line in &bases {
        out.push_str(base_line);
        out.push('\n');
    }
    out.push_str(&rest);
    tree.insert(path, encode_hud_text(&out, encoding));
    Ok(())
}

/// Does this existing `#base` line point at something the schema's template
/// generates? `backgrounds/$value.res` owns `backgrounds/dark.res`.
fn base_line_matches(line: &str, template: &str) -> bool {
    let Some(target) = base_line_target(line) else {
        return false;
    };
    match template.split_once("$value") {
        None => target == template,
        Some((prefix, suffix)) => {
            target.len() >= prefix.len() + suffix.len()
                && target.starts_with(prefix)
                && target.ends_with(suffix)
        }
    }
}

fn base_line_target(line: &str) -> Option<&str> {
    let rest = line.trim_start();
    let rest = rest
        .strip_prefix("#base")
        .or_else(|| rest.strip_prefix("#Base"))?
        .trim();
    match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next(),
        None => Some(rest.trim()),
    }
}

fn split_base_lines(text: &str) -> (Vec<String>, String) {
    let mut bases = Vec::new();
    let mut rest = String::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("#base") || trimmed.starts_with("#Base") {
            bases.push(line.to_string());
        } else {
            rest.push_str(line);
            rest.push('\n');
        }
    }
    (bases, rest)
}

fn json_to_vdf(value: &serde_json::Value, substitute_with: &str) -> VdfMap {
    let mut map = VdfMap::default();
    let Some(object) = value.as_object() else {
        return map;
    };
    for (key, child) in object {
        if key == "#base" {
            continue;
        }
        match child {
            serde_json::Value::Object(_) => {
                map.entries.push((
                    key.clone(),
                    VdfValue::Obj(json_to_vdf(child, substitute_with)),
                ));
            }
            other => {
                map.entries.push((
                    key.clone(),
                    VdfValue::Str(substitute(&json_to_string(other), substitute_with)),
                ));
            }
        }
    }
    map
}

fn json_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Bool(flag) => {
            if *flag {
                "true".into()
            } else {
                "false".into()
            }
        }
        serde_json::Value::Number(number) => number.to_string(),
        other => other.to_string(),
    }
}

fn substitute(template: &str, value: &str) -> String {
    template.replace("$value", value)
}

fn normalize_type(raw: &str) -> &'static str {
    match raw.to_ascii_lowercase().as_str() {
        "checkbox" | "check" => "checkbox",
        "color" | "colorpicker" | "colour" | "colourpicker" => "color",
        "combobox" | "dropdown" | "dropdownmenu" | "select" => "combo",
        "number" | "integer" | "integerupdown" => "number",
        _ => "other",
    }
}

fn is_truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn normalize_folder(path: &str) -> String {
    normalize_hud_rel(&path.replace("//", "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema_fixture() -> HudSchema {
        parse_hud_schema(
            r##"{
  "Author": "Test",
  "CustomizationsFolder": "#customization",
  "EnabledFolder": "#customization//_enabled",
  "Controls": {
    "Colors": [
      {
        "Name": "bh_Health_Buff",
        "Label": "Buff",
        "Type": "ColorPicker",
        "Value": "0 153 255 255",
        "Files": {
          "resource/clientscheme_colors.res": {
            "Scheme": { "Colors": { "bh_Health_Buff": "$value" } }
          }
        }
      }
    ],
    "Extras": [
      {
        "Name": "minmode",
        "Label": "Minmode",
        "Type": "CheckBox",
        "Value": "false",
        "FileName": "minmode.res",
        "WriteCfg": {
          "FileName": "hud_minmode.cfg",
          "TrueText": "cl_hud_minmode 1\n",
          "FalseText": "cl_hud_minmode 0\n"
        }
      }
    ]
  }
}"##,
        )
        .unwrap()
    }

    #[test]
    fn color_merge_and_folder_swap_and_writecfg() {
        let schema = schema_fixture();
        let mut tree = HudTree::default();
        tree.insert(
            "resource/clientscheme_colors.res",
            b"\"Scheme\"\n{\n\t\"Colors\"\n\t{\n\t\t\"bh_Health_Buff\"\t\t\"255 0 0 255\"\n\t\t\"Keep\"\t\t\"1 1 1 1\"\n\t}\n}\n"
                .to_vec(),
        );
        tree.insert("#customization/minmode.res", b"off\n".to_vec());
        let mut options = BTreeMap::new();
        options.insert("bh_Health_Buff".into(), "0 153 255 255".into());
        options.insert("minmode".into(), "true".into());
        let result = apply_hud_options(&mut tree, &schema, "budhud", &options).unwrap();
        let colors =
            std::str::from_utf8(tree.get("resource/clientscheme_colors.res").unwrap()).unwrap();
        assert!(colors.contains("0 153 255 255"));
        assert!(colors.contains("Keep"));
        assert!(tree.get("#customization/_enabled/minmode.res").is_some());
        assert!(tree.get("#customization/minmode.res").is_none());
        assert_eq!(
            result.cfg_writes,
            vec![(
                "tf/cfg/budhud/hud_minmode.cfg".into(),
                b"cl_hud_minmode 1\n".to_vec()
            )]
        );
    }

    #[test]
    fn schema_view_keeps_supported_types() {
        let view = schema_view(&schema_fixture());
        assert_eq!(view.author, "Test");
        assert_eq!(view.sections.len(), 2);
        assert_eq!(view.sections[0].controls[0].control_type, "color");
        assert_eq!(view.sections[1].controls[0].control_type, "checkbox");
    }

    #[test]
    fn combo_writes_hash_base() {
        let schema = parse_hud_schema(
            r##"{
  "Controls": {
    "Menu": [
      {
        "Name": "Background",
        "Type": "ComboBox",
        "Value": "dark",
        "Options": [
          {
            "Name": "dark",
            "Value": "dark",
            "Files": {
              "resource/ui/mainmenuoverride.res": { "#base": "backgrounds/$value.res" }
            }
          }
        ]
      }
    ]
  }
}"##,
        )
        .unwrap();
        let mut tree = HudTree::default();
        let mut options = BTreeMap::new();
        options.insert("Background".into(), "dark".into());
        apply_hud_options(&mut tree, &schema, "rayshud", &options).unwrap();
        assert_eq!(
            std::str::from_utf8(tree.get("resource/ui/mainmenuoverride.res").unwrap()).unwrap(),
            "#base \"backgrounds/dark.res\"\n"
        );
    }

    fn background_schema() -> HudSchema {
        parse_hud_schema(
            r##"{
  "Controls": {
    "Menu": [
      {
        "Name": "Background",
        "Type": "ComboBox",
        "Value": "dark",
        "Options": [
          {
            "Name": "dark",
            "Value": "dark",
            "Files": {
              "resource/ui/mainmenuoverride.res": { "#base": "backgrounds/$value.res" }
            }
          },
          {
            "Name": "light",
            "Value": "light",
            "Files": {
              "resource/ui/mainmenuoverride.res": { "#base": "backgrounds/$value.res" }
            }
          }
        ]
      }
    ]
  }
}"##,
        )
        .unwrap()
    }

    #[test]
    fn hash_base_combo_keeps_the_body_of_an_existing_file() {
        // Writing the bare `#base` line over the target replaced rayshud's
        // whole main-menu layout with a single line: the main menu lost every
        // element the HUD defines.
        let schema = background_schema();
        let mut tree = HudTree::default();
        let body = "#base \"backgrounds/dark.res\"\n#base \"keepme.res\"\n\"Resource/UI/MainMenuOverride.res\"\n{\n\t\"Background\"\n\t{\n\t\t\"xpos\"\t\t\"0\"\n\t}\n}\n";
        tree.insert("resource/ui/mainmenuoverride.res", body.as_bytes().to_vec());
        let mut options = BTreeMap::new();
        options.insert("Background".into(), "light".into());

        apply_hud_options(&mut tree, &schema, "rayshud", &options).unwrap();

        let out =
            std::str::from_utf8(tree.get("resource/ui/mainmenuoverride.res").unwrap()).unwrap();
        assert!(out.contains("#base \"backgrounds/light.res\""));
        assert!(!out.contains("backgrounds/dark.res"), "{out}");
        // Unrelated bases and the whole body survive.
        assert!(out.contains("#base \"keepme.res\""));
        assert!(out.contains("\"Resource/UI/MainMenuOverride.res\""));
        assert!(out.contains("\"xpos\""));
    }

    #[test]
    fn hash_base_appends_when_the_file_has_no_matching_base() {
        let schema = background_schema();
        let mut tree = HudTree::default();
        tree.insert(
            "resource/ui/mainmenuoverride.res",
            b"\"MainMenu\"\n{\n\t\"a\"\t\t\"1\"\n}\n".to_vec(),
        );
        let mut options = BTreeMap::new();
        options.insert("Background".into(), "dark".into());

        apply_hud_options(&mut tree, &schema, "rayshud", &options).unwrap();

        let out =
            std::str::from_utf8(tree.get("resource/ui/mainmenuoverride.res").unwrap()).unwrap();
        assert!(out.starts_with("#base \"backgrounds/dark.res\"\n"));
        assert!(out.contains("\"MainMenu\""));
    }

    #[test]
    fn utf16le_res_files_round_trip_instead_of_being_wiped() {
        let schema = schema_fixture();
        let mut tree = HudTree::default();
        let text = "\"Scheme\"\n{\n\t\"Colors\"\n\t{\n\t\t\"bh_Health_Buff\"\t\t\"255 0 0 255\"\n\t\t\"Keep\"\t\t\"1 1 1 1\"\n\t}\n}\n";
        tree.insert(
            "resource/clientscheme_colors.res",
            encode_hud_text(text, TextEncoding::Utf16Le),
        );
        let mut options = BTreeMap::new();
        options.insert("bh_Health_Buff".into(), "0 153 255 255".into());

        apply_hud_options(&mut tree, &schema, "budhud", &options).unwrap();

        let bytes = tree.get("resource/clientscheme_colors.res").unwrap();
        assert_eq!(&bytes[..2], &[0xFF, 0xFE], "the BOM must be preserved");
        let (decoded, encoding) = decode_hud_text("x.res", bytes).unwrap();
        assert_eq!(encoding, TextEncoding::Utf16Le);
        assert!(decoded.contains("0 153 255 255"));
        // The rest of the scheme is what used to be lost.
        assert!(decoded.contains("Keep"));
    }

    #[test]
    fn a_file_we_cannot_decode_is_an_error_not_an_empty_string() {
        let schema = schema_fixture();
        let mut tree = HudTree::default();
        tree.insert(
            "resource/clientscheme_colors.res",
            vec![0x00, 0xFF, 0xFE, 0x80, 0x81],
        );
        let mut options = BTreeMap::new();
        options.insert("bh_Health_Buff".into(), "0 153 255 255".into());

        let err = apply_hud_options(&mut tree, &schema, "budhud", &options).unwrap_err();
        assert_eq!(err.code(), "Io");
        // Never patch over content we could not read.
        assert_eq!(
            tree.get("resource/clientscheme_colors.res").unwrap(),
            &[0x00, 0xFF, 0xFE, 0x80, 0x81]
        );
    }

    #[test]
    fn conditionals_survive_a_res_merge() {
        let schema = parse_hud_schema(
            r##"{
  "Controls": {
    "Menu": [
      {
        "Name": "xpos",
        "Type": "Number",
        "Value": "9",
        "Files": { "resource/ui/hudlayout.res": { "Block": { "xpos": "$value" } } }
      }
    ]
  }
}"##,
        )
        .unwrap();
        let mut tree = HudTree::default();
        tree.insert(
            "resource/ui/hudlayout.res",
            b"\"Block\"\n{\n\t\"xpos\"\t\t\"0\"\n\t\"visible\"\t\t\"1\" [$WIN32]\n\t\"ItemName\"\t\t\"health\"\n}\n".to_vec(),
        );
        let mut options = BTreeMap::new();
        options.insert("xpos".into(), "42".into());

        apply_hud_options(&mut tree, &schema, "rayshud", &options).unwrap();

        let out = std::str::from_utf8(tree.get("resource/ui/hudlayout.res").unwrap()).unwrap();
        assert!(out.contains("\"1\" [$WIN32]"), "{out}");
        assert!(out.contains("\"xpos\"\t\t\"42\""), "{out}");
        // The key after the conditional must not have been consumed as a value.
        assert!(out.contains("\"ItemName\"\t\t\"health\""), "{out}");
    }
}
