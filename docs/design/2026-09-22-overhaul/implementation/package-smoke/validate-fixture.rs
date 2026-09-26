// Standalone, disposable library validation. See README.md for dependencies.
// This never starts a desktop app, installer, Steam or TF2.
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

fn snapshot(root: &Path) -> BTreeMap<String, String> {
    fn visit(root: &Path, path: &Path, files: &mut BTreeMap<String, String>) {
        let metadata = fs::symlink_metadata(path).unwrap();
        assert!(!metadata.file_type().is_symlink());
        if metadata.is_dir() {
            for entry in fs::read_dir(path).unwrap() {
                visit(root, &entry.unwrap().path(), files);
            }
        } else {
            assert!(metadata.is_file());
            files.insert(
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                new_core::hash::sha256_file(path).unwrap(),
            );
        }
    }
    let mut files = BTreeMap::new();
    visit(root, root, &mut files);
    files
}

fn check_archive(path: &Path, source_manifest: &Value, profiles: &Path) -> usize {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    let mut manifest_bytes = String::new();
    archive
        .by_name("execs-profile.json")
        .unwrap()
        .read_to_string(&mut manifest_bytes)
        .unwrap();
    let exported: Value = serde_json::from_str(&manifest_bytes).unwrap();
    for field in ["name", "launchOptions", "files", "mods", "hud"] {
        assert_eq!(
            exported[field], source_manifest[field],
            "exported record changed: {field}"
        );
    }
    let files = source_manifest["files"].as_array().unwrap();
    for file in files {
        let hash = file["sha256"].as_str().unwrap();
        let rel = file["path"].as_str().unwrap();
        let shared = file["storage"] == "shared";
        let source = if shared {
            profiles.join("blobs/sha256").join(&hash[..2]).join(hash)
        } else {
            profiles
                .join(source_manifest["id"].as_str().unwrap())
                .join("files")
                .join(rel)
        };
        let member = if shared {
            format!("blobs/{hash}")
        } else {
            format!("files/{rel}")
        };
        let mut bytes = Vec::new();
        archive
            .by_name(&member)
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(bytes, fs::read(source).unwrap());
        assert_eq!(new_core::hash::sha256_hex(&bytes), hash);
    }
    files.len()
}

fn main() {
    let scratch = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("absolute seeded scratch directory"),
    );
    assert!(scratch.is_absolute());
    assert_eq!(scratch.file_name().unwrap(), "execs-package-smoke");
    let data = scratch
        .join(if cfg!(windows) { "roaming" } else { "data" })
        .join("execs");
    std::env::set_var("APPDATA", scratch.join("roaming"));
    std::env::set_var("XDG_DATA_HOME", scratch.join("data"));
    assert_eq!(old_core::settings::execs_data_dir(), data);
    assert_eq!(new_core::settings::execs_data_dir(), data);
    let profiles = data.join("profiles");
    let root = scratch.join("fixture-tf2");
    let root_before = snapshot(&root);
    let data_before = snapshot(&data);
    let old_settings = old_core::settings::load_settings_from(&data.join("settings.json")).unwrap();
    let new_settings = new_core::settings::read_settings_from(&data.join("settings.json"))
        .unwrap()
        .unwrap();
    assert_eq!(old_settings.tf2_root, root.to_string_lossy());
    assert_eq!(new_settings.tf2_root, old_settings.tf2_root);
    let old_library = old_core::profile::load_library_from(&profiles, Some(&root)).unwrap();
    let new_library = new_core::profile::load_library_from(&profiles, Some(&root)).unwrap();
    assert_eq!(old_library.profiles.len(), 2);
    assert_eq!(new_library.profiles.len(), 2);
    assert_eq!(old_library.active_profile_id, new_library.active_profile_id);
    let output = scratch.join("core-exports");
    fs::create_dir(&output).unwrap();
    let mut evidence = Vec::new();
    for profile in old_library.profiles {
        let source: Value = serde_json::from_slice(
            &fs::read(profiles.join(&profile.id).join("manifest.json")).unwrap(),
        )
        .unwrap();
        let old_manifest = old_core::load_manifest(&profiles, &profile.id).unwrap();
        let new_manifest = new_core::load_manifest(&profiles, &profile.id).unwrap();
        assert_eq!(old_manifest.name, new_manifest.name);
        assert_eq!(old_manifest.files.len(), new_manifest.files.len());
        assert_eq!(
            new_manifest.hud_roots,
            Some(if new_manifest.hud.is_some() {
                vec!["fixturehud".into()]
            } else {
                vec![]
            })
        );
        let old_zip = output.join(format!("{}-v018.zip", profile.id));
        let new_zip = output.join(format!("{}-current.zip", profile.id));
        old_core::export_profile_to(&profiles, &root, &profile.id, &old_zip).unwrap();
        new_core::export_profile_to(&profiles, &root, &profile.id, &new_zip).unwrap();
        let old_count = check_archive(&old_zip, &source, &profiles);
        let new_count = check_archive(&new_zip, &source, &profiles);
        evidence.push(json!({
            "profile": profile.name, "id": profile.id,
            "oldCoreReadAndExport": true, "currentCoreReadAndExport": true,
            "oldPayloadsPreserved": old_count, "currentPayloadsPreserved": new_count,
            "oldArchiveSha256": new_core::hash::sha256_file(&old_zip).unwrap(),
            "currentArchiveSha256": new_core::hash::sha256_file(&new_zip).unwrap()
        }));
    }
    assert_eq!(
        snapshot(&data),
        data_before,
        "core validation changed seeded data"
    );
    assert_eq!(
        snapshot(&root),
        root_before,
        "core validation changed synthetic live root"
    );
    let result = json!({
        "platform": std::env::consts::OS,
        "exporterTag": "v0.1.8", "exporterRevision": "85aaf6bc0dd28f43351d4cb5cdb62502737688d5",
        "candidateProductRevision": "7c78fbed1907dceb37bf348596fca48a8f654e66",
        "profiles": evidence, "appDataUnchanged": true, "syntheticLiveRootUnchanged": true,
        "packagedRuntimeExercised": false, "desktopOrGameStarted": false
    });
    fs::write(
        output.join("results.json"),
        format!("{}\n", serde_json::to_string_pretty(&result).unwrap()),
    )
    .unwrap();
    println!("PASS: both native core versions read two seeded profiles/settings and export all 12 payload references unchanged; library and synthetic live root unchanged.");
}
