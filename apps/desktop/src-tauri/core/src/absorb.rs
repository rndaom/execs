//! Absorb live drift into the active profile (RND-150).
//!
//! Owned-file and `config.cfg` changes update the library automatically.
//! New or deleted `tf/custom/` packs wait for an Update / Keep choice.
//! Never rolls the live game folder back to an old snapshot.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apply::manifest_source_path;
use crate::finder::discover_steam_roots;
use crate::hash::{
    copy_verified_atomic_within, part_path, read_small_file_bounded, remove_file_force_within,
    sha256_file, validate_dir_within, write_atomic_within, MAX_CFG_FILE_BYTES, PART_SUFFIX,
};
use crate::launch::{cloud_config_path_from, find_cloud_config, find_cloud_config_from};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    is_profile_ownable_rel_path, load_library_from, load_manifest, mutate_profile_files_to,
    portable_path_key, profiles_dir, recover_profile_mutation_to, source_file_len, FileSource,
    ProfileError, ProfileFile, ProfileLibrary, ProfileLiveProjection,
};
use crate::surface::{
    inventory_live_surface_for_absorb, is_stock_custom_entry, is_stock_custom_pack,
};
use crate::switch::{live_candidates, live_path};

const CONFIG_CFG: &str = "tf/cfg/config.cfg";

/// Prefix of every pack the app builds and manages itself (viewmodels,
/// crosshairs, hitsounds, mods). The user adds and removes these through the
/// app, so one going missing is a failed write, not a deletion they made.
const APP_PACK_PREFIX: &str = "execs-";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PackChoice {
    Update,
    Keep,
    /// Put the removed packs back from the library. `packs_added` are left
    /// exactly as they are: neither absorbed nor ignored.
    Restore,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbsorbDelta {
    pub owned_changed: Vec<String>,
    pub owned_missing: Vec<String>,
    pub packs_added: Vec<String>,
    pub packs_removed: Vec<String>,
    pub config_cfg: bool,
}

impl AbsorbDelta {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn has_pack_changes(&self) -> bool {
        !self.packs_added.is_empty() || !self.packs_removed.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbsorbOwnedResult {
    pub library: ProfileLibrary,
    pub delta: AbsorbDelta,
    /// True only when this absorb observed and stored a changed config.cfg.
    pub config_cfg_absorbed: bool,
    /// Packs (or plain owned paths) this absorb rewrote from the library after
    /// an interrupted write. Empty on every ordinary pass.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repaired: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AbsorbOptions<'a> {
    pub cloud_config: Option<&'a Path>,
    pub steam_roots: Option<&'a [PathBuf]>,
}

/// Top-level `tf/custom/` pack identity. A leading `-` is the Source disable
/// prefix. Entries that belong to Valve or to an interrupted write of ours are
/// not packs at all: this is the one gate both the live scan and the manifest
/// go through, so junk can never be prompted for, absorbed, or grouped.
pub fn pack_key(rel: &str) -> Option<String> {
    if is_stock_custom_entry(rel) {
        return None;
    }
    let rest = rel.strip_prefix("tf/custom/")?;
    let first = rest.split('/').next()?;
    if first.is_empty() {
        return None;
    }
    let name = first.strip_prefix('-').unwrap_or(first);
    if name.is_empty() {
        return None;
    }
    if cfg!(windows) {
        Some(name.to_ascii_lowercase())
    } else {
        Some(name.to_string())
    }
}

pub fn write_config_cfg_dual(tf2_root: &Path, bytes: &[u8]) -> Result<(), ProfileError> {
    write_config_cfg_dual_to(tf2_root, bytes, &discover_steam_roots())
}

pub fn write_config_cfg_dual_to(
    tf2_root: &Path,
    bytes: &[u8],
    steam_roots: &[PathBuf],
) -> Result<(), ProfileError> {
    let live = tf2_root.join("tf").join("cfg").join("config.cfg");
    write_bytes(tf2_root, &live, bytes)?;
    if let Some(cloud) = cloud_config_path_from(steam_roots) {
        let cloud_root = steam_roots
            .iter()
            .find(|root| cloud.starts_with(root))
            .ok_or_else(|| {
                ProfileError::Io("Steam Cloud config resolved outside every Steam root".into())
            })?;
        write_bytes(cloud_root, &cloud, bytes)?;
    }
    Ok(())
}

pub fn scan_absorb_delta_to(
    profiles_dir: &Path,
    tf2_root: &Path,
    options: AbsorbOptions<'_>,
) -> Result<AbsorbDelta, ProfileError> {
    let Some(profile_id) = active_profile_id(profiles_dir, tf2_root)? else {
        return Ok(AbsorbDelta::empty());
    };
    let classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
    Ok(classified.delta)
}

pub fn absorb_owned(tf2_root: &Path) -> Result<AbsorbOwnedResult, ProfileError> {
    let cloud = find_cloud_config();
    absorb_owned_to(
        &profiles_dir(),
        tf2_root,
        live_process_names(),
        AbsorbOptions {
            cloud_config: cloud.as_deref(),
            steam_roots: None,
        },
    )
}

pub fn absorb_owned_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    running_names: I,
    options: AbsorbOptions<'_>,
) -> Result<AbsorbOwnedResult, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running = collect_running(running_names);
    refuse_if_running_among(&running)?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let Some(profile_id) = library.active_profile_id.clone() else {
        return Ok(AbsorbOwnedResult {
            library,
            delta: AbsorbDelta::empty(),
            config_cfg_absorbed: false,
            repaired: Vec::new(),
        });
    };

    // Before the delta is read off the live tree, put back what a killed write
    // left half-done — otherwise this pass reports the missing pack as deleted.
    let repaired = repair_interrupted_writes(profiles_dir, tf2_root, &profile_id, &running)?;
    let classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
    let config_cfg_absorbed = classified.delta.config_cfg;
    let pending_cloud_sync = load_manifest(profiles_dir, &profile_id)?.cloud_sync_pending;
    if config_cfg_absorbed && !pending_cloud_sync {
        set_cloud_sync_pending(profiles_dir, tf2_root, &profile_id, true, &running)?;
    }
    absorb_live_files(
        profiles_dir,
        tf2_root,
        &profile_id,
        &classified.delta.owned_changed,
        &classified.delta.owned_missing,
        &classified.live,
        &running,
    )?;

    // Only when config.cfg actually drifted. Unconditionally rewriting it put a
    // fresh mtime on a Steam Cloud file on every single boot.
    if config_cfg_absorbed {
        dual_write_config(tf2_root, &classified, &options)?;
        set_cloud_sync_pending(profiles_dir, tf2_root, &profile_id, false, &running)?;
    } else if pending_cloud_sync {
        retry_pending_cloud_sync(profiles_dir, tf2_root, &profile_id, &options)?;
        set_cloud_sync_pending(profiles_dir, tf2_root, &profile_id, false, &running)?;
    }

    let mut remaining = classified.delta;
    remaining.owned_changed.clear();
    remaining.owned_missing.clear();
    remaining.config_cfg = false;

    Ok(AbsorbOwnedResult {
        library: load_library_from(profiles_dir, Some(tf2_root))?,
        delta: remaining,
        config_cfg_absorbed,
        repaired,
    })
}

pub fn absorb_packs(tf2_root: &Path, choice: PackChoice) -> Result<ProfileLibrary, ProfileError> {
    let cloud = find_cloud_config();
    absorb_packs_to(
        &profiles_dir(),
        tf2_root,
        choice,
        live_process_names(),
        AbsorbOptions {
            cloud_config: cloud.as_deref(),
            steam_roots: None,
        },
    )
}

pub fn absorb_packs_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    choice: PackChoice,
    running_names: I,
    options: AbsorbOptions<'_>,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running = collect_running(running_names);
    refuse_if_running_among(&running)?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let Some(profile_id) = library.active_profile_id.clone() else {
        return Ok(library);
    };
    repair_interrupted_writes(profiles_dir, tf2_root, &profile_id, &running)?;
    if choice == PackChoice::Update {
        // Update is the user changing their mind about every pack they had
        // previously kept out, so the ignore list has to go before `classify`
        // filters those packs back out of the delta.
        let mut manifest = load_manifest(profiles_dir, &profile_id)?;
        if !manifest.ignored_packs.is_empty() {
            manifest.ignored_packs.clear();
            crate::profile::save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
        }
    }

    let classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
    if choice == PackChoice::Restore {
        // The removed packs are still in the manifest, so the library still
        // holds their bytes. Added packs are not part of this answer.
        let paths: Vec<String> = classified
            .delta
            .packs_removed
            .iter()
            .flat_map(|pack| {
                classified
                    .pack_manifest_files
                    .get(pack)
                    .into_iter()
                    .flatten()
            })
            .cloned()
            .collect();
        write_library_files_to_live(profiles_dir, tf2_root, &profile_id, &paths)?;
        return load_library_from(profiles_dir, Some(tf2_root));
    }
    if choice == PackChoice::Keep {
        // Record exactly what was on screen. Anything that appears later is a
        // new decision, not a re-prompt of this one.
        let mut manifest = load_manifest(profiles_dir, &profile_id)?;
        let before = manifest.ignored_packs.len();
        manifest.ignored_packs.extend(
            classified
                .delta
                .packs_added
                .iter()
                .chain(classified.delta.packs_removed.iter())
                .cloned(),
        );
        manifest.ignored_packs.sort();
        manifest.ignored_packs.dedup();
        if manifest.ignored_packs.len() != before {
            crate::profile::save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
        }
        return load_library_from(profiles_dir, Some(tf2_root));
    }

    let added: Vec<String> = classified
        .delta
        .packs_added
        .iter()
        .flat_map(|pack| classified.pack_live_files.get(pack).into_iter().flatten())
        .cloned()
        .collect();
    let mut remove = Vec::new();
    for pack in &classified.delta.packs_removed {
        if let Some(paths) = classified.pack_manifest_files.get(pack) {
            remove.extend(paths.iter().cloned());
        }
    }
    absorb_live_files(
        profiles_dir,
        tf2_root,
        &profile_id,
        &added,
        &remove,
        &classified.live,
        &running,
    )?;
    load_library_from(profiles_dir, Some(tf2_root))
}

