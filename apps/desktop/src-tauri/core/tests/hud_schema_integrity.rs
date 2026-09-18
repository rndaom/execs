//! First-party disposable HUDs exercise the same library/live transaction as
//! the IPC command. No Steam discovery, network or real profile paths.
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use execs_core::hud::install_hud_pack_to;
use execs_core::profile::{create_profile_record_to, load_manifest, set_active_profile_to};
use execs_core::{apply_schema_options_to, parse_hud_schema, HudRecord, HudSource, HudTree};

const SCHEMA: &str = include_str!("../fixtures/hud-options/schema.json");
const ANIMATION: &str = "scripts/hudanimations_custom.txt";
const RESOURCE: &str = "resource/ui/huditemeffectmeter_killstreak.res";

struct Fixture {
    base: PathBuf,
    root: PathBuf,
    profiles: PathBuf,
    id: String,
}

impl Fixture {
    fn new() -> Self {
        // Rust's integration-test executable has no packaged longPathAware
        // manifest. Leave room for the transaction's staging path on Windows.
        let base = std::env::temp_dir().join(format!(
            "execs-hs-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..12]
        ));
        let root = base.join("game");
        let profiles = base.join("profiles");
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::write(root.join("tf/steam.inf"), b"appID=440\n").unwrap();
        let library =
            create_profile_record_to(&profiles, &root, "Fixture", Vec::<String>::new()).unwrap();
        let id = library.profiles[0].id.clone();
        set_active_profile_to(&profiles, &root, &id, Vec::<String>::new()).unwrap();
        let mut tree = HudTree::default();
        tree.insert(
            "info.vdf",
            b"\"fixture\" { \"ui_version\" \"3\" }\n".to_vec(),
        );
        tree.insert(
            ANIMATION,
            include_bytes!("../fixtures/hud-options/hudanimations_custom.txt").to_vec(),
        );
        tree.insert(
            RESOURCE,
            include_bytes!("../fixtures/hud-options/huditemeffectmeter_killstreak.res").to_vec(),
        );
        let record = HudRecord {
            id: "fixture-hud".into(),
            hash: None,
            source: HudSource::Local,
            options: BTreeMap::new(),
        };
        install_hud_pack_to(&profiles, &root, &id, &tree, record, Vec::<String>::new()).unwrap();
        Self {
            base,
            root,
            profiles,
            id,
        }
    }

    fn snapshot(&self) -> BTreeMap<PathBuf, Vec<u8>> {
        fn visit(root: &Path, path: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
            for entry in fs::read_dir(path).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    visit(root, &path, out);
                } else {
                    out.insert(
                        path.strip_prefix(root).unwrap().to_path_buf(),
                        fs::read(path).unwrap(),
                    );
                }
            }
        }
        let mut out = BTreeMap::new();
        visit(&self.base, &self.base, &mut out);
        out
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert_eq!(self.base.parent(), Some(std::env::temp_dir().as_path()));
        let _ = fs::remove_dir_all(&self.base);
    }
}

#[test]
fn hud_options_publish_identical_library_live_bytes_and_reapply_idempotently() {
    let fixture = Fixture::new();
    let schema = parse_hud_schema(SCHEMA).unwrap();
    let options = BTreeMap::from([
        ("fh_toggle_disguise_image".into(), "true".into()),
        ("fh_val_hud_style".into(), "true".into()),
        ("fh_val_health_style".into(), "1".into()),
    ]);
    for _ in 0..2 {
        apply_schema_options_to(
            &fixture.profiles,
            &fixture.root,
            &fixture.id,
            &schema,
            options.clone(),
            Vec::<String>::new(),
        )
        .unwrap();
        let manifest = load_manifest(&fixture.profiles, &fixture.id).unwrap();
        assert_eq!(manifest.hud.unwrap().options, options);
        for file in manifest.files {
            let library = execs_core::profile::exclusive_file_path(
                &fixture.profiles,
                &fixture.id,
                &file.path,
            );
            let stored = fs::read(library).unwrap();
            assert_eq!(fs::read(fixture.root.join(&file.path)).unwrap(), stored);
            assert_eq!(execs_core::hash::sha256_hex(&stored), file.sha256);
        }
    }
    let animation =
        fs::read_to_string(fixture.root.join("tf/custom/fixture-hud").join(ANIMATION)).unwrap();
    assert!(animation.contains("\t//Animate\tPlayerStatusSpyOutlineImage"));
    assert!(animation.contains("\tRunEvent FixtureBox 0.5"));
    let resource =
        fs::read_to_string(fixture.root.join("tf/custom/fixture-hud").join(RESOURCE)).unwrap();
    assert!(resource.contains("\"r100\""));
    assert!(resource.contains("\"labelText\" \"\\\""));
}

