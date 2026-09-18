//! First-party HUD option apply. MIT schemas are data; this is our engine.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::hud::{normalize_hud_rel, validate_hud_move_path, HudTree};
use crate::profile::ProfileError;
use crate::surface::CfgLayer;
use crate::vdf::{parse_hud_vdf, VdfMap, VdfValue};

#[path = "hud_expression.rs"]
mod expressions;

#[cfg(test)]
#[path = "hud_moves_tests.rs"]
mod move_tests;

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
    /// Empty on the entries of a combo box, which carry only a label and value.
    #[serde(rename = "Name", default)]
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
    #[serde(rename = "ComboFiles")]
    pub combo_files: Option<Vec<String>>,
    #[serde(rename = "ComboDirectories")]
    pub combo_directories: Option<Vec<String>>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
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

/// Prefix for the cfg files a HUD schema's `WriteCfg` controls produce. They
/// are execed by bare stem from the managed autoexec line, exactly like
/// `execs_binds` and `execs_gameplay`, so they must sit directly in the layer's
/// cfg folder — nested under `tf/cfg/<hudid>/` the engine never found them and
/// every WriteCfg checkbox was a silent no-op in game.
pub const HUD_CFG_PREFIX: &str = "execs_hud_";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HudApplyResult {
    /// Layer-addressed rel paths, ready for `write_owned_file`.
    pub cfg_writes: Vec<(String, Vec<u8>)>,
    /// Bare stems (`execs_hud_minmode`) for the managed autoexec exec lines.
    pub exec_stems: Vec<String>,
}

/// The comment the managed autoexec lines carry (shared with the frontend's
/// `ensureAutoexecExecLine`, which owns the binds/gameplay lines).
pub const MANAGED_EXEC_COMMENT: &str = "// execs:managed";

/// `exec` target for a managed stem, addressed from tf/cfg the way the engine
/// resolves it: `overrides/<stem>` on a comfig layer, the bare stem on vanilla.
pub fn managed_exec_target(layer: CfgLayer, stem: &str) -> String {
    match layer {
        CfgLayer::Comfig => format!("overrides/{stem}"),
        CfgLayer::Vanilla => stem.to_string(),
    }
}

fn exec_target_of_line(line: &str) -> Option<&str> {
    let body = line.split("//").next().unwrap_or("").trim();
    let mut parts = body.split_whitespace();
    if parts.next()? != "exec" {
        return None;
    }
    let target = parts.next()?;
    Some(target.trim_matches('"'))
}

fn exec_stem_of_target(target: &str) -> &str {
    let stem = target.rsplit('/').next().unwrap_or(target);
    stem.strip_suffix(".cfg").unwrap_or(stem)
}

/// Make the autoexec exec exactly the HUD option cfgs in `stems`: managed
/// `execs_hud_*` lines for stems that are gone are dropped, mis-addressed ones
/// are rewritten in place, missing ones are appended. Everything else in the
/// file is preserved byte for byte.
pub fn ensure_hud_exec_lines(existing: &str, layer: CfgLayer, stems: &[String]) -> String {
    let wanted: Vec<&str> = stems.iter().map(String::as_str).collect();
    let canonical = |stem: &str| {
        format!(
            "exec {} {MANAGED_EXEC_COMMENT}",
            managed_exec_target(layer, stem)
        )
    };
    let mut seen: Vec<&str> = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    for raw in existing.split('\n') {
        let managed = raw.trim().ends_with(MANAGED_EXEC_COMMENT);
        if let Some(target) = exec_target_of_line(raw) {
            let stem = exec_stem_of_target(target);
            if stem.starts_with(HUD_CFG_PREFIX) {
                match wanted.iter().find(|w| **w == stem) {
                    Some(w) if managed => {
                        if !seen.contains(w) {
                            seen.push(w);
                            lines.push(canonical(w));
                        }
                        continue;
                    }
                    Some(w) => {
                        if !seen.contains(w) {
                            seen.push(w);
                        }
                    }
                    None if managed => continue,
                    None => {}
                }
            }
        }
        lines.push(raw.to_string());
    }
    let mut text = lines.join("\n");
    let missing: Vec<&str> = wanted
        .iter()
        .copied()
        .filter(|w| !seen.contains(w))
        .collect();
    if !missing.is_empty() {
        let trimmed = text.trim_end().to_string();
        text = if trimmed.is_empty() {
            String::new()
        } else {
            format!("{trimmed}\n")
        };
        for stem in missing {
            text.push_str(&canonical(stem));
            text.push('\n');
        }
    }
    text
}

/// `tf/cfg/execs_hud_<stem>.cfg`, or `tf/cfg/overrides/...` on a comfig layer.
/// The engine resolves `exec` relative to each search path's cfg folder, so the
/// address has to match the layer the autoexec line lives in.
pub fn hud_cfg_path(layer: CfgLayer, stem: &str) -> String {
    match layer {
        CfgLayer::Comfig => format!("tf/cfg/overrides/{stem}.cfg"),
        CfgLayer::Vanilla => format!("tf/cfg/{stem}.cfg"),
    }
}

/// `minmode.cfg` / `Minmode` -> `execs_hud_minmode`. Namespaced so a HUD's
/// choice of file name can never collide with a user's own cfg.
pub fn hud_cfg_stem(file_name: &str) -> String {
    let base = file_name.replace('\\', "/");
    let base = base.rsplit('/').next().unwrap_or(&base);
    let base = base.strip_suffix(".cfg").unwrap_or(base);
    let cleaned: String = base
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches('_');
    if cleaned.is_empty() {
        format!("{HUD_CFG_PREFIX}option")
    } else {
        format!("{HUD_CFG_PREFIX}{cleaned}")
    }
}

pub fn parse_hud_schema(raw: &str) -> Result<HudSchema, ProfileError> {
    let schema: HudSchema = serde_json::from_str(&strip_json_comments(raw))
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    crate::hud_schema_compat::validate_identities(&schema)?;
    Ok(schema)
}

/// Some TF2HUD.Editor schemas carry `//` and `/* */` comments, which strict
/// JSON rejects. Comments outside string literals are blanked; strings are
/// left alone so a URL with `//` in it survives.
fn strip_json_comments(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(c) = chars.next() {
        if in_string {
            // Whole chars, never bytes: pushing a byte `as char` turned an
            // `é` inside a label into two Latin-1 characters.
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push('"');
            }
            '/' if chars.peek() == Some(&'/') => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut last = '\0';
                for next in chars.by_ref() {
                    if last == '*' && next == '/' {
                        break;
                    }
                    last = next;
                }
            }
            _ => out.push(c),
        }
    }
    out
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
        sections,
    }
}

/// `apply_hud_options_for_layer` for a **vanilla** cfg layer; a comfig-layer
/// profile needs `apply_hud_options_for_layer(.., CfgLayer::Comfig)`.
pub fn apply_hud_options(
    tree: &mut HudTree,
    schema: &HudSchema,
    hud_id: &str,
    options: &BTreeMap<String, String>,
) -> Result<HudApplyResult, ProfileError> {
    apply_hud_options_for_layer(tree, schema, hud_id, options, CfgLayer::Vanilla)
}

