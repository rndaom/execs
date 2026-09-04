//! App-data profile library. Inactive profiles never live under `tf/custom/`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::blob::{
    blob_path, gc_unreferenced_blobs, put_blob, put_blob_from_path, put_blob_from_path_exact,
};
use crate::finder::user_path_string;
use crate::hash::{
    copy_and_sha256_exact_within, copy_and_sha256_within, copy_verified_atomic_within,
    move_dir_no_replace_within, move_file_within, read_small_text_bounded, remove_dir_within,
    remove_file_force_within, sha256_file, sha256_file_exact, sha256_hex, validate_dir_within,
    validate_file_within, write_atomic_within,
};
use crate::launch::{find_cloud_config, read_launch_options, sanitize_launch_options};
use crate::process_lock::{live_process_names, refuse_if_running_among, WriteLockError};
use crate::settings::execs_data_dir;
use crate::surface::{inventory_live_surface_with, is_global_custom_file, is_stock_custom_entry};

pub const LIBRARY_SCHEMA: u32 = 1;
pub const SHARED_VPK_NAME: &str = "mastercomfig-base.vpk";
pub const MAX_PROFILE_REL_PATH_BYTES: usize = 4096;
pub const MAX_PROFILE_PATH_DEPTH: usize = 64;
pub const MAX_PROFILE_COMPONENT_BYTES: usize = 255;
const MUTATION_JOURNAL_NAME: &str = ".mutation-journal.json";
const MUTATION_DATA_DIR: &str = ".mutation-data";
const CREATE_DATA_DIR: &str = ".create-data";
const CREATE_MARKER_NAME: &str = ".create-marker.json";
const MAX_CREATE_MARKER_BYTES: usize = 16 * 1024;
const MAX_LIBRARY_INDEX_BYTES: usize = 32 * 1024 * 1024;
const MAX_PROFILE_MANIFEST_BYTES: usize = 32 * 1024 * 1024;
const MAX_MUTATION_JOURNAL_BYTES: usize = 128 * 1024 * 1024;
const MAX_TRANSACTION_TREE_ENTRIES: usize = 200_000;
const MAX_LIBRARY_PROFILES: usize = 20_000;
const MAX_PROFILE_FILES: usize = 100_000;

#[cfg(test)]
type TestProcessSampler = Box<dyn FnMut() -> Vec<String>>;

#[cfg(test)]
thread_local! {
    static TEST_PROFILE_PROCESS_SAMPLER: std::cell::RefCell<Option<TestProcessSampler>> =
        const { std::cell::RefCell::new(None) };
}

/// Every long-running profile transaction re-samples through this boundary.
/// The test-only override is thread-local so parallel tests cannot authorize
/// or block one another.
fn profile_live_process_names() -> Vec<String> {
    #[cfg(test)]
    {
        let sampled = TEST_PROFILE_PROCESS_SAMPLER.with(|slot| {
            let mut slot = slot.borrow_mut();
            slot.as_mut().map(|sampler| sampler())
        });
        if let Some(names) = sampled {
            return names;
        }
    }
    live_process_names()
}

