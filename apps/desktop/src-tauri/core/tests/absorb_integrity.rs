//! Regressions for incomplete inventories and case-only renames. These tests
//! isolate both profiles and the live surface and never discover real Steam.
use execs_core::absorb::{absorb_owned_to, absorb_packs_to, AbsorbOptions, PackChoice};
use execs_core::mods::{install_mod_to, ModContent, ModSource};
use execs_core::profile::{
    create_profile_record_to, exclusive_file_path, load_manifest, save_current_as_to,
    SaveCurrentOptions,
};
use execs_core::switch::switch_profile_to;
use std::{fs, path::PathBuf};

const MENU: &str = "tf/custom/mypack/resource/menu.res";
const OTHER: &str = "tf/custom/mypack/readme.txt";

struct Fixture {
    base: PathBuf,
    root: PathBuf,
    profiles: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!("execs-absorb-{}", uuid::Uuid::new_v4()));
        let root = base.join("game");
        let profiles = base.join("profiles");
        fs::create_dir_all(root.join("tf/custom/mypack/resource")).unwrap();
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::write(root.join("tf/steam.inf"), "appID=440\n").unwrap();
        fs::write(root.join(MENU), "original customization").unwrap();
        fs::write(root.join(OTHER), "other pack file").unwrap();
        Self {
            base,
            root,
            profiles,
        }
    }

    fn save(&self) -> String {
        save_current_as_to(
            &self.profiles,
            &self.root,
            "Main",
            unlocked(),
            save_options(),
        )
        .unwrap()
        .active_profile_id
        .unwrap()
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

    fn switch(&self, target: &str) {
        let result = switch_profile_to(
            &self.profiles,
            &self.root,
            target,
            unlocked(),
            absorb_options(),
            |_| {},
        )
        .unwrap();
        assert_eq!(result.active_profile_id.as_deref(), Some(target));
    }

    fn absorb(&self) {
        absorb_owned_to(&self.profiles, &self.root, unlocked(), absorb_options()).unwrap();
    }

    fn install_mod(&self, id: &str, vpk: bool) -> String {
        let content = if vpk {
            ModContent::Vpk(execs_core::vpk::write_vpk_v2(
                &[("materials/test.vmt".into(), b"material".to_vec())]
                    .into_iter()
                    .collect(),
            ))
        } else {
            ModContent::Tree(vec![
                ("materials/test.vmt".into(), b"material".to_vec()),
                ("materials/other.vmt".into(), b"other".to_vec()),
            ])
        };
        install_mod_to(
            &self.profiles,
            &self.root,
            id,
            "audit-pack",
            content,
            ModSource::Local,
            unlocked(),
        )
        .unwrap();
        load_manifest(&self.profiles, id).unwrap().mods[0]
            .pack
            .clone()
    }

    fn choose(&self, choice: PackChoice) {
        absorb_packs_to(
            &self.profiles,
            &self.root,
            choice,
            unlocked(),
            absorb_options(),
        )
        .unwrap();
    }

    fn save_metadata(&self, manifest: &execs_core::profile::ProfileManifest) {
        execs_core::profile::mutate_profile_files_to(
            &self.profiles,
            &self.root,
            &manifest.id,
            &[],
            &[],
            execs_core::profile::ProfileLiveProjection::LibraryOnly,
            unlocked(),
            |next| {
                next.hud = manifest.hud.clone();
                next.hitsound = manifest.hitsound.clone();
                next.viewmodel = manifest.viewmodel.clone();
                Ok(())
            },
        )
        .unwrap();
    }

    fn round_trip(&self, id: &str) -> String {
        let zip = self.base.join("profile.zip");
        execs_core::zip::export_profile_to(&self.profiles, &self.root, id, &zip).unwrap();
        let old = execs_core::profile::load_library_from(&self.profiles, Some(&self.root)).unwrap();
        let library =
            execs_core::zip::import_profile_from(&self.profiles, &self.root, &zip, unlocked())
                .unwrap();
        library
            .profiles
            .iter()
            .find(|p| !old.profiles.iter().any(|old| old.id == p.id))
            .unwrap()
            .id
            .clone()
    }
}

