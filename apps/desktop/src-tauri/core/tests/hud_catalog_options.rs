//! Run explicitly against the pinned downloaded audit archives, never a TF2 install.
use std::{collections::BTreeMap, fs, path::PathBuf};

use execs_core::{apply_hud_options, extract_hud_archive, parse_hud_schema, HudSchema, HudTree};

fn fixture(hud: &str) -> (HudTree, HudSchema) {
    let base = PathBuf::from(
        std::env::var_os("EXECS_HUD_AUDIT_FIXTURES").expect("set EXECS_HUD_AUDIT_FIXTURES"),
    );
    let dir = base.join(hud);
    let tree = extract_hud_archive(&fs::read(dir.join("archive.bin")).unwrap())
        .unwrap()
        .tree;
    let mut schema =
        parse_hud_schema(&fs::read_to_string(dir.join("schema.json")).unwrap()).unwrap();
    execs_core::hud_schema_compat::adapt_pinned_schema(hud, &mut schema);
    (tree, schema)
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
    for options in cases {
        let mut tree = original.clone();
        apply_hud_options(&mut tree, &schema, "rayshud", &options)
            .unwrap_or_else(|error| panic!("{options:?}: {error}"));
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
                for item in items {
                    let selected = item[if on { "true" } else { "false" }].as_str().unwrap();
                    let other = item[if on { "false" } else { "true" }].as_str().unwrap();
                    assert!(
                        text.contains(&format!("#base \"{selected}\"")),
                        "{}: {text}",
                        control.name
                    );
                    assert!(
                        !text.contains(&format!("#base \"{other}\"")),
                        "{}: {text}",
                        control.name
                    );
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
