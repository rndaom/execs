//! How many of each editor schema's options fit the HUD hud-db pins, checked
//! against the downloaded archives and never a TF2 install.
use std::{fs, path::PathBuf};

use execs_core::hud_schema_compat::parse_schema_file;
use execs_core::{apply_fitting_hud_options, extract_hud_archive, unavailable_controls};

/// HUD id, its schema file, options in the schema, options that fit.
const EXPECTED: &[(&str, &str, usize, usize)] = &[
    ("rayshud", "rayshud.json", 53, 49),
    ("budhud", "budhud.json", 58, 56),
    ("flawhud", "flawhud.json", 53, 32),
    ("eve-plus", "eve-plus.json", 45, 44),
    ("kbnhud", "kbnhud.json", 68, 68),
    ("hypnotizehud", "hypnotize-hud.json", 40, 40),
    ("hexhud", "hexhud.json", 37, 1),
    ("sunsethud", "sunsethud.json", 36, 32),
    ("darhud", "darhud.json", 25, 7),
    ("hud-fixes", "hud-fixes.json", 35, 0),
    ("improved-default-hud", "idhud.json", 18, 17),
    ("m0rehud", "m0rehud-classic.json", 48, 26),
    ("ahud-cc", "shared-hud.json", 24, 23),
    ("broesel-hud", "shared-hud.json", 24, 23),
    ("clip-hud", "shared-hud.json", 24, 19),
    ("omp-hud", "shared-hud.json", 24, 23),
];

#[test]
#[ignore = "requires pinned HUD archives; set EXECS_HUD_AUDIT_FIXTURES"]
fn pinned_catalog_huds_keep_the_options_that_fit_their_files() {
    let base = PathBuf::from(
        std::env::var_os("EXECS_HUD_AUDIT_FIXTURES").expect("set EXECS_HUD_AUDIT_FIXTURES"),
    );
    let verbose = std::env::var_os("EXECS_HUD_FIT_REASONS").is_some();
    let mut wrong = Vec::new();
    for (hud, file, total, available) in EXPECTED {
        let dir = base.join(hud);
        let tree = extract_hud_archive(&fs::read(dir.join("archive.bin")).unwrap())
            .unwrap_or_else(|error| panic!("{hud}: {}", error.message()))
            .tree;
        let raw = fs::read_to_string(dir.join("schema.json")).unwrap();
        let schema = parse_schema_file(file, &raw)
            .unwrap_or_else(|error| panic!("{hud}: {}", error.message()));
        let blocked = unavailable_controls(&schema, &tree);
        let controls: Vec<_> = schema.controls.values().flatten().collect();
        let fits = controls
            .iter()
            .filter(|control| !blocked.contains_key(&control.name))
            .count();
        eprintln!("{hud} ({file}): {fits} of {} options fit", controls.len());
        if verbose {
            for (name, reason) in &blocked {
                eprintln!("  {name}: {reason}");
            }
        }
        // Saving the defaults must work for every HUD that has options, and
        // saving them twice must change nothing more.
        let mut applied = tree.clone();
        let layer = execs_core::surface::CfgLayer::Vanilla;
        let options = std::collections::BTreeMap::new();
        let first = apply_fitting_hud_options(&mut applied, &schema, hud, &options, layer)
            .unwrap_or_else(|error| panic!("{hud}: {}", error.message()));
        let once = applied.clone();
        let second = apply_fitting_hud_options(&mut applied, &schema, hud, &options, layer)
            .unwrap_or_else(|error| panic!("{hud} again: {}", error.message()));
        assert!(
            applied == once && first == second,
            "{hud} is not idempotent"
        );
        if (controls.len(), fits) != (*total, *available) {
            wrong.push(format!(
                "{hud}: expected {available} of {total}, found {fits} of {}",
                controls.len()
            ));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}
