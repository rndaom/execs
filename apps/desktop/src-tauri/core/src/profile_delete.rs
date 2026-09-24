//! Explicit library deletion. The index is the commit point; TF2 is untouched.

use super::*;

const DELETE_JOURNAL: &str = ".delete-journal.json";
const MAX_DELETE_JOURNAL_BYTES: usize = 16 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteJournal {
    schema: u32,
    transaction_id: String,
    profile_id: String,
    tf2_root: String,
    before_index_sha256: String,
    after_index_sha256: String,
}

fn deletion_path(profiles: &Path) -> PathBuf {
    profiles.join(DELETE_JOURNAL)
}

fn digest_valid(digest: &str) -> bool {
    digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn read_deletion(profiles: &Path, root: &Path) -> Result<Option<DeleteJournal>, ProfileError> {
    let path = deletion_path(profiles);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(ProfileError::Io(error.to_string())),
        Ok(metadata) if crate::hash::metadata_is_link(&metadata) || !metadata.is_file() => {
            return Err(ProfileError::Io("Invalid profile-deletion journal.".into()));
        }
        Ok(_) => {}
    }
    validate_file_within(profiles, &path).map_err(|error| ProfileError::Io(error.to_string()))?;
    let text = read_small_text_bounded(&path, MAX_DELETE_JOURNAL_BYTES)
        .map_err(|error| ProfileError::Io(error.to_string()))?;
    let journal: DeleteJournal =
        serde_json::from_str(&text).map_err(|error| ProfileError::Io(error.to_string()))?;
    if journal.schema != 1
        || !valid_profile_id(&journal.profile_id)
        || !valid_transaction_id(&journal.transaction_id)
        || !digest_valid(&journal.before_index_sha256)
        || !digest_valid(&journal.after_index_sha256)
        || journal.before_index_sha256 == journal.after_index_sha256
        || !roots_match(&journal.tf2_root, root)
    {
        return Err(ProfileError::Io("Invalid profile-deletion journal.".into()));
    }
    Ok(Some(journal))
}

fn write_deletion(profiles: &Path, journal: &DeleteJournal) -> Result<(), ProfileError> {
    let bytes =
        serde_json::to_vec_pretty(journal).map_err(|error| ProfileError::Io(error.to_string()))?;
    if bytes.len() > MAX_DELETE_JOURNAL_BYTES {
        return Err(ProfileError::Io(
            "Profile-deletion journal is too large.".into(),
        ));
    }
    write_atomic_within(profiles, &deletion_path(profiles), &bytes)
        .map_err(|error| ProfileError::Io(error.to_string()))
}

fn journal_state(
    profiles: &Path,
    root: &Path,
    journal: &DeleteJournal,
) -> Result<ProfileMutationRecoveryState, ProfileError> {
    let index = usable_index(profiles, root)?;
    if index.pending_switch.is_some() || index.interrupted_profile_id.is_some() {
        return Err(ProfileError::Io(
            "Profile deletion and a profile switch are both pending. No files were changed.".into(),
        ));
    }
    let digest =
        sha256_file(&index_file(profiles)).map_err(|error| ProfileError::Io(error.to_string()))?;
    let listed = index
        .profiles
        .iter()
        .any(|profile| profile.id == journal.profile_id);
    if digest == journal.before_index_sha256 && listed {
        Ok(ProfileMutationRecoveryState::Prepared)
    } else if digest == journal.after_index_sha256 && !listed {
        Ok(ProfileMutationRecoveryState::Committed)
    } else {
        Err(ProfileError::Io(
            "The profile library changed during deletion. Recovery kept its remaining files."
                .into(),
        ))
    }
}

pub(super) fn deletion_status_to(
    profiles: &Path,
    root: &Path,
) -> Result<Option<ProfileMutationRecoveryState>, ProfileError> {
    read_deletion(profiles, root)?
        .as_ref()
        .map(|journal| journal_state(profiles, root, journal))
        .transpose()
}