pub fn apply_hud_options_for_layer(
    tree: &mut HudTree,
    schema: &HudSchema,
    hud_id: &str,
    options: &BTreeMap<String, String>,
    layer: CfgLayer,
) -> Result<HudApplyResult, ProfileError> {
    // Validate and resolve the complete schema before changing even the staged
    // tree. A later control failure must not leave earlier edits in the caller.
    let schema = expressions::resolve_schema(schema, options)?;
    let mut staged = tree.clone();
    let result = apply_resolved_hud_options(&mut staged, &schema, hud_id, options, layer)?;
    *tree = staged;
    Ok(result)
}

fn apply_resolved_hud_options(
    tree: &mut HudTree,
    schema: &HudSchema,
    hud_id: &str,
    options: &BTreeMap<String, String>,
    layer: CfgLayer,
) -> Result<HudApplyResult, ProfileError> {
    crate::hud_schema_compat::validate_identities(schema)?;
    let custom = schema
        .customizations_folder
        .as_deref()
        .map(validate_hud_move_path)
        .transpose()?;
    let enabled = schema
        .enabled_folder
        .as_deref()
        .map(validate_hud_move_path)
        .transpose()?;
    let mut cfg_writes = Vec::new();
    for controls in schema.controls.values() {
        for control in controls {
            // Keep legacy saved values, but never write unconsumed log snippets.
            if crate::hud_schema_compat::unavailable_reason(control).is_some() {
                continue;
            }
            apply_control(
                tree,
                control,
                options,
                custom.as_deref(),
                enabled.as_deref(),
                hud_id,
                layer,
                &mut cfg_writes,
            )
            .map_err(|error| match error {
                ProfileError::Io(reason) => ProfileError::Io(format!(
                    "HUD option \"{}\" ({}): {reason}",
                    if control.label.is_empty() {
                        &control.name
                    } else {
                        &control.label
                    },
                    control.name
                )),
                other => other,
            })?;
        }
    }
    let exec_stems = cfg_writes
        .iter()
        .filter_map(|(path, _)| {
            Path::new(path)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_string)
        })
        .collect();
    Ok(HudApplyResult {
        cfg_writes,
        exec_stems,
    })
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
        unavailable_reason: crate::hud_schema_compat::unavailable_reason(control)
            .map(str::to_owned),
        minimum: control.minimum.as_ref().map(json_to_string),
        maximum: control.maximum.as_ref().map(json_to_string),
    })
}