/// The pack step of a profile switch: take the packs the user added into the
/// profile being left, and nothing more.
///
/// A switch used to run the equivalent of answering **Update** to a prompt
/// the user had not seen: packs missing from the live tree were deleted from
/// the library, and every pack they had answered Keep for was absorbed and
/// then removed by the switch. The UI, meanwhile, promised the deferred
/// prompt would be re-offered. Here, removed packs keep their library copy
/// (they are not live, so the Remove step has nothing to do with them and the
/// next switch back writes them out again), and `ignored_packs` stays as the
/// user left it. Added packs must be absorbed: they are not in the old
/// manifest, so the Remove step would leave them live next to the target's.
pub fn absorb_added_packs_for_switch_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    running_names: I,
    options: AbsorbOptions<'_>,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running = collect_running(running_names);
    refuse_if_running_among(&running)?;
    let Some(profile_id) = active_profile_id(profiles_dir, tf2_root)? else {
        return Ok(());
    };
    repair_interrupted_writes(profiles_dir, tf2_root, &profile_id, &running)?;
    let classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
    let added: Vec<String> = classified
        .delta
        .packs_added
        .iter()
        .flat_map(|pack| classified.pack_live_files.get(pack).into_iter().flatten())
        .cloned()
        .collect();
    absorb_live_files(
        profiles_dir,
        tf2_root,
        &profile_id,
        &added,
        &[],
        &classified.live,
        &running,
    )
}

