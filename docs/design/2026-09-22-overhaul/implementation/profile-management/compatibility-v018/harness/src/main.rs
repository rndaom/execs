use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const EXPORTER: &str = "85aaf6bc0dd28f43351d4cb5cdb62502737688d5";
const IMPORTER: &str = "542b3dd20f2847fc90a1a4e990584f03830fcc6d";

fn snapshot(root: &Path) -> BTreeMap<String, String> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let meta = fs::symlink_metadata(entry.path()).unwrap();
            assert!(!meta.file_type().is_symlink());
            if meta.is_dir() {
                walk(root, &entry.path(), out);
            } else {
                assert!(meta.is_file());
                let relative = entry
                    .path()
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(
                    relative,
                    old_core::hash::sha256_file(&entry.path()).unwrap(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

fn write(root: &Path, relative: &str, bytes: &[u8]) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn payloads(huds: usize) -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::from([
        (
            "tf/cfg/config.cfg".to_string(),
            b"unbindall\nbind w +forward\nsensitivity 2.5\ncon_enable 1\n".to_vec(),
        ),
        (
            "tf/cfg/overrides/compat.cfg".to_string(),
            b"// unchanged handwritten settings\nfov_desired 90\n".to_vec(),
        ),
    ]);
    let base = old_core::vpk::write_vpk_v2(&BTreeMap::from([(
        "cfg/mastercomfig/compat.cfg".into(),
        b"echo compatibility_base\n".to_vec(),
    )]));
    let pack = old_core::vpk::write_vpk_v2(&BTreeMap::from([(
        "materials/vgui/compat.vmt".into(),
        b"\"UnlitGeneric\" { \"$basetexture\" \"vgui/white\" }\n".to_vec(),
    )]));
    files.insert("tf/custom/mastercomfig-base.vpk".into(), base);
    files.insert("tf/custom/compat-pack.vpk".into(), pack);
    if huds > 0 {
        files.insert("tf/cfg/overrides/autoexec.cfg".into(), b"// author's original startup bytes\nexec overrides/execs_hud_fixture\ncl_autoreload 1\n".to_vec());
        files.insert(
            "tf/cfg/overrides/execs_hud_fixture.cfg".into(),
            b"cl_hud_minmode 1\n".to_vec(),
        );
        files.insert(
            "tf/custom/fixturehud/info.vdf".into(),
            b"// original UI3 metadata\n\"Fixture HUD\" { \"ui_version\" \"3\" }\n".to_vec(),
        );
        files.insert(
            "tf/custom/fixturehud/resource/ui/layout.res".into(),
            b"\"fixture\" { \"xpos\" \"17\" }\n".to_vec(),
        );
    }
    if huds > 1 {
        files.insert(
            "tf/custom/secondhud/info.vdf".into(),
            b"\"Other HUD\" { \"ui_version\" \"3\" }\n".to_vec(),
        );
        files.insert(
            "tf/custom/secondhud/resource/ui/layout.res".into(),
            b"\"fixture\" { \"xpos\" \"41\" }\n".to_vec(),
        );
    }
    files
}

fn old_export(
    case: &Path,
    root: &Path,
    files: &BTreeMap<String, Vec<u8>>,
    huds: usize,
) -> (PathBuf, Value) {
    let profiles = case.join("old-library/profiles");
    let puts: Vec<_> = files
        .iter()
        .map(|(path, bytes)| (path.clone(), old_core::profile::FileSource::Bytes(bytes)))
        .collect();
    let mod_bytes = files["tf/custom/compat-pack.vpk"].len() as u64;
    let library = old_core::profile::create_populated_profile_to(
        &profiles,
        root,
        "Actual public v0.1.8 export",
        &puts,
        false,
        Vec::<String>::new(),
        |manifest| {
            manifest.launch_options = "-novid -nojoy".into();
            manifest.mods = vec![old_core::ModRecord {
                id: "compat-pack".into(),
                name: "Compatibility pack".into(),
                source: old_core::ModSource::Local,
                pack: "compat-pack.vpk".into(),
                files: 1,
                bytes: mod_bytes,
                installed_at: "2026-09-20T00:00:00Z".into(),
            }];
            if huds > 0 {
                manifest.hud = Some(old_core::HudRecord {
                    id: "fixturehud".into(),
                    hash: None,
                    source: old_core::HudSource::Local,
                    options: BTreeMap::from([("compact".into(), "1".into())]),
                });
            }
            Ok(())
        },
    )
    .unwrap();
    assert!(library.active_profile_id.is_none());
    let source_manifest = old_core::load_manifest(&profiles, &library.profiles[0].id).unwrap();
    let library_before = snapshot(&profiles);
    let zip_path = case.join("exported-by-v0.1.8.zip");
    old_core::export_profile_to(&profiles, root, &library.profiles[0].id, &zip_path).unwrap();
    assert_eq!(
        snapshot(&profiles),
        library_before,
        "old exporter mutated its library"
    );
    let mut archive = zip::ZipArchive::new(fs::File::open(&zip_path).unwrap()).unwrap();
    let mut text = String::new();
    archive
        .by_name("execs-profile.json")
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    let manifest: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(manifest["schema"], 1);
    for absent in [
        "preloader",
        "hudRoots",
        "hudSelectedRoot",
        "hudReviewPending",
    ] {
        assert!(
            manifest.get(absent).is_none(),
            "tag exporter unexpectedly emitted {absent}"
        );
    }
    fs::write(case.join("exported-manifest.json"), format!("{text}\n")).unwrap();
    (zip_path, serde_json::to_value(source_manifest).unwrap())
}

fn run_case(base: &Path, label: &str, huds: usize, choice: Option<&str>) -> Value {
    let case = base.join(label);
    assert!(!case.exists(), "refuse to reuse a previous run directory");
    fs::create_dir_all(&case).unwrap();
    let appdata = case.join("isolated-appdata");
    fs::create_dir_all(&appdata).unwrap();
    // This standalone child process owns these environment changes. No parent,
    // system, or user environment value is changed.
    std::env::set_var("APPDATA", &appdata);
    std::env::set_var("XDG_DATA_HOME", &appdata);
    let old_data = old_core::execs_data_dir();
    let new_data = new_core::execs_data_dir();
    assert_eq!(old_data, appdata.join("execs"));
    assert_eq!(new_data, appdata.join("execs"));
    assert!(old_data.starts_with(&case) && new_data.starts_with(&case));
    let root = case.join("disposable-tf2-root");
    write(&root, "tf/steam.inf", b"appID=440\n");
    write(
        &root,
        "tf/cfg/config_default.cfg",
        b"unbindall\nbind w +forward\n",
    );
    write(
        &root,
        "tf/cfg/autoexec.cfg",
        b"echo live_root_must_remain_untouched\n",
    );
    write(
        &root,
        "tf/custom/sentinel/resource/preserved.txt",
        b"live sentinel\n",
    );
    let live_before = snapshot(&root);
    let files = payloads(huds);
    let (archive_path, old_manifest) = old_export(&case, &root, &files, huds);
    assert_eq!(snapshot(&root), live_before);

    let new_profiles = new_core::profiles_dir();
    assert_eq!(new_profiles, new_data.join("profiles"));
    let sentinel = new_core::profile::create_populated_profile_to(
        &new_profiles,
        &root,
        "Existing active fixture",
        &[],
        true,
        Vec::<String>::new(),
        |_| Ok(()),
    )
    .unwrap();
    let active = sentinel.active_profile_id.clone();
    assert!(active.is_some());
    let existing_manifest_path =
        new_core::profile::manifest_file(&new_profiles, active.as_ref().unwrap());
    let existing_before = fs::read(&existing_manifest_path).unwrap();
    let mut refused_without_choice = false;
    if huds > 1 {
        let refused = new_core::import_profile_from(
            &new_profiles,
            &root,
            &archive_path,
            Vec::<String>::new(),
        )
        .unwrap_err();
        assert_eq!(refused.code(), "HudReviewRequired");
        let after = new_core::profile::load_library_from(&new_profiles, Some(&root)).unwrap();
        assert_eq!(after.profiles.len(), 1);
        assert_eq!(after.active_profile_id, active);
        refused_without_choice = true;
    }
    let mut review = new_core::inspect_profile_import(&root, &archive_path).unwrap();
    assert!(!review.creator);
    assert_eq!(review.files, files.len());
    assert_eq!(review.huds.len(), huds);
    let reviewed_huds = review.huds.clone();
    if huds > 1 {
        // Follow the explicit-choice UI contract rather than accepting an old
        // record as approval of a multiple-HUD selection.
        review.selected_hud = None;
        review.select_hud(choice.map(str::to_string)).unwrap();
    }
    let imported = new_core::import_reviewed_profile(&root, &archive_path, &review).unwrap();
    assert_eq!(imported.profiles.len(), 2);
    assert_eq!(imported.active_profile_id, active);
    assert_eq!(fs::read(&existing_manifest_path).unwrap(), existing_before);
    let id = &imported
        .profiles
        .iter()
        .find(|p| Some(&p.id) != active.as_ref())
        .unwrap()
        .id;
    let manifest = new_core::load_manifest(&new_profiles, id).unwrap();
    assert_eq!(manifest.name, "Actual public v0.1.8 export");
    assert_eq!(manifest.launch_options, "-novid -nojoy");
    assert!(manifest.launch_sync_pending);
    assert!(
        manifest.preloader.as_ref().unwrap().is_empty(),
        "v0.1.8 did not export particle selections"
    );
    assert_eq!(manifest.files.len(), files.len());
    assert_eq!(manifest.mods.len(), 1);
    assert_eq!(
        serde_json::to_value(&manifest.mods).unwrap(),
        old_manifest["mods"]
    );
    assert_eq!(
        serde_json::to_value(&manifest.hud).unwrap(),
        old_manifest.get("hud").cloned().unwrap_or(Value::Null)
    );
    let expected_pending = huds > 1 && choice == Some("secondhud");
    assert_eq!(manifest.hud_review_pending, expected_pending);
    assert_eq!(manifest.hud_roots.as_ref().unwrap().len(), huds);
    if huds > 0 {
        assert_eq!(
            manifest.hud_selected_root.as_deref(),
            choice.or(Some("fixturehud"))
        );
    }

    let mut payload_evidence = Vec::new();
    for file in &manifest.files {
        let stored = match file.storage {
            new_core::profile::FileStorage::Exclusive => {
                new_core::profile::exclusive_file_path(&new_profiles, id, &file.path)
            }
            new_core::profile::FileStorage::Shared => {
                new_core::blob::blob_path(&new_profiles, &file.sha256)
            }
        };
        let expected = &files[&file.path];
        let actual = fs::read(stored).unwrap();
        assert_eq!(&actual, expected, "payload changed: {}", file.path);
        let before = old_core::hash::sha256_hex(expected);
        let after = new_core::hash::sha256_hex(&actual);
        assert_eq!(before, after);
        assert_eq!(after, file.sha256);
        payload_evidence.push(json!({"path": file.path, "bytes": actual.len(), "beforeSha256": before, "afterSha256": after, "storage": file.storage}));
    }
    let reexport = case.join("reexported-by-current.zip");
    new_core::export_profile_to(&new_profiles, &root, id, &reexport).unwrap();
    let mut current_archive = zip::ZipArchive::new(fs::File::open(&reexport).unwrap()).unwrap();
    for file in &manifest.files {
        let member = match file.storage {
            new_core::profile::FileStorage::Exclusive => format!("files/{}", file.path),
            new_core::profile::FileStorage::Shared => format!("blobs/{}", file.sha256),
        };
        let mut bytes = Vec::new();
        current_archive
            .by_name(&member)
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(
            &bytes, &files[&file.path],
            "current re-export changed payload"
        );
    }
    assert_eq!(
        snapshot(&root),
        live_before,
        "library-only flow changed synthetic live root"
    );
    assert!(
        !new_data.join("preloader").exists(),
        "import unexpectedly created global preloader state"
    );
    json!({
        "case": label, "status": "passed", "exporterTag": "v0.1.8", "exporterRevision": EXPORTER,
        "importerRevision": IMPORTER, "archive": archive_path, "archiveSha256": old_core::hash::sha256_file(&archive_path).unwrap(),
        "reexport": reexport, "reexportSha256": new_core::hash::sha256_file(&reexport).unwrap(),
        "resolvedOldDataDir": old_data, "resolvedNewDataDir": new_data, "sourceZipSchema": 1,
        "reviewedHuds": reviewed_huds, "explicitChoice": choice, "refusedWithoutMultiHudChoice": refused_without_choice,
        "hudReviewPending": manifest.hud_review_pending, "existingActiveIdUnchanged": true,
        "existingManifestUnchanged": true, "liveRootHashesBefore": live_before, "liveRootHashesAfter": snapshot(&root),
        "newPreloaderSelectionEmpty": true, "payloads": payload_evidence,
    })
}

fn main() {
    let base = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .expect("absolute fresh results directory"),
    );
    assert!(base.is_absolute());
    assert!(!base.exists());
    fs::create_dir_all(&base).unwrap();
    let cases = [
        run_case(&base, "no-hud", 0, None),
        run_case(&base, "single-hud", 1, Some("fixturehud")),
        run_case(&base, "multi-hud-keep-owner", 2, Some("fixturehud")),
        run_case(&base, "multi-hud-change-owner", 2, Some("secondhud")),
    ];
    let report = json!({"status": "passed", "exporterTag": "v0.1.8", "exporterRevision": EXPORTER, "importerRevision": IMPORTER, "cases": cases});
    fs::write(
        base.join("results.json"),
        serde_json::to_string_pretty(&report).unwrap() + "\n",
    )
    .unwrap();
    println!("PASS: actual v0.1.8 exporter -> current reviewed importer -> current re-export; 4 cases; all payload hashes and synthetic live snapshots unchanged.");
    println!("Evidence: {}", base.join("results.json").display());
}
