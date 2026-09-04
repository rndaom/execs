//! Durable rollback journal for a preloader selection replacement.
//!
//! The intent's durable phase is the commit marker. Every live byte and
//! recovery file an apply can change is copied here before the first
//! destructive write. A prepared journal rolls back on the next writer; a
//! committed journal only needs its backups removed.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::hash::{
    copy_and_sha256_exact_within, copy_verified_atomic_within, metadata_is_link,
    read_small_file_bounded, remove_dir_within, remove_file_force_within, sha256_file, sha256_hex,
    validate_file_within, write_atomic_within,
};
use crate::pcf::MAX_PCF_BYTES;
use crate::process_lock::refuse_if_running_among;
use crate::vpk::{
    map_vpk_entries, patch_vpk_entry_if_unchanged, read_vpk_entry, VpkEntryLocation, VpkError,
};

use super::gameinfo::{gameinfo_backup_path, gameinfo_path, require_pristine_gameinfo};
use super::state::{
    app_dir_within, is_stock, originals_dir, preloader_dir, read_particle_entry_bounded,
    save_state, state_path, vpk_fingerprint, write_snapshot, PreloaderState,
};
use super::{MISC_VPK, PRELOADER_VPK};

const TRANSACTION_SCHEMA: u32 = 2;
const TRANSACTION_DIR: &str = "apply-transaction";
const INTENT_FILE: &str = "intent.json";
const MAX_INTENT_BYTES: u64 = 4 * 1024 * 1024;
const MAX_BACKUP_FILES: usize = 20_000;
const MAX_TRANSACTION_FILES: usize = MAX_BACKUP_FILES + 1;
const MAX_BACKUP_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SMALL_BACKUP_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ENTRY_BACKUP_BYTES: u64 = MAX_PCF_BYTES as u64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum TransactionPhase {
    Prepared,
    Committed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileBackup {
    existed: bool,
    backup_name: String,
    sha256: String,
    len: u64,
}

impl FileBackup {
    fn absent() -> Self {
        Self {
            existed: false,
            backup_name: String::new(),
            sha256: String::new(),
            len: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct EntryBackup {
    rel: String,
    location: EntryLocationIdentity,
    file: FileBackup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OriginalBackup {
    name: String,
    file: FileBackup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TransactionIntent {
    schema: u32,
    tf2_root: PathBuf,
    phase: TransactionPhase,
    state: FileBackup,
    gameinfo_backup: FileBackup,
    gameinfo: FileBackup,
    custom_vpk: FileBackup,
    originals_dir_existed: bool,
    originals: Vec<OriginalBackup>,
    entries: Vec<EntryBackup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct EntryLocationIdentity {
    crc: u32,
    crc_pos: u64,
    preload_len: u16,
    archive_index: u16,
    offset: u32,
    length: u32,
    data_base: u64,
}

impl EntryLocationIdentity {
    fn from_location(entry: &VpkEntryLocation) -> Self {
        Self {
            crc: entry.crc,
            crc_pos: entry.crc_pos,
            preload_len: entry.preload_len,
            archive_index: entry.archive_index,
            offset: entry.offset,
            length: entry.length,
            data_base: entry.data_base,
        }
    }

    fn matches(&self, entry: &VpkEntryLocation) -> bool {
        self == &Self::from_location(entry)
    }
}

#[derive(Debug)]
pub(crate) struct TransactionCommitError {
    message: String,
    pub(crate) rollback_safe: bool,
}

impl std::fmt::Display for TransactionCommitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl TransactionCommitError {
    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

pub(crate) struct PreloaderTransaction {
    data_dir: PathBuf,
    intent: TransactionIntent,
}

/// Read-only classification used by every non-recovery command boundary.
/// `CommittedCleanup` also covers a backup-only directory whose intent was
/// never published; neither state can require a live rollback, but both must
/// be cleaned by an authorized recovery path before ordinary writes proceed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreloaderTransactionStatus {
    None,
    CommittedCleanup,
    Prepared,
}

fn transaction_dir(data_dir: &Path) -> PathBuf {
    preloader_dir(data_dir).join(TRANSACTION_DIR)
}

fn intent_path(data_dir: &Path) -> PathBuf {
    transaction_dir(data_dir).join(INTENT_FILE)
}

fn canonical_root(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path)
        .map_err(|err| format!("Could not identify the TF2 folder for preloader recovery: {err}"))
}

fn checked_backup_path(data_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let mut components = Path::new(name).components();
    let Some(Component::Normal(_)) = components.next() else {
        return Err("The preloader recovery journal contains an invalid backup name.".into());
    };
    if components.next().is_some() {
        return Err("The preloader recovery journal contains an invalid backup path.".into());
    }
    Ok(transaction_dir(data_dir).join(name))
}

fn check_backup_budget(files: &mut usize, bytes: &mut u64, len: u64) -> Result<(), String> {
    *files = files
        .checked_add(1)
        .ok_or_else(|| "The preloader recovery backup has too many files.".to_string())?;
    if *files > MAX_BACKUP_FILES {
        return Err("The preloader recovery backup has too many files.".into());
    }
    *bytes = bytes
        .checked_add(len)
        .ok_or_else(|| "The preloader recovery backup is too large.".to_string())?;
    if *bytes > MAX_BACKUP_BYTES {
        return Err("The preloader recovery backup is too large.".into());
    }
    Ok(())
}

fn is_single_normal_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\'])
        && matches!(
            Path::new(name).components().collect::<Vec<_>>().as_slice(),
            [Component::Normal(_)]
        )
}

fn validate_backup_relationship(backup: &FileBackup, expected_name: &str) -> Result<(), String> {
    if backup.existed && backup.backup_name != expected_name {
        return Err("The preloader recovery journal mismatches a backup and its source.".into());
    }
    Ok(())
}

fn capture_optional_file(
    data_dir: &Path,
    source_root: &Path,
    source: &Path,
    backup_name: &str,
    max_len: u64,
    files: &mut usize,
    bytes: &mut u64,
) -> Result<FileBackup, String> {
    let metadata = match fs::symlink_metadata(source) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(FileBackup::absent()),
        Err(err) => return Err(format!("Could not inspect {}: {err}", source.display())),
    };
    if metadata_is_link(&metadata) || !metadata.is_file() {
        return Err(format!(
            "Refusing to back up a linked or non-file path: {}",
            source.display()
        ));
    }
    validate_file_within(source_root, source)
        .map_err(|err| format!("Could not validate {}: {err}", source.display()))?;
    if metadata.len() > max_len {
        return Err(format!(
            "Refusing to back up {} because it exceeds its safe size limit.",
            source.display()
        ));
    }
    check_backup_budget(files, bytes, metadata.len())?;
    let backup = checked_backup_path(data_dir, backup_name)?;
    app_dir_within(data_dir, &transaction_dir(data_dir), false)?;
    let sha256 = copy_and_sha256_exact_within(data_dir, source, &backup, metadata.len())
        .map_err(|err| format!("Could not create the preloader recovery backup: {err}"))?;
    validate_file_within(data_dir, &backup)
        .map_err(|err| format!("Could not validate the preloader recovery backup: {err}"))?;
    let copied_len = fs::metadata(&backup)
        .map_err(|err| format!("Could not verify the preloader recovery backup: {err}"))?
        .len();
    if copied_len != metadata.len() {
        return Err(format!(
            "{} changed while its preloader recovery backup was being made.",
            source.display()
        ));
    }
    Ok(FileBackup {
        existed: true,
        backup_name: backup_name.to_string(),
        sha256,
        len: copied_len,
    })
}

fn capture_bytes(
    data_dir: &Path,
    backup_name: &str,
    contents: &[u8],
    files: &mut usize,
    bytes: &mut u64,
) -> Result<FileBackup, String> {
    check_backup_budget(files, bytes, contents.len() as u64)?;
    let backup = checked_backup_path(data_dir, backup_name)?;
    write_atomic_within(data_dir, &backup, contents)
        .map_err(|err| format!("Could not create the preloader recovery backup: {err}"))?;
    Ok(FileBackup {
        existed: true,
        backup_name: backup_name.to_string(),
        sha256: sha256_hex(contents),
        len: contents.len() as u64,
    })
}

fn write_intent(data_dir: &Path, intent: &TransactionIntent) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(intent)
        .map_err(|err| format!("Could not encode the preloader recovery journal: {err}"))?;
    if json.len() as u64 > MAX_INTENT_BYTES {
        return Err("The preloader recovery journal is too large.".into());
    }
    write_atomic_within(data_dir, &intent_path(data_dir), &json)
        .map_err(|err| format!("Could not save the preloader recovery journal: {err}"))
}

fn load_intent(data_dir: &Path) -> Result<Option<TransactionIntent>, String> {
    if !app_dir_within(data_dir, &transaction_dir(data_dir), false)? {
        return Ok(None);
    }
    let path = intent_path(data_dir);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => {
            return Err(format!(
                "Could not inspect the preloader recovery journal: {err}"
            ))
        }
    };
    if metadata_is_link(&metadata) || !metadata.is_file() || metadata.len() > MAX_INTENT_BYTES {
        return Err("The preloader recovery journal is invalid.".into());
    }
    let json = read_small_file_bounded(&path, MAX_INTENT_BYTES as usize)
        .map_err(|err| format!("Could not read the preloader recovery journal: {err}"))?;
    let intent: TransactionIntent = serde_json::from_slice(&json)
        .map_err(|err| format!("Could not parse the preloader recovery journal: {err}"))?;
    if intent.schema != TRANSACTION_SCHEMA {
        return Err("The preloader recovery journal uses an unsupported schema.".into());
    }
    validate_intent_budgets(&intent)?;
    Ok(Some(intent))
}

fn validate_intent_budgets(intent: &TransactionIntent) -> Result<(), String> {
    let record_count = 4usize
        .checked_add(intent.originals.len())
        .and_then(|count| count.checked_add(intent.entries.len()))
        .ok_or_else(|| "The preloader recovery journal has too many records.".to_string())?;
    if record_count > MAX_BACKUP_FILES {
        return Err("The preloader recovery journal has too many records.".into());
    }

    let mut total = 0u64;
    let mut names = BTreeSet::new();
    let mut check = |backup: &FileBackup, cap: u64| -> Result<(), String> {
        if !backup.existed {
            if !backup.backup_name.is_empty() || !backup.sha256.is_empty() || backup.len != 0 {
                return Err(
                    "The preloader recovery journal has an invalid absent-file record.".into(),
                );
            }
            return Ok(());
        }
        if backup.len > cap {
            return Err("A preloader recovery backup exceeds its safe size limit.".into());
        }
        total = total
            .checked_add(backup.len)
            .ok_or_else(|| "The preloader recovery backup is too large.".to_string())?;
        if total > MAX_BACKUP_BYTES {
            return Err("The preloader recovery backup is too large.".into());
        }
        if !names.insert(backup.backup_name.clone()) {
            return Err("The preloader recovery journal reuses a backup name.".into());
        }
        Ok(())
    };

    validate_backup_relationship(&intent.state, "old-state")?;
    validate_backup_relationship(&intent.gameinfo_backup, "old-gameinfo-backup")?;
    validate_backup_relationship(&intent.gameinfo, "old-gameinfo")?;
    validate_backup_relationship(&intent.custom_vpk, "old-custom-vpk")?;
    check(&intent.state, MAX_SMALL_BACKUP_BYTES)?;
    check(&intent.gameinfo_backup, MAX_SMALL_BACKUP_BYTES)?;
    check(&intent.gameinfo, MAX_SMALL_BACKUP_BYTES)?;
    check(&intent.custom_vpk, MAX_BACKUP_BYTES)?;
    if !intent.originals_dir_existed && !intent.originals.is_empty() {
        return Err(
            "The preloader recovery journal has snapshots from an absent originals folder.".into(),
        );
    }
    let mut original_names = BTreeSet::new();
    for original in &intent.originals {
        if !is_single_normal_name(&original.name) || !original_names.insert(original.name.as_str())
        {
            return Err("The preloader recovery journal has an invalid snapshot name.".into());
        }
        let expected = format!("original-{}", sha256_hex(original.name.as_bytes()));
        validate_backup_relationship(&original.file, &expected)?;
        if !original.file.existed {
            return Err("The preloader recovery journal has an absent snapshot backup.".into());
        }
        check(&original.file, MAX_ENTRY_BACKUP_BYTES)?;
    }
    let mut entry_paths = BTreeSet::new();
    for entry in &intent.entries {
        if !entry_paths.insert(entry.rel.as_str())
            || !entry.rel.starts_with("particles/")
            || !entry.rel.ends_with(".pcf")
            || entry.rel.contains('\\')
            || entry
                .rel
                .split('/')
                .any(|component| component.is_empty() || matches!(component, "." | ".."))
            || !entry.file.existed
            || entry.location.preload_len != 0
            || entry.file.len != u64::from(entry.location.length)
        {
            return Err("The preloader recovery journal has an invalid particle record.".into());
        }
        let expected = format!("entry-{}", sha256_hex(entry.rel.as_bytes()));
        validate_backup_relationship(&entry.file, &expected)?;
        check(&entry.file, MAX_ENTRY_BACKUP_BYTES)?;
    }
    Ok(())
}

fn validate_transaction_file_count(count: usize) -> Result<(), String> {
    if count > MAX_TRANSACTION_FILES {
        return Err("The preloader recovery folder contains too many entries.".into());
    }
    Ok(())
}

fn clear_transaction_dir(data_dir: &Path) -> Result<(), String> {
    let dir = transaction_dir(data_dir);
    if !app_dir_within(data_dir, &dir, false)? {
        return Ok(());
    }
    let metadata = match fs::symlink_metadata(&dir) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(format!("Could not inspect preloader recovery files: {err}")),
    };
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return Err("The preloader recovery path is linked or is not a directory.".into());
    }
    for (index, entry) in fs::read_dir(&dir)
        .map_err(|err| format!("Could not inspect preloader recovery files: {err}"))?
        .enumerate()
    {
        validate_transaction_file_count(index.saturating_add(1))?;
        let entry = entry.map_err(|err| format!("Could not inspect recovery file: {err}"))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|err| format!("Could not inspect recovery file: {err}"))?;
        if metadata_is_link(&metadata) || !metadata.is_file() {
            return Err(
                "The preloader recovery folder contains a linked or non-file entry.".into(),
            );
        }
        remove_file_force_within(data_dir, &entry.path())
            .map_err(|err| format!("Could not remove a preloader recovery file: {err}"))?;
    }
    remove_dir_within(data_dir, &dir)
        .map_err(|err| format!("Could not remove the preloader recovery folder: {err}"))
}

