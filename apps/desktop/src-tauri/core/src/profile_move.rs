//! Moving the profile library to TF2's new folder.
//!
//! The library remembers the TF2 folder it was made for. When Steam moves TF2
//! to another drive or library, or TF2 is reinstalled elsewhere, that folder no
//! longer holds TF2 and every profile would stay hidden behind a root mismatch.
//! Moving rewrites only the recorded folder in the index and manifests; profile
//! files, shared blobs and records are unchanged, and nothing in TF2 is written.

use super::*;

/// What moving the library to the confirmed install would do, or why it can't.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMoveReview {
    /// The TF2 folder the profiles were saved for.
    pub library_root: String,
    pub profile_count: usize,
    /// Why the move is refused, in words for the player. `None` when it can run.
    pub blocked_reason: Option<String>,
}

/// `None` when the library already belongs to `confirmed_root` or does not exist.
pub fn review_library_move_to(
    profiles_dir: &Path,
    confirmed_root: &Path,
) -> Result<Option<LibraryMoveReview>, ProfileError> {
    let Some(index) = load_index(profiles_dir)? else {
        return Ok(None);
    };
    if roots_match(&index.tf2_root, confirmed_root) {
        return Ok(None);
    }
    Ok(Some(LibraryMoveReview {
        blocked_reason: move_blocked_reason(profiles_dir, &index)?,
        library_root: index.tf2_root,
        profile_count: index.profiles.len(),
    }))
}

fn move_blocked_reason(
    profiles_dir: &Path,
    index: &LibraryIndex,
) -> Result<Option<String>, ProfileError> {
    let old = &index.tf2_root;
    // Two installs: the profiles' own folder still works, so moving them would
    // leave that install's setup without a profile.
    if crate::finder::normalize_tf2_root(Path::new(old)).is_ok() {
        return Ok(Some(format!(
            "TF2 is still installed at {old}. Choose that folder with Change install to use these profiles."
        )));
    }
    // Recovery records name the old folder and can only finish there.
    let unfinished = index
        .profiles
        .iter()
        .any(|profile| mutation_journal_file(profiles_dir, &profile.id).exists())
        || profiles_dir.join(".delete-journal.json").exists()
        || !matches!(
            crate::preloader::preloader_transaction_status(
                Path::new(old),
                &execs_data_dir_for(profiles_dir)
            ),
            Ok(crate::preloader::PreloaderTransactionStatus::None)
        );
    if unfinished {
        return Ok(Some(format!(
            "execs was finishing a change in {old} when TF2 moved. Move TF2 back there in Steam and open execs once to finish it, then move TF2 again."
        )));
    }
    Ok(None)
}

/// The data folder that holds `profiles_dir` (`<data dir>/profiles`).
fn execs_data_dir_for(profiles_dir: &Path) -> PathBuf {
    profiles_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| profiles_dir.to_path_buf())
}

/// Point the library and every manifest at `new_root`.
///
/// The active profile stays active only when the new folder still holds its
/// files (Steam moved the whole install). Otherwise, for example after a fresh
/// reinstall, no profile is active and the previous one is recorded as
/// interrupted, so the next switch removes any of its files that are present
/// instead of merging them; the player chooses which profile to install.
pub fn move_library_to<I, S>(
    profiles_dir: &Path,
    new_root: &Path,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_if_running_among(running_names)?;
    let new_root = crate::finder::normalize_tf2_root(new_root)
        .map_err(|error| ProfileError::Io(error.message()))?;
    let Some(mut index) = load_index(profiles_dir)? else {
        return Err(ProfileError::NotInitialized);
    };
    if roots_match(&index.tf2_root, &new_root) {
        return load_library_from(profiles_dir, Some(&new_root));
    }
    if let Some(reason) = move_blocked_reason(profiles_dir, &index)? {
        return Err(ProfileError::Io(reason));
    }
    let recorded = user_path_string(&new_root);
    // Manifests first, index last: until the index names the new folder the
    // library stays mismatched, so an interrupted move is simply offered again.
    for profile in &index.profiles {
        let mut manifest = load_manifest(profiles_dir, &profile.id)?;
        if manifest.tf2_root != recorded {
            manifest.tf2_root = recorded.clone();
            write_json_within(
                profiles_dir,
                &manifest_file(profiles_dir, &profile.id),
                &manifest,
            )?;
        }
    }
    if let Some(active) = index.active_profile_id.clone() {
        let manifest = load_manifest(profiles_dir, &active)?;
        if !live_holds_profile(profiles_dir, &new_root, &manifest) {
            index.active_profile_id = None;
            index.interrupted_profile_id.get_or_insert(active);
        }
    }
    index.tf2_root = recorded;
    write_json_within(profiles_dir, &index_file(profiles_dir), &index)?;
    load_library_from(profiles_dir, Some(&new_root))
}

/// True when every file the profile installs is in the live folder with the
/// size the profile saved. `config.cfg` only needs to exist: TF2 rewrites it
/// whenever it runs, and the normal absorb then takes that change.
fn live_holds_profile(profiles_dir: &Path, tf2_root: &Path, manifest: &ProfileManifest) -> bool {
    manifest.files.iter().all(|file| {
        let live = tf2_root.join(&file.path);
        let Ok(meta) = fs::symlink_metadata(&live) else {
            return false;
        };
        if !meta.is_file() {
            return false;
        }
        if file.path == "tf/cfg/config.cfg" {
            return true;
        }
        manifest_source_len(profiles_dir, &manifest.id, file).is_some_and(|len| len == meta.len())
    })
}

