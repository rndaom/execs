//! Inventory the live file-safe TF2 surface for save-current (RND-148).
//!
//! Read-only. Does not write the game folder or the profile library.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::hash::PART_SUFFIX;
use crate::profile::{
    is_file_safe_rel_path, is_shared_file_name, normalize_rel_path, ProfileError, SHARED_VPK_NAME,
};

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

// Keep the live-tree walk within the same order of magnitude as an imported
// profile. These count every visited directory entry (including junk), not
// only accepted files, so a wide tree cannot consume unbounded time or memory.
const MAX_SURFACE_ENTRIES: usize = 40_000;
const MAX_SURFACE_FILES: usize = 20_000;
const MAX_SURFACE_PATH_BYTES: usize = 8 * 1024 * 1024;
const MAX_SURFACE_PATH_DEPTH: usize = 64;
const MAX_SKIPPED_ENTRIES: usize = 256;
const MAX_SKIPPED_BYTES: usize = 64 * 1024;
const SURFACE_LIMIT_PREFIX: &str = "TF2's customization tree has ";
const SKIPPED_OMITTED: &str = "Additional skipped paths were omitted";

#[derive(Debug, Clone, Copy)]
struct InventoryLimits {
    entries: usize,
    files: usize,
    path_bytes: usize,
    depth: usize,
    skipped_entries: usize,
    skipped_bytes: usize,
}

const INVENTORY_LIMITS: InventoryLimits = InventoryLimits {
    entries: MAX_SURFACE_ENTRIES,
    files: MAX_SURFACE_FILES,
    path_bytes: MAX_SURFACE_PATH_BYTES,
    depth: MAX_SURFACE_PATH_DEPTH,
    skipped_entries: MAX_SKIPPED_ENTRIES,
    skipped_bytes: MAX_SKIPPED_BYTES,
};

#[derive(Debug)]
struct InventoryBudget {
    limits: InventoryLimits,
    entries: usize,
    path_bytes: usize,
    skipped_bytes: usize,
    skipped_truncated: bool,
}

impl InventoryBudget {
    fn new(limits: InventoryLimits) -> Self {
        Self {
            limits,
            entries: 0,
            path_bytes: 0,
            skipped_bytes: 0,
            skipped_truncated: false,
        }
    }

    fn enter_dir(&self, depth: usize) -> Result<(), ProfileError> {
        if depth > self.limits.depth {
            return Err(surface_limit_error("too many nested directories"));
        }
        Ok(())
    }

    fn visit_entry(&mut self, tf2_root: &Path, path: &Path) -> Result<(), ProfileError> {
        self.entries = self
            .entries
            .checked_add(1)
            .ok_or_else(|| surface_limit_error("too many directory entries"))?;
        if self.entries > self.limits.entries {
            return Err(surface_limit_error("too many directory entries"));
        }
        let relative = path.strip_prefix(tf2_root).unwrap_or(path);
        self.path_bytes = self
            .path_bytes
            .checked_add(relative.as_os_str().as_encoded_bytes().len())
            .ok_or_else(|| surface_limit_error("too much path data"))?;
        if self.path_bytes > self.limits.path_bytes {
            return Err(surface_limit_error("too much path data"));
        }
        Ok(())
    }

    fn record_file(&mut self, dest: &str, current_files: usize) -> Result<(), ProfileError> {
        if current_files >= self.limits.files {
            return Err(surface_limit_error("too many profile files"));
        }
        if dest.split('/').count() > self.limits.depth {
            return Err(surface_limit_error("a profile path is nested too deeply"));
        }
        self.path_bytes = self
            .path_bytes
            .checked_add(dest.len())
            .ok_or_else(|| surface_limit_error("too much path data"))?;
        if self.path_bytes > self.limits.path_bytes {
            return Err(surface_limit_error("too much path data"));
        }
        Ok(())
    }

    fn skip(&mut self, skipped: &mut Vec<String>, reason: String) {
        if self.skipped_truncated {
            return;
        }
        let next_bytes = self.skipped_bytes.checked_add(reason.len());
        if skipped.len() + 1 >= self.limits.skipped_entries
            || next_bytes.is_none_or(|bytes| bytes > self.limits.skipped_bytes)
        {
            self.skipped_truncated = true;
            let marker_bytes = self.skipped_bytes.checked_add(SKIPPED_OMITTED.len());
            if skipped.len() < self.limits.skipped_entries
                && marker_bytes.is_some_and(|bytes| bytes <= self.limits.skipped_bytes)
            {
                self.skipped_bytes = marker_bytes.unwrap_or(self.limits.skipped_bytes);
                skipped.push(SKIPPED_OMITTED.into());
            }
            return;
        }
        self.skipped_bytes = next_bytes.unwrap_or(self.limits.skipped_bytes);
        skipped.push(reason);
    }
}

