//! Inventory the live file-safe TF2 surface for save-current (RND-148).
//!
//! Read-only. Does not write the game folder or the profile library.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::profile::{
    is_forbidden_rel_path, is_shared_file_name, normalize_rel_path, ProfileError, SHARED_VPK_NAME,
};

const OVERRIDE_NAMES: &[&str] = &[
    "autoexec.cfg",
    "scout.cfg",
    "soldier.cfg",
    "pyro.cfg",
    "demoman.cfg",
    "heavyweapons.cfg",
    "engineer.cfg",
    "medic.cfg",
    "sniper.cfg",
    "spy.cfg",
    "game_overrides.cfg",
    "modules.cfg",
    "pre_init.cfg",
    "setup_hook.cfg",
    "listenserver.cfg",
];

const STOCK_CFG: &[&str] = &[
    "config.cfg",
    "config_default.cfg",
    "360controller.cfg",
    "360controller-linux.cfg",
    "undo360controller.cfg",
    "valve.rc",
    "skill.cfg",
    "skill_manifest.cfg",
    "joystick.cfg",
    "mtp.cfg",
    "replay.cfg",
    "sourcevr.cfg",
    "sourcevr_tf.cfg",
];

const JUNK_NAMES: &[&str] = &[
    ".ds_store",
    "thumbs.db",
    "desktop.ini",
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "__macosx",
    "sound.cache",
];

const SKIP_CFG_DIRS: &[&str] = &["user", "app", "overrides"];

/// Files under `tf/custom/` the app owns for the whole install rather than
/// per profile. The preloader's addon pack pairs with particle patches inside
/// the official VPKs, which are global too — letting a profile claim it would
/// mean a switch deletes the pack while the patches stay, leaving particles
/// pointing at materials that no longer exist. Keeping it out of the surface
/// also stops absorb from prompting to adopt it after every install.
pub const GLOBAL_CUSTOM_FILES: &[&str] = &["tf/custom/execs-preloader.vpk"];

