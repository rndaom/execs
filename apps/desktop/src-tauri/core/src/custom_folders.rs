//! Source's wildcard mount names and explicitly reviewed legacy repairs.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::hash::{
    metadata_is_link, random_token, sha256_file, validate_dir_within, validate_file_within,
};
use crate::process_lock::refuse_if_running_among;
use crate::profile::{
    exclusive_file_path, load_library_from, load_manifest,
    mutate_profile_files_with_live_renames_to, normalize_rel_path, portable_path_key, FileSource,
    ProfileError, ProfileFile, ProfileLibrary, ProfileLiveRename,
};

/// These exact directory names make Valve's wildcard search-path loader call
/// Error. A VPK called `materials.vpk` is a different, valid mount name.
pub fn is_reserved_source_folder(name: &str) -> bool {
    [
        "materials",
        "maps",
        "resource",
        "scripts",
        "sound",
        "models",
    ]
    .iter()
    .any(|reserved| name.eq_ignore_ascii_case(reserved))
}

fn custom_folder(path: &str) -> Option<(String, String)> {
    let normalized = normalize_rel_path(path).ok()?;
    let mut parts = normalized.splitn(4, '/');
    if !parts.next()?.eq_ignore_ascii_case("tf") || !parts.next()?.eq_ignore_ascii_case("custom") {
        return None;
    }
    Some((parts.next()?.to_string(), parts.next()?.to_string()))
}

pub fn unsafe_custom_folders(files: &[ProfileFile]) -> Vec<String> {
    let mut folders: Vec<String> = files
        .iter()
        .filter_map(|file| custom_folder(&file.path))
        .map(|(folder, _)| folder)
        .filter(|folder| is_reserved_source_folder(folder))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    folders.sort_by_key(|folder| folder.to_ascii_lowercase());
    // A Windows snapshot can spell the same ancestor differently in separate
    // file entries. It still names one physical folder and one repair.
    if cfg!(windows) {
        folders.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    }
    folders
}