fn surface_limit_error(reason: &str) -> ProfileError {
    ProfileError::Io(format!(
        "{SURFACE_LIMIT_PREFIX}{reason}; refusing to build a partial profile."
    ))
}

pub(crate) fn is_inventory_limit_error(error: &ProfileError) -> bool {
    matches!(error, ProfileError::Io(message) if message.starts_with(SURFACE_LIMIT_PREFIX))
}

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

/// Top-level `tf/custom/` entries that are never profile content. `readme.txt`
/// is Valve's own file and `workshop/` is where the game downloads Workshop
/// items; a Steam file verify restores both. Together with the `.execs-part`
/// side file [`crate::hash::write_atomic`] leaves behind when the app is killed
/// mid-copy, these are the three things that look like packs but are not: shown
/// as added packs they push the real question off the prompt, absorbed they
/// become profile files, and written by a switch they spread to every profile.
pub const STOCK_CUSTOM_ENTRIES: &[&str] = &["readme.txt", "workshop"];

/// True for a top-level `tf/custom/` entry name that is not profile content.
/// Also the shape of a pack key, so a stale `ignored_packs` entry can be
/// recognised and dropped.
pub fn is_stock_custom_pack(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let lower = lower.strip_prefix('-').unwrap_or(&lower);
    lower.ends_with(PART_SUFFIX) || STOCK_CUSTOM_ENTRIES.contains(&lower)
}

/// True for a relative path that is one of those entries: any `.execs-part`
/// side file anywhere, or anything under a stock `tf/custom/` entry.
pub fn is_stock_custom_entry(rel: &str) -> bool {
    let lower = rel.replace('\\', "/").to_ascii_lowercase();
    if lower.ends_with(PART_SUFFIX) {
        return true;
    }
    let Some(rest) = lower.strip_prefix("tf/custom/") else {
        return false;
    };
    is_stock_custom_pack(rest.split('/').next().unwrap_or_default())
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
    inventory_live_surface_opts(tf2_root, cloud_config, true)
}

/// The live surface as absorb sees it: what is actually at each profile
/// path, with **no** legacy migration. Migrating `tf/cfg/user/` and
/// `tf/cfg/app/` into the profile is a one-time decision made by Save
/// current as… and first run; re-applying it on every absorb copied the same
/// legacy `autoexec.cfg` into every profile the user ever switched to, since
/// the source file stays where it is (we never write `tf/cfg/user/`).
pub fn inventory_live_surface_for_absorb(
    tf2_root: &Path,
    cloud_config: Option<&Path>,
) -> Result<LiveInventory, ProfileError> {
    inventory_live_surface_opts(tf2_root, cloud_config, false)
}

fn inventory_live_surface_opts(
    tf2_root: &Path,
    cloud_config: Option<&Path>,
    migrate_legacy: bool,
) -> Result<LiveInventory, ProfileError> {
    inventory_live_surface_opts_with_limits(
        tf2_root,
        cloud_config,
        migrate_legacy,
        INVENTORY_LIMITS,
    )
}

fn inventory_live_surface_opts_with_limits(
    tf2_root: &Path,
    cloud_config: Option<&Path>,
    migrate_legacy: bool,
    limits: InventoryLimits,
) -> Result<LiveInventory, ProfileError> {
    let layer = detect_layer(tf2_root, limits)?;
    let mut dests = BTreeMap::new();
    let mut skipped = Vec::new();
    let mut visited = HashSet::new();
    let mut budget = InventoryBudget::new(limits);

    collect_config_cfg(
        tf2_root,
        cloud_config,
        &mut dests,
        &mut skipped,
        &mut budget,
        true,
    )?;
    if layer == CfgLayer::Comfig {
        collect_overrides(
            tf2_root,
            &mut dests,
            &mut skipped,
            &mut visited,
            &mut budget,
        )?;
        collect_root_user_cfgs(tf2_root, &mut dests, &mut skipped, &mut budget, true)?;
    } else {
        collect_vanilla_cfgs(tf2_root, &mut dests, &mut skipped, &mut budget, true)?;
    }
    collect_custom(
        tf2_root,
        &mut dests,
        &mut skipped,
        &mut visited,
        &mut budget,
    )?;
    if migrate_legacy {
        collect_migrate(
            tf2_root,
            layer,
            "user",
            &mut dests,
            &mut skipped,
            &mut visited,
            &mut budget,
        )?;
        collect_migrate(
            tf2_root,
            layer,
            "app",
            &mut dests,
            &mut skipped,
            &mut visited,
            &mut budget,
        )?;
    }

    Ok(LiveInventory {
        layer,
        entries: dests.into_values().collect(),
        skipped,
    })
}

