//! Run explicitly against the pinned downloaded audit archives, never a TF2 install.
use std::{collections::BTreeMap, fs, path::PathBuf};

use execs_core::{apply_hud_options, extract_hud_archive, parse_hud_schema, HudSchema, HudTree};

fn fixture_checked(hud: &str) -> Result<(HudTree, HudSchema), String> {
    let base = PathBuf::from(
        std::env::var_os("EXECS_HUD_AUDIT_FIXTURES").expect("set EXECS_HUD_AUDIT_FIXTURES"),
    );
    let dir = base.join(hud);
    let bytes = fs::read(dir.join("archive.bin")).map_err(|error| error.to_string())?;
    let tree = extract_hud_archive(&bytes)
        .map_err(|error| error.message().to_string())?
        .tree;
    let raw = fs::read_to_string(dir.join("schema.json")).map_err(|error| error.to_string())?;
    let mut schema = parse_hud_schema(&raw).map_err(|error| error.message().to_string())?;
    execs_core::hud_schema_compat::adapt_pinned_schema(hud, &mut schema)
        .map_err(|error| error.message().to_string())?;
    Ok((tree, schema))
}

fn fixture(hud: &str) -> (HudTree, HudSchema) {
    fixture_checked(hud).unwrap_or_else(|error| panic!("{hud}: {error}"))
}

/// C3 compatibility triage uses the same parsed schema, extracted archive and
/// first-party apply path as the supported HUD fixtures above. Its output is a
/// scoped report: a parsed schema alone is insufficient to enable a catalog ID.
#[test]
#[ignore = "requires pinned HUD archives; set EXECS_HUD_AUDIT_FIXTURES"]
fn omitted_catalog_schema_file_operation_triage() {
    for hud in ["berryhud", "eve-plus", "hexhud", "hud-fixes", "sunsethud"] {
        let (original, schema) = match fixture_checked(hud) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("{hud}: archive/schema could not be applied: {error}");
                continue;
            }
        };
        let mut default = original.clone();
        let Ok(default_result) = apply_hud_options(&mut default, &schema, hud, &BTreeMap::new())
        else {
            let error =
                apply_hud_options(&mut default, &schema, hud, &BTreeMap::new()).unwrap_err();
            eprintln!("{hud}: default apply refused: {}", error.message());
            continue;
        };
        let mut checked = 0;
        let mut refused = Vec::new();
        let mut unchanged = Vec::new();
        for control in schema.controls.values().flatten() {
            if execs_core::hud_schema_compat::unavailable_reason(control).is_some() {
                continue;
            }
            let alternatives: Vec<String> = match control.control_type.to_ascii_lowercase().as_str()
            {
                "checkbox" => vec![(!matches!(control.value.as_str(), "true" | "1")).to_string()],
                "combobox" => control
                    .options
                    .iter()
                    .flatten()
                    .map(|choice| choice.value.clone())
                    .collect(),
                "colorpicker" => vec!["17 91 203 127".into()],
                "crosshair" | "customcrosshair" => {
                    vec![if control.value == "Z" { "A" } else { "Z" }.into()]
                }
                "number" | "integer" | "integerupdown" => control
                    .value
                    .parse::<i32>()
                    .ok()
                    .map(|value| vec![(value + 1).to_string()])
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            for value in alternatives
                .into_iter()
                .filter(|value| value != &control.value)
            {
                checked += 1;
                let options = BTreeMap::from([(control.name.clone(), value.clone())]);
                let mut tree = original.clone();
                match apply_hud_options(&mut tree, &schema, hud, &options) {
                    Err(error) => {
                        refused.push(format!("{}={value}: {}", control.name, error.message()))
                    }
                    Ok(result) => {
                        if tree == default && result == default_result {
                            unchanged.push(format!("{}={value}", control.name));
                        }
                        let once = tree.clone();
                        if let Err(error) = apply_hud_options(&mut tree, &schema, hud, &options) {
                            refused.push(format!(
                                "{}={value} reapply: {}",
                                control.name,
                                error.message()
                            ));
                        } else if tree != once {
                            refused.push(format!("{}={value} is not idempotent", control.name));
                        }
                    }
                }
            }
        }
        eprintln!(
            "{hud}: checked {checked} alternatives, {} refused, {} had no file/cfg effect",
            refused.len(),
            unchanged.len()
        );
        for issue in refused.iter().chain(unchanged.iter()) {
            eprintln!("  {issue}");
        }
        assert!(checked > 0, "{hud} had no testable alternatives");
        if hud == "eve-plus" {
            assert!(
                refused.is_empty(),
                "e.v.e Plus has failing schema operations: {refused:?}"
            );
            assert!(
                unchanged.is_empty(),
                "e.v.e Plus has no-op controls: {unchanged:?}"
            );
        }
    }
}

