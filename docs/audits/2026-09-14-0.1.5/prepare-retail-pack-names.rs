//! Build synthetic mount fixtures with the production core import routines.
//! First argument must be a new output directory. Never points at live TF2.
use execs_core::{hud, mods, profile, vpk};
use std::{collections::BTreeMap, fs, path::PathBuf};

fn main() {
    let base = PathBuf::from(std::env::args().nth(1).expect("new fixture directory"));
    assert!(!base.exists(), "fixture directory must not exist");
    let root = base.join("install");
    let profiles = base.join("profiles");
    fs::create_dir_all(root.join("tf/cfg")).unwrap();
    fs::create_dir_all(root.join("tf/custom")).unwrap();
    fs::write(root.join("tf/steam.inf"), b"appID=440\n").unwrap();
    fs::write(root.join("tf/cfg/config.cfg"), b"sensitivity 2\n").unwrap();
    let saved = profile::save_current_as_to(
        &profiles,
        &root,
        "Retail names fixture",
        ["fixture"],
        profile::SaveCurrentOptions {
            launch_options: Some(""),
            cloud_config: None,
        },
    )
    .unwrap();
    let id = saved.active_profile_id.unwrap();
    for _ in 0..2 {
        mods::install_mod_to(
            &profiles,
            &root,
            &id,
            "materials.zip",
            mods::ModContent::Tree(vec![(
                "materials/audit/sample.vmt".into(),
                b"\"UnlitGeneric\" {}\n".to_vec(),
            )]),
            mods::ModSource::Local,
            ["fixture"],
        )
        .unwrap();
    }
    let bytes = vpk::write_vpk_v2(&BTreeMap::from([(
        "cfg/execs_fixture_vpk.cfg".into(),
        b"echo EXECS_RESERVED_VPK_OK\n".to_vec(),
    )]));
    mods::install_mod_to(
        &profiles,
        &root,
        &id,
        "materials.vpk",
        mods::ModContent::Vpk(bytes),
        mods::ModSource::Local,
        ["fixture"],
    )
    .unwrap();
    let source = base.join("resource");
    fs::create_dir_all(source.join("resource/ui")).unwrap();
    fs::write(
        source.join("info.vdf"),
        b"\"execs names fixture\" { \"ui_version\" \"3\" }\n",
    )
    .unwrap();
    fs::write(
        source.join("resource/ui/execs_fixture.res"),
        b"\"execs_fixture\" {}\n",
    )
    .unwrap();
    let extracted = hud::hud_tree_from_dir(&source).unwrap();
    hud::install_hud_pack_to(
        &profiles,
        &root,
        &id,
        &extracted.tree,
        profile::HudRecord {
            id: hud::hud_id_from_name("resource.zip"),
            hash: None,
            source: profile::HudSource::Local,
            options: BTreeMap::new(),
        },
        ["fixture"],
    )
    .unwrap();
    fs::rename(root.join("tf/custom"), base.join("custom")).unwrap();
    for name in [
        "mod-materials",
        "mod-materials-2",
        "hud-resource",
        "materials.vpk",
    ] {
        assert!(base.join("custom").join(name).exists());
        println!("{}", base.join("custom").join(name).display());
    }
}