fn detect_layer(tf2_root: &Path, limits: InventoryLimits) -> Result<CfgLayer, ProfileError> {
    let overrides = tf2_root.join("tf").join("cfg").join("overrides");
    if !is_symlink(&overrides) && is_within_root(&overrides, tf2_root) && overrides.is_dir() {
        return Ok(CfgLayer::Comfig);
    }
    let custom = tf2_root.join("tf").join("custom");
    if !is_symlink(&custom) && is_within_root(&custom, tf2_root) {
        if let Ok(entries) = fs::read_dir(&custom) {
            let mut budget = InventoryBudget::new(limits);
            for entry in entries.flatten() {
                budget.visit_entry(tf2_root, &entry.path())?;
                if entry.file_name().to_str().is_some_and(is_mastercomfig_vpk) {
                    return Ok(CfgLayer::Comfig);
                }
            }
        }
    }
    Ok(CfgLayer::Vanilla)
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
    budget: &mut InventoryBudget,
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
            budget,
            critical,
            false,
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
                budget,
                critical,
                false,
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
    budget: &mut InventoryBudget,
) -> Result<(), ProfileError> {
    let dir = tf2_root.join("tf").join("cfg").join("overrides");
    if !dir.exists() {
        return Ok(());
    }
    walk_tree(
        &dir, tf2_root, dests, skipped, visited, budget, true, false, false, 0,
    )
}

fn collect_root_user_cfgs(
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    budget: &mut InventoryBudget,
    critical: bool,
) -> Result<(), ProfileError> {
    let cfg = tf2_root.join("tf").join("cfg");
    if !cfg.is_dir() {
        return Ok(());
    }
    if is_symlink(&cfg) || !is_within_root(&cfg, tf2_root) {
        return Err(ProfileError::InvalidPath);
    }
    let entries = match fs::read_dir(&cfg) {
        Ok(entries) => entries,
        Err(err) => {
            return if critical {
                Err(ProfileError::Io(err.to_string()))
            } else {
                budget.skip(skipped, format!("tf/cfg ({err})"));
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
                budget.skip(skipped, format!("tf/cfg ({err})"));
                continue;
            }
        };
        let path = entry.path();
        budget.visit_entry(tf2_root, &path)?;
        if !path.is_file() {
            continue;
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| ProfileError::InvalidPath)?;
        if !is_user_cfg(&name) {
            continue;
        }
        take_file(
            tf2_root, &path, None, dests, skipped, budget, critical, false,
        )?;
    }
    Ok(())
}

fn collect_vanilla_cfgs(
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    budget: &mut InventoryBudget,
    critical: bool,
) -> Result<(), ProfileError> {
    let cfg = tf2_root.join("tf").join("cfg");
    if !cfg.is_dir() {
        return Ok(());
    }
    let mut visited = HashSet::new();
    walk_vanilla_cfgs(
        &cfg,
        tf2_root,
        dests,
        skipped,
        &mut visited,
        budget,
        critical,
        0,
    )
}

