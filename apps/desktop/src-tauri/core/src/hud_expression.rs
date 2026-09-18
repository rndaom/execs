//! The small, data-only expression language documented by TF2HUD.Editor.
//! No general expression interpreter: only `$control` and `{$control ? a : b}`.

use std::collections::BTreeMap;

use super::{clamp_to_bounds, is_truthy, normalize_type, HudControl, HudSchema};
use crate::profile::ProfileError;

const MAX_DEPTH: usize = 64;
const MAX_NODES: usize = 100_000;
const MAX_TEXT: usize = 64 * 1024;
const MAX_TOTAL_TEXT: usize = 4 * 1024 * 1024;

fn error(reason: impl Into<String>) -> ProfileError {
    ProfileError::Io(reason.into())
}

#[derive(Default)]
struct Budget {
    nodes: usize,
    text: usize,
}

impl Budget {
    fn visit(&mut self, depth: usize) -> Result<(), ProfileError> {
        self.nodes += 1;
        if depth > MAX_DEPTH || self.nodes > MAX_NODES {
            return Err(error("HUD expression structure exceeds its limit"));
        }
        Ok(())
    }

    fn text(&mut self, text: &str) -> Result<(), ProfileError> {
        self.text = self.text.saturating_add(text.len());
        if text.len() > MAX_TEXT || self.text > MAX_TOTAL_TEXT {
            return Err(error("HUD expression text exceeds its limit"));
        }
        Ok(())
    }
}

fn current_value(control: &HudControl, options: &BTreeMap<String, String>) -> String {
    let value = clamp_to_bounds(
        control,
        options.get(&control.name).unwrap_or(&control.value).clone(),
    );
    if normalize_type(&control.control_type) == "checkbox" {
        if is_truthy(&value) { "1" } else { "0" }.to_string()
    } else {
        value
    }
}

/// Every reference reads the same snapshot, including controls without Files.
/// This ensures changing an outline checkbox reevaluates a size control's font.
pub(super) fn resolve_schema(
    schema: &HudSchema,
    options: &BTreeMap<String, String>,
) -> Result<HudSchema, ProfileError> {
    let mut values = BTreeMap::new();
    let mut budget = Budget::default();
    for control in schema.controls.values().flatten() {
        budget.visit(0)?;
        let value = current_value(control, options);
        budget.text(&value)?;
        if !control.name.is_empty() && values.insert(control.name.clone(), value).is_some() {
            return Err(error(format!(
                "Ambiguous HUD control reference ${}",
                control.name
            )));
        }
    }
    let mut resolved = schema.clone();
    for control in resolved.controls.values_mut().flatten() {
        resolve_control(control, options, &values, &mut budget, 0)?;
    }
    Ok(resolved)
}

fn resolve_control(
    control: &mut HudControl,
    options: &BTreeMap<String, String>,
    values: &BTreeMap<String, String>,
    budget: &mut Budget,
    depth: usize,
) -> Result<(), ProfileError> {
    budget.visit(depth)?;
    let current = current_value(control, options);
    if let Some(files) = &mut control.files {
        if let Some(files) = files.as_object_mut() {
            for (path, patch) in files {
                resolve_json(patch, &current, values, budget, depth + 1).map_err(|err| {
                    error(format!(
                        "HUD option \"{}\" ({}), {path}: {err:?}",
                        control.label, control.name
                    ))
                })?;
            }
        }
    }
    if let Some(choices) = &mut control.options {
        for choice in choices {
            resolve_control(choice, options, values, budget, depth + 1)?;
        }
    }
    Ok(())
}

fn resolve_json(
    value: &mut serde_json::Value,
    current: &str,
    values: &BTreeMap<String, String>,
    budget: &mut Budget,
    depth: usize,
) -> Result<(), ProfileError> {
    resolve_json_inner(value, current, values, budget, depth, false)
}