fn validate_backup(data_dir: &Path, backup: &FileBackup) -> Result<PathBuf, String> {
    if !backup.existed {
        if !backup.backup_name.is_empty() || !backup.sha256.is_empty() || backup.len != 0 {
            return Err("The preloader recovery journal has an invalid absent-file record.".into());
        }
        return Ok(PathBuf::new());
    }
    if backup.sha256.len() != 64 || !backup.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The preloader recovery journal has an invalid file digest.".into());
    }
    if backup.len > MAX_BACKUP_BYTES {
        return Err("A preloader recovery backup exceeds its safe size limit.".into());
    }
    let path = checked_backup_path(data_dir, &backup.backup_name)?;
    validate_file_within(data_dir, &path)
        .map_err(|err| format!("Could not validate a preloader recovery backup: {err}"))?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|err| format!("Could not inspect a preloader recovery backup: {err}"))?;
    if metadata_is_link(&metadata) || !metadata.is_file() || metadata.len() != backup.len {
        return Err("A preloader recovery backup is missing or has the wrong size.".into());
    }
    Ok(path)
}

fn validate_backup_digest(data_dir: &Path, backup: &FileBackup) -> Result<(), String> {
    if !backup.existed {
        return Ok(());
    }
    let path = validate_backup(data_dir, backup)?;
    let actual = sha256_file(&path)
        .map_err(|err| format!("Could not verify a preloader recovery backup: {err}"))?;
    if actual != backup.sha256 {
        return Err("A preloader recovery backup has the wrong digest.".into());
    }
    Ok(())
}