#[test]
fn accepted_mod_removal_exports_imports_and_switches_without_stale_records() {
    for vpk in [false, true] {
        let f = Fixture::new();
        let id = f.save();
        let pack = f.install_mod(&id, vpk);
        let live = f.root.join("tf/custom").join(&pack);
        if vpk {
            fs::remove_file(&live).unwrap();
        } else {
            fs::remove_dir_all(&live).unwrap();
        }
        f.absorb();
        assert_eq!(load_manifest(&f.profiles, &id).unwrap().mods.len(), 1);
        f.choose(PackChoice::Update);
        assert!(load_manifest(&f.profiles, &id).unwrap().mods.is_empty());
        let imported = f.round_trip(&id);
        f.switch(&imported);
        f.switch(&id);
        assert!(!live.exists());
        assert!(load_manifest(&f.profiles, &imported)
            .unwrap()
            .mods
            .is_empty());
    }
}

#[test]
fn accepted_hud_removal_clears_its_record_but_keep_and_restore_preserve_it() {
    use execs_core::profile::{HudRecord, HudSource};
    for choice in [PackChoice::Update, PackChoice::Keep, PackChoice::Restore] {
        let f = Fixture::new();
        fs::write(f.root.join("tf/custom/mypack/info.vdf"), b"hud").unwrap();
        let id = f.save();
        let mut manifest = load_manifest(&f.profiles, &id).unwrap();
        manifest.hud = Some(HudRecord {
            id: "mypack".into(),
            hash: None,
            source: HudSource::Local,
            options: Default::default(),
        });
        f.save_metadata(&manifest);
        fs::remove_dir_all(f.root.join("tf/custom/mypack")).unwrap();
        f.choose(choice);
        assert_eq!(
            load_manifest(&f.profiles, &id).unwrap().hud.is_none(),
            choice == PackChoice::Update
        );
        f.round_trip(&id);
    }
}

#[test]
fn managed_sound_and_viewmodel_deletions_self_heal_and_keep_records() {
    use execs_core::hitsound::{HitsoundEntry, HitsoundRecord, HitsoundSource, HITSOUND_REL};
    use execs_core::profile::{ViewmodelRecord, ViewmodelSource};
    use execs_core::viewmodel::EXECS_VIEWMODELS_VPK;
    let f = Fixture::new();
    fs::create_dir_all(f.root.join("tf/custom/execs-hitsounds/sound/ui")).unwrap();
    fs::write(f.root.join(HITSOUND_REL), b"original sound bytes").unwrap();
    fs::write(
        f.root.join(EXECS_VIEWMODELS_VPK),
        b"original viewmodel bytes",
    )
    .unwrap();
    let id = f.save();
    let mut before = load_manifest(&f.profiles, &id).unwrap();
    before.hitsound = Some(HitsoundRecord {
        hit: Some(HitsoundEntry::new("sound".into(), HitsoundSource::File)),
        kill: None,
    });
    before.viewmodel = Some(ViewmodelRecord {
        id: "execs-viewmodels".into(),
        source: ViewmodelSource::Imported,
        preload: false,
        options: Default::default(),
    });
    f.save_metadata(&before);
    fs::remove_file(f.root.join(HITSOUND_REL)).unwrap();
    fs::remove_file(f.root.join(EXECS_VIEWMODELS_VPK)).unwrap();
    f.choose(PackChoice::Update);
    let after = load_manifest(&f.profiles, &id).unwrap();
    assert_eq!(after.hitsound, before.hitsound);
    assert_eq!(after.viewmodel, before.viewmodel);
    assert_eq!(
        fs::read(f.root.join(HITSOUND_REL)).unwrap(),
        b"original sound bytes"
    );
    assert_eq!(
        fs::read(f.root.join(EXECS_VIEWMODELS_VPK)).unwrap(),
        b"original viewmodel bytes"
    );
}