/// Check the entire target before committing, including unindexed recovery
/// files. Never follow a link, junction or special file during cleanup.
fn preflight_tree(profiles: &Path, id: &str) -> Result<bool, ProfileError> {
    let dir = profile_dir(profiles, id);
    match fs::symlink_metadata(&dir) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(ProfileError::Io(error.to_string())),
        Ok(_) => {}
    }
    validated_profile_root(profiles, id)?;
    let mut pending = vec![(dir, 0usize)];
    let mut entries = 0usize;
    while let Some((dir, depth)) = pending.pop() {
        if depth > MAX_PROFILE_PATH_DEPTH + 8 {
            return Err(ProfileError::Io(
                "Profile data is too deep to delete safely.".into(),
            ));
        }
        validate_dir_within(profiles, &dir).map_err(|error| ProfileError::Io(error.to_string()))?;
        for entry in fs::read_dir(&dir).map_err(|error| ProfileError::Io(error.to_string()))? {
            entries += 1;
            if entries > MAX_TRANSACTION_TREE_ENTRIES {
                return Err(ProfileError::Io(
                    "Profile data is too large to delete safely.".into(),
                ));
            }
            let path = entry
                .map_err(|error| ProfileError::Io(error.to_string()))?
                .path();
            let metadata =
                fs::symlink_metadata(&path).map_err(|error| ProfileError::Io(error.to_string()))?;
            if crate::hash::metadata_is_link(&metadata) {
                return Err(ProfileError::Io(
                    "Profile data contains a linked path.".into(),
                ));
            }
            if metadata.is_dir() {
                pending.push((path, depth + 1));
            } else if metadata.is_file() {
                validate_file_within(profiles, &path)
                    .map_err(|error| ProfileError::Io(error.to_string()))?;
            } else {
                return Err(ProfileError::Io(
                    "Profile data contains a special file.".into(),
                ));
            }
        }
    }
    Ok(true)
}

pub(super) fn recover_deletion_to(profiles: &Path, root: &Path) -> Result<(), ProfileError> {
    let Some(journal) = read_deletion(profiles, root)? else {
        return Ok(());
    };
    let state = journal_state(profiles, root, &journal)?;
    refuse_writes(profile_live_process_names())?;
    if state == ProfileMutationRecoveryState::Committed {
        if preflight_tree(profiles, &journal.profile_id)? {
            remove_transaction_tree(profiles, &profile_dir(profiles, &journal.profile_id))?;
        }
        // Keep installed preloader bytes and original snapshots. The old
        // selection owner remains a tombstone until the next Apply/switch,
        // so legacy migration cannot give its choices to another profile.
        let data = profiles.parent().ok_or(ProfileError::InvalidPath)?;
        refuse_writes(profile_live_process_names())?;
        crate::preloader::forget_preload_profile(data, &journal.profile_id)
            .map_err(ProfileError::Io)?;
        let index = usable_index(profiles, root)?;
        if let Ok(referenced) = referenced_shared_hashes(profiles, &index) {
            // An unreadable remaining manifest must preserve every blob.
            refuse_writes(profile_live_process_names())?;
            let _ = gc_unreferenced_blobs(profiles, &referenced);
        }
    }
    // Prepared means the index never committed: cancel without touching the
    // profile. Committed means cleanup completed. Both are restart-safe.
    refuse_writes(profile_live_process_names())?;
    remove_file_force_within(profiles, &deletion_path(profiles))
        .map_err(|error| ProfileError::Io(error.to_string()))
}

