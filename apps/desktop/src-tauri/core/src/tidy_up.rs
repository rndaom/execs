//! Tidying up what earlier versions of execs left behind.
//!
//! Fixing a bug stops new mess, but players who used 0.1.x or 0.2.0 already
//! have leftovers in TF2's folder and in execs data. The first start of a
//! version with these fixes runs this once (and App settings → Storage can run
//! it again). Every step is conservative and repeatable:
//!
//! 1. Sound caches TF2 wrote for VPKs that are no longer in `tf/custom`.
//! 2. HUD backups: deleted only when every file is byte-identical to a copy a
//!    profile still owns; otherwise ones in TF2's folder move to execs data,
//!    where TF2 never scans them. Storage keeps offering Restore and Delete.
//! 3. Valve's own cfgs captured into profiles by older versions are dropped
//!    from the manifests; TF2's folder is not touched. When those cfgs are
//!    missing from TF2, the report says so, so the player can verify TF2.
//! 4. execs-managed files in an older execs format are upgraded
//!    ([`crate::managed_upgrade`]); hand edits are left alone.
//! 5. The retired cueki library download when no profile still uses it, and
//!    leftovers of retired features.
//!
//! Nothing runs while TF2 runs or while a recovery is unfinished. Profile
//! changes use the ordinary journaled profile transaction; file moves are
//! verified before the original is removed. A failed step is reported and
//! skipped, and the next run repeats only what is still left.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::hash::{remove_dir_within, remove_file_force_within, validate_dir_within};
use crate::managed_upgrade::ManagedUpgradeKind;
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    load_library_from, load_manifest, mutate_profile_files_to, profile_mutation_status_to,
    ProfileError, ProfileLiveProjection, ProfileMutationRecoveryState,
};

/// Bump when a later version adds a step that should run once more.
pub const TIDY_VERSION: u32 = 1;
const MARKER: &str = "tidy-up.json";

/// Automatic runs that left a step undone before giving up until the next
/// version (Storage's Tidy up again still runs any time).
const MAX_INCOMPLETE_RUNS: u32 = 3;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker {
    version: u32,
    /// Automatic runs of this version that skipped a step; 0 when complete.
    #[serde(default)]
    incomplete_runs: u32,
}

/// One profile and how many of its entries a step changed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCount {
    pub profile: String,
    pub count: usize,
}

/// One execs-managed file brought up to date in one profile.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpgrade {
    pub profile: String,
    pub kind: ManagedUpgradeKind,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TidyReport {
    /// `tf/custom` sound cache files removed.
    pub sound_caches_removed: Vec<String>,
    /// HUD backups whose every file a profile still owns.
    pub hud_backups_deleted: Vec<String>,
    /// HUD backups moved out of TF2's folder into execs data.
    pub hud_backups_moved: Vec<String>,
    /// HUD backups kept where they were (listed in Storage).
    pub hud_backups_kept: usize,
    pub valve_cfgs_dropped: Vec<ProfileCount>,
    /// Valve cfgs profiles had captured that are also missing from TF2's
    /// folder; verifying TF2 in Steam restores them.
    pub valve_cfgs_missing: usize,
    pub managed_files_upgraded: Vec<ProfileUpgrade>,
    /// Data-folder downloads and retired caches removed.
    pub downloads_removed: Vec<String>,
    pub freed_bytes: u64,
    pub moved_bytes: u64,
    /// Steps that could not run, in words for the player.
    pub skipped: Vec<String>,
}

impl TidyReport {
    /// True when the run changed anything on disk.
    pub fn changed(&self) -> bool {
        !self.sound_caches_removed.is_empty()
            || !self.hud_backups_deleted.is_empty()
            || !self.hud_backups_moved.is_empty()
            || !self.valve_cfgs_dropped.is_empty()
            || !self.managed_files_upgraded.is_empty()
            || !self.downloads_removed.is_empty()
    }
}

fn marker_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("maintenance").join(MARKER)
}

fn read_marker(data_dir: &Path) -> Option<Marker> {
    crate::hash::read_small_file_bounded(&marker_path(data_dir), 4096)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Marker>(&bytes).ok())
}

