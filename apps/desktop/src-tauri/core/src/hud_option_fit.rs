//! Which of a schema's options fit one HUD's files. A schema describes the
//! HUD its author had in front of them; the installed HUD can be a different
//! version, a fork, or (for the shared options) a different HUD altogether.
//! Each control is dry-run on its own against a copy of the files it names,
//! and one that would edit a file or section the HUD lacks is turned off with
//! the reason. Nothing here writes: the copies are dropped.

use std::collections::{BTreeMap, BTreeSet};

use super::{
    apply_control, expressions, is_truthy, move_folders, normalize_type, HudControl, HudSchema,
};
use crate::hud::{validate_hud_move_path, HudTree};
use crate::profile::ProfileError;
use crate::surface::CfgLayer;

/// Why each control cannot be used with `tree`, keyed by control name:
/// operations execs does not support, names the schema uses twice, and
/// edits that do not fit the HUD's files.
pub fn unavailable_controls(schema: &HudSchema, tree: &HudTree) -> BTreeMap<String, String> {
    let mut blocked = crate::hud_schema_compat::unsupported_controls(schema);
    let mut uses = BTreeMap::<&str, usize>::new();
    for control in schema.controls.values().flatten() {
        *uses.entry(control.name.as_str()).or_default() += 1;
    }
    for (name, count) in uses {
        if blocked.contains_key(name) {
            continue;
        }
        if name.is_empty() {
            blocked.insert(
                String::new(),
                "This option has no name in the HUD's schema, so execs cannot save it.".into(),
            );
        } else if count > 1 {
            // A saved value is stored under the name; two controls sharing one
            // would both read and both overwrite it.
            blocked.insert(
                name.to_string(),
                format!("The HUD's schema uses the name {name} for {count} options, so execs cannot tell them apart."),
            );
        }
    }

    let defaults = BTreeMap::new();
    let mut resolver = match expressions::Resolver::new(schema, &defaults, &blocked) {
        Ok(resolver) => resolver,
        Err(error) => {
            // The schema as a whole cannot be read; nothing in it is safe.
            for control in schema.controls.values().flatten() {
                blocked
                    .entry(control.name.clone())
                    .or_insert_with(|| misfit(&error));
            }
            return blocked;
        }
    };
    let folders = move_folders(schema);
    let index: Vec<(String, &String)> = tree
        .files
        .keys()
        .map(|key| (key.to_ascii_lowercase(), key))
        .collect();
    for control in schema.controls.values().flatten() {
        if blocked.contains_key(&control.name) {
            continue;
        }
        if let Err(error) = dry_run(control, tree, &index, &folders, &mut resolver) {
            blocked.insert(control.name.clone(), misfit(&error));
        }
    }
    blocked
}

fn misfit(error: &ProfileError) -> String {
    let reason = match error {
        ProfileError::Io(reason) => reason.clone(),
        other => other.message().to_string(),
    };
    // The engine's advice is for a failed save; here nothing was attempted.
    let reason = reason
        .trim_end_matches(" Reinstall a compatible HUD before retrying.")
        .trim_end_matches('.');
    format!("This option does not fit the installed HUD: {reason}.")
}

/// Every value the pane lets the player pick, starting and ending on the
/// default: both checkbox states, every combo choice. A control that fails on
/// any of them would fail the whole save later.
fn trial_values(control: &HudControl) -> Vec<String> {
    let default = control.value.clone();
    let mut values = vec![default.clone()];
    match normalize_type(&control.control_type) {
        "checkbox" => values.push((!is_truthy(&default)).to_string()),
        "combo" => values.extend(
            control
                .options
                .iter()
                .flatten()
                .map(|choice| choice.value.clone())
                .filter(|value| *value != default),
        ),
        _ => return values,
    }
    values.push(default);
    values
}

