//! Disposable command-flow fixtures: never touch player data or Steam Cloud.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use execs_core::absorb::AbsorbOptions;
use execs_core::preloader::{PreloaderSelection, PreloaderState, ProfileContext};
use execs_core::{ModContent, ModSource};

use super::switch_profile_command_to;

struct Fixture {
    dir: PathBuf,
    root: PathBuf,
    data: PathBuf,
    profiles: PathBuf,
    a: String,
    b: String,
    local_mod: String,
}

fn tiny_pcf(radius: f32) -> Vec<u8> {
    tiny_pcf_named("water_effect", radius)
}

fn tiny_pcf_named(system: &str, radius: f32) -> Vec<u8> {
    use execs_core::pcf::{PcfAttr, PcfElement, PcfFile, PcfValue};
    execs_core::pcf::encode_pcf(&PcfFile {
        version: execs_core::pcf::PCF_HEADERS[1].into(),
        string_dictionary: vec![
            b"DmeElement".to_vec(),
            b"DmeParticleSystemDefinition".to_vec(),
            b"particleSystemDefinitions".to_vec(),
            b"radius".to_vec(),
        ],
        elements: vec![
            PcfElement {
                type_name_index: 0,
                name: b"root".to_vec(),
                signature: [1; 16],
                attributes: vec![(
                    b"particleSystemDefinitions".to_vec(),
                    PcfAttr {
                        type_code: execs_core::pcf::ELEMENT_ARRAY_TYPE,
                        value: PcfValue::Array(vec![PcfValue::Element(1)]),
                    },
                )],
            },
            PcfElement {
                type_name_index: 1,
                name: system.as_bytes().to_vec(),
                signature: [2; 16],
                attributes: vec![(
                    b"radius".to_vec(),
                    PcfAttr {
                        type_code: 3,
                        value: PcfValue::Float(radius.to_bits()),
                    },
                )],
            },
        ],
    })
    .unwrap()
}