fn resolve_json_inner(
    value: &mut serde_json::Value,
    current: &str,
    values: &BTreeMap<String, String>,
    budget: &mut Budget,
    depth: usize,
    keep_value: bool,
) -> Result<(), ProfileError> {
    budget.visit(depth)?;
    match value {
        serde_json::Value::String(text) => {
            budget.text(text)?;
            *text = evaluate_inner(text, current, values, keep_value)?;
            budget.text(text)?;
        }
        serde_json::Value::Object(map) => {
            // Keys include Valve material parameters and OS tags, not expressions.
            for (key, child) in map {
                // Include replacement uses the original $value template to
                // identify the previous selected include without deleting
                // unrelated #base directives. Leave that one placeholder for
                // the merge layer; other references still resolve here.
                resolve_json_inner(
                    child,
                    current,
                    values,
                    budget,
                    depth + 1,
                    keep_value || key.eq_ignore_ascii_case("#base"),
                )?;
            }
        }
        serde_json::Value::Array(array) => {
            for child in array {
                resolve_json_inner(child, current, values, budget, depth + 1, keep_value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn lookup<'a>(
    id: &str,
    current: &'a str,
    values: &'a BTreeMap<String, String>,
) -> Result<&'a str, ProfileError> {
    let value = if id == "value" {
        current
    } else {
        values
            .get(id)
            .map(String::as_str)
            .ok_or_else(|| error(format!("Unknown HUD control reference ${id}")))?
    };
    // Values are data, never recursively evaluated. Reject expression-bearing
    // values so the legacy merge substitution cannot interpret them a second time.
    if value.contains('$') {
        return Err(error(format!(
            "HUD control ${id} contains unresolved expression syntax"
        )));
    }
    Ok(value)
}

fn reference_len(text: &str) -> usize {
    text.bytes()
        .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        .count()
}

fn boolean(value: &str) -> Result<bool, ProfileError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(error("HUD ternary condition must be true or false")),
    }
}

#[cfg(test)]
fn evaluate(
    template: &str,
    current: &str,
    values: &BTreeMap<String, String>,
) -> Result<String, ProfileError> {
    evaluate_inner(template, current, values, false)
}

fn evaluate_inner(
    template: &str,
    current: &str,
    values: &BTreeMap<String, String>,
    keep_value: bool,
) -> Result<String, ProfileError> {
    if template.len() > MAX_TEXT {
        return Err(error("HUD expression text exceeds its limit"));
    }
    let mut output = String::new();
    let mut remaining = template;
    while !remaining.is_empty() {
        if let Some(expression) = remaining
            .strip_prefix('{')
            .filter(|s| s.trim_start().starts_with('$'))
        {
            let end = expression
                .find('}')
                .ok_or_else(|| error("Unclosed HUD ternary expression"))?;
            let expression = &expression[..end];
            let (condition, branches) = expression.split_once('?').ok_or_else(|| {
                error("Unsupported HUD expression; expected a true/false ternary")
            })?;
            let (yes, no) = branches
                .split_once(':')
                .ok_or_else(|| error("HUD ternary expression is missing its false branch"))?;
            if branches.contains(['?', '{', '}'])
                || no.contains(':')
                || yes.trim().is_empty()
                || no.trim().is_empty()
            {
                return Err(error("Unsupported HUD ternary expression"));
            }
            let id = condition
                .trim()
                .strip_prefix('$')
                .ok_or_else(|| error("HUD ternary condition must reference a control"))?;
            if id.is_empty() || reference_len(id) != id.len() {
                return Err(error("Unsupported HUD ternary condition"));
            }
            let on = boolean(lookup(id, current, values)?)?;
            // Both arms are checked, so unsupported syntax cannot hide in a
            // currently unselected branch and appear on the next toggle.
            let yes = evaluate_inner(yes.trim(), current, values, keep_value)?;
            let no = evaluate_inner(no.trim(), current, values, keep_value)?;
            output.push_str(if on { &yes } else { &no });
            remaining = &remaining[end + 2..];
        } else if let Some(reference) = remaining.strip_prefix('$') {
            let length = reference_len(reference);
            if length == 0 {
                return Err(error("Unsupported HUD control reference"));
            }
            let id = &reference[..length];
            let value = lookup(id, current, values)?;
            output.push_str(if keep_value && id == "value" {
                "$value"
            } else {
                value
            });
            remaining = &reference[length..];
        } else {
            let ch = remaining.chars().next().expect("nonempty text");
            output.push(ch);
            remaining = &remaining[ch.len_utf8()..];
        }
        if output.len() > MAX_TEXT {
            return Err(error("HUD expression output exceeds its limit"));
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hud::HudTree;
    use crate::hud_apply::{apply_hud_options, parse_hud_schema};
    use serde_json::json;

    fn schema_for(outline: &str) -> HudSchema {
        parse_hud_schema(
            &json!({"Controls":{"Crosshair":[
                {"Name":"size", "Type":"IntegerUpDown", "Value":"20",
                 "Minimum":"10", "Maximum":"30",
                 "Files":{"resource/crosshair.res":{"Crosshair":{
                     "font":format!("Size:$value | Outline:{{${outline} ? ON : OFF}}")
                 }}}},
                {"Name":outline,"Type":"CheckBox","Value":"false"}
            ]}})
            .to_string(),
        )
        .unwrap()
    }

    #[test]
    fn all_four_pinned_font_templates_follow_size_and_outline_in_both_directions() {
        // TF2HUD.Editor 17bccd15: kbnhud.json and hypnotize-hud.json.
        for outline in [
            "kbn_crosshair1_outline",
            "kbn_crosshair2_outline",
            "kbn_hitmarker_outline",
            "hh_val_xhair_outline",
        ] {
            let schema = schema_for(outline);
            let mut tree = HudTree::default();
            tree.insert(
                "resource/crosshair.res",
                b"\"Crosshair\" { \"font\" \"old\" }".to_vec(),
            );
            let mut options = BTreeMap::new();
            for (size, toggle, expected) in [
                (None, None, "Size:20 | Outline:OFF"),
                (Some("24"), None, "Size:24 | Outline:OFF"),
                (Some("24"), Some("true"), "Size:24 | Outline:ON"),
                (Some("12"), Some("true"), "Size:12 | Outline:ON"),
                (Some("12"), Some("false"), "Size:12 | Outline:OFF"),
                (Some("999"), Some("true"), "Size:30 | Outline:ON"),
            ] {
                if let Some(size) = size {
                    options.insert("size".into(), size.into());
                }
                if let Some(toggle) = toggle {
                    options.insert(outline.into(), toggle.into());
                }
                apply_hud_options(&mut tree, &schema, "fixture", &options).unwrap();
                let output =
                    String::from_utf8(tree.files["resource/crosshair.res"].clone()).unwrap();
                assert!(output.contains(expected), "{outline}: {output}");
                assert!(!output.contains('$'), "{outline}: {output}");
                let before = tree.clone();
                apply_hud_options(&mut tree, &schema, "fixture", &options).unwrap();
                assert_eq!(tree, before);
            }
        }
    }

    #[test]
    fn reference_tokens_are_exact_and_boolean_semantics_are_explicit() {
        let values = BTreeMap::from([
            ("value_suffix".into(), "72".into()),
            ("other".into(), "18".into()),
        ]);
        assert_eq!(
            evaluate("$value/$value_suffix/$other", "4", &values).unwrap(),
            "4/72/18"
        );
        for value in ["false", "0", "off", "no", "FALSE"] {
            assert_eq!(
                evaluate("{$value ? ON : OFF}", value, &values).unwrap(),
                "OFF"
            );
        }
        for value in ["true", "1", "on", "yes", "TRUE"] {
            assert_eq!(
                evaluate("{ $value ? $other : OFF}", value, &values).unwrap(),
                "18"
            );
        }
        assert!(evaluate("{$value ? ON : OFF}", "maybe", &values).is_err());
    }

    #[test]
    fn malformed_unknown_and_recursive_expressions_are_refused() {
        let values = BTreeMap::new();
        for template in [
            "$missing",
            "{$missing ? ON : OFF}",
            "{$value ? ON}",
            "{$value ? ON : OFF",
            "{$value + 1}",
            "{$value ? {$value ? a : b} : c}",
            "{$value ? ON : $missing}",
            "$(run)",
            "{$value ? ON : OFF : extra}",
        ] {
            assert!(evaluate(template, "true", &values).is_err(), "{template}");
        }
        assert!(evaluate("$value", "$value", &values).is_err());
        assert!(evaluate(&"x".repeat(MAX_TEXT + 1), "1", &values).is_err());
        assert!(evaluate("$value$value", &"x".repeat(MAX_TEXT), &values).is_err());
    }

    #[test]
    fn unresolved_reference_reports_control_and_file_and_preserves_tree() {
        let mut schema = schema_for("outline");
        schema.controls.get_mut("Crosshair").unwrap().pop();
        let mut tree = HudTree::default();
        tree.insert(
            "resource/crosshair.res",
            b"untouched imported bytes".to_vec(),
        );
        let before = tree.clone();
        let err = apply_hud_options(&mut tree, &schema, "fixture", &BTreeMap::new())
            .unwrap_err()
            .message();
        assert!(
            err.contains("size")
                && err.contains("resource/crosshair.res")
                && err.contains("outline"),
            "{err}"
        );
        assert_eq!(tree, before);
    }

    #[test]
    fn a_later_apply_failure_keeps_earlier_edits_out_of_callers_tree() {
        let mut schema = schema_for("outline");
        schema.controls.get_mut("Crosshair").unwrap().push(
            serde_json::from_value(json!({
                "Name":"later", "Type":"IntegerUpDown", "Value":"1",
                "Files":{"../escape.res":{"visible":"$value"}}
            }))
            .unwrap(),
        );
        let mut tree = HudTree::default();
        tree.insert(
            "resource/crosshair.res",
            b"\"Crosshair\" { \"font\" \"old\" }".to_vec(),
        );
        let before = tree.clone();
        assert!(apply_hud_options(&mut tree, &schema, "fixture", &BTreeMap::new()).is_err());
        assert_eq!(tree, before);
    }

    #[test]
    fn nested_schema_data_and_expansion_have_bounded_work() {
        let mut deep = json!("$value");
        for _ in 0..MAX_DEPTH + 1 {
            deep = json!([deep]);
        }
        assert!(resolve_json(&mut deep, "1", &BTreeMap::new(), &mut Budget::default(), 0).is_err());
        let mut many = serde_json::Value::Array(vec![json!(0); MAX_NODES]);
        assert!(resolve_json(&mut many, "1", &BTreeMap::new(), &mut Budget::default(), 0).is_err());
        let mut total = Budget {
            text: MAX_TOTAL_TEXT,
            ..Default::default()
        };
        assert!(total.text("x").is_err());
    }

    #[test]
    fn keys_and_static_imported_content_are_not_expression_templates() {
        let mut patch = json!({"$basetexture":"literal/material", "xpos^[$WIN32]":"$value"});
        resolve_json(
            &mut patch,
            "42",
            &BTreeMap::new(),
            &mut Budget::default(),
            0,
        )
        .unwrap();
        assert_eq!(
            patch,
            json!({"$basetexture":"literal/material", "xpos^[$WIN32]":"42"})
        );
    }

    #[test]
    fn base_include_retains_value_template_for_previous_selection_ownership() {
        let mut patch = json!({"#base": "backgrounds/$value.res", "Panel": {"font":"$value"}});
        resolve_json(
            &mut patch,
            "selected",
            &BTreeMap::new(),
            &mut Budget::default(),
            0,
        )
        .unwrap();
        assert_eq!(
            patch,
            json!({"#base": "backgrounds/$value.res", "Panel": {"font":"selected"}})
        );
    }
}
