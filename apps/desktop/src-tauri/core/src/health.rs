//! Read-only evidence about the local installation for the App settings
//! health view. Nothing here writes game, profile or recovery data, starts a
//! Steam verification or touches the network. Evidence that cannot be read is
//! reported as unknown instead of guessed.

use std::path::Path;
use std::time::SystemTime;

use serde::Serialize;

use crate::blob::blob_path;
use crate::launch::SteamAccount;
use crate::preloader::{
    developer_textures, flat_textures, preloader_transaction_status, square_overlays,
    PreloaderTransactionStatus, MODS_RELEASE,
};
use crate::profile::{
    exclusive_file_path, load_library_from, load_manifest, profile_mutation_status_to, FileStorage,
    ProfileMutationRecoveryState,
};
use crate::surface::CfgLayer;

/// Missing paths listed per profile; the count stays exact.
const MAX_LISTED_MISSING: usize = 10;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileHealth {
    pub id: String,
    pub name: String,
    pub active: bool,
    /// None when the manifest could not be read (for example, a pending update).
    pub tracked_files: Option<u64>,
    pub missing_files: u64,
    pub missing_examples: Vec<String>,
    /// Direct-author Casual downloads this profile's switch needs but that are
    /// not cached, so switching to it needs a connection.
    pub uncached_downloads: Vec<String>,
    /// Saved legacy Casual choices need the old library, which cannot be
    /// downloaded again.
    pub needs_legacy_library: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryHealth {
    /// Profile name (or id) an interrupted switch was applying.
    pub pending_switch: Option<String>,
    pub profile_update: bool,
    pub casual: bool,
    /// Some recovery state could not be read.
    pub unknown: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub tf2_root: Option<String>,
    pub library_usable: bool,
    pub root_mismatch: bool,
    pub active_layer: Option<CfgLayer>,
    pub profiles: Vec<ProfileHealth>,
    pub recovery: RecoveryHealth,
    pub steam_account_found: bool,
    /// None when no account was found.
    pub cloud_config_present: Option<bool>,
    /// Seconds since the HUD catalog cache was written; None when absent.
    pub hud_catalog_age_seconds: Option<u64>,
    pub legacy_library_present: bool,
}

fn file_age_seconds(path: &Path) -> Option<u64> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta.modified().ok()?;
    Some(
        SystemTime::now()
            .duration_since(modified)
            .map(|age| age.as_secs())
            .unwrap_or(0),
    )
}

fn is_regular_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file())
}

fn profile_health(
    profiles_dir: &Path,
    data_dir: &Path,
    id: &str,
    name: &str,
    active: bool,
) -> ProfileHealth {
    let mut health = ProfileHealth {
        id: id.to_string(),
        name: name.to_string(),
        active,
        tracked_files: None,
        missing_files: 0,
        missing_examples: Vec::new(),
        uncached_downloads: Vec::new(),
        needs_legacy_library: false,
    };
    let Ok(manifest) = load_manifest(profiles_dir, id) else {
        return health;
    };
    health.tracked_files = Some(manifest.files.len() as u64);
    for file in &manifest.files {
        let stored = match file.storage {
            FileStorage::Exclusive => exclusive_file_path(profiles_dir, id, &file.path),
            FileStorage::Shared => blob_path(profiles_dir, &file.sha256),
        };
        if !is_regular_file(&stored) {
            health.missing_files += 1;
            if health.missing_examples.len() < MAX_LISTED_MISSING {
                health.missing_examples.push(file.path.clone());
            }
        }
    }
    if let Some(selection) = &manifest.preloader {
        let downloads = [
            (
                selection.uses_flat_textures(),
                flat_textures::ID,
                flat_textures::cache_path(data_dir),
            ),
            (
                selection.uses_developer_textures(),
                developer_textures::ID,
                developer_textures::cache_path(data_dir),
            ),
            (
                selection.uses_square_overlays(),
                "Square Series overlays",
                square_overlays::cache_path(data_dir),
            ),
        ];
        for (used, label, path) in downloads {
            if used && !is_regular_file(&path) {
                health.uncached_downloads.push(label.to_string());
            }
        }
        health.needs_legacy_library = selection.needs_cueki_library();
    }
    health
}