/// True until this version's automatic tidy-up has completed, or has skipped
/// a step on [`MAX_INCOMPLETE_RUNS`] starts in a row.
pub fn automatic_tidy_due(data_dir: &Path) -> bool {
    read_marker(data_dir).is_none_or(|marker| {
        marker.version < TIDY_VERSION
            || (marker.incomplete_runs > 0 && marker.incomplete_runs < MAX_INCOMPLETE_RUNS)
    })
}

/// Record an automatic run. One that skipped a step (`complete` false) is
/// retried on the next start.
pub fn record_automatic_tidy(data_dir: &Path, complete: bool) -> Result<(), ProfileError> {
    let path = marker_path(data_dir);
    crate::hash::create_dir_all_within(data_dir, path.parent().unwrap_or(data_dir))
        .map_err(|error| ProfileError::Io(error.to_string()))?;
    let incomplete_runs = if complete {
        0
    } else {
        read_marker(data_dir)
            .filter(|marker| marker.version == TIDY_VERSION)
            .map_or(0, |marker| marker.incomplete_runs)
            + 1
    };
    let bytes = serde_json::to_vec(&Marker {
        version: TIDY_VERSION,
        incomplete_runs,
    })
    .map_err(|error| ProfileError::Io(error.to_string()))?;
    crate::hash::write_atomic_within(data_dir, &path, &bytes)
        .map_err(|error| ProfileError::Io(error.to_string()))
}

fn io(error: impl std::fmt::Display) -> ProfileError {
    ProfileError::Io(error.to_string())
}

/// Run every step. Refuses while TF2 runs or a recovery is unfinished.
pub fn tidy_up_to(
    data_dir: &Path,
    tf2_root: &Path,
    running: &[String],
) -> Result<TidyReport, ProfileError> {
    refuse_if_running_among(running)?;
    refuse_if_running_among(live_process_names())?;
    let profiles = data_dir.join("profiles");
    let library = load_library_from(&profiles, Some(tf2_root))?;
    let usable = library.usable && !library.root_mismatch;
    if usable {
        if profile_mutation_status_to(&profiles, tf2_root)? != ProfileMutationRecoveryState::Clean
            || library.pending_switch_profile_id.is_some()
            || library.interrupted_profile_id.is_some()
        {
            return Err(io(
                "Finish the interrupted profile change first; the tidy-up runs after that.",
            ));
        }
        if !matches!(
            crate::preloader::preloader_transaction_status(tf2_root, data_dir),
            Ok(crate::preloader::PreloaderTransactionStatus::None)
        ) {
            return Err(io(
                "Finish the Casual setup recovery first; the tidy-up runs after that.",
            ));
        }
    }
    let mut report = TidyReport::default();
    remove_orphan_sound_caches(tf2_root, &mut report);
    if usable {
        let names: HashMap<String, String> = library
            .profiles
            .iter()
            .map(|profile| (profile.id.clone(), profile.name.clone()))
            .collect();
        drop_valve_cfgs(&profiles, tf2_root, &names, running, &mut report);
        upgrade_managed_files(&profiles, tf2_root, &names, running, &mut report);
        tidy_hud_backups(&profiles, tf2_root, &names, running, &mut report);
        remove_unused_downloads(data_dir, &profiles, &names, &mut report);
    } else {
        report.skipped.push(
            "Profile files were not checked because the profiles belong to another TF2 folder."
                .into(),
        );
    }
    Ok(report)
}