// Keep the walk's mutable security state explicit at each recursive call.
#[allow(clippy::too_many_arguments)]
fn walk_vanilla_cfgs(
    dir: &Path,
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
    budget: &mut InventoryBudget,
    critical: bool,
    depth: usize,
) -> Result<(), ProfileError> {
    budget.enter_dir(depth)?;
    if is_symlink(dir) {
        return Err(ProfileError::InvalidPath);
    }
    let Some(canon) = canonicalize_if_within(dir, tf2_root) else {
        return Err(ProfileError::InvalidPath);
    };
    if !visited.insert(canon) {
        return Ok(());
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            return if critical {
                Err(ProfileError::Io(err.to_string()))
            } else {
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
                budget.skip(
                    skipped,
                    format!("{} ({err})", dest_rel_or_display(tf2_root, dir)),
                );
                continue;
            }
        };
        let path = entry.path();
        budget.visit_entry(tf2_root, &path)?;
        if is_symlink(&path) || !is_within_root(&path, tf2_root) {
            return Err(ProfileError::InvalidPath);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| ProfileError::InvalidPath)?;
        if is_junk_name(&name) {
            budget.skip(skipped, dest_rel_or_display(tf2_root, &path));
            continue;
        }
        if path.is_dir() {
            if !is_skip_cfg_dir(&name) {
                walk_vanilla_cfgs(
                    &path,
                    tf2_root,
                    dests,
                    skipped,
                    visited,
                    budget,
                    critical,
                    depth.saturating_add(1),
                )?;
            }
            continue;
        }
        if path.is_file() && is_user_cfg(&name) {
            take_file(
                tf2_root, &path, None, dests, skipped, budget, critical, false,
            )?;
        }
    }
    Ok(())
}

fn collect_custom(
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
    budget: &mut InventoryBudget,
) -> Result<(), ProfileError> {
    let dir = tf2_root.join("tf").join("custom");
    if !dir
        .try_exists()
        .map_err(|err| ProfileError::Io(err.to_string()))?
    {
        return Ok(());
    }
    // An incomplete custom scan must not become a partial capture or an
    // absorb deletion. Junk/global entries are still deliberately excluded.
    walk_tree(
        &dir, tf2_root, dests, skipped, visited, budget, true, false, true, 0,
    )?;
    // Not "skipped" — the global pack is deliberately install-wide and the
    // stock entries belong to Valve or to an interrupted write of ours, so
    // neither is a problem to report and neither leaves a trace in the profile.
    dests.retain(|rel, _| !is_global_custom_file(rel) && !is_stock_custom_entry(rel));
    Ok(())
}

fn collect_migrate(
    tf2_root: &Path,
    layer: CfgLayer,
    kind: &str,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
    budget: &mut InventoryBudget,
) -> Result<(), ProfileError> {
    let dir = tf2_root.join("tf").join("cfg").join(kind);
    if !dir.is_dir() {
        return Ok(());
    }
    let mut migrated = BTreeMap::new();
    walk_tree(
        &dir,
        tf2_root,
        &mut migrated,
        skipped,
        visited,
        budget,
        false,
        true,
        false,
        0,
    )?;
    for (_, entry) in migrated {
        let Some(inner) = strip_cfg_kind_prefix(&entry.dest_rel, kind) else {
            budget.skip(skipped, entry.dest_rel);
            continue;
        };
        let dest = migrate_dest(layer, kind, &inner, |path| dests.contains_key(path));
        take_file(
            tf2_root,
            &entry.source,
            Some(&dest),
            dests,
            skipped,
            budget,
            false,
            false,
        )?;
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

/// `staging` walks a directory whose own layout is not itself file-safe
/// (`tf/cfg/user/`), collecting entries that `collect_migrate` immediately
/// re-destines. Every staged entry is re-gated by the second `take_file`.
// Keep the walk's mutable security state explicit at each recursive call.
#[allow(clippy::too_many_arguments)]
fn walk_tree(
    dir: &Path,
    tf2_root: &Path,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
    budget: &mut InventoryBudget,
    critical: bool,
    staging: bool,
    skip_stock_top_level: bool,
    depth: usize,
) -> Result<(), ProfileError> {
    budget.enter_dir(depth)?;
    if is_symlink(dir) {
        return Err(ProfileError::InvalidPath);
    }
    let Some(canon) = canonicalize_if_within(dir, tf2_root) else {
        return Err(ProfileError::InvalidPath);
    };
    if !visited.insert(canon) {
        return Ok(());
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            return if critical {
                Err(ProfileError::Io(err.to_string()))
            } else {
                budget.skip(
                    skipped,
                    format!("{} ({err})", dest_rel_or_display(tf2_root, dir)),
                );
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
                budget.skip(
                    skipped,
                    format!("{} ({err})", dest_rel_or_display(tf2_root, dir)),
                );
                continue;
            }
        };
        let path = entry.path();
        budget.visit_entry(tf2_root, &path)?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| ProfileError::InvalidPath)?;
        if skip_stock_top_level && depth == 0 && is_stock_custom_pack(&name) {
            continue;
        }
        if is_junk_name(&name) {
            budget.skip(skipped, dest_rel_or_display(tf2_root, &path));
            continue;
        }
        if is_global_custom_file(&dest_rel_or_display(tf2_root, &path)) {
            continue;
        }
        if is_symlink(&path) || !is_within_root(&path, tf2_root) {
            return Err(ProfileError::InvalidPath);
        }
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(err) if critical => {
                return Err(ProfileError::Io(format!(
                    "Could not read {} ({err})",
                    path.display()
                )));
            }
            Err(err) => {
                budget.skip(
                    skipped,
                    format!("{} ({err})", dest_rel_or_display(tf2_root, &path)),
                );
                continue;
            }
        };
        if metadata.is_dir() {
            walk_tree(
                &path,
                tf2_root,
                dests,
                skipped,
                visited,
                budget,
                critical,
                staging,
                false,
                depth.saturating_add(1),
            )?;
            continue;
        }
        if metadata.is_file() {
            take_file(
                tf2_root, &path, None, dests, skipped, budget, critical, staging,
            )?;
        }
    }
    Ok(())
}

