//! Local restore points: a saved profile's native export kept in app data.
//!
//! A restore point is written with the same verified export that sharing
//! uses, so it carries every source byte the profile needs and nothing is
//! fetched again. Restoring imports it as a new, inactive profile through the
//! normal import path; the live TF2 folder is never touched until the player
//! switches to it. Recovery journals are separate and never pruned here.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::hash::{
    random_token, read_small_file_bounded, remove_file_force_within, validate_file_within,
    write_atomic_within,
};
use crate::profile::{load_library_from, ProfileError, ProfileLibrary};
use crate::profile_compare::{
    compare_sides, manifest_revision, saved_profile_side, ProfileComparison,
};
use crate::zip::{export_profile_to, import_profile_named_from, native_zip_compare_side};

pub const DEFAULT_KEEP_PER_PROFILE: u32 = 5;
pub const MAX_KEEP_PER_PROFILE: u32 = 20;
const DIR: &str = "restore-points";
const RETENTION_FILE: &str = "retention.json";
const MAX_METADATA_BYTES: usize = 64 * 1024;
const MAX_LABEL_CHARS: usize = 80;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePoint {
    pub id: String,
    pub profile_id: String,
    /// The profile's name when the point was saved; it survives deletion.
    pub profile_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Milliseconds since the Unix epoch, strictly increasing across points.
    pub created_at: u64,
    pub bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePointList {
    pub points: Vec<RestorePoint>,
    pub keep_per_profile: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Retention {
    keep_per_profile: u32,
}

fn io(err: impl ToString) -> ProfileError {
    ProfileError::Io(err.to_string())
}

fn points_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(DIR)
}

fn valid_point_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn zip_path(data_dir: &Path, id: &str) -> PathBuf {
    points_dir(data_dir).join(format!("{id}.zip"))
}

fn metadata_path(data_dir: &Path, id: &str) -> PathBuf {
    points_dir(data_dir).join(format!("{id}.json"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

pub fn keep_per_profile(data_dir: &Path) -> u32 {
    read_small_file_bounded(
        &points_dir(data_dir).join(RETENTION_FILE),
        MAX_METADATA_BYTES,
    )
    .ok()
    .and_then(|bytes| serde_json::from_slice::<Retention>(&bytes).ok())
    .map(|retention| retention.keep_per_profile.clamp(1, MAX_KEEP_PER_PROFILE))
    .unwrap_or(DEFAULT_KEEP_PER_PROFILE)
}

fn ensure_dir(data_dir: &Path) -> Result<PathBuf, ProfileError> {
    let dir = points_dir(data_dir);
    fs::create_dir_all(&dir).map_err(io)?;
    crate::hash::validate_dir_within(data_dir, &dir).map_err(io)?;
    Ok(dir)
}

fn read_point(data_dir: &Path, id: &str) -> Option<RestorePoint> {
    let path = metadata_path(data_dir, id);
    validate_file_within(data_dir, &path).ok()?;
    let bytes = read_small_file_bounded(&path, MAX_METADATA_BYTES).ok()?;
    let point: RestorePoint = serde_json::from_slice(&bytes).ok()?;
    (point.id == id && validate_file_within(data_dir, &zip_path(data_dir, id)).is_ok())
        .then_some(point)
}

/// Every complete restore point, newest first. A ZIP without metadata (an
/// interrupted save) is not listed and is removed by the next save.
pub fn list_restore_points(data_dir: &Path) -> Result<RestorePointList, ProfileError> {
    let mut points = Vec::new();
    if let Ok(entries) = fs::read_dir(points_dir(data_dir)) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(id) = name.strip_suffix(".json") {
                if valid_point_id(id) {
                    if let Some(point) = read_point(data_dir, id) {
                        points.push(point);
                    }
                }
            }
        }
    }
    points.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    Ok(RestorePointList {
        points,
        keep_per_profile: keep_per_profile(data_dir),
    })
}

fn remove_point_files(data_dir: &Path, id: &str) -> Result<(), ProfileError> {
    // Metadata first: a point without metadata is no longer listed.
    for path in [metadata_path(data_dir, id), zip_path(data_dir, id)] {
        match remove_file_force_within(data_dir, &path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(io(err)),
        }
    }
    Ok(())
}

/// Remove unlisted leftovers and the oldest points beyond the bound for one
/// profile. Failures leave files in place for the next attempt.
fn prune(data_dir: &Path, profile_id: &str, keep: u32) {
    if let Ok(entries) = fs::read_dir(points_dir(data_dir)) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let orphan = name
                .strip_suffix(".zip")
                .filter(|id| valid_point_id(id))
                .is_some_and(|id| !metadata_path(data_dir, id).exists())
                || (name.ends_with(".execs-part") && name.starts_with('.'));
            if orphan {
                let _ = remove_file_force_within(data_dir, &entry.path());
            }
        }
    }
    let Ok(list) = list_restore_points(data_dir) else {
        return;
    };
    for point in list
        .points
        .iter()
        .filter(|point| point.profile_id == profile_id)
        .skip(keep as usize)
    {
        let _ = remove_point_files(data_dir, &point.id);
    }
}