fn validate_all_backup_digests(data_dir: &Path, intent: &TransactionIntent) -> Result<(), String> {
    for backup in [
        &intent.state,
        &intent.gameinfo_backup,
        &intent.gameinfo,
        &intent.custom_vpk,
    ] {
        validate_backup_digest(data_dir, backup)?;
    }
    for original in &intent.originals {
        validate_backup_digest(data_dir, &original.file)?;
    }
    for entry in &intent.entries {
        validate_backup_digest(data_dir, &entry.file)?;
    }
    Ok(())
}

fn preflight_app_file_destination(data_dir: &Path, dest: &Path) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| "A preloader recovery destination has no parent.".to_string())?;
    if !app_dir_within(data_dir, parent, false)? {
        return Ok(());
    }
    match fs::symlink_metadata(dest) {
        Ok(metadata) if metadata_is_link(&metadata) || !metadata.is_file() => Err(format!(
            "Refusing a linked or non-file preloader recovery destination: {}",
            dest.display()
        )),
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "Could not inspect preloader recovery destination {}: {err}",
            dest.display()
        )),
    }
}

fn preflight_live_file_destination(tf2_root: &Path, dest: &Path) -> Result<(), String> {
    super::state::live_file_exists_within(tf2_root, dest)
        .map(|_| ())
        .map_err(|err| {
            format!(
                "Could not validate live preloader recovery destination {}: {err}",
                dest.display()
            )
        })
}