// Keeping validation inputs separate makes each caller's trust boundary visible.
#[allow(clippy::too_many_arguments)]
fn take_file(
    tf2_root: &Path,
    source: &Path,
    dest_rel: Option<&str>,
    dests: &mut BTreeMap<String, InventoryEntry>,
    skipped: &mut Vec<String>,
    budget: &mut InventoryBudget,
    critical: bool,
    staging: bool,
) -> Result<(), ProfileError> {
    // Cloud config is the only intentional external source. Every implicit
    // surface path, and every explicit path lexically rooted at TF2, must still
    // resolve beneath that root and must not be a linked final component.
    if (dest_rel.is_none() || source.starts_with(tf2_root))
        && (is_symlink(source) || !is_within_root(source, tf2_root))
    {
        return Err(ProfileError::InvalidPath);
    }
    let dest = match dest_rel {
        Some(dest) => normalize_rel_path(dest)?,
        None => match dest_rel_from_root(tf2_root, source) {
            Ok(dest) => dest,
            Err(_) => {
                budget.skip(skipped, source.display().to_string());
                return Ok(());
            }
        },
    };
    let dest = canonicalize_shared_dest(dest);
    if is_global_custom_file(&dest) || is_stock_custom_entry(&dest) {
        return Ok(());
    }
    if is_junk_name(file_name(&dest)) || (!staging && !is_file_safe_rel_path(&dest)) {
        budget.skip(skipped, dest);
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
        budget.skip(skipped, dest);
        return Ok(());
    }
    if File::open(source).is_err() {
        if critical {
            return Err(ProfileError::Io(format!(
                "Could not read {}",
                source.display()
            )));
        }
        budget.skip(skipped, dest);
        return Ok(());
    }
    budget.record_file(&dest, dests.len())?;
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
    let rel = rel.to_str().ok_or(ProfileError::InvalidPath)?;
    normalize_rel_path(&rel.replace('\\', "/"))
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
    true
}

