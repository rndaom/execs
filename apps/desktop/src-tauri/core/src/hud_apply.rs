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
            controls: controls
                .iter()
                .filter_map(view_control)
                .collect(),
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
                    tree.rename(&normalize_folder(&rename.old_name), &normalize_folder(&rename.new_name));
                } else {
                    tree.rename(&normalize_folder(&rename.new_name), &normalize_folder(&rename.old_name));
                }
            }
            if let Some(files) = &control.files {
                merge_files(tree, files, if on { "1" } else { "0" })?;
            }
            if let Some(write) = &control.write_file {
                let text = if on { &write.true_text } else { &write.false_text };
                tree.insert(&normalize_folder(&write.file_name), text.as_bytes().to_vec());
            }
            if let Some(write) = &control.write_cfg {
                let text = if on { &write.true_text } else { &write.false_text };
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
            &normalize_folder(&write.file_name),
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

fn merge_files(tree: &mut HudTree, files: &serde_json::Value, value: &str) -> Result<(), ProfileError> {
    let Some(map) = files.as_object() else {
        return Ok(());
    };
    for (path, patch) in map {
        let rel = normalize_hud_rel(path);
        if let Some(base) = patch.get("#base") {
            write_base_file(tree, &rel, base, value);
            continue;
        }
        let existing = tree
            .get(&rel)
            .and_then(|bytes| std::str::from_utf8(bytes).ok())
            .unwrap_or("");
        let (bases, rest) = split_base_lines(existing);
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
        tree.insert(rel, out.into_bytes());
    }
    Ok(())
}

fn write_base_file(tree: &mut HudTree, path: &str, base: &serde_json::Value, value: &str) {
    let line = match base {
        serde_json::Value::String(text) => format!("#base \"{}\"\n", substitute(text, value)),
        _ => format!("#base \"{}\"\n", substitute(&json_to_string(base), value)),
    };
    tree.insert(path, line.into_bytes());
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
        let colors = std::str::from_utf8(tree.get("resource/clientscheme_colors.res").unwrap()).unwrap();
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
}
