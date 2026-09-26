//! What execs keeps in its data directory, and the one safe cleanup it offers.
//!
//! Every entry is classified from the code that actually reads it, never from
//! its name alone. Only rebuildable downloads and leftovers of retired features
//! are ever deleted. Profiles, recovery data, picked sound sources and the
//! legacy Casual library (which cannot be downloaded again) are kept.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::hash::{metadata_is_link, remove_file_force_within, remove_tree_within};
use crate::preloader::{developer_textures, flat_textures, square_overlays, MODS_RELEASE};

/// Walking stops here; the reported size then says it is partial.
const MAX_INSPECTED_ENTRIES: u64 = 250_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageGroupId {
    Profiles,
    RestorePoints,
    Downloads,
    Retired,
    Logs,
    Protected,
    Other,
}

impl StorageGroupId {
    const ALL: [StorageGroupId; 7] = [
        StorageGroupId::Profiles,
        StorageGroupId::RestorePoints,
        StorageGroupId::Downloads,
        StorageGroupId::Retired,
        StorageGroupId::Logs,
        StorageGroupId::Protected,
        StorageGroupId::Other,
    ];

    fn clearable(self) -> bool {
        matches!(self, StorageGroupId::Downloads | StorageGroupId::Retired)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageGroup {
    pub id: StorageGroupId,
    pub bytes: u64,
    pub files: u64,
    /// Entries that could not be read; `bytes` is then a lower bound.
    pub unreadable: u64,
    pub clearable: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageReport {
    pub groups: Vec<StorageGroup>,
    pub total_bytes: u64,
    pub clearable_bytes: u64,
    /// True when any size is a lower bound (unreadable entries or the walk limit).
    pub partial: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearReport {
    pub freed_bytes: u64,
    /// Data-dir-relative paths that could not be removed (for example, a file
    /// held open by antivirus). They stay and are counted again next time.
    pub failed: Vec<String>,
}

fn rel(data_dir: &Path, path: &Path) -> String {
    path.strip_prefix(data_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Classify one top-level or preloader entry. Unknown entries are kept.
fn classify(data_dir: &Path, path: &Path) -> StorageGroupId {
    let name = rel(data_dir, path).to_ascii_lowercase();
    let preloader_downloads = [
        flat_textures::cache_path(data_dir),
        developer_textures::cache_path(data_dir),
        square_overlays::cache_path(data_dir),
    ];
    if preloader_downloads.iter().any(|download| download == path) {
        return StorageGroupId::Downloads;
    }
    match name.as_str() {
        "profiles" => StorageGroupId::Profiles,
        // Removed only from the restore points dialog or by its retention.
        "restore-points" => StorageGroupId::RestorePoints,
        "logs" => StorageGroupId::Logs,
        // Catalog, statistics, albums and HUD option schemas re-download on use.
        "hud-catalog" => StorageGroupId::Downloads,
        // Retired Venom crosshair and Yttrium studio downloads; profiles keep
        // their own copies of anything they installed.
        "crosshair-cache" | "studio" => StorageGroupId::Retired,
        // Your picked WAVs are the sources Boost re-encodes from.
        "hitsound-cache/picked" => StorageGroupId::Protected,
        // Retired sound catalog downloads next to the picked folder.
        _ if name.starts_with("hitsound-cache/") => StorageGroupId::Retired,
        // Recovery journals, preloader originals and state, and the legacy
        // library that saved Casual choices need and that cannot be fetched again.
        "maintenance"
        | "preloader/originals"
        | "preloader/gameinfo.original.txt"
        | "preloader/state.json" => StorageGroupId::Protected,
        _ if name == format!("preloader/mods-{MODS_RELEASE}.zip") => StorageGroupId::Protected,
        _ => StorageGroupId::Other,
    }
}

/// The entries to classify: top-level items, with the two mixed folders split.
fn entries(data_dir: &Path) -> io::Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(data_dir)? {
        let path = entry?.path();
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        let is_dir = fs::symlink_metadata(&path)
            .map(|meta| meta.is_dir() && !metadata_is_link(&meta))
            .unwrap_or(false);
        if is_dir && (name == "preloader" || name == "hitsound-cache") {
            match fs::read_dir(&path) {
                Ok(children) => {
                    for child in children.flatten() {
                        out.push(child.path());
                    }
                }
                Err(_) => out.push(path),
            }
        } else {
            out.push(path);
        }
    }
    Ok(out)
}

#[derive(Default)]
struct Tally {
    bytes: u64,
    files: u64,
    unreadable: u64,
}

fn measure(path: &Path, tally: &mut Tally, visited: &mut u64) {
    *visited += 1;
    if *visited > MAX_INSPECTED_ENTRIES {
        tally.unreadable += 1;
        return;
    }
    let Ok(meta) = fs::symlink_metadata(path) else {
        tally.unreadable += 1;
        return;
    };
    // Links are never followed; their targets are not execs data.
    if metadata_is_link(&meta) {
        return;
    }
    if meta.is_file() {
        tally.bytes += meta.len();
        tally.files += 1;
        return;
    }
    if !meta.is_dir() {
        return;
    }
    match fs::read_dir(path) {
        Ok(children) => {
            for child in children {
                match child {
                    Ok(child) => measure(&child.path(), tally, visited),
                    Err(_) => tally.unreadable += 1,
                }
            }
        }
        Err(_) => tally.unreadable += 1,
    }
}

/// Read-only: sizes every group without writing anything.
pub fn inspect_storage(data_dir: &Path) -> io::Result<StorageReport> {
    let mut tallies: Vec<(StorageGroupId, Tally)> = StorageGroupId::ALL
        .iter()
        .map(|id| (*id, Tally::default()))
        .collect();
    let mut visited = 0u64;
    let list = match entries(data_dir) {
        Ok(list) => list,
        Err(err) if err.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(err) => return Err(err),
    };
    for path in list {
        let id = classify(data_dir, &path);
        let tally = &mut tallies
            .iter_mut()
            .find(|(group, _)| *group == id)
            .expect("every group has a tally")
            .1;
        measure(&path, tally, &mut visited);
    }
    let groups: Vec<StorageGroup> = tallies
        .into_iter()
        .map(|(id, tally)| StorageGroup {
            id,
            bytes: tally.bytes,
            files: tally.files,
            unreadable: tally.unreadable,
            clearable: id.clearable(),
        })
        .collect();
    Ok(StorageReport {
        total_bytes: groups.iter().map(|group| group.bytes).sum(),
        clearable_bytes: groups
            .iter()
            .filter(|group| group.clearable)
            .map(|group| group.bytes)
            .sum(),
        partial: groups.iter().any(|group| group.unreadable > 0),
        groups,
    })
}

/// Delete rebuildable downloads and retired leftovers, one entry at a time.
/// A failure keeps that entry and continues; nothing outside the data
/// directory, and no link, is ever followed.
pub fn clear_download_caches(data_dir: &Path) -> io::Result<ClearReport> {
    let mut report = ClearReport {
        freed_bytes: 0,
        failed: Vec::new(),
    };
    let list = match entries(data_dir) {
        Ok(list) => list,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(report),
        Err(err) => return Err(err),
    };
    for path in list {
        if !classify(data_dir, &path).clearable() {
            continue;
        }
        let mut tally = Tally::default();
        let mut visited = 0;
        measure(&path, &mut tally, &mut visited);
        let removed = match fs::symlink_metadata(&path) {
            Ok(meta) if metadata_is_link(&meta) => continue,
            Ok(meta) if meta.is_dir() => remove_tree_within(data_dir, &path),
            Ok(_) => remove_file_force_within(data_dir, &path),
            Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
            Err(err) => Err(err),
        };
        match removed {
            Ok(()) => report.freed_bytes += tally.bytes,
            Err(_) => report.failed.push(rel(data_dir, &path)),
        }
    }
    report.failed.sort();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, bytes: usize) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![7u8; bytes]).unwrap();
    }

    fn fixture() -> PathBuf {
        let dir = crate::test_temp_dir();
        write(&dir, "settings.json", 10);
        write(&dir, "profiles/index.json", 100);
        write(&dir, "profiles/a/manifest.json", 200);
        write(&dir, "logs/panic.log", 5);
        write(&dir, "restore-points/0123.zip", 11);
        write(&dir, "maintenance/journal.json", 7);
        write(&dir, "hud-catalog/catalog-v4.json", 1000);
        write(&dir, "hud-catalog/schemas/flawhud.json", 300);
        write(&dir, "crosshair-cache/abc-dot.vtf", 40);
        write(&dir, "studio/previews/scout.png", 60);
        write(&dir, "hitsound-cache/comfig-index-1.json", 20);
        write(&dir, "hitsound-cache/picked/0123.wav", 30);
        write(&dir, &format!("preloader/mods-{MODS_RELEASE}.zip"), 500);
        write(&dir, "preloader/state.json", 3);
        write(&dir, "preloader/gameinfo.original.txt", 4);
        write(&dir, "preloader/originals/tf2_misc_000.vpk.snap", 9);
        let flat = flat_textures::cache_path(&dir);
        fs::write(flat, vec![1u8; 80]).unwrap();
        write(&dir, "preloader/unknown.bin", 2);
        dir
    }

    fn group(report: &StorageReport, id: StorageGroupId) -> &StorageGroup {
        report.groups.iter().find(|group| group.id == id).unwrap()
    }

    #[test]
    fn classifies_every_entry_from_its_actual_use() {
        let dir = fixture();
        let report = inspect_storage(&dir).unwrap();
        assert_eq!(group(&report, StorageGroupId::Profiles).bytes, 300);
        assert_eq!(group(&report, StorageGroupId::Downloads).bytes, 1380);
        assert_eq!(group(&report, StorageGroupId::Retired).bytes, 120);
        assert_eq!(group(&report, StorageGroupId::Logs).bytes, 5);
        assert_eq!(group(&report, StorageGroupId::RestorePoints).bytes, 11);
        assert_eq!(
            group(&report, StorageGroupId::Protected).bytes,
            7 + 30 + 500 + 3 + 4 + 9
        );
        assert_eq!(group(&report, StorageGroupId::Other).bytes, 12);
        assert_eq!(report.clearable_bytes, 1500);
        assert_eq!(report.total_bytes, 300 + 11 + 1380 + 120 + 5 + 553 + 12);
        assert!(!report.partial);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn clearing_keeps_profiles_recovery_picked_sounds_and_the_legacy_library() {
        let dir = fixture();
        let cleared = clear_download_caches(&dir).unwrap();
        assert_eq!(cleared.freed_bytes, 1500);
        assert!(cleared.failed.is_empty());
        for kept in [
            "settings.json",
            "profiles/a/manifest.json",
            "logs/panic.log",
            "restore-points/0123.zip",
            "maintenance/journal.json",
            "hitsound-cache/picked/0123.wav",
            &format!("preloader/mods-{MODS_RELEASE}.zip"),
            "preloader/state.json",
            "preloader/gameinfo.original.txt",
            "preloader/originals/tf2_misc_000.vpk.snap",
            "preloader/unknown.bin",
        ] {
            assert!(dir.join(kept).is_file(), "{kept} must be kept");
        }
        for gone in [
            "hud-catalog",
            "crosshair-cache",
            "studio",
            "hitsound-cache/comfig-index-1.json",
        ] {
            assert!(!dir.join(gone).exists(), "{gone} must be cleared");
        }
        assert!(!flat_textures::cache_path(&dir).exists());
        let after = inspect_storage(&dir).unwrap();
        assert_eq!(after.clearable_bytes, 0);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_data_directory_reports_nothing() {
        let dir = crate::test_temp_dir().join("absent");
        let report = inspect_storage(&dir).unwrap();
        assert_eq!(report.total_bytes, 0);
        assert_eq!(clear_download_caches(&dir).unwrap().freed_bytes, 0);
    }

    #[cfg(unix)]
    #[test]
    fn links_are_neither_measured_nor_followed_when_clearing() {
        let dir = fixture();
        let outside = crate::test_temp_dir();
        write(&outside, "precious.bin", 50);
        std::os::unix::fs::symlink(&outside, dir.join("hud-catalog/linked")).unwrap();
        let report = inspect_storage(&dir).unwrap();
        assert_eq!(group(&report, StorageGroupId::Downloads).bytes, 1380);
        let cleared = clear_download_caches(&dir).unwrap();
        assert_eq!(cleared.failed, vec!["hud-catalog".to_string()]);
        assert!(outside.join("precious.bin").is_file());
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