fn same_folder(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

pub fn validate_custom_mounts(files: &[ProfileFile]) -> Result<(), ProfileError> {
    let folders = unsafe_custom_folders(files);
    if folders.is_empty() {
        Ok(())
    } else {
        Err(ProfileError::Io(format!(
            "TF2 cannot mount these custom folder names: {}. Open Profiles and choose Repair folder names for this profile.",
            folders.join(", ")
        )))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFolderRepair {
    pub from: String,
    pub to: String,
}

pub fn plan_custom_folder_repair_to(
    profiles_dir: &Path,
    tf2_root: &Path,
    id: &str,
) -> Result<Vec<CustomFolderRepair>, ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if !library.usable {
        return Err(ProfileError::NotInitialized);
    }
    if !library.profiles.iter().any(|profile| profile.id == id) {
        return Err(ProfileError::UnknownProfile);
    }
    let manifest = load_manifest(profiles_dir, id)?;
    let mut taken: BTreeSet<String> = manifest
        .files
        .iter()
        .filter_map(|file| normalize_rel_path(&file.path).ok())
        .map(|path| path.to_ascii_lowercase())
        .filter_map(|path| path.strip_prefix("tf/custom/").map(str::to_string))
        .filter_map(|path| path.split('/').next().map(str::to_ascii_lowercase))
        .collect();
    taken.extend(
        manifest
            .mods
            .iter()
            .map(|record| record.id.to_ascii_lowercase()),
    );
    if let Some(hud) = &manifest.hud {
        taken.insert(hud.id.to_ascii_lowercase());
    }
    let custom = tf2_root.join("tf/custom");
    match fs::symlink_metadata(&custom) {
        Ok(meta) => {
            if metadata_is_link(&meta) || !meta.is_dir() {
                return Err(ProfileError::Io(
                    "The custom folder is linked or unreadable.".into(),
                ));
            }
            validate_dir_within(tf2_root, &custom).map_err(io_err)?;
            for entry in fs::read_dir(&custom).map_err(io_err)? {
                taken.insert(
                    entry
                        .map_err(io_err)?
                        .file_name()
                        .to_string_lossy()
                        .to_ascii_lowercase(),
                );
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(io_err(err)),
    }
    let mut plan = Vec::new();
    let folders = unsafe_custom_folders(&manifest.files);
    // The portable transaction cannot distinguish two real Linux rename
    // endpoints that differ only by case. Refuse that ambiguous source layout
    // before presenting a plan, rather than splitting one mod record.
    if folders
        .windows(2)
        .any(|pair| pair[0].eq_ignore_ascii_case(&pair[1]))
    {
        return Err(ProfileError::Io("This profile contains distinct custom folders that differ only by case. Rename the outer folders in the original source, then import or save that setup again.".into()));
    }
    for from in folders {
        let base = format!("custom-{}", from.to_ascii_lowercase());
        let mut to = base.clone();
        let mut suffix = 2;
        while taken.contains(&to) || taken.contains(&format!("{to}.vpk")) {
            to = format!("{base}-{suffix}");
            suffix += 1;
        }
        taken.insert(to.clone());
        plan.push(CustomFolderRepair { from, to });
    }
    Ok(plan)
}

/// Renames only reviewed outer containers. Payload bytes and relative author
/// paths are unchanged. Active trees are preserved outside mounted content
/// roots using the existing journaled backup namespace before projection.
pub fn repair_custom_folders_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    id: &str,
    reviewed: &[CustomFolderRepair],
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running)?;
    let plan = plan_custom_folder_repair_to(profiles_dir, tf2_root, id)?;
    if plan != reviewed || plan.is_empty() {
        return Err(ProfileError::Io(
            "The folder repair changed. Review it again before applying.".into(),
        ));
    }
    let manifest = load_manifest(profiles_dir, id)?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let active = library.active_profile_id.as_deref() == Some(id);
    let renamed_mod_ids: BTreeMap<_, _> = manifest
        .mods
        .iter()
        .filter_map(|record| {
            plan.iter()
                .find(|rename| record.pack.eq_ignore_ascii_case(&rename.from))
                .map(|rename| (record.id.clone(), rename.to.clone()))
        })
        .collect();
    if active {
        let available: Vec<String> = manifest
            .mods
            .iter()
            .filter(|record| {
                !plan
                    .iter()
                    .any(|rename| record.pack.eq_ignore_ascii_case(&rename.from))
            })
            .map(|record| record.id.clone())
            .collect();
        let data_dir = profiles_dir.parent().ok_or(ProfileError::InvalidPath)?;
        if crate::preloader::profile_particle_cleanup_selection(data_dir, &available)
            .map_err(ProfileError::Io)?
            .is_some()
        {
            return Err(ProfileError::Io("Turn off profile-sourced particles in Mods and choose Apply mods, or Restore stock files, before repairing these folder names.".into()));
        }
    } else if crate::preloader::selection_for_export(profiles_dir, id)?.is_some_and(|selection| {
        selection
            .profile_particle_mods
            .iter()
            .any(|id| renamed_mod_ids.contains_key(id))
    }) {
        // A prior owner can still hold the shared projection after interrupted
        // work. A library-only repair cannot rename that projection's sources.
        return Err(ProfileError::Io("Restore stock files in Mods before repairing this profile's folder names; its particle sources are still installed.".into()));
    }
    let mut sources = Vec::new();
    let mut remove = Vec::new();
    let mut expected_live = BTreeMap::new();
    for file in &manifest.files {
        let Some((folder, tail)) = custom_folder(&file.path) else {
            continue;
        };
        let Some(rename) = plan
            .iter()
            .find(|rename| same_folder(&rename.from, &folder))
        else {
            continue;
        };
        let source = exclusive_file_path(profiles_dir, id, &file.path);
        validate_file_within(profiles_dir, &source).map_err(io_err)?;
        if !sha256_file(&source)
            .map_err(io_err)?
            .eq_ignore_ascii_case(&file.sha256)
        {
            return Err(ProfileError::Io(format!(
                "Profile file failed integrity verification: {}",
                file.path
            )));
        }
        let len = fs::metadata(&source).map_err(io_err)?.len();
        sources.push((
            format!("tf/custom/{}/{tail}", rename.to),
            source,
            len,
            file.sha256.clone(),
        ));
        expected_live.insert(
            portable_path_key(&file.path)?,
            file.sha256.to_ascii_lowercase(),
        );
        remove.push(file.path.clone());
    }
    let mut renames = Vec::new();
    if active {
        let inventory = crate::surface::inventory_live_surface_for_absorb(tf2_root, None)?;
        let mut actual = BTreeMap::new();
        for entry in inventory.entries {
            let Some((folder, _)) = custom_folder(&entry.dest_rel) else {
                continue;
            };
            if plan.iter().any(|rename| same_folder(&rename.from, &folder)) {
                actual.insert(
                    portable_path_key(&entry.dest_rel)?,
                    sha256_file(&entry.source).map_err(io_err)?,
                );
            }
        }
        if actual != expected_live {
            return Err(ProfileError::Io("These custom folders changed since the profile was saved. Use Save current as… to capture the current files, then repair that profile.".into()));
        }
        let token = random_token();
        for rename in &plan {
            renames.push(ProfileLiveRename {
                from: format!("tf/custom/{}", rename.from),
                to: format!(
                    "tf/custom/{}/{token}/{}",
                    crate::surface::HUD_BACKUP_CONTAINER,
                    rename.from
                ),
            });
        }
    }
    let puts: Vec<_> = sources
        .iter()
        .map(|(dest, source, len, _)| {
            (
                dest.clone(),
                FileSource::PathExact {
                    path: source,
                    expected_len: *len,
                },
            )
        })
        .collect();
    mutate_profile_files_with_live_renames_to(
        profiles_dir,
        tf2_root,
        id,
        &puts,
        &remove,
        &renames,
        &running,
        |next| {
            // The transaction stages before this callback; compare staged
            // hashes too, so a changed library source cannot be published.
            for (path, _, _, expected) in &sources {
                if !next
                    .files
                    .iter()
                    .any(|file| &file.path == path && file.sha256.eq_ignore_ascii_case(expected))
                {
                    return Err(ProfileError::Io(
                        "A repair source changed. Review the repair again.".into(),
                    ));
                }
            }
            for rename in &plan {
                if let Some(hud) = &mut next.hud {
                    if hud.id.eq_ignore_ascii_case(&rename.from) {
                        hud.id = rename.to.clone();
                    }
                }
                for record in &mut next.mods {
                    if record.pack.eq_ignore_ascii_case(&rename.from) {
                        record.pack = rename.to.clone();
                        record.id = rename.to.clone();
                    }
                }
                next.ignored_packs
                    .retain(|pack| !pack.eq_ignore_ascii_case(&rename.from));
            }
            if let Some(selection) = &mut next.preloader {
                for id in &mut selection.profile_particle_mods {
                    if let Some(renamed) = renamed_mod_ids.get(id) {
                        *id = renamed.clone();
                    }
                }
            }
            Ok(())
        },
    )?;
    load_library_from(profiles_dir, Some(tf2_root))
}

fn io_err(err: std::io::Error) -> ProfileError {
    ProfileError::Io(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{save_current_as_to, save_manifest, SaveCurrentOptions};

    fn fixture() -> (
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
        String,
    ) {
        let area = crate::test_temp_dir();
        let root = area.join("tf2");
        let profiles = area.join("profiles");
        for (rel, bytes) in [
            ("tf/steam.inf", "appID=440\n"),
            ("tf/cfg/config.cfg", "password \"0\"\n"),
            (
                "tf/custom/materials/materials/audit/sample.vmt",
                "UnlitGeneric {}\n",
            ),
            ("tf/custom/custom-materials/keep.txt", "existing pack\n"),
            ("tf/custom/materials.vpk", "legacy opaque VPK\n"),
        ] {
            let path = root.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }
        let library = save_current_as_to(
            &profiles,
            &root,
            "Legacy",
            Vec::<String>::new(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let id = library.active_profile_id.unwrap();
        (area, profiles, root, id)
    }

    fn snapshot(root: &Path) -> BTreeMap<String, String> {
        let mut files = BTreeMap::new();
        fn visit(root: &Path, dir: &Path, files: &mut BTreeMap<String, String>) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries {
                    let path = entry.unwrap().path();
                    if path.is_dir() {
                        visit(root, &path, files);
                    } else {
                        files.insert(
                            path.strip_prefix(root)
                                .unwrap()
                                .to_string_lossy()
                                .replace('\\', "/"),
                            sha256_file(&path).unwrap(),
                        );
                    }
                }
            }
        }
        visit(root, root, &mut files);
        files
    }

    fn save_particle_selection(
        profiles: &Path,
        root: &Path,
        id: &str,
    ) -> crate::preloader::PreloaderSelection {
        let mut manifest = load_manifest(profiles, id).unwrap();
        for (id, pack) in [
            ("author-materials", "materials"),
            ("unchanged", "custom-materials"),
        ] {
            manifest.mods.push(crate::mods::ModRecord {
                id: id.into(),
                name: id.into(),
                source: crate::mods::ModSource::Local,
                pack: pack.into(),
                files: 1,
                bytes: 16,
                installed_at: "2026-09-14T00:00:00Z".into(),
            });
        }
        let selection = crate::preloader::PreloaderSelection {
            addons: vec!["library-addon".into()],
            particle_mods: vec!["library-particles".into()],
            profile_particle_mods: vec!["author-materials".into(), "unchanged".into()],
        };
        manifest.preloader = Some(selection.clone());
        save_manifest(profiles, root, &manifest, Vec::<String>::new()).unwrap();
        selection
    }

    #[test]
    fn saved_particle_selections_follow_repaired_mod_ids_for_active_and_inactive_profiles() {
        for active in [true, false] {
            let (area, profiles, root, id) = fixture();
            let library = save_current_as_to(
                &profiles,
                &root,
                "Other",
                Vec::<String>::new(),
                SaveCurrentOptions::default(),
            )
            .unwrap();
            let other_id = &library
                .profiles
                .iter()
                .find(|profile| profile.id != id)
                .unwrap()
                .id;
            let mut expected = save_particle_selection(&profiles, &root, &id);
            save_particle_selection(&profiles, &root, other_id);
            if !active {
                crate::profile::set_active_profile_to(
                    &profiles,
                    &root,
                    other_id,
                    Vec::<String>::new(),
                )
                .unwrap();
                let state_path = area.join("preloader/state.json");
                fs::create_dir_all(state_path.parent().unwrap()).unwrap();
                fs::write(
                    state_path,
                    serde_json::to_vec(&crate::preloader::PreloaderState {
                        selection_profile: Some(other_id.clone()),
                        profile_particle_mods: vec!["author-materials".into()],
                        ..Default::default()
                    })
                    .unwrap(),
                )
                .unwrap();
            }
            let live_before = snapshot(&root);
            let other_before = snapshot(&profiles.join(other_id));
            let preloader_before = snapshot(&area.join("preloader"));
            let plan = plan_custom_folder_repair_to(&profiles, &root, &id).unwrap();
            repair_custom_folders_to(&profiles, &root, &id, &plan, Vec::<String>::new()).unwrap();
            expected.profile_particle_mods[0] = plan[0].to.clone();
            assert_eq!(
                load_manifest(&profiles, &id).unwrap().preloader,
                Some(expected)
            );
            assert_eq!(snapshot(&profiles.join(other_id)), other_before);
            assert_eq!(snapshot(&area.join("preloader")), preloader_before);
            if !active {
                assert_eq!(snapshot(&root), live_before);
            }
            fs::remove_dir_all(area).unwrap();
        }
    }

    #[test]
    fn an_inactive_profile_with_installed_particle_sources_refuses_repair() {
        let (area, profiles, root, id) = fixture();
        save_particle_selection(&profiles, &root, &id);
        let library = crate::profile::create_profile_record_to(
            &profiles,
            &root,
            "Other",
            Vec::<String>::new(),
        )
        .unwrap();
        let other = library
            .profiles
            .iter()
            .find(|profile| profile.id != id)
            .unwrap();
        crate::profile::set_active_profile_to(&profiles, &root, &other.id, Vec::<String>::new())
            .unwrap();
        let state_path = area.join("preloader/state.json");
        fs::create_dir_all(state_path.parent().unwrap()).unwrap();
        fs::write(
            state_path,
            serde_json::to_vec(&crate::preloader::PreloaderState {
                selection_profile: Some(id.clone()),
                profile_particle_mods: vec!["author-materials".into()],
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
        let plan = plan_custom_folder_repair_to(&profiles, &root, &id).unwrap();
        let before = snapshot(&area);
        let error = repair_custom_folders_to(&profiles, &root, &id, &plan, Vec::<String>::new())
            .unwrap_err();
        assert!(error.message().contains("Restore stock files"));
        assert_eq!(snapshot(&area), before);
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn existing_profiles_diagnose_and_repair_outer_names_with_backups_and_metadata() {
        let (area, profiles, root, id) = fixture();
        let mut manifest = load_manifest(&profiles, &id).unwrap();
        manifest.mods.push(crate::mods::ModRecord {
            id: "materials".into(),
            name: "Author materials".into(),
            source: crate::mods::ModSource::Local,
            pack: "materials".into(),
            files: 1,
            bytes: 16,
            installed_at: "2026-09-14T00:00:00Z".into(),
        });
        manifest.ignored_packs.push("materials".into());
        save_manifest(&profiles, &root, &manifest, Vec::<String>::new()).unwrap();
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        assert_eq!(library.profiles[0].unsafe_custom_folders, ["materials"]);
        let before = snapshot(&area);
        assert!(
            crate::switch::validate_profile_switch_target(&profiles, &root, &id)
                .unwrap_err()
                .message()
                .contains("Repair folder names")
        );
        assert_eq!(snapshot(&area), before);
        let plan = plan_custom_folder_repair_to(&profiles, &root, &id).unwrap();
        assert_eq!(
            plan,
            [CustomFolderRepair {
                from: "materials".into(),
                to: "custom-materials-2".into()
            }]
        );
        let repaired =
            repair_custom_folders_to(&profiles, &root, &id, &plan, Vec::<String>::new()).unwrap();
        assert_eq!(repaired.active_profile_id.as_deref(), Some(id.as_str()));
        assert!(repaired.profiles[0].unsafe_custom_folders.is_empty());
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert_eq!(manifest.mods[0].pack, "custom-materials-2");
        assert_eq!(manifest.mods[0].id, "custom-materials-2");
        assert!(manifest.ignored_packs.is_empty());
        assert!(!root.join("tf/custom/materials").exists());
        let bytes =
            fs::read(root.join("tf/custom/custom-materials-2/materials/audit/sample.vmt")).unwrap();
        assert_eq!(bytes, b"UnlitGeneric {}\n");
        let backups = snapshot(&root.join(format!(
            "tf/custom/{}",
            crate::surface::HUD_BACKUP_CONTAINER
        )));
        assert!(backups.iter().any(|(path, hash)| path
            .ends_with("/materials/materials/audit/sample.vmt")
            && *hash == crate::hash::sha256_hex(&bytes)));
        assert_eq!(
            fs::read(root.join("tf/custom/custom-materials/keep.txt")).unwrap(),
            b"existing pack\n"
        );
        crate::switch::validate_profile_switch_target(&profiles, &root, &id).unwrap();
        let zip = area.join("repaired.zip");
        crate::zip::export_profile_to(&profiles, &root, &id, &zip).unwrap();
        crate::zip::import_profile_from(&profiles, &root, &zip, Vec::<String>::new()).unwrap();
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn review_lock_source_drift_and_collision_fail_without_changes() {
        let (area, profiles, root, id) = fixture();
        let plan = plan_custom_folder_repair_to(&profiles, &root, &id).unwrap();
        let before = snapshot(&area);
        assert_eq!(
            repair_custom_folders_to(&profiles, &root, &id, &plan, ["tf_win64.exe"]).unwrap_err(),
            ProfileError::GameRunning
        );
        assert_eq!(snapshot(&area), before);
        fs::create_dir_all(root.join("tf/custom/custom-materials-2")).unwrap();
        let err = repair_custom_folders_to(&profiles, &root, &id, &plan, Vec::<String>::new())
            .unwrap_err();
        assert!(err.message().contains("Review it again"));
        assert_eq!(snapshot(&area), before);
        let fresh = plan_custom_folder_repair_to(&profiles, &root, &id).unwrap();
        fs::write(
            root.join("tf/custom/materials/untracked.txt"),
            b"new user file",
        )
        .unwrap();
        let before = snapshot(&area);
        assert!(
            repair_custom_folders_to(&profiles, &root, &id, &fresh, Vec::<String>::new())
                .unwrap_err()
                .message()
                .contains("Save current as")
        );
        assert_eq!(snapshot(&area), before);
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn repair_rolls_back_after_the_live_folder_moves() {
        let (area, profiles, root, id) = fixture();
        let mut expected = save_particle_selection(&profiles, &root, &id);
        let plan = plan_custom_folder_repair_to(&profiles, &root, &id).unwrap();
        let before = snapshot(&area);
        let original = root.join("tf/custom/materials");
        let moved = std::rc::Rc::new(std::cell::Cell::new(false));
        let observed = moved.clone();
        let result = crate::profile::with_profile_process_sampler(
            move || {
                if !original.exists() && !observed.replace(true) {
                    vec!["tf_win64.exe".into()]
                } else {
                    Vec::new()
                }
            },
            || repair_custom_folders_to(&profiles, &root, &id, &plan, Vec::<String>::new()),
        );
        assert_eq!(result.unwrap_err(), ProfileError::GameRunning);
        assert!(moved.get());
        assert_eq!(snapshot(&area), before);
        repair_custom_folders_to(&profiles, &root, &id, &plan, Vec::<String>::new()).unwrap();
        expected.profile_particle_mods[0] = plan[0].to.clone();
        assert_eq!(
            load_manifest(&profiles, &id).unwrap().preloader,
            Some(expected)
        );
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn reserved_names_are_exact_case_insensitive_outer_directories() {
        let files = [
            "TF/CUSTOM/MaTeRiAlS/materials/a.vmt",
            "tf/custom/maps/maps/a.bsp",
            "tf/custom/resource/info.vdf",
            "tf/custom/scripts/a.txt",
            "tf/custom/sound/a.wav",
            "tf/custom/models/a.mdl",
            "tf/custom/materials.vpk",
            "tf/custom/ok/materials/a.vmt",
        ]
        .map(|path| ProfileFile {
            path: path.into(),
            sha256: "0".repeat(64),
            storage: crate::profile::FileStorage::Exclusive,
        });
        assert_eq!(unsafe_custom_folders(&files).len(), 6);
        assert!(validate_custom_mounts(&files[6..]).is_ok());
    }

    #[test]
    fn active_particle_source_references_block_repair_before_any_mutation() {
        let (area, profiles, root, id) = fixture();
        let state_path = area.join("preloader/state.json");
        fs::create_dir_all(state_path.parent().unwrap()).unwrap();
        fs::write(
            &state_path,
            serde_json::to_vec(&crate::preloader::PreloaderState {
                profile_particle_mods: vec!["materials".into()],
                ..Default::default()
            })
            .unwrap(),
        )
        .unwrap();
        let plan = plan_custom_folder_repair_to(&profiles, &root, &id).unwrap();
        let before = snapshot(&area);
        let error = repair_custom_folders_to(&profiles, &root, &id, &plan, Vec::<String>::new())
            .unwrap_err();
        assert!(error.message().contains("Apply mods"), "{error:?}");
        assert_eq!(snapshot(&area), before);
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn mixed_case_legacy_ancestors_are_one_windows_repair_or_an_explicit_linux_ambiguity() {
        let (area, profiles, root, id) = fixture();
        let mut manifest = load_manifest(&profiles, &id).unwrap();
        let extra = "tf/custom/Materials/materials/audit/other.vmt";
        let source = exclusive_file_path(&profiles, &id, extra);
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"other exact bytes").unwrap();
        let live = root.join(extra);
        fs::create_dir_all(live.parent().unwrap()).unwrap();
        fs::write(&live, b"other exact bytes").unwrap();
        manifest.files.push(ProfileFile {
            path: extra.into(),
            sha256: crate::hash::sha256_hex(b"other exact bytes"),
            storage: crate::profile::FileStorage::Exclusive,
        });
        // Reproduce an older on-disk manifest rather than asking the
        // metadata-only save API to change its file inventory.
        crate::hash::write_atomic(
            &crate::profile::manifest_file(&profiles, &id),
            &serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let before = snapshot(&area);
        if cfg!(windows) {
            let plan = plan_custom_folder_repair_to(&profiles, &root, &id).unwrap();
            assert_eq!(plan.len(), 1);
            repair_custom_folders_to(&profiles, &root, &id, &plan, Vec::<String>::new()).unwrap();
            assert_eq!(
                fs::read(root.join(format!(
                    "tf/custom/{}/materials/audit/other.vmt",
                    plan[0].to
                )))
                .unwrap(),
                b"other exact bytes"
            );
            assert!(
                unsafe_custom_folders(&load_manifest(&profiles, &id).unwrap().files).is_empty()
            );
        } else {
            assert!(plan_custom_folder_repair_to(&profiles, &root, &id)
                .unwrap_err()
                .message()
                .contains("differ only by case"));
            assert_eq!(snapshot(&area), before);
        }
        fs::remove_dir_all(area).unwrap();
    }
}
