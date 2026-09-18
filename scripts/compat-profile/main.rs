//! Bounded cross-version probe. All library/root/ZIP paths are disposable paths
//! below this helper. Never calls a default app-data or live-game entry point.
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

const OLD_COMMIT: &str = "9976464bd7a4a79faf53b6e6ca3dab2219633bdd";
const OLD_CORE_TREE: &str = "f2d03158fd4435d931db1f55fc50da1b2ef67478";

fn git(repo: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .expect("read Git identity");
    assert!(output.status.success(), "Git command failed: {args:?}");
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

fn source(repo: &Path, expected_tree: &str) -> Value {
    let tree = git(repo, &["rev-parse", "HEAD:apps/desktop/src-tauri/core"]);
    assert_eq!(tree, expected_tree, "unexpected core source");
    assert_eq!(
        git(
            repo,
            &["status", "--porcelain", "--", "apps/desktop/src-tauri/core"]
        ),
        "",
        "core source must be clean"
    );
    json!({ "commit": git(repo, &["rev-parse", "HEAD"]), "coreTree": tree })
}

fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn write_json(path: &Path, value: &Value) {
    let mut text = serde_json::to_string_pretty(value).unwrap();
    text.push('\n');
    write(path, text.as_bytes());
}

// Directory entries as well as every file byte must remain unchanged.
fn snapshot(root: &Path) -> BTreeMap<String, Option<Vec<u8>>> {
    fn visit(base: &Path, dir: &Path, result: &mut BTreeMap<String, Option<Vec<u8>>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            let kind = entry.file_type().unwrap();
            assert!(!kind.is_symlink(), "fixture must not contain symlinks");
            let rel = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if kind.is_dir() {
                result.insert(format!("{rel}/"), None);
                visit(base, &path, result);
            } else {
                assert!(kind.is_file());
                result.insert(rel, Some(fs::read(&path).unwrap()));
            }
        }
    }
    let mut result = BTreeMap::new();
    visit(root, root, &mut result);
    result
}

fn seed_root(path: &Path) {
    write(&path.join("tf/steam.inf"), b"appID=440\n");
    write(
        &path.join("tf/cfg/config.cfg"),
        b"// untouched synthetic install\nsensitivity 1\n",
    );
    write(
        &path.join("tf/custom/live-sentinel/materials/keep.vmt"),
        b"untouched\n",
    );
}

fn fixture_payload() -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::from([
        ("tf/cfg/config.cfg".into(), b"// v0.1.5 exporter fixture\nunbindall\nbind \"w\" \"+forward\"\nsensitivity \"2.75\"\ncl_crosshair_scale \"28\"\n".to_vec()),
        ("tf/cfg/overrides/autoexec.cfg".into(), b"exec overrides/execs_gameplay\nexec overrides/compat_nested/profile\n".to_vec()),
        ("tf/cfg/overrides/execs_gameplay.cfg".into(), b"fov_desired \"90\"\nviewmodel_fov \"75\"\ncl_flipviewmodels \"0\"\n".to_vec()),
        ("tf/cfg/overrides/compat_nested/profile.cfg".into(), b"// Nested cfg stays byte-for-byte intact.\nbind \"F6\" \"slot1\"\n".to_vec()),
        ("tf/custom/compat-hud/info.vdf".into(), b"\"compat-hud\"\n{\n\"ui_version\" \"3\"\n}\n".to_vec()),
        ("tf/custom/compat-hud/resource/ui/HudLayout.res".into(), b"\"Resource/HudLayout.res\"\n{\n\"Fixture\" { \"visible\" \"1\" }\n}\n".to_vec()),
        ("tf/custom/compat-pack/materials/fixture.vmt".into(), b"\"UnlitGeneric\"\n{\n\"$basetexture\" \"vgui/white\"\n}\n// undashed pack\n".to_vec()),
        ("tf/custom/-compat-pack/materials/fixture.vmt".into(), b"\"UnlitGeneric\"\n{\n\"$basetexture\" \"vgui/white\"\n}\n// independent dashed pack\n".to_vec()),
    ]);
    for (pack, cfg) in [
        (
            "compat-vpk.vpk",
            "// undashed VPK\nr_drawtracers_firstperson 1\n",
        ),
        (
            "-compat-vpk.vpk",
            "// independent dashed VPK\nr_drawtracers_firstperson 0\n",
        ),
        (
            "mastercomfig-base.vpk",
            "// synthetic shared base\nmat_picmip 1\n",
        ),
    ] {
        let content = BTreeMap::from([("cfg/compat-fixture.cfg".into(), cfg.as_bytes().to_vec())]);
        files.insert(
            format!("tf/custom/{pack}"),
            old_core::vpk::write_vpk_v2(&content),
        );
    }
    files
}