/// `<pack>.vpk.sound.cache` in `tf/custom` whose `<pack>.vpk` is gone. TF2
/// rebuilds any cache it needs; links and other entries are never touched.
fn remove_orphan_sound_caches(tf2_root: &Path, report: &mut TidyReport) {
    let custom = tf2_root.join("tf").join("custom");
    if validate_dir_within(tf2_root, &custom).is_err() {
        return;
    }
    let Ok(entries) = fs::read_dir(&custom) else {
        report
            .skipped
            .push("TF2's custom folder could not be read.".into());
        return;
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.to_ascii_lowercase().ends_with(".vpk.sound.cache"))
        .collect();
    names.sort();
    for name in names {
        let path = custom.join(&name);
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if crate::hash::metadata_is_link(&meta) || !meta.is_file() {
            continue;
        }
        let pack = custom.join(&name[..name.len() - ".sound.cache".len()]);
        if !matches!(fs::symlink_metadata(&pack), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
        {
            continue;
        }
        if refuse_if_running_among(live_process_names()).is_err() {
            report
                .skipped
                .push("TF2 started, so the tidy-up stopped.".into());
            return;
        }
        match remove_file_force_within(tf2_root, &path) {
            Ok(()) => {
                report.freed_bytes += meta.len();
                report.sound_caches_removed.push(name);
            }
            Err(_) => report.skipped.push(format!("{name} could not be removed.")),
        }
    }
}

fn drop_valve_cfgs(
    profiles: &Path,
    tf2_root: &Path,
    names: &HashMap<String, String>,
    running: &[String],
    report: &mut TidyReport,
) {
    let mut missing = HashSet::new();
    for (id, name) in sorted(names) {
        let entries = match crate::profile::protected_stock_cfg_entries(profiles, id) {
            Ok(entries) if !entries.is_empty() => entries,
            Ok(_) => {
                // Also finishes a run that dropped the entries but stopped
                // before their saved copies were removed.
                report.freed_bytes += remove_unlisted_valve_cfg_copies(profiles, id);
                continue;
            }
            Err(_) => {
                report
                    .skipped
                    .push(format!("{name}: its files could not be read."));
                continue;
            }
        };
        // An empty transaction drops the historical entries and nothing else.
        match mutate_profile_files_to(
            profiles,
            tf2_root,
            id,
            &[],
            &[],
            ProfileLiveProjection::LibraryOnly,
            running,
            |_| Ok(()),
        ) {
            Ok(_) => {
                for path in &entries {
                    if fs::symlink_metadata(tf2_root.join(path)).is_err() {
                        missing.insert(path.to_ascii_lowercase());
                    }
                }
                report.freed_bytes += remove_unlisted_valve_cfg_copies(profiles, id);
                report.valve_cfgs_dropped.push(ProfileCount {
                    profile: name.clone(),
                    count: entries.len(),
                });
            }
            Err(error) => report.skipped.push(format!("{name}: {}", error.message())),
        }
    }
    report.valve_cfgs_missing = missing.len();
}

/// Saved copies of Valve cfgs under a profile's `files/tf/cfg` once its
/// manifest no longer lists any Valve cfg. The profile transaction drops the
/// entries but leaves their bytes, which nothing reads again. Only regular
/// files inside the profile folder are removed; links are never followed and
/// TF2's folder is not touched. Returns the bytes freed.
fn remove_unlisted_valve_cfg_copies(profiles: &Path, id: &str) -> u64 {
    if !crate::profile::protected_stock_cfg_entries(profiles, id).is_ok_and(|e| e.is_empty()) {
        return 0;
    }
    let profile = crate::profile::profile_dir(profiles, id);
    let cfg = crate::profile::exclusive_file_path(profiles, id, "tf/cfg");
    if validate_dir_within(&profile, &cfg).is_err() {
        return 0;
    }
    let mut freed = 0;
    let mut pending = vec![(cfg, "tf/cfg".to_string(), 0usize)];
    let mut visited = 0usize;
    while let Some((dir, rel, depth)) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > 4096 {
                return freed;
            }
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            let path = entry.path();
            let child = format!("{rel}/{name}");
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if crate::hash::metadata_is_link(&meta) {
                continue;
            }
            if meta.is_dir() {
                if depth < 8 {
                    pending.push((path, child, depth + 1));
                }
            } else if meta.is_file()
                && crate::surface::is_protected_stock_cfg_path(&child)
                && remove_file_force_within(&profile, &path).is_ok()
            {
                freed += meta.len();
            }
        }
    }
    freed
}

fn upgrade_managed_files(
    profiles: &Path,
    tf2_root: &Path,
    names: &HashMap<String, String>,
    running: &[String],
    report: &mut TidyReport,
) {
    for (id, name) in sorted(names) {
        match crate::managed_upgrade::upgrade_profile_managed_files_to(
            profiles, tf2_root, id, running,
        ) {
            Ok(upgrades) => report
                .managed_files_upgraded
                .extend(upgrades.into_iter().map(|upgrade| ProfileUpgrade {
                    profile: name.clone(),
                    kind: upgrade.kind,
                })),
            Err(error) => report.skipped.push(format!("{name}: {}", error.message())),
        }
    }
}