fn is_stock_cfg(lower_name: &str) -> bool {
    if STOCK_CFG.contains(&lower_name) {
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
        write_file(
            &root.join("tf/custom/execs-preloader.vpk.sound.cache"),
            "x\n",
        );
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
        assert!(!inventory.skipped.iter().any(|rel| rel
            .starts_with("tf/custom/execs-preloader.vpk")
            && !rel.ends_with(".cache")));
        cleanup(&dir);
    }

    /// Valve's own `tf/custom` entries and the side file a killed write leaves
    /// behind are not profile content: a profile that adopts them offers junk
    /// in the pack prompt and writes it back to every install it touches.
    #[test]
    fn stock_custom_entries_and_part_files_stay_out_of_the_surface() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_file(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_file(&root.join("tf/custom/readme.txt"), "valve\n");
        write_file(&root.join("tf/custom/workshop/12345/item.vpk"), "wshop\n");
        write_file(
            &root.join("tf/custom/execs-viewmodels.vpk.execs-part"),
            "half\n",
        );
        // A pack of the user's own may carry any of those names inside it.
        write_file(&root.join("tf/custom/myhud/readme.txt"), "mine\n");
        write_file(&root.join("tf/custom/myhud/info.vdf"), "hud\n");

        let inventory = inventory_live_surface(&root).unwrap();
        let taken = dests(&inventory);
        assert!(!taken.iter().any(|rel| rel.starts_with("tf/custom/readme")));
        assert!(!taken.iter().any(|rel| rel.contains("workshop")));
        assert!(!taken.iter().any(|rel| rel.ends_with(PART_SUFFIX)));
        assert!(taken.contains(&"tf/custom/myhud/readme.txt"));
        assert!(taken.contains(&"tf/custom/myhud/info.vdf"));
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
        assert!(paths.contains(&"tf/cfg/extra/deep/too_far.cfg"));
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

    #[test]
    fn rejects_an_ordinary_tree_deeper_than_the_surface_limit() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let mut nested = root.join("tf/cfg");
        for _ in 0..=MAX_SURFACE_PATH_DEPTH {
            nested.push("d");
        }
        write_file(&nested.join("deep.cfg"), "echo deep\n");

        let error = inventory_live_surface(&root).unwrap_err();
        assert!(is_inventory_limit_error(&error), "{error:?}");
        assert!(matches!(
            error,
            ProfileError::Io(message) if message.contains("too many nested directories")
        ));
        cleanup(&dir);
    }

    #[test]
    fn rejects_an_ordinary_tree_wider_than_the_entry_limit() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        for index in 0..5 {
            write_file(
                &root.join(format!("tf/cfg/user-{index}.cfg")),
                "echo wide\n",
            );
        }
        let limits = InventoryLimits {
            entries: 4,
            ..INVENTORY_LIMITS
        };

        let error = inventory_live_surface_opts_with_limits(&root, None, true, limits).unwrap_err();
        assert!(matches!(
            error,
            ProfileError::Io(message) if message.contains("too many directory entries")
        ));
        cleanup(&dir);
    }

    #[test]
    fn rejects_accumulated_path_data_over_the_limit() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_file(
            &root.join("tf/cfg/a-deliberately-long-config-name.cfg"),
            "echo path bytes\n",
        );
        let limits = InventoryLimits {
            path_bytes: 16,
            ..INVENTORY_LIMITS
        };

        let error = inventory_live_surface_opts_with_limits(&root, None, true, limits).unwrap_err();
        assert!(matches!(
            error,
            ProfileError::Io(message) if message.contains("too much path data")
        ));
        cleanup(&dir);
    }

    #[test]
    fn skipped_diagnostics_are_bounded() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        for index in 0..10 {
            write_file(&root.join(format!("tf/cfg/junk-{index}.bak")), "junk\n");
        }
        let limits = InventoryLimits {
            skipped_entries: 4,
            skipped_bytes: 1024,
            ..INVENTORY_LIMITS
        };

        let inventory = inventory_live_surface_opts_with_limits(&root, None, true, limits).unwrap();
        assert_eq!(inventory.skipped.len(), limits.skipped_entries);
        assert_eq!(
            inventory.skipped.last().map(String::as_str),
            Some(SKIPPED_OMITTED)
        );
        assert!(inventory.skipped.iter().map(String::len).sum::<usize>() <= limits.skipped_bytes);
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_escape_the_root() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf/custom")).unwrap();
        let outside = dir.join("outside.txt");
        write_file(&outside, "nope\n");
        std::os::unix::fs::symlink(&outside, root.join("tf/custom/escape.txt")).unwrap();
        write_file(&root.join("tf/custom/ok.txt"), "ok\n");

        assert_eq!(
            inventory_live_surface(&root).unwrap_err(),
            ProfileError::InvalidPath
        );
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_an_escaped_ancestor_instead_of_walking_through_it() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let outside_tf = dir.join("outside-tf");
        write_file(&outside_tf.join("custom/pack/file.txt"), "outside\n");
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&outside_tf, root.join("tf")).unwrap();

        assert_eq!(
            inventory_live_surface(&root).unwrap_err(),
            ProfileError::InvalidPath
        );
        cleanup(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_non_unicode_surface_names_instead_of_colliding_them() {
        use std::os::unix::ffi::OsStringExt;

        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let invalid = std::ffi::OsString::from_vec(b"pack-\xff.cfg".to_vec());
        write_file(
            &root.join("tf/custom").join(invalid),
            "unsafe to key lossily\n",
        );

        assert_eq!(
            inventory_live_surface(&root).unwrap_err(),
            ProfileError::InvalidPath
        );
        cleanup(&dir);
    }
}