pub fn inspect_health(
    profiles_dir: &Path,
    data_dir: &Path,
    tf2_root: Option<&Path>,
    steam_account: Option<&SteamAccount>,
) -> HealthReport {
    let mut report = HealthReport {
        tf2_root: tf2_root.map(crate::finder::user_path_string),
        library_usable: false,
        root_mismatch: false,
        active_layer: None,
        profiles: Vec::new(),
        recovery: RecoveryHealth {
            pending_switch: None,
            profile_update: false,
            casual: false,
            unknown: false,
        },
        steam_account_found: steam_account.is_some(),
        cloud_config_present: steam_account.map(|account| is_regular_file(&account.cloud_config())),
        hud_catalog_age_seconds: file_age_seconds(
            &data_dir.join("hud-catalog").join("catalog-v4.json"),
        ),
        legacy_library_present: is_regular_file(
            &data_dir
                .join("preloader")
                .join(format!("mods-{MODS_RELEASE}.zip")),
        ),
    };
    let Some(root) = tf2_root else {
        return report;
    };

    match load_library_from(profiles_dir, Some(root)) {
        Ok(library) => {
            report.library_usable = library.usable;
            report.root_mismatch = library.root_mismatch;
            let name_of = |id: &str| {
                library
                    .profiles
                    .iter()
                    .find(|profile| profile.id == id)
                    .map_or_else(|| id.to_string(), |profile| profile.name.clone())
            };
            report.recovery.pending_switch =
                library.pending_switch_profile_id.as_deref().map(name_of);
            for profile in &library.profiles {
                let active = library.active_profile_id.as_deref() == Some(profile.id.as_str());
                report.profiles.push(profile_health(
                    profiles_dir,
                    data_dir,
                    &profile.id,
                    &profile.name,
                    active,
                ));
            }
        }
        Err(_) => report.recovery.unknown = true,
    }
    if report.library_usable {
        if let Ok(Some(detail)) = crate::apply::get_active_profile_detail_from(profiles_dir, root) {
            report.active_layer = Some(detail.layer);
        }
    }
    match profile_mutation_status_to(profiles_dir, root) {
        Ok(state) => report.recovery.profile_update = state != ProfileMutationRecoveryState::Clean,
        Err(_) => report.recovery.unknown = true,
    }
    match preloader_transaction_status(root, data_dir) {
        Ok(status) => report.recovery.casual = status != PreloaderTransactionStatus::None,
        Err(_) => report.recovery.unknown = true,
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn without_a_confirmed_install_only_app_data_evidence_is_reported() {
        let dir = crate::test_temp_dir();
        let data = dir.join("data");
        fs::create_dir_all(data.join("hud-catalog")).unwrap();
        fs::write(data.join("hud-catalog").join("catalog-v4.json"), b"{}").unwrap();
        let report = inspect_health(&data.join("profiles"), &data, None, None);
        assert_eq!(report.tf2_root, None);
        assert!(!report.library_usable);
        assert!(report.profiles.is_empty());
        assert!(!report.steam_account_found);
        assert_eq!(report.cloud_config_present, None);
        assert!(report.hud_catalog_age_seconds.is_some());
        assert!(!report.legacy_library_present);
        assert!(!report.recovery.unknown);
        fs::remove_dir_all(dir).unwrap();
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn reports_missing_library_files_uncached_downloads_and_the_active_layer() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let root = dir.join("Team Fortress 2");
        write(&root.join("tf/steam.inf"), "appID=440\n");
        write(&root.join("tf/cfg/config.cfg"), "bind w +forward\n");
        write(&root.join("tf/custom/pack/materials/a.vmt"), "pack\n");
        crate::cfg_layer::write_test_base(&root);
        let library = crate::profile::save_current_as_to(
            &profiles,
            &root,
            "Main",
            ["not-running"],
            crate::profile::SaveCurrentOptions {
                launch_options: None,
                cloud_config: None,
            },
        )
        .unwrap();
        let id = library.profiles[0].id.clone();
        crate::profile::mutate_profile_files_to(
            &profiles,
            &root,
            &id,
            &[],
            &[],
            crate::profile::ProfileLiveProjection::LibraryOnly,
            ["not-running"],
            |manifest| {
                manifest.preloader = Some(crate::preloader::PreloaderSelection {
                    addons: vec![flat_textures::ID.into()],
                    ..Default::default()
                });
                Ok(())
            },
        )
        .unwrap();
        fs::remove_file(exclusive_file_path(
            &profiles,
            &id,
            "tf/custom/pack/materials/a.vmt",
        ))
        .unwrap();

        let report = inspect_health(&profiles, &dir, Some(&root), None);
        assert!(report.library_usable);
        assert_eq!(report.active_layer, Some(CfgLayer::Comfig));
        let main = &report.profiles[0];
        assert!(main.active);
        assert!(main.tracked_files.unwrap() >= 2);
        assert_eq!(main.missing_files, 1);
        assert_eq!(main.missing_examples, ["tf/custom/pack/materials/a.vmt"]);
        assert_eq!(main.uncached_downloads, [flat_textures::ID]);
        assert!(!main.needs_legacy_library);
        assert_eq!(report.recovery.pending_switch, None);
        assert!(!report.recovery.profile_update && !report.recovery.casual);
        assert!(!report.recovery.unknown);

        write(&flat_textures::cache_path(&dir), "zip");
        let report = inspect_health(&profiles, &dir, Some(&root), None);
        assert!(report.profiles[0].uncached_downloads.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_steam_account_without_a_cloud_copy_is_not_reported_as_synced() {
        let dir = crate::test_temp_dir();
        let account = SteamAccount {
            steam_root: dir.join("steam"),
            account_id: "123".into(),
        };
        let report = inspect_health(&dir.join("profiles"), &dir, None, Some(&account));
        assert!(report.steam_account_found);
        assert_eq!(report.cloud_config_present, Some(false));
        fs::create_dir_all(account.cloud_config().parent().unwrap()).unwrap();
        fs::write(account.cloud_config(), b"bind w +forward\n").unwrap();
        let report = inspect_health(&dir.join("profiles"), &dir, None, Some(&account));
        assert_eq!(report.cloud_config_present, Some(true));
        fs::remove_dir_all(dir).unwrap();
    }
}