#[test]
#[ignore = "requires pinned HUD archives; set EXECS_HUD_AUDIT_FIXTURES"]
fn flawhud_full_schema_applies_supported_choices_without_log_files() {
    let (original, schema) = fixture("flawhud");
    let mut cases = vec![BTreeMap::new()];
    let mut log_files = Vec::new();
    for control in schema.controls.values().flatten() {
        if let Some(write) = &control.write_file {
            log_files.push(write.file_name.clone());
        }
        if execs_core::hud_schema_compat::unavailable_reason(control).is_some() {
            continue;
        }
        let mut values = vec![control.value.clone()];
        match control.control_type.to_ascii_lowercase().as_str() {
            "checkbox" => values.extend(["true".into(), "false".into()]),
            "combobox" => values.extend(
                control
                    .options
                    .iter()
                    .flatten()
                    .map(|option| option.value.clone()),
            ),
            "colorpicker" => values.push("17 91 203 127".into()),
            _ => {}
        }
        values.sort();
        values.dedup();
        cases.extend(
            values
                .into_iter()
                .map(|value| BTreeMap::from([(control.name.clone(), value)])),
        );
    }
    assert!(!log_files.is_empty());
    assert!(cases.len() > 20);
    eprintln!(
        "FlawHUD: {} full-schema default/alternate cases",
        cases.len()
    );
    for options in cases {
        let mut tree = original.clone();
        apply_hud_options(&mut tree, &schema, "flawhud", &options)
            .unwrap_or_else(|error| panic!("{options:?}: {error:?}"));
        for file in &log_files {
            assert_eq!(
                tree.get(file),
                original.get(file),
                "unexpected log file {file}"
            );
        }
        let once = tree.clone();
        apply_hud_options(&mut tree, &schema, "flawhud", &options).unwrap();
        assert_eq!(tree, once, "{options:?}");
    }
}

#[test]
#[ignore = "requires pinned HUD archives; set EXECS_HUD_AUDIT_FIXTURES"]
fn rayshud_full_schema_default_and_alternate_controls_preserve_legacy_comment() {
    let (original, schema) = fixture("rayshud");
    let path = "resource/scheme/clientscheme_colors.res";
    let comment = original
        .get(path)
        .unwrap()
        .split(|byte| *byte == b'\n')
        .find(|line| line.contains(&0xdc))
        .expect("actual legacy rayshud comment")
        .to_vec();
    let mut cases = vec![BTreeMap::new()];
    for control in schema.controls.values().flatten() {
        let mut values = vec![control.value.clone()];
        match control.control_type.to_ascii_lowercase().as_str() {
            "checkbox" => values.extend(["true".into(), "false".into()]),
            "combobox" => values.extend(
                control
                    .options
                    .iter()
                    .flatten()
                    .map(|option| option.value.clone()),
            ),
            "colorpicker" => values.push("17 91 203 127".into()),
            _ => {}
        }
        values.sort();
        values.dedup();
        cases.extend(
            values
                .into_iter()
                .map(|value| BTreeMap::from([(control.name.clone(), value)])),
        );
    }
    assert!(cases.len() >= 79);
    eprintln!(
        "rayshud: {} full-schema default/alternate cases",
        cases.len()
    );
    for options in cases {
        let mut tree = original.clone();
        apply_hud_options(&mut tree, &schema, "rayshud", &options)
            .unwrap_or_else(|error| panic!("{options:?}: {error:?}"));
        assert!(tree
            .get(path)
            .unwrap()
            .windows(comment.len())
            .any(|bytes| bytes == comment));
        let once = tree.clone();
        apply_hud_options(&mut tree, &schema, "rayshud", &options).unwrap();
        assert_eq!(tree, once, "{options:?}");
    }
}

