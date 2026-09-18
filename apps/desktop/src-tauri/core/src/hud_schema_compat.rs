//! Corrections to the pinned TF2HUD.Editor data, not inferred HUD payloads.
use std::collections::BTreeSet;

use crate::hud_apply::{HudControl, HudSchema};
use crate::profile::ProfileError;

/// Exact duplicate records from the pinned upstream JSON. Normalize before
/// deserializing (which drops fields used to establish exact provenance), then
/// enforce unique identities normally. Unknown duplicates still fail closed.
pub fn normalize_pinned_duplicates(raw: &mut serde_json::Value) {
    let Some(sections) = raw
        .get_mut("Controls")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };
    for control in sections
        .values_mut()
        .filter_map(serde_json::Value::as_array_mut)
        .flatten()
    {
        if control["Name"] == "rh_toggle_streamer_mode"
            && crate::hash::sha256_hex(control.to_string().as_bytes())
                == "c3e750957f004bf81f9efee85b4b909e49991b817e913ec40c7db8b55d9972e5"
        {
            // The pinned red-list instruction accidentally puts `wide` where
            // `true` belongs and wraps it in labelText. Both installed team
            // lists are SectionedListPanels with width 270.
            control["Files"]["resource/ui/scoreboard.res"]["RedPlayerList"] =
                serde_json::json!({"wide":{"true":"0","false":"270"}});
        }
        if control["Name"] == "rh_toggle_alt_player_model"
            && crate::hash::sha256_hex(control.to_string().as_bytes())
                == "f39fe1988e1787065510f7eb2af4e353fe6f8848ce45c0252f070695f5afe155"
        {
            // This exact pinned record already edits every loaded model/disguise
            // property directly. Its legacy file does not exist in the HUD and
            // the schema declares no customization/enable folders for a move.
            control.as_object_mut().unwrap().remove("FileName");
        }
    }
    for (name, first_hash, second_hash, action) in [
        (
            "rh_toggle_center_class",
            "68e9e9e6637f54784dc270a5024989fd65b4407f1577c005cf3be9958e6b3af3",
            "0875daa4222dfddd2249d342881e421a12bacb1f825cc34de27733edc7220636",
            0,
        ),
        (
            "rh_val_health_style",
            "4ee3ec835169e2dcf8fc45ca416b617f18011749ed380d1d90a158b21ca3f846",
            "1983bcc6774607930eb5ee66628681ab75e823520507aa810a29933ac7e0e0c7",
            1,
        ),
        (
            "kbn_low_ammo_blink_1",
            "21a703ef13066a90c7f3bfcb2c8c7d14ecb3835659eb114a168cd61e6d907f22",
            "4d720a31213fe6a5cfeb35f10a40af91df0bd41a6eec97a8ae0500241f94e203",
            2,
        ),
    ] {
        let records: Vec<_> = sections
            .values()
            .filter_map(serde_json::Value::as_array)
            .flatten()
            .filter(|control| control["Name"] == name)
            .cloned()
            .collect();
        if records.len() != 2 {
            continue;
        }
        let fingerprint =
            |value: &serde_json::Value| crate::hash::sha256_hex(value.to_string().as_bytes());
        let Some(first) = records
            .iter()
            .find(|record| fingerprint(record) == first_hash)
        else {
            continue;
        };
        let Some(second) = records
            .iter()
            .find(|record| fingerprint(record) == second_hash)
        else {
            continue;
        };
        for controls in sections
            .values_mut()
            .filter_map(serde_json::Value::as_array_mut)
        {
            controls.retain_mut(|control| {
                if action == 0 {
                    if control == second {
                        return false;
                    }
                    if control == first {
                        control["Label"] = "Centered class and team select".into();
                        control["Files"]
                            .as_object_mut()
                            .unwrap()
                            .extend(second["Files"].as_object().unwrap().clone());
                    }
                } else if action == 1 && control == first {
                    // The old FileName variants are absent from the current HUD.
                    // Keep the later control that edits the loaded health resource.
                    return false;
                } else if action == 2 && control == second {
                    control["Name"] = "kbn_low_ammo_blink_2".into();
                }
                true
            });
        }
    }
}