fn preflight_originals_destination(
    data_dir: &Path,
    intent: &TransactionIntent,
) -> Result<(), String> {
    let dir = originals_dir(data_dir);
    if app_dir_within(data_dir, &dir, false)? {
        let mut files = 0usize;
        let mut bytes = 0u64;
        for entry in
            fs::read_dir(&dir).map_err(|err| format!("Could not inspect snapshots: {err}"))?
        {
            files = files
                .checked_add(1)
                .ok_or_else(|| "The preloader snapshot folder has too many files.".to_string())?;
            if files > MAX_BACKUP_FILES {
                return Err("The preloader snapshot folder has too many files.".into());
            }
            let entry = entry.map_err(|err| format!("Could not inspect a snapshot: {err}"))?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|err| format!("Could not inspect a snapshot: {err}"))?;
            if metadata_is_link(&metadata) || !metadata.is_file() {
                return Err(
                    "The preloader snapshot folder contains a linked or non-file entry.".into(),
                );
            }
            if metadata.len() > MAX_ENTRY_BACKUP_BYTES {
                return Err("A preloader snapshot exceeds its safe size limit.".into());
            }
            bytes = bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "The preloader snapshot folder is too large.".to_string())?;
            if bytes > MAX_BACKUP_BYTES {
                return Err("The preloader snapshot folder is too large.".into());
            }
        }
    }
    for original in &intent.originals {
        preflight_app_file_destination(data_dir, &dir.join(&original.name))?;
    }
    Ok(())
}

fn preflight_restore_destinations(
    data_dir: &Path,
    tf2_root: &Path,
    intent: &TransactionIntent,
) -> Result<(), String> {
    preflight_live_file_destination(tf2_root, &gameinfo_path(tf2_root))?;
    preflight_live_file_destination(
        tf2_root,
        &tf2_root.join("tf").join("custom").join(PRELOADER_VPK),
    )?;
    preflight_app_file_destination(data_dir, &gameinfo_backup_path(data_dir))?;
    preflight_app_file_destination(data_dir, &state_path(data_dir))?;
    preflight_originals_destination(data_dir, intent)
}

fn read_backup(data_dir: &Path, backup: &FileBackup) -> Result<Vec<u8>, String> {
    let path = validate_backup(data_dir, backup)?;
    let cap = usize::try_from(backup.len)
        .map_err(|_| "A preloader recovery backup is too large for this platform.".to_string())?;
    let bytes = read_small_file_bounded(&path, cap)
        .map_err(|err| format!("Could not read a preloader recovery backup: {err}"))?;
    if sha256_hex(&bytes) != backup.sha256 {
        return Err("A preloader recovery backup has the wrong digest.".into());
    }
    Ok(bytes)
}