#[test]
#[ignore = "requires pinned HUD archives; set EXECS_HUD_AUDIT_FIXTURES"]
fn hypnotize_checkbox_bases_apply_both_states_in_full_schema() {
    let (original, schema) = fixture("hypnotizehud");
    let mut tested = 0;
    for control in schema.controls.values().flatten() {
        let Some(files) = control.files.as_ref().and_then(|files| files.as_object()) else {
            continue;
        };
        for (path, patch) in files {
            let Some(items) = patch.get("#base").and_then(|base| base.as_array()) else {
                continue;
            };
            for on in [true, false] {
                let mut tree = original.clone();
                let options = BTreeMap::from([(control.name.clone(), on.to_string())]);
                apply_hud_options(&mut tree, &schema, "hypnotizehud", &options).unwrap();
                let text = std::str::from_utf8(tree.get(path).unwrap()).unwrap();
                let parsed = execs_core::vdf::parse_hud_vdf(text).unwrap();
                let active_bases: Vec<&str> = parsed
                    .entries
                    .iter()
                    .filter(|(key, _)| key.eq_ignore_ascii_case("#base"))
                    .filter_map(|(_, value)| value.as_str())
                    .collect();
                for item in items {
                    let selected = item[if on { "true" } else { "false" }].as_str().unwrap();
                    let other = item[if on { "false" } else { "true" }].as_str().unwrap();
                    assert!(active_bases.contains(&selected), "{}: {text}", control.name);
                    assert!(!active_bases.contains(&other), "{}: {text}", control.name);
                }
                let once = tree.clone();
                apply_hud_options(&mut tree, &schema, "hypnotizehud", &options).unwrap();
                assert_eq!(tree, once);
                tested += 1;
            }
        }
    }
    assert_eq!(tested, 12);
}

#[test]
#[ignore = "requires pinned HUD archives; set EXECS_HUD_AUDIT_FIXTURES"]
fn budhud_youtuber_directory_choices_round_trip_payloads() {
    let (mut tree, schema) = fixture("budhud");
    let control = schema
        .controls
        .values()
        .flatten()
        .find(|control| control.name == "bh_youtuber_select")
        .unwrap()
        .clone();
    let original = tree.clone();
    let mut isolated = schema.clone();
    isolated.controls = BTreeMap::from([("Users".into(), vec![control.clone()])]);
    for choice in control.options.iter().flatten() {
        apply_hud_options(
            &mut tree,
            &isolated,
            "imported-budhud",
            &BTreeMap::from([(control.name.clone(), choice.value.clone())]),
        )
        .unwrap();
        if let Some(rename) = &choice.rename_file {
            let from = rename.old_name.replace('\\', "/");
            let to = rename.new_name.replace('\\', "/");
            for (path, bytes) in &original.files {
                if let Some(suffix) = path.strip_prefix(&from) {
                    assert_eq!(tree.get(&format!("{to}{suffix}")), Some(bytes.as_slice()));
                    assert!(tree.get(path).is_none());
                }
            }
        }
    }
    apply_hud_options(
        &mut tree,
        &isolated,
        "imported-budhud",
        &BTreeMap::from([(control.name.clone(), control.value.clone())]),
    )
    .unwrap();
    assert_eq!(tree, original);
}