/// Put back live files an interrupted write left missing, before the delta is
/// read off the live tree.
///
/// Every live write goes through `<path>.execs-part` + rename. Killing the
/// process between the two — a dev-server restart on a Rust rebuild, a crash, a
/// power loss — leaves the side file and no destination, and the next boot
/// reads that as the user deleting the pack: the prompt offers to drop a pack
/// the library still holds in full, and Keep then hides the game having none.
///
/// A manifest file missing from the live tree is rewritten when its library
/// copy exists and either its `.execs-part` sibling is still there (our own
/// interrupted write, unambiguously) or its pack is one of ours (`execs-*`,
/// which the user manages through the app, not by deleting files). Anything
/// else stays a real deletion. Stray side files go either way, and pack keys
/// that were repaired stop being ignored.
fn repair_interrupted_writes(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    running: &[String],
) -> Result<Vec<String>, ProfileError> {
    recover_profile_mutation_to(profiles_dir, tf2_root, profile_id)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let before_files = manifest.files.len();
    // Older builds could accidentally claim Valve/global/junk entries. Drop
    // those metadata records without reading or touching their live paths.
    manifest
        .files
        .retain(|file| is_profile_ownable_rel_path(&file.path));
    let mut repaired_packs = BTreeSet::new();
    let mut repaired_files = Vec::new();
    for file in &manifest.files {
        if is_stock_custom_entry(&file.path)
            || live_candidates(tf2_root, &file.path)
                .iter()
                .any(|path| path.exists())
        {
            continue;
        }
        let dest = live_path(tf2_root, &file.path);
        let pack = pack_key(&file.path);
        let app_owned = pack
            .as_deref()
            .is_some_and(|pack| pack.starts_with(APP_PACK_PREFIX));
        if !part_path(&dest).exists() && !app_owned {
            continue;
        }
        let Ok(source) = manifest_source_path(profiles_dir, profile_id, file) else {
            continue;
        };
        copy_verified_atomic_within(tf2_root, &source, &dest, &file.sha256)
            .map_err(|e| ProfileError::Io(e.to_string()))?;
        match pack {
            Some(pack) => {
                repaired_packs.insert(pack);
            }
            None => repaired_files.push(file.path.clone()),
        }
    }

    remove_stray_parts(tf2_root, &tf2_root.join("tf").join("custom"))?;
    remove_stray_parts(tf2_root, &tf2_root.join("tf").join("cfg"))?;

    let before = manifest.ignored_packs.len();
    manifest
        .ignored_packs
        .retain(|pack| !is_stock_custom_pack(pack) && !repaired_packs.contains(pack));
    if manifest.ignored_packs.len() != before || manifest.files.len() != before_files {
        crate::profile::save_manifest(profiles_dir, tf2_root, &manifest, running)?;
    }

    let mut repaired: Vec<String> = repaired_packs.into_iter().collect();
    repaired.extend(repaired_files);
    repaired.sort();
    repaired.dedup();
    Ok(repaired)
}

/// Delete our own `.execs-part` side files under `dir`, recursively. Only that
/// suffix: everything else in the live tree belongs to the game or the user.
fn remove_stray_parts(tf2_root: &Path, dir: &Path) -> Result<(), ProfileError> {
    if !dir.exists() {
        return Ok(());
    }
    validate_dir_within(tf2_root, dir).map_err(|e| ProfileError::Io(e.to_string()))?;
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => return Err(ProfileError::Io(err.to_string())),
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            remove_stray_parts(tf2_root, &path)?;
        } else if kind.is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(PART_SUFFIX)
        {
            remove_file_force_within(tf2_root, &path)
                .map_err(|e| ProfileError::Io(e.to_string()))?;
        }
    }
    Ok(())
}

/// Rewrite live files from the profile's own library copies. Used by Restore,
/// where every path is still in the manifest.
fn write_library_files_to_live(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    paths: &[String],
) -> Result<(), ProfileError> {
    if paths.is_empty() {
        return Ok(());
    }
    let manifest = load_manifest(profiles_dir, profile_id)?;
    for path in paths {
        let Some(file) = manifest.files.iter().find(|file| &file.path == path) else {
            continue;
        };
        if !is_profile_ownable_rel_path(path) {
            return Err(ProfileError::ForbiddenPath(path.clone()));
        }
        let source = manifest_source_path(profiles_dir, profile_id, file)?;
        copy_verified_atomic_within(tf2_root, &source, &live_path(tf2_root, path), &file.sha256)
            .map_err(|e| ProfileError::Io(e.to_string()))?;
    }
    Ok(())
}

fn collect_running<I, S>(running_names: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect()
}

fn active_profile_id(profiles_dir: &Path, tf2_root: &Path) -> Result<Option<String>, ProfileError> {
    Ok(load_library_from(profiles_dir, Some(tf2_root))?.active_profile_id)
}

struct Classified {
    delta: AbsorbDelta,
    live: HashMap<String, PathBuf>,
    pack_live_files: BTreeMap<String, Vec<String>>,
    pack_manifest_files: BTreeMap<String, Vec<String>>,
}

fn classify(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    options: &AbsorbOptions<'_>,
) -> Result<Classified, ProfileError> {
    let cloud = resolve_inventory_cloud(options);
    let inventory = inventory_live_surface_for_absorb(tf2_root, cloud.as_deref())?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let manifest_paths: BTreeSet<String> = manifest
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect();
    let live = live_by_manifest_spelling(inventory.entries, &manifest_paths)?;
    // Hoisted: rebuilding these inside the per-file loops is O(live × manifest)
    // string clones, and absorb runs on boot and after every TF2 quit.
    let manifest_packs_present = manifest_pack_keys(&manifest.files);
    let live_pack_keys: BTreeSet<String> = live.keys().filter_map(|path| pack_key(path)).collect();

    let mut owned_changed = Vec::new();
    let mut owned_missing = Vec::new();
    let mut config_cfg = false;

    for file in &manifest.files {
        match live.get(&file.path) {
            Some(source) => {
                let hash = sha256_file(source).map_err(|e| ProfileError::Io(e.to_string()))?;
                if hash != file.sha256 {
                    owned_changed.push(file.path.clone());
                    if file.path == CONFIG_CFG {
                        config_cfg = true;
                    }
                }
            }
            None => match pack_key(&file.path) {
                // A file deleted from inside a pack that is still live is a real
                // deletion. Left in the manifest it never gets removed, and the
                // next switch back rewrites the file the user deleted.
                // `packs_removed` only fires when the whole pack key is gone.
                Some(pack) if live_pack_keys.contains(&pack) => {
                    owned_missing.push(file.path.clone());
                }
                Some(_) => {}
                None => {
                    owned_missing.push(file.path.clone());
                    if file.path == CONFIG_CFG {
                        config_cfg = true;
                    }
                }
            },
        }
    }

    for path in live.keys() {
        if manifest_paths.contains(path) {
            continue;
        }
        match pack_key(path) {
            None => {
                owned_changed.push(path.clone());
                if path == CONFIG_CFG {
                    config_cfg = true;
                }
            }
            // A new file inside a pack the profile already owns absorbs
            // automatically; a brand-new pack is a prompt, not an absorb.
            Some(pack) if manifest_packs_present.contains(&pack) => {
                owned_changed.push(path.clone());
            }
            Some(_) => {}
        }
    }

    owned_changed.sort();
    owned_changed.dedup();
    owned_missing.sort();

    let pack_live_files = group_by_pack(live.keys());
    let pack_manifest_files = group_by_pack(manifest_paths.iter());
    let live_packs: BTreeSet<String> = pack_live_files.keys().cloned().collect();
    let manifest_packs: BTreeSet<String> = pack_manifest_files.keys().cloned().collect();
    // Packs the user chose to Keep stay out of both deltas, so the prompt does
    // not return on every boot. Junk keys a Keep recorded before junk stopped
    // counting as a pack are dropped here as well as from the manifest, so a
    // read-only scan sees the same list a repaired manifest holds.
    let ignored: BTreeSet<String> = manifest
        .ignored_packs
        .iter()
        .filter(|pack| !is_stock_custom_pack(pack))
        .cloned()
        .collect();
    let packs_added: Vec<String> = live_packs
        .difference(&manifest_packs)
        .filter(|pack| !ignored.contains(*pack))
        .cloned()
        .collect();
    let packs_removed: Vec<String> = manifest_packs
        .difference(&live_packs)
        .filter(|pack| !ignored.contains(*pack))
        .cloned()
        .collect();

    if live.contains_key(CONFIG_CFG) && !manifest_paths.contains(CONFIG_CFG) {
        config_cfg = true;
    }

    Ok(Classified {
        delta: AbsorbDelta {
            owned_changed,
            owned_missing,
            packs_added,
            packs_removed,
            config_cfg,
        },
        live,
        pack_live_files,
        pack_manifest_files,
    })
}

