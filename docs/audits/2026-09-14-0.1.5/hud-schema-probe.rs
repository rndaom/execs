//! Read-only real-schema probe. Build in a temporary Cargo project with
//! execs-core as a path dependency and serde_json = "1". Arguments are the
//! pinned schema JSON path and the extracted pinned HUD directory.
use execs_core::{apply_hud_options, hud_tree_from_dir, parse_hud_schema, schema_view};
use std::{collections::BTreeMap, fs, path::Path};

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    assert_eq!(args.len(), 3, "schema.json extracted-hud-directory");
    let raw = fs::read_to_string(&args[1]).unwrap();
    let schema = parse_hud_schema(&raw).unwrap();
    let original = hud_tree_from_dir(Path::new(&args[2])).unwrap().tree;
    let view = schema_view(&schema);
    let mut cases = vec![("defaults".to_string(), BTreeMap::new())];
    for control in view.sections.iter().flat_map(|section| &section.controls) {
        let values = match control.control_type.as_str() {
            "checkbox" => vec!["false".to_string(), "true".to_string()],
            "combo" => control
                .choices
                .iter()
                .map(|choice| choice.value.clone())
                .collect(),
            _ => vec![control.value.clone()],
        };
        for value in values {
            cases.push((
                format!("{}={value}", control.name),
                BTreeMap::from([(control.name.clone(), value)]),
            ));
        }
    }
    let mut result = Vec::new();
    for (case, options) in cases {
        let mut tree = original.clone();
        let applied = apply_hud_options(&mut tree, &schema, "flawhud", &options)
            .unwrap_or_else(|error| panic!("{case}: {}", error.message()));
        let once = tree.clone();
        let second = apply_hud_options(&mut tree, &schema, "flawhud", &options).unwrap();
        assert_eq!(tree, once, "{case}: repeated apply changed bytes");
        assert_eq!(applied, second, "{case}: repeated apply changed cfgs");
        let changed = tree
            .files
            .iter()
            .filter(|(path, bytes)| original.files.get(*path) != Some(*bytes))
            .count();
        let created = tree
            .files
            .keys()
            .filter(|path| !original.files.contains_key(*path))
            .cloned()
            .collect::<Vec<_>>();
        result.push(serde_json::json!({"case": case, "changedFiles": changed, "createdFiles": created, "cfgWrites": applied.cfg_writes.len()}));
    }
    assert_eq!(
        hud_tree_from_dir(Path::new(&args[2])).unwrap().tree,
        original,
        "probe changed source files"
    );
    println!("{}", serde_json::to_string_pretty(&serde_json::json!({
        "sourceFiles": original.files.len(), "schemaSha256": execs_core::hash::sha256_hex(raw.as_bytes()),
        "caseCount": result.len(), "sourceUnchanged": true, "cases": result
    })).unwrap());
}