fn restore_app_file(data_dir: &Path, dest: &Path, backup: &FileBackup) -> Result<(), String> {
    if !backup.existed {
        match fs::symlink_metadata(dest) {
            Ok(metadata) if metadata_is_link(&metadata) => {
                return Err(format!(
                    "Refusing to remove a linked recovery path: {}",
                    dest.display()
                ));
            }
            Ok(metadata) if metadata.is_file() => remove_file_force_within(data_dir, dest)
                .map_err(|err| {
                    format!("Could not remove {} during recovery: {err}", dest.display())
                })?,
            Ok(_) => {
                return Err(format!(
                    "Refusing to remove a special recovery path: {}",
                    dest.display()
                ))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                return Err(format!(
                    "Could not inspect {} during recovery: {err}",
                    dest.display()
                ))
            }
        }
        return Ok(());
    }
    if let Ok(metadata) = fs::symlink_metadata(dest) {
        if metadata_is_link(&metadata) {
            return Err(format!(
                "Refusing to replace a linked recovery path: {}",
                dest.display()
            ));
        }
        if !metadata.is_file() {
            return Err(format!(
                "Refusing to replace a special recovery path: {}",
                dest.display()
            ));
        }
    }
    let source = validate_backup(data_dir, backup)?;
    copy_verified_atomic_within(data_dir, &source, dest, &backup.sha256)
        .map_err(|err| format!("Could not restore {}: {err}", dest.display()))?;
    Ok(())
}

fn restore_live_file(
    data_dir: &Path,
    tf2_root: &Path,
    dest: &Path,
    backup: &FileBackup,
    before_write: &dyn Fn() -> Result<(), String>,
) -> Result<(), String> {
    if backup.existed {
        let source = validate_backup(data_dir, backup)?;
        before_write()?;
        copy_verified_atomic_within(tf2_root, &source, dest, &backup.sha256)
            .map_err(|err| format!("Could not restore {}: {err}", dest.display()))?;
    } else if super::state::live_file_exists_within(tf2_root, dest).map_err(|err| {
        format!(
            "Could not inspect {} during recovery: {err}",
            dest.display()
        )
    })? {
        before_write()?;
        remove_file_force_within(tf2_root, dest)
            .map_err(|err| format!("Could not remove {} during recovery: {err}", dest.display()))?;
    }
    Ok(())
}

fn restore_originals(data_dir: &Path, intent: &TransactionIntent) -> Result<(), String> {
    let dir = originals_dir(data_dir);
    let originals_exist = app_dir_within(data_dir, &dir, false)?;
    if originals_exist {
        let metadata = fs::symlink_metadata(&dir)
            .map_err(|err| format!("Could not inspect preloader snapshots: {err}"))?;
        if metadata_is_link(&metadata) || !metadata.is_dir() {
            return Err("The preloader originals path is linked or is not a directory.".into());
        }
        for (index, entry) in fs::read_dir(&dir)
            .map_err(|err| format!("Could not inspect preloader snapshots: {err}"))?
            .enumerate()
        {
            if index >= MAX_BACKUP_FILES {
                return Err("The preloader snapshot folder contains too many entries.".into());
            }
            let entry = entry.map_err(|err| format!("Could not inspect a snapshot: {err}"))?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|err| format!("Could not inspect a snapshot: {err}"))?;
            if metadata_is_link(&metadata) || !metadata.is_file() {
                return Err(
                    "The preloader snapshot folder contains a linked or non-file entry.".into(),
                );
            }
            remove_file_force_within(data_dir, &entry.path())
                .map_err(|err| format!("Could not clear a snapshot during recovery: {err}"))?;
        }
    }
    if intent.originals_dir_existed || !intent.originals.is_empty() {
        app_dir_within(data_dir, &dir, true)?;
    }
    for original in &intent.originals {
        let mut components = Path::new(&original.name).components();
        let Some(Component::Normal(_)) = components.next() else {
            return Err("The preloader recovery journal contains an invalid snapshot name.".into());
        };
        if components.next().is_some() {
            return Err("The preloader recovery journal contains an invalid snapshot path.".into());
        }
        restore_app_file(data_dir, &dir.join(&original.name), &original.file)?;
    }
    if !intent.originals_dir_existed && intent.originals.is_empty() {
        match remove_dir_within(data_dir, &dir) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(format!("Could not finish snapshot recovery: {err}")),
        }
    }
    Ok(())
}