fn clean_label(label: Option<&str>) -> Result<Option<String>, ProfileError> {
    let Some(label) = label.map(str::trim).filter(|label| !label.is_empty()) else {
        return Ok(None);
    };
    if label.chars().count() > MAX_LABEL_CHARS || label.chars().any(char::is_control) {
        return Err(ProfileError::Io(
            "Use a short restore point name without control characters.".into(),
        ));
    }
    Ok(Some(label.to_string()))
}

/// Save a restore point of a saved profile. It reads the library only, so it
/// is allowed while TF2 runs; unabsorbed live edits are not included.
pub fn create_restore_point(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    label: Option<&str>,
) -> Result<RestorePoint, ProfileError> {
    let label = clean_label(label)?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let profile = library
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or(ProfileError::UnknownProfile)?;
    ensure_dir(data_dir)?;
    let id = random_token();
    let zip = zip_path(data_dir, &id);
    export_profile_to(profiles_dir, tf2_root, profile_id, &zip)?;
    // Retention keeps the newest points, so two saves never share a time.
    let latest = list_restore_points(data_dir)?
        .points
        .first()
        .map_or(0, |point| point.created_at);
    let point = RestorePoint {
        id: id.clone(),
        profile_id: profile_id.to_string(),
        profile_name: profile.name.clone(),
        label,
        created_at: now_ms().max(latest + 1),
        bytes: fs::metadata(&zip).map_err(io)?.len(),
    };
    let json = serde_json::to_vec_pretty(&point).map_err(io)?;
    if let Err(err) = write_atomic_within(data_dir, &metadata_path(data_dir, &id), &json) {
        let _ = remove_file_force_within(data_dir, &zip);
        return Err(io(err));
    }
    prune(data_dir, profile_id, keep_per_profile(data_dir));
    Ok(point)
}

pub fn set_keep_per_profile(data_dir: &Path, keep: u32) -> Result<RestorePointList, ProfileError> {
    if !(1..=MAX_KEEP_PER_PROFILE).contains(&keep) {
        return Err(ProfileError::Io(format!(
            "Keep between 1 and {MAX_KEEP_PER_PROFILE} restore points per profile."
        )));
    }
    ensure_dir(data_dir)?;
    let json = serde_json::to_vec_pretty(&Retention {
        keep_per_profile: keep,
    })
    .map_err(io)?;
    write_atomic_within(data_dir, &points_dir(data_dir).join(RETENTION_FILE), &json).map_err(io)?;
    let profiles: std::collections::BTreeSet<String> = list_restore_points(data_dir)?
        .points
        .into_iter()
        .map(|point| point.profile_id)
        .collect();
    for profile in profiles {
        prune(data_dir, &profile, keep);
    }
    list_restore_points(data_dir)
}

fn require_point(data_dir: &Path, id: &str) -> Result<RestorePoint, ProfileError> {
    if !valid_point_id(id) {
        return Err(ProfileError::Io("That restore point is not valid.".into()));
    }
    read_point(data_dir, id)
        .ok_or_else(|| ProfileError::Io("That restore point no longer exists.".into()))
}