/// Remove only one saved library entry. An active profile requires the
/// caller's explicit keep-installed choice; this function never writes TF2.
/// The command holds WriteGate. The journal makes index publication atomic
/// with respect to restart recovery, and records unfinished payload cleanup.
pub fn delete_profile_to<I, S>(
    profiles: &Path,
    root: &Path,
    id: &str,
    keep_installed: bool,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let mut index = usable_index(profiles, root)?;
    if index.pending_switch.is_some()
        || index.interrupted_profile_id.is_some()
        || profile_mutation_status_to(profiles, root)? != ProfileMutationRecoveryState::Clean
    {
        return Err(ProfileError::Io(
            "Finish the interrupted profile operation before deleting a profile.".into(),
        ));
    }
    let data = profiles.parent().ok_or(ProfileError::InvalidPath)?;
    if crate::preloader::preloader_transaction_status(root, data).map_err(ProfileError::Io)?
        != crate::preloader::PreloaderTransactionStatus::None
    {
        return Err(ProfileError::Io(
            "Recover the interrupted Casual-preloader change before deleting a profile.".into(),
        ));
    }
    if !index.profiles.iter().any(|profile| profile.id == id) {
        return Err(ProfileError::UnknownProfile);
    }
    if index.active_profile_id.as_deref() == Some(id) && !keep_installed {
        return Err(ProfileError::Io(
            "Switch to another profile, or explicitly keep the installed TF2 files, before deleting the active profile."
                .into(),
        ));
    }
    preflight_tree(profiles, id)?;
    let before_index_sha256 =
        sha256_file(&index_file(profiles)).map_err(|error| ProfileError::Io(error.to_string()))?;
    index.profiles.retain(|profile| profile.id != id);
    if index.active_profile_id.as_deref() == Some(id) {
        index.active_profile_id = None;
        // Keep installed leaves the exact live setup in TF2 after its owner
        // disappears. Preserve that fact across restarts until Save current
        // as… has captured the retained bytes in a new profile.
        index.pending_live_handoff = true;
    }
    let after_bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(&index)
            .map_err(|error| ProfileError::Io(error.to_string()))?
    );
    let journal = DeleteJournal {
        schema: 1,
        transaction_id: crate::hash::random_token(),
        profile_id: id.to_string(),
        tf2_root: user_path_string(root),
        before_index_sha256,
        after_index_sha256: sha256_hex(after_bytes.as_bytes()),
    };
    refuse_writes(profile_live_process_names())?;
    write_deletion(profiles, &journal)?;
    // A disk/process failure before publication leaves every library byte
    // intact. Recovery cancels that prepared request instead of guessing.
    refuse_writes(profile_live_process_names())?;
    if journal_state(profiles, root, &journal)? != ProfileMutationRecoveryState::Prepared {
        return Err(ProfileError::Io(
            "The profile changed before deletion.".into(),
        ));
    }
    write_json_within(profiles, &index_file(profiles), &index)?;
    recover_deletion_to(profiles, root)?;
    load_library_from(profiles, Some(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        dir: PathBuf,
        profiles: PathBuf,
        root: PathBuf,
        a: String,
        b: String,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = crate::test_temp_dir();
            let profiles = dir.join("execs/profiles");
            let root = dir.join("Team Fortress 2");
            fs::create_dir_all(root.join("tf/cfg")).unwrap();
            fs::create_dir_all(root.join("tf/custom/live-pack")).unwrap();
            fs::write(root.join("tf/cfg/config.cfg"), b"live cfg").unwrap();
            fs::write(root.join("tf/custom/live-pack/file.txt"), b"live pack").unwrap();
            let first = create_profile_record_to(&profiles, &root, "Main", ["test"]).unwrap();
            let a = first.profiles[0].id.clone();
            let second = create_profile_record_to(&profiles, &root, "Trial", ["test"]).unwrap();
            let b = second
                .profiles
                .iter()
                .find(|p| p.id != a)
                .unwrap()
                .id
                .clone();
            for id in [&a, &b] {
                put_exclusive_file_to(
                    &profiles,
                    &root,
                    id,
                    "tf/custom/pack/file.txt",
                    id.as_bytes(),
                    ["test"],
                )
                .unwrap();
            }
            set_active_profile_to(&profiles, &root, &a, ["test"]).unwrap();
            Self {
                dir,
                profiles,
                root,
                a,
                b,
            }
        }

        fn assert_live_unchanged(&self) {
            assert_eq!(
                fs::read(self.root.join("tf/cfg/config.cfg")).unwrap(),
                b"live cfg"
            );
            assert_eq!(
                fs::read(self.root.join("tf/custom/live-pack/file.txt")).unwrap(),
                b"live pack"
            );
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn game() -> String {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
        .into()
    }

    #[test]
    fn inactive_delete_preserves_active_payload_live_files_and_shared_base() {
        let f = Fixture::new();
        let mut shared = String::new();
        for id in [&f.a, &f.b] {
            shared = put_shared_blob_to(
                &f.profiles,
                &f.root,
                id,
                "tf/custom/mastercomfig-base.vpk",
                b"shared",
                ["test"],
            )
            .unwrap();
        }
        let before = fs::read(manifest_file(&f.profiles, &f.a)).unwrap();
        let library = delete_profile_to(&f.profiles, &f.root, &f.b, false, ["test"]).unwrap();
        assert_eq!(library.active_profile_id.as_deref(), Some(f.a.as_str()));
        assert_eq!(library.profiles.len(), 1);
        assert_eq!(fs::read(manifest_file(&f.profiles, &f.a)).unwrap(), before);
        assert_eq!(
            fs::read(blob_path(&f.profiles, &shared)).unwrap(),
            b"shared"
        );
        assert!(!profile_dir(&f.profiles, &f.b).exists());
        assert!(!deletion_path(&f.profiles).exists());
        f.assert_live_unchanged();
    }

    #[test]
    fn active_delete_requires_explicit_keep_installed_and_clears_tracking() {
        let f = Fixture::new();
        let before = fs::read(index_file(&f.profiles)).unwrap();
        assert!(delete_profile_to(&f.profiles, &f.root, &f.a, false, ["test"]).is_err());
        assert_eq!(fs::read(index_file(&f.profiles)).unwrap(), before);
        let library = delete_profile_to(&f.profiles, &f.root, &f.a, true, ["test"]).unwrap();
        assert_eq!(library.active_profile_id, None);
        assert_eq!(library.profiles[0].id, f.b);
        assert!(profile_dir(&f.profiles, &f.b).exists());
        f.assert_live_unchanged();
    }

    #[test]
    fn last_delete_keeps_installed_setup_and_preloader_recovery_snapshots() {
        let f = Fixture::new();
        delete_profile_to(&f.profiles, &f.root, &f.b, false, ["test"]).unwrap();
        let data = f.profiles.parent().unwrap();
        crate::preloader::record_preload_profile(data, &f.a).unwrap();
        fs::create_dir_all(data.join("preloader/originals")).unwrap();
        fs::write(data.join("preloader/originals/stock"), b"original bytes").unwrap();
        let library = delete_profile_to(&f.profiles, &f.root, &f.a, true, ["test"]).unwrap();
        assert!(library.initialized && library.usable);
        assert!(library.profiles.is_empty());
        assert_eq!(library.active_profile_id, None);
        assert_eq!(
            fs::read(data.join("preloader/originals/stock")).unwrap(),
            b"original bytes"
        );
        assert!(crate::preloader::preload_profiles(data).unwrap().is_empty());
        f.assert_live_unchanged();
    }

    #[test]
    fn missing_or_corrupt_target_can_be_removed_without_trusting_its_manifest() {
        for missing in [true, false] {
            let f = Fixture::new();
            if missing {
                fs::remove_dir_all(profile_dir(&f.profiles, &f.b)).unwrap();
            } else {
                fs::write(manifest_file(&f.profiles, &f.b), b"not json").unwrap();
            }
            let library = delete_profile_to(&f.profiles, &f.root, &f.b, false, ["test"]).unwrap();
            assert_eq!(library.profiles.len(), 1);
            assert_eq!(library.profiles[0].id, f.a);
            f.assert_live_unchanged();
        }
    }

    #[test]
    fn unreadable_remaining_manifest_prevents_shared_blob_collection() {
        let f = Fixture::new();
        let shared = put_shared_blob_to(
            &f.profiles,
            &f.root,
            &f.a,
            "tf/custom/mastercomfig-base.vpk",
            b"needed",
            ["test"],
        )
        .unwrap();
        fs::write(
            manifest_file(&f.profiles, &f.a),
            b"corrupt but still owns its blobs",
        )
        .unwrap();
        delete_profile_to(&f.profiles, &f.root, &f.b, false, ["test"]).unwrap();
        assert_eq!(
            fs::read(blob_path(&f.profiles, &shared)).unwrap(),
            b"needed"
        );
    }

    #[test]
    fn running_and_pending_switch_refuse_before_journal_or_index_changes() {
        let f = Fixture::new();
        let before = fs::read(index_file(&f.profiles)).unwrap();
        assert_eq!(
            delete_profile_to(&f.profiles, &f.root, &f.b, false, [game()]).unwrap_err(),
            ProfileError::GameRunning,
        );
        assert!(!deletion_path(&f.profiles).exists());
        assert_eq!(fs::read(index_file(&f.profiles)).unwrap(), before);
        begin_switch_to(
            &f.profiles,
            &f.root,
            &f.b,
            &[f.a.clone(), f.b.clone()],
            ["test"],
        )
        .unwrap();
        let pending = fs::read(index_file(&f.profiles)).unwrap();
        assert!(delete_profile_to(&f.profiles, &f.root, &f.b, false, ["test"]).is_err());
        assert_eq!(fs::read(index_file(&f.profiles)).unwrap(), pending);
        assert!(!deletion_path(&f.profiles).exists());
    }

    #[test]
    fn interruption_before_commit_cancels_delete_on_restart_without_losing_data() {
        let f = Fixture::new();
        let before = fs::read(index_file(&f.profiles)).unwrap();
        let mut calls = 0;
        with_profile_process_sampler(
            move || {
                calls += 1;
                if calls == 2 {
                    vec![game()]
                } else {
                    vec![]
                }
            },
            || {
                assert_eq!(
                    delete_profile_to(&f.profiles, &f.root, &f.b, false, ["test"]).unwrap_err(),
                    ProfileError::GameRunning
                );
            },
        );
        assert_eq!(
            profile_mutation_status_to(&f.profiles, &f.root).unwrap(),
            ProfileMutationRecoveryState::Prepared
        );
        recover_all_profile_mutations_to(&f.profiles, &f.root, ["test"]).unwrap();
        assert_eq!(fs::read(index_file(&f.profiles)).unwrap(), before);
        assert!(manifest_file(&f.profiles, &f.b).exists());
        assert!(!deletion_path(&f.profiles).exists());
    }

    #[test]
    fn interruption_after_commit_retries_only_deleted_payload_cleanup_on_restart() {
        let f = Fixture::new();
        let before = fs::read(manifest_file(&f.profiles, &f.a)).unwrap();
        let mut calls = 0;
        with_profile_process_sampler(
            move || {
                calls += 1;
                if calls == 3 {
                    vec![game()]
                } else {
                    vec![]
                }
            },
            || {
                assert_eq!(
                    delete_profile_to(&f.profiles, &f.root, &f.b, false, ["test"]).unwrap_err(),
                    ProfileError::GameRunning
                );
            },
        );
        assert_eq!(
            profile_mutation_status_to(&f.profiles, &f.root).unwrap(),
            ProfileMutationRecoveryState::Committed
        );
        assert!(profile_dir(&f.profiles, &f.b).exists());
        assert_eq!(
            recover_all_profile_mutations_to(&f.profiles, &f.root, [game()]).unwrap_err(),
            ProfileError::GameRunning
        );
        recover_all_profile_mutations_to(&f.profiles, &f.root, ["test"]).unwrap();
        assert!(!profile_dir(&f.profiles, &f.b).exists());
        assert_eq!(fs::read(manifest_file(&f.profiles, &f.a)).unwrap(), before);
        assert_eq!(
            profile_mutation_status_to(&f.profiles, &f.root).unwrap(),
            ProfileMutationRecoveryState::Clean
        );
        f.assert_live_unchanged();
    }

    #[test]
    fn changed_index_during_recovery_preserves_remaining_payload() {
        let f = Fixture::new();
        let mut calls = 0;
        with_profile_process_sampler(
            move || {
                calls += 1;
                if calls == 3 {
                    vec![game()]
                } else {
                    vec![]
                }
            },
            || {
                assert!(delete_profile_to(&f.profiles, &f.root, &f.b, false, ["test"]).is_err());
            },
        );
        let mut index = load_index(&f.profiles).unwrap().unwrap();
        index.profiles[0].name = "Changed externally".into();
        write_json_within(&f.profiles, &index_file(&f.profiles), &index).unwrap();
        assert!(recover_all_profile_mutations_to(&f.profiles, &f.root, ["test"]).is_err());
        assert!(profile_dir(&f.profiles, &f.b).exists());
        assert!(deletion_path(&f.profiles).exists());
    }
}
