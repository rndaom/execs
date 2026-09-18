//! Opt-in regression against downloaded, unmodified HUD archives and pinned
//! TF2HUD.Editor schemas. EXECS_HUD_AUDIT_FIXTURES names a directory containing
//! {kbnhud,hypnotizehud}/{archive.bin,schema.json}; no player files are used.
use std::{collections::BTreeMap, fs, path::PathBuf};

use execs_core::vdf::{parse_hud_vdf, VdfMap};
use execs_core::{apply_hud_options, extract_hud_archive, parse_hud_schema, HudTree};

fn resource(tree: &HudTree, path: &str) -> VdfMap {
    let bytes = tree
        .files
        .get(path)
        .unwrap_or_else(|| panic!("missing {path}"));
    let text = std::str::from_utf8(bytes)
        .unwrap()
        .trim_start_matches('\u{feff}');
    parse_hud_vdf(text).unwrap_or_else(|err| panic!("{path}: {err}"))
}

fn element_font(map: &VdfMap, element: &str) -> Option<String> {
    if let Some(font) = map
        .get(element)
        .and_then(|v| v.as_obj())
        .and_then(|v| v.get("font"))
        .and_then(|v| v.as_str())
    {
        return Some(font.to_owned());
    }
    map.entries
        .iter()
        .filter_map(|(_, value)| value.as_obj())
        .find_map(|child| element_font(child, element))
}

fn defines_font(map: &VdfMap, font: &str) -> bool {
    map.get("Fonts")
        .and_then(|value| value.as_obj())
        .and_then(|fonts| fonts.get(font))
        .and_then(|value| value.as_obj())
        .is_some()
        || map
            .entries
            .iter()
            .filter_map(|(_, value)| value.as_obj())
            .any(|child| defines_font(child, font))
}

#[test]
#[ignore = "requires downloaded pinned HUD archives; set EXECS_HUD_AUDIT_FIXTURES"]
fn real_font_templates_reapply_and_resolve_to_declared_fonts() {
    let base = PathBuf::from(
        std::env::var_os("EXECS_HUD_AUDIT_FIXTURES").expect("set EXECS_HUD_AUDIT_FIXTURES"),
    );
    for (hud, cases, font_path) in [
        (
            "kbnhud",
            vec![
                (
                    "kbn_crosshair1_size",
                    "kbn_crosshair1_outline",
                    "^customizations/#crosshairs/crosshairs_hudlayout.res",
                    "CustomCrosshair1",
                ),
                (
                    "kbn_crosshair2_size",
                    "kbn_crosshair2_outline",
                    "^customizations/#crosshairs/crosshairs_hudlayout.res",
                    "CustomCrosshair2",
                ),
                (
                    "kbn_hitmarker_size",
                    "kbn_hitmarker_outline",
                    "^customizations/#hitmarkers/hitmarkers_hudlayout.res",
                    "HitMarker",
                ),
            ],
            "resource/scheme/xhairfonts_clientscheme.res",
        ),
        (
            "hypnotizehud",
            vec![(
                "hh_val_xhair_size",
                "hh_val_xhair_outline",
                "customizations/crosshairs_and_hitmarker.res",
                "CustomCrosshair",
            )],
            "resource/scheme/crosshairs.res",
        ),
    ] {
        let dir = base.join(hud);
        let original = extract_hud_archive(&fs::read(dir.join("archive.bin")).unwrap())
            .unwrap()
            .tree;
        let mut schema =
            parse_hud_schema(&fs::read_to_string(dir.join("schema.json")).unwrap()).unwrap();
        execs_core::hud_schema_compat::adapt_pinned_schema(hud, &mut schema);
        let mut tree = original.clone();
        let mut options = BTreeMap::new();
        apply_hud_options(&mut tree, &schema, hud, &options).unwrap();
        for (size, outline, path, element) in &cases {
            let default = schema
                .controls
                .values()
                .flatten()
                .find(|control| control.name == *size)
                .unwrap();
            let font = element_font(&resource(&tree, path), element).unwrap();
            assert_eq!(
                font,
                format!("Size:{} | Outline:OFF", default.value),
                "{hud} {element}"
            );
            assert!(
                defines_font(&resource(&tree, font_path), &font),
                "undefined font: {hud} {font}"
            );
            for (new_size, on) in [(24, false), (24, true), (12, true), (12, false)] {
                options.insert((*size).to_owned(), new_size.to_string());
                options.insert((*outline).to_owned(), on.to_string());
                apply_hud_options(&mut tree, &schema, hud, &options).unwrap();
                let font = element_font(&resource(&tree, path), element).unwrap();
                assert_eq!(
                    font,
                    format!(
                        "Size:{new_size} | Outline:{}",
                        if on { "ON" } else { "OFF" }
                    )
                );
                assert!(
                    defines_font(&resource(&tree, font_path), &font),
                    "undefined font: {hud} {font}"
                );
                assert!(!font.contains('$'));
                let before = tree.clone();
                apply_hud_options(&mut tree, &schema, hud, &options).unwrap();
                assert_eq!(tree, before, "non-idempotent {hud} {element}");
            }
        }
    }
}