fn manifest_source_len(profiles_dir: &Path, profile_id: &str, file: &ProfileFile) -> Option<u64> {
    let source = crate::apply::manifest_source_path(profiles_dir, profile_id, file).ok()?;
    fs::metadata(source).ok().map(|meta| meta.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unlocked() -> [&'static str; 1] {
        ["explorer.exe"]
    }

    fn tf2(root: &Path) {
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        fs::write(root.join("tf/steam.inf"), "appID=440\n").unwrap();
    }

    /// A library with one active profile that owns config.cfg and one pack file.
    fn library(dir: &Path) -> (PathBuf, PathBuf, String) {
        let profiles = dir.join("execs").join("profiles");
        let old = dir.join("C").join("Team Fortress 2");
        tf2(&old);
        fs::write(old.join("tf/cfg/config.cfg"), "bind w +forward\n").unwrap();
        fs::create_dir_all(old.join("tf/custom/pack/materials")).unwrap();
        fs::write(old.join("tf/custom/pack/materials/a.vmt"), "vmt").unwrap();
        let library = save_current_as_to(
            &profiles,
            &old,
            "Main",
            unlocked(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let id = library.profiles[0].id.clone();
        assert_eq!(library.active_profile_id.as_deref(), Some(id.as_str()));
        (profiles, old, id)
    }

    fn copy_tree(from: &Path, to: &Path) {
        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                fs::create_dir_all(&target).unwrap();
                copy_tree(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), &target).unwrap();
            }
        }
    }

    #[test]
    fn a_steam_move_keeps_every_profile_and_the_active_one() {
        let dir = crate::test_temp_dir();
        let (profiles, old, id) = library(&dir);
        let new = dir.join("H").join("SteamLibrary").join("Team Fortress 2");
        fs::create_dir_all(&new).unwrap();
        copy_tree(&old, &new);
        fs::remove_dir_all(dir.join("C")).unwrap();

        let hidden = load_library_from(&profiles, Some(&new)).unwrap();
        assert!(hidden.root_mismatch && hidden.profiles.is_empty());
        let review = review_library_move_to(&profiles, &new).unwrap().unwrap();
        assert_eq!(review.profile_count, 1);
        assert_eq!(review.blocked_reason, None);
        assert_eq!(review.library_root, user_path_string(&old));

        let moved = move_library_to(&profiles, &new, unlocked()).unwrap();
        assert!(moved.usable && !moved.root_mismatch);
        assert_eq!(moved.active_profile_id.as_deref(), Some(id.as_str()));
        assert_eq!(
            load_manifest(&profiles, &id).unwrap().tf2_root,
            user_path_string(&fs::canonicalize(&new).unwrap())
        );
        assert!(review_library_move_to(&profiles, &new).unwrap().is_none());
        // Profile files are unchanged and nothing in TF2 was written.
        assert_eq!(
            fs::read_to_string(new.join("tf/cfg/config.cfg")).unwrap(),
            "bind w +forward\n"
        );
        crate::switch::switch_profile_to(
            &profiles,
            &new,
            &id,
            unlocked(),
            crate::absorb::AbsorbOptions::default(),
            |_| {},
        )
        .unwrap();
        cleanup(&dir);
    }

    #[test]
    fn a_fresh_reinstall_leaves_no_profile_active_until_one_is_chosen() {
        let dir = crate::test_temp_dir();
        let (profiles, _old, id) = library(&dir);
        fs::remove_dir_all(dir.join("C")).unwrap();
        let new = dir.join("D").join("Team Fortress 2");
        tf2(&new);

        let moved = move_library_to(&profiles, &new, unlocked()).unwrap();
        assert_eq!(moved.profiles.len(), 1);
        assert_eq!(moved.active_profile_id, None);
        assert_eq!(moved.interrupted_profile_id.as_deref(), Some(id.as_str()));
        let switched = crate::switch::switch_profile_to(
            &profiles,
            &new,
            &id,
            unlocked(),
            crate::absorb::AbsorbOptions::default(),
            |_| {},
        )
        .unwrap();
        assert_eq!(switched.active_profile_id.as_deref(), Some(id.as_str()));
        assert_eq!(
            fs::read(new.join("tf/custom/pack/materials/a.vmt")).unwrap(),
            b"vmt"
        );
        cleanup(&dir);
    }

    #[test]
    fn refuses_while_the_old_install_still_exists_or_tf2_runs() {
        let dir = crate::test_temp_dir();
        let (profiles, _old, _id) = library(&dir);
        let new = dir.join("D").join("Team Fortress 2");
        tf2(&new);
        let review = review_library_move_to(&profiles, &new).unwrap().unwrap();
        assert!(review
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("still installed")));
        assert!(move_library_to(&profiles, &new, unlocked()).is_err());
        let index_before = fs::read(index_file(&profiles)).unwrap();

        fs::remove_dir_all(dir.join("C")).unwrap();
        assert!(matches!(
            move_library_to(&profiles, &new, ["tf_win64.exe"]),
            Err(ProfileError::GameRunning)
        ));
        assert_eq!(fs::read(index_file(&profiles)).unwrap(), index_before);
        cleanup(&dir);
    }

    #[test]
    fn an_unfinished_profile_change_keeps_the_library_where_it_was() {
        let dir = crate::test_temp_dir();
        let (profiles, _old, id) = library(&dir);
        fs::remove_dir_all(dir.join("C")).unwrap();
        let new = dir.join("D").join("Team Fortress 2");
        tf2(&new);
        fs::write(mutation_journal_file(&profiles, &id), "{}").unwrap();
        let review = review_library_move_to(&profiles, &new).unwrap().unwrap();
        assert!(review
            .blocked_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("finishing a change")));
        assert!(move_library_to(&profiles, &new, unlocked()).is_err());
        assert!(
            load_library_from(&profiles, Some(&new))
                .unwrap()
                .root_mismatch
        );
        cleanup(&dir);
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }
}