#[allow(clippy::too_many_arguments)]
fn apply_control(
    tree: &mut HudTree,
    control: &HudControl,
    options: &BTreeMap<String, String>,
    custom: Option<&str>,
    enabled: Option<&str>,
    hud_id: &str,
    layer: CfgLayer,
    cfg_writes: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), ProfileError> {
    let kind = normalize_type(&control.control_type);
    let current = options
        .get(&control.name)
        .cloned()
        .unwrap_or_else(|| control.value.clone());
    // `minimum`/`maximum` were surfaced to the UI but never enforced here, so
    // an out-of-range number went into the HUD file verbatim.
    let current = clamp_to_bounds(control, current);
    if control.file_name.is_some() && (custom.is_none() || enabled.is_none()) {
        return Err(ProfileError::Io(
            "HUD file choices require CustomizationsFolder and EnabledFolder".into(),
        ));
    }
    match kind {
        "checkbox" => {
            let on = is_truthy(&current);
            if let (Some(file_name), Some(custom), Some(enabled)) =
                (control.file_name.as_deref(), custom, enabled)
            {
                swap_custom_file(tree, custom, enabled, file_name, on)?;
            }
            if let Some(rename) = &control.rename_file {
                if on {
                    tree.rename(&rename.old_name, &rename.new_name)?;
                } else {
                    tree.rename(&rename.new_name, &rename.old_name)?;
                }
            }
            if let Some(files) = &control.files {
                merge_files(tree, files, if on { "1" } else { "0" }, Some(on))?;
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
                    hud_cfg_path(layer, &hud_cfg_stem(&write.file_name)),
                    text.as_bytes().to_vec(),
                ));
            }
        }
        "color" | "number" => {
            apply_value_files(
                tree, control, &current, custom, enabled, hud_id, layer, cfg_writes,
            )?;
        }
        "combo" => {
            let choice = control
                .options
                .as_ref()
                .and_then(|choices| choices.iter().find(|choice| choice.value == current))
                .ok_or_else(|| {
                    ProfileError::Io(format!(
                        "Unknown HUD selection {current:?}; select one of the available options"
                    ))
                })?;
            // Reset deselected variants before enabling the requested choice.
            // Nameless options carry operations, not separate saved controls.
            if let Some(choices) = &control.options {
                for choice in choices.iter().filter(|choice| choice.value != current) {
                    if let Some(rename) = &choice.rename_file {
                        tree.rename(&rename.new_name, &rename.old_name)?;
                    }
                }
            }
            let selected_file = control
                .options
                .as_ref()
                .and_then(|choices| choices.iter().find(|choice| choice.value == current))
                .and_then(|choice| choice.file_name.as_deref())
                .map(validate_hud_move_path)
                .transpose()?;
            let mut reset_files = std::collections::BTreeSet::new();
            reset_files.extend(control.combo_files.iter().flatten().map(String::as_str));
            reset_files.extend(
                control
                    .combo_directories
                    .iter()
                    .flatten()
                    .map(String::as_str),
            );
            reset_files.extend(
                control
                    .options
                    .iter()
                    .flatten()
                    .filter_map(|choice| choice.file_name.as_deref()),
            );
            for file in reset_files {
                let file = validate_hud_move_path(file)?;
                if !selected_file
                    .as_ref()
                    .is_some_and(|selected| selected.eq_ignore_ascii_case(&file))
                {
                    let (Some(custom), Some(enabled)) = (custom, enabled) else {
                        return Err(ProfileError::Io(format!("HUD file choice {file} requires CustomizationsFolder and EnabledFolder")));
                    };
                    swap_custom_file(tree, custom, enabled, &file, false)?;
                }
            }
            apply_control(
                tree, choice, options, custom, enabled, hud_id, layer, cfg_writes,
            )?;
        }
        _ => {
            apply_value_files(
                tree, control, &current, custom, enabled, hud_id, layer, cfg_writes,
            )?;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn apply_value_files(
    tree: &mut HudTree,
    control: &HudControl,
    current: &str,
    custom: Option<&str>,
    enabled: Option<&str>,
    hud_id: &str,
    layer: CfgLayer,
    cfg_writes: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), ProfileError> {
    let _ = hud_id;
    if let Some(file_name) = control.file_name.as_deref() {
        let (Some(custom), Some(enabled)) = (custom, enabled) else {
            return Err(ProfileError::Io(
                "HUD file choices require CustomizationsFolder and EnabledFolder".into(),
            ));
        };
        swap_custom_file(tree, custom, enabled, file_name, true)?;
    }
    if let Some(rename) = &control.rename_file {
        tree.rename(&rename.old_name, &rename.new_name)?;
    }
    if let Some(files) = &control.files {
        merge_files(tree, files, current, None)?;
    }
    if let Some(write) = &control.write_file {
        tree.insert(
            normalize_folder(&write.file_name),
            write.true_text.as_bytes().to_vec(),
        );
    }
    if let Some(write) = &control.write_cfg {
        cfg_writes.push((
            hud_cfg_path(layer, &hud_cfg_stem(&write.file_name)),
            write.true_text.as_bytes().to_vec(),
        ));
    }
    Ok(())
}

/// Hold a numeric control inside the `minimum`/`maximum` the schema declares.
/// Non-numeric controls and unparseable values are passed through untouched.
fn clamp_to_bounds(control: &HudControl, value: String) -> String {
    if control.minimum.is_none() && control.maximum.is_none() {
        return value;
    }
    let Ok(parsed) = value.trim().parse::<f64>() else {
        return value;
    };
    let min = control.minimum.as_ref().and_then(json_to_f64);
    let max = control.maximum.as_ref().and_then(json_to_f64);
    let mut clamped = parsed;
    if let Some(min) = min {
        clamped = clamped.max(min);
    }
    if let Some(max) = max {
        clamped = clamped.min(max);
    }
    if clamped == parsed {
        return value;
    }
    format_number(clamped)
}

fn json_to_f64(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

fn swap_custom_file(
    tree: &mut HudTree,
    custom: &str,
    enabled: &str,
    file_name: &str,
    on: bool,
) -> Result<(), ProfileError> {
    let custom = validate_hud_move_path(custom)?;
    let enabled = validate_hud_move_path(enabled)?;
    let file_name = validate_hud_move_path(file_name)?;
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
    tree.rename(&from, &to)
}

fn merge_files(
    tree: &mut HudTree,
    files: &serde_json::Value,
    value: &str,
    toggle: Option<bool>,
) -> Result<(), ProfileError> {
    let Some(map) = files.as_object() else {
        return Err(ProfileError::Io(
            "Files must be an object of relative HUD paths".into(),
        ));
    };
    for (path, patch) in map {
        // Schema paths allow either slash spelling, including doubled
        // backslashes. Resolve to the existing spelling on every OS.
        let normalized = path.replace('\\', "/");
        let rel = normalized
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("/");
        let result = (|| {
            if normalized.starts_with('/') || normalized.ends_with('/') {
                return Err(ProfileError::Io("Expected a relative HUD file path".into()));
            }
            crate::profile::normalize_rel_path(&rel)
                .map_err(|_| ProfileError::Io("Invalid relative HUD file path".into()))?;
            let matches = tree
                .files
                .keys()
                .filter(|key| key.eq_ignore_ascii_case(&rel))
                .collect::<Vec<_>>();
            if matches.len() > 1 {
                return Err(ProfileError::Io(
                    "HUD file path has conflicting case spellings".into(),
                ));
            }
            let target = matches
                .first()
                .map_or(rel.as_str(), |path| path.as_str())
                .to_string();
            merge_file(tree, &target, patch, value, toggle)
        })();
        result.map_err(|error| match error {
            ProfileError::Io(reason) => ProfileError::Io(format!("{rel}: {reason}")),
            other => other,
        })?;
    }
    Ok(())
}

fn merge_file(
    tree: &mut HudTree,
    rel: &str,
    patch: &serde_json::Value,
    value: &str,
    toggle: Option<bool>,
) -> Result<(), ProfileError> {
    let patch = patch
        .as_object()
        .ok_or_else(|| ProfileError::Io("HUD file edits must be an object".into()))?;
    let animation = Path::new(rel)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("txt"));
    if animation {
        let bytes = tree
            .get(rel)
            .ok_or_else(|| ProfileError::Io("Animation file is missing".into()))?;
        let (text, encoding) = decode_hud_text(rel, bytes)?;
        let out = edit_animation_lines(&text, patch, toggle)?;
        tree.insert(rel, encode_hud_text_checked(&out, encoding)?);
        return Ok(());
    }
    if let Some(base) = patch.get("#base") {
        if patch.len() != 1 {
            return Err(ProfileError::Io(
                "Combining #base and resource edits is not supported".into(),
            ));
        }
        return write_base_file(tree, rel, base, value, toggle);
    }
    let (existing, encoding) = match tree.get(rel) {
        Some(bytes) => decode_hud_text(rel, bytes)?,
        None => (String::new(), TextEncoding::Utf8),
    };
    let mut vdf = parse_hud_vdf(&existing).map_err(ProfileError::Io)?;
    let before = vdf.clone();
    let patch_map = json_to_vdf(patch, value, toggle)?;
    // TF2HUD.Editor resource patches omit a file-named root header; the
    // existing header owns the edited panels, including its conditionals.
    let headers = vdf
        .entries
        .iter()
        .enumerate()
        .filter(|(_, (key, _))| {
            let normalized = normalize_hud_rel(key).to_ascii_lowercase();
            normalized.eq_ignore_ascii_case(rel)
                || ((normalized.starts_with("resource/") || normalized.starts_with("scripts/"))
                    && normalized.ends_with(".res"))
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    match headers.as_slice() {
        [] => merge_hud_map(&mut vdf, &patch_map),
        [index] => {
            let VdfValue::Obj(root) = &mut vdf.entries[*index].1 else {
                return Err(ProfileError::Io(
                    "HUD resource header must contain an object".into(),
                ));
            };
            merge_hud_map(root, &patch_map);
        }
        _ => {
            return Err(ProfileError::Io(
                "HUD resource has ambiguous file headers".into(),
            ))
        }
    }
    let out = crate::hud_text_edit::edit(&existing, &before, &vdf).map_err(ProfileError::Io)?;
    tree.insert(rel, encode_hud_text_checked(&out, encoding)?);
    Ok(())
}

/// Comment only lines with the requested command-token prefix. Whitespace,
/// inline comments, line endings and unrelated comment state survive. A
/// checkbox reverses its directives when off; a selected combo choice applies
/// them directly even when the choice's value is "0".
fn edit_animation_lines(
    text: &str,
    patch: &serde_json::Map<String, serde_json::Value>,
    toggle: Option<bool>,
) -> Result<String, ProfileError> {
    let mut directives = Vec::new();
    for (kind, targets) in patch {
        if !matches!(kind.as_str(), "comment" | "uncomment") {
            return Err(ProfileError::Io("Unsupported animation directive; only comment and uncomment line edits are supported".into()));
        }
        let targets = targets.as_array().ok_or_else(|| {
            ProfileError::Io(
                "Animation comment directives must be lists of command prefixes".into(),
            )
        })?;
        for target in targets {
            let target = target.as_str().ok_or_else(|| {
                ProfileError::Io("Animation command prefixes must be strings".into())
            })?;
            if target.trim().is_empty()
                || target.contains(['\r', '\n', '\0'])
                || target.trim_start().starts_with("//")
            {
                return Err(ProfileError::Io(
                    "Animation command prefixes must contain one uncommented line".into(),
                ));
            }
            directives.push((
                target.split_whitespace().collect::<Vec<_>>(),
                (kind == "comment") == toggle.unwrap_or(true),
            ));
        }
    }
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let body = line.trim_start_matches([' ', '\t']);
        let indent = &line[..line.len() - body.len()];
        let uncommented = body.strip_prefix("//");
        let command = uncommented.unwrap_or(body);
        let mut desired = None;
        for (prefix, comment) in &directives {
            if command
                .split_whitespace()
                .take(prefix.len())
                .eq(prefix.iter().copied())
            {
                if desired.is_some_and(|other| other != *comment) {
                    return Err(ProfileError::Io(
                        "Conflicting animation comment directives".into(),
                    ));
                }
                desired = Some(*comment);
            }
        }
        out.push_str(indent);
        match (desired, uncommented) {
            (Some(true), None) => {
                out.push_str("//");
                out.push_str(body);
            }
            (Some(false), Some(command)) => out.push_str(command),
            _ => out.push_str(body),
        }
    }
    Ok(out)
}

/// A HUD patch owns one conditional variant, never an unrelated platform's
/// value with the same key. Steam's last-key merge behavior stays unchanged.
fn merge_hud_map(target: &mut VdfMap, patch: &VdfMap) {
    for (patch_index, (key, value)) in patch.entries.iter().enumerate() {
        let condition = patch.condition_at(patch_index);
        let index = target
            .entries
            .iter()
            .enumerate()
            .rfind(|(index, (existing, _))| {
                existing.eq_ignore_ascii_case(key) && target.condition_at(*index) == condition
            })
            .map(|(index, _)| index);
        if let Some(index) = index {
            match (&mut target.entries[index].1, value) {
                (VdfValue::Obj(target), VdfValue::Obj(patch)) => merge_hud_map(target, patch),
                (target, value) => *target = value.clone(),
            }
        } else {
            target.entries.push((key.clone(), value.clone()));
            target.set_condition(target.entries.len() - 1, condition.map(str::to_string));
        }
    }
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
    /// Reversible byte mapping for legacy, BOM-less resources. This deliberately
    /// does not guess a code page or replace undecodable bytes.
    LegacyBytes,
}

fn decode_hud_text(rel: &str, bytes: &[u8]) -> Result<(String, TextEncoding), ProfileError> {
    let decode_utf16 = |chunks: &mut dyn Iterator<Item = u16>| -> Option<String> {
        char::decode_utf16(chunks.collect::<Vec<_>>())
            .collect::<Result<String, _>>()
            .ok()
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        if rest.len() % 2 != 0 {
            return Err(ProfileError::Io(format!(
                "{rel} has an incomplete UTF-16LE code unit"
            )));
        }
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
        if rest.len() % 2 != 0 {
            return Err(ProfileError::Io(format!(
                "{rel} has an incomplete UTF-16BE code unit"
            )));
        }
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
    match std::str::from_utf8(bytes) {
        Ok(text) => Ok((text.to_string(), TextEncoding::Utf8)),
        Err(_)
            if !bytes
                .iter()
                .any(|byte| *byte < 32 && !matches!(byte, 9 | 10 | 13)) =>
        {
            Ok((
                bytes.iter().map(|byte| char::from(*byte)).collect(),
                TextEncoding::LegacyBytes,
            ))
        }
        Err(_) => Err(ProfileError::Io(format!(
            "{rel} contains non-text bytes; its HUD options were left alone"
        ))),
    }
}

fn encode_hud_text_checked(text: &str, encoding: TextEncoding) -> Result<Vec<u8>, ProfileError> {
    if encoding == TextEncoding::LegacyBytes && text.chars().any(|ch| u32::from(ch) > 255) {
        return Err(ProfileError::Io(
            "An edited value cannot be represented in this legacy HUD resource".into(),
        ));
    }
    Ok(encode_hud_text(text, encoding))
}

fn encode_hud_text(text: &str, encoding: TextEncoding) -> Vec<u8> {
    match encoding {
        TextEncoding::LegacyBytes => text.chars().map(|ch| ch as u8).collect(),
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
    toggle: Option<bool>,
) -> Result<(), ProfileError> {
    let items = base
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(std::slice::from_ref(base));
    if items.len() > 128 {
        return Err(ProfileError::Io("Too many HUD base includes".into()));
    }
    let (existing, encoding) = match tree.get(path) {
        Some(bytes) => decode_hud_text(path, bytes)?,
        None => (String::new(), TextEncoding::Utf8),
    };
    parse_hud_vdf(&existing).map_err(ProfileError::Io)?;
    let mut lines: Vec<String> = existing.split_inclusive('\n').map(str::to_string).collect();
    let mut claimed = std::collections::BTreeSet::new();
    let mut previous = None;
    for item in items {
        let (template, alternatives) = if let Some(template) = item.as_str() {
            (template, vec![template])
        } else if let Some(branches) = item.as_object() {
            if branches.len() != 2
                || !branches.contains_key("true")
                || !branches.contains_key("false")
            {
                return Err(ProfileError::Io(
                    "#base checkbox requires true and false path branches".into(),
                ));
            }
            let selected = toggle
                .ok_or_else(|| ProfileError::Io("Conditional #base requires a checkbox".into()))?;
            let yes = branches["true"]
                .as_str()
                .ok_or_else(|| ProfileError::Io("#base paths must be strings".into()))?;
            let no = branches["false"]
                .as_str()
                .ok_or_else(|| ProfileError::Io("#base paths must be strings".into()))?;
            (if selected { yes } else { no }, vec![yes, no])
        } else {
            return Err(ProfileError::Io(
                "#base must be a path or ordered list of paths/checkbox branches".into(),
            ));
        };
        let target = substitute(template, value);
        validate_base_path(path, &target)?;
        let include_lines = top_level_base_lines(&lines);
        let matches: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(index, line)| {
                include_lines[*index]
                    && alternatives
                        .iter()
                        .any(|candidate| base_line_matches(line, candidate))
            })
            .map(|(index, _)| index)
            .collect();
        match matches.as_slice() {
            [] => {
                let index = previous.map_or(0, |index| index + 1);
                let prefix = if index > 0 && !lines[index - 1].ends_with('\n') {
                    "\n"
                } else {
                    ""
                };
                lines.insert(index, format!("{prefix}#base \"{target}\"\n"));
                claimed = claimed
                    .into_iter()
                    .map(|old| if old >= index { old + 1 } else { old })
                    .collect();
                claimed.insert(index);
                previous = Some(index);
            }
            [index] if claimed.insert(*index) => {
                if previous.is_some_and(|previous| previous >= *index) {
                    return Err(ProfileError::Io(
                        "HUD base include order conflicts with the schema".into(),
                    ));
                }
                let slot = &mut lines[*index];
                let range = base_target_range(slot).expect("matched include target");
                let quoted = range.start > 0 && slot.as_bytes()[range.start - 1] == b'"';
                slot.replace_range(
                    range,
                    &if quoted {
                        target
                    } else {
                        format!("\"{target}\"")
                    },
                );
                previous = Some(*index);
            }
            _ => {
                return Err(ProfileError::Io(
                    "HUD base includes are ambiguous; no files were changed".into(),
                ))
            }
        }
    }
    let out = lines.concat();
    tree.insert(path, encode_hud_text_checked(&out, encoding)?);
    Ok(())
}

/// A commented or nested #base spelling is not an include owned by a control.
/// Track lexical state across lines, including multiline strings/comments.
fn top_level_base_lines(lines: &[String]) -> Vec<bool> {
    let mut comment = false;
    let mut quoted = false;
    let mut depth = 0usize;
    lines
        .iter()
        .map(|line| {
            let eligible = !comment && !quoted && depth == 0 && base_target_range(line).is_some();
            let mut chars = line.chars().peekable();
            while let Some(ch) = chars.next() {
                if comment {
                    if ch == '*' && chars.peek() == Some(&'/') {
                        chars.next();
                        comment = false;
                    }
                } else if quoted {
                    if ch == '"' {
                        quoted = false;
                    }
                } else {
                    match ch {
                        '/' if chars.peek() == Some(&'/') => break,
                        '/' if chars.peek() == Some(&'*') => {
                            chars.next();
                            comment = true;
                        }
                        '"' => quoted = true,
                        '{' => depth += 1,
                        '}' => depth = depth.saturating_sub(1),
                        _ => {}
                    }
                }
            }
            eligible
        })
        .collect()
}

fn validate_base_path(file: &str, target: &str) -> Result<(), ProfileError> {
    let normalized = target.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.contains(['"', ':', '\0', '\r', '\n'])
    {
        return Err(ProfileError::Io("Invalid #base path".into()));
    }
    let mut depth = file.split('/').count().saturating_sub(1);
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." if depth > 0 => depth -= 1,
            ".." => return Err(ProfileError::Io("#base path escapes the HUD".into())),
            _ => depth += 1,
        }
    }
    Ok(())
}

#[cfg(test)]
mod maintenance_regressions {
    use super::*;

    #[test]
    fn legacy_resource_preserves_every_byte_outside_the_edited_value() {
        let mut tree = HudTree::default();
        let original = b"// \xdcBERCHARGE \x81 unknown byte\r\n\"Scheme\" { \"Colors\" { \"Uber\" \"old\" // keep\r\n } }\r\n";
        tree.insert("resource/colors.res", original.to_vec());
        let patch = serde_json::json!({"resource/colors.res":{"Scheme":{"Colors":{"Uber":"new"}}}});
        merge_files(&mut tree, &patch, "", None).unwrap();
        let expected = original.windows(3).position(|part| part == b"old").unwrap();
        let mut bytes = original.to_vec();
        bytes[expected..expected + 3].copy_from_slice(b"new");
        assert_eq!(tree.get("resource/colors.res").unwrap(), bytes);
        let once = tree.clone();
        merge_files(&mut tree, &patch, "", None).unwrap();
        assert_eq!(tree, once);
        let invalid =
            serde_json::json!({"resource/colors.res":{"Scheme":{"Colors":{"Uber":"\u{1f680}"}}}});
        assert!(merge_files(&mut tree, &invalid, "", None).is_err());
        assert_eq!(tree, once);
    }

    #[test]
    fn included_logical_header_is_edited_and_ambiguous_headers_refuse() {
        let path = "^customizations/#crosshairs/crosshairs_hudlayout.res";
        let original = "#base \"keep.res\"\n\"Resource/HudLayout.res\" { \"CustomCrosshair1\" { \"visible\" \"0\" } \"Keep\" {} }\n";
        let mut tree = HudTree::default();
        tree.insert(path, original.as_bytes().to_vec());
        let patch = serde_json::json!({path: {"CustomCrosshair1":{"visible":"1"}}});
        merge_files(&mut tree, &patch, "", None).unwrap();
        assert_eq!(
            std::str::from_utf8(tree.get(path).unwrap()).unwrap(),
            original.replace("\"0\"", "\"1\"")
        );
        let once = tree.clone();
        merge_files(&mut tree, &patch, "", None).unwrap();
        assert_eq!(tree, once);
        tree.insert(
            path,
            b"\"Resource/A.res\" {} \"Resource/B.res\" {}".to_vec(),
        );
        let before = tree.clone();
        assert!(merge_files(&mut tree, &patch, "", None).is_err());
        assert_eq!(tree, before);
    }

    #[test]
    fn ordered_base_branches_reverse_without_touching_other_lines() {
        let path = "customizations/scoreboards.res";
        let original = "// keep\r\n  #BASE \"../resource/ui/full.res\" [$WIN32] // choice\r\n#base \"keep.res\"\r\n\"Resource/UI/Scoreboard.res\" {}";
        let mut tree = HudTree::default();
        tree.insert(path, original.as_bytes().to_vec());
        let patch = serde_json::json!({path:{"#base":[{"true":"../resource/ui/short.res","false":"../resource/ui/full.res"}, "second.res"]}});
        merge_files(&mut tree, &patch, "", Some(true)).unwrap();
        let expected = original.replace("full.res", "short.res").replace(
            "#base \"keep.res\"",
            "#base \"second.res\"\n#base \"keep.res\"",
        );
        assert_eq!(
            std::str::from_utf8(tree.get(path).unwrap()).unwrap(),
            expected
        );
        let once = tree.clone();
        merge_files(&mut tree, &patch, "", Some(true)).unwrap();
        assert_eq!(tree, once);
        merge_files(&mut tree, &patch, "", Some(false)).unwrap();
        assert_eq!(
            std::str::from_utf8(tree.get(path).unwrap()).unwrap(),
            original.replace(
                "#base \"keep.res\"",
                "#base \"second.res\"\n#base \"keep.res\""
            )
        );
        let invalid =
            serde_json::json!({path:{"#base":[{"true":"../../escape.res","false":"keep.res"}]}});
        let before = tree.clone();
        assert!(merge_files(&mut tree, &invalid, "", Some(true)).is_err());
        assert_eq!(tree, before);
    }

    #[test]
    fn base_edits_leave_commented_and_nested_spelling_untouched() {
        let path = "resource/ui/menu.res";
        let text = "/*\n#base \"backgrounds/old.res\"\n*/\nRoot {\n#base \"backgrounds/old.res\"\n}\n#base \"backgrounds/old.res\"\n";
        let mut tree = HudTree::default();
        tree.insert(path, text.as_bytes().to_vec());
        merge_files(
            &mut tree,
            &serde_json::json!({path:{"#base":"backgrounds/$value.res"}}),
            "new",
            None,
        )
        .unwrap();
        let expected = text
            .strip_suffix("#base \"backgrounds/old.res\"\n")
            .unwrap()
            .to_string()
            + "#base \"backgrounds/new.res\"\n";
        assert_eq!(
            std::str::from_utf8(tree.get(path).unwrap()).unwrap(),
            expected
        );
    }
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
    base_target_range(line).map(|range| &line[range])
}

fn base_target_range(line: &str) -> Option<std::ops::Range<usize>> {
    let trimmed = line.trim_start();
    let keyword = trimmed.split_whitespace().next()?;
    if !keyword.eq_ignore_ascii_case("#base") {
        return None;
    }
    let rest = trimmed[keyword.len()..].trim_start();
    let offset = line.len() - rest.len();
    if let Some(quoted) = rest.strip_prefix('"') {
        let end = quoted.find('"')?;
        Some(offset + 1..offset + 1 + end)
    } else {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        (end > 0).then_some(offset..offset + end)
    }
}

#[cfg(test)]
fn split_base_lines(text: &str) -> Result<(Vec<String>, String), ProfileError> {
    let mut bases = Vec::new();
    let mut rest = String::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed
            .split_whitespace()
            .next()
            .is_some_and(|word| word.eq_ignore_ascii_case("#base"))
        {
            parse_hud_vdf(line).map_err(ProfileError::Io)?;
            bases.push(line.to_string());
        } else {
            rest.push_str(line);
            rest.push('\n');
        }
    }
    Ok((bases, rest))
}