pub fn is_global_custom_file(rel: &str) -> bool {
    GLOBAL_CUSTOM_FILES
        .iter()
        .any(|path| path.eq_ignore_ascii_case(rel))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CfgLayer {
    Comfig,
    Vanilla,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InventoryEntry {
    pub dest_rel: String,
    pub source: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveInventory {
    pub layer: CfgLayer,
    pub entries: Vec<InventoryEntry>,
    pub skipped: Vec<String>,
}

pub fn inventory_live_surface(tf2_root: &Path) -> Result<LiveInventory, ProfileError> {
    inventory_live_surface_with(tf2_root, None)
}

pub fn inventory_live_surface_with(
    tf2_root: &Path,
    cloud_config: Option<&Path>,
) -> Result<LiveInventory, ProfileError> {
    let layer = detect_layer(tf2_root);
    let mut dests = BTreeMap::new();
    let mut skipped = Vec::new();
    let mut visited = HashSet::new();

    collect_config_cfg(tf2_root, cloud_config, &mut dests, &mut skipped, true)?;
    if layer == CfgLayer::Comfig {
        collect_overrides(tf2_root, &mut dests, &mut skipped, &mut visited)?;
        collect_root_user_cfgs(tf2_root, &mut dests, &mut skipped, true)?;
    } else {
        collect_vanilla_cfgs(tf2_root, &mut dests, &mut skipped, true)?;
    }
    collect_custom(tf2_root, &mut dests, &mut skipped, &mut visited)?;
    collect_migrate(
        tf2_root,
        layer,
        "user",
        &mut dests,
        &mut skipped,
        &mut visited,
    )?;
    collect_migrate(
        tf2_root,
        layer,
        "app",
        &mut dests,
        &mut skipped,
        &mut visited,
    )?;

    Ok(LiveInventory {
        layer,
        entries: dests.into_values().collect(),
        skipped,
    })
}

fn detect_layer(tf2_root: &Path) -> CfgLayer {
    if tf2_root.join("tf").join("cfg").join("overrides").is_dir() {
        return CfgLayer::Comfig;
    }
    let custom = tf2_root.join("tf").join("custom");
    if let Ok(entries) = fs::read_dir(&custom) {
        for entry in entries.flatten() {
            if is_mastercomfig_vpk(&entry.file_name().to_string_lossy()) {
                return CfgLayer::Comfig;
            }
        }
    }
    CfgLayer::Vanilla
}

fn is_mastercomfig_vpk(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("mastercomfig-") && lower.ends_with(".vpk")
}

fn collect_config_cfg(
    tf2_root: &Path,
    cloud_config: Option<&Path>,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    critical: bool,
) -> Result<(), ProfileError> {
    let live = tf2_root.join("tf").join("cfg").join("config.cfg");
    if live.is_file() {
        return take_file(
            tf2_root,
            &live,
            Some("tf/cfg/config.cfg"),
            dests,
            skipped,
            critical,
        );
    }
    if let Some(cloud) = cloud_config {
        if cloud.is_file() {
            return take_file(
                tf2_root,
                cloud,
                Some("tf/cfg/config.cfg"),
                dests,
                skipped,
                critical,
            );
        }
    }
    Ok(())
}

fn collect_overrides(
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
) -> Result<(), ProfileError> {
    let dir = tf2_root.join("tf").join("cfg").join("overrides");
    if !dir.exists() {
        return Ok(());
    }
    walk_tree(&dir, tf2_root, dests, skipped, visited, true)
}

fn collect_root_user_cfgs(
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    critical: bool,
) -> Result<(), ProfileError> {
    let cfg = tf2_root.join("tf").join("cfg");
    if !cfg.is_dir() {
        return Ok(());
    }
    let entries = match fs::read_dir(&cfg) {
        Ok(entries) => entries,
        Err(err) => {
            return if critical {
                Err(ProfileError::Io(err.to_string()))
            } else {
                skipped.push(format!("tf/cfg ({err})"));
                Ok(())
            };
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                if critical {
                    return Err(ProfileError::Io(err.to_string()));
                }
                skipped.push(format!("tf/cfg ({err})"));
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_user_cfg(&name) {
            continue;
        }
        take_file(tf2_root, &path, None, dests, skipped, critical)?;
    }
    Ok(())
}

fn collect_vanilla_cfgs(
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    critical: bool,
) -> Result<(), ProfileError> {
    let cfg = tf2_root.join("tf").join("cfg");
    if !cfg.is_dir() {
        return Ok(());
    }
    collect_root_user_cfgs(tf2_root, dests, skipped, critical)?;
    let entries = match fs::read_dir(&cfg) {
        Ok(entries) => entries,
        Err(err) => {
            return if critical {
                Err(ProfileError::Io(err.to_string()))
            } else {
                Ok(())
            };
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !path.is_dir() || is_skip_cfg_dir(&name) || is_junk_name(&name) {
            continue;
        }
        let children = match fs::read_dir(&path) {
            Ok(children) => children,
            Err(err) => {
                if critical {
                    return Err(ProfileError::Io(err.to_string()));
                }
                skipped.push(format!("tf/cfg/{name} ({err})"));
                continue;
            }
        };
        for child in children.flatten() {
            let child_path = child.path();
            if !child_path.is_file() {
                continue;
            }
            let child_name = child.file_name().to_string_lossy().into_owned();
            if !is_user_cfg(&child_name) {
                continue;
            }
            take_file(tf2_root, &child_path, None, dests, skipped, critical)?;
        }
    }
    Ok(())
}

fn collect_custom(
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
) -> Result<(), ProfileError> {
    let dir = tf2_root.join("tf").join("custom");
    if !dir.exists() {
        return Ok(());
    }
    walk_tree(&dir, tf2_root, dests, skipped, visited, false)?;
    // Not "skipped" — these are deliberately install-wide, not a problem to
    // report, so they leave no trace in the profile surface at all.
    dests.retain(|rel, _| !is_global_custom_file(rel));
    Ok(())
}

fn collect_migrate(
    tf2_root: &Path,
    layer: CfgLayer,
    kind: &str,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
) -> Result<(), ProfileError> {
    let dir = tf2_root.join("tf").join("cfg").join(kind);
    if !dir.is_dir() {
        return Ok(());
    }
    let mut migrated = BTreeMap::new();
    walk_tree(&dir, tf2_root, &mut migrated, skipped, visited, false)?;
    for (_, entry) in migrated {
        let Some(inner) = strip_cfg_kind_prefix(&entry.dest_rel, kind) else {
            skipped.push(entry.dest_rel);
            continue;
        };
        let dest = migrate_dest(layer, kind, &inner, |path| dests.contains_key(path));
        take_file(tf2_root, &entry.source, Some(&dest), dests, skipped, false)?;
    }
    Ok(())
}

fn strip_cfg_kind_prefix(dest_rel: &str, kind: &str) -> Option<String> {
    let prefix = format!("tf/cfg/{kind}/");
    let rest = dest_rel
        .strip_prefix(&prefix)
        .or_else(|| dest_rel.strip_prefix(&prefix.to_ascii_lowercase()))?;
    let rest = rest.strip_prefix("overrides/").unwrap_or(rest);
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

fn migrate_dest(
    layer: CfgLayer,
    kind: &str,
    inner: &str,
    dest_taken: impl FnOnce(&str) -> bool,
) -> String {
    let preferred = match layer {
        CfgLayer::Comfig => format!("tf/cfg/overrides/{inner}"),
        CfgLayer::Vanilla => format!("tf/cfg/{inner}"),
    };
    if dest_taken(&preferred) {
        match layer {
            CfgLayer::Comfig => format!("tf/cfg/overrides/.migrated/{kind}/{inner}"),
            CfgLayer::Vanilla => format!("tf/cfg/.migrated/{kind}/{inner}"),
        }
    } else {
        preferred
    }
}

fn walk_tree(
    dir: &Path,
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
    critical: bool,
) -> Result<(), ProfileError> {
    if let Some(canon) = canonicalize_if_within(dir, tf2_root) {
        if !visited.insert(canon) {
            return Ok(());
        }
    } else if is_symlink(dir) {
        skipped.push(format!(
            "escaped symlink: {}",
            dest_rel_or_display(tf2_root, dir)
        ));
        return Ok(());
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            return if critical {
                Err(ProfileError::Io(err.to_string()))
            } else {
                skipped.push(format!("{} ({err})", dest_rel_or_display(tf2_root, dir)));
                Ok(())
            };
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                if critical {
                    return Err(ProfileError::Io(err.to_string()));
                }
                skipped.push(format!("{} ({err})", dest_rel_or_display(tf2_root, dir)));
                continue;
            }
        };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_junk_name(&name) {
            skipped.push(dest_rel_or_display(tf2_root, &path));
            continue;
        }
        if is_symlink(&path) && !is_within_root(&path, tf2_root) {
            skipped.push(format!(
                "escaped symlink: {}",
                dest_rel_or_display(tf2_root, &path)
            ));
            continue;
        }
        if path.is_dir() {
            walk_tree(&path, tf2_root, dests, skipped, visited, critical)?;
            continue;
        }
        if path.is_file() {
            take_file(tf2_root, &path, None, dests, skipped, critical)?;
        }
    }
    Ok(())
}

fn take_file(
    tf2_root: &Path,
    source: &Path,
    dest_rel: Option<&str>,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    critical: bool,
) -> Result<(), ProfileError> {
    let dest = match dest_rel {
        Some(dest) => normalize_rel_path(dest)?,
        None => match dest_rel_from_root(tf2_root, source) {
            Ok(dest) => dest,
            Err(_) => {
                skipped.push(source.display().to_string());
                return Ok(());
            }
        },
    };
    let dest = canonicalize_shared_dest(dest);
    if is_junk_name(file_name(&dest)) || is_forbidden_rel_path(&dest) {
        skipped.push(dest);
        return Ok(());
    }
    if dests.contains_key(&dest) {
        return Ok(());
    }
    if !source.is_file() {
        if critical {
            return Err(ProfileError::Io(format!(
                "Could not read {}",
                source.display()
            )));
        }
        skipped.push(dest);
        return Ok(());
    }
    if File::open(source).is_err() {
        if critical {
            return Err(ProfileError::Io(format!(
                "Could not read {}",
                source.display()
            )));
        }
        skipped.push(dest);
        return Ok(());
    }
    dests.insert(
        dest.clone(),
        InventoryEntry {
            dest_rel: dest,
            source: source.to_path_buf(),
        },
    );
    Ok(())
}

fn dest_rel_from_root(tf2_root: &Path, path: &Path) -> Result<String, ProfileError> {
    let rel = path
        .strip_prefix(tf2_root)
        .map_err(|_| ProfileError::InvalidPath)?;
    normalize_rel_path(&rel.to_string_lossy().replace('\\', "/"))
}

fn dest_rel_or_display(tf2_root: &Path, path: &Path) -> String {
    dest_rel_from_root(tf2_root, path).unwrap_or_else(|_| path.display().to_string())
}

fn canonicalize_shared_dest(dest: String) -> String {
    if dest.rsplit('/').next().is_some_and(is_shared_file_name) {
        format!("tf/custom/{SHARED_VPK_NAME}")
    } else {
        dest
    }
}

fn is_user_cfg(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with(".cfg") {
        return false;
    }
    if is_stock_cfg(&lower) {
        return false;
    }
    if OVERRIDE_NAMES
        .iter()
        .any(|item| item.eq_ignore_ascii_case(name))
    {
        return true;
    }
    true
}

fn is_stock_cfg(lower_name: &str) -> bool {
    if STOCK_CFG.iter().any(|item| *item == lower_name) {
        return true;
    }
    (lower_name.starts_with("chapter") && lower_name.ends_with(".cfg"))
        || (lower_name.starts_with("sourcevr") && lower_name.ends_with(".cfg"))
}

fn is_junk_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if JUNK_NAMES.contains(&lower.as_str()) {
        return true;
    }
    lower.ends_with(".cache") || lower.ends_with(".ztmp") || lower.ends_with(".bak")
}

fn is_skip_cfg_dir(name: &str) -> bool {
    SKIP_CFG_DIRS
        .iter()
        .any(|item| item.eq_ignore_ascii_case(name))
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

fn canonicalize_if_within(path: &Path, tf2_root: &Path) -> Option<PathBuf> {
    if !is_within_root(path, tf2_root) {
        return None;
    }
    fs::canonicalize(path).ok()
}

fn is_within_root(path: &Path, tf2_root: &Path) -> bool {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let root = fs::canonicalize(tf2_root).unwrap_or_else(|_| tf2_root.to_path_buf());
    path_is_under(&root, &resolved)
}

fn path_is_under(root: &Path, path: &Path) -> bool {
    let root: Vec<_> = root.components().collect();
    let path: Vec<_> = path.components().collect();
    path.len() >= root.len() && path.iter().zip(&root).all(|(a, b)| a == b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    fn dests(inventory: &LiveInventory) -> Vec<&str> {
        inventory
            .entries
            .iter()
            .map(|entry| entry.dest_rel.as_str())
            .collect()
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    /// The preloader pack is install-wide: profiles must not see it, so
    /// absorb never offers to adopt it and a switch never deletes it out
    /// from under the particle patches it pairs with.
    #[test]
    fn preloader_pack_stays_out_of_the_profile_surface() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_file(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_file(&root.join("tf/custom/execs-preloader.vpk"), "global\n");
        write_file(&root.join("tf/custom/execs-preloader.vpk.sound.cache"), "x\n");
        // Profile-owned packs must still be collected.
        write_file(&root.join("tf/custom/execs-viewmodels.vpk"), "owned\n");
        write_file(&root.join("tf/custom/myhud/info.vdf"), "hud\n");

        let inventory = inventory_live_surface(&root).unwrap();
        let taken = dests(&inventory);
        assert!(!taken.contains(&"tf/custom/execs-preloader.vpk"));
        assert!(taken.contains(&"tf/custom/execs-viewmodels.vpk"));
        assert!(taken.contains(&"tf/custom/myhud/info.vdf"));
        // Deliberate, not a reported problem. (Its `.sound.cache` sibling is
        // listed as junk like every other one — that part is expected.)
        assert!(!inventory
            .skipped
            .iter()
            .any(|rel| rel.starts_with("tf/custom/execs-preloader.vpk")
                && !rel.ends_with(".cache")));
        cleanup(&dir);
    }

    /// Drift guard: the surface exclusion and the writer must name the same
    /// file, or the pack silently becomes profile-owned again.
    #[test]
    fn global_custom_list_matches_the_preloader_writer() {
        assert!(is_global_custom_file(&format!(
            "tf/custom/{}",
            crate::preloader::PRELOADER_VPK
        )));
    }

    #[test]
    fn vanilla_takes_user_cfgs_custom_and_skips_stock() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_file(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_file(&root.join("tf/cfg/autoexec.cfg"), "fov_desired 90\n");
        write_file(&root.join("tf/cfg/binds.cfg"), "bind w +forward\n");
        write_file(&root.join("tf/cfg/extra/net.cfg"), "cl_cmdrate 66\n");
        write_file(&root.join("tf/cfg/extra/deep/too_far.cfg"), "skip\n");
        write_file(&root.join("tf/cfg/config_default.cfg"), "stock\n");
        write_file(&root.join("tf/cfg/video.txt"), "video\n");
        write_file(&root.join("tf/steam.inf"), "appID=440\n");
        write_file(
            &root.join("tf/custom/hud/resource/ui/hudlayout.res"),
            "hud\n",
        );
        write_file(&root.join("tf/custom/.DS_Store"), "junk\n");
        write_file(&root.join("tf/tf2_misc_dir.vpk"), "official\n");

        let inventory = inventory_live_surface(&root).unwrap();
        assert_eq!(inventory.layer, CfgLayer::Vanilla);
        let paths = dests(&inventory);
        assert!(paths.contains(&"tf/cfg/config.cfg"));
        assert!(paths.contains(&"tf/cfg/autoexec.cfg"));
        assert!(paths.contains(&"tf/cfg/binds.cfg"));
        assert!(paths.contains(&"tf/cfg/extra/net.cfg"));
        assert!(paths.contains(&"tf/custom/hud/resource/ui/hudlayout.res"));
        assert!(!paths.iter().any(|path| path.contains("too_far")));
        assert!(!paths.iter().any(|path| path.contains("config_default")));
        assert!(!paths.iter().any(|path| path.contains("video.txt")));
        assert!(!paths.iter().any(|path| path.contains("steam.inf")));
        assert!(!paths.iter().any(|path| path.contains("tf2_misc_dir")));
        assert!(inventory
            .skipped
            .iter()
            .any(|item| item.contains(".DS_Store") || item.contains(".ds_store")));
        cleanup(&dir);
    }

    #[test]
    fn comfig_mode_from_overrides_and_shared_vpk_name() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_file(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_file(&root.join("tf/cfg/overrides/modules.cfg"), "modules\n");
        write_file(&root.join("tf/cfg/binds.cfg"), "bind w +forward\n");
        write_file(&root.join("tf/custom/Mastercomfig-Base.vpk"), "vpk\n");
        write_file(&root.join("tf/custom/mastercomfig-high.vpk"), "high\n");
        write_file(&root.join("tf/custom/toonhud.vpk"), "hud\n");

        let inventory = inventory_live_surface(&root).unwrap();
        assert_eq!(inventory.layer, CfgLayer::Comfig);
        let paths = dests(&inventory);
        assert!(paths.contains(&"tf/cfg/overrides/autoexec.cfg"));
        assert!(paths.contains(&"tf/cfg/overrides/modules.cfg"));
        assert!(paths.contains(&"tf/cfg/binds.cfg"));
        assert!(paths.contains(&"tf/custom/mastercomfig-base.vpk"));
        assert!(paths.contains(&"tf/custom/mastercomfig-high.vpk"));
        assert!(paths.contains(&"tf/custom/toonhud.vpk"));
        let shared = inventory
            .entries
            .iter()
            .find(|entry| entry.dest_rel == "tf/custom/mastercomfig-base.vpk")
            .unwrap();
        assert!(shared
            .source
            .file_name()
            .unwrap()
            .to_string_lossy()
            .eq_ignore_ascii_case("Mastercomfig-Base.vpk"));
        cleanup(&dir);
    }

    #[test]
    fn migrates_user_and_parks_collisions() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_file(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "live autoexec\n",
        );
        write_file(&root.join("tf/cfg/user/autoexec.cfg"), "old autoexec\n");
        write_file(&root.join("tf/cfg/user/extra/net.cfg"), "old net\n");
        write_file(&root.join("tf/cfg/app/scout.cfg"), "old scout\n");

        let inventory = inventory_live_surface(&root).unwrap();
        assert_eq!(inventory.layer, CfgLayer::Comfig);
        let paths = dests(&inventory);
        assert!(paths.contains(&"tf/cfg/overrides/autoexec.cfg"));
        assert!(paths.contains(&"tf/cfg/overrides/.migrated/user/autoexec.cfg"));
        assert!(paths.contains(&"tf/cfg/overrides/extra/net.cfg"));
        assert!(paths.contains(&"tf/cfg/overrides/scout.cfg"));
        assert!(!paths.iter().any(|path| path.starts_with("tf/cfg/user/")));
        assert!(!paths.iter().any(|path| path.starts_with("tf/cfg/app/")));
        cleanup(&dir);
    }

    #[test]
    fn vanilla_migrate_and_cloud_config_fallback() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_file(&root.join("tf/cfg/user/autoexec.cfg"), "migrated\n");
        write_file(&root.join("tf/custom/pack/note.txt"), "custom\n");
        let cloud = dir.join("cloud").join("config.cfg");
        write_file(&cloud, "cloud cfg\n");

        let inventory = inventory_live_surface_with(&root, Some(&cloud)).unwrap();
        assert_eq!(inventory.layer, CfgLayer::Vanilla);
        let paths = dests(&inventory);
        assert!(paths.contains(&"tf/cfg/config.cfg"));
        assert!(paths.contains(&"tf/cfg/autoexec.cfg"));
        assert!(paths.contains(&"tf/custom/pack/note.txt"));
        let cfg = inventory
            .entries
            .iter()
            .find(|entry| entry.dest_rel == "tf/cfg/config.cfg")
            .unwrap();
        assert_eq!(cfg.source, cloud);
        cleanup(&dir);
    }

    #[test]
    fn empty_custom_and_missing_config_are_ok() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        let inventory = inventory_live_surface(&root).unwrap();
        assert!(inventory.entries.is_empty());
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinks_that_escape_the_root() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        let outside = dir.join("outside.txt");
        write_file(&outside, "nope\n");
        std::os::unix::fs::symlink(&outside, root.join("tf/custom/escape.txt")).unwrap();
        write_file(&root.join("tf/custom/ok.txt"), "ok\n");

        let inventory = inventory_live_surface(&root).unwrap();
        let paths = dests(&inventory);
        assert!(paths.contains(&"tf/custom/ok.txt"));
        assert!(!paths.iter().any(|path| path.contains("escape")));
        assert!(inventory
            .skipped
            .iter()
            .any(|item| item.contains("escaped symlink")));
        cleanup(&dir);
    }
}