pub fn delete_restore_point(data_dir: &Path, id: &str) -> Result<RestorePointList, ProfileError> {
    require_point(data_dir, id)?;
    remove_point_files(data_dir, id)?;
    list_restore_points(data_dir)
}

/// Read-only: the profile as saved now against its restore point. When the
/// profile has since been deleted, every restore-point item shows as added.
pub fn compare_restore_point(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    id: &str,
) -> Result<ProfileComparison, ProfileError> {
    let point = require_point(data_dir, id)?;
    let mut to = native_zip_compare_side(&zip_path(data_dir, id))?;
    to.id = point.id.clone();
    let (from, current_revision) =
        match saved_profile_side(profiles_dir, tf2_root, &point.profile_id) {
            Ok(side) => (side, manifest_revision(profiles_dir, &point.profile_id)?),
            Err(ProfileError::UnknownProfile) => (
                crate::profile_compare::CompareSide {
                    name: format!("{} (deleted)", point.profile_name),
                    ..Default::default()
                },
                String::new(),
            ),
            Err(err) => return Err(err),
        };
    Ok(compare_sides(
        &from,
        &to,
        format!("{}{current_revision}", point.id),
        None,
    ))
}

/// Import the restore point as a new inactive profile named `name`. The
/// normal import validation, stock-built rebuild check and write lock apply.
pub fn restore_restore_point<I, S>(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: &Path,
    id: &str,
    name: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    require_point(data_dir, id)?;
    import_profile_named_from(
        profiles_dir,
        tf2_root,
        &zip_path(data_dir, id),
        running_names,
        name,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{
        mutate_profile_files_to, save_current_as_to, FileSource, ProfileLiveProjection,
        SaveCurrentOptions,
    };

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn fixture() -> (PathBuf, PathBuf, PathBuf, String) {
        let dir = crate::test_temp_dir();
        let data = dir.join("data");
        let profiles = data.join("profiles");
        let root = dir.join("Team Fortress 2");
        write(&root.join("tf/steam.inf"), "appID=440\n");
        write(&root.join("tf/cfg/config.cfg"), "bind w +forward\n");
        write(
            &root.join("tf/cfg/overrides/execs_gameplay.cfg"),
            "fov_desired 90\n",
        );
        crate::cfg_layer::write_test_base(&root);
        let library = save_current_as_to(
            &profiles,
            &root,
            "Main",
            ["not-running"],
            SaveCurrentOptions {
                launch_options: Some("-novid"),
                cloud_config: None,
            },
        )
        .unwrap();
        let id = library.profiles[0].id.clone();
        (data, profiles, root, id)
    }

    #[test]
    fn save_compare_and_restore_as_a_new_inactive_profile() {
        let (data, profiles, root, id) = fixture();
        let point = create_restore_point(&profiles, &data, &root, &id, Some("Before HUD")).unwrap();
        assert_eq!(point.profile_name, "Main");
        assert_eq!(point.label.as_deref(), Some("Before HUD"));
        assert!(point.bytes > 0);

        let unchanged = compare_restore_point(&profiles, &data, &root, &point.id).unwrap();
        assert!(unchanged.values.is_empty() && unchanged.packs.added.is_empty());

        mutate_profile_files_to(
            &profiles,
            &root,
            &id,
            &[(
                "tf/cfg/overrides/execs_gameplay.cfg".into(),
                FileSource::Bytes(b"fov_desired 75\n"),
            )],
            &[],
            ProfileLiveProjection::LibraryOnly,
            ["not-running"],
            |_| Ok(()),
        )
        .unwrap();
        let diff = compare_restore_point(&profiles, &data, &root, &point.id).unwrap();
        assert_eq!(diff.values.len(), 1);
        assert_eq!(diff.values[0].from.as_deref(), Some("75"));
        assert_eq!(diff.values[0].to.as_deref(), Some("90"));
        assert_ne!(diff.revision, unchanged.revision);

        let live_before = fs::read(root.join("tf/cfg/config.cfg")).unwrap();
        let library = restore_restore_point(
            &profiles,
            &data,
            &root,
            &point.id,
            "Main (restored)",
            ["not-running"],
        )
        .unwrap();
        assert_eq!(library.profiles.len(), 2);
        assert_eq!(library.active_profile_id.as_deref(), Some(id.as_str()));
        let restored = library
            .profiles
            .iter()
            .find(|profile| profile.id != id)
            .unwrap();
        assert_eq!(restored.name, "Main (restored)");
        let bytes = crate::apply::profile_file_bytes_from(
            &profiles,
            &restored.id,
            "tf/cfg/overrides/execs_gameplay.cfg",
        )
        .unwrap();
        assert_eq!(bytes, b"fov_desired 90\n");
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            live_before
        );

        assert!(restore_restore_point(
            &profiles,
            &data,
            &root,
            &point.id,
            "Refused",
            [if cfg!(windows) {
                "tf_win64.exe"
            } else {
                "tf_linux64"
            }],
        )
        .is_err());
        fs::remove_dir_all(data.parent().unwrap()).unwrap();
    }

    #[test]
    fn restores_cfg_commands_that_only_the_stricter_shared_import_refuses() {
        let (data, profiles, root, id) = fixture();
        // mastercomfig's own preset VPKs carry cfgs like this; the player's
        // library already accepted them, and export scans them as trusted.
        mutate_profile_files_to(
            &profiles,
            &root,
            &id,
            &[(
                "tf/cfg/overrides/mine.cfg".into(),
                FileSource::Bytes(b"alias kill \"explode\"\n"),
            )],
            &[],
            ProfileLiveProjection::LibraryOnly,
            ["not-running"],
            |_| Ok(()),
        )
        .unwrap();
        let point = create_restore_point(&profiles, &data, &root, &id, None).unwrap();
        let zip = zip_path(&data, &point.id);
        assert!(crate::zip::import_profile_from(&profiles, &root, &zip, ["not-running"]).is_err());
        let library = restore_restore_point(
            &profiles,
            &data,
            &root,
            &point.id,
            "Restored",
            ["not-running"],
        )
        .unwrap();
        let restored = library
            .profiles
            .iter()
            .find(|profile| profile.name == "Restored")
            .unwrap();
        assert_eq!(
            crate::apply::profile_file_bytes_from(
                &profiles,
                &restored.id,
                "tf/cfg/overrides/mine.cfg"
            )
            .unwrap(),
            b"alias kill \"explode\"\n"
        );
        fs::remove_dir_all(data.parent().unwrap()).unwrap();
    }

    #[test]
    fn retention_keeps_the_newest_points_per_profile_and_cleans_leftovers() {
        let (data, profiles, root, id) = fixture();
        set_keep_per_profile(&data, 2).unwrap();
        let mut ids = Vec::new();
        for _ in 0..3 {
            ids.push(
                create_restore_point(&profiles, &data, &root, &id, None)
                    .unwrap()
                    .id,
            );
        }
        let orphan = points_dir(&data).join(format!("{}.zip", "a".repeat(32)));
        fs::write(&orphan, b"partial").unwrap();
        create_restore_point(&profiles, &data, &root, &id, None).unwrap();
        let list = list_restore_points(&data).unwrap();
        assert_eq!(list.keep_per_profile, 2);
        assert_eq!(list.points.len(), 2);
        assert!(!orphan.exists());
        assert!(!list.points.iter().any(|point| point.id == ids[0]));

        let remaining = delete_restore_point(&data, &list.points[0].id).unwrap();
        assert_eq!(remaining.points.len(), 1);
        assert!(set_keep_per_profile(&data, 0).is_err());
        assert!(create_restore_point(&profiles, &data, &root, &id, Some("bad\nname")).is_err());
        assert!(delete_restore_point(&data, "../escape").is_err());
        fs::remove_dir_all(data.parent().unwrap()).unwrap();
    }
}