#[cfg(test)]
pub(crate) fn with_profile_process_sampler<R>(
    sampler: impl FnMut() -> Vec<String> + 'static,
    run: impl FnOnce() -> R,
) -> R {
    struct RestoreSampler(Option<TestProcessSampler>);
    impl Drop for RestoreSampler {
        fn drop(&mut self) {
            TEST_PROFILE_PROCESS_SAMPLER.with(|slot| {
                *slot.borrow_mut() = self.0.take();
            });
        }
    }

    let previous = TEST_PROFILE_PROCESS_SAMPLER.with(|slot| slot.replace(Some(Box::new(sampler))));
    let _restore = RestoreSampler(previous);
    run()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileError {
    GameRunning,
    RootMismatch {
        library_root: String,
        confirmed_root: String,
    },
    NotInitialized,
    UnknownProfile,
    ForbiddenPath(String),
    NotShareable(String),
    MustBeShared(String),
    InvalidPath,
    InvalidName,
    NoConfirmedRoot,
    Io(String),
}

impl From<WriteLockError> for ProfileError {
    fn from(_: WriteLockError) -> Self {
        Self::GameRunning
    }
}

impl ProfileError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::GameRunning => "GameRunning",
            Self::RootMismatch { .. } => "RootMismatch",
            Self::NotInitialized => "NotInitialized",
            Self::UnknownProfile => "UnknownProfile",
            Self::ForbiddenPath(_) => "ForbiddenPath",
            Self::NotShareable(_) => "NotShareable",
            Self::MustBeShared(_) => "MustBeShared",
            Self::InvalidPath => "InvalidPath",
            Self::InvalidName => "InvalidName",
            Self::NoConfirmedRoot => "NoConfirmedRoot",
            Self::Io(_) => "Io",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::GameRunning => WriteLockError::GameRunning.message().into(),
            Self::RootMismatch {
                library_root,
                confirmed_root,
            } => {
                format!(
                    "This library belongs to another TF2 install ({library_root}), not {confirmed_root}."
                )
            }
            Self::NotInitialized => "Profile library is not initialized.".into(),
            Self::UnknownProfile => "That profile is not in the library.".into(),
            Self::ForbiddenPath(path) => format!("Refusing to store {path} in a profile."),
            Self::NotShareable(path) => {
                format!("{path} cannot be stored as a shared blob. Only mastercomfig-base.vpk is shared by hash.")
            }
            Self::MustBeShared(path) => {
                format!("{path} is stored by hash across profiles, not copied into each one.")
            }
            Self::InvalidPath => "That file path is not allowed in a profile.".into(),
            Self::InvalidName => "Give the profile a name.".into(),
            Self::NoConfirmedRoot => "Confirm a TF2 install first.".into(),
            Self::Io(err) => format!("Could not update the profile library: {err}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndex {
    pub schema: u32,
    pub tf2_root: String,
    pub active_profile_id: Option<String>,
    /// The profile a switch was removing from the live tree when it failed.
    /// `active_profile_id` is cleared at that point so absorb cannot swallow
    /// the half-replaced tree; this remembers whose files still need removing,
    /// so the retry finishes the Remove step instead of merging two profiles.
    /// Additive: an index without it loads, and an older app ignores it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interrupted_profile_id: Option<String>,
    /// Durable transaction record written before a switch touches the live
    /// tree. `cleanup_profile_ids` includes the target as well as every source
    /// or earlier partial target whose hash-matching files must be removed on
    /// retry. Additive so schema-1 libraries remain compatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_switch: Option<SwitchJournal>,
    pub profiles: Vec<ProfileSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchJournal {
    pub target_profile_id: String,
    #[serde(default)]
    pub cleanup_profile_ids: Vec<String>,
    /// Immutable path/hash snapshots from every source or partial target. A
    /// retry must remove bytes from the failed attempt even if a profile's
    /// manifest is edited before recovery.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cleanup_files: Vec<SwitchCleanupFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchCleanupFile {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStorage {
    Exclusive,
    Shared,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFile {
    pub path: String,
    pub sha256: String,
    pub storage: FileStorage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HudSource {
    HudDb,
    Local,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudRecord {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    pub source: HudSource,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrosshairRecord {
    pub id: String,
    #[serde(default)]
    pub shape: String,
    #[serde(default)]
    pub assignments: BTreeMap<String, String>,
    /// Baked RGB tint for the first-party shapes; None = white.
    #[serde(default)]
    pub color: Option<[u8; 3]>,
    /// Named non-builtin crosshairs stored in the pack: name -> "vtf" | "rgba".
    /// Bytes live in the pack itself, never on the manifest.
    #[serde(default)]
    pub library: BTreeMap<String, String>,
    /// Serialized designer parameters for the "designed" entry, for re-editing.
    #[serde(default)]
    pub design: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewmodelSource {
    Compiled,
    Imported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewmodelRecord {
    pub id: String,
    pub source: ViewmodelSource,
    #[serde(default)]
    pub preload: bool,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileManifest {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub tf2_root: String,
    pub launch_options: String,
    /// `launch_options` is authoritative in the profile. This stays true
    /// until the exact value has been durably projected into Steam's
    /// `localconfig.vdf`; Steam-open, missing-account, and I/O outcomes are
    /// retryable rather than reasons to roll the profile edit back.
    ///
    /// Old schema-1 manifests did not record projection state, so load them
    /// conservatively as pending. Persist `false` explicitly: omitting it
    /// would deserialize a successfully synced manifest as pending again.
    #[serde(default = "default_true")]
    pub launch_sync_pending: bool,
    pub files: Vec<ProfileFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hud: Option<HudRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crosshair: Option<CrosshairRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewmodel: Option<ViewmodelRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hitsound: Option<crate::hitsound::HitsoundRecord>,
    /// Mods the user brought in themselves, one top-level `tf/custom` pack
    /// each. The files are ordinary profile files, so switch, export/import
    /// and absorb already carry them; the records are what lets the UI name
    /// them, remove them, and offer their particles to the preloader.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mods: Vec<crate::mods::ModRecord>,
    /// Pack keys the user chose to Keep out of the profile. Without this the
    /// same prompt returns on every boot and after every TF2 quit until they
    /// pick Update. Cleared by an Update.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ignored_packs: Vec<String>,
    /// A previous attempt committed `config.cfg` to this profile but did not
    /// finish writing its Steam Cloud twin. Absorb retries until both copies
    /// are durable, even when the live hash already matches the manifest.
    #[serde(default, skip_serializing_if = "is_false")]
    pub cloud_sync_pending: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileMutationJournal {
    transaction_id: String,
    profile_id: String,
    old_manifest: ProfileManifest,
    new_manifest: ProfileManifest,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    file_changes: Vec<ProfileFileChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    live_changes: Vec<ProfileLiveChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    live_renames: Vec<ProfileLiveRename>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    old_index: Option<LibraryIndex>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    new_index: Option<LibraryIndex>,
    /// Compatibility with journals created by the first transaction build.
    /// New transactions use `file_changes`, whose numbered staging slots also
    /// handle a case-only path rename without aliasing on Windows.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    touched_paths: Vec<String>,
    committed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileCreateMarker {
    transaction_id: String,
    profile_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileFileChange {
    old_path: Option<String>,
    new_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileLiveChange {
    path: String,
    old_sha256: Option<String>,
    new_sha256: Option<String>,
}

/// One root-contained live directory move committed with a profile mutation.
/// This is used for HUD replacement: the complete old/third-party HUD tree is
/// disabled without deleting bytes, and an interrupted transaction can move
/// it back before restoring the prior manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileLiveRename {
    pub from: String,
    pub to: String,
}

/// Read model for the UI. `profiles` is empty when the library is unusable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileLibrary {
    pub initialized: bool,
    pub usable: bool,
    pub root_mismatch: bool,
    pub tf2_root: Option<String>,
    pub confirmed_root: Option<String>,
    pub active_profile_id: Option<String>,
    /// See `LibraryIndex::interrupted_profile_id`. `None` unless a switch was
    /// cut off after its Remove step began.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interrupted_profile_id: Option<String>,
    /// Target of a switch whose live-tree transaction has begun but has not
    /// committed the active id. While set, callers may retry switching but
    /// must not launch the game or treat the live tree as an active profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_switch_profile_id: Option<String>,
    pub profiles: Vec<ProfileSummary>,
}

/// Aggregate state of the per-profile durable mutation journals. `Prepared`
/// means live/library rollback is required; `Committed` means the new state
/// must be rolled forward and cleanup finished. Normal writers and launching
/// the game must proceed only when this is `Clean`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileMutationRecoveryState {
    Clean,
    Prepared,
    Committed,
}

pub fn profiles_dir() -> PathBuf {
    execs_data_dir().join("profiles")
}

pub fn index_file(profiles_dir: &Path) -> PathBuf {
    profiles_dir.join("index.json")
}

pub fn profile_dir(profiles_dir: &Path, id: &str) -> PathBuf {
    profiles_dir.join(id)
}

fn valid_profile_id(id: &str) -> bool {
    Uuid::parse_str(id)
        .ok()
        .is_some_and(|uuid| uuid.hyphenated().to_string().eq_ignore_ascii_case(id))
}

/// Resolve an indexed profile directory only after proving the UUID component
/// is an ordinary directory beneath the library. Using the UUID directory as
/// its own containment root would make a junction at `profiles/<uuid>` appear
/// trusted and redirect manifest/recovery writes outside app data.
fn validated_profile_root(profiles_dir: &Path, profile_id: &str) -> Result<PathBuf, ProfileError> {
    if !valid_profile_id(profile_id) {
        return Err(ProfileError::UnknownProfile);
    }
    let root = profile_dir(profiles_dir, profile_id);
    match fs::symlink_metadata(&root) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(ProfileError::UnknownProfile)
        }
        Err(err) => return Err(ProfileError::Io(err.to_string())),
        Ok(meta) if crate::hash::metadata_is_link(&meta) || !meta.is_dir() => {
            return Err(ProfileError::Io(
                "Refusing a linked or invalid profile directory.".into(),
            ))
        }
        Ok(_) => {}
    }
    validate_dir_within(profiles_dir, &root).map_err(|err| ProfileError::Io(err.to_string()))?;
    Ok(root)
}

pub fn manifest_file(profiles_dir: &Path, id: &str) -> PathBuf {
    profile_dir(profiles_dir, id).join("manifest.json")
}

pub fn exclusive_files_dir(profiles_dir: &Path, id: &str) -> PathBuf {
    profile_dir(profiles_dir, id).join("files")
}

pub fn exclusive_file_path(profiles_dir: &Path, id: &str, rel: &str) -> PathBuf {
    let mut path = exclusive_files_dir(profiles_dir, id);
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn mutation_journal_file(profiles_dir: &Path, id: &str) -> PathBuf {
    profile_dir(profiles_dir, id).join(MUTATION_JOURNAL_NAME)
}

fn checked_mutation_journal_path(
    profiles_dir: &Path,
    profile_id: &str,
) -> Result<Option<PathBuf>, ProfileError> {
    validated_profile_root(profiles_dir, profile_id)?;
    let path = mutation_journal_file(profiles_dir, profile_id);
    match fs::symlink_metadata(&path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(ProfileError::Io(err.to_string())),
        Ok(meta) if crate::hash::metadata_is_link(&meta) || !meta.is_file() => Err(
            ProfileError::Io("Refusing a linked or invalid profile-update journal.".into()),
        ),
        Ok(_) => {
            validate_file_within(profiles_dir, &path)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            Ok(Some(path))
        }
    }
}

fn mutation_root(profiles_dir: &Path, id: &str, transaction_id: &str) -> PathBuf {
    profile_dir(profiles_dir, id)
        .join(MUTATION_DATA_DIR)
        .join(transaction_id)
}

fn mutation_file_path(
    profiles_dir: &Path,
    id: &str,
    transaction_id: &str,
    kind: &str,
    rel: &str,
) -> PathBuf {
    let mut path = mutation_root(profiles_dir, id, transaction_id).join(kind);
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn staged_exclusive_file_path(staged_profile: &Path, rel: &str) -> PathBuf {
    let mut path = staged_profile.join("files");
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn create_marker_file(profile_root: &Path) -> PathBuf {
    profile_root.join(CREATE_MARKER_NAME)
}

fn valid_transaction_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn remove_transaction_tree(profile_root: &Path, dir: &Path) -> Result<(), ProfileError> {
    validate_dir_within(profile_root, dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    let mut pending = vec![(dir.to_path_buf(), 0usize)];
    let mut directories = Vec::new();
    let mut visited = 0usize;
    while let Some((current, depth)) = pending.pop() {
        if depth > MAX_PROFILE_PATH_DEPTH + 8 {
            return Err(ProfileError::Io(
                "Refusing to traverse excessively deep transaction data.".into(),
            ));
        }
        validate_dir_within(profile_root, &current)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        directories.push(current.clone());
        for entry in fs::read_dir(&current).map_err(|err| ProfileError::Io(err.to_string()))? {
            visited = visited.saturating_add(1);
            if visited > MAX_TRANSACTION_TREE_ENTRIES {
                return Err(ProfileError::Io(
                    "Refusing to traverse oversized transaction data.".into(),
                ));
            }
            let path = entry
                .map_err(|err| ProfileError::Io(err.to_string()))?
                .path();
            let meta =
                fs::symlink_metadata(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
            if crate::hash::metadata_is_link(&meta) {
                return Err(ProfileError::Io(format!(
                    "Refusing to traverse linked transaction data: {}",
                    path.display()
                )));
            }
            if meta.is_dir() {
                pending.push((path, depth + 1));
            } else if meta.is_file() {
                refuse_writes(profile_live_process_names())?;
                remove_file_force_within(profile_root, &path)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
            } else {
                return Err(ProfileError::Io(format!(
                    "Refusing to remove special transaction data: {}",
                    path.display()
                )));
            }
        }
    }
    for directory in directories.into_iter().rev() {
        refuse_writes(profile_live_process_names())?;
        remove_dir_within(profile_root, &directory)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

/// Remove transaction data only after proving it is an ordinary directory
/// below this profile. A failure deliberately leaves the journal in place so
/// the next recovery retries cleanup instead of leaking a multi-gigabyte HUD.
fn cleanup_transaction_root(profiles_dir: &Path, profile_id: &str, transaction_id: &str) -> bool {
    if !valid_transaction_id(transaction_id) {
        return false;
    }
    if validated_profile_root(profiles_dir, profile_id).is_err() {
        return false;
    }
    let transaction = mutation_root(profiles_dir, profile_id, transaction_id);
    match fs::symlink_metadata(&transaction) {
        Ok(_) => {
            if validate_dir_within(profiles_dir, &transaction).is_err() {
                return false;
            }
            remove_transaction_tree(profiles_dir, &transaction).is_ok()
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    }
}

/// Sweep staging directories left before their journal could be published.
/// Unknown names and links are never traversed or removed.
fn sweep_orphan_mutation_data(profiles_dir: &Path, profile_id: &str) {
    let Ok(profile_root) = validated_profile_root(profiles_dir, profile_id) else {
        return;
    };
    let data_root = profile_root.join(MUTATION_DATA_DIR);
    let Ok(meta) = fs::symlink_metadata(&data_root) else {
        return;
    };
    if crate::hash::metadata_is_link(&meta)
        || !meta.is_dir()
        || validate_dir_within(profiles_dir, &data_root).is_err()
    {
        return;
    }
    let Ok(entries) = fs::read_dir(&data_root) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if valid_transaction_id(&name) {
            let _ = cleanup_transaction_root(profiles_dir, profile_id, &name);
        }
    }
    let _ = fs::remove_dir(&data_root);
}

fn valid_create_marker(profiles_dir: &Path, profile_root: &Path, expected_id: &str) -> bool {
    let marker_path = create_marker_file(profile_root);
    if validate_file_within(profiles_dir, &marker_path).is_err() {
        return false;
    }
    let Ok(text) = read_small_text_bounded(&marker_path, MAX_CREATE_MARKER_BYTES) else {
        return false;
    };
    let Ok(marker) = serde_json::from_str::<ProfileCreateMarker>(&text) else {
        return false;
    };
    marker.profile_id == expected_id && valid_transaction_id(&marker.transaction_id)
}

fn cleanup_create_root(profiles_dir: &Path, root: &Path) -> bool {
    match fs::symlink_metadata(root) {
        Ok(meta) if !crate::hash::metadata_is_link(&meta) && meta.is_dir() => {
            remove_transaction_tree(profiles_dir, root).is_ok()
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => true,
        _ => false,
    }
}

fn cleanup_empty_create_parents(profiles_dir: &Path, create_root: &Path) -> bool {
    let mut cleaned = match fs::symlink_metadata(create_root) {
        Ok(meta) if !crate::hash::metadata_is_link(&meta) && meta.is_dir() => {
            remove_dir_within(profiles_dir, create_root).is_ok()
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => true,
        _ => false,
    };
    let data_root = profiles_dir.join(CREATE_DATA_DIR);
    if fs::read_dir(&data_root)
        .ok()
        .is_some_and(|mut entries| entries.next().is_none())
    {
        cleaned &= remove_dir_within(profiles_dir, &data_root).is_ok();
    }
    cleaned
}

/// Clean only directories carrying the private creation marker or living
/// below the private staging namespace. An indexed directory is committed;
/// only its marker is stale. An unindexed marked UUID is a crash between the
/// directory move and atomic index publication and is safe to remove.
fn sweep_orphan_profile_creations(profiles_dir: &Path, index: &LibraryIndex) {
    let create_data = profiles_dir.join(CREATE_DATA_DIR);
    if fs::symlink_metadata(&create_data).is_ok_and(|meta| {
        meta.is_dir()
            && !crate::hash::metadata_is_link(&meta)
            && validate_dir_within(profiles_dir, &create_data).is_ok()
    }) {
        if let Ok(entries) = fs::read_dir(&create_data) {
            for entry in entries.flatten() {
                let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                if valid_transaction_id(&name) {
                    let _ = cleanup_create_root(profiles_dir, &entry.path());
                }
            }
        }
        if fs::read_dir(&create_data)
            .ok()
            .is_some_and(|mut entries| entries.next().is_none())
        {
            let _ = remove_dir_within(profiles_dir, &create_data);
        }
    }

    let indexed: HashSet<&str> = index
        .profiles
        .iter()
        .map(|profile| profile.id.as_str())
        .collect();
    let Ok(entries) = fs::read_dir(profiles_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !valid_profile_id(&id) {
            continue;
        }
        let root = entry.path();
        let Ok(meta) = fs::symlink_metadata(&root) else {
            continue;
        };
        if crate::hash::metadata_is_link(&meta)
            || !meta.is_dir()
            || !valid_create_marker(profiles_dir, &root, &id)
        {
            continue;
        }
        if indexed.contains(id.as_str()) {
            let _ = remove_file_force_within(profiles_dir, &create_marker_file(&root));
        } else {
            let _ = cleanup_create_root(profiles_dir, &root);
        }
    }
}

pub fn is_shared_file_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(SHARED_VPK_NAME)
}

pub fn is_shared_rel_path(path: &str) -> bool {
    path.rsplit('/').next().is_some_and(is_shared_file_name)
}

pub fn normalize_rel_path(path: &str) -> Result<String, ProfileError> {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.ends_with('/')
        || normalized.split('/').any(str::is_empty)
        || normalized.len() > MAX_PROFILE_REL_PATH_BYTES
    {
        return Err(ProfileError::InvalidPath);
    }
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        return Err(ProfileError::InvalidPath);
    }
    if parts.len() > MAX_PROFILE_PATH_DEPTH {
        return Err(ProfileError::InvalidPath);
    }
    for part in &parts {
        if part.len() > MAX_PROFILE_COMPONENT_BYTES
            || *part == "."
            || *part == ".."
            || part
                .chars()
                .any(|ch| ch <= '\u{1f}' || matches!(ch, '<' | '>' | '"' | '|' | '?' | '*'))
        {
            return Err(ProfileError::InvalidPath);
        }
        // Win32 strips trailing dots and spaces from each ordinary path
        // component. Accepting them would let `video.txt.` alias protected
        // `video.txt`, and would let two portable manifest paths name one file.
        if part.ends_with('.') || part.ends_with(' ') {
            return Err(ProfileError::InvalidPath);
        }
        // `PathBuf::push("C:")` replaces the accumulated path on Windows, and a
        // `:` anywhere else names an NTFS alternate data stream.
        if part.contains(':') {
            return Err(ProfileError::InvalidPath);
        }
        if is_reserved_device_name(part) {
            return Err(ProfileError::InvalidPath);
        }
        // NTFS resolves generated DOS 8.3 aliases (for example LONGFI~1.CFG)
        // to a different long component. Linux treats that spelling as a
        // separate path, so admitting it would let one portable manifest
        // describe two trees that merge on Windows. This deliberately rejects
        // the generated short-name shape; manually assigned aliases that do
        // not use this conventional form remain an OS-level limitation.
        if looks_like_dos_short_name(part) {
            return Err(ProfileError::InvalidPath);
        }
    }
    let mut canonical: Vec<String> = parts.iter().map(|part| (*part).to_string()).collect();
    if canonical.len() >= 2 && canonical[0].eq_ignore_ascii_case("tf") {
        canonical[0] = "tf".into();
        if canonical[1].eq_ignore_ascii_case("cfg") {
            canonical[1] = "cfg".into();
        } else if canonical[1].eq_ignore_ascii_case("custom") {
            canonical[1] = "custom".into();
        }
    }
    Ok(canonical.join("/"))
}

fn looks_like_dos_short_name(component: &str) -> bool {
    if !component.is_ascii() {
        return false;
    }
    let (stem, extension) = component
        .split_once('.')
        .map_or((component, None), |(stem, extension)| {
            (stem, Some(extension))
        });
    if extension.is_some_and(|extension| extension.is_empty() || extension.len() > 3) {
        return false;
    }
    let Some((prefix, ordinal)) = stem.rsplit_once('~') else {
        return false;
    };
    !prefix.is_empty()
        && prefix.len() <= 6
        && !ordinal.is_empty()
        && ordinal.bytes().all(|byte| byte.is_ascii_digit())
}

/// A cross-platform identity key for profile paths. Profiles are portable, so
/// collisions are judged using the strictest filesystem we support (Windows),
/// even while importing or building one on Linux.
pub fn portable_path_key(path: &str) -> Result<String, ProfileError> {
    Ok(normalize_rel_path(path)?.to_lowercase())
}

fn is_stock_cfg_name(name: &str) -> bool {
    matches!(
        name,
        "config.cfg"
            | "config_default.cfg"
            | "360controller.cfg"
            | "360controller-linux.cfg"
            | "undo360controller.cfg"
            | "valve.rc"
            | "skill.cfg"
            | "skill_manifest.cfg"
            | "joystick.cfg"
            | "mtp.cfg"
            | "replay.cfg"
            | "sourcevr.cfg"
            | "sourcevr_tf.cfg"
    ) || (name.starts_with("chapter") && name.ends_with(".cfg"))
        || (name.starts_with("sourcevr") && name.ends_with(".cfg"))
}

fn is_profile_junk_path(path: &str) -> bool {
    path.split('/').any(|part| {
        matches!(
            part,
            ".ds_store"
                | "thumbs.db"
                | "desktop.ini"
                | ".git"
                | ".svn"
                | ".hg"
                | "node_modules"
                | "__macosx"
                | "sound.cache"
        ) || part.ends_with(".cache")
            || part.ends_with(".ztmp")
            || part.ends_with(".bak")
            || part.ends_with(crate::hash::PART_SUFFIX)
    })
}

/// Strict profile ownership gate. This is narrower than the physical
/// file-safe surface: Valve files, install-global files, and regenerable junk
/// may exist under `tf/cfg` or `tf/custom`, but a profile may never claim them.
pub fn is_profile_ownable_rel_path(path: &str) -> bool {
    let Ok(normalized) = normalize_rel_path(path) else {
        return false;
    };
    let lower = normalized.to_lowercase();
    if !is_file_safe_rel_path(&lower)
        || is_profile_junk_path(&lower)
        || is_global_custom_file(&lower)
        || is_stock_custom_entry(&lower)
    {
        return false;
    }
    if let Some(rest) = lower.strip_prefix("tf/cfg/") {
        let name = rest.rsplit('/').next().unwrap_or(rest);
        if is_stock_cfg_name(name) {
            return lower == "tf/cfg/config.cfg";
        }
    }
    true
}

/// Windows refuses (or redirects) these names with or without an extension,
/// in any directory. `CON`, `nul.txt` and `com1.cfg` are all reserved.
fn is_reserved_device_name(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or(part);
    let lower = stem.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "con" | "prn" | "aux" | "nul" | "conin$" | "conout$"
    ) {
        return true;
    }
    if lower.len() == 4 {
        let (prefix, digit) = lower.split_at(3);
        return matches!(prefix, "com" | "lpt")
            && matches!(digit, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9");
    }
    for prefix in ["com", "lpt"] {
        if let Some(digit) = lower.strip_prefix(prefix) {
            return matches!(digit, "¹" | "²" | "³");
        }
    }
    false
}

/// The single allowlist for every path this app is allowed to write, in the
/// live game folder and in the profile library alike: `tf/cfg/` or
/// `tf/custom/`, never `tf/cfg/user/`, never an official VPK or `steam.inf` /
/// `gameinfo.txt` / `video.txt`.
///
/// Re-exported as `crate::apply::is_file_safe_rel_path` for existing callers.
pub fn is_file_safe_rel_path(path: &str) -> bool {
    let Ok(normalized) = normalize_rel_path(path) else {
        return false;
    };
    let lower = normalized.to_ascii_lowercase();
    let file = lower.rsplit('/').next().unwrap_or(lower.as_str());
    if matches!(file, "steam.inf" | "gameinfo.txt" | "video.txt") {
        return false;
    }
    if file.starts_with("tf2_") && file.ends_with(".vpk") && !lower.starts_with("tf/custom/") {
        return false;
    }
    if lower.starts_with("tf/cfg/user/") || lower == "tf/cfg/user" {
        return false;
    }
    lower.starts_with("tf/cfg/") || lower.starts_with("tf/custom/")
}

pub fn load_library(confirmed_root: Option<&Path>) -> Result<ProfileLibrary, ProfileError> {
    load_library_from(&profiles_dir(), confirmed_root)
}

pub fn load_library_from(
    profiles_dir: &Path,
    confirmed_root: Option<&Path>,
) -> Result<ProfileLibrary, ProfileError> {
    let confirmed = confirmed_root.map(user_path_string);
    match load_index(profiles_dir)? {
        None => Ok(empty_library(false, confirmed_root.is_some(), confirmed)),
        Some(index) => Ok(library_from_index(index, confirmed_root, confirmed)),
    }
}

pub fn init_library(tf2_root: &Path) -> Result<ProfileLibrary, ProfileError> {
    init_library_to(&profiles_dir(), tf2_root, live_process_names())
}

pub fn init_library_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    init_unlocked(profiles_dir, tf2_root)?;
    load_library_from(profiles_dir, Some(tf2_root))
}

pub fn create_profile_record_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    name: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    create_populated_profile_to(
        profiles_dir,
        tf2_root,
        name,
        &[],
        false,
        running_names,
        |_| Ok(()),
    )
}

/// Build a complete new profile under a hidden staging directory, then make
/// it visible with one atomic index publication. The callback may populate
/// domain records and launch metadata, but identity/root/schema/files remain
/// derived here. A failure before publication leaves no visible profile; an
/// error after the index rename is reconciled as committed success.
#[allow(clippy::too_many_arguments)]
pub fn create_populated_profile_to<I, S, F>(
    profiles_dir: &Path,
    tf2_root: &Path,
    name: &str,
    puts: &[(String, FileSource<'_>)],
    activate_if_none: bool,
    running_names: I,
    edit_manifest: F,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    F: FnOnce(&mut ProfileManifest) -> Result<(), ProfileError>,
{
    refuse_writes(running_names)?;
    let name = normalize_name(name)?;
    let mut index = init_unlocked(profiles_dir, tf2_root)?;
    sweep_orphan_profile_creations(profiles_dir, &index);

    let profile_id = Uuid::new_v4().to_string();
    let transaction_id = crate::hash::random_token();
    let create_root = profiles_dir.join(CREATE_DATA_DIR).join(&transaction_id);
    let staged_profile = create_root.join(&profile_id);
    let final_profile = profile_dir(profiles_dir, &profile_id);
    let marker = ProfileCreateMarker {
        transaction_id: transaction_id.clone(),
        profile_id: profile_id.clone(),
    };
    if let Err(err) = write_json_within(
        profiles_dir,
        &staged_profile.join(CREATE_MARKER_NAME),
        &marker,
    ) {
        let _ = cleanup_create_root(profiles_dir, &create_root);
        return Err(err);
    }

    let stage = (|| -> Result<(ProfileManifest, ProfileSummary), ProfileError> {
        let mut keys = HashSet::new();
        let mut files = Vec::with_capacity(puts.len());
        for (rel, source) in puts {
            refuse_writes(profile_live_process_names())?;
            let path = checked_rel_path(rel)?;
            let key = portable_path_key(&path)?;
            if !keys.insert(key) {
                return Err(ProfileError::Io(format!(
                    "New profile contains a duplicate portable path: {path}"
                )));
            }
            let (sha256, storage) = if is_shared_rel_path(&path) {
                let hash = match source {
                    FileSource::Path(source) => put_blob_from_path(profiles_dir, source)?,
                    FileSource::PathExact { path, expected_len } => {
                        put_blob_from_path_exact(profiles_dir, path, *expected_len)?
                    }
                    FileSource::Bytes(bytes) => put_blob(profiles_dir, bytes)?,
                };
                (hash, FileStorage::Shared)
            } else {
                let destination = staged_exclusive_file_path(&staged_profile, &path);
                let hash = match source {
                    FileSource::Path(source) => {
                        copy_and_sha256_within(profiles_dir, source, &destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?
                    }
                    FileSource::PathExact { path, expected_len } => copy_and_sha256_exact_within(
                        profiles_dir,
                        path,
                        &destination,
                        *expected_len,
                    )
                    .map_err(|err| ProfileError::Io(err.to_string()))?,
                    FileSource::Bytes(bytes) => {
                        write_atomic_within(profiles_dir, &destination, bytes)
                            .map_err(|err| ProfileError::Io(err.to_string()))?;
                        sha256_hex(bytes)
                    }
                };
                (hash, FileStorage::Exclusive)
            };
            let stable_hash = match source {
                FileSource::Path(source) => {
                    Some(sha256_file(source).map_err(|err| ProfileError::Io(err.to_string()))?)
                }
                FileSource::PathExact { path, expected_len } => Some(
                    sha256_file_exact(path, *expected_len)
                        .map_err(|err| ProfileError::Io(err.to_string()))?,
                ),
                FileSource::Bytes(_) => None,
            };
            if let Some(current) = stable_hash {
                if !current.eq_ignore_ascii_case(&sha256) {
                    return Err(ProfileError::Io(format!(
                        "Source changed while staging new profile file: {path}"
                    )));
                }
            }
            refuse_writes(profile_live_process_names())?;
            files.push(ProfileFile {
                path,
                sha256,
                storage,
            });
        }

        let now = utc_rfc3339();
        let summary = ProfileSummary {
            id: profile_id.clone(),
            name: name.clone(),
            created_at: now.clone(),
            updated_at: now,
        };
        let mut manifest = ProfileManifest {
            schema: LIBRARY_SCHEMA,
            id: profile_id.clone(),
            name: name.clone(),
            tf2_root: index.tf2_root.clone(),
            launch_options: String::new(),
            launch_sync_pending: false,
            files,
            hud: None,
            crosshair: None,
            viewmodel: None,
            hitsound: None,
            mods: Vec::new(),
            ignored_packs: Vec::new(),
            cloud_sync_pending: false,
        };
        let planned_files = manifest.files.clone();
        edit_manifest(&mut manifest)?;
        if manifest.schema != LIBRARY_SCHEMA
            || manifest.id != profile_id
            || manifest.tf2_root != index.tf2_root
            || manifest.files != planned_files
        {
            return Err(ProfileError::Io(
                "A new-profile transaction may not edit schema, identity, root, or files in its metadata callback."
                    .into(),
            ));
        }
        manifest.name = normalize_name(&manifest.name)?;
        validate_manifest_files(&manifest)?;
        let mut summary = summary;
        summary.name.clone_from(&manifest.name);
        write_json_within(
            profiles_dir,
            &staged_profile.join("manifest.json"),
            &manifest,
        )?;
        // Materialize the otherwise-empty exclusive root too, preserving the
        // existing profile directory shape for callers and export tooling.
        let files_root = staged_profile.join("files");
        if !files_root.is_dir() {
            let placeholder = files_root.join(".create-files-marker");
            write_atomic_within(profiles_dir, &placeholder, b"")
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            remove_file_force_within(profiles_dir, &placeholder)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        }
        Ok((manifest, summary))
    })();
    let (manifest, summary) = match stage {
        Ok(staged) => staged,
        Err(err) => {
            let _ = cleanup_create_root(profiles_dir, &create_root);
            return Err(err);
        }
    };

    if let Err(err) = refuse_writes(profile_live_process_names()) {
        let _ = cleanup_create_root(profiles_dir, &create_root);
        return Err(err);
    }
    if let Err(err) = move_dir_no_replace_within(profiles_dir, &staged_profile, &final_profile) {
        let _ = cleanup_create_root(profiles_dir, &create_root);
        return Err(ProfileError::Io(err.to_string()));
    }
    let _ = cleanup_empty_create_parents(profiles_dir, &create_root);

    index.profiles.push(summary);
    if activate_if_none && index.active_profile_id.is_none() {
        index.active_profile_id = Some(profile_id.clone());
    }
    if let Err(err) = refuse_writes(profile_live_process_names()) {
        let _ = cleanup_create_root(profiles_dir, &final_profile);
        return Err(err);
    }
    if let Err(err) = write_json_within(profiles_dir, &index_file(profiles_dir), &index) {
        let published = load_index(profiles_dir)?.is_some_and(|current| {
            current
                .profiles
                .iter()
                .any(|profile| profile.id == profile_id)
        });
        if !published {
            let _ = cleanup_create_root(profiles_dir, &final_profile);
            return Err(err);
        }
    }

    // The index is the commit point. Marker cleanup is retryable and cannot
    // turn a complete visible profile into a failed operation.
    let marker_path = final_profile.join(CREATE_MARKER_NAME);
    let _ = remove_file_force_within(profiles_dir, &marker_path);
    debug_assert_eq!(
        load_manifest_raw(profiles_dir, &profile_id).ok(),
        Some(manifest)
    );
    load_library_from(profiles_dir, Some(tf2_root))
}

#[derive(Debug, Clone, Default)]
pub struct SaveCurrentOptions<'a> {
    pub launch_options: Option<&'a str>,
    pub cloud_config: Option<&'a Path>,
}

pub fn save_current_as(tf2_root: &Path, name: &str) -> Result<ProfileLibrary, ProfileError> {
    let cloud = find_cloud_config();
    save_current_as_to(
        &profiles_dir(),
        tf2_root,
        name,
        live_process_names(),
        SaveCurrentOptions {
            launch_options: None,
            cloud_config: cloud.as_deref(),
        },
    )
}

pub fn save_current_as_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    name: &str,
    running_names: I,
    options: SaveCurrentOptions<'_>,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_writes(&running)?;
    let name = normalize_name(name)?;
    let index = init_unlocked(profiles_dir, tf2_root)?;
    // Inventory can fail on malformed/unreadable live data. Do it before a
    // reusable placeholder is renamed or a new visible profile is created.
    let inventory = inventory_live_surface_with(tf2_root, options.cloud_config)?;
    let batch_paths: Vec<(String, PathBuf, u64)> = inventory
        .entries
        .into_iter()
        .map(|entry| {
            let expected_len = source_file_len(&entry.source)?;
            Ok((entry.dest_rel, entry.source, expected_len))
        })
        .collect::<Result<_, ProfileError>>()?;
    let launch = match options.launch_options {
        Some(raw) => sanitize_launch_options(raw),
        None => read_launch_options(),
    };
    let batch: Vec<(String, FileSource<'_>)> = batch_paths
        .iter()
        .map(|(path, source, expected_len)| {
            (
                path.clone(),
                FileSource::PathExact {
                    path: source.as_path(),
                    expected_len: *expected_len,
                },
            )
        })
        .collect();
    if let Some(profile_id) = reusable_empty_profile(profiles_dir, &index) {
        let captured_name = name.clone();
        mutate_profile_files_impl(
            profiles_dir,
            tf2_root,
            &profile_id,
            &batch,
            &[],
            ProfileLiveProjection::LibraryOnly,
            &[],
            true,
            &running,
            move |manifest| {
                manifest.name = captured_name;
                manifest.launch_options = launch;
                // Save-current reads these options from the Steam state it is
                // capturing; no external projection is outstanding.
                manifest.launch_sync_pending = false;
                Ok(())
            },
        )?;
        return load_library_from(profiles_dir, Some(tf2_root));
    }

    create_populated_profile_to(
        profiles_dir,
        tf2_root,
        &name,
        &batch,
        true,
        &running,
        move |manifest| {
            manifest.launch_options = launch;
            manifest.launch_sync_pending = false;
            Ok(())
        },
    )
}

pub fn put_exclusive_file_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    bytes: &[u8],
    running_names: I,
) -> Result<String, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let path = checked_rel_path(rel_path)?;
    if is_shared_rel_path(&path) {
        return Err(ProfileError::MustBeShared(path));
    }
    put_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[(path, FileSource::Bytes(bytes))],
        running_names,
    )?
    .into_iter()
    .next()
    .ok_or_else(|| ProfileError::Io("profile file write produced no digest".into()))
}

pub fn put_exclusive_file_from_path_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    source: &Path,
    running_names: I,
) -> Result<String, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let path = checked_rel_path(rel_path)?;
    if is_shared_rel_path(&path) {
        return Err(ProfileError::MustBeShared(path));
    }
    let expected_len = source_file_len(source)?;
    put_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[(
            path,
            FileSource::PathExact {
                path: source,
                expected_len,
            },
        )],
        running_names,
    )?
    .into_iter()
    .next()
    .ok_or_else(|| ProfileError::Io("profile file copy produced no digest".into()))
}

/// Where a batched profile file's bytes come from.
#[derive(Debug, Clone, Copy)]
pub enum FileSource<'a> {
    Path(&'a Path),
    /// A path whose preflighted size must remain exact. Copying aborts before
    /// publication if the source is shorter or longer, and never writes more
    /// than this many bytes into app data.
    PathExact {
        path: &'a Path,
        expected_len: u64,
    },
    Bytes(&'a [u8]),
}

/// Whether a profile transaction also projects its file delta into the live
/// TF2 tree when `profile_id` is active. `MirrorIfActive` snapshots every live
/// destination before the durable journal is published, so a pre-commit error
/// or restart restores the exact previous bytes together with the manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileLiveProjection {
    LibraryOnly,
    MirrorIfActive,
}

/// Copy many files into a profile, writing `manifest.json` and `index.json`
/// **exactly once**. The single-file helpers rewrite both JSON files per file,
/// which is O(n) full rewrites (and O(n) crash windows) over a 3,000-file HUD.
/// Storage is decided per path the same way the single-file callers decide it:
/// `mastercomfig-base.vpk` is shared by hash, everything else is exclusive.
pub fn put_profile_files_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    files: &[(String, FileSource<'_>)],
    running_names: I,
) -> Result<Vec<String>, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    if files.is_empty() {
        return Ok(Vec::new());
    }
    let result = mutate_profile_files_impl(
        profiles_dir,
        tf2_root,
        profile_id,
        files,
        &[],
        ProfileLiveProjection::LibraryOnly,
        &[],
        false,
        running_names,
        |_| Ok(()),
    )?;
    Ok(result.hashes)
}

/// Commit file additions/replacements, removals, and arbitrary non-file
/// manifest metadata as one recoverable transaction. The callback may update
/// records such as `hud` and `mods`, but may not edit identity/root/schema or
/// `files`; the latter is derived exclusively from the validated batch.
///
/// With [`ProfileLiveProjection::MirrorIfActive`], the same transaction also
/// updates the live TF2 paths when this is the active profile. Exact live bytes
/// are snapshotted before the journal is published and restored alongside the
/// old manifest if any pre-commit step fails or the process restarts.
#[allow(clippy::too_many_arguments)]
pub fn mutate_profile_files_to<I, S, F>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    puts: &[(String, FileSource<'_>)],
    remove_paths: &[String],
    projection: ProfileLiveProjection,
    running_names: I,
    edit_manifest: F,
) -> Result<ProfileManifest, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    F: FnOnce(&mut ProfileManifest) -> Result<(), ProfileError>,
{
    Ok(mutate_profile_files_impl(
        profiles_dir,
        tf2_root,
        profile_id,
        puts,
        remove_paths,
        projection,
        &[],
        false,
        running_names,
        edit_manifest,
    )?
    .manifest)
}

/// [`mutate_profile_files_to`] plus reversible live directory renames in the
/// same durable journal. Renames are applied only for the active profile and
/// before file projection; on rollback/restart, projected files are undone and
/// then every directory is moved back in reverse order.
#[allow(clippy::too_many_arguments)]
pub fn mutate_profile_files_with_live_renames_to<I, S, F>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    puts: &[(String, FileSource<'_>)],
    remove_paths: &[String],
    live_renames: &[ProfileLiveRename],
    running_names: I,
    edit_manifest: F,
) -> Result<ProfileManifest, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    F: FnOnce(&mut ProfileManifest) -> Result<(), ProfileError>,
{
    Ok(mutate_profile_files_impl(
        profiles_dir,
        tf2_root,
        profile_id,
        puts,
        remove_paths,
        ProfileLiveProjection::MirrorIfActive,
        live_renames,
        false,
        running_names,
        edit_manifest,
    )?
    .manifest)
}

struct ProfileMutationResult {
    manifest: ProfileManifest,
    hashes: Vec<String>,
}

#[allow(clippy::too_many_arguments)]
fn mutate_profile_files_impl<I, S, F>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    puts: &[(String, FileSource<'_>)],
    remove_paths: &[String],
    projection: ProfileLiveProjection,
    requested_live_renames: &[ProfileLiveRename],
    activate_if_none: bool,
    running_names: I,
    edit_manifest: F,
) -> Result<ProfileMutationResult, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    F: FnOnce(&mut ProfileManifest) -> Result<(), ProfileError>,
{
    refuse_writes(running_names)?;
    recover_profile_mutation_to(profiles_dir, tf2_root, profile_id)?;
    let mut index = usable_index(profiles_dir, tf2_root)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let old_manifest = manifest.clone();
    let old_index = index.clone();
    let transaction_id = crate::hash::random_token();

    let mut positions = HashMap::new();
    for (idx, file) in manifest.files.iter().enumerate() {
        let key = portable_path_key(&file.path)?;
        if positions.insert(key, idx).is_some() {
            return Err(ProfileError::Io(
                "Profile manifest contains colliding portable paths.".into(),
            ));
        }
    }

    let mut remove_keys = HashSet::new();
    for path in remove_paths {
        let path = checked_rel_path(path)?;
        remove_keys.insert(portable_path_key(&path)?);
    }
    manifest.files.retain(|file| {
        portable_path_key(&file.path).map_or(true, |key| !remove_keys.contains(&key))
    });
    positions.clear();
    for (idx, file) in manifest.files.iter().enumerate() {
        positions.insert(portable_path_key(&file.path)?, idx);
    }

    let mut requested = HashSet::new();
    let mut validated = Vec::with_capacity(puts.len());
    for (rel, source) in puts {
        let path = checked_rel_path(rel)?;
        let key = portable_path_key(&path)?;
        if !requested.insert(key.clone()) {
            return Err(ProfileError::Io(format!(
                "Profile update contains a duplicate portable path: {path}"
            )));
        }
        validated.push((path, key, *source));
    }

    let staged = (|| -> Result<Vec<String>, ProfileError> {
        let mut hashes = Vec::with_capacity(validated.len());
        for (path, key, source) in &validated {
            refuse_writes(profile_live_process_names())?;
            let (hash, storage) = if is_shared_rel_path(path) {
                let hash = match source {
                    FileSource::Path(from) => put_blob_from_path(profiles_dir, from)?,
                    FileSource::PathExact { path, expected_len } => {
                        put_blob_from_path_exact(profiles_dir, path, *expected_len)?
                    }
                    FileSource::Bytes(bytes) => put_blob(profiles_dir, bytes)?,
                };
                (hash, FileStorage::Shared)
            } else {
                let dest =
                    mutation_file_path(profiles_dir, profile_id, &transaction_id, "new", path);
                let hash = match source {
                    FileSource::Path(from) => copy_and_sha256_within(profiles_dir, from, &dest)
                        .map_err(|e| ProfileError::Io(e.to_string()))?,
                    FileSource::PathExact { path, expected_len } => {
                        copy_and_sha256_exact_within(profiles_dir, path, &dest, *expected_len)
                            .map_err(|e| ProfileError::Io(e.to_string()))?
                    }
                    FileSource::Bytes(bytes) => {
                        write_atomic_within(profiles_dir, &dest, bytes)
                            .map_err(|e| ProfileError::Io(e.to_string()))?;
                        sha256_hex(bytes)
                    }
                };
                (hash, FileStorage::Exclusive)
            };
            let stable_hash = match source {
                FileSource::Path(source) => {
                    Some(sha256_file(source).map_err(|err| ProfileError::Io(err.to_string()))?)
                }
                FileSource::PathExact { path, expected_len } => Some(
                    sha256_file_exact(path, *expected_len)
                        .map_err(|err| ProfileError::Io(err.to_string()))?,
                ),
                FileSource::Bytes(_) => None,
            };
            if let Some(current) = stable_hash {
                if !current.eq_ignore_ascii_case(&hash) {
                    return Err(ProfileError::Io(format!(
                        "Source changed while staging profile file: {path}"
                    )));
                }
            }
            refuse_writes(profile_live_process_names())?;
            let entry = ProfileFile {
                path: path.clone(),
                sha256: hash.clone(),
                storage,
            };
            match positions.get(key) {
                Some(&idx) => manifest.files[idx] = entry,
                None => {
                    positions.insert(key.clone(), manifest.files.len());
                    manifest.files.push(entry);
                }
            }
            hashes.push(hash);
        }
        Ok(hashes)
    })();
    let hashes = match staged {
        Ok(result) => result,
        Err(err) => {
            let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
            return Err(err);
        }
    };

    let planned_files = manifest.files.clone();
    if let Err(err) = edit_manifest(&mut manifest) {
        let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
        return Err(err);
    }
    if manifest.schema != old_manifest.schema
        || manifest.id != old_manifest.id
        || manifest.tf2_root != old_manifest.tf2_root
        || manifest.files != planned_files
    {
        let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
        return Err(ProfileError::Io(
            "A profile transaction may not edit schema, identity, root, or files in its metadata callback."
                .into(),
        ));
    }
    manifest.name = match normalize_name(&manifest.name) {
        Ok(name) => name,
        Err(err) => {
            let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
            return Err(err);
        }
    };
    if let Err(err) = validate_manifest_files(&manifest) {
        let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
        return Err(err);
    }

    if manifest == old_manifest && !(activate_if_none && old_index.active_profile_id.is_none()) {
        let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
        return Ok(ProfileMutationResult { manifest, hashes });
    }

    let old_by_key: HashMap<String, &ProfileFile> = old_manifest
        .files
        .iter()
        .map(|file| Ok((portable_path_key(&file.path)?, file)))
        .collect::<Result<_, ProfileError>>()?;
    let new_by_key: HashMap<String, &ProfileFile> = manifest
        .files
        .iter()
        .map(|file| Ok((portable_path_key(&file.path)?, file)))
        .collect::<Result<_, ProfileError>>()?;
    let keys: BTreeSet<String> = old_by_key
        .keys()
        .chain(new_by_key.keys())
        .cloned()
        .collect();
    let file_changes: Vec<ProfileFileChange> = keys
        .into_iter()
        .filter_map(|key| {
            let old = old_by_key.get(&key).copied();
            let new = new_by_key.get(&key).copied();
            (old != new).then(|| ProfileFileChange {
                old_path: old.map(|file| file.path.clone()),
                new_path: new.map(|file| file.path.clone()),
            })
        })
        .collect();

    if let Err(err) = preflight_profile_file_changes(
        profiles_dir,
        profile_id,
        &transaction_id,
        &old_manifest,
        &manifest,
        &file_changes,
    ) {
        let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
        return Err(err);
    }

    let active = old_index.active_profile_id.as_deref() == Some(profile_id);
    if !active && !requested_live_renames.is_empty() {
        let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
        return Err(ProfileError::Io(
            "Live directory renames require the active profile.".into(),
        ));
    }
    let live_renames = if active {
        match prepare_live_renames(tf2_root, requested_live_renames) {
            Ok(renames) => renames,
            Err(err) => {
                let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
                return Err(err);
            }
        }
    } else {
        Vec::new()
    };
    let live_changes = if active && projection == ProfileLiveProjection::MirrorIfActive {
        match prepare_live_changes(
            profiles_dir,
            tf2_root,
            profile_id,
            &transaction_id,
            &old_manifest,
            &manifest,
            &file_changes,
            &live_renames,
        ) {
            Ok(changes) => changes,
            Err(err) => {
                let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
                return Err(err);
            }
        }
    } else {
        Vec::new()
    };

    if let Some(summary) = index
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
    {
        summary.name.clone_from(&manifest.name);
    }
    touch_profile(&mut index, profile_id);
    if activate_if_none && index.active_profile_id.is_none() {
        index.active_profile_id = Some(profile_id.to_string());
    }
    let new_index = index.clone();

    let mut journal = ProfileMutationJournal {
        transaction_id: transaction_id.clone(),
        profile_id: profile_id.to_string(),
        old_manifest: old_manifest.clone(),
        new_manifest: manifest.clone(),
        file_changes,
        live_changes,
        live_renames,
        old_index: Some(old_index),
        new_index: Some(new_index.clone()),
        touched_paths: Vec::new(),
        committed: false,
    };
    // Staging a large HUD can take minutes. Do not trust the process snapshot
    // supplied at entry when the first durable library write finally begins.
    if let Err(err) = refuse_writes(profile_live_process_names()) {
        let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
        return Err(err);
    }
    if let Err(err) = write_json_within(
        profiles_dir,
        &mutation_journal_file(profiles_dir, profile_id),
        &journal,
    ) {
        let _ = cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
        return Err(err);
    }

    let commit = (|| -> Result<(), ProfileError> {
        apply_profile_file_changes(profiles_dir, profile_id, &journal)?;
        apply_live_renames(tf2_root, &journal.live_renames)?;
        apply_live_changes(profiles_dir, tf2_root, &journal)?;
        refuse_writes(profile_live_process_names())?;
        write_json_within(
            profiles_dir,
            &manifest_file(profiles_dir, profile_id),
            &manifest,
        )?;
        refuse_writes(profile_live_process_names())?;
        write_json_within(profiles_dir, &index_file(profiles_dir), &new_index)?;
        refuse_writes(profile_live_process_names())?;
        journal.committed = true;
        write_json_within(
            profiles_dir,
            &mutation_journal_file(profiles_dir, profile_id),
            &journal,
        )
    })();
    if let Err(err) = commit {
        return match recover_profile_mutation_to(profiles_dir, tf2_root, profile_id) {
            Ok(())
                if mutation_committed_as_requested(
                    profiles_dir,
                    profile_id,
                    &manifest,
                    &new_index,
                )? =>
            {
                // Atomic publication can succeed even when the following
                // directory durability sync reports an error. Recovery has
                // validated and rolled the committed state forward; report
                // the authoritative outcome instead of inviting a retry that
                // appears to contradict already-committed bytes.
                Ok(ProfileMutationResult { manifest, hashes })
            }
            Ok(()) => Err(err),
            Err(recovery) => Err(ProfileError::Io(format!(
                "{} Recovery also failed: {}",
                err.message(),
                recovery.message()
            ))),
        };
    }

    // The committed marker makes leftover cleanup idempotent. Remove the
    // journal last; orphan transaction data is harmless and can be swept.
    let cleaned = refuse_writes(profile_live_process_names()).is_ok()
        && cleanup_transaction_root(profiles_dir, profile_id, &transaction_id);
    let journal_path = mutation_journal_file(profiles_dir, profile_id);
    if cleaned && journal_path.is_file() {
        let _ = remove_file_force_within(profiles_dir, &journal_path);
    }
    Ok(ProfileMutationResult { manifest, hashes })
}

fn mutation_committed_as_requested(
    profiles_dir: &Path,
    profile_id: &str,
    expected_manifest: &ProfileManifest,
    expected_index: &LibraryIndex,
) -> Result<bool, ProfileError> {
    if load_manifest_raw(profiles_dir, profile_id)? != *expected_manifest {
        return Ok(false);
    }
    let current_index = load_index(profiles_dir)?.ok_or(ProfileError::NotInitialized)?;
    let expected_summary = expected_index
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id);
    let current_summary = current_index
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id);
    Ok(current_summary == expected_summary
        && current_index.active_profile_id == expected_index.active_profile_id
        && current_index.interrupted_profile_id == expected_index.interrupted_profile_id
        && current_index.pending_switch == expected_index.pending_switch)
}

fn merge_profile_index_delta(
    current: &mut LibraryIndex,
    desired: &LibraryIndex,
    alternate: &LibraryIndex,
    profile_id: &str,
) -> Result<bool, ProfileError> {
    let desired_summary = desired
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or(ProfileError::UnknownProfile)?;
    let current_summary = current
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or(ProfileError::UnknownProfile)?;
    let alternate_summary = alternate
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or(ProfileError::UnknownProfile)?;
    let mut changed = false;
    if current_summary != desired_summary {
        if current_summary != alternate_summary {
            return Err(ProfileError::Io(
                "Profile recovery found a conflicting library-index update.".into(),
            ));
        }
        *current_summary = desired_summary.clone();
        changed = true;
    }

    macro_rules! merge_field {
        ($field:ident) => {
            if desired.$field != alternate.$field && current.$field != desired.$field {
                if current.$field != alternate.$field {
                    return Err(ProfileError::Io(
                        "Profile recovery found a conflicting library-index update.".into(),
                    ));
                }
                current.$field.clone_from(&desired.$field);
                changed = true;
            }
        };
    }
    merge_field!(active_profile_id);
    merge_field!(interrupted_profile_id);
    merge_field!(pending_switch);
    Ok(changed)
}

fn validate_manifest_files(manifest: &ProfileManifest) -> Result<(), ProfileError> {
    if manifest.files.len() > MAX_PROFILE_FILES {
        return Err(ProfileError::Io(
            "Profile manifest contains too many files.".into(),
        ));
    }
    let mut seen = HashSet::new();
    for file in &manifest.files {
        if !is_profile_ownable_rel_path(&file.path) {
            return Err(ProfileError::ForbiddenPath(file.path.clone()));
        }
        if !seen.insert(portable_path_key(&file.path)?) {
            return Err(ProfileError::Io(
                "Profile manifest contains colliding portable paths.".into(),
            ));
        }
        if is_shared_rel_path(&file.path) != (file.storage == FileStorage::Shared) {
            return Err(ProfileError::Io(format!(
                "Profile file has invalid storage: {}",
                file.path
            )));
        }
        if file.sha256.len() != 64 || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ProfileError::Io(format!(
                "Profile file has an invalid SHA-256 digest: {}",
                file.path
            )));
        }
    }
    Ok(())
}

fn manifest_entry<'a>(
    manifest: &'a ProfileManifest,
    path: &Option<String>,
) -> Option<&'a ProfileFile> {
    path.as_ref()
        .and_then(|path| manifest.files.iter().find(|file| file.path == *path))
}

fn profile_live_path(tf2_root: &Path, rel: &str) -> PathBuf {
    let mut path = tf2_root.to_path_buf();
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn profile_live_candidates(rel: &str) -> Vec<String> {
    let mut candidates = vec![rel.to_string()];
    let Some(rest) = rel.strip_prefix("tf/custom/") else {
        return candidates;
    };
    let (pack, tail) = rest.split_once('/').unwrap_or((rest, ""));
    let alternate_pack = if let Some(enabled) = pack.strip_prefix('-') {
        enabled.to_string()
    } else {
        format!("-{pack}")
    };
    let alternate = if tail.is_empty() {
        format!("tf/custom/{alternate_pack}")
    } else {
        format!("tf/custom/{alternate_pack}/{tail}")
    };
    candidates.push(alternate);
    candidates
}

fn profile_entry_source(profiles_dir: &Path, profile_id: &str, file: &ProfileFile) -> PathBuf {
    match file.storage {
        FileStorage::Exclusive => exclusive_file_path(profiles_dir, profile_id, &file.path),
        FileStorage::Shared => blob_path(profiles_dir, &file.sha256),
    }
}

fn preflight_profile_file_changes(
    profiles_dir: &Path,
    profile_id: &str,
    transaction_id: &str,
    old_manifest: &ProfileManifest,
    new_manifest: &ProfileManifest,
    changes: &[ProfileFileChange],
) -> Result<(), ProfileError> {
    for change in changes {
        let old = manifest_entry(old_manifest, &change.old_path);
        let new = manifest_entry(new_manifest, &change.new_path);
        if let Some(old) = old.filter(|file| file.storage == FileStorage::Exclusive) {
            let path = exclusive_file_path(profiles_dir, profile_id, &old.path);
            validate_file_within(profiles_dir, &path)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            let actual =
                crate::hash::sha256_file(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
            if !actual.eq_ignore_ascii_case(&old.sha256) {
                return Err(ProfileError::Io(format!(
                    "Profile file changed outside its manifest: {}",
                    old.path
                )));
            }
        }
        if let Some(new) = new {
            let source = if new.storage == FileStorage::Exclusive {
                mutation_file_path(profiles_dir, profile_id, transaction_id, "new", &new.path)
            } else {
                blob_path(profiles_dir, &new.sha256)
            };
            validate_file_within(profiles_dir, &source)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            let actual = crate::hash::sha256_file(&source)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            if !actual.eq_ignore_ascii_case(&new.sha256) {
                return Err(ProfileError::Io(format!(
                    "Staged profile file does not match its manifest: {}",
                    new.path
                )));
            }
            if new.storage == FileStorage::Exclusive {
                let destination = exclusive_file_path(profiles_dir, profile_id, &new.path);
                let aliases_old = old.is_some_and(|old| {
                    old.storage == FileStorage::Exclusive
                        && (old.path == new.path
                            || (cfg!(windows)
                                && portable_path_key(&old.path).ok()
                                    == portable_path_key(&new.path).ok()))
                });
                if !aliases_old && fs::symlink_metadata(&destination).is_ok() {
                    return Err(ProfileError::Io(format!(
                        "Profile destination already exists outside the manifest: {}",
                        new.path
                    )));
                }
            }
        }
    }
    Ok(())
}

fn snapshot_live_change(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    transaction_id: &str,
    path: &str,
    removal_expected_sha256: Option<&str>,
    new_sha256: Option<String>,
) -> Result<Option<ProfileLiveChange>, ProfileError> {
    refuse_writes(profile_live_process_names())?;
    let live = profile_live_path(tf2_root, path);
    let old_sha256 = match fs::symlink_metadata(&live) {
        Ok(_) => {
            validate_file_within(tf2_root, &live)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            let backup =
                mutation_file_path(profiles_dir, profile_id, transaction_id, "live-old", path);
            let hash = copy_and_sha256_within(profiles_dir, &live, &backup)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            if removal_expected_sha256.is_some_and(|expected| !hash.eq_ignore_ascii_case(expected))
            {
                let _ = remove_file_force_within(profiles_dir, &backup);
                return Ok(None);
            }
            Some(hash)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(ProfileError::Io(err.to_string())),
    };
    if new_sha256.is_none() && old_sha256.is_none() {
        return Ok(None);
    }
    Ok(Some(ProfileLiveChange {
        path: path.to_string(),
        old_sha256,
        new_sha256,
    }))
}

fn checked_live_pack_dir(path: &str) -> Result<String, ProfileError> {
    let path = checked_rel_path(path)?;
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() != 3 || parts[0] != "tf" || parts[1] != "custom" {
        return Err(ProfileError::ForbiddenPath(path));
    }
    Ok(path)
}

fn prepare_live_renames(
    tf2_root: &Path,
    requested: &[ProfileLiveRename],
) -> Result<Vec<ProfileLiveRename>, ProfileError> {
    let mut endpoints = HashSet::new();
    let mut renames = Vec::with_capacity(requested.len());
    for rename in requested {
        let from = checked_live_pack_dir(&rename.from)?;
        let to = checked_live_pack_dir(&rename.to)?;
        let from_key = portable_path_key(&from)?;
        let to_key = portable_path_key(&to)?;
        if from_key == to_key || !endpoints.insert(from_key) || !endpoints.insert(to_key) {
            return Err(ProfileError::Io(
                "Live directory transaction contains colliding rename endpoints.".into(),
            ));
        }
        let source = profile_live_path(tf2_root, &from);
        validate_dir_within(tf2_root, &source).map_err(|err| ProfileError::Io(err.to_string()))?;
        let destination = profile_live_path(tf2_root, &to);
        match fs::symlink_metadata(&destination) {
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => {
                return Err(ProfileError::Io(format!(
                    "Live directory rename destination already exists: {to}"
                )))
            }
            Err(err) => return Err(ProfileError::Io(err.to_string())),
        }
        renames.push(ProfileLiveRename { from, to });
    }
    Ok(renames)
}

fn path_is_below(path: &str, dir: &str) -> bool {
    let (Ok(path), Ok(dir)) = (portable_path_key(path), portable_path_key(dir)) else {
        return false;
    };
    path.strip_prefix(&dir)
        .is_some_and(|tail| tail.starts_with('/'))
}

fn validate_live_rename_plan(renames: &[ProfileLiveRename]) -> Result<(), ProfileError> {
    let mut endpoints = HashSet::new();
    for rename in renames {
        let from = checked_live_pack_dir(&rename.from)?;
        let to = checked_live_pack_dir(&rename.to)?;
        let from_key = portable_path_key(&from)?;
        let to_key = portable_path_key(&to)?;
        if from_key == to_key || !endpoints.insert(from_key) || !endpoints.insert(to_key) {
            return Err(ProfileError::Io(
                "Invalid live rename in interrupted profile-update journal.".into(),
            ));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn prepare_live_changes(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    transaction_id: &str,
    old_manifest: &ProfileManifest,
    new_manifest: &ProfileManifest,
    changes: &[ProfileFileChange],
    live_renames: &[ProfileLiveRename],
) -> Result<Vec<ProfileLiveChange>, ProfileError> {
    let mut live_changes = Vec::new();
    for change in changes {
        let old = manifest_entry(old_manifest, &change.old_path);
        let new = manifest_entry(new_manifest, &change.new_path);
        let old_is_renamed = old.is_some_and(|old| {
            live_renames
                .iter()
                .any(|rename| path_is_below(&old.path, &rename.from))
        });
        let new_is_renamed = new.is_some_and(|new| {
            live_renames
                .iter()
                .any(|rename| path_is_below(&new.path, &rename.from))
        });
        if old_is_renamed || new_is_renamed {
            if let Some(old) = old.filter(|_| !old_is_renamed) {
                for candidate in profile_live_candidates(&old.path) {
                    if let Some(change) = snapshot_live_change(
                        profiles_dir,
                        tf2_root,
                        profile_id,
                        transaction_id,
                        &candidate,
                        Some(&old.sha256),
                        None,
                    )? {
                        live_changes.push(change);
                    }
                }
            }
            if let Some(new) = new {
                if new_is_renamed {
                    live_changes.push(ProfileLiveChange {
                        path: new.path.clone(),
                        old_sha256: None,
                        new_sha256: Some(new.sha256.clone()),
                    });
                } else if let Some(change) = snapshot_live_change(
                    profiles_dir,
                    tf2_root,
                    profile_id,
                    transaction_id,
                    &new.path,
                    None,
                    Some(new.sha256.clone()),
                )? {
                    live_changes.push(change);
                }
            }
            continue;
        }
        match (old, new) {
            (Some(old), Some(new))
                if old.path == new.path
                    || (cfg!(windows)
                        && portable_path_key(&old.path)? == portable_path_key(&new.path)?) =>
            {
                if let Some(change) = snapshot_live_change(
                    profiles_dir,
                    tf2_root,
                    profile_id,
                    transaction_id,
                    &new.path,
                    None,
                    Some(new.sha256.clone()),
                )? {
                    live_changes.push(change);
                }
            }
            (old, new) => {
                if let Some(old) = old {
                    for candidate in profile_live_candidates(&old.path) {
                        if let Some(change) = snapshot_live_change(
                            profiles_dir,
                            tf2_root,
                            profile_id,
                            transaction_id,
                            &candidate,
                            Some(&old.sha256),
                            None,
                        )? {
                            live_changes.push(change);
                        }
                    }
                }
                if let Some(new) = new {
                    if let Some(change) = snapshot_live_change(
                        profiles_dir,
                        tf2_root,
                        profile_id,
                        transaction_id,
                        &new.path,
                        None,
                        Some(new.sha256.clone()),
                    )? {
                        live_changes.push(change);
                    }
                }
            }
        }
    }
    // A directory rename moves every old descendant aside in one operation.
    // Rebuild the enabled directory from the complete target manifest, not
    // merely `file_changes`: unchanged HUD files were otherwise stranded in
    // the disabled directory whenever only one option file changed.
    let mut projected: HashSet<String> = live_changes
        .iter()
        .filter_map(|change| portable_path_key(&change.path).ok())
        .collect();
    for file in &new_manifest.files {
        if live_renames
            .iter()
            .any(|rename| path_is_below(&file.path, &rename.from))
        {
            let key = portable_path_key(&file.path)?;
            if projected.insert(key) {
                live_changes.push(ProfileLiveChange {
                    path: file.path.clone(),
                    old_sha256: None,
                    new_sha256: Some(file.sha256.clone()),
                });
            }
        }
    }
    Ok(live_changes)
}

fn apply_live_renames(tf2_root: &Path, renames: &[ProfileLiveRename]) -> Result<(), ProfileError> {
    validate_live_rename_plan(renames)?;
    for rename in renames {
        let from_rel = checked_live_pack_dir(&rename.from)?;
        let to_rel = checked_live_pack_dir(&rename.to)?;
        let from = profile_live_path(tf2_root, &from_rel);
        let to = profile_live_path(tf2_root, &to_rel);
        validate_dir_within(tf2_root, &from).map_err(|err| ProfileError::Io(err.to_string()))?;
        match fs::symlink_metadata(&to) {
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => {
                return Err(ProfileError::Io(format!(
                    "Live directory rename destination appeared: {}",
                    rename.to
                )))
            }
            Err(err) => return Err(ProfileError::Io(err.to_string())),
        }
        refuse_writes(profile_live_process_names())?;
        move_dir_no_replace_within(tf2_root, &from, &to)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

fn remove_empty_live_tree(tf2_root: &Path, dir: &Path) -> Result<(), ProfileError> {
    validate_dir_within(tf2_root, dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    let entries = fs::read_dir(dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    for entry in entries {
        let path = entry
            .map_err(|err| ProfileError::Io(err.to_string()))?
            .path();
        let meta = fs::symlink_metadata(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        if crate::hash::metadata_is_link(&meta) || !meta.is_dir() {
            return Err(ProfileError::Io(format!(
                "Refusing to discard unexpected data while restoring a live directory: {}",
                path.display()
            )));
        }
        remove_empty_live_tree(tf2_root, &path)?;
    }
    refuse_writes(profile_live_process_names())?;
    remove_dir_within(tf2_root, dir).map_err(|err| ProfileError::Io(err.to_string()))
}

fn rollback_live_renames(
    tf2_root: &Path,
    renames: &[ProfileLiveRename],
) -> Result<(), ProfileError> {
    validate_live_rename_plan(renames)?;
    for rename in renames.iter().rev() {
        let from_rel = checked_live_pack_dir(&rename.from)?;
        let to_rel = checked_live_pack_dir(&rename.to)?;
        let from = profile_live_path(tf2_root, &from_rel);
        let to = profile_live_path(tf2_root, &to_rel);
        match fs::symlink_metadata(&to) {
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                validate_dir_within(tf2_root, &from)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                continue;
            }
            Ok(_) => validate_dir_within(tf2_root, &to)
                .map_err(|err| ProfileError::Io(err.to_string()))?,
            Err(err) => return Err(ProfileError::Io(err.to_string())),
        }
        match fs::symlink_metadata(&from) {
            Ok(_) => remove_empty_live_tree(tf2_root, &from)?,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(ProfileError::Io(err.to_string())),
        }
        refuse_writes(profile_live_process_names())?;
        move_dir_no_replace_within(tf2_root, &to, &from)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

fn apply_profile_file_changes(
    profiles_dir: &Path,
    profile_id: &str,
    journal: &ProfileMutationJournal,
) -> Result<(), ProfileError> {
    for change in &journal.file_changes {
        let old = manifest_entry(&journal.old_manifest, &change.old_path);
        let new = manifest_entry(&journal.new_manifest, &change.new_path);
        if let Some(old) = old.filter(|file| file.storage == FileStorage::Exclusive) {
            let source = exclusive_file_path(profiles_dir, profile_id, &old.path);
            validate_file_within(profiles_dir, &source)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            let actual = crate::hash::sha256_file(&source)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            if !actual.eq_ignore_ascii_case(&old.sha256) {
                return Err(ProfileError::Io(format!(
                    "Profile file changed during its transaction: {}",
                    old.path
                )));
            }
            let backup = mutation_file_path(
                profiles_dir,
                profile_id,
                &journal.transaction_id,
                "old",
                &old.path,
            );
            refuse_writes(profile_live_process_names())?;
            move_file_within(profiles_dir, &source, &backup)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        }
        if let Some(new) = new.filter(|file| file.storage == FileStorage::Exclusive) {
            let staged = mutation_file_path(
                profiles_dir,
                profile_id,
                &journal.transaction_id,
                "new",
                &new.path,
            );
            let destination = exclusive_file_path(profiles_dir, profile_id, &new.path);
            match fs::symlink_metadata(&destination) {
                Ok(_) => {
                    return Err(ProfileError::Io(format!(
                        "Profile destination appeared during its transaction: {}",
                        new.path
                    )))
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(ProfileError::Io(err.to_string())),
            }
            refuse_writes(profile_live_process_names())?;
            move_file_within(profiles_dir, &staged, &destination)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        }
    }
    Ok(())
}

fn current_live_hash(tf2_root: &Path, path: &Path) -> Result<Option<String>, ProfileError> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            validate_file_within(tf2_root, path)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            crate::hash::sha256_file(path)
                .map(Some)
                .map_err(|err| ProfileError::Io(err.to_string()))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(ProfileError::Io(err.to_string())),
    }
}

fn apply_live_changes(
    profiles_dir: &Path,
    tf2_root: &Path,
    journal: &ProfileMutationJournal,
) -> Result<(), ProfileError> {
    for change in &journal.live_changes {
        let destination = profile_live_path(tf2_root, &change.path);
        let current = current_live_hash(tf2_root, &destination)?;
        if current != change.old_sha256 {
            return Err(ProfileError::Io(format!(
                "Live file changed while the profile transaction was prepared: {}",
                change.path
            )));
        }
        refuse_writes(profile_live_process_names())?;
        if let Some(expected) = &change.new_sha256 {
            let file = journal
                .new_manifest
                .files
                .iter()
                .find(|file| {
                    portable_path_key(&file.path).ok() == portable_path_key(&change.path).ok()
                })
                .ok_or_else(|| {
                    ProfileError::Io(format!(
                        "Profile transaction has no source for live file: {}",
                        change.path
                    ))
                })?;
            let source = profile_entry_source(profiles_dir, &journal.profile_id, file);
            validate_file_within(profiles_dir, &source)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            copy_verified_atomic_within(tf2_root, &source, &destination, expected)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        } else if current.is_some() {
            remove_file_force_within(tf2_root, &destination)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        }
    }
    for rename in &journal.live_renames {
        checked_live_pack_dir(&rename.from)?;
        checked_live_pack_dir(&rename.to)?;
        if portable_path_key(&rename.from)? == portable_path_key(&rename.to)? {
            return Err(ProfileError::Io(
                "Invalid live rename in interrupted profile-update journal.".into(),
            ));
        }
    }
    Ok(())
}

fn hashes_match(left: &Option<String>, right: &Option<String>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        (None, None) => true,
        _ => false,
    }
}

fn rollback_live_changes(
    profiles_dir: &Path,
    tf2_root: &Path,
    journal: &ProfileMutationJournal,
) -> Result<(), ProfileError> {
    if journal.live_changes.is_empty() {
        return Ok(());
    }
    refuse_writes(profile_live_process_names())?;
    for change in journal.live_changes.iter().rev() {
        let destination = profile_live_path(tf2_root, &change.path);
        let current = current_live_hash(tf2_root, &destination)?;
        if hashes_match(&current, &change.old_sha256) {
            continue;
        }
        if !hashes_match(&current, &change.new_sha256) {
            return Err(ProfileError::Io(format!(
                "Cannot safely recover a live file changed by another process: {}",
                change.path
            )));
        }
        refuse_writes(profile_live_process_names())?;
        if let Some(old_hash) = &change.old_sha256 {
            let backup = mutation_file_path(
                profiles_dir,
                &journal.profile_id,
                &journal.transaction_id,
                "live-old",
                &change.path,
            );
            validate_file_within(profiles_dir, &backup)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            copy_verified_atomic_within(tf2_root, &backup, &destination, old_hash)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        } else if current.is_some() {
            remove_file_force_within(tf2_root, &destination)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        }
    }
    Ok(())
}

fn rollback_profile_file_changes(
    profiles_dir: &Path,
    journal: &ProfileMutationJournal,
) -> Result<(), ProfileError> {
    for change in journal.file_changes.iter().rev() {
        let old = manifest_entry(&journal.old_manifest, &change.old_path);
        let new = manifest_entry(&journal.new_manifest, &change.new_path);

        if let Some(new) = new.filter(|file| file.storage == FileStorage::Exclusive) {
            let destination = exclusive_file_path(profiles_dir, &journal.profile_id, &new.path);
            match fs::symlink_metadata(&destination) {
                Ok(_) => {
                    validate_file_within(profiles_dir, &destination)
                        .map_err(|err| ProfileError::Io(err.to_string()))?;
                    let actual = crate::hash::sha256_file(&destination)
                        .map_err(|err| ProfileError::Io(err.to_string()))?;
                    let already_old = old.is_some_and(|old| {
                        old.storage == FileStorage::Exclusive
                            && portable_path_key(&old.path).ok()
                                == portable_path_key(&new.path).ok()
                            && actual.eq_ignore_ascii_case(&old.sha256)
                    });
                    if !already_old {
                        if !actual.eq_ignore_ascii_case(&new.sha256) {
                            return Err(ProfileError::Io(format!(
                                "Cannot safely recover profile file: {}",
                                new.path
                            )));
                        }
                        remove_file_force_within(profiles_dir, &destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?;
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(ProfileError::Io(err.to_string())),
            }
        }

        if let Some(old) = old.filter(|file| file.storage == FileStorage::Exclusive) {
            let destination = exclusive_file_path(profiles_dir, &journal.profile_id, &old.path);
            let backup = mutation_file_path(
                profiles_dir,
                &journal.profile_id,
                &journal.transaction_id,
                "old",
                &old.path,
            );
            if fs::symlink_metadata(&backup).is_ok() {
                validate_file_within(profiles_dir, &backup)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                let actual = crate::hash::sha256_file(&backup)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                if !actual.eq_ignore_ascii_case(&old.sha256) {
                    return Err(ProfileError::Io(format!(
                        "Profile recovery backup has the wrong digest: {}",
                        old.path
                    )));
                }
                match fs::symlink_metadata(&destination) {
                    Ok(_) => {
                        validate_file_within(profiles_dir, &destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?;
                        let current = crate::hash::sha256_file(&destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?;
                        if !current.eq_ignore_ascii_case(&old.sha256) {
                            return Err(ProfileError::Io(format!(
                                "Cannot safely restore profile file: {}",
                                old.path
                            )));
                        }
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                        move_file_within(profiles_dir, &backup, &destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?;
                    }
                    Err(err) => return Err(ProfileError::Io(err.to_string())),
                }
            } else {
                validate_file_within(profiles_dir, &destination)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                let actual = crate::hash::sha256_file(&destination)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                if !actual.eq_ignore_ascii_case(&old.sha256) {
                    return Err(ProfileError::Io(format!(
                        "Cannot safely recover profile file: {}",
                        old.path
                    )));
                }
            }
        }
    }
    Ok(())
}

fn roll_forward_committed_profile_mutation(
    profiles_dir: &Path,
    tf2_root: &Path,
    journal: &ProfileMutationJournal,
) -> Result<(), ProfileError> {
    for change in &journal.file_changes {
        let old = manifest_entry(&journal.old_manifest, &change.old_path);
        let new = manifest_entry(&journal.new_manifest, &change.new_path);
        if let Some(new) = new.filter(|file| file.storage == FileStorage::Exclusive) {
            let destination = exclusive_file_path(profiles_dir, &journal.profile_id, &new.path);
            let current = match fs::symlink_metadata(&destination) {
                Ok(_) => {
                    validate_file_within(profiles_dir, &destination)
                        .map_err(|err| ProfileError::Io(err.to_string()))?;
                    Some(
                        crate::hash::sha256_file(&destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?,
                    )
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
                Err(err) => return Err(ProfileError::Io(err.to_string())),
            };
            if !current
                .as_ref()
                .is_some_and(|hash| hash.eq_ignore_ascii_case(&new.sha256))
            {
                let staged = mutation_file_path(
                    profiles_dir,
                    &journal.profile_id,
                    &journal.transaction_id,
                    "new",
                    &new.path,
                );
                validate_file_within(profiles_dir, &staged)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                let staged_hash = crate::hash::sha256_file(&staged)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                if !staged_hash.eq_ignore_ascii_case(&new.sha256) {
                    return Err(ProfileError::Io(format!(
                        "Committed profile staging has the wrong digest: {}",
                        new.path
                    )));
                }
                if current.is_some() {
                    return Err(ProfileError::Io(format!(
                        "Cannot safely finish committed profile file: {}",
                        new.path
                    )));
                }
                refuse_writes(profile_live_process_names())?;
                move_file_within(profiles_dir, &staged, &destination)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
            }
        }
        if let Some(old) = old.filter(|file| file.storage == FileStorage::Exclusive) {
            let still_final = new.is_some_and(|new| {
                new.storage == FileStorage::Exclusive
                    && (new.path == old.path
                        || (cfg!(windows)
                            && portable_path_key(&new.path).ok()
                                == portable_path_key(&old.path).ok()))
            });
            if !still_final {
                let old_destination =
                    exclusive_file_path(profiles_dir, &journal.profile_id, &old.path);
                match fs::symlink_metadata(&old_destination) {
                    Ok(_) => {
                        validate_file_within(profiles_dir, &old_destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?;
                        let actual = crate::hash::sha256_file(&old_destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?;
                        if !actual.eq_ignore_ascii_case(&old.sha256) {
                            return Err(ProfileError::Io(format!(
                                "Cannot safely finish removal of profile file: {}",
                                old.path
                            )));
                        }
                        refuse_writes(profile_live_process_names())?;
                        remove_file_force_within(profiles_dir, &old_destination)
                            .map_err(|err| ProfileError::Io(err.to_string()))?;
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                    Err(err) => return Err(ProfileError::Io(err.to_string())),
                }
            }
        }
    }

    for file in &journal.new_manifest.files {
        let source = profile_entry_source(profiles_dir, &journal.profile_id, file);
        validate_file_within(profiles_dir, &source)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        let actual =
            crate::hash::sha256_file(&source).map_err(|err| ProfileError::Io(err.to_string()))?;
        if !actual.eq_ignore_ascii_case(&file.sha256) {
            return Err(ProfileError::Io(format!(
                "Committed profile file has the wrong digest: {}",
                file.path
            )));
        }
    }

    for rename in &journal.live_renames {
        let disabled = profile_live_path(tf2_root, &rename.to);
        validate_dir_within(tf2_root, &disabled).map_err(|err| {
            ProfileError::Io(format!(
                "Committed live directory rename is incomplete ({}): {err}",
                rename.to
            ))
        })?;
    }

    if !journal.live_changes.is_empty() {
        for change in &journal.live_changes {
            let destination = profile_live_path(tf2_root, &change.path);
            let current = current_live_hash(tf2_root, &destination)?;
            if hashes_match(&current, &change.new_sha256) {
                continue;
            }
            if current.is_some() && !hashes_match(&current, &change.old_sha256) {
                return Err(ProfileError::Io(format!(
                    "Cannot safely finish a committed live file changed by another process: {}",
                    change.path
                )));
            }
            refuse_writes(profile_live_process_names())?;
            if let Some(new_hash) = &change.new_sha256 {
                let file = journal
                    .new_manifest
                    .files
                    .iter()
                    .find(|file| {
                        portable_path_key(&file.path).ok() == portable_path_key(&change.path).ok()
                    })
                    .ok_or_else(|| {
                        ProfileError::Io(format!(
                            "Committed transaction has no live source: {}",
                            change.path
                        ))
                    })?;
                let source = profile_entry_source(profiles_dir, &journal.profile_id, file);
                copy_verified_atomic_within(tf2_root, &source, &destination, new_hash)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
            } else if current.is_some() {
                remove_file_force_within(tf2_root, &destination)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
            }
        }
    }

    if let (Some(expected_index), Some(old_index)) = (&journal.new_index, &journal.old_index) {
        let mut current_index = load_index(profiles_dir)?.ok_or(ProfileError::NotInitialized)?;
        if merge_profile_index_delta(
            &mut current_index,
            expected_index,
            old_index,
            &journal.profile_id,
        )? {
            refuse_writes(profile_live_process_names())?;
            write_json_within(profiles_dir, &index_file(profiles_dir), &current_index)?;
        }
    }
    Ok(())
}

/// `put_profile_files_to` for files that already live on disk.
pub fn put_exclusive_files_from_paths_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    files: &[(String, PathBuf)],
    running_names: I,
) -> Result<Vec<String>, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let batch: Vec<(String, FileSource<'_>)> = files
        .iter()
        .map(|(rel, source)| {
            Ok((
                rel.clone(),
                FileSource::PathExact {
                    path: source.as_path(),
                    expected_len: source_file_len(source)?,
                },
            ))
        })
        .collect::<Result<_, ProfileError>>()?;
    put_profile_files_to(profiles_dir, tf2_root, profile_id, &batch, running_names)
}

pub fn put_shared_blob_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    bytes: &[u8],
    running_names: I,
) -> Result<String, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let path = checked_rel_path(rel_path)?;
    if !is_shared_rel_path(&path) {
        return Err(ProfileError::NotShareable(path));
    }
    put_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[(path, FileSource::Bytes(bytes))],
        running_names,
    )?
    .into_iter()
    .next()
    .ok_or_else(|| ProfileError::Io("shared profile write produced no digest".into()))
}

pub fn put_shared_blob_from_path_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel_path: &str,
    source: &Path,
    running_names: I,
) -> Result<String, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let path = checked_rel_path(rel_path)?;
    if !is_shared_rel_path(&path) {
        return Err(ProfileError::NotShareable(path));
    }
    let expected_len = source_file_len(source)?;
    put_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[(
            path,
            FileSource::PathExact {
                path: source,
                expected_len,
            },
        )],
        running_names,
    )?
    .into_iter()
    .next()
    .ok_or_else(|| ProfileError::Io("shared profile copy produced no digest".into()))
}

pub fn remove_profile_record_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let mut index = usable_index(profiles_dir, tf2_root)?;
    if !index
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    if index.active_profile_id.as_deref() == Some(profile_id) {
        return Err(ProfileError::Io(
            "Switch to another profile before deleting the active profile.".into(),
        ));
    }
    if index.pending_switch.as_ref().is_some_and(|pending| {
        pending.target_profile_id == profile_id
            || pending
                .cleanup_profile_ids
                .iter()
                .any(|id| id == profile_id)
    }) {
        return Err(ProfileError::Io(
            "Finish or retry the interrupted profile switch before deleting this profile.".into(),
        ));
    }
    recover_profile_mutation_to(profiles_dir, tf2_root, profile_id)?;

    // Detach the record first. If deletion is interrupted after this durable
    // commit, only unreachable payload data remains; the reverse ordering can
    // leave an index entry whose manifest and files were already destroyed.
    index.profiles.retain(|profile| profile.id != profile_id);
    if index.interrupted_profile_id.as_deref() == Some(profile_id) {
        index.interrupted_profile_id = None;
    }
    write_json_within(profiles_dir, &index_file(profiles_dir), &index)?;

    let dir = profile_dir(profiles_dir, profile_id);
    if let Ok(meta) = fs::symlink_metadata(&dir) {
        if !crate::hash::metadata_is_link(&meta)
            && meta.is_dir()
            && crate::hash::validate_dir_within(profiles_dir, &dir).is_ok()
        {
            // Cleanup is intentionally best-effort after the logical delete.
            // A locked file leaves an orphan that no manifest can reference;
            // reporting failure here would invite a retry that can never find
            // the now-deleted record.
            let _ = remove_transaction_tree(profiles_dir, &dir);
        }
    }
    if let Ok(referenced) = referenced_shared_hashes(profiles_dir, &index) {
        let _ = gc_unreferenced_blobs(profiles_dir, &referenced);
    }
    load_library_from(profiles_dir, Some(tf2_root))
}

pub fn set_active_profile_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let mut index = usable_index(profiles_dir, tf2_root)?;
    if !index
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    index.active_profile_id = Some(profile_id.to_string());
    // A completed switch has finished any Remove step a failed one left.
    index.interrupted_profile_id = None;
    index.pending_switch = None;
    write_json_within(profiles_dir, &index_file(profiles_dir), &index)?;
    load_library_from(profiles_dir, Some(tf2_root))
}

/// Point the index at no profile at all. Used when a switch fails after the
/// live tree has already been part-emptied: leaving `activeProfileId` on the
/// old profile makes the next auto-absorb swallow the half-replaced tree into
/// it and destroy it. `interrupted_profile_id` records whose files the failed
/// switch was removing, so the retry can finish that step.
pub fn clear_active_profile_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    interrupted_profile_id: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let mut index = usable_index(profiles_dir, tf2_root)?;
    index.active_profile_id = None;
    index.interrupted_profile_id = Some(interrupted_profile_id.to_string());
    index.pending_switch = None;
    write_json_within(profiles_dir, &index_file(profiles_dir), &index)?;
    load_library_from(profiles_dir, Some(tf2_root))
}

/// Read the durable switch record without exposing it through the frontend
/// library model.
pub(crate) fn pending_switch_to(
    profiles_dir: &Path,
    tf2_root: &Path,
) -> Result<Option<SwitchJournal>, ProfileError> {
    Ok(usable_index(profiles_dir, tf2_root)?.pending_switch)
}

/// Publish recovery state before the first destructive switch operation.
pub(crate) fn begin_switch_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    target_profile_id: &str,
    cleanup_profile_ids: &[String],
    running_names: I,
) -> Result<SwitchJournal, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    let mut index = usable_index(profiles_dir, tf2_root)?;
    if !index
        .profiles
        .iter()
        .any(|profile| profile.id == target_profile_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    let known: HashSet<&str> = index
        .profiles
        .iter()
        .map(|profile| profile.id.as_str())
        .collect();
    let mut cleanup: Vec<String> = cleanup_profile_ids
        .iter()
        .filter(|id| known.contains(id.as_str()))
        .cloned()
        .collect();
    cleanup.push(target_profile_id.to_string());
    cleanup.sort();
    cleanup.dedup();
    let mut cleanup_files = index
        .pending_switch
        .as_ref()
        .map(|pending| pending.cleanup_files.clone())
        .unwrap_or_default();
    for id in &cleanup {
        recover_profile_mutation_to(profiles_dir, tf2_root, id)?;
        let manifest = load_manifest_raw(profiles_dir, id)?;
        cleanup_files.extend(
            manifest
                .files
                .into_iter()
                .filter(|file| is_profile_ownable_rel_path(&file.path))
                .map(|file| SwitchCleanupFile {
                    path: file.path,
                    sha256: file.sha256,
                }),
        );
    }
    let mut seen = HashSet::new();
    cleanup_files.retain(|file| {
        file.sha256.len() == 64
            && file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            && portable_path_key(&file.path)
                .ok()
                .is_some_and(|key| seen.insert((key, file.sha256.to_ascii_lowercase())))
    });
    cleanup_files.sort_by(|left, right| {
        portable_path_key(&left.path)
            .unwrap_or_else(|_| left.path.clone())
            .cmp(&portable_path_key(&right.path).unwrap_or_else(|_| right.path.clone()))
            .then_with(|| left.sha256.cmp(&right.sha256))
    });

    index.active_profile_id = None;
    index.interrupted_profile_id = cleanup_profile_ids
        .iter()
        .find(|id| id.as_str() != target_profile_id)
        .cloned();
    let journal = SwitchJournal {
        target_profile_id: target_profile_id.to_string(),
        cleanup_profile_ids: cleanup,
        cleanup_files,
    };
    index.pending_switch = Some(journal.clone());
    write_json_within(profiles_dir, &index_file(profiles_dir), &index)?;
    Ok(journal)
}

pub fn remove_manifest_files_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    paths: &[String],
    running_names: I,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[],
        paths,
        ProfileLiveProjection::LibraryOnly,
        running_names,
        |_| Ok(()),
    )?;
    if let Ok(index) = usable_index(profiles_dir, tf2_root) {
        if let Ok(referenced) = referenced_shared_hashes(profiles_dir, &index) {
            let _ = gc_unreferenced_blobs(profiles_dir, &referenced);
        }
    }
    Ok(())
}

pub fn load_manifest(
    profiles_dir: &Path,
    profile_id: &str,
) -> Result<ProfileManifest, ProfileError> {
    if checked_mutation_journal_path(profiles_dir, profile_id)?.is_some() {
        return Err(ProfileError::Io(
            "An interrupted profile update must be recovered before this profile is read.".into(),
        ));
    }
    load_manifest_raw(profiles_dir, profile_id)
}

fn load_manifest_raw(
    profiles_dir: &Path,
    profile_id: &str,
) -> Result<ProfileManifest, ProfileError> {
    validated_profile_root(profiles_dir, profile_id)?;
    // Only a missing file means "not in the library". A sharing violation or
    // permission error mid-switch used to read as UnknownProfile, which sent
    // the user hunting for a profile that was there all along.
    let text = read_small_text_bounded(
        &manifest_file(profiles_dir, profile_id),
        MAX_PROFILE_MANIFEST_BYTES,
    )
    .map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            ProfileError::UnknownProfile
        } else {
            ProfileError::Io(format!("Could not read the profile manifest: {err}"))
        }
    })?;
    let mut manifest: ProfileManifest =
        serde_json::from_str(&text).map_err(|e| ProfileError::Io(e.to_string()))?;
    if manifest.schema != LIBRARY_SCHEMA {
        return Err(ProfileError::Io("unsupported profile schema".into()));
    }
    if manifest.id != profile_id {
        return Err(ProfileError::Io(
            "profile manifest id does not match its directory".into(),
        ));
    }
    manifest.tf2_root = user_path_string(Path::new(&manifest.tf2_root));
    Ok(manifest)
}

struct ValidatedProfileMutation {
    journal: ProfileMutationJournal,
    confirmed_live_root: PathBuf,
}

fn validate_embedded_mutation_index(
    index: &LibraryIndex,
    confirmed_root: &Path,
    profile_id: &str,
) -> Result<(), ProfileError> {
    if index.schema != LIBRARY_SCHEMA
        || index.profiles.len() > MAX_LIBRARY_PROFILES
        || !roots_match(&index.tf2_root, confirmed_root)
    {
        return Err(ProfileError::Io(
            "Invalid library index in interrupted profile-update journal.".into(),
        ));
    }
    let mut ids = HashSet::new();
    if index
        .profiles
        .iter()
        .any(|profile| !valid_profile_id(&profile.id) || !ids.insert(profile.id.as_str()))
        || !ids.contains(profile_id)
        || index
            .active_profile_id
            .as_deref()
            .is_some_and(|id| !ids.contains(id))
        || index
            .interrupted_profile_id
            .as_deref()
            .is_some_and(|id| !ids.contains(id))
        || index
            .pending_switch
            .as_ref()
            .is_some_and(|pending| !ids.contains(pending.target_profile_id.as_str()))
    {
        return Err(ProfileError::Io(
            "Invalid profile membership in interrupted library index.".into(),
        ));
    }
    Ok(())
}

fn derived_profile_file_changes(
    old_manifest: &ProfileManifest,
    new_manifest: &ProfileManifest,
) -> Result<Vec<ProfileFileChange>, ProfileError> {
    let old_by_key: HashMap<String, &ProfileFile> = old_manifest
        .files
        .iter()
        .map(|file| Ok((portable_path_key(&file.path)?, file)))
        .collect::<Result<_, ProfileError>>()?;
    let new_by_key: HashMap<String, &ProfileFile> = new_manifest
        .files
        .iter()
        .map(|file| Ok((portable_path_key(&file.path)?, file)))
        .collect::<Result<_, ProfileError>>()?;
    let keys: BTreeSet<String> = old_by_key
        .keys()
        .chain(new_by_key.keys())
        .cloned()
        .collect();
    Ok(keys
        .into_iter()
        .filter_map(|key| {
            let old = old_by_key.get(&key).copied();
            let new = new_by_key.get(&key).copied();
            (old != new).then(|| ProfileFileChange {
                old_path: old.map(|file| file.path.clone()),
                new_path: new.map(|file| file.path.clone()),
            })
        })
        .collect())
}

fn validate_journal_file_delta(journal: &ProfileMutationJournal) -> Result<(), ProfileError> {
    let expected = derived_profile_file_changes(&journal.old_manifest, &journal.new_manifest)?;
    if journal.file_changes == expected {
        return Ok(());
    }
    // Compatibility with the first journal format, which recorded one path
    // per changed portable key instead of explicit old/new path pairs.
    if journal.file_changes.is_empty() && !journal.touched_paths.is_empty() {
        let expected_keys: HashSet<String> = expected
            .iter()
            .filter_map(|change| change.new_path.as_ref().or(change.old_path.as_ref()))
            .map(|path| portable_path_key(path))
            .collect::<Result<_, ProfileError>>()?;
        let touched_keys: HashSet<String> = journal
            .touched_paths
            .iter()
            .map(|path| checked_rel_path(path).and_then(|path| portable_path_key(&path)))
            .collect::<Result<_, ProfileError>>()?;
        if expected_keys == touched_keys && touched_keys.len() == journal.touched_paths.len() {
            return Ok(());
        }
    }
    Err(ProfileError::Io(
        "Interrupted profile-update journal has an invalid file delta.".into(),
    ))
}

fn read_validated_profile_mutation(
    profiles_dir: &Path,
    tf2_root: &Path,
    current_index: &LibraryIndex,
    profile_id: &str,
) -> Result<Option<ValidatedProfileMutation>, ProfileError> {
    let Some(journal_path) = checked_mutation_journal_path(profiles_dir, profile_id)? else {
        return Ok(None);
    };
    let text = read_small_text_bounded(&journal_path, MAX_MUTATION_JOURNAL_BYTES)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    let journal: ProfileMutationJournal =
        serde_json::from_str(&text).map_err(|e| ProfileError::Io(e.to_string()))?;
    if !roots_match(&current_index.tf2_root, tf2_root) {
        return Err(ProfileError::RootMismatch {
            library_root: current_index.tf2_root.clone(),
            confirmed_root: user_path_string(tf2_root),
        });
    }
    validate_embedded_mutation_index(current_index, tf2_root, profile_id)?;
    if journal.profile_id != profile_id
        || journal.old_manifest.id != profile_id
        || journal.new_manifest.id != profile_id
        || journal.old_manifest.schema != LIBRARY_SCHEMA
        || journal.new_manifest.schema != LIBRARY_SCHEMA
        || !valid_transaction_id(&journal.transaction_id)
        || journal.file_changes.len() > MAX_PROFILE_FILES
        || journal.touched_paths.len() > MAX_PROFILE_FILES
        || journal.live_changes.len() > MAX_PROFILE_FILES
        || journal.live_renames.len() > MAX_PROFILE_FILES
    {
        return Err(ProfileError::Io(
            "Invalid interrupted profile-update journal.".into(),
        ));
    }
    let has_live_recovery = !journal.live_changes.is_empty() || !journal.live_renames.is_empty();
    let confirmed_live_root = if has_live_recovery {
        crate::finder::normalize_tf2_root(tf2_root).map_err(|err| {
            ProfileError::Io(format!(
                "Refusing interrupted live-profile recovery: {}",
                err.message()
            ))
        })?
    } else {
        tf2_root.to_path_buf()
    };
    let old_root = Path::new(&journal.old_manifest.tf2_root);
    let new_root = Path::new(&journal.new_manifest.tf2_root);
    if !confirmed_live_root.is_absolute()
        || !old_root.is_absolute()
        || !new_root.is_absolute()
        || !roots_match(&journal.old_manifest.tf2_root, &confirmed_live_root)
        || !roots_match(&journal.new_manifest.tf2_root, &confirmed_live_root)
        || !roots_match(&journal.old_manifest.tf2_root, new_root)
    {
        return Err(ProfileError::Io(
            "Interrupted profile-update journal belongs to another TF2 root.".into(),
        ));
    }
    validate_manifest_files(&journal.old_manifest)?;
    validate_manifest_files(&journal.new_manifest)?;
    validate_journal_file_delta(&journal)?;
    validate_live_rename_plan(&journal.live_renames)?;

    let mut live_keys = HashSet::new();
    for change in &journal.live_changes {
        let path = checked_rel_path(&change.path)?;
        if !live_keys.insert(portable_path_key(&path)?) {
            return Err(ProfileError::Io(
                "Interrupted profile-update journal has duplicate live paths.".into(),
            ));
        }
        for hash in [&change.old_sha256, &change.new_sha256]
            .into_iter()
            .flatten()
        {
            if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(ProfileError::Io(
                    "Invalid digest in interrupted profile-update journal.".into(),
                ));
            }
        }
        if let Some(new_hash) = &change.new_sha256 {
            let Some(file) =
                journal.new_manifest.files.iter().find(|file| {
                    portable_path_key(&file.path).ok() == portable_path_key(&path).ok()
                })
            else {
                return Err(ProfileError::Io(
                    "Interrupted live update has no target manifest file.".into(),
                ));
            };
            if !file.sha256.eq_ignore_ascii_case(new_hash) {
                return Err(ProfileError::Io(
                    "Interrupted live update disagrees with its target manifest.".into(),
                ));
            }
        }
    }
    match (&journal.old_index, &journal.new_index) {
        (None, None) => {}
        (Some(old), Some(new)) => {
            validate_embedded_mutation_index(old, &confirmed_live_root, profile_id)?;
            validate_embedded_mutation_index(new, &confirmed_live_root, profile_id)?;
        }
        _ => {
            return Err(ProfileError::Io(
                "Interrupted profile update has an incomplete index delta.".into(),
            ))
        }
    }
    Ok(Some(ValidatedProfileMutation {
        journal,
        confirmed_live_root,
    }))
}

fn scan_profile_mutations_to(
    profiles_dir: &Path,
    tf2_root: &Path,
) -> Result<Vec<(String, bool)>, ProfileError> {
    let Some(index) = load_index(profiles_dir)? else {
        return Ok(Vec::new());
    };
    if index.profiles.len() > MAX_LIBRARY_PROFILES {
        return Err(ProfileError::Io(
            "Profile library contains too many records to scan safely.".into(),
        ));
    }
    if !roots_match(&index.tf2_root, tf2_root) {
        return Err(ProfileError::RootMismatch {
            library_root: index.tf2_root,
            confirmed_root: user_path_string(tf2_root),
        });
    }
    let mut pending = Vec::new();
    for profile in &index.profiles {
        if let Some(validated) =
            read_validated_profile_mutation(profiles_dir, tf2_root, &index, &profile.id)?
        {
            pending.push((profile.id.clone(), validated.journal.committed));
        }
    }
    Ok(pending)
}

pub fn profile_mutation_status_to(
    profiles_dir: &Path,
    tf2_root: &Path,
) -> Result<ProfileMutationRecoveryState, ProfileError> {
    let pending = scan_profile_mutations_to(profiles_dir, tf2_root)?;
    if pending.iter().any(|(_, committed)| !committed) {
        Ok(ProfileMutationRecoveryState::Prepared)
    } else if pending.is_empty() {
        Ok(ProfileMutationRecoveryState::Clean)
    } else {
        Ok(ProfileMutationRecoveryState::Committed)
    }
}

pub fn recover_all_profile_mutations_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    running_names: I,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_writes(running_names)?;
    // Validate every journal before the first recovery write. A corrupt or
    // linked later record therefore fails closed without partially recovering
    // an earlier profile and then allowing unrelated commands to proceed.
    let pending = scan_profile_mutations_to(profiles_dir, tf2_root)?;
    if !pending.is_empty() {
        let current_index = load_index(profiles_dir)?.ok_or(ProfileError::NotInitialized)?;
        for (profile_id, _) in &pending {
            let validated = read_validated_profile_mutation(
                profiles_dir,
                tf2_root,
                &current_index,
                profile_id,
            )?
            .ok_or_else(|| {
                ProfileError::Io("A profile recovery journal disappeared during preflight.".into())
            })?;
            preflight_profile_mutation_recovery(
                profiles_dir,
                &validated.confirmed_live_root,
                &current_index,
                &validated.journal,
            )?;
        }
    }
    for (profile_id, _) in pending {
        refuse_writes(profile_live_process_names())?;
        recover_profile_mutation_to(profiles_dir, tf2_root, &profile_id)?;
    }
    if profile_mutation_status_to(profiles_dir, tf2_root)? != ProfileMutationRecoveryState::Clean {
        return Err(ProfileError::Io(
            "Profile recovery did not finish every interrupted update.".into(),
        ));
    }
    Ok(())
}

fn optional_regular_hash_within(root: &Path, path: &Path) -> Result<Option<String>, ProfileError> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            validate_file_within(root, path).map_err(|err| ProfileError::Io(err.to_string()))?;
            sha256_file(path)
                .map(Some)
                .map_err(|err| ProfileError::Io(err.to_string()))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(ProfileError::Io(err.to_string())),
    }
}

fn preflight_empty_live_tree(
    tf2_root: &Path,
    dir: &Path,
    removable_files: &HashSet<String>,
    visited: &mut usize,
    depth: usize,
) -> Result<(), ProfileError> {
    if depth > MAX_PROFILE_PATH_DEPTH + 8 {
        return Err(ProfileError::Io(
            "Interrupted live rename contains an excessively deep directory tree.".into(),
        ));
    }
    validate_dir_within(tf2_root, dir).map_err(|err| ProfileError::Io(err.to_string()))?;
    for entry in fs::read_dir(dir).map_err(|err| ProfileError::Io(err.to_string()))? {
        *visited = visited.saturating_add(1);
        if *visited > MAX_TRANSACTION_TREE_ENTRIES {
            return Err(ProfileError::Io(
                "Interrupted live rename contains too many directories.".into(),
            ));
        }
        let path = entry
            .map_err(|err| ProfileError::Io(err.to_string()))?
            .path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|err| ProfileError::Io(err.to_string()))?;
        if crate::hash::metadata_is_link(&metadata) {
            return Err(ProfileError::Io(format!(
                "Refusing to discard unexpected data while restoring a live directory: {}",
                path.display()
            )));
        }
        let removable = path
            .strip_prefix(tf2_root)
            .ok()
            .map(|relative| relative.to_string_lossy().replace('\\', "/"))
            .and_then(|relative| portable_path_key(&relative).ok())
            .is_some_and(|key| removable_files.contains(&key));
        if metadata.is_file() && removable {
            validate_file_within(tf2_root, &path)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
        } else if metadata.is_dir() {
            preflight_empty_live_tree(tf2_root, &path, removable_files, visited, depth + 1)?;
        } else {
            return Err(ProfileError::Io(format!(
                "Refusing to discard unexpected data while restoring a live directory: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn preflight_live_rename_recovery(
    tf2_root: &Path,
    renames: &[ProfileLiveRename],
    live_changes: &[ProfileLiveChange],
    committed: bool,
) -> Result<(), ProfileError> {
    let removable_files: HashSet<String> = live_changes
        .iter()
        .filter(|change| change.old_sha256.is_none())
        .map(|change| portable_path_key(&change.path))
        .collect::<Result<_, ProfileError>>()?;
    for rename in renames {
        let from = profile_live_path(tf2_root, &checked_live_pack_dir(&rename.from)?);
        let to = profile_live_path(tf2_root, &checked_live_pack_dir(&rename.to)?);
        let from_exists = match fs::symlink_metadata(&from) {
            Ok(_) => {
                validate_dir_within(tf2_root, &from)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                true
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => false,
            Err(err) => return Err(ProfileError::Io(err.to_string())),
        };
        let to_exists = match fs::symlink_metadata(&to) {
            Ok(_) => {
                validate_dir_within(tf2_root, &to)
                    .map_err(|err| ProfileError::Io(err.to_string()))?;
                true
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => false,
            Err(err) => return Err(ProfileError::Io(err.to_string())),
        };
        if !from_exists && !to_exists {
            return Err(ProfileError::Io(format!(
                "Interrupted live directory rename has neither endpoint: {}",
                rename.from
            )));
        }
        if committed && !to_exists {
            return Err(ProfileError::Io(format!(
                "Committed live directory rename is incomplete: {}",
                rename.to
            )));
        }
        if !committed && from_exists && to_exists {
            preflight_empty_live_tree(tf2_root, &from, &removable_files, &mut 0, 0)?;
        }
    }
    Ok(())
}

fn recovery_file_changes(
    journal: &ProfileMutationJournal,
) -> Result<Vec<ProfileFileChange>, ProfileError> {
    if journal.file_changes.is_empty() && !journal.touched_paths.is_empty() {
        derived_profile_file_changes(&journal.old_manifest, &journal.new_manifest)
    } else {
        Ok(journal.file_changes.clone())
    }
}

fn preflight_profile_mutation_recovery(
    profiles_dir: &Path,
    tf2_root: &Path,
    current_index: &LibraryIndex,
    journal: &ProfileMutationJournal,
) -> Result<(), ProfileError> {
    let current_manifest = load_manifest_raw(profiles_dir, &journal.profile_id)?;
    if current_manifest != journal.old_manifest && current_manifest != journal.new_manifest {
        return Err(ProfileError::Io(
            "Interrupted profile update found a conflicting manifest.".into(),
        ));
    }
    if journal.committed && current_manifest != journal.new_manifest {
        return Err(ProfileError::Io(
            "Committed profile-update journal does not match manifest.".into(),
        ));
    }

    if let (Some(old_index), Some(new_index)) = (&journal.old_index, &journal.new_index) {
        let mut projected = current_index.clone();
        if journal.committed {
            merge_profile_index_delta(&mut projected, new_index, old_index, &journal.profile_id)?;
        } else {
            merge_profile_index_delta(&mut projected, old_index, new_index, &journal.profile_id)?;
        }
    }

    preflight_live_rename_recovery(
        tf2_root,
        &journal.live_renames,
        &journal.live_changes,
        journal.committed,
    )?;
    for change in &journal.live_changes {
        let destination = profile_live_path(tf2_root, &change.path);
        let current = optional_regular_hash_within(tf2_root, &destination)?;
        if !hashes_match(&current, &change.old_sha256)
            && !hashes_match(&current, &change.new_sha256)
        {
            return Err(ProfileError::Io(format!(
                "Cannot safely recover a live file changed by another process: {}",
                change.path
            )));
        }
        if !journal.committed
            && hashes_match(&current, &change.new_sha256)
            && !hashes_match(&current, &change.old_sha256)
        {
            if let Some(old_hash) = &change.old_sha256 {
                let backup = mutation_file_path(
                    profiles_dir,
                    &journal.profile_id,
                    &journal.transaction_id,
                    "live-old",
                    &change.path,
                );
                let backup_hash = optional_regular_hash_within(profiles_dir, &backup)?;
                if !backup_hash
                    .as_ref()
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(old_hash))
                {
                    return Err(ProfileError::Io(format!(
                        "Live recovery backup has the wrong digest: {}",
                        change.path
                    )));
                }
            }
        }
        if journal.committed
            && !hashes_match(&current, &change.new_sha256)
            && change.new_sha256.is_some()
        {
            let file = journal
                .new_manifest
                .files
                .iter()
                .find(|file| {
                    portable_path_key(&file.path).ok() == portable_path_key(&change.path).ok()
                })
                .ok_or_else(|| {
                    ProfileError::Io(format!(
                        "Committed transaction has no live source: {}",
                        change.path
                    ))
                })?;
            let source = if file.storage == FileStorage::Exclusive {
                let destination =
                    exclusive_file_path(profiles_dir, &journal.profile_id, &file.path);
                if optional_regular_hash_within(profiles_dir, &destination)?
                    .as_ref()
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(&file.sha256))
                {
                    destination
                } else {
                    mutation_file_path(
                        profiles_dir,
                        &journal.profile_id,
                        &journal.transaction_id,
                        "new",
                        &file.path,
                    )
                }
            } else {
                profile_entry_source(profiles_dir, &journal.profile_id, file)
            };
            let source_hash = optional_regular_hash_within(profiles_dir, &source)?;
            if !source_hash
                .as_ref()
                .is_some_and(|hash| hash.eq_ignore_ascii_case(&file.sha256))
            {
                return Err(ProfileError::Io(format!(
                    "Committed live source has the wrong digest: {}",
                    change.path
                )));
            }
        }
    }

    for change in recovery_file_changes(journal)? {
        let old = manifest_entry(&journal.old_manifest, &change.old_path);
        let new = manifest_entry(&journal.new_manifest, &change.new_path);
        let aliases = match (old, new) {
            (Some(old), Some(new))
                if old.storage == FileStorage::Exclusive
                    && new.storage == FileStorage::Exclusive =>
            {
                portable_path_key(&old.path)? == portable_path_key(&new.path)?
            }
            _ => false,
        };

        if journal.committed {
            if let Some(new) = new {
                if new.storage == FileStorage::Shared {
                    let source = profile_entry_source(profiles_dir, &journal.profile_id, new);
                    let actual = optional_regular_hash_within(profiles_dir, &source)?;
                    if !actual
                        .as_ref()
                        .is_some_and(|hash| hash.eq_ignore_ascii_case(&new.sha256))
                    {
                        return Err(ProfileError::Io(format!(
                            "Committed profile file has the wrong digest: {}",
                            new.path
                        )));
                    }
                } else {
                    let destination =
                        exclusive_file_path(profiles_dir, &journal.profile_id, &new.path);
                    let current = optional_regular_hash_within(profiles_dir, &destination)?;
                    if !current
                        .as_ref()
                        .is_some_and(|hash| hash.eq_ignore_ascii_case(&new.sha256))
                    {
                        if current.is_some() {
                            return Err(ProfileError::Io(format!(
                                "Cannot safely finish committed profile file: {}",
                                new.path
                            )));
                        }
                        let staged = mutation_file_path(
                            profiles_dir,
                            &journal.profile_id,
                            &journal.transaction_id,
                            "new",
                            &new.path,
                        );
                        let staged_hash = optional_regular_hash_within(profiles_dir, &staged)?;
                        if !staged_hash
                            .as_ref()
                            .is_some_and(|hash| hash.eq_ignore_ascii_case(&new.sha256))
                        {
                            return Err(ProfileError::Io(format!(
                                "Committed profile staging has the wrong digest: {}",
                                new.path
                            )));
                        }
                    }
                }
            }
            if let Some(old) = old.filter(|file| file.storage == FileStorage::Exclusive) {
                if !aliases {
                    let destination =
                        exclusive_file_path(profiles_dir, &journal.profile_id, &old.path);
                    if let Some(actual) = optional_regular_hash_within(profiles_dir, &destination)?
                    {
                        if !actual.eq_ignore_ascii_case(&old.sha256) {
                            return Err(ProfileError::Io(format!(
                                "Cannot safely finish removal of profile file: {}",
                                old.path
                            )));
                        }
                    }
                }
            }
        } else {
            if let Some(new) = new.filter(|file| file.storage == FileStorage::Exclusive) {
                let destination = exclusive_file_path(profiles_dir, &journal.profile_id, &new.path);
                if let Some(actual) = optional_regular_hash_within(profiles_dir, &destination)? {
                    let already_old =
                        aliases && old.is_some_and(|old| actual.eq_ignore_ascii_case(&old.sha256));
                    if !already_old && !actual.eq_ignore_ascii_case(&new.sha256) {
                        return Err(ProfileError::Io(format!(
                            "Cannot safely recover profile file: {}",
                            new.path
                        )));
                    }
                }
            }
            if let Some(old) = old.filter(|file| file.storage == FileStorage::Exclusive) {
                let destination = exclusive_file_path(profiles_dir, &journal.profile_id, &old.path);
                let backup = mutation_file_path(
                    profiles_dir,
                    &journal.profile_id,
                    &journal.transaction_id,
                    "old",
                    &old.path,
                );
                if let Some(actual) = optional_regular_hash_within(profiles_dir, &backup)? {
                    if !actual.eq_ignore_ascii_case(&old.sha256) {
                        return Err(ProfileError::Io(format!(
                            "Profile recovery backup has the wrong digest: {}",
                            old.path
                        )));
                    }
                } else {
                    let current = optional_regular_hash_within(profiles_dir, &destination)?;
                    if !current
                        .as_ref()
                        .is_some_and(|hash| hash.eq_ignore_ascii_case(&old.sha256))
                    {
                        return Err(ProfileError::Io(format!(
                            "Cannot safely recover profile file: {}",
                            old.path
                        )));
                    }
                }
            }
        }
    }
    if journal.committed {
        for file in &journal.new_manifest.files {
            let destination = profile_entry_source(profiles_dir, &journal.profile_id, file);
            let current = optional_regular_hash_within(profiles_dir, &destination)?;
            if current
                .as_ref()
                .is_some_and(|hash| hash.eq_ignore_ascii_case(&file.sha256))
            {
                continue;
            }
            if current.is_some() || file.storage == FileStorage::Shared {
                return Err(ProfileError::Io(format!(
                    "Committed profile file has the wrong digest: {}",
                    file.path
                )));
            }
            let staged = mutation_file_path(
                profiles_dir,
                &journal.profile_id,
                &journal.transaction_id,
                "new",
                &file.path,
            );
            let staged_hash = optional_regular_hash_within(profiles_dir, &staged)?;
            if !staged_hash
                .as_ref()
                .is_some_and(|hash| hash.eq_ignore_ascii_case(&file.sha256))
            {
                return Err(ProfileError::Io(format!(
                    "Committed profile staging has the wrong digest: {}",
                    file.path
                )));
            }
        }
    }
    Ok(())
}

/// Roll back an incomplete per-profile payload transaction, or finish cleanup
/// for one whose commit marker was made durable. Call only after the write lock
/// has been checked by the public mutation entry point.
pub(crate) fn recover_profile_mutation_to(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
) -> Result<(), ProfileError> {
    let current_index = load_index(profiles_dir)?.ok_or(ProfileError::NotInitialized)?;
    let Some(validated) =
        read_validated_profile_mutation(profiles_dir, tf2_root, &current_index, profile_id)?
    else {
        sweep_orphan_mutation_data(profiles_dir, profile_id);
        return Ok(());
    };
    let journal = validated.journal;
    let confirmed_live_root = validated.confirmed_live_root;
    let journal_path = mutation_journal_file(profiles_dir, profile_id);
    preflight_profile_mutation_recovery(
        profiles_dir,
        &confirmed_live_root,
        &current_index,
        &journal,
    )?;

    if journal.committed {
        roll_forward_committed_profile_mutation(profiles_dir, &confirmed_live_root, &journal)?;
    } else {
        // Recovery itself mutates the library and may restore live files. The
        // original caller snapshot can be arbitrarily old after a restart.
        refuse_writes(profile_live_process_names())?;
        rollback_live_changes(profiles_dir, &confirmed_live_root, &journal)?;
        rollback_live_renames(&confirmed_live_root, &journal.live_renames)?;
        if journal.file_changes.is_empty() {
            // Compatibility with journals from the first transaction build.
            for rel in &journal.touched_paths {
                let rel = checked_rel_path(rel)?;
                let dest = exclusive_file_path(profiles_dir, profile_id, &rel);
                let backup = mutation_file_path(
                    profiles_dir,
                    profile_id,
                    &journal.transaction_id,
                    "old",
                    &rel,
                );
                let old = journal
                    .old_manifest
                    .files
                    .iter()
                    .find(|file| portable_path_key(&file.path).ok() == portable_path_key(&rel).ok())
                    .filter(|file| file.storage == FileStorage::Exclusive);
                if backup.is_file() {
                    if dest.is_file() {
                        remove_file_force_within(profiles_dir, &dest)
                            .map_err(|e| ProfileError::Io(e.to_string()))?;
                    }
                    move_file_within(profiles_dir, &backup, &dest)
                        .map_err(|e| ProfileError::Io(e.to_string()))?;
                } else if let Some(old) = old {
                    if dest.is_file() {
                        let actual = crate::hash::sha256_file(&dest)
                            .map_err(|e| ProfileError::Io(e.to_string()))?;
                        if !actual.eq_ignore_ascii_case(&old.sha256) {
                            let new_hash = journal
                                .new_manifest
                                .files
                                .iter()
                                .find(|file| {
                                    portable_path_key(&file.path).ok()
                                        == portable_path_key(&rel).ok()
                                })
                                .map(|file| file.sha256.as_str());
                            if new_hash.is_some_and(|hash| actual.eq_ignore_ascii_case(hash)) {
                                remove_file_force_within(profiles_dir, &dest)
                                    .map_err(|e| ProfileError::Io(e.to_string()))?;
                            } else {
                                return Err(ProfileError::Io(format!(
                                    "Cannot safely recover profile file: {rel}"
                                )));
                            }
                        }
                    }
                } else if dest.is_file() {
                    remove_file_force_within(profiles_dir, &dest)
                        .map_err(|e| ProfileError::Io(e.to_string()))?;
                }
            }
        } else {
            rollback_profile_file_changes(profiles_dir, &journal)?;
        }
        if load_manifest_raw(profiles_dir, profile_id)? != journal.old_manifest {
            write_json_within(
                profiles_dir,
                &manifest_file(profiles_dir, profile_id),
                &journal.old_manifest,
            )?;
        }
        if let (Some(old_index), Some(new_index)) = (&journal.old_index, &journal.new_index) {
            let mut current_index =
                load_index(profiles_dir)?.ok_or(ProfileError::NotInitialized)?;
            if merge_profile_index_delta(
                &mut current_index,
                old_index,
                new_index,
                &journal.profile_id,
            )? {
                refuse_writes(profile_live_process_names())?;
                write_json_within(profiles_dir, &index_file(profiles_dir), &current_index)?;
            }
        }
    }

    let cleaned = refuse_writes(profile_live_process_names()).is_ok()
        && cleanup_transaction_root(profiles_dir, profile_id, &journal.transaction_id);
    if cleaned && journal_path.is_file() {
        remove_file_force_within(profiles_dir, &journal_path)
            .map_err(|e| ProfileError::Io(e.to_string()))?;
    }
    Ok(())
}

/// The one manifest writer. Every path that changes a profile manifest goes
/// through here so the write lock is taken and `updated_at` is refreshed.
pub(crate) fn save_manifest<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    manifest: &ProfileManifest,
    running_names: I,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let desired = manifest.clone();
    mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        &manifest.id,
        &[],
        &[],
        ProfileLiveProjection::LibraryOnly,
        running_names,
        move |current| {
            *current = desired;
            Ok(())
        },
    )?;
    Ok(())
}

fn reusable_empty_profile(profiles_dir: &Path, index: &LibraryIndex) -> Option<String> {
    if index.profiles.len() != 1 {
        return None;
    }
    let id = index.profiles[0].id.clone();
    let manifest = load_manifest(profiles_dir, &id).ok()?;
    manifest.files.is_empty().then_some(id)
}

pub(crate) fn set_manifest_launch_options(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    launch_options: String,
    running_names: &[String],
) -> Result<(), ProfileError> {
    mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[],
        &[],
        ProfileLiveProjection::LibraryOnly,
        running_names,
        move |manifest| {
            manifest.launch_options = launch_options;
            manifest.launch_sync_pending = true;
            Ok(())
        },
    )?;
    Ok(())
}

/// Record that Steam's `localconfig.vdf` must receive the profile's current
/// launch options. This durable marker is written before a newly active
/// profile is published, so a crash cannot silently lose the external sync.
pub(crate) fn mark_launch_sync_pending(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running_names: &[String],
) -> Result<(), ProfileError> {
    mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[],
        &[],
        ProfileLiveProjection::LibraryOnly,
        running_names,
        |manifest| {
            manifest.launch_sync_pending = true;
            Ok(())
        },
    )?;
    Ok(())
}

/// Clear a pending launch projection only when Steam was written with the
/// manifest value the caller observed. A newer edit therefore cannot be
/// acknowledged accidentally by an older, slower sync attempt.
pub(crate) fn clear_launch_sync_pending_if_matches(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    expected_launch_options: &str,
    running_names: &[String],
) -> Result<bool, ProfileError> {
    let expected = expected_launch_options.to_string();
    let manifest = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[],
        &[],
        ProfileLiveProjection::LibraryOnly,
        running_names,
        move |manifest| {
            if manifest.launch_options == expected {
                manifest.launch_sync_pending = false;
            }
            Ok(())
        },
    )?;
    Ok(manifest.launch_options == expected_launch_options && !manifest.launch_sync_pending)
}

fn refuse_writes<I, S>(running_names: I) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_if_running_among(running_names).map_err(Into::into)
}

fn source_file_len(path: &Path) -> Result<u64, ProfileError> {
    let file = fs::File::open(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let metadata = file
        .metadata()
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    if !metadata.is_file() {
        return Err(ProfileError::Io(format!(
            "Profile source is not a regular file: {}",
            path.display()
        )));
    }
    Ok(metadata.len())
}

fn init_unlocked(profiles_dir: &Path, tf2_root: &Path) -> Result<LibraryIndex, ProfileError> {
    fs::create_dir_all(profiles_dir).map_err(|e| ProfileError::Io(e.to_string()))?;
    match load_index(profiles_dir)? {
        Some(index) if roots_match(&index.tf2_root, tf2_root) => Ok(index),
        Some(index) => Err(ProfileError::RootMismatch {
            library_root: index.tf2_root,
            confirmed_root: user_path_string(tf2_root),
        }),
        None => {
            let index = LibraryIndex {
                schema: LIBRARY_SCHEMA,
                tf2_root: user_path_string(tf2_root),
                active_profile_id: None,
                interrupted_profile_id: None,
                pending_switch: None,
                profiles: Vec::new(),
            };
            write_json_within(profiles_dir, &index_file(profiles_dir), &index)?;
            Ok(index)
        }
    }
}

fn usable_index(profiles_dir: &Path, tf2_root: &Path) -> Result<LibraryIndex, ProfileError> {
    match load_index(profiles_dir)? {
        None => Err(ProfileError::NotInitialized),
        Some(index) if roots_match(&index.tf2_root, tf2_root) => Ok(index),
        Some(index) => Err(ProfileError::RootMismatch {
            library_root: index.tf2_root,
            confirmed_root: user_path_string(tf2_root),
        }),
    }
}

fn load_index(profiles_dir: &Path) -> Result<Option<LibraryIndex>, ProfileError> {
    let file = index_file(profiles_dir);
    match fs::symlink_metadata(&file) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(ProfileError::Io(err.to_string())),
        Ok(meta) if crate::hash::metadata_is_link(&meta) || !meta.is_file() => {
            return Err(ProfileError::Io(
                "Refusing a linked or invalid profile-library index.".into(),
            ))
        }
        Ok(_) => {}
    }
    validate_file_within(profiles_dir, &file).map_err(|err| ProfileError::Io(err.to_string()))?;
    let text = read_small_text_bounded(&file, MAX_LIBRARY_INDEX_BYTES)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    let mut index: LibraryIndex =
        serde_json::from_str(&text).map_err(|e| ProfileError::Io(e.to_string()))?;
    if index.schema != LIBRARY_SCHEMA {
        return Err(ProfileError::Io("unsupported library schema".into()));
    }
    let mut profile_ids = HashSet::new();
    if index
        .profiles
        .iter()
        .any(|profile| !valid_profile_id(&profile.id) || !profile_ids.insert(profile.id.as_str()))
    {
        return Err(ProfileError::Io(
            "profile library contains an invalid or duplicate profile id".into(),
        ));
    }
    if index
        .active_profile_id
        .as_deref()
        .is_some_and(|id| !profile_ids.contains(id))
        || index
            .pending_switch
            .as_ref()
            .is_some_and(|pending| !profile_ids.contains(pending.target_profile_id.as_str()))
    {
        return Err(ProfileError::Io(
            "profile library points at an unknown profile id".into(),
        ));
    }
    index.tf2_root = user_path_string(Path::new(&index.tf2_root));
    Ok(Some(index))
}

fn library_from_index(
    index: LibraryIndex,
    confirmed_root: Option<&Path>,
    confirmed: Option<String>,
) -> ProfileLibrary {
    let matches = confirmed_root.is_some_and(|root| roots_match(&index.tf2_root, root));
    if matches {
        let pending_switch_profile_id = index
            .pending_switch
            .as_ref()
            .map(|pending| pending.target_profile_id.clone());
        ProfileLibrary {
            initialized: true,
            usable: true,
            root_mismatch: false,
            tf2_root: Some(index.tf2_root),
            confirmed_root: confirmed,
            active_profile_id: index.active_profile_id,
            interrupted_profile_id: index.interrupted_profile_id,
            pending_switch_profile_id,
            profiles: index.profiles,
        }
    } else {
        ProfileLibrary {
            initialized: true,
            usable: false,
            root_mismatch: confirmed_root.is_some(),
            tf2_root: Some(index.tf2_root),
            confirmed_root: confirmed,
            active_profile_id: None,
            interrupted_profile_id: None,
            pending_switch_profile_id: None,
            profiles: Vec::new(),
        }
    }
}

fn empty_library(initialized: bool, usable: bool, confirmed: Option<String>) -> ProfileLibrary {
    ProfileLibrary {
        initialized,
        usable,
        root_mismatch: false,
        tf2_root: None,
        confirmed_root: confirmed,
        active_profile_id: None,
        interrupted_profile_id: None,
        pending_switch_profile_id: None,
        profiles: Vec::new(),
    }
}

fn roots_match(stored: &str, confirmed: &Path) -> bool {
    let stored_path = Path::new(stored);
    if stored_path == confirmed {
        return true;
    }
    match (stored_path.canonicalize(), confirmed.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => stored_path.to_string_lossy() == confirmed.to_string_lossy(),
    }
}

/// The one gate on what may enter a profile manifest. This is the allowlist
/// (`tf/cfg/`, `tf/custom/`, never `tf/cfg/user/`), never a denylist — anything
/// that reaches a manifest is something a later switch will happily copy into
/// the live game folder.
fn checked_rel_path(path: &str) -> Result<String, ProfileError> {
    let path = normalize_rel_path(path)?;
    if !is_profile_ownable_rel_path(&path) {
        return Err(ProfileError::ForbiddenPath(path));
    }
    Ok(path)
}

fn normalize_name(name: &str) -> Result<String, ProfileError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(ProfileError::InvalidName);
    }
    Ok(name.to_string())
}

fn touch_profile(index: &mut LibraryIndex, profile_id: &str) {
    let now = utc_rfc3339();
    if let Some(profile) = index
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
    {
        profile.updated_at = now;
    }
}

fn referenced_shared_hashes(
    profiles_dir: &Path,
    index: &LibraryIndex,
) -> Result<HashSet<String>, ProfileError> {
    let mut hashes = HashSet::new();
    for profile in &index.profiles {
        // A manifest that cannot be read right now (antivirus lock, transient
        // I/O error) still references its blobs. Skipping it would let the
        // GC below delete a base VPK that profile needs, so the error aborts
        // the GC instead — the blobs stay until the next successful pass.
        let manifest = load_manifest(profiles_dir, &profile.id)?;
        for file in manifest.files {
            if file.storage == FileStorage::Shared {
                hashes.insert(file.sha256);
            }
        }
    }
    Ok(hashes)
}

/// Atomic: `<file>.execs-part`, fsync, rename. A truncated `index.json` makes
/// the whole profile library unloadable, so this must never be a bare
/// `fs::write`.
#[cfg(test)]
fn write_json(path: &Path, value: &impl Serialize) -> Result<(), ProfileError> {
    let json = serde_json::to_string_pretty(value).map_err(|e| ProfileError::Io(e.to_string()))?;
    crate::hash::write_atomic(path, format!("{json}\n").as_bytes())
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    #[cfg(test)]
    write_counts::record(path);
    Ok(())
}

fn write_json_within(root: &Path, path: &Path, value: &impl Serialize) -> Result<(), ProfileError> {
    let json = serde_json::to_string_pretty(value).map_err(|e| ProfileError::Io(e.to_string()))?;
    let limit = match path.file_name().and_then(|name| name.to_str()) {
        Some("index.json") => MAX_LIBRARY_INDEX_BYTES,
        Some("manifest.json") => MAX_PROFILE_MANIFEST_BYTES,
        Some(MUTATION_JOURNAL_NAME) => MAX_MUTATION_JOURNAL_BYTES,
        Some(CREATE_MARKER_NAME) => MAX_CREATE_MARKER_BYTES,
        _ => {
            return Err(ProfileError::Io(format!(
                "Refusing to write unclassified profile metadata: {}",
                path.display()
            )))
        }
    };
    if json.len().saturating_add(1) > limit {
        return Err(ProfileError::Io(format!(
            "Profile metadata exceeds its {limit} byte safety limit: {}",
            path.display()
        )));
    }
    write_atomic_within(root, path, format!("{json}\n").as_bytes())
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    #[cfg(test)]
    write_counts::record(path);
    Ok(())
}

/// Per-path write counter so a test can assert a batch write is O(1), not O(n).
/// Keyed by path so it stays correct with tests running in parallel.
#[cfg(test)]
pub(crate) mod write_counts {
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};

    fn counts() -> &'static Mutex<HashMap<PathBuf, usize>> {
        static COUNTS: OnceLock<Mutex<HashMap<PathBuf, usize>>> = OnceLock::new();
        COUNTS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub(crate) fn record(path: &Path) {
        if let Ok(mut map) = counts().lock() {
            *map.entry(path.to_path_buf()).or_insert(0) += 1;
        }
    }

    pub(crate) fn count(path: &Path) -> usize {
        counts()
            .lock()
            .ok()
            .and_then(|map| map.get(path).copied())
            .unwrap_or(0)
    }
}

pub(crate) fn utc_rfc3339() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let (year, month, day, hour, minute, second) = unix_to_ymd_hms(secs);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn unix_to_ymd_hms(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (year, month, day) = civil_from_unix_days(days);
    (
        year,
        month,
        day,
        (rem / 3600) as u32,
        ((rem % 3600) / 60) as u32,
        (rem % 60) as u32,
    )
}

/// Howard Hinnant civil-from-days, days since 1970-01-01.
fn civil_from_unix_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = (z.rem_euclid(146097)) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob::blob_path;
    use std::fs;

    fn unlocked() -> [&'static str; 1] {
        ["bash"]
    }

    fn tf2_name() -> &'static str {
        if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        }
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/j"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "could not create test junction");
    }

    #[cfg(unix)]
    fn unlink_dir(link: &Path) {
        fs::remove_file(link).unwrap();
    }

    #[cfg(windows)]
    fn unlink_dir(link: &Path) {
        fs::remove_dir(link).unwrap();
    }

    #[test]
    fn normalize_rejects_drive_letters_ads_and_device_names() {
        // `PathBuf::push("C:")` would replace the accumulated path on Windows.
        assert_eq!(
            normalize_rel_path("C:/Windows/System32/x"),
            Err(ProfileError::InvalidPath)
        );
        assert_eq!(
            normalize_rel_path("tf/cfg/c:/autoexec.cfg"),
            Err(ProfileError::InvalidPath)
        );
        // NTFS alternate data stream.
        assert_eq!(
            normalize_rel_path("tf/cfg/a:b.cfg"),
            Err(ProfileError::InvalidPath)
        );
        for reserved in [
            "tf/cfg/CON",
            "tf/cfg/nul.cfg",
            "tf/cfg/Com1.cfg",
            "tf/custom/lpt9/info.vdf",
            "tf/cfg/aux",
            "tf/cfg/PRN.txt",
            "tf/cfg/CONIN$",
            "tf/cfg/COM¹.cfg",
            "tf/custom/LPT²/info.vdf",
        ] {
            assert_eq!(
                normalize_rel_path(reserved),
                Err(ProfileError::InvalidPath),
                "{reserved} should be refused"
            );
        }
        for malformed in [
            "/tf/cfg/autoexec.cfg",
            r"\tf\cfg\autoexec.cfg",
            "tf//cfg/autoexec.cfg",
            "tf/cfg/autoexec.cfg/",
            "tf/cfg/autoexec.cfg.",
            "tf/cfg/autoexec.cfg ",
            "tf/cfg/bad<name.cfg",
            "tf/cfg/bad>name.cfg",
            "tf/cfg/bad\"name.cfg",
            "tf/cfg/bad|name.cfg",
            "tf/cfg/bad?name.cfg",
            "tf/cfg/bad*name.cfg",
            "tf/cfg/bad\u{1f}name.cfg",
            "tf/cfg/LONGFI~1.CFG",
            "tf/custom/USERNA~1/info.vdf",
            "tf/custom/pack/ABCDEF~12.vpk",
        ] {
            assert_eq!(
                normalize_rel_path(malformed),
                Err(ProfileError::InvalidPath),
                "{malformed} should be refused"
            );
        }
        // Ordinary names that merely start with those letters stay legal.
        for ok in [
            "tf/cfg/console.cfg",
            "tf/cfg/comfig.cfg",
            "tf/custom/aux2/info.vdf",
            "tf/cfg/com0.cfg",
        ] {
            assert!(normalize_rel_path(ok).is_ok(), "{ok} should be allowed");
        }

        let depth_limit = std::iter::repeat_n("a", MAX_PROFILE_PATH_DEPTH)
            .collect::<Vec<_>>()
            .join("/");
        assert!(normalize_rel_path(&depth_limit).is_ok());
        assert_eq!(
            normalize_rel_path(&format!("{depth_limit}/a")),
            Err(ProfileError::InvalidPath)
        );
        assert!(normalize_rel_path(&"a".repeat(MAX_PROFILE_COMPONENT_BYTES)).is_ok());
        assert_eq!(
            normalize_rel_path(&"a".repeat(MAX_PROFILE_COMPONENT_BYTES + 1)),
            Err(ProfileError::InvalidPath)
        );

        let mut components = vec!["a".repeat(63); MAX_PROFILE_PATH_DEPTH];
        components[0].push('a');
        let exact_path_limit = components.join("/");
        assert_eq!(exact_path_limit.len(), MAX_PROFILE_REL_PATH_BYTES);
        assert!(normalize_rel_path(&exact_path_limit).is_ok());
        assert_eq!(
            normalize_rel_path(&format!("{exact_path_limit}a")),
            Err(ProfileError::InvalidPath)
        );
    }

    #[test]
    fn strict_profile_ownership_rejects_global_stock_and_junk_aliases() {
        assert!(is_profile_ownable_rel_path("TF/CFG/config.cfg"));
        assert!(is_profile_ownable_rel_path(
            "TF/CUSTOM/MyPack/materials/a.vmt"
        ));
        for refused in [
            "tf/cfg/config_default.cfg",
            "tf/cfg/overrides/valve.rc",
            "tf/custom/readme.txt",
            "tf/custom/workshop/440/item.vpk",
            "tf/custom/execs-preloader.vpk",
            "tf/custom/pack/sound.cache",
            "tf/custom/pack/file.execs-part",
            "tf/custom/pack/desktop.ini",
        ] {
            assert!(
                !is_profile_ownable_rel_path(refused),
                "{refused} must not become profile-owned"
            );
        }
        assert_eq!(
            portable_path_key("TF\\CUSTOM\\RaysHUD\\Info.vdf").unwrap(),
            portable_path_key("tf/custom/rayshud/info.vdf").unwrap()
        );
    }

    #[test]
    fn legacy_launch_sync_state_is_pending_and_false_is_persisted() {
        let legacy = serde_json::json!({
            "schema": LIBRARY_SCHEMA,
            "id": "11111111-1111-4111-8111-111111111111",
            "name": "Legacy",
            "tf2Root": "C:/Games/TF2",
            "launchOptions": "-novid",
            "files": []
        });
        let mut manifest: ProfileManifest = serde_json::from_value(legacy).unwrap();
        assert!(manifest.launch_sync_pending);

        manifest.launch_sync_pending = false;
        let persisted = serde_json::to_value(&manifest).unwrap();
        assert_eq!(
            persisted["launchSyncPending"],
            serde_json::Value::Bool(false)
        );
        assert!(
            !serde_json::from_value::<ProfileManifest>(persisted)
                .unwrap()
                .launch_sync_pending
        );
    }

    #[test]
    fn live_rename_descendants_use_portable_case_and_component_boundaries() {
        assert!(path_is_below(
            "tf/custom/rayshud/resource/ui/hudlayout.res",
            "tf/custom/RaysHUD"
        ));
        assert!(!path_is_below(
            "tf/custom/rayshud-extra/info.vdf",
            "tf/custom/RaysHUD"
        ));
    }

    #[test]
    fn file_safe_predicate_is_the_only_allowlist() {
        assert!(is_file_safe_rel_path("tf/cfg/overrides/autoexec.cfg"));
        assert!(is_file_safe_rel_path("tf/cfg/config.cfg"));
        assert!(is_file_safe_rel_path("tf/custom/hud/info.vdf"));
        assert!(is_file_safe_rel_path("tf/custom/tf2_stuff.vpk"));
        assert!(!is_file_safe_rel_path("tf/cfg/user/autoexec.cfg"));
        assert!(!is_file_safe_rel_path("tf/steam.inf"));
        assert!(!is_file_safe_rel_path("tf/gameinfo.txt"));
        assert!(!is_file_safe_rel_path("tf/tf2_misc_dir.vpk"));
        assert!(!is_file_safe_rel_path("bin/x64/client.dll"));
        assert!(!is_file_safe_rel_path("../tf/cfg/autoexec.cfg"));
        assert!(!is_file_safe_rel_path("C:/Windows/System32/x"));
        assert!(!is_file_safe_rel_path("tf/cfg/nul.cfg"));
    }

    #[test]
    fn profiles_dir_sits_next_to_settings() {
        let dir = profiles_dir();
        assert!(dir.ends_with(Path::new("execs").join("profiles")));
    }

    #[test]
    fn load_missing_library_does_not_write() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        assert!(!library.initialized);
        assert!(library.usable);
        assert!(library.profiles.is_empty());
        assert!(!profiles.exists());
        cleanup(&dir);
    }

    #[test]
    fn profile_json_reads_refuse_oversized_sparse_files() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        fs::OpenOptions::new()
            .write(true)
            .open(manifest_file(&profiles, &id))
            .unwrap()
            .set_len(MAX_PROFILE_MANIFEST_BYTES as u64 + 1)
            .unwrap();

        assert!(matches!(
            load_manifest(&profiles, &id),
            Err(ProfileError::Io(_))
        ));
        cleanup(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn legacy_verbatim_roots_are_clean_on_read_and_next_authorized_write() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let created = create_profile_record_to(&profiles, &root, "Main", unlocked()).unwrap();
        let id = created.profiles[0].id.clone();
        let legacy = format!(r"\\?\{}", root.display());

        let mut index: LibraryIndex =
            serde_json::from_str(&fs::read_to_string(index_file(&profiles)).unwrap()).unwrap();
        index.tf2_root = legacy.clone();
        write_json(&index_file(&profiles), &index).unwrap();
        let mut manifest: ProfileManifest =
            serde_json::from_str(&fs::read_to_string(manifest_file(&profiles, &id)).unwrap())
                .unwrap();
        manifest.tf2_root = legacy;
        write_json(&manifest_file(&profiles, &id), &manifest).unwrap();

        let index_before = fs::read(index_file(&profiles)).unwrap();
        let manifest_before = fs::read(manifest_file(&profiles, &id)).unwrap();
        let loaded = load_library_from(&profiles, Some(&root)).unwrap();
        assert!(loaded.usable);
        assert!(!loaded.root_mismatch);
        assert_eq!(
            loaded.tf2_root.as_deref(),
            Some(root.to_string_lossy().as_ref())
        );
        assert_eq!(fs::read(index_file(&profiles)).unwrap(), index_before);

        let loaded_manifest = load_manifest(&profiles, &id).unwrap();
        assert_eq!(loaded_manifest.tf2_root, root.to_string_lossy());
        assert_eq!(
            fs::read(manifest_file(&profiles, &id)).unwrap(),
            manifest_before
        );

        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        let persisted: LibraryIndex =
            serde_json::from_str(&fs::read_to_string(index_file(&profiles)).unwrap()).unwrap();
        assert_eq!(persisted.tf2_root, root.to_string_lossy());
        cleanup(&dir);
    }

    #[test]
    fn init_and_create_record() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let live_custom = root.join("tf").join("custom");
        fs::create_dir_all(&live_custom).unwrap();

        let library = init_library_to(&profiles, &root, unlocked()).unwrap();
        assert!(library.initialized);
        assert!(library.usable);
        assert_eq!(library.profiles.len(), 0);
        assert!(index_file(&profiles).is_file());

        let library = create_profile_record_to(&profiles, &root, "  Main  ", unlocked()).unwrap();
        assert_eq!(library.profiles.len(), 1);
        assert_eq!(library.profiles[0].name, "Main");
        let id = &library.profiles[0].id;
        assert!(manifest_file(&profiles, id).is_file());
        assert!(exclusive_files_dir(&profiles, id).is_dir());
        assert!(live_custom.read_dir().unwrap().next().is_none());

        let parsed: LibraryIndex =
            serde_json::from_str(&fs::read_to_string(index_file(&profiles)).unwrap()).unwrap();
        assert_eq!(parsed.schema, 1);
        assert!(parsed.tf2_root.contains("Team Fortress 2"));
        assert!(parsed.active_profile_id.is_none());
        cleanup(&dir);
    }

    #[test]
    fn populated_creation_never_exposes_a_profile_when_index_publication_fails() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();
        fs::create_dir_all(crate::hash::part_path(&index_file(&profiles))).unwrap();

        let err = create_populated_profile_to(
            &profiles,
            &root,
            "Complete only",
            &[(
                "tf/custom/pack/file.txt".into(),
                FileSource::Bytes(b"complete payload"),
            )],
            true,
            unlocked(),
            |manifest| {
                manifest.launch_options = "-novid".into();
                Ok(())
            },
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::Io(_)));
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .is_empty());
        assert!(!fs::read_dir(&profiles)
            .unwrap()
            .flatten()
            .any(|entry| { entry.file_name().to_str().is_some_and(valid_profile_id) }));
        cleanup(&dir);
    }

    #[test]
    fn populated_creation_reconciles_an_index_rename_with_failed_parent_sync() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();
        let fault_path = index_file(&profiles);
        let library = crate::hash::with_sync_parent_fault(
            move |path| path == fault_path,
            || {
                create_populated_profile_to(
                    &profiles,
                    &root,
                    "Complete",
                    &[(
                        "tf/custom/pack/file.txt".into(),
                        FileSource::Bytes(b"complete payload"),
                    )],
                    true,
                    unlocked(),
                    |_| Ok(()),
                )
            },
        )
        .unwrap();

        let id = library.active_profile_id.as_deref().unwrap();
        assert_eq!(library.profiles.len(), 1);
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                id,
                "tf/custom/pack/file.txt"
            ))
            .unwrap(),
            b"complete payload"
        );
        assert!(!create_marker_file(&profile_dir(&profiles, id)).exists());
        cleanup(&dir);
    }

    #[test]
    fn profile_uuid_link_cannot_redirect_load_or_mutation_outside_the_library() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        let original = profile_dir(&profiles, &id);
        fs::remove_dir_all(&original).unwrap();
        let outside = dir.join("outside-profile");
        fs::create_dir_all(&outside).unwrap();
        let victim = outside.join("victim.txt");
        fs::write(&victim, b"keep me").unwrap();
        link_dir(&outside, &original);

        assert!(matches!(
            load_manifest(&profiles, &id),
            Err(ProfileError::Io(_))
        ));
        assert!(put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/custom/pack/new.txt",
            b"outside write",
            unlocked(),
        )
        .is_err());
        assert_eq!(fs::read(&victim).unwrap(), b"keep me");
        assert!(!outside.join("files/tf/custom/pack/new.txt").exists());

        unlink_dir(&original);
        cleanup(&dir);
    }

    #[test]
    fn exclusive_and_shared_storage() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let live_custom = root.join("tf").join("custom");
        fs::create_dir_all(&live_custom).unwrap();

        create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        create_profile_record_to(&profiles, &root, "B", unlocked()).unwrap();
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        let a = &library.profiles[0].id;
        let b = &library.profiles[1].id;

        let cfg_hash = put_exclusive_file_to(
            &profiles,
            &root,
            a,
            "tf/cfg/overrides/autoexec.cfg",
            b"fov_desired 90\n",
            unlocked(),
        )
        .unwrap();
        assert_eq!(cfg_hash, sha256_hex(b"fov_desired 90\n"));
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                a,
                "tf/cfg/overrides/autoexec.cfg"
            ))
            .unwrap(),
            b"fov_desired 90\n"
        );

        let vpk = b"vpk-bytes";
        let shared_a = put_shared_blob_to(
            &profiles,
            &root,
            a,
            "tf/custom/mastercomfig-base.vpk",
            vpk,
            unlocked(),
        )
        .unwrap();
        let shared_b = put_shared_blob_to(
            &profiles,
            &root,
            b,
            r"tf\custom\Mastercomfig-Base.vpk",
            vpk,
            unlocked(),
        )
        .unwrap();
        assert_eq!(shared_a, shared_b);
        assert!(blob_path(&profiles, &shared_a).is_file());
        assert!(!exclusive_file_path(&profiles, a, "tf/custom/mastercomfig-base.vpk").exists());

        let err = put_exclusive_file_to(
            &profiles,
            &root,
            a,
            "tf/custom/mastercomfig-base.vpk",
            vpk,
            unlocked(),
        )
        .unwrap_err();
        assert_eq!(err.code(), "MustBeShared");
        let err = put_shared_blob_to(
            &profiles,
            &root,
            a,
            "tf/cfg/config.cfg",
            b"unbindall\n",
            unlocked(),
        )
        .unwrap_err();
        assert_eq!(err.code(), "NotShareable");

        remove_profile_record_to(&profiles, &root, a, unlocked()).unwrap();
        assert!(blob_path(&profiles, &shared_a).is_file());
        remove_profile_record_to(&profiles, &root, b, unlocked()).unwrap();
        assert!(!blob_path(&profiles, &shared_a).is_file());
        assert!(live_custom.read_dir().unwrap().next().is_none());
        cleanup(&dir);
    }

    #[test]
    fn payload_update_rolls_back_when_the_index_commit_fails() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        let rel = "tf/custom/pack/file.txt";
        let old_hash =
            put_exclusive_file_to(&profiles, &root, &id, rel, b"old bytes", unlocked()).unwrap();

        // `prepare_part` refuses a directory. This fault occurs after the old
        // payload was backed up, the replacement published, and manifest.json
        // written, but before index.json can commit.
        fs::create_dir_all(crate::hash::part_path(&index_file(&profiles))).unwrap();
        let err = put_exclusive_file_to(&profiles, &root, &id, rel, b"replacement", unlocked())
            .unwrap_err();
        assert!(matches!(err, ProfileError::Io(_)));
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &id, rel)).unwrap(),
            b"old bytes"
        );
        assert_eq!(
            load_manifest(&profiles, &id).unwrap().files[0].sha256,
            old_hash
        );
        assert!(!mutation_journal_file(&profiles, &id).exists());
        cleanup(&dir);
    }

    #[test]
    fn published_commit_marker_with_sync_error_reports_committed_success() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        let rel = "tf/custom/pack/file.txt";
        put_exclusive_file_to(&profiles, &root, &id, rel, b"old", unlocked()).unwrap();
        let journal = mutation_journal_file(&profiles, &id);
        let injected = std::rc::Rc::new(std::cell::Cell::new(false));
        let faulted = injected.clone();
        let fault_journal = journal.clone();

        let hash = crate::hash::with_sync_parent_fault(
            move |path| {
                if path != fault_journal || faulted.get() {
                    return false;
                }
                let committed = fs::read_to_string(path)
                    .ok()
                    .is_some_and(|json| json.contains("\"committed\": true"));
                if committed {
                    faulted.set(true);
                }
                committed
            },
            || put_exclusive_file_to(&profiles, &root, &id, rel, b"new", unlocked()),
        )
        .unwrap();

        assert!(injected.get());
        assert_eq!(hash, sha256_hex(b"new"));
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &id, rel)).unwrap(),
            b"new"
        );
        assert_eq!(load_manifest(&profiles, &id).unwrap().files[0].sha256, hash);
        assert!(!journal.exists());
        cleanup(&dir);
    }

    #[test]
    fn combined_domain_transaction_rolls_back_files_metadata_and_live_projection() {
        for fail_manifest_commit in [true, false] {
            let dir = crate::test_temp_dir();
            let profiles = dir.join("execs").join("profiles");
            let root = dir.join("Team Fortress 2");
            write_live(&root.join("tf/steam.inf"), "appID=440\n");
            fs::create_dir_all(root.join("tf/custom/domain")).unwrap();
            let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
            let id = library.profiles[0].id.clone();
            set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();

            let initial_puts = [
                (
                    "tf/custom/domain/keep.txt".into(),
                    FileSource::Bytes(b"old keep"),
                ),
                (
                    "tf/custom/domain/remove.txt".into(),
                    FileSource::Bytes(b"old remove"),
                ),
            ];
            let old_hud = HudRecord {
                id: "old-hud".into(),
                hash: Some("old-record".into()),
                source: HudSource::Local,
                options: BTreeMap::new(),
            };
            mutate_profile_files_to(
                &profiles,
                &root,
                &id,
                &initial_puts,
                &[],
                ProfileLiveProjection::MirrorIfActive,
                unlocked(),
                |manifest| {
                    manifest.hud = Some(old_hud.clone());
                    Ok(())
                },
            )
            .unwrap();

            let blocker = if fail_manifest_commit {
                crate::hash::part_path(&manifest_file(&profiles, &id))
            } else {
                crate::hash::part_path(&index_file(&profiles))
            };
            fs::create_dir_all(&blocker).unwrap();
            let replacement = [
                (
                    "tf/custom/domain/keep.txt".into(),
                    FileSource::Bytes(b"new keep"),
                ),
                (
                    "tf/custom/domain/add.txt".into(),
                    FileSource::Bytes(b"new add"),
                ),
            ];
            let err = mutate_profile_files_to(
                &profiles,
                &root,
                &id,
                &replacement,
                &["tf/custom/domain/remove.txt".into()],
                ProfileLiveProjection::MirrorIfActive,
                unlocked(),
                |manifest| {
                    manifest.hud = Some(HudRecord {
                        id: "new-hud".into(),
                        hash: Some("new-record".into()),
                        source: HudSource::HudDb,
                        options: BTreeMap::new(),
                    });
                    Ok(())
                },
            )
            .unwrap_err();
            assert!(matches!(err, ProfileError::Io(_)));

            let manifest = load_manifest(&profiles, &id).unwrap();
            assert_eq!(manifest.hud, Some(old_hud));
            let paths: BTreeSet<&str> = manifest
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect();
            assert_eq!(
                paths,
                BTreeSet::from(["tf/custom/domain/keep.txt", "tf/custom/domain/remove.txt"])
            );
            assert_eq!(
                fs::read(root.join("tf/custom/domain/keep.txt")).unwrap(),
                b"old keep"
            );
            assert_eq!(
                fs::read(root.join("tf/custom/domain/remove.txt")).unwrap(),
                b"old remove"
            );
            assert!(!root.join("tf/custom/domain/add.txt").exists());
            assert_eq!(
                fs::read(exclusive_file_path(
                    &profiles,
                    &id,
                    "tf/custom/domain/keep.txt"
                ))
                .unwrap(),
                b"old keep"
            );
            assert!(!mutation_journal_file(&profiles, &id).exists());
            cleanup(&dir);
        }
    }

    #[test]
    fn mutation_resamples_process_lock_immediately_before_live_commit() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/steam.inf"), "appID=440\n");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        let rel = "tf/custom/race/file.txt";
        mutate_profile_files_to(
            &profiles,
            &root,
            &id,
            &[(rel.into(), FileSource::Bytes(b"old"))],
            &[],
            ProfileLiveProjection::MirrorIfActive,
            unlocked(),
            |_| Ok(()),
        )
        .unwrap();

        let old_manifest = load_manifest(&profiles, &id).unwrap();
        let old_index = load_index(&profiles).unwrap().unwrap();
        let profile_payload = exclusive_file_path(&profiles, &id, rel);
        let live_payload = profile_live_path(&root, rel);
        let journal = mutation_journal_file(&profiles, &id);
        let fired = std::rc::Rc::new(std::cell::Cell::new(false));
        let sampler_fired = fired.clone();
        let sampled_profile = profile_payload.clone();
        let sampled_live = live_payload.clone();
        let sampled_journal = journal.clone();

        let result = with_profile_process_sampler(
            move || {
                let at_live_boundary = sampled_journal.is_file()
                    && fs::read(&sampled_profile).ok().as_deref() == Some(b"new")
                    && fs::read(&sampled_live).ok().as_deref() == Some(b"old");
                if at_live_boundary && !sampler_fired.replace(true) {
                    vec![tf2_name().to_string()]
                } else {
                    Vec::new()
                }
            },
            || {
                mutate_profile_files_to(
                    &profiles,
                    &root,
                    &id,
                    &[(rel.into(), FileSource::Bytes(b"new"))],
                    &[],
                    ProfileLiveProjection::MirrorIfActive,
                    unlocked(),
                    |_| Ok(()),
                )
            },
        );

        assert_eq!(result.unwrap_err(), ProfileError::GameRunning);
        assert!(fired.get(), "the post-staging live boundary was sampled");
        assert_eq!(fs::read(profile_payload).unwrap(), b"old");
        assert_eq!(fs::read(live_payload).unwrap(), b"old");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), old_manifest);
        assert_eq!(load_index(&profiles).unwrap().unwrap(), old_index);
        assert!(!journal.exists());
        cleanup(&dir);
    }

    #[test]
    fn live_pack_rename_reprojects_unchanged_descendants_with_one_case() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        mutate_profile_files_to(
            &profiles,
            &root,
            &id,
            &[
                (
                    "tf/custom/RaysHUD/info.vdf".into(),
                    FileSource::Bytes(b"old info"),
                ),
                (
                    "tf/custom/RaysHUD/resource/colors.res".into(),
                    FileSource::Bytes(b"unchanged colors"),
                ),
            ],
            &[],
            ProfileLiveProjection::MirrorIfActive,
            unlocked(),
            |_| Ok(()),
        )
        .unwrap();

        mutate_profile_files_with_live_renames_to(
            &profiles,
            &root,
            &id,
            &[
                (
                    "tf/custom/rayshud/info.vdf".into(),
                    FileSource::Bytes(b"new info"),
                ),
                (
                    "tf/custom/rayshud/resource/colors.res".into(),
                    FileSource::Bytes(b"unchanged colors"),
                ),
            ],
            &[],
            &[ProfileLiveRename {
                from: "tf/custom/RaysHUD".into(),
                to: "tf/custom/-RaysHUD".into(),
            }],
            unlocked(),
            |_| Ok(()),
        )
        .unwrap();

        assert_eq!(
            fs::read(root.join("tf/custom/rayshud/info.vdf")).unwrap(),
            b"new info"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/rayshud/resource/colors.res")).unwrap(),
            b"unchanged colors"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/-RaysHUD/info.vdf")).unwrap(),
            b"old info"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/-RaysHUD/resource/colors.res")).unwrap(),
            b"unchanged colors"
        );
        #[cfg(not(windows))]
        assert!(!root.join("tf/custom/RaysHUD").exists());
        cleanup(&dir);
    }

    #[test]
    fn interrupted_payload_transaction_recovers_on_the_next_writer() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        let rel = "tf/custom/pack/file.txt";
        put_exclusive_file_to(&profiles, &root, &id, rel, b"old", unlocked()).unwrap();
        let old_manifest = load_manifest(&profiles, &id).unwrap();
        let mut new_manifest = old_manifest.clone();
        new_manifest.files[0].sha256 = sha256_hex(b"new");
        let transaction_id = "0123456789abcdef0123456789abcdef";
        let profile_root = profile_dir(&profiles, &id);
        let dest = exclusive_file_path(&profiles, &id, rel);
        let staged = mutation_file_path(&profiles, &id, transaction_id, "new", rel);
        write_atomic_within(&profile_root, &staged, b"new").unwrap();
        let journal = ProfileMutationJournal {
            transaction_id: transaction_id.into(),
            profile_id: id.clone(),
            old_manifest: old_manifest.clone(),
            new_manifest,
            file_changes: Vec::new(),
            live_changes: Vec::new(),
            live_renames: Vec::new(),
            old_index: None,
            new_index: None,
            touched_paths: vec![rel.into()],
            committed: false,
        };
        write_json(&mutation_journal_file(&profiles, &id), &journal).unwrap();
        let backup = mutation_file_path(&profiles, &id, transaction_id, "old", rel);
        move_file_within(&profile_root, &dest, &backup).unwrap();
        move_file_within(&profile_root, &staged, &dest).unwrap();

        assert!(load_manifest(&profiles, &id).is_err());
        recover_profile_mutation_to(&profiles, &root, &id).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"old");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), old_manifest);
        assert!(!mutation_journal_file(&profiles, &id).exists());
        cleanup(&dir);
    }

    #[test]
    fn recovering_one_profile_never_restores_a_stale_full_library_index() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        create_profile_record_to(&profiles, &root, "B", unlocked()).unwrap();
        let library = load_library_from(&profiles, Some(&root)).unwrap();
        let a = library.profiles[0].id.clone();
        let b = library.profiles[1].id.clone();
        let old_manifest = load_manifest(&profiles, &a).unwrap();
        let mut new_manifest = old_manifest.clone();
        new_manifest.hud = Some(HudRecord {
            id: "interrupted".into(),
            hash: None,
            source: HudSource::Local,
            options: BTreeMap::new(),
        });
        let old_index = load_index(&profiles).unwrap().unwrap();
        let mut new_index = old_index.clone();
        touch_profile(&mut new_index, &a);
        let journal = ProfileMutationJournal {
            transaction_id: "0123456789abcdef0123456789abcdef".into(),
            profile_id: a.clone(),
            old_manifest,
            new_manifest,
            file_changes: Vec::new(),
            live_changes: Vec::new(),
            live_renames: Vec::new(),
            old_index: Some(old_index),
            new_index: Some(new_index),
            touched_paths: Vec::new(),
            committed: false,
        };
        write_json(&mutation_journal_file(&profiles, &a), &journal).unwrap();

        // Simulate a legitimate B commit after restart, before A is selected
        // and recovered. Restoring A's whole old index would erase this edit.
        let mut after_b_commit = load_index(&profiles).unwrap().unwrap();
        after_b_commit
            .profiles
            .iter_mut()
            .find(|profile| profile.id == b)
            .unwrap()
            .name = "B changed after restart".into();
        write_json(&index_file(&profiles), &after_b_commit).unwrap();

        recover_profile_mutation_to(&profiles, &root, &a).unwrap();
        let recovered = load_index(&profiles).unwrap().unwrap();
        assert_eq!(
            recovered
                .profiles
                .iter()
                .find(|profile| profile.id == b)
                .unwrap()
                .name,
            "B changed after restart"
        );
        cleanup(&dir);
    }

    #[test]
    fn committed_recovery_rolls_live_projection_forward_before_cleanup() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/steam.inf"), "appID=440\n");
        fs::create_dir_all(root.join("tf/custom/domain")).unwrap();
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        set_active_profile_to(&profiles, &root, &id, unlocked()).unwrap();
        let rel = "tf/custom/domain/file.txt";
        mutate_profile_files_to(
            &profiles,
            &root,
            &id,
            &[(rel.into(), FileSource::Bytes(b"old"))],
            &[],
            ProfileLiveProjection::MirrorIfActive,
            unlocked(),
            |_| Ok(()),
        )
        .unwrap();

        let transaction_id = "0123456789abcdef0123456789abcdef";
        let profile_root = profile_dir(&profiles, &id);
        let old_manifest = load_manifest(&profiles, &id).unwrap();
        let mut new_manifest = old_manifest.clone();
        new_manifest.files[0].sha256 = sha256_hex(b"new");
        let old_index = load_index(&profiles).unwrap().unwrap();
        let mut new_index = old_index.clone();
        touch_profile(&mut new_index, &id);

        let destination = exclusive_file_path(&profiles, &id, rel);
        let staged = mutation_file_path(&profiles, &id, transaction_id, "new", rel);
        let backup = mutation_file_path(&profiles, &id, transaction_id, "old", rel);
        write_atomic_within(&profile_root, &staged, b"new").unwrap();
        move_file_within(&profile_root, &destination, &backup).unwrap();
        move_file_within(&profile_root, &staged, &destination).unwrap();
        let live = profile_live_path(&root, rel);
        let live_backup = mutation_file_path(&profiles, &id, transaction_id, "live-old", rel);
        copy_and_sha256_within(&profile_root, &live, &live_backup).unwrap();
        write_json(&manifest_file(&profiles, &id), &new_manifest).unwrap();
        write_json(&index_file(&profiles), &new_index).unwrap();
        write_json(
            &mutation_journal_file(&profiles, &id),
            &ProfileMutationJournal {
                transaction_id: transaction_id.into(),
                profile_id: id.clone(),
                old_manifest,
                new_manifest,
                file_changes: vec![ProfileFileChange {
                    old_path: Some(rel.into()),
                    new_path: Some(rel.into()),
                }],
                live_changes: vec![ProfileLiveChange {
                    path: rel.into(),
                    old_sha256: Some(sha256_hex(b"old")),
                    new_sha256: Some(sha256_hex(b"new")),
                }],
                live_renames: Vec::new(),
                old_index: Some(old_index),
                new_index: Some(new_index),
                touched_paths: Vec::new(),
                committed: true,
            },
        )
        .unwrap();

        recover_profile_mutation_to(&profiles, &root, &id).unwrap();
        assert_eq!(fs::read(&live).unwrap(), b"new");
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert!(!mutation_journal_file(&profiles, &id).exists());
        assert!(!mutation_root(&profiles, &id, transaction_id).exists());
        cleanup(&dir);
    }

    #[test]
    fn prepared_recovery_preflights_every_backup_before_restoring_any_file() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        let paths = ["tf/custom/pack/a.txt", "tf/custom/pack/b.txt"];
        put_profile_files_to(
            &profiles,
            &root,
            &id,
            &[
                (paths[0].into(), FileSource::Bytes(b"old a")),
                (paths[1].into(), FileSource::Bytes(b"old b")),
            ],
            unlocked(),
        )
        .unwrap();
        let old_manifest = load_manifest(&profiles, &id).unwrap();
        let mut new_manifest = old_manifest.clone();
        new_manifest.files[0].sha256 = sha256_hex(b"new a");
        new_manifest.files[1].sha256 = sha256_hex(b"new b");
        let transaction_id = "0123456789abcdef0123456789abcdef";
        let profile_root = profile_dir(&profiles, &id);
        for (path, bytes) in paths.iter().zip([b"new a".as_slice(), b"new b".as_slice()]) {
            let destination = exclusive_file_path(&profiles, &id, path);
            let backup = mutation_file_path(&profiles, &id, transaction_id, "old", path);
            move_file_within(&profile_root, &destination, &backup).unwrap();
            write_atomic_within(&profile_root, &destination, bytes).unwrap();
        }
        let corrupt_backup = mutation_file_path(&profiles, &id, transaction_id, "old", paths[0]);
        write_atomic_within(&profile_root, &corrupt_backup, b"corrupt").unwrap();
        write_json(
            &mutation_journal_file(&profiles, &id),
            &ProfileMutationJournal {
                transaction_id: transaction_id.into(),
                profile_id: id.clone(),
                old_manifest: old_manifest.clone(),
                new_manifest: new_manifest.clone(),
                file_changes: derived_profile_file_changes(&old_manifest, &new_manifest).unwrap(),
                live_changes: Vec::new(),
                live_renames: Vec::new(),
                old_index: None,
                new_index: None,
                touched_paths: Vec::new(),
                committed: false,
            },
        )
        .unwrap();

        assert!(recover_profile_mutation_to(&profiles, &root, &id).is_err());
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &id, paths[0])).unwrap(),
            b"new a"
        );
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &id, paths[1])).unwrap(),
            b"new b"
        );
        assert!(mutation_journal_file(&profiles, &id).is_file());
        cleanup(&dir);
    }

    #[test]
    fn committed_recovery_preflights_every_staged_file_before_publishing_any() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        let old_manifest = load_manifest(&profiles, &id).unwrap();
        let paths = ["tf/custom/pack/a.txt", "tf/custom/pack/b.txt"];
        let mut new_manifest = old_manifest.clone();
        new_manifest.files = vec![
            ProfileFile {
                path: paths[0].into(),
                sha256: sha256_hex(b"new a"),
                storage: FileStorage::Exclusive,
            },
            ProfileFile {
                path: paths[1].into(),
                sha256: sha256_hex(b"new b"),
                storage: FileStorage::Exclusive,
            },
        ];
        let transaction_id = "0123456789abcdef0123456789abcdef";
        let profile_root = profile_dir(&profiles, &id);
        let staged_a = mutation_file_path(&profiles, &id, transaction_id, "new", paths[0]);
        let staged_b = mutation_file_path(&profiles, &id, transaction_id, "new", paths[1]);
        write_atomic_within(&profile_root, &staged_a, b"new a").unwrap();
        write_atomic_within(&profile_root, &staged_b, b"corrupt").unwrap();
        write_json(&manifest_file(&profiles, &id), &new_manifest).unwrap();
        write_json(
            &mutation_journal_file(&profiles, &id),
            &ProfileMutationJournal {
                transaction_id: transaction_id.into(),
                profile_id: id.clone(),
                old_manifest: old_manifest.clone(),
                new_manifest: new_manifest.clone(),
                file_changes: derived_profile_file_changes(&old_manifest, &new_manifest).unwrap(),
                live_changes: Vec::new(),
                live_renames: Vec::new(),
                old_index: None,
                new_index: None,
                touched_paths: Vec::new(),
                committed: true,
            },
        )
        .unwrap();

        assert!(recover_profile_mutation_to(&profiles, &root, &id).is_err());
        assert!(!exclusive_file_path(&profiles, &id, paths[0]).exists());
        assert!(staged_a.is_file());
        assert!(mutation_journal_file(&profiles, &id).is_file());
        cleanup(&dir);
    }

    #[test]
    fn recovery_preflights_every_profile_before_restoring_the_first_one() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        create_profile_record_to(&profiles, &root, "B", unlocked()).unwrap();
        let ids: Vec<String> = load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .into_iter()
            .map(|profile| profile.id)
            .collect();
        let rel = "tf/custom/pack/file.txt";
        let transaction_id = "0123456789abcdef0123456789abcdef";
        for (index, id) in ids.iter().enumerate() {
            let old = format!("old {index}");
            let new = format!("new {index}");
            put_exclusive_file_to(&profiles, &root, id, rel, old.as_bytes(), unlocked()).unwrap();
            let old_manifest = load_manifest(&profiles, id).unwrap();
            let mut new_manifest = old_manifest.clone();
            new_manifest.files[0].sha256 = sha256_hex(new.as_bytes());
            let profile_root = profile_dir(&profiles, id);
            let destination = exclusive_file_path(&profiles, id, rel);
            let backup = mutation_file_path(&profiles, id, transaction_id, "old", rel);
            move_file_within(&profile_root, &destination, &backup).unwrap();
            write_atomic_within(&profile_root, &destination, new.as_bytes()).unwrap();
            write_json(
                &mutation_journal_file(&profiles, id),
                &ProfileMutationJournal {
                    transaction_id: transaction_id.into(),
                    profile_id: id.clone(),
                    old_manifest: old_manifest.clone(),
                    new_manifest: new_manifest.clone(),
                    file_changes: derived_profile_file_changes(&old_manifest, &new_manifest)
                        .unwrap(),
                    live_changes: Vec::new(),
                    live_renames: Vec::new(),
                    old_index: None,
                    new_index: None,
                    touched_paths: Vec::new(),
                    committed: false,
                },
            )
            .unwrap();
        }
        let second_backup = mutation_file_path(&profiles, &ids[1], transaction_id, "old", rel);
        write_atomic_within(&profile_dir(&profiles, &ids[1]), &second_backup, b"corrupt").unwrap();

        assert!(recover_all_profile_mutations_to(&profiles, &root, unlocked()).is_err());
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &ids[0], rel)).unwrap(),
            b"new 0"
        );
        assert!(mutation_journal_file(&profiles, &ids[0]).is_file());
        cleanup(&dir);
    }

    #[test]
    fn recovery_never_trusts_a_consistently_tampered_index_and_journal_root() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let confirmed_root = dir.join("Team Fortress 2");
        let attacker_root = dir.join("victim-root");
        write_live(&confirmed_root.join("tf/steam.inf"), "appID=440\n");
        write_live(
            &attacker_root.join("tf/custom/domain/file.txt"),
            "victim bytes",
        );
        let library =
            create_profile_record_to(&profiles, &confirmed_root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        let mut old_manifest = load_manifest(&profiles, &id).unwrap();
        old_manifest.tf2_root = user_path_string(&attacker_root);
        let new_manifest = old_manifest.clone();
        let mut index = load_index(&profiles).unwrap().unwrap();
        index.tf2_root = user_path_string(&attacker_root);
        write_json(&index_file(&profiles), &index).unwrap();
        write_json(
            &mutation_journal_file(&profiles, &id),
            &ProfileMutationJournal {
                transaction_id: "0123456789abcdef0123456789abcdef".into(),
                profile_id: id.clone(),
                old_manifest,
                new_manifest,
                file_changes: Vec::new(),
                live_changes: vec![ProfileLiveChange {
                    path: "tf/custom/domain/file.txt".into(),
                    old_sha256: Some(sha256_hex(b"victim bytes")),
                    new_sha256: Some(sha256_hex(b"attacker bytes")),
                }],
                live_renames: Vec::new(),
                old_index: None,
                new_index: None,
                touched_paths: Vec::new(),
                committed: false,
            },
        )
        .unwrap();

        let err = recover_profile_mutation_to(&profiles, &confirmed_root, &id).unwrap_err();
        assert!(matches!(err, ProfileError::RootMismatch { .. }));
        assert_eq!(
            fs::read(attacker_root.join("tf/custom/domain/file.txt")).unwrap(),
            b"victim bytes"
        );
        assert!(mutation_journal_file(&profiles, &id).is_file());
        cleanup(&dir);
    }

    #[test]
    fn profile_delete_keeps_payload_when_index_cannot_commit() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/cfg/autoexec.cfg",
            b"echo safe",
            unlocked(),
        )
        .unwrap();
        fs::create_dir_all(crate::hash::part_path(&index_file(&profiles))).unwrap();

        assert!(remove_profile_record_to(&profiles, &root, &id, unlocked()).is_err());
        assert!(profile_dir(&profiles, &id).is_dir());
        assert!(load_manifest(&profiles, &id).is_ok());
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .iter()
            .any(|profile| profile.id == id));
        cleanup(&dir);
    }

    #[test]
    fn batch_rejects_portable_case_collisions_before_writing() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "A", unlocked()).unwrap();
        let id = library.profiles[0].id.clone();
        let files = [
            (
                "tf/custom/Hud/info.vdf".to_string(),
                FileSource::Bytes(b"one"),
            ),
            (
                "tf/custom/hud/INFO.VDF".to_string(),
                FileSource::Bytes(b"two"),
            ),
        ];

        assert!(put_profile_files_to(&profiles, &root, &id, &files, unlocked()).is_err());
        assert!(load_manifest(&profiles, &id).unwrap().files.is_empty());
        cleanup(&dir);
    }

    #[test]
    fn refuses_writes_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let err = init_library_to(&profiles, &root, [tf2_name()]).unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        assert!(!profiles.exists());
        cleanup(&dir);
    }

    #[test]
    fn root_mismatch_hides_profiles() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let old = dir.join("old").join("Team Fortress 2");
        let new = dir.join("new").join("Team Fortress 2");
        create_profile_record_to(&profiles, &old, "Old", unlocked()).unwrap();

        let library = load_library_from(&profiles, Some(&new)).unwrap();
        assert!(library.initialized);
        assert!(!library.usable);
        assert!(library.root_mismatch);
        assert!(library.profiles.is_empty());

        let err = create_profile_record_to(&profiles, &new, "New", unlocked()).unwrap_err();
        match err {
            ProfileError::RootMismatch { library_root, .. } => {
                assert!(library_root.contains("old"));
            }
            other => panic!("expected RootMismatch, got {other:?}"),
        }
        cleanup(&dir);
    }

    #[test]
    fn rejects_forbidden_and_traversal_paths() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "Safe", unlocked()).unwrap();
        let id = &library.profiles[0].id;

        for path in [
            "tf/steam.inf",
            "tf/gameinfo.txt",
            "tf/cfg/video.txt",
            "tf/tf2_misc_dir.vpk",
            "../outside.cfg",
        ] {
            let err =
                put_exclusive_file_to(&profiles, &root, id, path, b"x", unlocked()).unwrap_err();
            assert!(
                matches!(
                    err,
                    ProfileError::ForbiddenPath(_) | ProfileError::InvalidPath
                ),
                "{path} => {err:?}"
            );
        }

        let hash = put_exclusive_file_to(
            &profiles,
            &root,
            id,
            "tf/custom/tf2_lookalike.vpk",
            b"custom",
            unlocked(),
        )
        .unwrap();
        assert_eq!(hash, sha256_hex(b"custom"));
        cleanup(&dir);
    }

    #[test]
    fn manifest_paths_outside_the_file_safe_surface_are_refused() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let library = create_profile_record_to(&profiles, &root, "Safe", unlocked()).unwrap();
        let id = &library.profiles[0].id;

        // The old denylist let every one of these into a manifest, and a later
        // switch copies a manifest file straight into the live game folder.
        for path in [
            "bin/x64/client.dll",
            "hl2.exe",
            "tf/bin/client.dll",
            "tf/cfg/user/autoexec.cfg",
            "tf/cfg/user",
            "tf/materials/console/background.vtf",
            "tf/addons/thing.vpk",
        ] {
            let err =
                put_exclusive_file_to(&profiles, &root, id, path, b"x", unlocked()).unwrap_err();
            assert!(
                matches!(err, ProfileError::ForbiddenPath(_)),
                "{path} => {err:?}"
            );
        }
        cleanup(&dir);
    }

    #[test]
    fn save_current_manifest_writes_do_not_grow_with_file_count() {
        // Saving n files must cost the same number of manifest rewrites as
        // saving one. The per-file API was O(n) full JSON rewrites — 3,000 of
        // them for a normal HUD, each one a window where a crash truncates the
        // library.
        let save_with = |files: usize| -> (usize, usize) {
            let dir = crate::test_temp_dir();
            let profiles = dir.join("execs").join("profiles");
            let root = dir.join("Team Fortress 2");
            write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
            for i in 0..files {
                write_live(
                    &root.join(format!("tf/custom/pack/resource/f{i}.res")),
                    &format!("file {i}\n"),
                );
            }
            let library = save_current_as_to(
                &profiles,
                &root,
                "Save",
                unlocked(),
                SaveCurrentOptions {
                    launch_options: Some(""),
                    cloud_config: None,
                },
            )
            .unwrap();
            let id = library.profiles[0].id.clone();
            let manifest = load_manifest(&profiles, &id).unwrap();
            let writes = write_counts::count(&manifest_file(&profiles, &id));
            cleanup(&dir);
            (manifest.files.len(), writes)
        };

        let (one_files, one_writes) = save_with(1);
        let (many_files, many_writes) = save_with(50);
        assert_eq!(one_files, 2);
        assert_eq!(many_files, 51);
        assert_eq!(
            many_writes, one_writes,
            "manifest writes must be O(1) in the number of files saved"
        );
    }

    #[test]
    fn create_requires_a_name() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let err = create_profile_record_to(&profiles, &root, "   ", unlocked()).unwrap_err();
        assert_eq!(err, ProfileError::InvalidName);
        cleanup(&dir);
    }

    fn write_live(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn snapshot_tree(root: &Path) -> std::collections::BTreeMap<String, String> {
        let mut out = std::collections::BTreeMap::new();
        fn walk(dir: &Path, root: &Path, out: &mut std::collections::BTreeMap<String, String>) {
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, root, out);
                    continue;
                }
                if path.is_file() {
                    let rel = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    out.insert(rel, sha256_hex(&fs::read(&path).unwrap()));
                }
            }
        }
        if root.exists() {
            walk(root, root, &mut out);
        }
        out
    }

    #[test]
    fn save_current_copies_surface_and_leaves_live_untouched() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_live(&root.join("tf/cfg/user/autoexec.cfg"), "old autoexec\n");
        write_live(
            &root.join("tf/custom/hud/resource/ui/hudlayout.res"),
            "hud\n",
        );
        write_live(&root.join("tf/custom/mastercomfig-base.vpk"), "shared-vpk");
        write_live(&root.join("tf/cfg/video.txt"), "video\n");
        write_live(&root.join("tf/steam.inf"), "appID=440\n");
        let before = snapshot_tree(&root);

        let library = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-novid -autoconfig -dxlevel 90 +quit -console"),
                cloud_config: None,
            },
        )
        .unwrap();
        assert_eq!(library.profiles.len(), 1);
        assert_eq!(library.profiles[0].name, "Main");
        assert_eq!(
            library.active_profile_id.as_deref(),
            Some(library.profiles[0].id.as_str())
        );
        assert_eq!(snapshot_tree(&root), before);

        let id = &library.profiles[0].id;
        let manifest = load_manifest(&profiles, id).unwrap();
        assert_eq!(manifest.launch_options, "-novid -console");
        assert!(!manifest.launch_sync_pending);
        let paths: Vec<_> = manifest
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        assert!(paths.contains(&"tf/cfg/config.cfg"));
        assert!(paths.contains(&"tf/cfg/overrides/autoexec.cfg"));
        assert!(paths.contains(&"tf/cfg/overrides/.migrated/user/autoexec.cfg"));
        assert!(paths.contains(&"tf/custom/hud/resource/ui/hudlayout.res"));
        assert!(paths.contains(&"tf/custom/mastercomfig-base.vpk"));
        assert!(!paths.iter().any(|path| path.contains("video.txt")));
        assert!(!paths.iter().any(|path| path.contains("steam.inf")));

        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                id,
                "tf/cfg/overrides/autoexec.cfg"
            ))
            .unwrap(),
            b"fov_desired 90\n"
        );
        let shared = manifest
            .files
            .iter()
            .find(|file| file.path == "tf/custom/mastercomfig-base.vpk")
            .unwrap();
        assert_eq!(shared.storage, FileStorage::Shared);
        assert_eq!(shared.sha256, sha256_hex(b"shared-vpk"));
        assert!(crate::blob::blob_path(&profiles, &shared.sha256).is_file());
        assert!(!exclusive_file_path(&profiles, id, "tf/custom/mastercomfig-base.vpk").exists());
        cleanup(&dir);
    }

    #[test]
    fn first_save_sets_active_second_does_not_steal() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/autoexec.cfg"), "fov_desired 90\n");

        let first = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap();
        let first_id = first.profiles[0].id.clone();
        assert_eq!(first.active_profile_id.as_deref(), Some(first_id.as_str()));

        write_live(&root.join("tf/custom/alt/pack.txt"), "alt\n");
        let second = save_current_as_to(
            &profiles,
            &root,
            "Alt",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-novid"),
                cloud_config: None,
            },
        )
        .unwrap();
        assert_eq!(second.profiles.len(), 2);
        assert_eq!(second.active_profile_id.as_deref(), Some(first_id.as_str()));
        cleanup(&dir);
    }

    #[test]
    fn save_reuses_empty_singleton_and_uses_cloud_config() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        let created =
            create_profile_record_to(&profiles, &root, "Placeholder", unlocked()).unwrap();
        let empty_id = created.profiles[0].id.clone();
        let cloud = dir.join("cloud.cfg");
        write_live(&cloud, "cloud bytes\n");

        let library = save_current_as_to(
            &profiles,
            &root,
            "Live",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-console"),
                cloud_config: Some(&cloud),
            },
        )
        .unwrap();
        assert_eq!(library.profiles.len(), 1);
        assert_eq!(library.profiles[0].id, empty_id);
        assert_eq!(library.profiles[0].name, "Live");
        let manifest = load_manifest(&profiles, &empty_id).unwrap();
        assert_eq!(manifest.launch_options, "-console");
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.files[0].path, "tf/cfg/config.cfg");
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &empty_id,
                "tf/cfg/config.cfg"
            ))
            .unwrap(),
            b"cloud bytes\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn save_current_reuse_rolls_name_files_and_launch_back_together() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "live config\n");
        let created =
            create_profile_record_to(&profiles, &root, "Placeholder", unlocked()).unwrap();
        let id = created.profiles[0].id.clone();
        let old_manifest = load_manifest(&profiles, &id).unwrap();
        let old_index = load_index(&profiles).unwrap().unwrap();
        fs::create_dir_all(crate::hash::part_path(&index_file(&profiles))).unwrap();

        let err = save_current_as_to(
            &profiles,
            &root,
            "Captured",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-console"),
                cloud_config: None,
            },
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::Io(_)));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), old_manifest);
        assert_eq!(load_index(&profiles).unwrap().unwrap(), old_index);
        assert!(!exclusive_file_path(&profiles, &id, "tf/cfg/config.cfg").exists());
        assert!(!mutation_journal_file(&profiles, &id).exists());
        cleanup(&dir);
    }

    #[test]
    fn save_current_refuses_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/autoexec.cfg"), "x\n");
        let err = save_current_as_to(
            &profiles,
            &root,
            "Main",
            [tf2_name()],
            SaveCurrentOptions::default(),
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        assert!(!profiles.exists());
        cleanup(&dir);
    }
}