impl PreloaderTransaction {
    pub(crate) fn begin(
        tf2_root: &Path,
        data_dir: &Path,
        entries: &BTreeMap<String, VpkEntryLocation>,
        touched_entries: &BTreeSet<String>,
    ) -> Result<Self, String> {
        let transaction_dir_existed = app_dir_within(data_dir, &transaction_dir(data_dir), true)?;
        if transaction_dir_existed {
            return Err("A preloader recovery transaction is already pending.".into());
        }

        let captured = (|| {
            let mut files = 0usize;
            let mut bytes = 0u64;
            let state = capture_optional_file(
                data_dir,
                data_dir,
                &state_path(data_dir),
                "old-state",
                MAX_SMALL_BACKUP_BYTES,
                &mut files,
                &mut bytes,
            )?;
            let gameinfo_backup = capture_optional_file(
                data_dir,
                data_dir,
                &gameinfo_backup_path(data_dir),
                "old-gameinfo-backup",
                MAX_SMALL_BACKUP_BYTES,
                &mut files,
                &mut bytes,
            )?;
            let gameinfo = capture_optional_file(
                data_dir,
                tf2_root,
                &gameinfo_path(tf2_root),
                "old-gameinfo",
                MAX_SMALL_BACKUP_BYTES,
                &mut files,
                &mut bytes,
            )?;
            let custom_vpk = capture_optional_file(
                data_dir,
                tf2_root,
                &tf2_root.join("tf").join("custom").join(PRELOADER_VPK),
                "old-custom-vpk",
                MAX_BACKUP_BYTES,
                &mut files,
                &mut bytes,
            )?;

            let originals = originals_dir(data_dir);
            let originals_dir_existed = app_dir_within(data_dir, &originals, false)?;
            let mut original_backups = Vec::new();
            if originals_dir_existed {
                for entry in fs::read_dir(&originals)
                    .map_err(|err| format!("Could not inspect preloader snapshots: {err}"))?
                {
                    let entry =
                        entry.map_err(|err| format!("Could not inspect a snapshot: {err}"))?;
                    let name = entry.file_name().into_string().map_err(|_| {
                        "A preloader snapshot name is not valid Unicode.".to_string()
                    })?;
                    let backup_name = format!("original-{}", sha256_hex(name.as_bytes()));
                    let file = capture_optional_file(
                        data_dir,
                        data_dir,
                        &entry.path(),
                        &backup_name,
                        MAX_ENTRY_BACKUP_BYTES,
                        &mut files,
                        &mut bytes,
                    )?;
                    original_backups.push(OriginalBackup { name, file });
                }
            }

            let vpk_path = tf2_root.join("tf").join(MISC_VPK);
            let mut entry_backups = Vec::with_capacity(touched_entries.len());
            for rel in touched_entries {
                let entry = entries.get(rel).ok_or_else(|| {
                    format!("Could not prepare recovery because {rel} is no longer in {MISC_VPK}.")
                })?;
                if u64::from(entry.length) > MAX_ENTRY_BACKUP_BYTES {
                    return Err(format!(
                        "Could not prepare recovery because {rel} exceeds the {} MiB particle snapshot limit.",
                        MAX_ENTRY_BACKUP_BYTES / (1024 * 1024)
                    ));
                }
                let contents = read_vpk_entry(&vpk_path, entry)
                    .map_err(|err| format!("Could not back up {rel}: {}", err.message()))?;
                let backup_name = format!("entry-{}", sha256_hex(rel.as_bytes()));
                let file =
                    capture_bytes(data_dir, &backup_name, &contents, &mut files, &mut bytes)?;
                entry_backups.push(EntryBackup {
                    rel: rel.clone(),
                    location: EntryLocationIdentity::from_location(entry),
                    file,
                });
            }

            let intent = TransactionIntent {
                schema: TRANSACTION_SCHEMA,
                tf2_root: canonical_root(tf2_root)?,
                phase: TransactionPhase::Prepared,
                state,
                gameinfo_backup,
                gameinfo,
                custom_vpk,
                originals_dir_existed,
                originals: original_backups,
                entries: entry_backups,
            };
            write_intent(data_dir, &intent)?;
            Ok(intent)
        })();

        match captured {
            Ok(intent) => Ok(Self {
                data_dir: data_dir.to_path_buf(),
                intent,
            }),
            Err(error) => {
                let _ = clear_transaction_dir(data_dir);
                Err(error)
            }
        }
    }

    pub(crate) fn rollback(
        &self,
        running_names: &[String],
        process_sampler: &dyn Fn() -> Vec<String>,
    ) -> Result<(), String> {
        rollback_intent(&self.data_dir, &self.intent, running_names, process_sampler)?;
        clear_transaction_dir(&self.data_dir)
    }

    pub(crate) fn commit(&mut self) -> Result<(), TransactionCommitError> {
        self.intent.phase = TransactionPhase::Committed;
        if let Err(write_error) = write_intent(&self.data_dir, &self.intent) {
            match load_intent(&self.data_dir) {
                Ok(Some(on_disk)) if same_transaction(&on_disk, &self.intent) => {
                    if on_disk.phase == TransactionPhase::Committed {
                        // The atomic rename published the commit marker and
                        // only its post-rename durability acknowledgement
                        // failed. Rolling back now would conflict with the
                        // durable Committed marker if that rollback stopped.
                    } else {
                        self.intent.phase = TransactionPhase::Prepared;
                        return Err(TransactionCommitError {
                            message: write_error,
                            rollback_safe: true,
                        });
                    }
                }
                Ok(_) => {
                    return Err(TransactionCommitError {
                        message: format!(
                            "{write_error}; the on-disk recovery marker no longer identifies this transaction"
                        ),
                        rollback_safe: false,
                    });
                }
                Err(read_error) => {
                    return Err(TransactionCommitError {
                        message: format!(
                            "{write_error}; could not determine whether the commit marker was published ({read_error})"
                        ),
                        rollback_safe: false,
                    });
                }
            }
        }
        // A committed journal is harmless. Cleanup is best effort so a
        // postcommit antivirus/sharing failure never turns success into an
        // invitation to retry the already-applied selection.
        let _ = clear_transaction_dir(&self.data_dir);
        Ok(())
    }
}

fn same_transaction(left: &TransactionIntent, right: &TransactionIntent) -> bool {
    let mut left = left.clone();
    let mut right = right.clone();
    left.phase = TransactionPhase::Prepared;
    right.phase = TransactionPhase::Prepared;
    left == right
}

fn validate_intent_root(tf2_root: &Path, intent: &TransactionIntent) -> Result<(), String> {
    if intent.tf2_root != canonical_root(tf2_root)? {
        return Err("The pending preloader recovery belongs to a different TF2 folder.".into());
    }
    Ok(())
}