fn write_stock_vpk(root: &Path) {
    let mut tree = b"pcf\0particles\0".to_vec();
    let mut archive = Vec::new();
    for name in ["water", "water_dx80", "disguise"] {
        let mut stock = if name == "disguise" {
            tiny_pcf_named("spy_smoke", 3.0)
        } else {
            tiny_pcf(9.0)
        };
        stock.resize(stock.len() + 64, b' ');
        tree.extend_from_slice(name.as_bytes());
        tree.push(0);
        let mut crc = u32::MAX;
        for byte in &stock {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb8_8320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        tree.extend_from_slice(&(!crc).to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&0u16.to_le_bytes());
        tree.extend_from_slice(&(archive.len() as u32).to_le_bytes());
        tree.extend_from_slice(&(stock.len() as u32).to_le_bytes());
        tree.extend_from_slice(&0xffffu16.to_le_bytes());
        archive.extend(stock);
    }
    tree.extend_from_slice(&[0, 0, 0]);
    let mut directory = Vec::new();
    directory.extend_from_slice(&0x55aa_1234u32.to_le_bytes());
    directory.extend_from_slice(&1u32.to_le_bytes());
    directory.extend_from_slice(&(tree.len() as u32).to_le_bytes());
    directory.extend(tree);
    fs::write(root.join("tf/tf2_misc_dir.vpk"), directory).unwrap();
    fs::write(root.join("tf/tf2_misc_000.vpk"), archive).unwrap();
    // Source shadow validation also reads these real-format, empty indexes.
    let empty = execs_core::vpk::write_vpk_v2(&BTreeMap::new());
    fs::write(root.join("tf/tf2_textures_dir.vpk"), &empty).unwrap();
    fs::write(root.join("tf/tf2_sound_misc_dir.vpk"), empty).unwrap();
}

impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "execs-profile-flow-{}",
            execs_core::hash::random_token()
        ));
        let root = dir.join("TF2");
        let data = dir.join("data");
        let profiles = data.join("profiles");
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        fs::write(root.join("tf/steam.inf"), "appID=440\n").unwrap();
        fs::write(
            root.join("tf/gameinfo.txt"),
            "\"GameInfo\"\n{\n type multiplayer_only\n}\n",
        )
        .unwrap();
        fs::write(root.join("tf/cfg/config.cfg"), "sensitivity 2\n").unwrap();
        write_stock_vpk(&root);
        let library = execs_core::profile::save_current_as_to(
            &profiles,
            &root,
            "A",
            ["test"],
            execs_core::profile::SaveCurrentOptions {
                launch_options: Some(""),
                ..Default::default()
            },
        )
        .unwrap();
        let a = library.active_profile_id.unwrap();
        let library =
            execs_core::profile::create_profile_record_to(&profiles, &root, "B", ["test"]).unwrap();
        let b = library
            .profiles
            .iter()
            .find(|profile| profile.id != a)
            .unwrap()
            .id
            .clone();
        let detail = execs_core::mods::install_mod_to(
            &profiles,
            &root,
            &a,
            "Local water",
            ModContent::Tree(vec![("particles/water.pcf".into(), tiny_pcf(77.0))]),
            ModSource::Local,
            ["test"],
        )
        .unwrap();
        let local_mod = detail.mods[0].id.clone();
        let selected = PreloaderSelection {
            profile_particle_mods: vec![local_mod.clone()],
            ..Default::default()
        };
        execs_core::preloader::apply_profile_preloader(
            &root,
            &data,
            &data.join("no-default-library.zip"),
            &selected,
            &ProfileContext {
                profiles: profiles.clone(),
                id: a.clone(),
            },
            &[],
            &Vec::new,
        )
        .unwrap();
        Self {
            dir,
            root,
            data,
            profiles,
            a,
            b,
            local_mod,
        }
    }

    fn switch(&self, id: &str) -> Result<execs_core::ProfileLibrary, crate::error::CommandError> {
        switch_profile_command_to(
            &self.profiles,
            &self.root,
            id,
            vec![],
            AbsorbOptions {
                steam_roots: Some(&[]),
                ..Default::default()
            },
            |_| {},
        )
    }

    fn state(&self) -> PreloaderState {
        serde_json::from_slice(&fs::read(self.data.join("preloader/state.json")).unwrap()).unwrap()
    }

    fn selected(&self, id: &str) -> PreloaderSelection {
        execs_core::load_manifest(&self.profiles, id)
            .unwrap()
            .preloader
            .unwrap_or_default()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn command_local_particles_round_trip_reapply_restart_and_export_import_without_library() {
    let f = Fixture::new();
    let directory = fs::read(f.root.join("tf/tf2_misc_dir.vpk")).unwrap();
    let selected_bytes = fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap();
    f.switch(&f.b).unwrap();
    assert!(f.state().profile_particle_mods.is_empty());
    assert_eq!(
        f.selected(&f.a).profile_particle_mods,
        std::slice::from_ref(&f.local_mod)
    );
    assert_ne!(
        fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap(),
        selected_bytes
    );
    // A new command reads ownership from disk; no renderer/session state is used.
    f.switch(&f.a).unwrap();
    assert_eq!(
        fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap(),
        selected_bytes
    );
    fs::write(f.root.join("tf/cfg/config.cfg"), b"sensitivity 8\n").unwrap();
    f.switch(&f.a).unwrap();
    assert_eq!(
        fs::read(f.root.join("tf/cfg/config.cfg")).unwrap(),
        b"sensitivity 8\n"
    );
    let export = f.dir.join("local-profile.zip");
    execs_core::export_profile_to(&f.profiles, &f.root, &f.a, &export).unwrap();
    let imported =
        execs_core::import_profile_from(&f.profiles, &f.root, &export, ["test"]).unwrap();
    let id = imported
        .profiles
        .iter()
        .find(|p| p.id != f.a && p.id != f.b)
        .unwrap()
        .id
        .clone();
    assert_eq!(
        f.selected(&id).profile_particle_mods,
        std::slice::from_ref(&f.local_mod)
    );
    f.switch(&id).unwrap();
    assert_eq!(
        fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap(),
        selected_bytes
    );
    assert_eq!(
        fs::read(f.root.join("tf/tf2_misc_dir.vpk")).unwrap(),
        directory
    );
    assert!(!f
        .data
        .join(format!(
            "preloader/mods-{}.zip",
            execs_core::preloader::MODS_RELEASE
        ))
        .exists());
}

#[test]
fn command_legacy_migration_keeps_local_source_choices_before_switching_away() {
    let f = Fixture::new();
    let mut state = f.state();
    state.selection_profile = None;
    state.preload_profiles = vec![f.a.clone()];
    fs::write(
        f.data.join("preloader/state.json"),
        serde_json::to_vec(&state).unwrap(),
    )
    .unwrap();
    let mut manifest = execs_core::load_manifest(&f.profiles, &f.a).unwrap();
    manifest.preloader = None;
    fs::write(
        execs_core::profile::manifest_file(&f.profiles, &f.a),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    f.switch(&f.b).unwrap();
    assert_eq!(
        f.selected(&f.a).profile_particle_mods,
        std::slice::from_ref(&f.local_mod)
    );
    assert!(f.selected(&f.b).is_empty());
    f.switch(&f.a).unwrap();
    assert_eq!(f.state().selection_profile.as_deref(), Some(f.a.as_str()));
    assert_eq!(
        f.state().profile_particle_mods,
        std::slice::from_ref(&f.local_mod)
    );
}

#[test]
fn command_default_library_preflight_refusal_preserves_source_bytes_owner_and_choices() {
    let f = Fixture::new();
    let before = fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap();
    let state = fs::read(f.data.join("preloader/state.json")).unwrap();
    let saved_before = f.selected(&f.a);
    execs_core::profile::mutate_profile_files_to(
        &f.profiles,
        &f.root,
        &f.b,
        &[],
        &[],
        execs_core::profile::ProfileLiveProjection::LibraryOnly,
        ["test"],
        |manifest| {
            manifest.preloader = Some(PreloaderSelection {
                addons: vec!["Low / Flat textures".into()],
                ..Default::default()
            });
            Ok(())
        },
    )
    .unwrap();
    let error = f.switch(&f.b).unwrap_err();
    assert_eq!(error.code, "LegacyCasualSourceMissing");
    assert!(error.message.contains("saved Casual library choices"));
    assert_eq!(
        fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap(),
        before
    );
    assert_eq!(
        fs::read(f.data.join("preloader/state.json")).unwrap(),
        state
    );
    assert_eq!(
        execs_core::profile::load_library_from(&f.profiles, Some(&f.root))
            .unwrap()
            .active_profile_id
            .as_deref(),
        Some(f.a.as_str())
    );
    assert_eq!(f.selected(&f.a), saved_before);
    assert_eq!(
        execs_core::preloader::selection_for_export(&f.profiles, &f.a)
            .unwrap()
            .unwrap()
            .profile_particle_mods,
        std::slice::from_ref(&f.local_mod)
    );
}

#[test]
fn selected_source_direct_and_external_removal_refuse_without_changing_owner() {
    let f = Fixture::new();
    // The command delegates directly to the ownership guard, with no cleanup.
    let before = fs::read(f.data.join("preloader/state.json")).unwrap();
    assert_eq!(
        execs_core::mods::remove_mod_to(&f.profiles, &f.root, &f.a, &f.local_mod, ["test"])
            .unwrap_err()
            .code(),
        "ParticleSourceSelected"
    );
    let manifest = execs_core::load_manifest(&f.profiles, &f.a).unwrap();
    let pack = &manifest.mods[0].pack;
    fs::remove_dir_all(f.root.join("tf/custom").join(pack)).unwrap();
    assert_eq!(
        execs_core::absorb::absorb_packs_to(
            &f.profiles,
            &f.root,
            execs_core::PackChoice::Update,
            ["test"],
            AbsorbOptions {
                steam_roots: Some(&[]),
                ..Default::default()
            }
        )
        .unwrap_err()
        .code(),
        "ParticleSourceSelected"
    );
    assert_eq!(
        fs::read(f.data.join("preloader/state.json")).unwrap(),
        before
    );
    assert!(execs_core::load_manifest(&f.profiles, &f.a)
        .unwrap()
        .mods
        .iter()
        .any(|record| record.id == f.local_mod));
}

#[test]
fn command_interrupted_switch_recovers_without_erasing_the_source_selection() {
    let f = Fixture::new();
    execs_core::profile::put_exclusive_file_to(
        &f.profiles,
        &f.root,
        &f.b,
        "tf/cfg/autoexec.cfg",
        b"echo target\n",
        ["test"],
    )
    .unwrap();
    let source = execs_core::profile::exclusive_file_path(&f.profiles, &f.b, "tf/cfg/autoexec.cfg");
    let before = fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap();
    let error = switch_profile_command_to(
        &f.profiles,
        &f.root,
        &f.b,
        vec![],
        AbsorbOptions {
            steam_roots: Some(&[]),
            ..Default::default()
        },
        |progress| {
            if progress.step == execs_core::SwitchStep::Write {
                // A source becomes unreadable after full target validation,
                // simulating interruption after the durable switch boundary.
                fs::remove_file(&source).unwrap();
            }
        },
    )
    .unwrap_err();
    assert!(error.message.contains("Re-apply") || error.message.contains("re-apply"));
    let interrupted = execs_core::profile::load_library_from(&f.profiles, Some(&f.root)).unwrap();
    assert_eq!(interrupted.active_profile_id, None);
    assert_eq!(
        interrupted.pending_switch_profile_id.as_deref(),
        Some(f.b.as_str())
    );
    assert_eq!(
        f.selected(&f.a).profile_particle_mods,
        std::slice::from_ref(&f.local_mod)
    );
    assert_eq!(
        fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap(),
        before
    );
    fs::write(&source, b"echo target\n").unwrap();
    f.switch(&f.b).unwrap();
    f.switch(&f.a).unwrap();
    assert_eq!(
        fs::read(f.root.join("tf/tf2_misc_000.vpk")).unwrap(),
        before
    );
    assert_eq!(f.state().selection_profile.as_deref(), Some(f.a.as_str()));
}