pub fn migrate_saved_options(
    hud_id: &str,
    options: &std::collections::BTreeMap<String, String>,
) -> std::collections::BTreeMap<String, String> {
    let mut migrated = options.clone();
    if hud_id.eq_ignore_ascii_case("kbnhud") && !migrated.contains_key("kbn_low_ammo_blink_2") {
        if let Some(value) = options.get("kbn_low_ammo_blink_1") {
            migrated.insert("kbn_low_ammo_blink_2".into(), value.clone());
        }
    }
    migrated
}

pub fn check_catalog_schema(id: &str) -> Result<(), ProfileError> {
    if id.eq_ignore_ascii_case("m0rehud") {
        return Err(ProfileError::Io("The available m0rehud Classic options do not match the catalog's m0rehud files and contain duplicate control names. Use the HUD author's customization instructions. Your saved options are retained; they have not been reapplied.".into()));
    }
    Ok(())
}

pub fn validate_identities(schema: &HudSchema) -> Result<(), ProfileError> {
    let mut names = BTreeSet::new();
    for control in schema.controls.values().flatten() {
        if control.name.is_empty() || !names.insert(&control.name) {
            return Err(ProfileError::Io(format!(
                "The HUD options schema has a missing or duplicate control name: {}. Options were not loaded or applied.", control.name
            )));
        }
    }
    Ok(())
}

pub fn unavailable_reason(control: &HudControl) -> Option<&'static str> {
    if control.write_file.is_some()
        || control.options.as_ref().is_some_and(|options| {
            options
                .iter()
                .any(|option| unavailable_reason(option).is_some())
        })
    {
        Some("This option requires the HUD editor's log-based customization wiring, which execs does not support. Use the HUD author's instructions. Previously saved values are retained but are not applied.")
    } else {
        None
    }
}

/// These two copy/pasted paths are wrong in schema commit
/// 17bccd15d818d12707ce89574318acbc23c85a9f. Match the exact old data before
/// adapting it; unexpected data must not silently receive a guessed rewrite.
pub fn adapt_pinned_schema(id: &str, schema: &mut HudSchema) -> Result<(), ProfileError> {
    check_catalog_schema(id)?;
    validate_identities(schema)?;
    if !id.eq_ignore_ascii_case("kbnhud") {
        return Ok(());
    }
    for (name, path, node, outline) in [
        (
            "kbn_crosshair2_size",
            "^customizations/#crosshairs/crosshairs_hudlayout.res",
            "CustomCrosshair2",
            "kbn_crosshair2_outline",
        ),
        (
            "kbn_hitmarker_size",
            "^customizations/#hitmarkers/hitmarkers_hudlayout.res",
            "HitMarker",
            "kbn_hitmarker_outline",
        ),
    ] {
        let control = schema
            .controls
            .values_mut()
            .flatten()
            .find(|control| control.name == name)
            .ok_or_else(|| {
                ProfileError::Io(format!("The pinned kbnhud schema is missing {name}."))
            })?;
        let font = format!("Size:$value | Outline:{{${outline} ? ON : OFF}}");
        let old = serde_json::json!({"^customizations/#crosshairs/crosshairs_hudlayout.res": {"CustomCrosshair1": {"font": font}}});
        let corrected = serde_json::json!({path: {node: {"font": font}}});
        if control.files.as_ref() != Some(&old) && control.files.as_ref() != Some(&corrected) {
            return Err(ProfileError::Io(format!(
                "The pinned kbnhud target for {name} changed. Options were not applied."
            )));
        }
        control.files = Some(corrected);
    }
    Ok(())
}