fn tidy_hud_backups(
    profiles: &Path,
    tf2_root: &Path,
    names: &HashMap<String, String>,
    running: &[String],
    report: &mut TidyReport,
) {
    // Every path any profile owns, with the hashes it holds there.
    let mut owned: HashMap<String, HashSet<String>> = HashMap::new();
    for id in names.keys() {
        let Ok(manifest) = load_manifest(profiles, id) else {
            // A backup is only deleted when ownership is certain.
            report
                .skipped
                .push("HUD backups were kept because a profile could not be read.".into());
            return;
        };
        for file in manifest.files {
            owned
                .entry(file.path.to_ascii_lowercase())
                .or_default()
                .insert(file.sha256.to_ascii_lowercase());
        }
    }
    let listed = match crate::hud_backups::list_hud_backups_to(profiles, tf2_root) {
        Ok(listed) => listed,
        Err(_) => {
            report
                .skipped
                .push("HUD backups could not be listed.".into());
            return;
        }
    };
    for unreadable in listed.unreadable {
        report
            .skipped
            .push(format!("{unreadable} could not be read and was kept."));
    }
    for backup in listed.backups {
        let redundant = crate::hud_backups::backup_profile_paths(profiles, tf2_root, &backup.id)
            .is_ok_and(|files| {
                !files.is_empty()
                    && files.iter().all(|(path, sha256)| {
                        owned
                            .get(&path.to_ascii_lowercase())
                            .is_some_and(|hashes| hashes.contains(&sha256.to_ascii_lowercase()))
                    })
            });
        let in_tf2 = backup.id.starts_with("live/");
        let outcome = if redundant {
            crate::hud_backups::delete_hud_backup_to(
                profiles,
                tf2_root,
                &backup.id,
                &backup.revision,
                running,
            )
            .map(|()| {
                report.freed_bytes += backup.bytes;
                report.hud_backups_deleted.push(backup.name.clone());
            })
        } else if in_tf2 {
            crate::hud_backups::move_live_hud_backup_to_data(
                profiles,
                tf2_root,
                &backup.id,
                &backup.revision,
                running,
            )
            .map(|_| {
                report.moved_bytes += backup.bytes;
                report.hud_backups_moved.push(backup.name.clone());
            })
        } else {
            report.hud_backups_kept += 1;
            Ok(())
        };
        if let Err(error) = outcome {
            report.hud_backups_kept += 1;
            report.skipped.push(format!(
                "HUD backup {} was kept: {}",
                backup.name,
                error.message()
            ));
        }
    }
    let container = tf2_root
        .join("tf")
        .join("custom")
        .join(crate::surface::HUD_BACKUP_CONTAINER);
    if fs::read_dir(&container).is_ok_and(|mut entries| entries.next().is_none()) {
        let _ = remove_dir_within(tf2_root, &container);
    }
}

fn remove_unused_downloads(
    data_dir: &Path,
    profiles: &Path,
    names: &HashMap<String, String>,
    report: &mut TidyReport,
) {
    let cueki_needed = names.keys().any(|id| {
        load_manifest(profiles, id).map_or(true, |manifest| {
            manifest
                .preloader
                .as_ref()
                .is_some_and(crate::preloader::PreloaderSelection::needs_cueki_library)
        })
    });
    let preloader = data_dir.join("preloader");
    if !cueki_needed && validate_dir_within(data_dir, &preloader).is_ok() {
        if let Ok(entries) = fs::read_dir(&preloader) {
            for entry in entries.flatten() {
                let Ok(name) = entry.file_name().into_string() else {
                    continue;
                };
                let lower = name.to_ascii_lowercase();
                if !(lower.starts_with("mods-") && lower.ends_with(".zip")) {
                    continue;
                }
                let path = entry.path();
                let Ok(meta) = fs::symlink_metadata(&path) else {
                    continue;
                };
                if crate::hash::metadata_is_link(&meta) || !meta.is_file() {
                    continue;
                }
                match remove_file_force_within(data_dir, &path) {
                    Ok(()) => {
                        report.freed_bytes += meta.len();
                        report.downloads_removed.push(name);
                    }
                    Err(_) => report.skipped.push(format!("{name} could not be removed.")),
                }
            }
        }
    }
    match crate::storage::clear_retired_leftovers(data_dir) {
        Ok(cleared) => {
            if cleared.freed_bytes > 0 {
                report.freed_bytes += cleared.freed_bytes;
                report
                    .downloads_removed
                    .push("Retired crosshair, studio and sound catalog caches".into());
            }
            for failed in cleared.failed {
                report
                    .skipped
                    .push(format!("{failed} could not be removed."));
            }
        }
        Err(_) => report
            .skipped
            .push("Retired caches could not be checked.".into()),
    }
}