fn dry_run(
    control: &HudControl,
    tree: &HudTree,
    index: &[(String, &String)],
    folders: &Result<(Option<String>, Option<String>), ProfileError>,
    resolver: &mut expressions::Resolver,
) -> Result<(), ProfileError> {
    let (custom, enabled) = match folders {
        Ok((custom, enabled)) => (custom.as_deref(), enabled.as_deref()),
        Err(error) if moves_files(control) => return Err(error.clone()),
        Err(_) => (None, None),
    };
    let mut wanted = BTreeSet::new();
    referenced(control, custom, enabled, &mut wanted);
    let mut copy = HudTree::default();
    for (lower, key) in index {
        if wanted.iter().any(|path| {
            lower == path
                || (lower.len() > path.len()
                    && lower.starts_with(path.as_str())
                    && lower.as_bytes()[path.len()] == b'/')
        }) {
            copy.files.insert((*key).clone(), tree.files[*key].clone());
        }
    }
    let mut discarded = Vec::new();
    for value in trial_values(control) {
        let options = BTreeMap::from([(control.name.clone(), value)]);
        let mut resolved = control.clone();
        resolver.resolve(&mut resolved, &options)?;
        apply_control(
            &mut copy,
            &resolved,
            &options,
            custom,
            enabled,
            true,
            CfgLayer::Vanilla,
            &mut discarded,
        )?;
    }
    Ok(())
}

pub(super) fn moves_files(control: &HudControl) -> bool {
    control.file_name.is_some()
        || control.combo_files.is_some()
        || control.combo_directories.is_some()
        || control.options.iter().flatten().any(moves_files)
}

/// Lowercased paths (files or folders) a control and its choices can touch.
fn referenced(
    control: &HudControl,
    custom: Option<&str>,
    enabled: Option<&str>,
    out: &mut BTreeSet<String>,
) {
    let mut add = |path: &str| {
        if let Ok(path) = validate_hud_move_path(path) {
            out.insert(path.to_ascii_lowercase());
        }
    };
    if let Some(files) = control.files.as_ref().and_then(|files| files.as_object()) {
        for path in files.keys() {
            add(path);
        }
    }
    if let Some(rename) = &control.rename_file {
        add(&rename.old_name);
        add(&rename.new_name);
    }
    let moved = control
        .file_name
        .iter()
        .chain(control.combo_files.iter().flatten())
        .chain(control.combo_directories.iter().flatten());
    for file in moved {
        let Ok(file) = validate_hud_move_path(file) else {
            continue;
        };
        for folder in [custom, enabled].into_iter().flatten() {
            add(&format!("{folder}/{file}"));
        }
    }
    for choice in control.options.iter().flatten() {
        referenced(choice, custom, enabled, out);
    }
}

