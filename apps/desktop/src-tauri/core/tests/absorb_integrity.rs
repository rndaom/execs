//! Regressions for incomplete inventories and case-only renames. These tests
//! isolate both profiles and the live surface and never discover real Steam.
use execs_core::absorb::{absorb_owned_to, AbsorbOptions};
use execs_core::profile::{
    create_profile_record_to, exclusive_file_path, load_manifest,
    save_current_as_to, SaveCurrentOptions,
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
        Self { base, root, profiles }
    }

    fn save(&self) -> String {
        save_current_as_to(&self.profiles, &self.root, "Main", unlocked(), save_options())
            .unwrap().active_profile_id.unwrap()
    }

    fn empty_profile(&self, current: &str) -> String {
        create_profile_record_to(&self.profiles, &self.root, "Empty", unlocked())
            .unwrap().profiles.into_iter().find(|p| p.id != current).unwrap().id
    }

    fn switch(&self, target: &str) {
        let result = switch_profile_to(
            &self.profiles, &self.root, target, unlocked(), absorb_options(), |_| {},
        ).unwrap();
        assert_eq!(result.active_profile_id.as_deref(), Some(target));
    }

    fn absorb(&self) {
        absorb_owned_to(&self.profiles, &self.root, unlocked(), absorb_options()).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.base); }
}

fn unlocked() -> std::iter::Empty<&'static str> { std::iter::empty() }
fn save_options() -> SaveCurrentOptions<'static> {
    SaveCurrentOptions { launch_options: Some(""), cloud_config: None }
}
fn absorb_options() -> AbsorbOptions<'static> {
    AbsorbOptions { cloud_config: None, steam_roots: Some(&[]) }
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
    let lock = fs::OpenOptions::new().read(true).share_mode(0).open(f.root.join(MENU)).unwrap();
    assert!(absorb_owned_to(&f.profiles, &f.root, unlocked(), absorb_options()).is_err());
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
    assert_eq!(fs::read(exclusive_file_path(&f.profiles, &id, MENU)).unwrap(), b"original customization");
    assert!(switch_profile_to(&f.profiles, &f.root, &target, unlocked(), absorb_options(), |_| {}).is_err());
    assert_eq!(load_library_from(&f.profiles, Some(&f.root)).unwrap().active_profile_id.as_deref(), Some(id.as_str()));
    assert!(f.root.join(OTHER).is_file());
    drop(lock);
    fs::write(f.root.join(MENU), "edited after retry").unwrap();
    f.absorb();
    assert_eq!(fs::read(exclusive_file_path(&f.profiles, &id, MENU)).unwrap(), b"edited after retry");
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
    let lock = fs::OpenOptions::new().read(true).share_mode(0).open(f.root.join(MENU)).unwrap();
    assert!(save_current_as_to(&f.profiles, &f.root, "Incomplete", unlocked(), save_options()).is_err());
    assert!(load_library_from(&f.profiles, Some(&f.root)).unwrap().profiles.is_empty());
    drop(lock);
    let id = f.save();
    assert!(load_manifest(&f.profiles, &id).unwrap().files.iter().any(|f| f.path == MENU));
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
                    fs::rename(f.root.join("tf/custom/mypack/resource"), f.root.join("tf/custom/mypack/Resource")).unwrap();
                    "tf/custom/mypack/Resource/menu.res"
                } else {
                    fs::rename(f.root.join(MENU), f.root.join("tf/custom/mypack/resource/Menu.res")).unwrap();
                    "tf/custom/mypack/resource/Menu.res"
                };
                let expected = if edit { "edited customization" } else { "original customization" };
                if edit { fs::write(f.root.join(renamed), expected).unwrap(); }
                if explicit_absorb { f.absorb(); }
                f.switch(&target);
                assert!(!f.root.join(renamed).exists(), "the previous file must not leak into the empty profile");
                assert!(load_manifest(&f.profiles, &target).unwrap().files.is_empty());
                let manifest = load_manifest(&f.profiles, &id).unwrap();
                let saved = manifest.files.iter().find(|p| p.path.to_lowercase() == MENU).unwrap();
                assert_eq!(fs::read(exclusive_file_path(&f.profiles, &id, &saved.path)).unwrap(), expected.as_bytes());
                #[cfg(windows)]
                assert_eq!(saved.path, MENU);
                #[cfg(not(windows))]
                assert_eq!(saved.path, renamed);
                f.switch(&id);
                assert_eq!(fs::read(f.root.join(&saved.path)).unwrap(), expected.as_bytes());
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
    assert!(!load_manifest(&f.profiles, &id).unwrap().files.iter().any(|p| p.path == MENU));
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
    assert_eq!(fs::read(exclusive_file_path(&f.profiles, &id, MENU)).unwrap(), b"original customization");
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
    let _lock = fs::OpenOptions::new().read(true).share_mode(0).open(&global).unwrap();
    let id = f.save();
    let manifest = load_manifest(&f.profiles, &id).unwrap();
    assert_eq!(manifest.files.len(), 2);
    f.absorb();
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), manifest);
}

#[test]
fn a_case_renamed_file_in_a_disabled_pack_keeps_its_bytes_and_ownership() {
    let f = Fixture::new();
    let id = f.save();
    let target = f.empty_profile(&id);
    fs::rename(f.root.join("tf/custom/mypack"), f.root.join("tf/custom/-mypack")).unwrap();
    let renamed = "tf/custom/-mypack/resource/Menu.res";
    fs::rename(f.root.join("tf/custom/-mypack/resource/menu.res"), f.root.join(renamed)).unwrap();
    fs::write(f.root.join(renamed), "disabled edit").unwrap();
    f.absorb();
    f.switch(&target);
    assert!(!f.root.join(renamed).exists());
    f.switch(&id);
    let manifest = load_manifest(&f.profiles, &id).unwrap();
    let saved = manifest.files.iter().find(|p| p.path.to_lowercase() == MENU).unwrap();
    assert_eq!(fs::read(f.root.join(&saved.path)).unwrap(), b"disabled edit");
    assert!(!saved.path.contains("-mypack"));
}

#[test]
#[cfg(not(windows))]
fn case_distinct_live_files_cannot_silently_replace_each_other() {
    let f = Fixture::new();
    let id = f.save();
    let before = load_manifest(&f.profiles, &id).unwrap();
    fs::write(f.root.join("tf/custom/mypack/resource/Menu.res"), "distinct file").unwrap();
    assert!(absorb_owned_to(&f.profiles, &f.root, unlocked(), absorb_options()).is_err());
    assert_eq!(load_manifest(&f.profiles, &id).unwrap(), before);
    assert_eq!(fs::read(exclusive_file_path(&f.profiles, &id, MENU)).unwrap(), b"original customization");
}