pub fn preserve_unavailable_options(
    schema: &HudSchema,
    previous: &std::collections::BTreeMap<String, String>,
    requested: &mut std::collections::BTreeMap<String, String>,
) -> Result<(), ProfileError> {
    for control in schema.controls.values().flatten() {
        if unavailable_reason(control).is_none() {
            continue;
        }
        let stored = previous.get(&control.name).unwrap_or(&control.value);
        if requested
            .get(&control.name)
            .is_some_and(|value| value != stored)
        {
            return Err(ProfileError::Io(format!("{} is unavailable. Its saved value was not changed. Use the HUD author's customization instructions.", control.label)));
        }
        if let Some(value) = previous.get(&control.name) {
            requested.insert(control.name.clone(), value.clone());
        } else {
            requested.remove(&control.name);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        apply_hud_options, parse_hud_schema, schema_file_name, schema_supported, schema_view,
        HudTree,
    };
    use std::collections::BTreeMap;

    #[test]
    fn rayshud_streamer_mode_hides_both_team_lists() {
        let control: serde_json::Value = serde_json::from_str(include_str!(
            "../fixtures/hud-options/rayshud-streamer-mode.json"
        ))
        .unwrap();
        let mut raw = serde_json::json!({"Controls":{"General":[control.clone()]}});
        normalize_pinned_duplicates(&mut raw);
        let files = &raw["Controls"]["General"][0]["Files"];
        assert_eq!(
            files["resource/ui/scoreboard.res"]["RedPlayerList"],
            serde_json::json!({"wide":{"true":"0","false":"270"}})
        );
        let schema = parse_hud_schema(&raw.to_string()).unwrap();
        let mut tree = HudTree::default();
        tree.insert("resource/ui/scoreboard.res",b"\"Resource/UI/Scoreboard.res\" { \"RedPlayerList\" { \"wide\" \"270\" } \"BluePlayerList\" { \"wide\" \"270\" } }".to_vec());
        for enabled in [true, false] {
            apply_hud_options(
                &mut tree,
                &schema,
                "rayshud",
                &BTreeMap::from([("rh_toggle_streamer_mode".into(), enabled.to_string())]),
            )
            .unwrap();
            let map = crate::vdf::parse_hud_vdf(
                std::str::from_utf8(tree.get("resource/ui/scoreboard.res").unwrap()).unwrap(),
            )
            .unwrap();
            let root = map.entries[0].1.as_obj().unwrap();
            for team in ["RedPlayerList", "BluePlayerList"] {
                let panel = root.get(team).unwrap().as_obj().unwrap();
                assert_eq!(
                    panel.get("wide").unwrap().as_str(),
                    Some(if enabled { "0" } else { "270" })
                );
                assert!(panel.get("labelText").is_none());
            }
        }
        let mut changed = serde_json::json!({"Controls":{"General":[control]}});
        changed["Controls"]["General"][0]["Value"] = "true".into();
        normalize_pinned_duplicates(&mut changed);
        assert!(
            changed["Controls"]["General"][0]["Files"]["resource/ui/scoreboard.res"]
                ["RedPlayerList"]
                .get("labelText")
                .is_some()
        );
    }

    #[test]
    fn rayshud_alternate_model_uses_its_direct_resource_instructions() {
        let control: serde_json::Value = serde_json::from_str(include_str!(
            "../fixtures/hud-options/rayshud-alternate-player-model.json"
        ))
        .unwrap();
        let mut raw = serde_json::json!({"Controls":{"General":[control.clone()]}});
        normalize_pinned_duplicates(&mut raw);
        assert!(raw["Controls"]["General"][0].get("FileName").is_none());
        assert_eq!(raw["Controls"]["General"][0]["Files"], control["Files"]);
        let schema = parse_hud_schema(&raw.to_string()).unwrap();
        let mut tree = HudTree::default();
        tree.insert(
            "scripts/hudlayout.res",
            b"\"Resource/HudLayout.res\" {}".to_vec(),
        );
        tree.insert(
            "resource/ui/hudplayerclass.res",
            b"\"Resource/UI/HudPlayerClass.res\" {}".to_vec(),
        );
        for enabled in [true, false] {
            apply_hud_options(
                &mut tree,
                &schema,
                "rayshud",
                &BTreeMap::from([("rh_toggle_alt_player_model".into(), enabled.to_string())]),
            )
            .unwrap();
            let parsed = crate::vdf::parse_hud_vdf(
                std::str::from_utf8(tree.get("resource/ui/hudplayerclass.res").unwrap()).unwrap(),
            )
            .unwrap();
            let root = parsed.entries[0].1.as_obj().unwrap();
            assert_eq!(
                root.get("classmodelpanel")
                    .unwrap()
                    .as_obj()
                    .unwrap()
                    .get("xpos")
                    .unwrap()
                    .as_str(),
                Some(if enabled { "0" } else { "r210" })
            );
        }
        let mut changed = serde_json::json!({"Controls":{"General":[control]}});
        changed["Controls"]["General"][0]["FileName"] = "different.res".into();
        normalize_pinned_duplicates(&mut changed);
        assert_eq!(
            changed["Controls"]["General"][0]["FileName"],
            "different.res"
        );
    }

    #[test]
    #[ignore = "requires the pinned downloaded schema corpus, EXECS_HUD_SCHEMA_CORPUS"]
    fn all_supported_pinned_schemas_have_valid_normalized_identities() {
        let corpus = std::path::PathBuf::from(
            std::env::var_os("EXECS_HUD_SCHEMA_CORPUS").expect("schema corpus directory"),
        );
        for id in ["rayshud", "kbnhud", "budhud", "flawhud", "hypnotizehud"] {
            let raw = std::fs::read_to_string(corpus.join(id).join("schema.json")).unwrap();
            let mut schema =
                parse_hud_schema(&raw).unwrap_or_else(|error| panic!("{id}: {}", error.message()));
            adapt_pinned_schema(id, &mut schema).unwrap();
            validate_identities(&schema).unwrap();
        }
        assert!(check_catalog_schema("m0rehud").is_err());
    }

    #[test]
    fn exact_pinned_duplicate_fragments_normalize_before_identity_validation() {
        let raw = include_str!("../fixtures/hud-options/rayshud-duplicate-controls.json");
        let schema = parse_hud_schema(raw).unwrap();
        let controls: Vec<_> = schema.controls.values().flatten().collect();
        assert_eq!(controls.len(), 2);
        let centered = controls
            .iter()
            .find(|c| c.name == "rh_toggle_center_class")
            .unwrap();
        assert_eq!(centered.label, "Centered class and team select");
        assert_eq!(
            centered.files.as_ref().unwrap().as_object().unwrap().len(),
            2
        );
        let health = controls
            .iter()
            .find(|c| c.name == "rh_val_health_style")
            .unwrap();
        for choice in health.options.as_ref().unwrap() {
            assert!(choice.file_name.is_none());
            assert!(choice
                .files
                .as_ref()
                .unwrap()
                .get("resource/ui/hudplayerhealth.res")
                .is_some());
        }
        // Hash matching must reject a changed upstream record, not bless a name.
        assert!(parse_hud_schema(&raw.replace("Centered Team Select", "Changed")).is_err());

        let kbn = parse_hud_schema(include_str!(
            "../fixtures/hud-options/kbnhud-duplicate-controls.json"
        ))
        .unwrap();
        let controls = &kbn.controls["kbn_low_ammo_blink_1"];
        assert_eq!(controls[0].name, "kbn_low_ammo_blink_1");
        assert_eq!(controls[1].name, "kbn_low_ammo_blink_2");
        assert_eq!(controls[0].value, "255 0 0 255");
        assert_eq!(controls[1].value, "255 100 100 255");
        let old = BTreeMap::from([("kbn_low_ammo_blink_1".into(), "1 2 3 255".into())]);
        let mut migrated = migrate_saved_options("kbnhud", &old);
        assert_eq!(migrated["kbn_low_ammo_blink_2"], "1 2 3 255");
        migrated.insert("kbn_low_ammo_blink_2".into(), "4 5 6 255".into());
        assert_eq!(migrate_saved_options("kbnhud", &migrated), migrated);
        assert!(migrate_saved_options("kbnhud", &BTreeMap::new()).is_empty());
    }

    #[test]
    fn catalog_and_stored_hypnotize_ids_share_the_schema() {
        for id in ["hypnotizehud", "hypnotize-hud", "HypnotizeHUD"] {
            assert!(schema_supported(id));
            assert_eq!(schema_file_name(id), Some("hypnotize-hud.json"));
        }
    }

    #[test]
    fn duplicate_top_level_ids_refuse_but_unnamed_choices_are_valid() {
        let error =
            parse_hud_schema(r#"{"Controls":{"A":[{"Name":"same"}],"B":[{"Name":"same"}]}}"#)
                .unwrap_err();
        assert!(error.message().contains("duplicate control name: same"));
        assert!(parse_hud_schema(
            r#"{"Controls":{"A":[{"Name":"unique","Options":[{"Value":"0"},{"Value":"1"}]}]}}"#
        )
        .is_ok());
        assert!(check_catalog_schema("m0rehud")
            .unwrap_err()
            .message()
            .contains("do not match"));
    }

    #[test]
    fn log_controls_are_visible_unavailable_and_cannot_mutate_tree_or_saved_values() {
        let schema = parse_hud_schema(r#"{"Controls":{"Crosshair":[{"Name":"crosshair","Label":"Crosshair","Type":"Checkbox","Value":"false","WriteFile":{"FileName":"unused.txt","TrueText":"enabled","FalseText":""}}]}}"#).unwrap();
        assert!(schema_view(&schema).sections[0].controls[0]
            .unavailable_reason
            .is_some());
        let mut tree = HudTree::default();
        tree.insert("scripts/hudlayout.res", b"untouched".to_vec());
        let previous = BTreeMap::from([("crosshair".into(), "true".into())]);
        let mut unchanged = previous.clone();
        preserve_unavailable_options(&schema, &previous, &mut unchanged).unwrap();
        let applied = apply_hud_options(&mut tree, &schema, "flawhud", &unchanged).unwrap();
        assert!(applied.cfg_writes.is_empty());
        assert_eq!(tree.files.len(), 1);
        assert_eq!(tree.files["scripts/hudlayout.res"], b"untouched");
        let mut omitted = BTreeMap::new();
        preserve_unavailable_options(&schema, &previous, &mut omitted).unwrap();
        assert_eq!(omitted, previous);
        let mut changed = BTreeMap::from([("crosshair".into(), "false".into())]);
        assert!(preserve_unavailable_options(&schema, &previous, &mut changed).is_err());
    }

    #[test]
    fn pinned_kbn_target_corrections_are_independent_and_idempotent() {
        let mut controls = Vec::new();
        for (name, outline) in [
            ("kbn_crosshair2_size", "kbn_crosshair2_outline"),
            ("kbn_hitmarker_size", "kbn_hitmarker_outline"),
        ] {
            controls.push(serde_json::json!({"Name":name,"Type":"IntegerUpDown","Value":"15","Files":{"^customizations/#crosshairs/crosshairs_hudlayout.res":{"CustomCrosshair1":{"font":format!("Size:$value | Outline:{{${outline} ? ON : OFF}}")}}}}));
        }
        let mut schema =
            parse_hud_schema(&serde_json::json!({"Controls":{"Sizes": controls}}).to_string())
                .unwrap();
        adapt_pinned_schema("kbnhud", &mut schema).unwrap();
        let once = schema.clone();
        adapt_pinned_schema("kbnhud", &mut schema).unwrap();
        assert_eq!(schema, once);
        let cross = schema.controls["Sizes"][0].files.as_ref().unwrap();
        let hit = schema.controls["Sizes"][1].files.as_ref().unwrap();
        assert_eq!(
            cross["^customizations/#crosshairs/crosshairs_hudlayout.res"]["CustomCrosshair2"]
                ["font"],
            "Size:$value | Outline:{$kbn_crosshair2_outline ? ON : OFF}"
        );
        assert_eq!(
            hit["^customizations/#hitmarkers/hitmarkers_hudlayout.res"]["HitMarker"]["font"],
            "Size:$value | Outline:{$kbn_hitmarker_outline ? ON : OFF}"
        );
        schema.controls.get_mut("Sizes").unwrap()[0].files = None;
        assert!(adapt_pinned_schema("kbnhud", &mut schema).is_err());
    }
}