#[test]
fn late_schema_errors_leave_every_library_live_cfg_and_manifest_byte_unchanged() {
    let fixture = Fixture::new();
    for invalid in [
        serde_json::json!({"scripts/hudanimations_custom.txt": {"unsupported": []}}),
        serde_json::json!({"resource/ui/huditemeffectmeter_killstreak.res": {"StreakIcon": {"labelText": "unsafe\"quote"}}}),
        serde_json::json!({"../escape.res": {"Value": "1"}}),
    ] {
        let mut raw: serde_json::Value = serde_json::from_str(SCHEMA).unwrap();
        raw["Controls"]["Customizations"].as_array_mut().unwrap().push(serde_json::json!({
            "Name": "late_failure", "Label": "Late failure", "Type": "Checkbox", "Value": "true", "Files": invalid
        }));
        raw["Controls"]["Customizations"][0]["WriteCfg"] = serde_json::json!({
            "FileName": "fixture.cfg", "TrueText": "cl_hud_minmode 1\n", "FalseText": "cl_hud_minmode 0\n"
        });
        let schema = parse_hud_schema(&raw.to_string()).unwrap();
        let before = fixture.snapshot();
        let options = BTreeMap::from([("fh_toggle_disguise_image".into(), "true".into())]);
        let error = apply_schema_options_to(
            &fixture.profiles,
            &fixture.root,
            &fixture.id,
            &schema,
            options,
            Vec::<String>::new(),
        )
        .unwrap_err();
        assert!(
            error.message().contains("Late failure\" (late_failure)"),
            "{error:?}"
        );
        assert_eq!(fixture.snapshot(), before);
    }
}

#[test]
fn refused_live_projection_or_game_lock_does_not_publish_options() {
    let fixture = Fixture::new();
    let schema = parse_hud_schema(SCHEMA).unwrap();
    let options = BTreeMap::from([
        ("fh_toggle_disguise_image".into(), "true".into()),
        // Exercise the occupied resource output with a real value change.
        // Lossless editing no longer rewrites this file for an unrelated toggle.
        ("fh_val_hud_style".into(), "true".into()),
    ]);
    let before = fixture.snapshot();
    let error = apply_schema_options_to(
        &fixture.profiles,
        &fixture.root,
        &fixture.id,
        &schema,
        options.clone(),
        ["tf_win64.exe"],
    )
    .unwrap_err();
    assert_eq!(error.code(), "GameRunning");
    assert_eq!(fixture.snapshot(), before);

    // A directory occupying a live output path must not cause a partial save.
    let occupied = fixture.root.join("tf/custom/fixture-hud").join(RESOURCE);
    fs::remove_file(&occupied).unwrap();
    fs::create_dir(&occupied).unwrap();
    let before = fixture.snapshot();
    apply_schema_options_to(
        &fixture.profiles,
        &fixture.root,
        &fixture.id,
        &schema,
        options,
        Vec::<String>::new(),
    )
    .unwrap_err();
    assert_eq!(fixture.snapshot(), before);
    assert!(occupied.is_dir());
}