#[test]
fn partial_mod_changes_recompute_counts_and_bytes_and_round_trip() {
    let f = Fixture::new();
    let id = f.save();
    let pack = f.install_mod(&id, false);
    let live = f.root.join("tf/custom").join(&pack);
    fs::remove_file(live.join("materials/other.vmt")).unwrap();
    fs::write(live.join("materials/test.vmt"), b"edited material").unwrap();
    f.absorb();
    let record = load_manifest(&f.profiles, &id).unwrap().mods.remove(0);
    assert_eq!((record.files, record.bytes), (1, 15));
    fs::write(live.join("materials/new.vmt"), b"new").unwrap();
    f.absorb();
    let manifest = load_manifest(&f.profiles, &id).unwrap();
    assert_eq!((manifest.mods[0].files, manifest.mods[0].bytes), (2, 18));
    let imported = f.round_trip(&id);
    assert_eq!(
        load_manifest(&f.profiles, &imported).unwrap().mods,
        manifest.mods
    );
    f.switch(&imported);
    assert_eq!(
        fs::read(live.join("materials/test.vmt")).unwrap(),
        b"edited material"
    );
    assert!(!live.join("materials/other.vmt").exists());
}

#[test]
fn keep_and_restore_preserve_missing_mod_records_and_payload() {
    for choice in [PackChoice::Keep, PackChoice::Restore] {
        let f = Fixture::new();
        let id = f.save();
        let pack = f.install_mod(&id, false);
        let before = load_manifest(&f.profiles, &id).unwrap();
        fs::remove_dir_all(f.root.join("tf/custom").join(&pack)).unwrap();
        f.choose(choice);
        let after = load_manifest(&f.profiles, &id).unwrap();
        assert_eq!(after.mods, before.mods);
        assert_eq!(after.files, before.files);
        f.round_trip(&id);
        let empty = f.empty_profile(&id);
        f.switch(&empty);
        f.switch(&id);
        assert_eq!(
            fs::read(
                f.root
                    .join("tf/custom")
                    .join(pack)
                    .join("materials/test.vmt")
            )
            .unwrap(),
            b"material"
        );
    }
}

#[test]
fn rename_to_dashed_peer_drops_only_old_record_and_preserves_new_bytes() {
    let f = Fixture::new();
    let id = f.save();
    let pack = f.install_mod(&id, false);
    let renamed = f.root.join("tf/custom").join(format!("-{pack}"));
    fs::rename(f.root.join("tf/custom").join(&pack), &renamed).unwrap();
    f.choose(PackChoice::Update);
    assert!(load_manifest(&f.profiles, &id).unwrap().mods.is_empty());
    let imported = f.round_trip(&id);
    f.switch(&imported);
    assert_eq!(
        fs::read(renamed.join("materials/test.vmt")).unwrap(),
        b"material"
    );
}

#[test]
#[cfg(windows)]
fn unreadable_mod_inventory_and_write_lock_do_not_remove_records() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let id = f.save();
    let pack = f.install_mod(&id, false);
    let before = load_manifest(&f.profiles, &id).unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(
            f.root
                .join("tf/custom")
                .join(pack)
                .join("materials/test.vmt"),
        )
        .unwrap();
    assert!(absorb_packs_to(
        &f.profiles,
        &f.root,
        PackChoice::Update,
        unlocked(),
        absorb_options()
    )
    .is_err());
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
    drop(lock);
    assert!(absorb_packs_to(
        &f.profiles,
        &f.root,
        PackChoice::Update,
        ["tf_win64.exe"],
        absorb_options()
    )
    .is_err());
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn unlocked() -> std::iter::Empty<&'static str> {
    std::iter::empty()
}
fn save_options() -> SaveCurrentOptions<'static> {
    SaveCurrentOptions {
        launch_options: Some(""),
        cloud_config: None,
    }
}
fn absorb_options() -> AbsorbOptions<'static> {
    AbsorbOptions {
        cloud_config: None,
        steam_roots: Some(&[]),
    }
}