fn zip_entries(path: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    let mut result = BTreeMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let name = entry.name().to_string();
        assert!(!entry.is_dir());
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        assert!(result.insert(name, bytes).is_none());
    }
    result
}

fn portable(mut manifest: Value) -> Value {
    for key in ["id", "tf2Root", "launchSyncPending", "cloudSyncPending"] {
        manifest.as_object_mut().unwrap().remove(key);
    }
    manifest
}

fn verify_import(
    library: &Path,
    root: &Path,
    id: &str,
    source_id: &str,
    expected: &BTreeMap<String, Vec<u8>>,
    metadata: &Value,
) -> Value {
    assert_ne!(id, source_id, "import must create a new identity");
    let manifest = new_core::profile::load_manifest(library, id).expect("load new manifest");
    assert_eq!(
        portable(serde_json::to_value(&manifest).unwrap()),
        *metadata
    );
    assert!(
        manifest.launch_sync_pending,
        "import has not written Steam launch settings"
    );
    assert_eq!(manifest.files.len(), expected.len());
    for entry in &manifest.files {
        let expected_bytes = expected.get(&entry.path).expect("no unexpected file path");
        assert_eq!(entry.sha256, old_core::hash::sha256_hex(expected_bytes));
        assert_eq!(entry.sha256, new_core::hash::sha256_hex(expected_bytes));
        let stored = if entry.path == "tf/custom/mastercomfig-base.vpk" {
            assert_eq!(entry.storage, new_core::profile::FileStorage::Shared);
            new_core::blob::blob_path(library, &entry.sha256)
        } else {
            assert_eq!(entry.storage, new_core::profile::FileStorage::Exclusive);
            new_core::profile::exclusive_file_path(library, id, &entry.path)
        };
        assert_eq!(
            fs::read(&stored).unwrap(),
            *expected_bytes,
            "bytes changed: {}",
            entry.path
        );
        assert_eq!(new_core::hash::sha256_file(&stored).unwrap(), entry.sha256);
    }
    let readback = new_core::profile::load_library_from(library, Some(root)).unwrap();
    assert!(readback.usable);
    assert!(readback
        .profiles
        .iter()
        .find(|item| item.id == id)
        .unwrap()
        .unsafe_custom_folders
        .is_empty());
    json!({ "id": id, "fileCount": manifest.files.len(), "modCount": manifest.mods.len(), "hud": manifest.hud, "launchSyncPending": manifest.launch_sync_pending, "unsafeCustomFolders": [] })
}