/// Lowercased paths of the files the schema's `Files` edits read. Deciding
/// what fits needs these files' contents and only the names of the rest.
pub fn referenced_hud_files(schema: &HudSchema) -> BTreeSet<String> {
    fn collect(control: &HudControl, out: &mut BTreeSet<String>) {
        if let Some(files) = control.files.as_ref().and_then(|files| files.as_object()) {
            for path in files.keys() {
                if let Ok(path) = validate_hud_move_path(path) {
                    out.insert(path.to_ascii_lowercase());
                }
            }
        }
        for choice in control.options.iter().flatten() {
            collect(choice, out);
        }
    }
    let mut out = BTreeSet::new();
    for control in schema.controls.values().flatten() {
        collect(control, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hud_apply::{
        apply_fitting_hud_options, apply_hud_options, parse_hud_schema, schema_view_for_hud,
    };

    const LAYOUT: &str = "\"Resource/HudLayout.res\"\n{\n\t\"HudDeathNotice\"\n\t{\n\t\t\"MaxDeathNotices\"\t\"4\"\n\t}\n}\n";

    fn tree(files: &[(&str, &str)]) -> HudTree {
        let mut tree = HudTree::default();
        for (path, text) in files {
            tree.insert(*path, text.as_bytes().to_vec());
        }
        tree
    }

    fn schema(controls: &str) -> HudSchema {
        parse_hud_schema(&format!(
            r#"{{"CustomizationsFolder":"custom","EnabledFolder":"custom//on","Controls":{{"Options":[{controls}]}}}}"#
        ))
        .unwrap()
    }

    fn blocked(schema: &HudSchema, tree: &HudTree) -> Vec<String> {
        unavailable_controls(schema, tree).into_keys().collect()
    }

    #[test]
    fn every_section_an_option_edits_has_to_be_in_the_hud() {
        // The first panel is there, and may gain a block; the second is not.
        let schema = schema(
            r#"{"Name":"both","Type":"Checkbox","Value":"false","Files":{"scripts/hudlayout.res":{
                "HudDeathNotice":{"visible":{"true":"1","false":"0"},"if_mvm":{"visible":"0"}},
                "HudAchievementTracker":{"visible":{"true":"1","false":"0"}}}}}"#,
        );
        let reasons = unavailable_controls(&schema, &tree(&[("scripts/hudlayout.res", LAYOUT)]));
        assert_eq!(
            reasons["both"],
            "This option does not fit the installed HUD: scripts/hudlayout.res: no HudAchievementTracker section in this HUD."
        );
    }

    #[test]
    fn an_option_for_a_file_or_section_the_hud_lacks_is_turned_off_alone() {
        let schema = schema(
            r#"{"Name":"rows","Type":"IntegerUpDown","Value":"6","Files":{"scripts/hudlayout.res":{"HudDeathNotice":{"MaxDeathNotices":"$value"}}}},
               {"Name":"chat","Type":"Checkbox","Value":"false","Files":{"resource/ui/basechat.res":{"HudChat":{"ypos":{"true":"30","false":"295"}}}}},
               {"Name":"xhair","Type":"ColorPicker","Value":"1 2 3 255","Files":{"Scripts/HudLayout.res":{"CustomCrosshair":{"fgcolor":"$value"}}}},
               {"Name":"added","Type":"Checkbox","Value":"false","Files":{"scripts/hudlayout.res":{"HudDeathNotice":{"visible":{"true":"1","false":"0"}}}}}"#,
        );
        let original = tree(&[("scripts/hudlayout.res", LAYOUT)]);
        let reasons = unavailable_controls(&schema, &original);
        assert_eq!(
            reasons.keys().collect::<Vec<_>>(),
            ["chat", "xhair"],
            "{reasons:?}"
        );
        assert_eq!(
            reasons["chat"],
            "This option does not fit the installed HUD: resource/ui/basechat.res: not in this HUD."
        );
        assert_eq!(
            reasons["xhair"],
            "This option does not fit the installed HUD: Scripts/HudLayout.res: no CustomCrosshair section in this HUD."
        );
        assert!(reasons.values().all(|reason| !reason.contains('\n')));

        let view = schema_view_for_hud(&schema, &original);
        let shown: Vec<_> = view.sections[0]
            .controls
            .iter()
            .map(|control| (control.name.as_str(), control.unavailable_reason.is_some()))
            .collect();
        assert_eq!(
            shown,
            [
                ("rows", false),
                ("chat", true),
                ("xhair", true),
                ("added", false)
            ]
        );

        // Saving applies what fits and adds no file or section for the rest.
        let mut applied = original.clone();
        let options = BTreeMap::from([
            ("rows".to_string(), "8".to_string()),
            ("added".to_string(), "true".to_string()),
        ]);
        apply_fitting_hud_options(&mut applied, &schema, "anyhud", &options, CfgLayer::Vanilla)
            .unwrap();
        assert_eq!(applied.files.len(), 1);
        let text = std::str::from_utf8(applied.get("scripts/hudlayout.res").unwrap()).unwrap();
        assert!(text.contains("\"MaxDeathNotices\"\t\"8\""), "{text}");
        assert!(text.contains("visible"), "{text}");
        assert!(!text.contains("CustomCrosshair"), "{text}");
    }

    #[test]
    fn the_check_changes_nothing_and_reads_the_same_on_an_already_saved_hud() {
        let schema = schema(
            r#"{"Name":"big","Type":"Checkbox","Value":"false","FileName":"big.res"},
               {"Name":"style","Type":"ComboBox","Value":"a","Options":[
                   {"Label":"A","Value":"a"},
                   {"Label":"B","Value":"b","RenameFile":{"OldName":"styles/b_off/","NewName":"styles/b/"}}]}"#,
        );
        let mut hud = tree(&[
            ("custom/big.res", "x"),
            ("styles/b_off/one.res", "1"),
            ("styles/b_off/two.res", "2"),
        ]);
        let before = hud.clone();
        assert!(blocked(&schema, &hud).is_empty());
        assert_eq!(hud, before);
        let options = BTreeMap::from([
            ("big".to_string(), "true".to_string()),
            ("style".to_string(), "b".to_string()),
        ]);
        apply_hud_options(&mut hud, &schema, "anyhud", &options).unwrap();
        assert!(hud.files.contains_key("custom/on/big.res"));
        assert!(hud.files.contains_key("styles/b/two.res"));
        let saved = hud.clone();
        assert!(blocked(&schema, &hud).is_empty());
        assert_eq!(hud, saved);
    }

    #[test]
    fn moves_whose_files_are_missing_are_turned_off() {
        let schema = schema(
            r#"{"Name":"gone","Type":"Checkbox","Value":"false","FileName":"gone.res"},
               {"Name":"here","Type":"Checkbox","Value":"false","FileName":"here.res"},
               {"Name":"style","Type":"ComboBox","Value":"a","Options":[
                   {"Label":"A","Value":"a","FileName":"a.res"},{"Label":"B","Value":"b","FileName":"b.res"}]}"#,
        );
        let hud = tree(&[("custom/here.res", "x"), ("custom/on/a.res", "a")]);
        let reasons = unavailable_controls(&schema, &hud);
        assert_eq!(reasons.keys().collect::<Vec<_>>(), ["gone", "style"]);
        assert!(reasons["gone"].contains("HUD move source is missing: custom/on/gone.res"));
        assert!(!reasons["gone"].contains("Reinstall"));
        // One missing choice is enough: picking it would fail the save.
        assert!(reasons["style"].contains("custom/b.res"));
    }

    #[test]
    fn unusable_move_folders_turn_off_only_the_options_that_move_files() {
        // An empty EnabledFolder would move files into the HUD's own root.
        let schema = parse_hud_schema(
            r#"{"CustomizationsFolder":"customizations","EnabledFolder":"","Controls":{"Options":[
                {"Name":"alt","Type":"Checkbox","Value":"false","FileName":"alt.res"},
                {"Name":"rows","Type":"IntegerUpDown","Value":"6","Files":{"scripts/hudlayout.res":{"HudDeathNotice":{"MaxDeathNotices":"$value"}}}}]}}"#,
        )
        .unwrap();
        let mut hud = tree(&[
            ("customizations/alt.res", "x"),
            ("scripts/hudlayout.res", LAYOUT),
        ]);
        assert_eq!(blocked(&schema, &hud), ["alt"]);
        let before = hud.clone();
        assert!(apply_hud_options(&mut hud, &schema, "anyhud", &BTreeMap::new()).is_err());
        assert_eq!(hud, before);
        apply_fitting_hud_options(
            &mut hud,
            &schema,
            "anyhud",
            &BTreeMap::new(),
            CfgLayer::Vanilla,
        )
        .unwrap();
        assert!(hud.files.contains_key("customizations/alt.res"));
        assert!(
            String::from_utf8_lossy(hud.get("scripts/hudlayout.res").unwrap())
                .contains("\"MaxDeathNotices\"\t\"6\"")
        );
    }

    #[test]
    fn a_section_inherited_through_base_can_still_be_overridden() {
        let schema = schema(
            r#"{"Name":"xhair","Type":"ColorPicker","Value":"1 2 3 255","Files":{"scripts/hudlayout.res":{"CustomCrosshair":{"fgcolor":"$value"}}}}"#,
        );
        let inheriting = format!("#base \"hudlayout_base.res\"\n{LAYOUT}");
        assert!(blocked(&schema, &tree(&[("scripts/hudlayout.res", &inheriting)])).is_empty());
        assert_eq!(
            blocked(&schema, &tree(&[("scripts/hudlayout.res", LAYOUT)])),
            ["xhair"]
        );
    }

    #[test]
    fn a_broken_reference_or_default_costs_only_its_own_option() {
        let schema = schema(
            r#"{"Name":"size","Type":"IntegerUpDown","Value":"18","Files":{"scripts/hudlayout.res":{"HudDeathNotice":{"font":"Size:$value | Outline:{$missing_outline ? ON : OFF}"}}}},
               {"Name":"pick","Type":"ComboBox","Value":"9","Options":[{"Label":"A","Value":"0"},{"Label":"B","Value":"1"}]},
               {"Name":"rows","Type":"IntegerUpDown","Value":"6","Files":{"scripts/hudlayout.res":{"HudDeathNotice":{"MaxDeathNotices":"$value"}}}}"#,
        );
        let hud = tree(&[("scripts/hudlayout.res", LAYOUT)]);
        let reasons = unavailable_controls(&schema, &hud);
        assert_eq!(reasons.keys().collect::<Vec<_>>(), ["pick", "size"]);
        assert!(reasons["size"].contains("Unknown HUD control reference $missing_outline"));
        assert!(reasons["pick"].contains("Unknown HUD selection"));
        // The whole-schema apply still refuses; the fitting one saves the rest.
        let mut whole = hud.clone();
        assert!(apply_hud_options(&mut whole, &schema, "anyhud", &BTreeMap::new()).is_err());
        let mut fitting = hud.clone();
        apply_fitting_hud_options(
            &mut fitting,
            &schema,
            "anyhud",
            &BTreeMap::new(),
            CfgLayer::Vanilla,
        )
        .unwrap();
        assert!(
            String::from_utf8_lossy(fitting.get("scripts/hudlayout.res").unwrap())
                .contains("\"MaxDeathNotices\"\t\"6\"")
        );
    }

    #[test]
    fn an_invalid_requested_value_is_still_refused_not_skipped() {
        let schema = schema(
            r#"{"Name":"pick","Type":"ComboBox","Value":"0","Options":[{"Label":"A","Value":"0"},{"Label":"B","Value":"1"}]}"#,
        );
        let mut hud = tree(&[("scripts/hudlayout.res", LAYOUT)]);
        assert!(blocked(&schema, &hud).is_empty());
        let bad = BTreeMap::from([("pick".to_string(), "7".to_string())]);
        assert!(
            apply_fitting_hud_options(&mut hud, &schema, "anyhud", &bad, CfgLayer::Vanilla)
                .is_err()
        );
    }

    #[test]
    fn only_the_edited_files_need_their_contents() {
        let schema = schema(
            r#"{"Name":"rows","Type":"IntegerUpDown","Value":"6","Files":{"Scripts\\HudLayout.res":{"HudDeathNotice":{"MaxDeathNotices":"$value"}}}},
               {"Name":"big","Type":"Checkbox","Value":"false","FileName":"fonts"}"#,
        );
        assert_eq!(
            referenced_hud_files(&schema)
                .into_iter()
                .collect::<Vec<_>>(),
            ["scripts/hudlayout.res"]
        );
        // A moved folder is checked by name alone.
        let hud = tree(&[
            ("scripts/hudlayout.res", LAYOUT),
            ("custom/fonts/a.ttf", ""),
        ]);
        assert!(blocked(&schema, &hud).is_empty());
    }
}