#[test]
#[cfg(windows)]
fn unreadable_owned_file_preserves_library_and_blocks_switch_until_retry() {
    use execs_core::profile::load_library_from;
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let id = f.save();
    let target = f.empty_profile(&id);
    let before = load_manifest(&f.profiles, &id).unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(f.root.join(MENU))
        .unwrap();
    assert!(absorb_owned_to(&f.profiles, &f.root, unlocked(), absorb_options()).is_err());
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
    assert_eq!(
        fs::read(exclusive_file_path(&f.profiles, &id, MENU)).unwrap(),
        b"original customization"
    );
    assert!(switch_profile_to(
        &f.profiles,
        &f.root,
        &target,
        unlocked(),
        absorb_options(),
        |_| {}
    )
    .is_err());
    assert_eq!(
        load_library_from(&f.profiles, Some(&f.root))
            .unwrap()
            .active_profile_id
            .as_deref(),
        Some(id.as_str())
    );
    assert!(f.root.join(OTHER).is_file());
    drop(lock);
    fs::write(f.root.join(MENU), "edited after retry").unwrap();
    f.absorb();
    assert_eq!(
        fs::read(exclusive_file_path(&f.profiles, &id, MENU)).unwrap(),
        b"edited after retry"
    );
    f.switch(&target);
    assert!(!f.root.join(MENU).exists());
    f.switch(&id);
    assert_eq!(fs::read(f.root.join(MENU)).unwrap(), b"edited after retry");
}

#[test]
#[cfg(windows)]
fn save_current_refuses_an_unreadable_custom_file() {
    use execs_core::profile::load_library_from;
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(f.root.join(MENU))
        .unwrap();
    assert!(save_current_as_to(
        &f.profiles,
        &f.root,
        "Incomplete",
        unlocked(),
        save_options()
    )
    .is_err());
    assert!(load_library_from(&f.profiles, Some(&f.root))
        .unwrap()
        .profiles
        .is_empty());
    drop(lock);
    let id = f.save();
    assert!(load_manifest(&f.profiles, &id)
        .unwrap()
        .files
        .iter()
        .any(|f| f.path == MENU));
}

#[test]
fn case_only_file_and_directory_renames_survive_absorb_and_switch_round_trips() {
    for directory in [false, true] {
        for edit in [false, true] {
            for explicit_absorb in [false, true] {
                let f = Fixture::new();
                let id = f.save();
                let target = f.empty_profile(&id);
                let renamed = if directory {
                    fs::rename(
                        f.root.join("tf/custom/mypack/resource"),
                        f.root.join("tf/custom/mypack/Resource"),
                    )
                    .unwrap();
                    "tf/custom/mypack/Resource/menu.res"
                } else {
                    fs::rename(
                        f.root.join(MENU),
                        f.root.join("tf/custom/mypack/resource/Menu.res"),
                    )
                    .unwrap();
                    "tf/custom/mypack/resource/Menu.res"
                };
                let expected = if edit {
                    "edited customization"
                } else {
                    "original customization"
                };
                if edit {
                    fs::write(f.root.join(renamed), expected).unwrap();
                }
                if explicit_absorb {
                    f.absorb();
                }
                f.switch(&target);
                assert!(
                    !f.root.join(renamed).exists(),
                    "the previous file must not leak into the empty profile"
                );
                assert!(load_manifest(&f.profiles, &target)
                    .unwrap()
                    .files
                    .is_empty());
                let manifest = load_manifest(&f.profiles, &id).unwrap();
                let saved = manifest
                    .files
                    .iter()
                    .find(|p| p.path.to_lowercase() == MENU)
                    .unwrap();
                assert_eq!(
                    fs::read(exclusive_file_path(&f.profiles, &id, &saved.path)).unwrap(),
                    expected.as_bytes()
                );
                #[cfg(windows)]
                assert_eq!(saved.path, MENU);
                #[cfg(not(windows))]
                assert_eq!(saved.path, renamed);
                f.switch(&id);
                assert_eq!(
                    fs::read(f.root.join(&saved.path)).unwrap(),
                    expected.as_bytes()
                );
            }
        }
    }
}

