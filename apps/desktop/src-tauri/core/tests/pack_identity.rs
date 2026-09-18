//! Literal Source pack names and executable cfg-layer regressions. Every path
//! belongs to a temporary fake install; no test discovers Steam or Cloud.
use execs_core::absorb::{
    absorb_owned_to, absorb_packs_to, scan_absorb_delta_to, AbsorbDelta, AbsorbOptions, PackChoice,
};
use execs_core::apply::{get_active_profile_detail_from, write_managed_cfg_to};
use execs_core::profile::{
    create_profile_record_to, exclusive_file_path, load_manifest, mutate_profile_files_to,
    save_current_as_to, ProfileLiveProjection, SaveCurrentOptions,
};
use execs_core::surface::{inventory_live_surface, CfgLayer};
use execs_core::switch::switch_profile_to;
use execs_core::zip::{export_profile_to, import_profile_from};
use std::{fs, path::PathBuf};

struct Fixture {
    base: PathBuf,
    root: PathBuf,
    profiles: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!("execs-packs-{}", uuid::Uuid::new_v4()));
        let root = base.join("game");
        let profiles = base.join("profiles");
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::write(root.join("tf/steam.inf"), "appID=440\n").unwrap();
        Self {
            base,
            root,
            profiles,
        }
    }

    fn write(&self, rel: &str, bytes: &[u8]) {
        let path = self.root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn save(&self) -> String {
        save_current_as_to(
            &self.profiles,
            &self.root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap()
        .active_profile_id
        .unwrap()
    }

    fn delta(&self) -> AbsorbDelta {
        scan_absorb_delta_to(&self.profiles, &self.root, opts()).unwrap()
    }

    fn absorb(&self) {
        absorb_owned_to(&self.profiles, &self.root, unlocked(), opts()).unwrap();
    }

    fn choose(&self, choice: PackChoice) {
        absorb_packs_to(&self.profiles, &self.root, choice, unlocked(), opts()).unwrap();
    }

    fn empty_profile(&self, current: &str) -> String {
        create_profile_record_to(&self.profiles, &self.root, "Empty", unlocked())
            .unwrap()
            .profiles
            .into_iter()
            .find(|p| p.id != current)
            .unwrap()
            .id
    }

    fn switch(&self, id: &str) {
        switch_profile_to(&self.profiles, &self.root, id, unlocked(), opts(), |_| {}).unwrap();
    }

    fn stored(&self, id: &str, rel: &str) -> Vec<u8> {
        fs::read(exclusive_file_path(&self.profiles, id, rel)).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn unlocked() -> std::iter::Empty<&'static str> {
    std::iter::empty()
}
fn opts() -> AbsorbOptions<'static> {
    AbsorbOptions {
        cloud_config: None,
        steam_roots: Some(&[]),
    }
}

#[test]
fn advanced_options_script_survives_capture_absorb_export_and_switch() {
    for comfig in [false, true] {
        for name in ["user.scr", "USER.SCR"] {
            let f = Fixture::new();
            if comfig {
                f.write(
                    "tf/custom/mastercomfig-base.vpk",
                    &execs_core::vpk::write_vpk_v2(&loader_files()),
                );
            }
            let rel = format!("tf/cfg/{name}");
            let original = b"VERSION 1.0\nDESCRIPTION INFO_OPTIONS\n{\n\"cl_autoreload\" { \"Auto reload\" { BOOL } { \"0\" } }\n}\n";
            let edited = b"VERSION 1.0\r\nDESCRIPTION INFO_OPTIONS\r\n{\r\n\"cl_autoreload\" { \"Auto reload\" { BOOL } { \"1\" } }\r\n}\r\n";
            f.write(&rel, original);
            f.write("tf/cfg/unrelated.scr", b"not an options script");
            let saved = f.save();
            assert_eq!(f.stored(&saved, &rel), original);
            assert!(!load_manifest(&f.profiles, &saved)
                .unwrap()
                .files
                .iter()
                .any(|file| file.path == "tf/cfg/unrelated.scr"));
            f.write(&rel, edited);
            f.absorb();
            assert_eq!(f.stored(&saved, &rel), edited);

            let zip = f.base.join("options.zip");
            export_profile_to(&f.profiles, &f.root, &saved, &zip).unwrap();
            let library = import_profile_from(&f.profiles, &f.root, &zip, unlocked()).unwrap();
            let imported = &library.profiles.iter().find(|p| p.id != saved).unwrap().id;
            assert_eq!(f.stored(imported, &rel), edited);
            let empty = create_profile_record_to(&f.profiles, &f.root, "Empty", unlocked())
                .unwrap()
                .profiles
                .into_iter()
                .find(|p| p.name == "Empty")
                .unwrap()
                .id;
            f.switch(&empty);
            assert!(!f.root.join(&rel).exists());
            f.switch(imported);
            assert_eq!(fs::read(f.root.join(&rel)).unwrap(), edited);
            assert_eq!(
                fs::read(f.root.join("tf/cfg/unrelated.scr")).unwrap(),
                b"not an options script"
            );
        }
    }
}

#[test]
fn dashed_peers_survive_absorb_export_and_exact_switch() {
    for overlap in [false, true] {
        let f = Fixture::new();
        let plain = "tf/custom/alpha/materials/a.txt";
        let dashed = if overlap {
            "tf/custom/-alpha/materials/a.txt"
        } else {
            "tf/custom/-alpha/materials/b.txt"
        };
        f.write(plain, b"plain");
        f.write(dashed, b"dashed");
        let id = f.save();
        let before = load_manifest(&f.profiles, &id).unwrap();
        assert_eq!(f.delta(), AbsorbDelta::empty());
        f.absorb();
        assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
        f.write(plain, b"plain edited");
        f.write(dashed, b"dashed edited");
        f.absorb();
        assert_eq!(f.stored(&id, plain), b"plain edited");
        assert_eq!(f.stored(&id, dashed), b"dashed edited");
        let zip = f.base.join("profile.zip");
        export_profile_to(&f.profiles, &f.root, &id, &zip).unwrap();
        let imported_dir = f.base.join("imported");
        let imported = import_profile_from(&imported_dir, &f.root, &zip, unlocked()).unwrap();
        let imported = load_manifest(&imported_dir, &imported.profiles[0].id).unwrap();
        assert_eq!(
            imported.files,
            load_manifest(&f.profiles, &id).unwrap().files
        );
        let empty = f.empty_profile(&id);
        f.switch(&empty);
        assert!(!f.root.join(plain).exists());
        assert!(!f.root.join(dashed).exists());
        f.switch(&id);
        assert_eq!(fs::read(f.root.join(plain)).unwrap(), b"plain edited");
        assert_eq!(fs::read(f.root.join(dashed)).unwrap(), b"dashed edited");
    }
}

#[test]
fn removing_owned_pack_does_not_remove_an_identical_dashed_peer() {
    let f = Fixture::new();
    let plain = "tf/custom/alpha/materials/a.txt";
    let dashed = "tf/custom/-alpha/materials/a.txt";
    f.write(plain, b"same bytes");
    let id = f.save();
    f.write(dashed, b"same bytes");
    mutate_profile_files_to(
        &f.profiles,
        &f.root,
        &id,
        &[],
        &[plain.into()],
        ProfileLiveProjection::MirrorIfActive,
        unlocked(),
        |_| Ok(()),
    )
    .unwrap();
    assert!(!f.root.join(plain).exists());
    assert_eq!(fs::read(f.root.join(dashed)).unwrap(), b"same bytes");
}

#[test]
fn switch_preserves_a_kept_identical_dashed_peer() {
    let f = Fixture::new();
    let plain = "tf/custom/alpha/materials/a.txt";
    let dashed = "tf/custom/-alpha/materials/a.txt";
    f.write(plain, b"same bytes");
    let id = f.save();
    f.write(dashed, b"same bytes");
    f.choose(PackChoice::Keep);
    let empty = f.empty_profile(&id);
    f.switch(&empty);
    assert!(!f.root.join(plain).exists());
    assert_eq!(fs::read(f.root.join(dashed)).unwrap(), b"same bytes");
}

#[test]
fn coexisting_dashed_hud_peers_are_not_legacy_backups() {
    let f = Fixture::new();
    f.write("tf/custom/alpha/info.vdf", b"plain HUD\n");
    f.write("tf/custom/-alpha/info.vdf", b"dashed HUD\n");
    let id = f.save();
    let before = load_manifest(&f.profiles, &id).unwrap();
    assert_eq!(f.delta(), AbsorbDelta::empty());
    f.absorb();
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
    assert_eq!(
        fs::read(f.root.join("tf/custom/alpha/info.vdf")).unwrap(),
        b"plain HUD\n"
    );
    assert_eq!(
        fs::read(f.root.join("tf/custom/-alpha/info.vdf")).unwrap(),
        b"dashed HUD\n"
    );
}

#[test]
fn dashed_addition_and_plain_removal_keep_update_and_restore_are_separate() {
    for choice in [PackChoice::Keep, PackChoice::Update, PackChoice::Restore] {
        let f = Fixture::new();
        let plain = "tf/custom/alpha/materials/a.txt";
        let dashed = "tf/custom/-alpha/materials/a.txt";
        f.write(plain, b"plain");
        let id = f.save();
        fs::remove_file(f.root.join(plain)).unwrap();
        f.write(dashed, b"dashed");
        let delta = f.delta();
        assert_eq!(delta.packs_added, ["-alpha"]);
        assert_eq!(delta.packs_removed, ["alpha"]);
        assert!(delta.owned_changed.is_empty());
        assert!(delta.owned_missing.is_empty());
        f.choose(choice);
        let manifest = load_manifest(&f.profiles, &id).unwrap();
        match choice {
            PackChoice::Keep => {
                assert_eq!(manifest.ignored_packs, ["-alpha", "alpha"]);
                assert_eq!(f.stored(&id, plain), b"plain");
                assert_eq!(f.delta(), AbsorbDelta::empty());
            }
            PackChoice::Update => {
                assert!(manifest.ignored_packs.is_empty());
                assert!(!manifest.files.iter().any(|file| file.path == plain));
                assert_eq!(f.stored(&id, dashed), b"dashed");
                assert_eq!(f.delta(), AbsorbDelta::empty());
            }
            PackChoice::Restore => {
                assert_eq!(fs::read(f.root.join(plain)).unwrap(), b"plain");
                assert_eq!(fs::read(f.root.join(dashed)).unwrap(), b"dashed");
                assert_eq!(f.delta().packs_added, ["-alpha"]);
            }
        }
    }
}

#[test]
fn addons_and_orphan_overrides_keep_executed_vanilla_cfgs() {
    for kind in ["empty", "leftover", "addon"] {
        let f = Fixture::new();
        f.write("tf/cfg/autoexec.cfg", b"exec personal/practice\n");
        f.write("tf/cfg/personal/practice.cfg", b"echo practice\n");
        if kind == "addon" {
            let addon = execs_core::vpk::write_vpk_v2(&std::collections::BTreeMap::from([(
                "scripts/soundscapes_manifest.txt".into(),
                b"soundscapes\n".to_vec(),
            )]));
            f.write("tf/custom/mastercomfig-addon-no-soundscapes.vpk", &addon);
        } else {
            fs::create_dir_all(f.root.join("tf/cfg/overrides")).unwrap();
            if kind == "leftover" {
                f.write("tf/cfg/overrides/autoexec.cfg", b"echo dormant override\n");
            }
        }
        assert_eq!(
            inventory_live_surface(&f.root).unwrap().layer,
            CfgLayer::Vanilla,
            "{kind}"
        );
        let id = f.save();
        assert_eq!(
            get_active_profile_detail_from(&f.profiles, &f.root)
                .unwrap()
                .unwrap()
                .layer,
            CfgLayer::Vanilla,
            "{kind}"
        );
        assert_eq!(
            f.stored(&id, "tf/cfg/personal/practice.cfg"),
            b"echo practice\n"
        );
        for stem in ["execs_binds", "execs_gameplay"] {
            write_managed_cfg_to(
                &f.profiles,
                &f.root,
                &id,
                &format!("tf/cfg/{stem}.cfg"),
                b"echo saved\n",
                unlocked(),
            )
            .unwrap();
            let auto = fs::read_to_string(f.root.join("tf/cfg/autoexec.cfg")).unwrap();
            assert!(auto.starts_with("exec personal/practice\n"));
            assert!(auto.contains(&format!("exec {stem}")));
            assert!(!f.root.join(format!("tf/cfg/overrides/{stem}.cfg")).exists());
        }
        if kind == "leftover" {
            assert_eq!(
                fs::read(f.root.join("tf/cfg/overrides/autoexec.cfg")).unwrap(),
                b"echo dormant override\n"
            );
        }
        let empty = f.empty_profile(&id);
        f.switch(&empty);
        f.switch(&id);
        assert_eq!(
            fs::read(f.root.join("tf/cfg/personal/practice.cfg")).unwrap(),
            b"echo practice\n"
        );
    }
}

fn loader_files() -> std::collections::BTreeMap<String, Vec<u8>> {
    std::collections::BTreeMap::from([
        (
            "cfg/autoexec.cfg".into(),
            b"exec comfig/comfig.cfg;exec overrides/autoexec.cfg\n".to_vec(),
        ),
        (
            "cfg/comfig/comfig.cfg".into(),
            b"echo synthetic core\n".to_vec(),
        ),
    ])
}

#[test]
fn nested_cfg_folder_names_survive_capture_export_and_switch() {
    for comfig in [false, true] {
        let f = Fixture::new();
        let prefix = if comfig { "overrides/" } else { "" };
        let auto_path = format!("tf/cfg/{prefix}autoexec.cfg");
        let startup =
            b"exec personal/user/aim\nexec personal/app/aim\nexec personal/deeper/overrides/aim\n";
        f.write(&auto_path, startup);
        if comfig {
            f.write(
                "tf/custom/mastercomfig-base.vpk",
                &execs_core::vpk::write_vpk_v2(&loader_files()),
            );
        }
        let retained = [
            (
                "tf/cfg/personal/user/aim.cfg",
                b"echo nested user\n".as_slice(),
            ),
            (
                "tf/cfg/personal/app/aim.cfg",
                b"echo nested app\n".as_slice(),
            ),
            (
                "tf/cfg/personal/deeper/overrides/aim.cfg",
                b"echo nested overrides\n".as_slice(),
            ),
            (
                "tf/cfg/overrides/retained.cfg",
                b"echo root overrides\n".as_slice(),
            ),
        ];
        let legacy = [
            ("user", "legacy_user.cfg", b"echo legacy user\n".as_slice()),
            ("app", "legacy_app.cfg", b"echo legacy app\n".as_slice()),
        ];
        for (rel, bytes) in retained {
            f.write(rel, bytes);
        }
        for (folder, name, bytes) in legacy {
            f.write(&format!("tf/cfg/{folder}/{name}"), bytes);
        }
        let inventory = inventory_live_surface(&f.root).unwrap();
        for (rel, _) in retained {
            assert!(
                inventory.entries.iter().any(|entry| entry.dest_rel == rel),
                "missing {rel}, comfig={comfig}"
            );
        }

        let id = f.save();
        let manifest = load_manifest(&f.profiles, &id).unwrap();
        assert!(!manifest.files.iter().any(|file| {
            file.path.starts_with("tf/cfg/user/") || file.path.starts_with("tf/cfg/app/")
        }));
        for (rel, bytes) in retained {
            assert_eq!(f.stored(&id, rel), bytes);
        }
        for (_, name, bytes) in legacy {
            assert_eq!(f.stored(&id, &format!("tf/cfg/{prefix}{name}")), bytes);
        }

        let zip = f.base.join("nested-cfg.zip");
        export_profile_to(&f.profiles, &f.root, &id, &zip).unwrap();
        let imported_dir = f.base.join("imported");
        let imported = import_profile_from(&imported_dir, &f.root, &zip, unlocked()).unwrap();
        let imported_id = &imported.profiles[0].id;
        assert_eq!(
            load_manifest(&imported_dir, imported_id).unwrap().files,
            manifest.files
        );
        for (rel, bytes) in retained {
            assert_eq!(
                fs::read(exclusive_file_path(&imported_dir, imported_id, rel)).unwrap(),
                bytes
            );
        }

        let empty = f.empty_profile(&id);
        f.switch(&empty);
        for (rel, _) in retained {
            assert!(!f.root.join(rel).exists());
        }
        f.switch(&id);
        for (rel, bytes) in retained {
            assert_eq!(fs::read(f.root.join(rel)).unwrap(), bytes);
        }
        assert_eq!(fs::read(f.root.join(auto_path)).unwrap(), startup);
        // Legacy root folders are read for migration, never projected or removed.
        for (folder, name, bytes) in legacy {
            assert_eq!(
                fs::read(f.root.join(format!("tf/cfg/{folder}/{name}"))).unwrap(),
                bytes
            );
        }
    }
}

#[test]
fn installed_renamed_and_extracted_loaders_agree_and_preserve_nested_cfgs() {
    for pack in [
        "mastercomfig-base.vpk",
        "renamed.vpk",
        "-renamed.vpk",
        "extracted",
    ] {
        let f = Fixture::new();
        f.write("tf/cfg/autoexec.cfg", b"echo existing root autoexec\n");
        f.write("tf/cfg/overrides/autoexec.cfg", b"exec personal/practice\n");
        f.write("tf/cfg/personal/practice.cfg", b"echo practice\n");
        if pack == "extracted" {
            for (rel, bytes) in loader_files() {
                f.write(&format!("tf/custom/{pack}/{rel}"), &bytes);
            }
        } else {
            f.write(
                &format!("tf/custom/{pack}"),
                &execs_core::vpk::write_vpk_v2(&loader_files()),
            );
        }
        assert_eq!(
            inventory_live_surface(&f.root).unwrap().layer,
            CfgLayer::Comfig,
            "{pack}"
        );
        let id = f.save();
        assert_eq!(
            get_active_profile_detail_from(&f.profiles, &f.root)
                .unwrap()
                .unwrap()
                .layer,
            CfgLayer::Comfig,
            "{pack}"
        );
        assert_eq!(
            f.stored(&id, "tf/cfg/personal/practice.cfg"),
            b"echo practice\n"
        );
        write_managed_cfg_to(
            &f.profiles,
            &f.root,
            &id,
            "tf/cfg/overrides/execs_binds.cfg",
            b"bind x +attack\n",
            unlocked(),
        )
        .unwrap();
        let auto = fs::read_to_string(f.root.join("tf/cfg/overrides/autoexec.cfg")).unwrap();
        assert!(auto.starts_with("exec personal/practice\n"));
        assert!(auto.contains("exec overrides/execs_binds"));
        assert_eq!(
            fs::read(f.root.join("tf/cfg/autoexec.cfg")).unwrap(),
            b"echo existing root autoexec\n"
        );
        let empty = f.empty_profile(&id);
        f.switch(&empty);
        f.switch(&id);
        assert_eq!(
            fs::read(f.root.join("tf/cfg/personal/practice.cfg")).unwrap(),
            b"echo practice\n"
        );
    }
}

#[test]
fn base_removal_refuses_stale_writes_then_uses_vanilla_after_update() {
    let f = Fixture::new();
    let base = "tf/custom/mastercomfig-base.vpk";
    f.write(base, &execs_core::vpk::write_vpk_v2(&loader_files()));
    f.write("tf/cfg/autoexec.cfg", b"echo existing root autoexec\n");
    f.write("tf/cfg/overrides/autoexec.cfg", b"echo previous override\n");
    let id = f.save();
    fs::remove_file(f.root.join(base)).unwrap();
    assert!(write_managed_cfg_to(
        &f.profiles,
        &f.root,
        &id,
        "tf/cfg/overrides/execs_binds.cfg",
        b"bind x +attack\n",
        unlocked()
    )
    .is_err());
    assert!(!f.root.join("tf/cfg/overrides/execs_binds.cfg").exists());
    f.choose(PackChoice::Update);
    assert_eq!(
        get_active_profile_detail_from(&f.profiles, &f.root)
            .unwrap()
            .unwrap()
            .layer,
        CfgLayer::Vanilla
    );
    write_managed_cfg_to(
        &f.profiles,
        &f.root,
        &id,
        "tf/cfg/execs_binds.cfg",
        b"bind x +attack\n",
        unlocked(),
    )
    .unwrap();
    assert!(fs::read_to_string(f.root.join("tf/cfg/autoexec.cfg"))
        .unwrap()
        .contains("exec execs_binds"));
    assert_eq!(
        fs::read(f.root.join("tf/cfg/overrides/autoexec.cfg")).unwrap(),
        b"echo previous override\n"
    );
}

#[test]
fn a_hidden_incomplete_or_shadowed_loader_does_not_prove_comfig() {
    for kind in ["hidden", "incomplete", "shadowed"] {
        let f = Fixture::new();
        let mut files = loader_files();
        if kind == "incomplete" {
            files.remove("cfg/comfig/comfig.cfg");
        }
        let name = if kind == "hidden" {
            ".base.vpk"
        } else {
            "mastercomfig-base.vpk"
        };
        f.write(
            &format!("tf/custom/{name}"),
            &execs_core::vpk::write_vpk_v2(&files),
        );
        if kind == "shadowed" {
            f.write(
                "tf/custom/aaa/cfg/autoexec.cfg",
                b"echo different startup loader\n",
            );
        }
        assert_eq!(
            inventory_live_surface(&f.root).unwrap().layer,
            CfgLayer::Vanilla,
            "{kind}"
        );
        f.save();
        assert_eq!(
            get_active_profile_detail_from(&f.profiles, &f.root)
                .unwrap()
                .unwrap()
                .layer,
            CfgLayer::Vanilla,
            "{kind}"
        );
    }
}

#[test]
#[ignore = "requires explicitly downloaded mastercomfig 9.100.1 assets"]
fn published_mastercomfig_base_and_standalone_addon_match_the_supported_loader() {
    let source_dir = PathBuf::from(std::env::var("EXECS_TEST_MASTERCOMFIG_DIR").unwrap());
    for (name, sha256, expected) in [
        (
            "mastercomfig-base.vpk",
            "cdabc8251864a1ab2ef7f7ffed1b44f52810956e476d62183b8d7e3e960d8650",
            CfgLayer::Comfig,
        ),
        (
            "mastercomfig-addon-no-soundscapes.vpk",
            "dfe1da93f6bd09c71df1592e9bb33b044c076b8a33fab370f8e6928dadbe44d9",
            CfgLayer::Vanilla,
        ),
    ] {
        let bytes =
            execs_core::hash::read_small_file_bounded(&source_dir.join(name), 1024 * 1024).unwrap();
        assert_eq!(execs_core::hash::sha256_hex(&bytes), sha256);
        let f = Fixture::new();
        f.write(&format!("tf/custom/{name}"), &bytes);
        f.write("tf/cfg/autoexec.cfg", b"echo vanilla startup\n");
        assert_eq!(inventory_live_surface(&f.root).unwrap().layer, expected);
        f.save();
        let detail = get_active_profile_detail_from(&f.profiles, &f.root)
            .unwrap()
            .unwrap();
        assert_eq!(detail.layer, expected);
        let prefix = if expected == CfgLayer::Comfig {
            "overrides/"
        } else {
            ""
        };
        write_managed_cfg_to(
            &f.profiles,
            &f.root,
            &detail.id,
            &format!("tf/cfg/{prefix}execs_binds.cfg"),
            b"bind x +attack\n",
            unlocked(),
        )
        .unwrap();
        assert!(
            fs::read_to_string(f.root.join(format!("tf/cfg/{prefix}autoexec.cfg")))
                .unwrap()
                .contains(&format!("exec {prefix}execs_binds"))
        );
        println!(
            "{name}: {} bytes, {sha256}, inventory/detail/write={expected:?}",
            bytes.len()
        );
    }
}