/// The live tree keyed by the spelling the manifest uses for each pack.
///
/// A pack is the same pack whether its folder is `hud` or `-hud` (the Source
/// disable prefix), and on Windows whether it is `RaysHUD` or `rayshud`. The
/// switch itself writes a profile's second HUD as `-hud` while the manifest
/// keeps `hud`; matched by exact path, the next absorb read that as "hud was
/// deleted, -hud is new", removed the library copy and re-added it under the
/// disabled name — and the following switch wrote both HUDs disabled. Keying
/// live files by the manifest's spelling makes the folder name a live-only
/// detail: the library copy keeps the manifest path, and the twin's bytes are
/// what get hashed against it.
///
/// When both spellings are live at once (a user keeping `hud` and `-hud`
/// side by side), the one matching the manifest keeps its key and the other
/// stays under its own name, exactly as before.
fn live_by_manifest_spelling(
    entries: Vec<crate::surface::InventoryEntry>,
    manifest_paths: &BTreeSet<String>,
) -> Result<HashMap<String, PathBuf>, ProfileError> {
    let mut manifest_first_segment: BTreeMap<String, String> = BTreeMap::new();
    for path in manifest_paths {
        if let (Some(pack), Some(first)) = (pack_key(path), custom_first_segment(path)) {
            manifest_first_segment
                .entry(pack)
                .or_insert_with(|| first.to_string());
        }
    }
    let mut live: HashMap<String, PathBuf> = HashMap::new();
    let mut rekeyed = Vec::new();
    for entry in entries {
        let target = pack_key(&entry.dest_rel)
            .and_then(|pack| manifest_first_segment.get(&pack))
            .and_then(|spelling| {
                let first = custom_first_segment(&entry.dest_rel)?;
                if first == spelling {
                    return None;
                }
                let rest = &entry.dest_rel["tf/custom/".len() + first.len()..];
                Some(format!("tf/custom/{spelling}{rest}"))
            });
        match target {
            Some(target) => rekeyed.push((target, entry)),
            None => {
                live.insert(entry.dest_rel, entry.source);
            }
        }
    }
    for (target, entry) in rekeyed {
        // Exact spellings win: never shadow a live file that already carries
        // the manifest's own name.
        if live.contains_key(&target) {
            live.insert(entry.dest_rel, entry.source);
        } else {
            live.insert(target, entry.source);
        }
    }
    // Portable profiles cannot represent two case-distinct paths, even on
    // Linux. Refuse an ambiguous scan instead of replacing one with the other.
    let mut identities = HashSet::new();
    for path in live.keys() {
        if !identities.insert(portable_path_key(path)?) {
            return Err(ProfileError::Io(format!(
                "TF2's customization contains colliding profile paths: {path}"
            )));
        }
    }
    // On Windows a case-only rename is still the same file. Reconcile every
    // component, after the disabled-pack mapping, so it cannot become a put
    // followed by a removal of the same portable identity. Linux keeps the
    // actual spelling; its rename is committed as one addition/removal batch.
    #[cfg(windows)]
    {
        let spellings = manifest_paths
            .iter()
            .map(|path| Ok((portable_path_key(path)?, path)))
            .collect::<Result<HashMap<_, _>, ProfileError>>()?;
        live = live
            .into_iter()
            .map(|(path, source)| {
                let key = portable_path_key(&path)?;
                let path = spellings
                    .get(&key)
                    .map_or(path, |spelling| (*spelling).clone());
                Ok((path, source))
            })
            .collect::<Result<_, ProfileError>>()?;
    }
    Ok(live)
}

/// The folder name directly under `tf/custom/`, as spelled.
fn custom_first_segment(rel: &str) -> Option<&str> {
    let rest = rel.strip_prefix("tf/custom/")?;
    let first = rest.split('/').next()?;
    if first.is_empty() {
        None
    } else {
        Some(first)
    }
}

fn manifest_pack_keys(files: &[ProfileFile]) -> BTreeSet<String> {
    files
        .iter()
        .filter_map(|file| pack_key(&file.path))
        .collect()
}

fn group_by_pack<'a>(paths: impl Iterator<Item = &'a String>) -> BTreeMap<String, Vec<String>> {
    let mut groups = BTreeMap::new();
    for path in paths {
        if let Some(pack) = pack_key(path) {
            groups
                .entry(pack)
                .or_insert_with(Vec::new)
                .push(path.clone());
        }
    }
    for files in groups.values_mut() {
        files.sort();
    }
    groups
}