fn main() {
    let helper = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let new_core_tree = std::env::var("EXECS_COMPAT_NEW_TREE").expect("candidate source tree");
    let old_repo = PathBuf::from(std::env::var("EXECS_COMPAT_OLD_REPO").unwrap());
    let new_repo = PathBuf::from(std::env::var("EXECS_COMPAT_NEW_REPO").unwrap());
    let old_source = source(&old_repo, OLD_CORE_TREE);
    let new_source = source(&new_repo, &new_core_tree);
    assert_eq!(old_source["commit"], OLD_COMMIT);
    assert_eq!(
        git(&old_repo, &["rev-parse", "v0.1.5^{commit}"]),
        OLD_COMMIT
    );

    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let label = std::env::args()
        .nth(1)
        .unwrap_or_else(|| format!("run-{epoch}"));
    assert!(
        !label.is_empty()
            && label
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    );
    let run = helper.join(&label);
    fs::create_dir(&run).expect("use a fresh output directory; existing evidence is kept");
    assert!(run
        .canonicalize()
        .unwrap()
        .starts_with(helper.canonicalize().unwrap()));
    let old_root = run.join("old-root");
    let new_root = run.join("new-root");
    seed_root(&old_root);
    seed_root(&new_root);
    let old_root_before = snapshot(&old_root);
    let new_root_before = snapshot(&new_root);
    let expected = fixture_payload();
    let old_library = run.join("old-library");
    let puts: Vec<_> = expected
        .iter()
        .map(|(name, bytes)| (name.clone(), old_core::profile::FileSource::Bytes(bytes)))
        .collect();
    let records: Vec<_> = [
        "compat-pack",
        "-compat-pack",
        "compat-vpk.vpk",
        "-compat-vpk.vpk",
    ]
    .into_iter()
    .map(|pack| {
        let prefix = format!("tf/custom/{pack}");
        let owned: Vec<_> = expected
            .iter()
            .filter(|(path, _)| **path == prefix || path.starts_with(&format!("{prefix}/")))
            .collect();
        old_core::mods::ModRecord {
            id: pack.trim_end_matches(".vpk").to_string(),
            name: format!("Public export {pack}"),
            source: old_core::mods::ModSource::Local,
            pack: pack.to_string(),
            files: owned.len(),
            bytes: owned.iter().map(|(_, bytes)| bytes.len() as u64).sum(),
            installed_at: "2026-09-14T00:00:00Z".into(),
        }
    })
    .collect();
    let old = old_core::profile::create_populated_profile_to(
        &old_library,
        &old_root,
        "Public 0.1.5 compatibility fixture",
        &puts,
        true,
        std::iter::empty::<&str>(),
        |manifest| {
            manifest.launch_options = "-novid -nojoy".into();
            manifest.launch_sync_pending = false;
            manifest.hud = Some(old_core::profile::HudRecord {
                id: "compat-hud".into(),
                hash: None,
                source: old_core::profile::HudSource::Local,
                options: BTreeMap::from([
                    ("minmode".into(), "true".into()),
                    ("accentColor".into(), "128 180 255 255".into()),
                ]),
            });
            manifest.mods = records;
            manifest.ignored_packs = vec!["compat-kept-out".into(), "-compat-kept-out".into()];
            Ok(())
        },
    )
    .expect("public core creates complete synthetic profile");
    let old_id = old.active_profile_id.as_ref().unwrap();
    let old_manifest = old_core::profile::load_manifest(&old_library, old_id).unwrap();
    let old_library_before = snapshot(&old_library);
    let public_zip = run.join("public-0.1.5.zip");
    old_core::export_profile_to(&old_library, &old_root, old_id, &public_zip)
        .expect("actual public exporter");
    assert_eq!(
        snapshot(&old_library),
        old_library_before,
        "export changes no library files"
    );
    let exported_entries = zip_entries(&public_zip);
    let metadata: Value = serde_json::from_slice(&exported_entries["execs-profile.json"]).unwrap();
    assert_eq!(metadata["schema"], 1);
    assert!(metadata.get("id").is_none() && metadata.get("tf2Root").is_none());
    assert_eq!(
        portable(serde_json::to_value(&old_manifest).unwrap()),
        metadata
    );
    write_json(&run.join("public-0.1.5-manifest.json"), &metadata);

    let empty_library = run.join("new-empty-library");
    let empty = new_core::import_profile_from(
        &empty_library,
        &new_root,
        &public_zip,
        std::iter::empty::<&str>(),
    )
    .expect("0.1.6 imports public export into empty library");
    assert_eq!(empty.profiles.len(), 1);
    assert_eq!(
        empty.active_profile_id, None,
        "empty-library import must not activate"
    );
    let empty_id = &empty.profiles[0].id;
    let empty_result = verify_import(
        &empty_library,
        &new_root,
        empty_id,
        old_id,
        &expected,
        &metadata,
    );

    let active_library = run.join("new-active-library");
    let sentinel = [(
        "tf/cfg/config.cfg".into(),
        new_core::profile::FileSource::Bytes(b"// active library sentinel\nsensitivity 1\n"),
    )];
    let active_before = new_core::profile::create_populated_profile_to(
        &active_library,
        &new_root,
        "Keep active",
        &sentinel,
        true,
        std::iter::empty::<&str>(),
        |_| Ok(()),
    )
    .unwrap();
    let active_id = active_before.active_profile_id.clone().unwrap();
    let active_profile_before = snapshot(&active_library.join(&active_id));
    let active = new_core::import_profile_from(
        &active_library,
        &new_root,
        &public_zip,
        std::iter::empty::<&str>(),
    )
    .expect("0.1.6 imports public export beside active profile");
    assert_eq!(active.profiles.len(), 2);
    assert_eq!(
        active.active_profile_id.as_deref(),
        Some(active_id.as_str())
    );
    assert_eq!(
        snapshot(&active_library.join(&active_id)),
        active_profile_before
    );
    let imported_id = &active
        .profiles
        .iter()
        .find(|item| item.id != active_id)
        .unwrap()
        .id;
    let active_result = verify_import(
        &active_library,
        &new_root,
        imported_id,
        old_id,
        &expected,
        &metadata,
    );

    let reexport_zip = run.join("reexport-0.1.6.zip");
    let empty_library_before_export = snapshot(&empty_library);
    new_core::export_profile_to(&empty_library, &new_root, empty_id, &reexport_zip)
        .expect("0.1.6 re-exports imported profile");
    assert_eq!(snapshot(&empty_library), empty_library_before_export);
    assert_eq!(
        zip_entries(&reexport_zip),
        exported_entries,
        "every archive entry, including portable metadata, must match exact bytes"
    );
    assert_eq!(
        fs::read(&reexport_zip).unwrap(),
        fs::read(&public_zip).unwrap(),
        "the re-export ZIP must match the actual public export byte for byte"
    );
    let roundtrip_library = run.join("new-roundtrip-library");
    let roundtrip = new_core::import_profile_from(
        &roundtrip_library,
        &new_root,
        &reexport_zip,
        std::iter::empty::<&str>(),
    )
    .expect("0.1.6 imports its re-export");
    assert_eq!(roundtrip.profiles.len(), 1);
    assert_eq!(roundtrip.active_profile_id, None);
    let roundtrip_result = verify_import(
        &roundtrip_library,
        &new_root,
        &roundtrip.profiles[0].id,
        empty_id,
        &expected,
        &metadata,
    );
    assert_eq!(
        snapshot(&old_root),
        old_root_before,
        "public core must not change synthetic install"
    );
    assert_eq!(
        snapshot(&new_root),
        new_root_before,
        "new core must not change synthetic install"
    );
    assert_eq!(
        snapshot(&old_library),
        old_library_before,
        "new imports must not touch the source library"
    );
    source(&old_repo, OLD_CORE_TREE);
    let new_source_after = source(&new_repo, &new_core_tree);

    let report = json!({
        "result": "PASS",
        "scope": "actual public v0.1.5 export -> integrated 0.1.6 import -> re-export -> re-import, synthetic filesystem only",
        "oldSource": old_source,
        "newSource": new_source,
        "newSourceAfter": new_source_after,
        "output": run,
        "schema": metadata["schema"],
        "fileCount": expected.len(),
        "modCount": 4,
        "independentPacks": ["compat-pack", "-compat-pack", "compat-vpk.vpk", "-compat-vpk.vpk"],
        "nestedCfgPreserved": true,
        "hudAndModMetadataPreserved": true,
        "ignoredPacksPreserved": true,
        "sharedBlobPreserved": true,
        "allPayloadBytesAndHashesPreserved": true,
        "reexportAllEntryBytesIdentical": true,
        "reexportZipBytesIdentical": true,
        "sourceLibraryUnchanged": true,
        "syntheticInstallTreesUnchanged": true,
        "existingActiveProfileUnchanged": true,
        "emptyLibraryImport": empty_result,
        "activeLibraryImport": { "activeIdBefore": active_id, "activeIdAfter": active.active_profile_id, "imported": active_result },
        "reexportRoundtrip": roundtrip_result,
        "publicZipSha256": new_core::hash::sha256_file(&public_zip).unwrap(),
        "reexportZipSha256": new_core::hash::sha256_file(&reexport_zip).unwrap(),
        "payload": expected.iter().map(|(path, bytes)| json!({ "path": path, "bytes": bytes.len(), "sha256": new_core::hash::sha256_hex(bytes) })).collect::<Vec<_>>(),
        "limits": ["Small synthetic fixture, not every public profile", "Core API verification; no packaged UI, Steam handoff, actual TF2, or installed profile library exercised"]
    });
    write_json(&run.join("result.json"), &report);
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}
