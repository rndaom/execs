//! Explicit recovery and cleanup of historical HUD copies. Discovery never
//! follows links, and actions bind to the exact bytes displayed in Storage.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::hash::{
    copy_and_sha256_within, create_dir_all_within, metadata_is_link, move_dir_no_replace_within,
    random_token, remove_dir_within, remove_file_force_within, remove_tree_within,
    sha256_file_exact, sha256_hex, validate_dir_within, validate_file_within,
};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    normalize_rel_path, profile_mutation_status_to, ProfileError, ProfileManifest,
    ProfileMutationRecoveryState,
};
use crate::surface::HUD_BACKUP_CONTAINER;

const MAX_ENTRIES: usize = 100_000;
const MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudBackup {
    pub id: String,
    pub name: String,
    pub location: String,
    /// Legacy copies have no creation receipt. This is the newest file date.
    pub modified_at: Option<u64>,
    pub bytes: u64,
    pub files: usize,
    pub revision: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudBackupReport {
    pub backups: Vec<HudBackup>,
    pub unreadable: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct BackupFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Snapshot {
    pub files: Vec<BackupFile>,
    directories: Vec<String>,
    pub bytes: u64,
    modified_at: Option<u64>,
}

fn io(error: impl std::fmt::Display) -> ProfileError {
    ProfileError::Io(error.to_string())
}

impl Snapshot {
    pub(crate) fn revision(&self) -> String {
        // Dates are display metadata, never an integrity substitute.
        sha256_hex(&serde_json::to_vec(&(&self.files, &self.directories)).unwrap_or_default())
    }
}

fn backup_revision(folder: &Path, data: &Snapshot) -> String {
    sha256_hex(format!("{}\n{}", folder.to_string_lossy(), data.revision()).as_bytes())
}

pub(crate) fn snapshot(root: &Path, folder: &Path) -> Result<Snapshot, ProfileError> {
    validate_dir_within(root, folder).map_err(io)?;
    let mut snapshot = Snapshot {
        files: Vec::new(),
        directories: Vec::new(),
        bytes: 0,
        modified_at: None,
    };
    let mut pending = vec![(folder.to_path_buf(), 0)];
    let mut keys = BTreeSet::new();
    while let Some((directory, depth)) = pending.pop() {
        if depth > 32 {
            return Err(io("HUD backup is nested too deeply to inspect safely."));
        }
        validate_dir_within(root, &directory).map_err(io)?;
        for entry in fs::read_dir(&directory).map_err(io)? {
            let entry = entry.map_err(io)?;
            let path = entry.path();
            let relative = path
                .strip_prefix(folder)
                .map_err(io)?
                .to_str()
                .ok_or_else(|| io("HUD backup contains an unreadable filename."))?
                .replace('\\', "/");
            let normalized = normalize_rel_path(&relative)?;
            if normalized != relative || !keys.insert(relative.to_ascii_lowercase()) {
                return Err(io("HUD backup contains ambiguous filenames."));
            }
            if keys.len() > MAX_ENTRIES {
                return Err(io("HUD backup has too many entries to inspect safely."));
            }
            let metadata = fs::symlink_metadata(&path).map_err(io)?;
            if metadata_is_link(&metadata) {
                return Err(io("HUD backup contains a link; its files were kept."));
            }
            if metadata.is_dir() {
                snapshot.directories.push(relative);
                pending.push((path, depth + 1));
            } else if metadata.is_file() {
                snapshot.bytes = snapshot.bytes.saturating_add(metadata.len());
                if snapshot.bytes > MAX_BYTES {
                    return Err(io("HUD backup exceeds the safe inspection size."));
                }
                validate_file_within(root, &path).map_err(io)?;
                let sha256 = sha256_file_exact(&path, metadata.len()).map_err(io)?;
                snapshot.modified_at = snapshot.modified_at.max(
                    metadata
                        .modified()
                        .ok()
                        .and_then(|date| date.duration_since(UNIX_EPOCH).ok())
                        .map(|date| date.as_secs()),
                );
                snapshot.files.push(BackupFile {
                    path: relative,
                    bytes: metadata.len(),
                    sha256,
                });
            } else {
                return Err(io(
                    "HUD backup contains a special file; its files were kept.",
                ));
            }
        }
    }
    snapshot.files.sort_by(|a, b| a.path.cmp(&b.path));
    snapshot.directories.sort();
    Ok(snapshot)
}

fn token(value: &str) -> bool {
    // Both historical UUID tokens and content-addressed library copies.
    (value.len() == 32 || value.len() == 36 || value.len() == 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

/// Where HUD backups moved out of TF2's folder live: `<data dir>/hud-backups`.
pub const DATA_BACKUP_DIR: &str = "hud-backups";

fn data_root(profiles: &Path) -> &Path {
    profiles.parent().unwrap_or(profiles)
}

fn resolve(profiles: &Path, root: &Path, id: &str) -> Result<(PathBuf, PathBuf), ProfileError> {
    let parts: Vec<_> = id.split('/').collect();
    match parts.as_slice() {
        ["data", generation, name] if token(generation) && normalize_rel_path(name)? == *name => {
            if name.is_empty() || name.contains(['/', '\\']) {
                return Err(ProfileError::InvalidPath);
            }
            let data = data_root(profiles);
            Ok((
                data.to_path_buf(),
                data.join(DATA_BACKUP_DIR).join(generation).join(name),
            ))
        }
        ["live", generation, name] if token(generation) && normalize_rel_path(name)? == *name => {
            if name.is_empty() || name.contains(['/', '\\']) {
                return Err(ProfileError::InvalidPath);
            }
            Ok((
                root.to_path_buf(),
                root.join("tf/custom")
                    .join(HUD_BACKUP_CONTAINER)
                    .join(generation)
                    .join(name),
            ))
        }
        ["library", profile, generation]
            if uuid::Uuid::parse_str(profile).is_ok() && token(generation) =>
        {
            Ok((
                profiles.to_path_buf(),
                profiles.join(profile).join("hud-backups").join(generation),
            ))
        }
        _ => Err(ProfileError::InvalidPath),
    }
}

fn directories(root: &Path, directory: &Path) -> Result<Vec<String>, ProfileError> {
    match fs::symlink_metadata(directory) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io(error)),
        Ok(_) => validate_dir_within(root, directory).map_err(io)?,
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(directory).map_err(io)? {
        let entry = entry.map_err(io)?;
        if names.len() >= MAX_ENTRIES {
            return Err(io("Too many HUD recovery folders."));
        }
        let meta = fs::symlink_metadata(entry.path()).map_err(io)?;
        if metadata_is_link(&meta) {
            return Err(io("A HUD recovery folder contains a link."));
        }
        if meta.is_dir() {
            names.push(
                entry
                    .file_name()
                    .into_string()
                    .map_err(|_| io("Unreadable HUD recovery folder name."))?,
            );
        }
    }
    names.sort();
    Ok(names)
}

pub fn list_hud_backups_to(profiles: &Path, root: &Path) -> Result<HudBackupReport, ProfileError> {
    let mut result = HudBackupReport {
        backups: Vec::new(),
        unreadable: Vec::new(),
    };
    let mut candidates = Vec::new();
    let live = root.join("tf/custom").join(HUD_BACKUP_CONTAINER);
    match directories(root, &live) {
        Ok(generations) => {
            for generation in generations.into_iter().filter(|name| token(name)) {
                match directories(root, &live.join(&generation)) {
                    Ok(names) => {
                        for name in names {
                            candidates.push((
                                format!("live/{generation}/{name}"),
                                name,
                                "TF2 folder",
                            ));
                        }
                    }
                    Err(_) => result.unreadable.push(format!("TF2 backup {generation}")),
                }
            }
        }
        Err(_) => result.unreadable.push("TF2 HUD backups".into()),
    }
    let data = data_root(profiles).join(DATA_BACKUP_DIR);
    match directories(data_root(profiles), &data) {
        Ok(generations) => {
            for generation in generations.into_iter().filter(|name| token(name)) {
                match directories(data_root(profiles), &data.join(&generation)) {
                    Ok(names) => {
                        for name in names.into_iter().filter(|name| !name.starts_with('.')) {
                            candidates.push((
                                format!("data/{generation}/{name}"),
                                name,
                                "execs data",
                            ));
                        }
                    }
                    Err(_) => result
                        .unreadable
                        .push(format!("execs data backup {generation}")),
                }
            }
        }
        Err(_) => result.unreadable.push("execs data HUD backups".into()),
    }
    for profile in directories(profiles, profiles)?
        .into_iter()
        .filter(|name| uuid::Uuid::parse_str(name).is_ok())
    {
        match directories(profiles, &profiles.join(&profile).join("hud-backups")) {
            Ok(generations) => {
                for generation in generations.into_iter().filter(|name| token(name)) {
                    let folder = profiles
                        .join(&profile)
                        .join("hud-backups")
                        .join(&generation)
                        .join("files/tf/custom");
                    let name = directories(profiles, &folder)
                        .unwrap_or_default()
                        .join(", ");
                    candidates.push((
                        format!("library/{profile}/{generation}"),
                        if name.is_empty() {
                            "HUD recovery files".into()
                        } else {
                            name
                        },
                        "Profile library",
                    ));
                }
            }
            Err(_) => result.unreadable.push(format!("Profile {profile}")),
        }
    }
    for (id, name, location) in candidates {
        match resolve(profiles, root, &id)
            .and_then(|(base, folder)| snapshot(&base, &folder).map(|data| (folder, data)))
        {
            Ok((folder, data)) => result.backups.push(HudBackup {
                id,
                name,
                location: location.into(),
                modified_at: data.modified_at,
                bytes: data.bytes,
                files: data.files.len(),
                revision: backup_revision(&folder, &data),
            }),
            Err(_) => result.unreadable.push(name),
        }
    }
    result.backups.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(result)
}

fn ready(profiles: &Path, root: &Path, running: &[String]) -> Result<(), ProfileError> {
    refuse_if_running_among(running)?;
    refuse_if_running_among(live_process_names())?;
    if profile_mutation_status_to(profiles, root)? != ProfileMutationRecoveryState::Clean {
        return Err(io("Finish profile recovery before changing HUD backups."));
    }
    Ok(())
}

fn reviewed(
    profiles: &Path,
    root: &Path,
    id: &str,
    revision: &str,
) -> Result<(PathBuf, PathBuf, Snapshot), ProfileError> {
    let (base, folder) = resolve(profiles, root, id)?;
    let data = snapshot(&base, &folder)?;
    if backup_revision(&folder, &data) != revision {
        return Err(io(
            "This HUD backup changed. Refresh Storage and review it again.",
        ));
    }
    Ok((base, folder, data))
}

pub fn delete_hud_backup_to(
    profiles: &Path,
    root: &Path,
    id: &str,
    revision: &str,
    running: &[String],
) -> Result<(), ProfileError> {
    ready(profiles, root, running)?;
    let (base, folder, data) = reviewed(profiles, root, id, revision)?;
    for file in &data.files {
        refuse_if_running_among(live_process_names())?;
        let path = folder.join(&file.path);
        validate_file_within(&base, &path).map_err(io)?;
        if sha256_file_exact(&path, file.bytes).map_err(io)? != file.sha256 {
            return Err(io(
                "A HUD backup file changed during cleanup; remaining files were kept.",
            ));
        }
        remove_file_force_within(&base, &path).map_err(io)?;
    }
    for directory in data.directories.iter().rev() {
        refuse_if_running_among(live_process_names())?;
        remove_dir_within(&base, &folder.join(directory)).map_err(io)?;
    }
    remove_dir_within(&base, &folder).map_err(io)
}

/// The files one backup holds, keyed as the profile paths they came from
/// (`tf/custom/<hud>/…`), for comparing with what profiles still own.
/// Library backup metadata outside `files/` is not a HUD file and is skipped.
pub(crate) fn backup_profile_paths(
    profiles: &Path,
    root: &Path,
    id: &str,
) -> Result<Vec<(String, String)>, ProfileError> {
    let (base, folder) = resolve(profiles, root, id)?;
    let data = snapshot(&base, &folder)?;
    let prefix = match id.split('/').next() {
        Some("live" | "data") => {
            let name = id.rsplit('/').next().unwrap_or_default();
            format!("tf/custom/{name}/")
        }
        _ => String::new(),
    };
    Ok(data
        .files
        .into_iter()
        .filter_map(|file| {
            let path = if prefix.is_empty() {
                file.path.strip_prefix("files/")?.to_string()
            } else {
                format!("{prefix}{}", file.path)
            };
            Some((path, file.sha256))
        })
        .collect())
}

/// Move a backup out of TF2's `custom` folder into execs data, where TF2 never
/// scans it, keeping every byte for Storage's Restore and Delete. The copy is
/// verified and published before the TF2 copy is removed; the new id is returned.
pub fn move_live_hud_backup_to_data(
    profiles: &Path,
    root: &Path,
    id: &str,
    revision: &str,
    running: &[String],
) -> Result<String, ProfileError> {
    let ["live", generation, name] = id.split('/').collect::<Vec<_>>()[..] else {
        return Err(ProfileError::InvalidPath);
    };
    ready(profiles, root, running)?;
    let (base, folder, data) = reviewed(profiles, root, id, revision)?;
    let data_dir = data_root(profiles).to_path_buf();
    let parent = data_dir.join(DATA_BACKUP_DIR).join(generation);
    create_dir_all_within(&data_dir, &parent).map_err(io)?;
    // A move cut off earlier leaves only its unpublished staging folder.
    for entry in fs::read_dir(&parent).map_err(io)?.flatten() {
        if entry.file_name().to_string_lossy().starts_with(".moving-") {
            let _ = remove_tree_within(&data_dir, &entry.path());
        }
    }
    let destination = parent.join(name);
    if fs::symlink_metadata(&destination).is_ok() {
        return Err(io("A moved copy of this HUD backup already exists."));
    }
    let staged = parent.join(format!(".moving-{}", random_token()));
    fs::create_dir(&staged).map_err(io)?;
    let copied = (|| {
        for directory in &data.directories {
            fs::create_dir(staged.join(directory)).map_err(io)?;
        }
        for file in &data.files {
            refuse_if_running_among(live_process_names())?;
            let source = folder.join(&file.path);
            validate_file_within(&base, &source).map_err(io)?;
            let hash =
                copy_and_sha256_within(&data_dir, &source, &staged.join(&file.path)).map_err(io)?;
            if hash != file.sha256 {
                return Err(io(
                    "A HUD backup file changed while it was moved; it was kept in TF2's folder.",
                ));
            }
        }
        move_dir_no_replace_within(&data_dir, &staged, &destination).map_err(io)
    })();
    if let Err(error) = copied {
        let _ = remove_tree_within(&data_dir, &staged);
        return Err(error);
    }
    // The verified copy is published; now the TF2 copy can go.
    delete_hud_backup_to(profiles, root, id, revision, running)?;
    let generation_dir = folder.parent().unwrap_or(&folder);
    if fs::read_dir(generation_dir).is_ok_and(|mut entries| entries.next().is_none()) {
        let _ = remove_dir_within(root, generation_dir);
    }
    Ok(format!("data/{generation}/{name}"))
}

/// Copy all bytes (including unknown/junk files) to a new ordinary directory.
/// No restored payload is mounted automatically, and the source stays intact.
pub fn restore_hud_backup_to(
    profiles: &Path,
    root: &Path,
    id: &str,
    revision: &str,
    parent: &Path,
    running: &[String],
) -> Result<PathBuf, ProfileError> {
    ready(profiles, root, running)?;
    let (base, folder, data) = reviewed(profiles, root, id, revision)?;
    // The picker selects an existing parent, never a path where bytes may be overwritten.
    validate_dir_within(parent, parent).map_err(io)?;
    let parent = fs::canonicalize(parent).map_err(io)?;
    let game = fs::canonicalize(root).map_err(io)?;
    let data_root = fs::canonicalize(profiles.parent().unwrap_or(profiles)).map_err(io)?;
    if parent.starts_with(&game) || parent.starts_with(&data_root) {
        return Err(io(
            "Choose a recovery folder outside TF2 and execs app data.",
        ));
    }
    let generation = random_token();
    let staged = parent.join(format!(".execs-hud-recovery-{generation}"));
    let destination = parent.join(format!("hud-recovery-{generation}"));
    fs::create_dir(&staged).map_err(io)?;
    let result = (|| {
        for directory in &data.directories {
            refuse_if_running_among(live_process_names())?;
            let target = staged.join(directory);
            validate_dir_within(&parent, target.parent().ok_or(ProfileError::InvalidPath)?)
                .map_err(io)?;
            fs::create_dir(&target).map_err(io)?;
        }
        for file in &data.files {
            refuse_if_running_among(live_process_names())?;
            let source = folder.join(&file.path);
            validate_file_within(&base, &source).map_err(io)?;
            let hash =
                copy_and_sha256_within(&parent, &source, &staged.join(&file.path)).map_err(io)?;
            if hash != file.sha256 {
                return Err(io(
                    "HUD backup changed during recovery. No recovery folder was published.",
                ));
            }
        }
        reviewed(profiles, root, id, revision)?;
        ready(profiles, root, running)?;
        move_dir_no_replace_within(&parent, &staged, &destination).map_err(io)?;
        Ok(destination.clone())
    })();
    if result.is_err() {
        let _ = remove_tree_within(&parent, &staged);
    }
    result
}

/// Only an exact, fully owned live tree can skip the extra game-side copy.
pub(crate) fn owned_live_tree_revision(
    profiles: &Path,
    root: &Path,
    manifest: &ProfileManifest,
    relative: &str,
) -> Result<Option<String>, ProfileError> {
    let data = snapshot(root, &root.join(relative))?;
    if data.files.is_empty() {
        return Ok(None);
    }
    let path_key = |path: &str| {
        if cfg!(windows) {
            path.to_ascii_lowercase()
        } else {
            path.to_owned()
        }
    };
    let owned_files: BTreeMap<_, _> = manifest
        .files
        .iter()
        .map(|file| (path_key(&file.path), file))
        .collect();
    for file in &data.files {
        let path = format!("{relative}/{}", file.path);
        let Some(owned) = owned_files.get(&path_key(&path)) else {
            return Ok(None);
        };
        if owned.sha256 != file.sha256 {
            return Ok(None);
        }
        let saved = crate::profile::exclusive_file_path(profiles, &manifest.id, &owned.path);
        validate_file_within(profiles, &saved).map_err(io)?;
        if sha256_file_exact(&saved, file.bytes).map_err(io)? != file.sha256 {
            return Ok(None);
        }
    }
    Ok(Some(data.revision()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, PathBuf, PathBuf, PathBuf, String) {
        let area = crate::test_temp_dir();
        let profiles = area.join("data/profiles");
        let root = area.join("game");
        let output = area.join("recovered");
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::create_dir_all(&output).unwrap();
        crate::profile::create_profile_record_to(&profiles, &root, "Main", Vec::<String>::new())
            .unwrap();
        let generation = random_token();
        let folder = root
            .join("tf/custom")
            .join(HUD_BACKUP_CONTAINER)
            .join(&generation)
            .join("My HUD");
        fs::create_dir_all(folder.join("resource/empty")).unwrap();
        fs::write(folder.join("info.vdf"), b"\"HUD\" { \"ui_version\" \"3\" }").unwrap();
        fs::write(folder.join("resource/layout.res"), [0xff, 0, 0x80]).unwrap();
        fs::write(
            folder.join("unfinished.execs-part"),
            b"unique untracked bytes",
        )
        .unwrap();
        (
            area,
            profiles,
            root,
            output,
            format!("live/{generation}/My HUD"),
        )
    }

    #[test]
    fn lists_both_locations_and_recovers_every_byte_without_mounting_or_deleting() {
        let (area, profiles, root, output, id) = fixture();
        let profile = crate::profile::load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles[0]
            .id
            .clone();
        let library_backup = profiles
            .join(profile)
            .join("hud-backups")
            .join(random_token());
        fs::create_dir_all(library_backup.join("files/tf/custom/old-hud")).unwrap();
        fs::write(
            library_backup.join("files/tf/custom/old-hud/info.vdf"),
            b"original",
        )
        .unwrap();
        let report = list_hud_backups_to(&profiles, &root).unwrap();
        assert!(report.unreadable.is_empty());
        assert_eq!(report.backups.len(), 2);
        let backup = report
            .backups
            .iter()
            .find(|backup| backup.id == id)
            .unwrap();
        assert_eq!(backup.name, "My HUD");
        assert!(backup.modified_at.is_some());
        assert_eq!(backup.files, 3);
        assert!(report
            .backups
            .iter()
            .any(|backup| backup.name == "old-hud" && backup.location == "Profile library"));
        let restored =
            restore_hud_backup_to(&profiles, &root, &id, &backup.revision, &output, &[]).unwrap();
        assert_eq!(
            fs::read(restored.join("resource/layout.res")).unwrap(),
            [0xff, 0, 0x80]
        );
        assert_eq!(
            fs::read(restored.join("unfinished.execs-part")).unwrap(),
            b"unique untracked bytes"
        );
        assert!(restored.join("resource/empty").is_dir());
        assert!(!root.join("tf/custom/My HUD").exists());
        assert_eq!(
            list_hud_backups_to(&profiles, &root).unwrap().backups.len(),
            2
        );
        delete_hud_backup_to(&profiles, &root, &id, &backup.revision, &[]).unwrap();
        assert_eq!(
            list_hud_backups_to(&profiles, &root).unwrap().backups.len(),
            1
        );
        assert!(restored.join("info.vdf").is_file());
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn stale_reviews_running_game_and_managed_destinations_refuse_without_mutation() {
        let (area, profiles, root, output, id) = fixture();
        let backup = list_hud_backups_to(&profiles, &root)
            .unwrap()
            .backups
            .remove(0);
        let (_, folder) = resolve(&profiles, &root, &id).unwrap();
        for destination in [&root, profiles.parent().unwrap()] {
            assert!(restore_hud_backup_to(
                &profiles,
                &root,
                &id,
                &backup.revision,
                destination,
                &[]
            )
            .is_err());
        }
        let running = vec!["tf_win64.exe".into()];
        assert!(delete_hud_backup_to(&profiles, &root, &id, &backup.revision, &running).is_err());
        assert!(
            restore_hud_backup_to(&profiles, &root, &id, &backup.revision, &output, &running)
                .is_err()
        );
        fs::write(folder.join("info.vdf"), b"outside edit").unwrap();
        assert!(
            delete_hud_backup_to(&profiles, &root, &id, &backup.revision, &[])
                .unwrap_err()
                .message()
                .contains("changed")
        );
        assert!(
            restore_hud_backup_to(&profiles, &root, &id, &backup.revision, &output, &[]).is_err()
        );
        assert_eq!(fs::read(folder.join("info.vdf")).unwrap(), b"outside edit");
        assert_eq!(fs::read_dir(output).unwrap().count(), 0);
        assert!(resolve(&profiles, &root, "live/../../other").is_err());
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn review_revision_belongs_to_its_install() {
        let (area, profiles, root, _output, id) = fixture();
        let backup = list_hud_backups_to(&profiles, &root)
            .unwrap()
            .backups
            .remove(0);
        let (_, folder) = resolve(&profiles, &root, &id).unwrap();
        let data = snapshot(&root, &folder).unwrap();
        assert_ne!(
            backup.revision,
            backup_revision(&area.join("another-install"), &data)
        );
        fs::remove_dir_all(area).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn linked_backup_descendants_are_reported_and_never_followed() {
        let (area, profiles, root, output, id) = fixture();
        let (_, folder) = resolve(&profiles, &root, &id).unwrap();
        let outside = output.join("outside");
        fs::write(&outside, b"keep").unwrap();
        std::os::unix::fs::symlink(&outside, folder.join("linked")).unwrap();
        let report = list_hud_backups_to(&profiles, &root).unwrap();
        assert!(report.backups.is_empty());
        assert_eq!(report.unreadable, ["My HUD"]);
        assert!(delete_hud_backup_to(&profiles, &root, &id, "anything", &[]).is_err());
        assert_eq!(fs::read(outside).unwrap(), b"keep");
        fs::remove_dir_all(area).unwrap();
    }
}