fn resolve_inventory_cloud(options: &AbsorbOptions<'_>) -> Option<PathBuf> {
    if let Some(path) = options.cloud_config {
        return Some(path.to_path_buf());
    }
    if let Some(roots) = options.steam_roots {
        return find_cloud_config_from(roots);
    }
    None
}

/// Absorb additions and removals in one recoverable library transaction. A
/// case-only rename on Linux has the same portable identity on both sides.
fn absorb_live_files<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    paths: &[String],
    remove_paths: &[String],
    live: &HashMap<String, PathBuf>,
    running: I,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let batch: Vec<(String, FileSource<'_>)> = paths
        .iter()
        .map(|path| {
            let source = live.get(path).ok_or(ProfileError::InvalidPath)?;
            Ok((
                path.clone(),
                FileSource::PathExact {
                    path: source,
                    expected_len: source_file_len(source)?,
                },
            ))
        })
        .collect::<Result<_, ProfileError>>()?;
    if batch.is_empty() && remove_paths.is_empty() {
        return Ok(());
    }
    mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &batch,
        remove_paths,
        ProfileLiveProjection::LibraryOnly,
        running,
        |_| Ok(()),
    )?;
    Ok(())
}

fn dual_write_config(
    tf2_root: &Path,
    classified: &Classified,
    options: &AbsorbOptions<'_>,
) -> Result<(), ProfileError> {
    let Some(source) = classified.live.get(CONFIG_CFG) else {
        return Ok(());
    };
    let bytes = read_small_file_bounded(source, MAX_CFG_FILE_BYTES)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    let roots = match options.steam_roots {
        Some(roots) => roots.to_vec(),
        None => discover_steam_roots(),
    };
    write_config_cfg_dual_to(tf2_root, &bytes, &roots)
}

fn retry_pending_cloud_sync(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    options: &AbsorbOptions<'_>,
) -> Result<(), ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let Some(file) = manifest.files.iter().find(|file| file.path == CONFIG_CFG) else {
        return Ok(());
    };
    let source = manifest_source_path(profiles_dir, profile_id, file)?;
    let bytes = read_small_file_bounded(&source, MAX_CFG_FILE_BYTES)
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    if !crate::hash::sha256_hex(&bytes).eq_ignore_ascii_case(&file.sha256) {
        return Err(ProfileError::Io(
            "Profile config.cfg failed integrity verification".into(),
        ));
    }
    let roots = match options.steam_roots {
        Some(roots) => roots.to_vec(),
        None => discover_steam_roots(),
    };
    write_config_cfg_dual_to(tf2_root, &bytes, &roots)
}

pub(crate) fn set_cloud_sync_pending(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    pending: bool,
    running: &[String],
) -> Result<(), ProfileError> {
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    if manifest.cloud_sync_pending == pending {
        return Ok(());
    }
    manifest.cloud_sync_pending = pending;
    crate::profile::save_manifest(profiles_dir, tf2_root, &manifest, running)
}