fn sorted(names: &HashMap<String, String>) -> Vec<(&String, &String)> {
    let mut entries: Vec<_> = names.iter().collect();
    entries.sort_by(|a, b| a.1.cmp(b.1).then_with(|| a.0.cmp(b.0)));
    entries
}

/// A short summary for the activity log.
pub fn summary(report: &TidyReport) -> String {
    format!(
        "Tidy-up: {} sound caches removed, {} HUD backups deleted, {} moved out of TF2's folder, {} kept, {} profiles without Valve cfgs, {} managed files upgraded, {} downloads removed, {} bytes freed, {} skipped",
        report.sound_caches_removed.len(),
        report.hud_backups_deleted.len(),
        report.hud_backups_moved.len(),
        report.hud_backups_kept,
        report.valve_cfgs_dropped.len(),
        report.managed_files_upgraded.len(),
        report.downloads_removed.len(),
        report.freed_bytes,
        report.skipped.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const UNLOCKED: [&str; 1] = ["explorer.exe"];
    const OLD_HOOK: &str = "// execs preload — managed, do not edit by hand\nsv_pure -1\nsv_allow_point_servercommand always\nmap itemtest\nwait 10; disconnect\nwait 1; clear\nscript_execute randommenumusic\n";
    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn running() -> Vec<String> {
        UNLOCKED.iter().map(|name| (*name).to_string()).collect()
    }

    /// An older-version setup: a saved profile with an old preload hook and a
    /// HUD, plus leftovers in TF2's folder and execs data.
    fn older_setup(dir: &Path) -> (PathBuf, PathBuf, String) {
        let data = dir.join("execs");
        let profiles = data.join("profiles");
        let root = dir.join("Team Fortress 2");
        write(&root.join("tf/steam.inf"), "appID=440\n");
        write(&root.join("tf/cfg/config.cfg"), "bind w +forward\n");
        write(&root.join("tf/cfg/execs_preload.cfg"), OLD_HOOK);
        write(
            &root.join("tf/custom/myhud/info.vdf"),
            "\"hud\" { \"ui_version\" \"3\" }\n",
        );
        write(&root.join("tf/custom/kept.vpk"), "vpk");
        let id = crate::profile::save_current_as_to(
            &profiles,
            &root,
            "Low",
            UNLOCKED,
            crate::profile::SaveCurrentOptions::default(),
        )
        .unwrap()
        .profiles[0]
            .id
            .clone();
        // What older versions left behind.
        write(&root.join("tf/custom/kept.vpk.sound.cache"), "cache");
        write(&root.join("tf/custom/gone.vpk.sound.cache"), "orphan");
        let backups = root
            .join("tf/custom")
            .join(crate::surface::HUD_BACKUP_CONTAINER);
        write(
            &backups.join(TOKEN).join("myhud/info.vdf"),
            "\"hud\" { \"ui_version\" \"3\" }\n",
        );
        write(
            &backups.join(TOKEN).join("oldhud/resource/a.res"),
            "only here",
        );
        write(&data.join("preloader/mods-v1.7.1.zip"), "cueki");
        write(&data.join("crosshair-cache/venom.vtf"), "retired");
        (data, root, id)
    }

    #[test]
    fn removes_moves_and_upgrades_only_what_older_versions_left() {
        let dir = crate::test_temp_dir();
        let (data, root, _id) = older_setup(&dir);
        let report = tidy_up_to(&data, &root, &running()).unwrap();
        assert!(report.changed());
        assert!(report.skipped.is_empty(), "{:?}", report.skipped);
        assert_eq!(report.sound_caches_removed, ["gone.vpk.sound.cache"]);
        assert!(root.join("tf/custom/kept.vpk.sound.cache").is_file());
        // The owned copy is deleted; the one no profile owns moves to execs data.
        assert_eq!(report.hud_backups_deleted, ["myhud"]);
        assert_eq!(report.hud_backups_moved, ["oldhud"]);
        assert!(!root
            .join("tf/custom")
            .join(crate::surface::HUD_BACKUP_CONTAINER)
            .exists());
        assert_eq!(
            fs::read_to_string(
                data.join(crate::hud_backups::DATA_BACKUP_DIR)
                    .join(TOKEN)
                    .join("oldhud/resource/a.res")
            )
            .unwrap(),
            "only here"
        );
        assert_eq!(report.managed_files_upgraded.len(), 1);
        assert_eq!(
            fs::read_to_string(root.join("tf/cfg/execs_preload.cfg")).unwrap(),
            crate::viewmodel::serialize_preload_cfg()
        );
        assert_eq!(report.downloads_removed.len(), 2);
        assert!(!data.join("preloader/mods-v1.7.1.zip").exists());
        assert!(!data.join("crosshair-cache").exists());
        // Packs and the player's files stay.
        assert!(root.join("tf/custom/kept.vpk").is_file());
        assert!(root.join("tf/custom/myhud/info.vdf").is_file());
        // The moved backup is still listed for Restore and Delete.
        let listed =
            crate::hud_backups::list_hud_backups_to(&data.join("profiles"), &root).unwrap();
        assert!(listed
            .backups
            .iter()
            .any(|backup| backup.id == format!("data/{TOKEN}/oldhud")));
        // A second run finds nothing left to do.
        assert!(!tidy_up_to(&data, &root, &running()).unwrap().changed());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn drops_valve_cfgs_older_versions_captured_and_reports_missing_ones() {
        let dir = crate::test_temp_dir();
        let (data, root, id) = older_setup(&dir);
        let profiles = data.join("profiles");
        // What 0.2.0 captured: Valve's server cfg as a profile file.
        let rel = "tf/cfg/server_1.cfg";
        let bytes = b"// Valve server cfg\n";
        write(
            &crate::profile::exclusive_file_path(&profiles, &id, rel),
            "// Valve server cfg\n",
        );
        let manifest_path = crate::profile::manifest_file(&profiles, &id);
        let mut manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&manifest_path).unwrap()).unwrap();
        manifest["files"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "path": rel,
                "sha256": crate::hash::sha256_hex(bytes),
                "storage": "exclusive",
            }));
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert_eq!(
            crate::profile::protected_stock_cfg_entries(&profiles, &id).unwrap(),
            [rel]
        );

        let report = tidy_up_to(&data, &root, &running()).unwrap();
        assert_eq!(
            report.valve_cfgs_dropped,
            [ProfileCount {
                profile: "Low".into(),
                count: 1
            }]
        );
        // TF2 lacks it, so the report suggests verifying TF2 in Steam.
        assert_eq!(report.valve_cfgs_missing, 1);
        assert!(crate::profile::protected_stock_cfg_entries(&profiles, &id)
            .unwrap()
            .is_empty());
        // The saved copy nothing lists any more is gone too; the profile's
        // own config.cfg stays.
        assert!(!crate::profile::exclusive_file_path(&profiles, &id, rel).exists());
        assert!(crate::profile::exclusive_file_path(&profiles, &id, "tf/cfg/config.cfg").is_file());
        assert!(report.freed_bytes >= bytes.len() as u64);
        // TF2's folder was not touched.
        assert!(!root.join(rel).exists());
        // A copy left by a run that stopped after dropping the entry is
        // removed by the next run.
        write(
            &crate::profile::exclusive_file_path(&profiles, &id, "tf/cfg/server_2.cfg"),
            "// Valve server cfg\n",
        );
        tidy_up_to(&data, &root, &running()).unwrap();
        assert!(!crate::profile::exclusive_file_path(&profiles, &id, "tf/cfg/server_2.cfg").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_hand_edited_hook_and_unowned_backups_are_kept() {
        let dir = crate::test_temp_dir();
        let (data, root, id) = older_setup(&dir);
        let profiles = data.join("profiles");
        // The player edited the hook; the edit is saved in the profile and live.
        let edited = format!("{OLD_HOOK}echo mine\n");
        crate::profile::mutate_profile_files_to(
            &profiles,
            &root,
            &id,
            &[(
                "tf/cfg/execs_preload.cfg".to_string(),
                crate::profile::FileSource::Bytes(edited.as_bytes()),
            )],
            &[],
            ProfileLiveProjection::MirrorIfActive,
            UNLOCKED,
            |_| Ok(()),
        )
        .unwrap();
        let report = tidy_up_to(&data, &root, &running()).unwrap();
        assert!(report.managed_files_upgraded.is_empty());
        assert_eq!(
            fs::read_to_string(root.join("tf/cfg/execs_preload.cfg")).unwrap(),
            edited
        );
        // A backup holding a file no profile owns is never deleted.
        assert!(!report.hud_backups_deleted.contains(&"oldhud".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn waits_for_tf2_and_for_an_interrupted_change() {
        let dir = crate::test_temp_dir();
        let (data, root, id) = older_setup(&dir);
        assert!(matches!(
            tidy_up_to(&data, &root, &["tf_win64.exe".to_string()]),
            Err(ProfileError::GameRunning)
        ));
        let journal = data
            .join("profiles")
            .join(&id)
            .join(".mutation-journal.json");
        fs::write(&journal, "{}").unwrap();
        assert!(tidy_up_to(&data, &root, &running()).is_err());
        assert!(root.join("tf/custom/gone.vpk.sound.cache").is_file());
        fs::remove_file(&journal).unwrap();
        assert!(tidy_up_to(&data, &root, &running()).unwrap().changed());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_interrupted_move_is_finished_by_the_next_run() {
        let dir = crate::test_temp_dir();
        let (data, root, _id) = older_setup(&dir);
        // A move cut off before publishing left only its staging folder.
        let staged = data
            .join(crate::hud_backups::DATA_BACKUP_DIR)
            .join(TOKEN)
            .join(".moving-cut-off");
        write(&staged.join("resource/a.res"), "partial");
        let report = tidy_up_to(&data, &root, &running()).unwrap();
        assert_eq!(report.hud_backups_moved, ["oldhud"]);
        assert!(!staged.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Runs the tidy-up on a copy of a real setup; never on live folders.
    /// `EXECS_TIDY_DATA` is a copied execs data folder whose library points at
    /// `EXECS_TIDY_ROOT`, a copied TF2 folder with `tf/steam.inf`, `tf/cfg`
    /// and `tf/custom`. Run with `-- --ignored --nocapture`.
    #[test]
    #[ignore = "needs a copied execs data folder and TF2 folder"]
    fn tidies_a_copied_real_setup() {
        let (Ok(data), Ok(root)) = (
            std::env::var("EXECS_TIDY_DATA"),
            std::env::var("EXECS_TIDY_ROOT"),
        ) else {
            return;
        };
        let report = tidy_up_to(Path::new(&data), Path::new(&root), &running()).unwrap();
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
        let again = tidy_up_to(Path::new(&data), Path::new(&root), &running()).unwrap();
        assert!(!again.changed(), "{again:?}");
    }

    #[test]
    fn a_move_that_published_its_copy_but_kept_the_original_finishes() {
        let dir = crate::test_temp_dir();
        let (data, root, _id) = older_setup(&dir);
        // The copy was published, then removing the TF2 copy failed.
        write(
            &data
                .join(crate::hud_backups::DATA_BACKUP_DIR)
                .join(TOKEN)
                .join("oldhud/resource/a.res"),
            "only here",
        );
        let report = tidy_up_to(&data, &root, &running()).unwrap();
        assert_eq!(report.hud_backups_moved, ["oldhud"]);
        assert!(!root
            .join("tf/custom")
            .join(crate::surface::HUD_BACKUP_CONTAINER)
            .exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_automatic_run_is_recorded_once_per_version() {
        let dir = crate::test_temp_dir();
        assert!(automatic_tidy_due(&dir));
        record_automatic_tidy(&dir, true).unwrap();
        assert!(!automatic_tidy_due(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_run_that_skipped_a_step_is_retried_a_few_times() {
        let dir = crate::test_temp_dir();
        for _ in 1..MAX_INCOMPLETE_RUNS {
            record_automatic_tidy(&dir, false).unwrap();
            assert!(automatic_tidy_due(&dir));
        }
        record_automatic_tidy(&dir, false).unwrap();
        assert!(!automatic_tidy_due(&dir));
        let _ = fs::remove_dir_all(&dir);
    }
}