#[test]
fn a_real_nested_file_deletion_is_still_absorbed() {
    let f = Fixture::new();
    let id = f.save();
    fs::remove_file(f.root.join(MENU)).unwrap();
    f.absorb();
    assert!(!load_manifest(&f.profiles, &id)
        .unwrap()
        .files
        .iter()
        .any(|p| p.path == MENU));
    assert!(!exclusive_file_path(&f.profiles, &id, MENU).exists());
    assert!(exclusive_file_path(&f.profiles, &id, OTHER).exists());
}

#[test]
#[cfg(windows)]
fn unreadable_owned_directory_preserves_its_entire_library_subtree() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let id = f.save();
    let before = load_manifest(&f.profiles, &id).unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .custom_flags(0x02000000) // FILE_FLAG_BACKUP_SEMANTICS opens a directory handle.
        .open(f.root.join("tf/custom/mypack/resource"))
        .unwrap();
    assert!(absorb_owned_to(&f.profiles, &f.root, unlocked(), absorb_options()).is_err());
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
    assert_eq!(
        fs::read(exclusive_file_path(&f.profiles, &id, MENU)).unwrap(),
        b"original customization"
    );
    drop(lock);
    f.absorb();
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
}

#[test]
#[cfg(windows)]
fn a_locked_global_pack_is_still_excluded_from_capture() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let global = f.root.join("tf/custom/execs-preloader.vpk");
    fs::write(&global, "global pack").unwrap();
    let _lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&global)
        .unwrap();
    let id = f.save();
    let manifest = load_manifest(&f.profiles, &id).unwrap();
    assert_eq!(manifest.files.len(), 2);
    f.absorb();
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), manifest);
}

#[test]
fn a_case_renamed_file_in_a_dashed_pack_keeps_its_bytes_and_ownership() {
    let f = Fixture::new();
    fs::rename(
        f.root.join("tf/custom/mypack"),
        f.root.join("tf/custom/-mypack"),
    )
    .unwrap();
    let id = f.save();
    let target = f.empty_profile(&id);
    let renamed = "tf/custom/-mypack/resource/Menu.res";
    fs::rename(
        f.root.join("tf/custom/-mypack/resource/menu.res"),
        f.root.join(renamed),
    )
    .unwrap();
    fs::write(f.root.join(renamed), "dashed edit").unwrap();
    f.absorb();
    f.switch(&target);
    assert!(!f.root.join(renamed).exists());
    f.switch(&id);
    let manifest = load_manifest(&f.profiles, &id).unwrap();
    let saved = manifest
        .files
        .iter()
        .find(|p| p.path.to_lowercase() == MENU.replace("mypack", "-mypack"))
        .unwrap();
    assert_eq!(fs::read(f.root.join(&saved.path)).unwrap(), b"dashed edit");
    assert!(saved.path.contains("-mypack"));
}

#[test]
#[cfg(not(windows))]
fn case_distinct_live_files_cannot_silently_replace_each_other() {
    let f = Fixture::new();
    let id = f.save();
    let before = load_manifest(&f.profiles, &id).unwrap();
    fs::write(
        f.root.join("tf/custom/mypack/resource/Menu.res"),
        "distinct file",
    )
    .unwrap();
    assert!(absorb_owned_to(&f.profiles, &f.root, unlocked(), absorb_options()).is_err());
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
    assert_eq!(
        fs::read(exclusive_file_path(&f.profiles, &id, MENU)).unwrap(),
        b"original customization"
    );
}