/// Live `config.cfg` and its Steam Cloud copy. Atomic like every other write
/// that matters: a truncated `config.cfg` is the one the game loads, and a
/// truncated Cloud copy is the one Steam syncs up.
fn write_bytes(root: &Path, path: &Path, bytes: &[u8]) -> Result<(), ProfileError> {
    write_atomic_within(root, path, bytes).map_err(|e| ProfileError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::sha256_hex;
    use crate::profile::{
        exclusive_file_path, load_manifest, remove_manifest_files_to, save_current_as_to,
        SaveCurrentOptions,
    };
    use std::io::Write;

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

    fn write_live(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
    }

    fn localconfig(options: &str) -> String {
        format!(
            r#""UserLocalConfigStore"
{{
	"Software"
	{{
		"Valve"
		{{
			"Steam"
			{{
				"apps"
				{{
					"440"
					{{
						"LaunchOptions"		"{options}"
					}}
				}}
			}}
		}}
	}}
}}
"#
        )
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn save_main(profiles: &Path, root: &Path) -> String {
        let library = save_current_as_to(
            profiles,
            root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-novid"),
                cloud_config: None,
            },
        )
        .unwrap();
        library.profiles[0].id.clone()
    }

    /// Never `steam_roots: None` in a test: that discovers the developer's
    /// real Steam install, and every dual write then lands in their actual
    /// Steam Cloud `config.cfg` (and the launch-options path in their real
    /// `localconfig.vdf`). An empty slice means "no Steam here".
    fn opts<'a>(steam: Option<&'a [PathBuf]>) -> AbsorbOptions<'a> {
        static NO_STEAM: [PathBuf; 0] = [];
        AbsorbOptions {
            cloud_config: None,
            steam_roots: Some(steam.unwrap_or(&NO_STEAM)),
        }
    }

    #[test]
    fn pack_key_strips_disable_prefix() {
        assert_eq!(pack_key("tf/custom/hud/resource/ui/x"), Some("hud".into()));
        assert_eq!(pack_key("tf/custom/-hud/info.vdf"), Some("hud".into()));
        assert_eq!(
            pack_key("tf/custom/mastercomfig-base.vpk"),
            Some("mastercomfig-base.vpk".into())
        );
        assert_eq!(pack_key("tf/cfg/config.cfg"), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn pack_keys_preserve_case_on_case_sensitive_filesystems() {
        assert_ne!(
            pack_key("tf/custom/Hud/info.vdf"),
            pack_key("tf/custom/hud/info.vdf")
        );
        assert_eq!(
            pack_key("tf/custom/-Hud/info.vdf"),
            pack_key("tf/custom/Hud/info.vdf")
        );
    }

    #[test]
    fn no_active_profile_is_noop() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert_eq!(delta, AbsorbDelta::empty());
        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(result.library.active_profile_id.is_none());
        assert_eq!(result.delta, AbsorbDelta::empty());
        assert!(!result.config_cfg_absorbed);
        cleanup(&dir);
    }

    #[test]
    fn owned_cfg_drift_absorbs_and_new_pack_waits() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_live(
            &root.join("tf/custom/hud/resource/ui/hudlayout.res"),
            "hud\n",
        );
        let id = save_main(&profiles, &root);

        write_live(
            &root.join("tf/cfg/config.cfg"),
            "unbindall\nbind w +forward\n",
        );
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 110\n",
        );
        write_live(&root.join("tf/cfg/overrides/modules.cfg"), "modules\n");
        write_live(&root.join("tf/custom/toon/info.vdf"), "toon\n");

        let before_live = fs::read(root.join("tf/custom/toon/info.vdf")).unwrap();
        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(delta.owned_changed.contains(&"tf/cfg/config.cfg".into()));
        assert!(delta
            .owned_changed
            .contains(&"tf/cfg/overrides/autoexec.cfg".into()));
        assert!(delta
            .owned_changed
            .contains(&"tf/cfg/overrides/modules.cfg".into()));
        assert!(delta.packs_added.contains(&"toon".into()));
        assert!(delta.packs_removed.is_empty());
        assert!(delta.config_cfg);

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(result.delta.packs_added.contains(&"toon".into()));
        assert!(result.delta.owned_changed.is_empty());
        assert!(result.config_cfg_absorbed);
        let manifest = load_manifest(&profiles, &id).unwrap();
        let autoexec = manifest
            .files
            .iter()
            .find(|file| file.path == "tf/cfg/overrides/autoexec.cfg")
            .unwrap();
        assert_eq!(autoexec.sha256, sha256_hex(b"fov_desired 110\n"));
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/cfg/overrides/autoexec.cfg"
            ))
            .unwrap(),
            b"fov_desired 110\n"
        );
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/cfg/overrides/modules.cfg"));
        assert!(!manifest.files.iter().any(|file| file.path.contains("toon")));
        assert_eq!(
            fs::read(root.join("tf/custom/toon/info.vdf")).unwrap(),
            before_live
        );
        cleanup(&dir);
    }

    #[test]
    fn deleted_pack_waits_missing_owned_cfg_is_removed() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_live(
            &root.join("tf/custom/hud/resource/ui/hudlayout.res"),
            "hud\n",
        );
        let id = save_main(&profiles, &root);

        fs::remove_file(root.join("tf/cfg/overrides/autoexec.cfg")).unwrap();
        fs::remove_dir_all(root.join("tf/custom/hud")).unwrap();

        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(delta
            .owned_missing
            .contains(&"tf/cfg/overrides/autoexec.cfg".into()));
        assert!(delta.packs_removed.contains(&"hud".into()));

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(result.delta.packs_removed.contains(&"hud".into()));
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest
            .files
            .iter()
            .any(|file| file.path == "tf/cfg/overrides/autoexec.cfg"));
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/hud/resource/ui/hudlayout.res"));
        cleanup(&dir);
    }

    /// Keep has to be recorded, or the same pack prompt returns on every boot
    /// and after every TF2 quit until the user gives in and chooses Update.
    #[test]
    fn keep_is_remembered_so_the_prompt_does_not_return() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/old/pack.txt"), "old\n");
        let id = save_main(&profiles, &root);
        fs::remove_dir_all(root.join("tf/custom/old")).unwrap();
        write_live(&root.join("tf/custom/new/pack.txt"), "new\n");

        let before = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(before.has_pack_changes());
        assert!(before.packs_added.contains(&"new".to_string()));
        assert!(before.packs_removed.contains(&"old".to_string()));

        absorb_packs_to(&profiles, &root, PackChoice::Keep, unlocked(), opts(None)).unwrap();
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert_eq!(
            manifest.ignored_packs,
            vec!["new".to_string(), "old".into()]
        );

        // Same live tree, same profile: the prompt is gone.
        let after = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(!after.has_pack_changes(), "{after:?}");

        // A pack that appears later is a fresh decision, not a re-prompt.
        write_live(&root.join("tf/custom/third/pack.txt"), "third\n");
        let third = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert_eq!(third.packs_added, vec!["third".to_string()]);
        assert!(third.packs_removed.is_empty());

        // Update is the user changing their mind about everything they kept out.
        absorb_packs_to(&profiles, &root, PackChoice::Update, unlocked(), opts(None)).unwrap();
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest.ignored_packs.is_empty());
        assert!(!manifest.files.iter().any(|file| file.path.contains("old")));
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/new/pack.txt"));
        cleanup(&dir);
    }

    #[test]
    fn pack_update_adds_and_removes_keep_leaves_library() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/old/pack.txt"), "old\n");
        let id = save_main(&profiles, &root);
        fs::remove_dir_all(root.join("tf/custom/old")).unwrap();
        write_live(&root.join("tf/custom/new/pack.txt"), "new\n");

        absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        let kept =
            absorb_packs_to(&profiles, &root, PackChoice::Keep, unlocked(), opts(None)).unwrap();
        assert_eq!(kept.active_profile_id.as_deref(), Some(id.as_str()));
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest.files.iter().any(|file| file.path.contains("old")));
        assert!(!manifest.files.iter().any(|file| file.path.contains("new")));

        absorb_packs_to(&profiles, &root, PackChoice::Update, unlocked(), opts(None)).unwrap();
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest.files.iter().any(|file| file.path.contains("old")));
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/new/pack.txt"));
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/new/pack.txt"
            ))
            .unwrap(),
            b"new\n"
        );
        assert!(root.join("tf/custom/new/pack.txt").is_file());
        cleanup(&dir);
    }

    /// The switch writes a profile's second HUD as `-hud` while the manifest
    /// keeps `hud`. Matched by exact path, the next absorb deleted the library
    /// copy of `hud` and re-added it as `-hud`; a later switch then wrote both
    /// HUDs disabled.
    #[test]
    fn a_disabled_twin_keeps_the_manifest_spelling_and_its_library_copy() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        write_live(&root.join("tf/custom/hud/resource/ui/a.res"), "a\n");
        let id = save_main(&profiles, &root);
        fs::rename(root.join("tf/custom/hud"), root.join("tf/custom/-hud")).unwrap();
        // Edited and added while the pack sat disabled.
        write_live(&root.join("tf/custom/-hud/resource/ui/a.res"), "a2\n");
        write_live(&root.join("tf/custom/-hud/resource/ui/b.res"), "b\n");

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert!(result.delta.owned_missing.is_empty(), "{:?}", result.delta);
        assert!(!result.delta.has_pack_changes(), "{:?}", result.delta);
        let manifest = load_manifest(&profiles, &id).unwrap();
        let paths: Vec<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"tf/custom/hud/info.vdf"));
        assert!(paths.contains(&"tf/custom/hud/resource/ui/b.res"));
        assert!(
            !paths.iter().any(|p| p.starts_with("tf/custom/-hud/")),
            "{paths:?}"
        );
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/hud/resource/ui/a.res"
            ))
            .unwrap(),
            b"a2\n"
        );
        assert!(exclusive_file_path(&profiles, &id, "tf/custom/hud/info.vdf").is_file());
        cleanup(&dir);
    }

    /// Migration of `tf/cfg/user/` is a Save-current decision. Re-applying it
    /// on every absorb copied the same legacy file into every profile.
    #[test]
    fn absorb_does_not_migrate_legacy_user_cfgs_into_the_profile() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/cfg/overrides/modules.cfg"), "x\n");
        write_live(&root.join("tf/cfg/user/autoexec.cfg"), "legacy\n");
        let id = save_main(&profiles, &root);
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(
            manifest
                .files
                .iter()
                .any(|f| f.path == "tf/cfg/overrides/autoexec.cfg"),
            "save-current migrates the legacy file once"
        );
        // A profile that never had that file (created fresh, or switched to).
        remove_manifest_files_to(
            &profiles,
            &root,
            &id,
            &["tf/cfg/overrides/autoexec.cfg".to_string()],
            unlocked(),
        )
        .unwrap();

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert!(
            !result
                .delta
                .owned_changed
                .iter()
                .any(|p| p.contains("autoexec")),
            "{:?}",
            result.delta
        );
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest
            .files
            .iter()
            .any(|f| f.path == "tf/cfg/overrides/autoexec.cfg"));
        cleanup(&dir);
    }

    #[test]
    fn disabled_prefix_is_same_pack() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        save_main(&profiles, &root);
        fs::rename(root.join("tf/custom/hud"), root.join("tf/custom/-hud")).unwrap();
        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(!delta.packs_added.contains(&"hud".into()));
        assert!(!delta.packs_removed.contains(&"hud".into()));
        cleanup(&dir);
    }

    #[test]
    fn dual_write_matches_live_and_cloud() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        let steam = dir.join("Steam");
        write_file(
            &steam
                .join("userdata")
                .join("111")
                .join("config")
                .join("localconfig.vdf"),
            &localconfig("-novid"),
        );
        fs::create_dir_all(steam.join("userdata").join("111").join("440")).unwrap();
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        save_main(&profiles, &root);
        write_live(&root.join("tf/cfg/config.cfg"), "updated\n");

        absorb_owned_to(
            &profiles,
            &root,
            unlocked(),
            AbsorbOptions {
                cloud_config: None,
                steam_roots: Some(std::slice::from_ref(&steam)),
            },
        )
        .unwrap();
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            b"updated\n"
        );
        assert_eq!(
            fs::read(
                steam
                    .join("userdata")
                    .join("111")
                    .join("440")
                    .join("remote")
                    .join("cfg")
                    .join("config.cfg")
            )
            .unwrap(),
            b"updated\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn dual_write_without_steam_still_writes_live() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        write_config_cfg_dual_to(&root, b"cloudless\n", &[]).unwrap();
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            b"cloudless\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn refuse_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        save_main(&profiles, &root);
        write_live(&root.join("tf/cfg/config.cfg"), "changed\n");
        let err = absorb_owned_to(&profiles, &root, [tf2_name()], opts(None)).unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        let err = absorb_packs_to(
            &profiles,
            &root,
            PackChoice::Update,
            [tf2_name()],
            opts(None),
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        cleanup(&dir);
    }

    #[test]
    fn new_file_in_existing_pack_absorbs_automatically() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        let id = save_main(&profiles, &root);
        write_live(&root.join("tf/custom/hud/extra.txt"), "extra\n");
        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(!result.delta.has_pack_changes());
        assert!(!result.config_cfg_absorbed);
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/hud/extra.txt"));
        cleanup(&dir);
    }

    #[test]
    fn deleted_file_in_a_still_live_pack_absorbs_and_is_not_resurrected() {
        // The mirror of the test above. Left in the manifest, a file the user
        // deleted from inside their HUD comes back on the next switch.
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        write_live(&root.join("tf/custom/hud/extra.txt"), "extra\n");
        let id = save_main(&profiles, &root);

        std::fs::remove_file(root.join("tf/custom/hud/extra.txt")).unwrap();
        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        // The pack itself is still there, so this is a file deletion, not a
        // pack removal — no prompt.
        assert!(!result.delta.has_pack_changes());
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(
            !manifest
                .files
                .iter()
                .any(|file| file.path == "tf/custom/hud/extra.txt"),
            "a deleted pack file must leave the manifest"
        );
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/hud/info.vdf"));
        cleanup(&dir);
    }

    #[test]
    fn a_whole_pack_disappearing_still_prompts_rather_than_absorbing() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        let id = save_main(&profiles, &root);

        std::fs::remove_dir_all(root.join("tf/custom/hud")).unwrap();
        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert_eq!(result.delta.packs_removed, vec!["hud".to_string()]);
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/hud/info.vdf"));
        cleanup(&dir);
    }

    /// Steam's own `readme.txt` and `workshop/` (both restored by a file
    /// verify) and the `.execs-part` side file a killed write leaves behind are
    /// not packs. Shown as added packs they push the real question off the
    /// prompt and a Keep records junk in `ignored_packs` forever.
    #[test]
    fn stock_custom_entries_and_part_files_are_never_packs() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        let id = save_main(&profiles, &root);

        write_live(
            &root.join("tf/custom/execs-viewmodels.vpk.execs-part"),
            "half a vpk\n",
        );
        write_live(&root.join("tf/custom/readme.txt"), "valve\n");
        write_live(&root.join("tf/custom/workshop/12345/item.vpk"), "wshop\n");

        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(!delta.has_pack_changes(), "{delta:?}");
        assert!(delta.owned_changed.is_empty(), "{delta:?}");

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        assert!(!result.delta.has_pack_changes(), "{:?}", result.delta);
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest.files.iter().any(|file| {
            file.path.contains("readme")
                || file.path.contains("workshop")
                || file.path.ends_with(PART_SUFFIX)
        }));
        // Valve's files stay exactly where they are; only our own leftover goes.
        assert!(root.join("tf/custom/readme.txt").is_file());
        assert!(root.join("tf/custom/workshop/12345/item.vpk").is_file());
        assert!(!root
            .join("tf/custom/execs-viewmodels.vpk.execs-part")
            .exists());
        cleanup(&dir);
    }

    /// The field bug: a switch was killed mid-copy (a dev-server restart, a
    /// crash, a power loss), leaving `<pack>.execs-part` and no pack. The next
    /// boot must put the pack back rather than offer to forget it.
    #[test]
    fn an_interrupted_write_is_repaired_from_the_library() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/toonhud.vpk"), "pack bytes\n");
        let id = save_main(&profiles, &root);

        fs::remove_file(root.join("tf/custom/toonhud.vpk")).unwrap();
        // The user answered the resulting prompt with Keep, so the pack is on
        // the ignore list while the library still holds it in full.
        absorb_packs_to(&profiles, &root, PackChoice::Keep, unlocked(), opts(None)).unwrap();
        assert_eq!(
            load_manifest(&profiles, &id).unwrap().ignored_packs,
            vec!["toonhud.vpk".to_string()]
        );
        write_live(&root.join("tf/custom/toonhud.vpk.execs-part"), "half\n");

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert_eq!(result.repaired, vec!["toonhud.vpk".to_string()]);
        assert_eq!(
            fs::read(root.join("tf/custom/toonhud.vpk")).unwrap(),
            b"pack bytes\n"
        );
        assert!(!root.join("tf/custom/toonhud.vpk.execs-part").exists());
        assert!(load_manifest(&profiles, &id)
            .unwrap()
            .ignored_packs
            .is_empty());
        assert!(!result.delta.has_pack_changes(), "{:?}", result.delta);
        cleanup(&dir);
    }

    /// Packs the app builds are managed through the app, never by deleting the
    /// file, so one that is missing while the library holds it is a failed
    /// write even when the side file is gone too.
    #[test]
    fn a_missing_app_pack_is_restored_without_a_side_file() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/execs-viewmodels.vpk"), "vpk bytes\n");
        let id = save_main(&profiles, &root);
        fs::remove_file(root.join("tf/custom/execs-viewmodels.vpk")).unwrap();

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert_eq!(result.repaired, vec!["execs-viewmodels.vpk".to_string()]);
        assert_eq!(
            fs::read(root.join("tf/custom/execs-viewmodels.vpk")).unwrap(),
            b"vpk bytes\n"
        );
        assert!(!result.delta.has_pack_changes(), "{:?}", result.delta);
        assert!(load_manifest(&profiles, &id)
            .unwrap()
            .files
            .iter()
            .any(|file| file.path == "tf/custom/execs-viewmodels.vpk"));
        cleanup(&dir);
    }

    /// The other half of the rule: a pack the user brought in themselves and
    /// deleted themselves is a real deletion, not a repair.
    #[test]
    fn a_missing_foreign_pack_is_left_deleted() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/toonhud.vpk"), "pack bytes\n");
        save_main(&profiles, &root);
        fs::remove_file(root.join("tf/custom/toonhud.vpk")).unwrap();

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert!(result.repaired.is_empty(), "{:?}", result.repaired);
        assert!(!root.join("tf/custom/toonhud.vpk").exists());
        assert_eq!(result.delta.packs_removed, vec!["toonhud.vpk".to_string()]);
        cleanup(&dir);
    }

    /// Restore answers the prompt the other way from Update: the packs that
    /// went missing come back from the library, and the new ones are left
    /// exactly as they are — neither adopted nor ignored.
    #[test]
    fn restore_rewrites_the_removed_packs_and_leaves_the_new_ones() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        write_live(&root.join("tf/custom/hud/resource/x.res"), "res\n");
        let id = save_main(&profiles, &root);
        fs::remove_dir_all(root.join("tf/custom/hud")).unwrap();
        write_live(&root.join("tf/custom/new/pack.txt"), "new\n");

        let before = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert_eq!(before.packs_removed, vec!["hud".to_string()]);
        assert_eq!(before.packs_added, vec!["new".to_string()]);

        absorb_packs_to(
            &profiles,
            &root,
            PackChoice::Restore,
            unlocked(),
            opts(None),
        )
        .unwrap();

        assert_eq!(
            fs::read(root.join("tf/custom/hud/info.vdf")).unwrap(),
            b"hud\n"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/hud/resource/x.res")).unwrap(),
            b"res\n"
        );
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest.ignored_packs.is_empty());
        assert!(!manifest.files.iter().any(|file| file.path.contains("new")));
        assert!(root.join("tf/custom/new/pack.txt").is_file());
        let after = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert!(after.packs_removed.is_empty(), "{after:?}");
        assert_eq!(after.packs_added, vec!["new".to_string()]);
        cleanup(&dir);
    }

    /// The user's machine holds `ignored_packs` entries recorded when junk
    /// still counted as a pack. They stop suppressing anything at once and
    /// leave the manifest on the next absorb, with no action from the user.
    #[test]
    fn stale_junk_ignore_entries_are_dropped() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/toonhud.vpk"), "pack\n");
        let id = save_main(&profiles, &root);
        let mut manifest = load_manifest(&profiles, &id).unwrap();
        manifest.ignored_packs = vec![
            "execs-viewmodels.vpk.execs-part".to_string(),
            "readme.txt".into(),
            "toonhud.vpk".into(),
            "workshop".into(),
        ];
        crate::profile::save_manifest(&profiles, &root, &manifest, Vec::<String>::new()).unwrap();

        absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert_eq!(
            load_manifest(&profiles, &id).unwrap().ignored_packs,
            vec!["toonhud.vpk".to_string()]
        );
        cleanup(&dir);
    }

    #[test]
    fn absorb_with_no_drift_leaves_config_cfg_untouched() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        save_main(&profiles, &root);
        let live_config = root.join("tf/cfg/config.cfg");
        let before = std::fs::metadata(&live_config).unwrap().modified().unwrap();

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert!(!result.config_cfg_absorbed);
        // Steam Cloud syncs this file; rewriting identical bytes on every boot
        // gave it a fresh mtime for nothing.
        assert_eq!(
            std::fs::metadata(&live_config).unwrap().modified().unwrap(),
            before
        );
        cleanup(&dir);
    }
}