/// Inspect the durable journal without repairing or deleting it. Callers must
/// treat errors and every non-`None` status as a closed write boundary; only a
/// preloader recovery or the explicit Steam-repair workflow may proceed.
pub fn preloader_transaction_status(
    tf2_root: &Path,
    data_dir: &Path,
) -> Result<PreloaderTransactionStatus, String> {
    match load_intent(data_dir)? {
        Some(intent) => {
            validate_intent_root(tf2_root, &intent)?;
            Ok(match intent.phase {
                TransactionPhase::Prepared => PreloaderTransactionStatus::Prepared,
                TransactionPhase::Committed => PreloaderTransactionStatus::CommittedCleanup,
            })
        }
        None if app_dir_within(data_dir, &transaction_dir(data_dir), false)? => {
            Ok(PreloaderTransactionStatus::CommittedCleanup)
        }
        None => Ok(PreloaderTransactionStatus::None),
    }
}

/// Authorize Steam verification as the only escape from a Prepared journal
/// whose official archive mapping no longer permits exact rollback. Backups
/// are fully validated before Steam is opened, and a Prepared marker is never
/// cleared here: cancel/failure therefore keeps every ordinary write locked.
pub fn prepare_preloader_steam_repair(tf2_root: &Path, data_dir: &Path) -> Result<bool, String> {
    match preloader_transaction_status(tf2_root, data_dir)? {
        PreloaderTransactionStatus::None => Ok(false),
        PreloaderTransactionStatus::CommittedCleanup => {
            clear_transaction_dir(data_dir)?;
            Ok(false)
        }
        PreloaderTransactionStatus::Prepared => {
            let intent = load_intent(data_dir)?.ok_or_else(|| {
                "The pending preloader recovery journal disappeared during inspection.".to_string()
            })?;
            validate_all_backup_digests(data_dir, &intent)?;
            Ok(true)
        }
    }
}

/// Complete the explicit Steam-repair escape. Steam owns the current official
/// bytes, so every journal-touched particle must match its *current* directory
/// CRC and gameinfo must be pristine before any app-owned data is reconciled.
/// On every refusal or write error the Prepared marker remains for a retry.
pub fn reconcile_preloader_after_steam_repair(
    tf2_root: &Path,
    data_dir: &Path,
    running_names: &[String],
) -> Result<bool, String> {
    reconcile_preloader_after_steam_repair_with_sampler(
        tf2_root,
        data_dir,
        running_names,
        &crate::process_lock::live_process_names,
    )
}

pub fn reconcile_preloader_after_steam_repair_with_sampler(
    tf2_root: &Path,
    data_dir: &Path,
    running_names: &[String],
    process_sampler: &dyn Fn() -> Vec<String>,
) -> Result<bool, String> {
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    let status = preloader_transaction_status(tf2_root, data_dir)?;
    if status == PreloaderTransactionStatus::None {
        return Ok(false);
    }
    if status == PreloaderTransactionStatus::CommittedCleanup {
        clear_transaction_dir(data_dir)?;
        return Ok(true);
    }
    let intent = load_intent(data_dir)?.ok_or_else(|| {
        "The pending preloader recovery journal disappeared during reconciliation.".to_string()
    })?;
    validate_intent_root(tf2_root, &intent)?;
    validate_all_backup_digests(data_dir, &intent)?;
    preflight_restore_destinations(data_dir, tf2_root, &intent)?;

    let mut old_state = if intent.state.existed {
        serde_json::from_slice::<PreloaderState>(&read_backup(data_dir, &intent.state)?)
            .map_err(|err| format!("Could not parse the journaled preloader state: {err}"))?
    } else {
        PreloaderState::default()
    };
    let saved_rels: BTreeSet<&str> = intent
        .entries
        .iter()
        .map(|entry| entry.rel.as_str())
        .collect();
    if old_state
        .patched
        .keys()
        .any(|rel| !saved_rels.contains(rel.as_str()))
    {
        return Err(
            "The journaled preloader state names a particle without a recovery record.".into(),
        );
    }

    let vpk_path = tf2_root.join("tf").join(MISC_VPK);
    let entries = map_vpk_entries(&vpk_path)
        .map_err(|err| format!("Could not verify repaired {MISC_VPK}: {}", err.message()))?;
    let mut refreshed_snapshots = Vec::new();
    for saved in &intent.entries {
        let entry = entries.get(&saved.rel).ok_or_else(|| {
            format!(
                "Steam has not restored {} in the current {MISC_VPK}; the preloader recovery remains pending.",
                saved.rel
            )
        })?;
        let bytes = read_particle_entry_bounded(&vpk_path, entry)?;
        if !is_stock(&bytes, entry) {
            return Err(format!(
                "Steam has not restored {} to its current stock bytes; the preloader recovery remains pending.",
                saved.rel
            ));
        }
        if old_state.patched.contains_key(&saved.rel) {
            refreshed_snapshots.push((saved.rel.clone(), bytes));
        }
    }
    require_pristine_gameinfo(tf2_root)?;

    let before_write =
        || refuse_if_running_among(process_sampler()).map_err(|err| err.message().to_string());
    restore_live_file(
        data_dir,
        tf2_root,
        &tf2_root.join("tf").join("custom").join(PRELOADER_VPK),
        &intent.custom_vpk,
        &before_write,
    )?;
    restore_originals(data_dir, &intent)?;
    restore_app_file(
        data_dir,
        &gameinfo_backup_path(data_dir),
        &intent.gameinfo_backup,
    )?;

    for (rel, bytes) in refreshed_snapshots {
        write_snapshot(data_dir, &rel, &bytes, true)?;
        let patched = old_state.patched.get_mut(&rel).ok_or_else(|| {
            "The journaled preloader state changed during reconciliation.".to_string()
        })?;
        patched.original_sha256 = sha256_hex(&bytes);
        patched.patched_sha256.clear();
        patched.rel.clone_from(&rel);
        patched.pristine = true;
    }
    old_state.vpk_len = vpk_fingerprint(&vpk_path)?;
    save_state(data_dir, &old_state)?;
    clear_transaction_dir(data_dir)?;
    Ok(true)
}