fn json_to_vdf(
    object: &serde_json::Map<String, serde_json::Value>,
    substitute_with: &str,
    toggle: Option<bool>,
) -> Result<VdfMap, ProfileError> {
    let mut map = VdfMap::default();
    for (key, child) in object {
        // Conditional keys address exactly one OS variant.
        let (key, condition) = match key.split_once('^') {
            Some((key, condition)) => {
                if !condition.starts_with('[')
                    || !condition.ends_with(']')
                    || condition[1..condition.len() - 1]
                        .chars()
                        .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '$' | '!' | '_')))
                {
                    return Err(ProfileError::Io("Invalid HUD conditional suffix".into()));
                }
                (key, Some(condition.to_string()))
            }
            None => (key.as_str(), None),
        };
        let child = match child.as_object() {
            Some(branches) if branches.contains_key("true") || branches.contains_key("false") => {
                if toggle.is_none() || branches.keys().any(|key| key != "true" && key != "false") {
                    return Err(ProfileError::Io(
                        "HUD true/false values require a checkbox and only true/false branches"
                            .into(),
                    ));
                }
                branches
                    .get(if toggle == Some(true) {
                        "true"
                    } else {
                        "false"
                    })
                    .ok_or_else(|| {
                        ProfileError::Io(
                            "HUD checkbox value is missing its selected true/false branch".into(),
                        )
                    })?
            }
            _ => child,
        };
        let value =
            match child {
                serde_json::Value::Object(object) => {
                    VdfValue::Obj(json_to_vdf(object, substitute_with, toggle)?)
                }
                serde_json::Value::String(_)
                | serde_json::Value::Number(_)
                | serde_json::Value::Bool(_) => {
                    VdfValue::Str(substitute(&json_to_string(child), substitute_with))
                }
                _ => return Err(ProfileError::Io(
                    "Unsupported HUD resource value; expected a string, number, boolean or object"
                        .into(),
                )),
            };
        map.entries.push((key.to_string(), value));
        map.set_condition(map.entries.len() - 1, condition);
    }
    Ok(map)
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

    const OPTION_SCHEMA: &str = include_str!("../fixtures/hud-options/schema.json");
    const ANIMATIONS: &str = include_str!("../fixtures/hud-options/hudanimations_custom.txt");
    const RESOURCE: &str =
        include_str!("../fixtures/hud-options/huditemeffectmeter_killstreak.res");
    const ANIMATION_PATH: &str = "scripts/hudanimations_custom.txt";
    const RESOURCE_PATH: &str = "resource/ui/huditemeffectmeter_killstreak.res";

    #[test]
    fn reported_control_shapes_apply_both_checkbox_states_and_every_combo_choice() {
        let schema = parse_hud_schema(OPTION_SCHEMA).unwrap();
        for encoding in [
            TextEncoding::Utf8,
            TextEncoding::Utf8Bom,
            TextEncoding::Utf16Le,
            TextEncoding::Utf16Be,
        ] {
            let mut tree = HudTree::default();
            // Deliberately use mixed case and CRLF, both common on Windows.
            tree.insert(
                ANIMATION_PATH,
                encode_hud_text(&ANIMATIONS.replace('\n', "\r\n"), encoding),
            );
            tree.insert(
                "Resource/UI/HudItemEffectMeter_Killstreak.res",
                encode_hud_text(RESOURCE, encoding),
            );
            for on in [false, true, false] {
                for choice in ["0", "1", "2", "3", "0"] {
                    let options = BTreeMap::from([
                        ("fh_toggle_disguise_image".into(), on.to_string()),
                        ("fh_val_hud_style".into(), on.to_string()),
                        ("fh_val_health_style".into(), choice.into()),
                    ]);
                    apply_hud_options(&mut tree, &schema, "fixture", &options).unwrap();
                    let (animation, actual_encoding) =
                        decode_hud_text(ANIMATION_PATH, tree.get(ANIMATION_PATH).unwrap()).unwrap();
                    assert_eq!(actual_encoding, encoding);
                    let active = |prefix: &str| {
                        animation
                            .lines()
                            .any(|line| line.trim_start().starts_with(prefix))
                    };
                    assert_eq!(active("Animate\tPlayerStatusSpyOutlineImage"), !on);
                    assert_eq!(
                        active("RunEvent FixtureText\t"),
                        matches!(choice, "0" | "3")
                    );
                    assert_eq!(active("RunEvent FixtureBox "), choice == "1");
                    assert!(animation.contains("\tRunEvent FixtureTextExtra 0.1\r\n"));
                    assert!(
                        animation.contains("\t//Animate Unrelated Alpha \"0\" Linear 0.0 1.0\r\n")
                    );
                    assert!(animation.contains("0.0 // keep timing and comment\r\n"));
                    assert_eq!(
                        animation.matches('\n').count(),
                        animation.matches("\r\n").count()
                    );

                    let (resource, actual_encoding) = decode_hud_text(
                        RESOURCE_PATH,
                        tree.get("Resource/UI/HudItemEffectMeter_Killstreak.res")
                            .unwrap(),
                    )
                    .unwrap();
                    assert_eq!(actual_encoding, encoding);
                    assert!(
                        tree.get(RESOURCE_PATH).is_none(),
                        "must retain the original path spelling"
                    );
                    assert!(
                        resource.contains("#base \"base\\keep.res\" [$WIN32] // keep this include")
                    );
                    let (_, rest) = split_base_lines(&resource).unwrap();
                    let parsed = parse_hud_vdf(&rest).unwrap();
                    assert_eq!(
                        parsed.entries.len(),
                        1,
                        "panels belong inside their resource header"
                    );
                    let root = parsed.entries[0].1.as_obj().unwrap();
                    for icon in ["StreakIcon", "StreakIconShadow"] {
                        assert_eq!(
                            root.get(icon)
                                .unwrap()
                                .as_obj()
                                .unwrap()
                                .get("labelText")
                                .unwrap()
                                .as_str(),
                            Some("\\")
                        );
                    }
                    let meter = root.get("HudItemEffectMeter").unwrap().as_obj().unwrap();
                    assert_eq!(
                        meter.entries[0].1.as_str(),
                        Some(if on { "r100" } else { "c50" })
                    );
                    assert_eq!(meter.entries[1].1.as_str(), Some("c75"));
                    assert_eq!(meter.condition_at(1), Some("[$POSIX]"));
                    let once = tree.clone();
                    apply_hud_options(&mut tree, &schema, "fixture", &options).unwrap();
                    assert_eq!(tree, once, "repeat application must be byte-idempotent");
                }
            }
        }
    }

    #[test]
    fn line_edits_preserve_comment_spacing_no_final_newline_and_checkbox_inversion() {
        let patch = serde_json::json!({"uncomment": ["RunEvent Fixture"]});
        let text = "  //\tRunEvent\tFixture 0.2 // note\n// unrelated\n  RunEvent FixtureMore 0.0";
        let enabled = edit_animation_lines(text, patch.as_object().unwrap(), Some(true)).unwrap();
        assert_eq!(
            enabled,
            "  \tRunEvent\tFixture 0.2 // note\n// unrelated\n  RunEvent FixtureMore 0.0"
        );
        assert_eq!(
            edit_animation_lines(&enabled, patch.as_object().unwrap(), Some(true)).unwrap(),
            enabled
        );
        let disabled =
            edit_animation_lines(&enabled, patch.as_object().unwrap(), Some(false)).unwrap();
        assert_eq!(
            disabled,
            "  \t//RunEvent\tFixture 0.2 // note\n// unrelated\n  RunEvent FixtureMore 0.0"
        );
    }

    #[test]
    fn unsupported_animation_or_malformed_directives_fail_with_parent_control_and_path() {
        for patch in [
            serde_json::json!({"event": []}),
            serde_json::json!({"comment": "RunEvent Fixture"}),
            serde_json::json!({"comment": [123]}),
            serde_json::json!({"comment": [" "]}),
            serde_json::json!({"comment": ["RunEvent\nFixture"]}),
            serde_json::json!({"comment": ["RunEvent FixtureText"], "uncomment": ["RunEvent FixtureText"]}),
        ] {
            let mut schema = parse_hud_schema(OPTION_SCHEMA).unwrap();
            schema
                .controls
                .get_mut("Customizations")
                .unwrap()
                .drain(..2);
            let choice = &mut schema.controls.get_mut("Customizations").unwrap()[0]
                .options
                .as_mut()
                .unwrap()[0];
            choice.files = Some(serde_json::json!({ANIMATION_PATH: patch}));
            let mut tree = HudTree::default();
            tree.insert(ANIMATION_PATH, ANIMATIONS.as_bytes().to_vec());
            let before = tree.clone();
            let error =
                apply_hud_options(&mut tree, &schema, "fixture", &BTreeMap::new()).unwrap_err();
            assert!(
                error
                    .message()
                    .contains("Health Style\" (fh_val_health_style)"),
                "{error:?}"
            );
            assert!(error.message().contains(ANIMATION_PATH), "{error:?}");
            assert!(!error.message().contains("keep timing and comment"));
            assert_eq!(tree, before);
        }
    }

    #[test]
    fn malformed_resource_and_incomplete_utf16_fail_without_replacing_the_file() {
        let schema = parse_hud_schema(OPTION_SCHEMA).unwrap();
        for bytes in [
            b"\"Unclosed\" { \"leaf\"".to_vec(),
            b"\"valid\" \"value\" /* unfinished comment".to_vec(),
            b"#base \"unfinished path\n\"valid\" \"value\"".to_vec(),
            vec![0xff, 0xfe, b'x'],
            vec![0xfe, 0xff, b'x'],
            vec![0xff, 0xfe, 0x00, 0xd8],
            vec![0xfe, 0xff, 0xd8, 0x00],
        ] {
            let mut tree = HudTree::default();
            tree.insert(ANIMATION_PATH, ANIMATIONS.as_bytes().to_vec());
            tree.insert(RESOURCE_PATH, bytes.clone());
            let error =
                apply_hud_options(&mut tree, &schema, "fixture", &BTreeMap::new()).unwrap_err();
            assert!(
                error
                    .message()
                    .contains("Cornered Health/Ammo\" (fh_val_hud_style)"),
                "{error:?}"
            );
            assert!(error.message().contains(RESOURCE_PATH), "{error:?}");
            assert_eq!(tree.get(RESOURCE_PATH).unwrap(), bytes);
        }
    }

    #[test]
    fn hash_base_change_keeps_literal_slashes_condition_and_comment() {
        let mut tree = HudTree::default();
        tree.insert("resource/menu.res", b"  #BASE \"backgrounds\\dark.res\" [$WIN32] // owned\n#base \"keep.res\"\n\"Menu\" { \"icon\" \"\\\" }\n".to_vec());
        let files = serde_json::json!({"resource/menu.res": {"#base": "backgrounds\\$value.res"}});
        merge_files(&mut tree, &files, "light", None).unwrap();
        let once = tree.clone();
        merge_files(&mut tree, &files, "light", None).unwrap();
        assert_eq!(tree, once);
        assert_eq!(std::str::from_utf8(tree.get("resource/menu.res").unwrap()).unwrap(), "  #BASE \"backgrounds\\light.res\" [$WIN32] // owned\n#base \"keep.res\"\n\"Menu\" { \"icon\" \"\\\" }\n");
    }

    #[test]
    fn explicit_platform_patch_changes_only_that_condition() {
        let mut tree = HudTree::default();
        tree.insert(
            "resource/fixture.res",
            b"\"xpos\" \"1\"\n\"xpos\" \"2\" [$WIN32]\n\"xpos\" \"3\" [$POSIX]\n".to_vec(),
        );
        let files = serde_json::json!({"resource/fixture.res": {"xpos^[$WIN32]": "4"}});
        merge_files(&mut tree, &files, "", None).unwrap();
        let parsed =
            parse_hud_vdf(std::str::from_utf8(tree.get("resource/fixture.res").unwrap()).unwrap())
                .unwrap();
        assert_eq!(
            parsed
                .entries
                .iter()
                .map(|(_, value)| value.as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["1", "4", "3"]
        );
        assert_eq!(parsed.condition_at(1), Some("[$WIN32]"));
        assert_eq!(parsed.condition_at(2), Some("[$POSIX]"));
    }

    #[test]
    fn hud_exec_lines_append_rewrite_and_prune() {
        let stems = vec!["execs_hud_minmode".to_string()];
        // Empty autoexec: one appended managed line, layer-addressed.
        let text = ensure_hud_exec_lines("", CfgLayer::Comfig, &stems);
        assert_eq!(text, "exec overrides/execs_hud_minmode // execs:managed\n");
        // A bare-stem managed line on the comfig layer is rewritten in place;
        // the user's own lines survive untouched.
        let existing = "exec overrides/execs_binds // execs:managed\nexec execs_hud_minmode // execs:managed\nbind f +duck\n";
        let text = ensure_hud_exec_lines(existing, CfgLayer::Comfig, &stems);
        assert_eq!(
            text,
            "exec overrides/execs_binds // execs:managed\nexec overrides/execs_hud_minmode // execs:managed\nbind f +duck\n"
        );
        // Stems that are gone are pruned; non-HUD managed lines stay.
        let text = ensure_hud_exec_lines(existing, CfgLayer::Vanilla, &[]);
        assert_eq!(
            text,
            "exec overrides/execs_binds // execs:managed\nbind f +duck\n"
        );
        // A hand-written exec of the same target counts as present.
        let text = ensure_hud_exec_lines("exec execs_hud_minmode\n", CfgLayer::Vanilla, &stems);
        assert_eq!(text, "exec execs_hud_minmode\n");
        // Idempotent.
        let once = ensure_hud_exec_lines("bind w +forward", CfgLayer::Vanilla, &stems);
        assert_eq!(
            ensure_hud_exec_lines(&once, CfgLayer::Vanilla, &stems),
            once
        );
    }

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
        let result =
            apply_hud_options_for_layer(&mut tree, &schema, "budhud", &options, CfgLayer::Vanilla)
                .unwrap();
        let colors =
            std::str::from_utf8(tree.get("resource/clientscheme_colors.res").unwrap()).unwrap();
        assert!(colors.contains("0 153 255 255"));
        assert!(colors.contains("Keep"));
        assert!(tree.get("#customization/_enabled/minmode.res").is_some());
        assert!(tree.get("#customization/minmode.res").is_none());
        // WriteCfg files sit directly in the layer's cfg folder, execed by bare
        // stem from the managed autoexec line. Nested under `tf/cfg/<hudid>/`
        // the engine never found them and the checkbox was a silent no-op.
        assert_eq!(
            result.cfg_writes,
            vec![(
                "tf/cfg/execs_hud_hud_minmode.cfg".into(),
                b"cl_hud_minmode 1\n".to_vec()
            )]
        );
        assert_eq!(result.exec_stems, vec!["execs_hud_hud_minmode".to_string()]);
        assert_eq!(
            hud_cfg_path(CfgLayer::Comfig, "execs_hud_hud_minmode"),
            "tf/cfg/overrides/execs_hud_hud_minmode.cfg"
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
        apply_hud_options_for_layer(&mut tree, &schema, "rayshud", &options, CfgLayer::Vanilla)
            .unwrap();
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

    /// `Minimum` / `Maximum` were surfaced to the UI and then ignored on apply,
    /// so an out-of-range number went into the HUD file verbatim.
    #[test]
    fn numeric_bounds_are_enforced_on_apply() {
        let schema: HudSchema = parse_hud_schema(
            r##"{
  "Controls": {
    "Layout": [
      {
        "Name": "Opacity",
        "Type": "IntegerUpDown",
        "Value": "128",
        "Minimum": 0,
        "Maximum": 255,
        "Files": { "resource/scheme.res": { "Opacity": "$value" } }
      }
    ]
  }
}"##,
        )
        .unwrap();

        let read = |value: &str| {
            let mut tree = HudTree::default();
            tree.insert("resource/scheme.res", b"\"Scheme\"\n{\n}\n".to_vec());
            let mut options = BTreeMap::new();
            options.insert("Opacity".to_string(), value.to_string());
            apply_hud_options_for_layer(&mut tree, &schema, "rayshud", &options, CfgLayer::Vanilla)
                .unwrap();
            std::str::from_utf8(tree.get("resource/scheme.res").unwrap())
                .unwrap()
                .to_string()
        };

        assert!(read("999").contains("\"255\""), "{}", read("999"));
        assert!(read("-40").contains("\"0\""), "{}", read("-40"));
        assert!(read("128").contains("\"128\""));
        // A value the schema never meant as a number is passed through, not
        // silently turned into a bound.
        assert!(read("auto").contains("\"auto\""));
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

        apply_hud_options_for_layer(&mut tree, &schema, "rayshud", &options, CfgLayer::Vanilla)
            .unwrap();

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

        apply_hud_options_for_layer(&mut tree, &schema, "rayshud", &options, CfgLayer::Vanilla)
            .unwrap();

        let out =
            std::str::from_utf8(tree.get("resource/ui/mainmenuoverride.res").unwrap()).unwrap();
        assert!(out.starts_with("#base \"backgrounds/dark.res\"\n"));
        assert!(out.contains("\"MainMenu\""));
    }

    #[test]
    fn utf16le_res_files_round_trip_instead_of_being_wiped() {
        let schema = schema_fixture();
        let mut tree = HudTree::default();
        tree.insert("#customization/minmode.res", b"off\n".to_vec());
        let text = "\"Scheme\"\n{\n\t\"Colors\"\n\t{\n\t\t\"bh_Health_Buff\"\t\t\"255 0 0 255\"\n\t\t\"Keep\"\t\t\"1 1 1 1\"\n\t}\n}\n";
        tree.insert(
            "resource/clientscheme_colors.res",
            encode_hud_text(text, TextEncoding::Utf16Le),
        );
        let mut options = BTreeMap::new();
        options.insert("bh_Health_Buff".into(), "0 153 255 255".into());

        apply_hud_options_for_layer(&mut tree, &schema, "budhud", &options, CfgLayer::Vanilla)
            .unwrap();

        let bytes = tree.get("resource/clientscheme_colors.res").unwrap();
        assert_eq!(&bytes[..2], &[0xFF, 0xFE], "the BOM must be preserved");
        let (decoded, encoding) = decode_hud_text("x.res", bytes).unwrap();
        assert_eq!(encoding, TextEncoding::Utf16Le);
        assert!(decoded.contains("0 153 255 255"));
        // The rest of the scheme survives the decode too.
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

        let err =
            apply_hud_options_for_layer(&mut tree, &schema, "budhud", &options, CfgLayer::Vanilla)
                .unwrap_err();
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

        apply_hud_options_for_layer(&mut tree, &schema, "rayshud", &options, CfgLayer::Vanilla)
            .unwrap();

        let out = std::str::from_utf8(tree.get("resource/ui/hudlayout.res").unwrap()).unwrap();
        assert!(out.contains("\"1\" [$WIN32]"), "{out}");
        assert!(out.contains("\"xpos\"\t\t\"42\""), "{out}");
        // The key after the conditional must not have been consumed as a value.
        assert!(out.contains("\"ItemName\"\t\t\"health\""), "{out}");
    }
    #[test]
    fn schema_comments_and_nameless_options_parse() {
        let raw = r#"{
            // General options
            "Name": "kbnhud",
            "Controls": {
                "Look": [
                    {
                        "Name": "kb_style", "Label": "Style", "Type": "ComboBox",
                        "Value": "a", /* default */
                        "Options": [
                            { "Label": "Plain", "Value": "a" },
                            { "Label": "Fancy // not a comment", "Value": "b" }
                        ]
                    }
                ]
            }
        }"#;
        let schema = parse_hud_schema(raw).unwrap();
        let control = &schema.controls["Look"][0];
        let options = control.options.as_ref().unwrap();
        assert_eq!(options.len(), 2);
        assert_eq!(options[0].name, "");
        assert_eq!(options[1].label, "Fancy // not a comment");
    }

    /// Non-ASCII inside a string value used to be pushed byte by byte as
    /// Latin-1 chars, so `é` came out as mojibake.
    #[test]
    fn stripping_comments_keeps_non_ascii_strings_intact() {
        let raw = "{ // café\n \"Label\": \"Santé — 100%\", /* naïve */ \"Value\": \"ü\" }";
        let stripped = strip_json_comments(raw);
        assert_eq!(
            stripped,
            "{ \n \"Label\": \"Santé — 100%\",  \"Value\": \"ü\" }"
        );
        let parsed: serde_json::Value = serde_json::from_str(&stripped).unwrap();
        assert_eq!(parsed["Label"], "Santé — 100%");
        assert_eq!(parsed["Value"], "ü");
        // An escaped quote does not end the string; a `//` after it is still
        // string content.
        assert_eq!(
            strip_json_comments(r#"{"a": "x\"//y", "b": 1} // tail"#),
            r#"{"a": "x\"//y", "b": 1} "#
        );
    }
}
