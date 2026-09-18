//! Corrections to the pinned TF2HUD.Editor data, not inferred HUD payloads.
use std::collections::BTreeSet;

use crate::hud_apply::{HudControl, HudSchema};
use crate::profile::ProfileError;

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
        assert!(error.to_string().contains("duplicate control name: same"));
        assert!(parse_hud_schema(
            r#"{"Controls":{"A":[{"Name":"unique","Options":[{"Value":"0"},{"Value":"1"}]}]}}"#
        )
        .is_ok());
        assert!(check_catalog_schema("m0rehud")
            .unwrap_err()
            .to_string()
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
