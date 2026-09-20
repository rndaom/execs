use super::*;
use crate::profile::{create_profile_record_to, set_active_profile_to};
use std::fs;
use std::path::PathBuf;

struct Fixture {
    dir: PathBuf,
    profiles: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let root = dir.join("tf2");
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        fs::write(root.join("tf/steam.inf"), b"appID=440\n").unwrap();
        let lib = create_profile_record_to(&profiles, &root, "Main", [] as [&str; 0]).unwrap();
        set_active_profile_to(&profiles, &root, &lib.profiles[0].id, [] as [&str; 0]).unwrap();
        Self {
            dir,
            profiles,
            root,
        }
    }
    fn absent(&self) -> FilesSource {
        FilesSource {
            context: context_from(&self.profiles, &self.root).unwrap(),
            sha256: None,
            library_sha256: None,
        }
    }
    fn save(
        &self,
        path: &str,
        text: &[u8],
        source: &FilesSource,
    ) -> Result<ProfileDetail, ProfileError> {
        save_to(
            &self.profiles,
            &self.root,
            path,
            text,
            source,
            [] as [&str; 0],
            WriteOwnedOptions {
                steam_roots: Some(&[]),
            },
        )
    }
    fn read(&self, path: &str) -> FilesContent {
        read_from(&self.profiles, &self.root, path).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn creates_empty_inventory_and_nested_helpers_then_rejects_stale_save() {
    let f = Fixture::new();
    let absent = f.absent();
    for path in [
        "tf/cfg/autoexec.cfg",
        "tf/cfg/heavyweapons.cfg",
        "tf/cfg/helpers/user/practice.cfg",
    ] {
        let detail = f
            .save(path, b"// preserved\necho hello\n", &absent)
            .unwrap();
        assert!(detail.files.iter().any(|file| file.path == path));
        let first = f.read(path);
        f.save(path, b"echo newer\n", &first.source).unwrap();
        assert_eq!(
            f.save(path, b"echo stale\n", &first.source).unwrap_err(),
            ProfileError::FileConflict
        );
        assert_eq!(fs::read(f.root.join(path)).unwrap(), b"echo newer\n");
    }
}

#[test]
fn external_edit_and_deletion_require_fresh_reviewed_source() {
    let f = Fixture::new();
    let path = "tf/cfg/autoexec.cfg";
    f.save(path, b"echo original\n", &f.absent()).unwrap();
    let old = f.read(path).source;
    fs::write(f.root.join(path), b"// external\necho external\n").unwrap();
    assert_eq!(
        f.save(path, b"echo draft\n", &old).unwrap_err(),
        ProfileError::FileConflict
    );
    let latest = f.read(path);
    assert_eq!(latest.text.as_deref(), Some("// external\necho external\n"));
    assert_ne!(latest.source.sha256, latest.source.library_sha256);
    f.save(path, b"// reviewed merge\n", &latest.source)
        .unwrap();
    let before_delete = f.read(path).source;
    fs::remove_file(f.root.join(path)).unwrap();
    assert_eq!(
        f.save(path, b"echo draft\n", &before_delete).unwrap_err(),
        ProfileError::FileConflict
    );
    let deleted = f.read(path);
    assert_eq!(deleted.source.sha256, None);
    assert!(!deleted.binary);
    f.save(path, b"// deliberately restored\n", &deleted.source)
        .unwrap();
}

#[test]
fn profile_root_loader_and_lock_rechecked_before_write() {
    let f = Fixture::new();
    let expected = f.absent();
    let path = "tf/cfg/autoexec.cfg";
    let mut changed = expected.clone();
    changed.context.root.push_str("-other");
    assert_eq!(
        f.save(path, b"", &changed).unwrap_err(),
        ProfileError::FilesRootChanged
    );
    changed = expected.clone();
    changed.context.profile_id.push_str("-other");
    assert_eq!(
        f.save(path, b"", &changed).unwrap_err(),
        ProfileError::FilesProfileChanged
    );
    changed = expected.clone();
    changed.context.layer = CfgLayer::Comfig;
    assert_eq!(
        f.save(path, b"", &changed).unwrap_err(),
        ProfileError::CfgLayerChanged
    );
    let process = if cfg!(windows) {
        "tf_win64.exe"
    } else {
        "tf_linux64"
    };
    assert_eq!(
        save_to(
            &f.profiles,
            &f.root,
            path,
            b"",
            &expected,
            [process],
            WriteOwnedOptions::default()
        )
        .unwrap_err(),
        ProfileError::GameRunning
    );
    assert!(!f.root.join(path).exists());
    assert!(load_manifest(&f.profiles, &expected.context.profile_id)
        .unwrap()
        .files
        .is_empty());
    let library = create_profile_record_to(&f.profiles, &f.root, "Other", [] as [&str; 0]).unwrap();
    let other = library
        .profiles
        .iter()
        .find(|profile| profile.id != expected.context.profile_id)
        .unwrap();
    set_active_profile_to(&f.profiles, &f.root, &other.id, [] as [&str; 0]).unwrap();
    assert_eq!(
        f.save(path, b"", &expected).unwrap_err(),
        ProfileError::FilesProfileChanged
    );
}

#[test]
fn creation_refuses_collisions_and_forbidden_destinations() {
    let f = Fixture::new();
    let absent = f.absent();
    for path in [
        "tf/cfg/user/autoexec.cfg",
        "tf/cfg/overrides/new.cfg",
        "tf/custom/hud/cfg/foo.cfg",
        "tf/cfg/config_default.cfg",
        "tf/cfg/config.cfg",
        "tf/cfg/execs_binds.cfg",
        "tf/cfg/nested/modules.cfg",
        "tf/cfg/CON.cfg",
        "tf/cfg/LPT¹.cfg",
        "tf/cfg/../foo.cfg",
        "tf/cfg/a.cfg:stream",
        "tf/cfg/a.cfg.",
        "C:/foo.cfg",
        "tf/cfg/a.txt",
    ] {
        assert!(f.save(path, b"", &absent).is_err(), "accepted {path}");
    }
    fs::write(f.root.join("tf/cfg/external.cfg"), b"keep").unwrap();
    assert_eq!(
        f.save("tf/cfg/external.cfg", b"", &absent).unwrap_err(),
        ProfileError::FileConflict
    );
    fs::create_dir_all(f.root.join("tf/cfg/Helpers")).unwrap();
    assert_eq!(
        f.save("tf/cfg/helpers/a.cfg", b"", &absent).unwrap_err(),
        ProfileError::FileConflict
    );
    f.save("tf/cfg/Foo.cfg", b"keep", &absent).unwrap();
    assert_eq!(
        f.save("tf/cfg/foo.cfg", b"", &absent).unwrap_err(),
        ProfileError::FileConflict
    );
    assert_eq!(fs::read(f.root.join("tf/cfg/Foo.cfg")).unwrap(), b"keep");
}

#[test]
fn comfig_creation_follows_verified_loader_and_detects_removal() {
    let f = Fixture::new();
    let old = f.absent();
    crate::cfg_layer::install_test_base(&f.profiles, &f.root, &old.context.profile_id);
    assert_eq!(
        f.save("tf/cfg/autoexec.cfg", b"", &old).unwrap_err(),
        ProfileError::CfgLayerChanged
    );
    let comfig = f.absent();
    assert_eq!(comfig.context.layer, CfgLayer::Comfig);
    f.save(
        "tf/cfg/overrides/heavyweapons.cfg",
        b"echo heavy\n",
        &comfig,
    )
    .unwrap();
    assert!(f.save("tf/cfg/autoexec.cfg", b"", &comfig).is_err());
    fs::remove_file(f.root.join("tf/custom/mastercomfig-base.vpk")).unwrap();
    assert_eq!(
        f.save("tf/cfg/overrides/helper.cfg", b"", &comfig)
            .unwrap_err(),
        ProfileError::CfgLayerChanged
    );
}

#[test]
fn source_identity_uses_actual_library_bytes_and_existing_config_keeps_cloud_retry() {
    let f = Fixture::new();
    let id = f.absent().context.profile_id;
    crate::apply::write_owned_file_to(
        &f.profiles,
        &f.root,
        &id,
        "tf/cfg/config.cfg",
        b"fov_desired 90\n",
        [] as [&str; 0],
        WriteOwnedOptions {
            steam_roots: Some(&[]),
        },
    )
    .unwrap();
    let source = f.read("tf/cfg/config.cfg").source;
    let steam = f.dir.join("Steam");
    let cloud = steam.join("userdata/111/440/remote/cfg/config.cfg");
    fs::create_dir_all(&cloud).unwrap();
    fs::create_dir_all(steam.join("userdata/111/config")).unwrap();
    fs::write(
        steam.join("userdata/111/config/localconfig.vdf"),
        "\"UserLocalConfigStore\"\n{\n}\n",
    )
    .unwrap();
    let roots = [steam];
    save_to(
        &f.profiles,
        &f.root,
        "tf/cfg/config.cfg",
        b"fov_desired 80\n",
        &source,
        [] as [&str; 0],
        WriteOwnedOptions {
            steam_roots: Some(&roots),
        },
    )
    .unwrap();
    assert_eq!(
        fs::read(f.root.join("tf/cfg/config.cfg")).unwrap(),
        b"fov_desired 80\n"
    );
    let manifest = load_manifest(&f.profiles, &id).unwrap();
    assert!(manifest.cloud_sync_pending);
    fs::remove_dir(&cloud).unwrap();
    crate::absorb::absorb_owned_to(
        &f.profiles,
        &f.root,
        [] as [&str; 0],
        crate::absorb::AbsorbOptions {
            cloud_config: None,
            steam_roots: Some(&roots),
        },
    )
    .unwrap();
    assert_eq!(fs::read(&cloud).unwrap(), b"fov_desired 80\n");
    assert!(!load_manifest(&f.profiles, &id).unwrap().cloud_sync_pending);
    let latest = f.read("tf/cfg/config.cfg").source;
    let library_path = crate::profile::exclusive_file_path(&f.profiles, &id, "tf/cfg/config.cfg");
    fs::write(library_path, b"fov_desired 70\n").unwrap();
    assert_eq!(
        f.save("tf/cfg/config.cfg", b"fov_desired 60\n", &latest)
            .unwrap_err(),
        ProfileError::FileConflict
    );
    assert!(matches!(
        read_from(&f.profiles, &f.root, "tf/cfg/config.cfg"),
        Err(ProfileError::FileConflict)
    ));
}

#[test]
fn non_utf8_is_read_only_and_size_limit_preserves_prior_bytes() {
    let f = Fixture::new();
    let path = "tf/cfg/autoexec.cfg";
    f.save(path, b"echo original\n", &f.absent()).unwrap();
    let source = f.read(path).source;
    assert!(f
        .save(path, &vec![b'x'; MAX_EDITOR_BYTES + 1], &source)
        .is_err());
    assert_eq!(fs::read(f.root.join(path)).unwrap(), b"echo original\n");
    fs::write(f.root.join(path), b"// \xff\n").unwrap();
    let current = f.read(path);
    assert!(current.binary);
    assert_eq!(current.text, None);
    assert!(f.save(path, b"replacement", &current.source).is_err());
    assert_eq!(fs::read(f.root.join(path)).unwrap(), b"// \xff\n");
}

#[test]
fn interrupted_creation_rolls_back_and_retry_exports_without_schema_change() {
    let f = Fixture::new();
    let expected = f.absent();
    let path = "tf/cfg/helpers/practice.cfg";
    let library_file =
        crate::profile::exclusive_file_path(&f.profiles, &expected.context.profile_id, path);
    let sampled_file = library_file.clone();
    let fired = std::rc::Rc::new(std::cell::Cell::new(false));
    let sampled_fired = fired.clone();
    let result = crate::profile::with_profile_process_sampler(
        move || {
            if sampled_file.is_file() && !sampled_fired.replace(true) {
                vec![if cfg!(windows) {
                    "tf_win64.exe"
                } else {
                    "tf_linux64"
                }
                .to_owned()]
            } else {
                Vec::new()
            }
        },
        || f.save(path, b"// manual helper\necho practice\n", &expected),
    );
    assert_eq!(result.unwrap_err(), ProfileError::GameRunning);
    assert!(fired.get());
    assert!(!library_file.exists());
    assert!(!f.root.join(path).exists());
    assert!(load_manifest(&f.profiles, &expected.context.profile_id)
        .unwrap()
        .files
        .is_empty());
    f.save(path, b"// manual helper\necho practice\n", &expected)
        .unwrap();
    let zip = f.dir.join("profile.zip");
    crate::zip::export_profile_to(&f.profiles, &f.root, &expected.context.profile_id, &zip)
        .unwrap();
    let imported =
        crate::zip::import_profile_from(&f.profiles, &f.root, &zip, [] as [&str; 0]).unwrap();
    let id = &imported
        .profiles
        .iter()
        .find(|profile| profile.id != expected.context.profile_id)
        .unwrap()
        .id;
    assert_eq!(
        crate::apply::profile_file_bytes_from(&f.profiles, id, path).unwrap(),
        b"// manual helper\necho practice\n"
    );
    assert_eq!(
        load_manifest(&f.profiles, id).unwrap().schema,
        load_manifest(&f.profiles, &expected.context.profile_id)
            .unwrap()
            .schema
    );
}

#[test]
fn provided_cfg_cannot_be_saved_even_with_valid_source() {
    let f = Fixture::new();
    let id = f.absent().context.profile_id;
    let path = "tf/custom/hud/cfg/hud.cfg";
    crate::apply::write_owned_file_to(
        &f.profiles,
        &f.root,
        &id,
        path,
        b"echo hud\n",
        [] as [&str; 0],
        WriteOwnedOptions::default(),
    )
    .unwrap();
    let source = f.read(path).source;
    assert!(matches!(
        f.save(path, b"echo changed\n", &source),
        Err(ProfileError::ForbiddenPath(_))
    ));
    assert_eq!(fs::read(f.root.join(path)).unwrap(), b"echo hud\n");
}

#[test]
fn focused_loader_matches_inventory_without_reading_unrelated_assets() {
    let f = Fixture::new();
    crate::cfg_layer::install_test_base(&f.profiles, &f.root, &f.absent().context.profile_id);
    fs::create_dir_all(f.root.join("tf/custom/large-mod/materials")).unwrap();
    let file = fs::File::create(f.root.join("tf/custom/large-mod/materials/large.vtf")).unwrap();
    file.set_len(128 * 1024 * 1024).unwrap();
    assert_eq!(
        crate::cfg_layer::cfg_layer_from_live(&f.root).unwrap(),
        CfgLayer::Comfig
    );
    assert_eq!(
        crate::cfg_layer::cfg_layer_from_live(&f.root).unwrap(),
        crate::surface::inventory_live_surface_for_absorb(&f.root, None)
            .unwrap()
            .layer
    );
}

#[test]
fn orphan_library_bytes_and_parent_case_collisions_are_not_claimed() {
    let f = Fixture::new();
    let source = f.absent();
    let path = "tf/cfg/orphan.cfg";
    let orphan = crate::profile::exclusive_file_path(&f.profiles, &source.context.profile_id, path);
    fs::create_dir_all(orphan.parent().unwrap()).unwrap();
    fs::write(&orphan, b"keep orphan").unwrap();
    assert_eq!(
        f.save(path, b"new", &source).unwrap_err(),
        ProfileError::FileConflict
    );
    assert_eq!(fs::read(&orphan).unwrap(), b"keep orphan");
    assert!(!f.root.join(path).exists());
    let mixed_parent = orphan.parent().unwrap().join("Helpers");
    fs::create_dir(&mixed_parent).unwrap();
    assert_eq!(
        f.save("tf/cfg/helpers/new.cfg", b"new", &source)
            .unwrap_err(),
        ProfileError::FileConflict
    );
    assert!(fs::read_dir(&mixed_parent).unwrap().next().is_none());
}

#[test]
fn live_edit_or_creation_during_staging_preserves_external_bytes() {
    for existing in [false, true] {
        let f = Fixture::new();
        let path = "tf/cfg/autoexec.cfg";
        let expected = if existing {
            f.save(path, b"echo original\n", &f.absent()).unwrap();
            f.read(path).source
        } else {
            f.absent()
        };
        let target = f.root.join(path);
        let sampled = target.clone();
        let fired = std::rc::Rc::new(std::cell::Cell::new(false));
        let sampled_fired = fired.clone();
        let result = crate::profile::with_profile_process_sampler(
            move || {
                if !sampled_fired.replace(true) {
                    fs::write(&sampled, b"echo external\n").unwrap();
                }
                Vec::new()
            },
            || f.save(path, b"echo draft\n", &expected),
        );
        assert_eq!(result.unwrap_err(), ProfileError::FileConflict);
        assert!(fired.get());
        assert_eq!(fs::read(target).unwrap(), b"echo external\n");
        let manifest = load_manifest(&f.profiles, &expected.context.profile_id).unwrap();
        if existing {
            assert_eq!(manifest.files[0].sha256, sha256_hex(b"echo original\n"));
        } else {
            assert!(manifest.files.is_empty());
        }
    }
}

#[test]
fn reviewed_restore_of_unchanged_library_bytes_reprojects_live() {
    for deleted in [false, true] {
        let f = Fixture::new();
        let path = "tf/cfg/autoexec.cfg";
        f.save(path, b"echo original\n", &f.absent()).unwrap();
        if deleted {
            fs::remove_file(f.root.join(path)).unwrap();
        } else {
            fs::write(f.root.join(path), b"echo external\n").unwrap();
        }
        let reviewed = f.read(path).source;
        f.save(path, b"echo original\n", &reviewed).unwrap();
        assert_eq!(fs::read(f.root.join(path)).unwrap(), b"echo original\n");
        assert_eq!(
            f.read(path).source.sha256,
            Some(sha256_hex(b"echo original\n"))
        );
    }
}
