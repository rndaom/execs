use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const EXPORTER: &str = "ebb2d507635f314675a481a0c8b5d683fb4502cf";

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
        "Actual public v0.2.1 export",
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
                inactive_pack: None,
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
    let zip_path = case.join("exported-by-v0.2.1.zip");
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
    fs::write(case.join("exported-manifest.json"), format!("{text}\n")).unwrap();
    (zip_path, serde_json::to_value(source_manifest).unwrap())
}


fn main() {
    let base = PathBuf::from(std::env::args_os().nth(1).unwrap());
    assert!(base.is_absolute() && !base.exists());
    fs::create_dir_all(&base).unwrap();
    let mut results = Vec::new();
    for (label, huds) in [("no-hud", 0), ("single-hud", 1)] {
        let case = base.join(label);
        fs::create_dir(&case).unwrap();
        let appdata = case.join("isolated-appdata");
        fs::create_dir(&appdata).unwrap();
        std::env::set_var("APPDATA", &appdata);
        std::env::set_var("XDG_DATA_HOME", &appdata);
        assert_eq!(old_core::execs_data_dir(), appdata.join("execs"));
        let root = case.join("disposable-tf2-root");
        write(&root, "tf/steam.inf", b"appID=440\n");
        write(&root, "tf/cfg/config_default.cfg", b"sensitivity 3\n");
        let before = snapshot(&root);
        let (archive, _) = old_export(&case, &root, &payloads(huds), huds);
        assert_eq!(snapshot(&root), before);
        results.push(json!({"case":label,"archiveSha256":old_core::hash::sha256_file(&archive).unwrap(),"liveUnchanged":true}));
    }
    fs::write(base.join("results.json"), serde_json::to_vec_pretty(&json!({"exporterRevision":EXPORTER,"cases":results})).unwrap()).unwrap();
    println!("PASS: public v0.2.1 exports, source libraries and synthetic live files unchanged");
}