fn rollback_intent(
    data_dir: &Path,
    intent: &TransactionIntent,
    running_names: &[String],
    process_sampler: &dyn Fn() -> Vec<String>,
) -> Result<(), String> {
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    validate_intent_budgets(intent)?;
    validate_all_backup_digests(data_dir, intent)?;
    preflight_restore_destinations(data_dir, &intent.tf2_root, intent)?;
    let tf2_root = &intent.tf2_root;
    let vpk_path = tf2_root.join("tf").join(MISC_VPK);
    let entries = map_vpk_entries(&vpk_path)
        .map_err(|err| format!("Could not recover preloader patches: {}", err.message()))?;
    // Validate the complete official-file mapping before the first recovery
    // write. Steam may have updated the archive after a crash; matching only
    // the entry's path and length could plant old stock bytes into a new
    // archive version whose content or physical location changed.
    let mut observed_entries = BTreeMap::new();
    for saved in &intent.entries {
        let entry = entries.get(&saved.rel).ok_or_else(|| {
            format!(
                "Could not recover {} because TF2's archive changed.",
                saved.rel
            )
        })?;
        if !saved.location.matches(entry) {
            return Err(format!(
                "Could not recover {} because TF2's archive mapping changed; verify game files before retrying recovery.",
                saved.rel
            ));
        }
        observed_entries.insert(
            saved.rel.clone(),
            read_particle_entry_bounded(&vpk_path, entry)
                .map_err(|err| format!("Could not preflight {}: {err}", saved.rel))?,
        );
    }
    let before_write =
        || refuse_if_running_among(process_sampler()).map_err(|err| err.message().to_string());
    for saved in &intent.entries {
        if !saved.rel.starts_with("particles/") || !saved.rel.ends_with(".pcf") {
            return Err("The preloader recovery journal contains an invalid particle path.".into());
        }
        let entry = entries.get(&saved.rel).ok_or_else(|| {
            format!(
                "Could not recover {} because TF2's archive changed.",
                saved.rel
            )
        })?;
        let bytes = read_backup(data_dir, &saved.file)?;
        let current = observed_entries.get(&saved.rel).ok_or_else(|| {
            format!(
                "Could not recover {} because its preflight was lost.",
                saved.rel
            )
        })?;
        before_write()?;
        patch_vpk_entry_if_unchanged(&vpk_path, entry, Some(current), &bytes, || {
            before_write().map_err(VpkError)
        })
        .map_err(|err| format!("Could not recover {}: {}", saved.rel, err.message()))?;
    }

    restore_live_file(
        data_dir,
        tf2_root,
        &gameinfo_path(tf2_root),
        &intent.gameinfo,
        &before_write,
    )?;
    restore_live_file(
        data_dir,
        tf2_root,
        &tf2_root.join("tf").join("custom").join(PRELOADER_VPK),
        &intent.custom_vpk,
        &before_write,
    )?;
    restore_originals(data_dir, intent)?;
    restore_app_file(
        data_dir,
        &gameinfo_backup_path(data_dir),
        &intent.gameinfo_backup,
    )?;
    // Logical metadata is last: once the old state is visible, every live and
    // recovery byte it names has already been restored.
    restore_app_file(data_dir, &state_path(data_dir), &intent.state)
}

pub(crate) fn recover_preloader_transaction(
    tf2_root: &Path,
    data_dir: &Path,
    running_names: &[String],
    process_sampler: &dyn Fn() -> Vec<String>,
) -> Result<bool, String> {
    let Some(intent) = load_intent(data_dir)? else {
        if app_dir_within(data_dir, &transaction_dir(data_dir), false)? {
            // Intent is published last, so an uncommitted backup-only folder
            // proves no live mutation began.
            clear_transaction_dir(data_dir)?;
        }
        return Ok(false);
    };
    validate_intent_root(tf2_root, &intent)?;
    if intent.phase == TransactionPhase::Committed {
        clear_transaction_dir(data_dir)?;
        return Ok(true);
    }
    rollback_intent(data_dir, &intent, running_names, process_sampler)?;
    clear_transaction_dir(data_dir)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_budget_allows_every_backup_plus_the_intent_only() {
        assert!(validate_transaction_file_count(MAX_BACKUP_FILES + 1).is_ok());
        assert!(validate_transaction_file_count(MAX_BACKUP_FILES + 2).is_err());
    }
}
