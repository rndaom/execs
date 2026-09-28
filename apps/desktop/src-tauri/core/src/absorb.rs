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
    sha256_file, sha256_hex, validate_dir_within, write_atomic_within, MAX_CFG_FILE_BYTES,
    PART_SUFFIX,
};
use crate::launch::{cloud_config_path_from, find_cloud_config, find_cloud_config_from};
use crate::mods::{ModRecord, ModSource};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    is_profile_ownable_rel_path, load_library_from, load_manifest, portable_path_key, profiles_dir,
    recover_profile_mutation_to, source_file_len, FileSource, ProfileError, ProfileFile,
    ProfileLibrary, ProfileLiveProjection,
};
use crate::surface::{
    inventory_live_surface_for_absorb, is_stock_custom_entry, is_stock_custom_pack,
};
use crate::switch::{live_candidates, live_path};

const CONFIG_CFG: &str = "tf/cfg/config.cfg";

mod drift_cache;
use drift_cache::DriftCache;

#[cfg(test)]
type TestProcessSampler = Box<dyn FnMut() -> Vec<String>>;

#[cfg(test)]
thread_local! {
    static TEST_ABSORB_PROCESS_SAMPLER: std::cell::RefCell<Option<TestProcessSampler>> =
        const { std::cell::RefCell::new(None) };
}

/// Re-sample at each absorb-owned mutation boundary. The entry-point snapshot
/// is still checked first; this closes the gap where TF2 starts after that
/// check but before a later restore, repair, cleanup, or config publication.
fn absorb_live_process_names() -> Vec<String> {
    #[cfg(test)]
    {
        let sampled = TEST_ABSORB_PROCESS_SAMPLER.with(|slot| {
            let mut slot = slot.borrow_mut();
            slot.as_mut().map(|sampler| sampler())
        });
        if let Some(names) = sampled {
            return names;
        }
    }
    live_process_names()
}

fn refuse_absorb_mutation() -> Result<Vec<String>, ProfileError> {
    let running = absorb_live_process_names();
    refuse_if_running_among(&running)?;
    Ok(running)
}

#[cfg(test)]
fn with_absorb_process_sampler<R>(
    sampler: impl FnMut() -> Vec<String> + 'static,
    run: impl FnOnce() -> R,
) -> R {
    struct RestoreSampler(Option<TestProcessSampler>);
    impl Drop for RestoreSampler {
        fn drop(&mut self) {
            TEST_ABSORB_PROCESS_SAMPLER.with(|slot| {
                *slot.borrow_mut() = self.0.take();
            });
        }
    }

    let previous = TEST_ABSORB_PROCESS_SAMPLER.with(|slot| slot.replace(Some(Box::new(sampler))));
    let _restore = RestoreSampler(previous);
    run()
}

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
    /// Capture only live packs previously answered Keep. Missing packs and
    /// other pending changes keep their existing disposition.
    CaptureKept,
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
    /// Keys whose `bind` TF2 changed in the absorbed config.cfg, compared with
    /// the profile's previous copy. `None` means TF2 removed that key's bind.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub config_bind_changes: BTreeMap<String, Option<String>>,
    /// Packs (or plain owned paths) this absorb rewrote from the library after
    /// an interrupted write. Empty on every ordinary pass.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repaired: Vec<String>,
    /// Exact manifest and complete custom inventory reviewed by the pack prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack_review: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AbsorbOptions<'a> {
    pub cloud_config: Option<&'a Path>,
    pub steam_roots: Option<&'a [PathBuf]>,
}

/// Top-level `tf/custom/` pack identity. Source mounts leading-dash names as
/// distinct search paths. Entries belonging to Valve or interrupted writes are
/// not packs at all: this is the one gate both the live scan and the manifest
/// go through, so junk can never be prompted for, absorbed, or grouped.
pub fn pack_key(rel: &str) -> Option<String> {
    if is_stock_custom_entry(rel) {
        return None;
    }
    let prefix = rel.get(.."tf/custom/".len())?;
    if !prefix.eq_ignore_ascii_case("tf/custom/") {
        return None;
    }
    let rest = rel.get("tf/custom/".len()..)?;
    let first = rest.split('/').next()?;
    if first.is_empty() {
        return None;
    }
    if cfg!(windows) {
        Some(first.to_ascii_lowercase())
    } else {
        Some(first.to_string())
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
    refuse_absorb_mutation()?;
    write_bytes(tf2_root, &live, bytes)?;
    if let Some(cloud) = cloud_config_path_from(steam_roots) {
        let cloud_root = steam_roots
            .iter()
            .find(|root| cloud.starts_with(root))
            .ok_or_else(|| {
                ProfileError::Io("Steam Cloud config resolved outside every Steam root".into())
            })?;
        refuse_absorb_mutation()?;
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
    absorb_owned_impl(
        &profiles_dir(),
        tf2_root,
        live_process_names(),
        AbsorbOptions {
            cloud_config: cloud.as_deref(),
            steam_roots: None,
        },
        true,
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
    // Switches use this entry point and must detect drift using full hashes.
    absorb_owned_impl(profiles_dir, tf2_root, running_names, options, false)
}

fn absorb_owned_impl<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    running_names: I,
    options: AbsorbOptions<'_>,
    use_cache: bool,
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
            config_bind_changes: BTreeMap::new(),
            repaired: Vec::new(),
            pack_review: None,
        });
    };

    // Before the delta is read off the live tree, put back what a killed write
    // left half-done — otherwise this pass reports the missing pack as deleted.
    let repaired = repair_interrupted_writes(profiles_dir, tf2_root, &profile_id, &running)?;
    let mut cache = use_cache.then(|| DriftCache::load(profiles_dir, &profile_id));
    let classified = classify_with_cache(
        profiles_dir,
        tf2_root,
        &profile_id,
        &options,
        cache.as_mut(),
    )?;
    let config_cfg_absorbed = classified.delta.config_cfg;
    let pending_cloud_sync = load_manifest(profiles_dir, &profile_id)?.cloud_sync_pending;
    // Read before absorbing replaces the profile's copy.
    let config_bind_changes = if config_cfg_absorbed {
        read_config_bind_changes(profiles_dir, &profile_id, &classified)?
    } else {
        BTreeMap::new()
    };
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

    let pack_review = if remaining.has_pack_changes() {
        Some(pack_review_fingerprint(
            profiles_dir,
            tf2_root,
            &profile_id,
            &options,
        )?)
    } else {
        None
    };
    if refuse_absorb_mutation().is_ok() {
        if let Some(cache) = cache {
            cache.save(profiles_dir, &profile_id);
        }
    }
    Ok(AbsorbOwnedResult {
        pack_review,
        library: load_library_from(profiles_dir, Some(tf2_root))?,
        delta: remaining,
        config_cfg_absorbed,
        config_bind_changes,
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
    if choice == PackChoice::Update {
        crate::hud::require_resolved_live_huds(profiles_dir, tf2_root, &profile_id)?;
        // This read-only preflight precedes even interrupted-write repair.
        // Updating a missing selected source must not change profile, live, or
        // recovery bytes before telling the caller to clear the selection.
        let before_repair = classify(profiles_dir, tf2_root, &profile_id, &options)?;
        refuse_selected_particle_source_removal(
            profiles_dir,
            &profile_id,
            &before_repair.pack_live_files,
        )?;
    }
    repair_interrupted_writes(profiles_dir, tf2_root, &profile_id, &running)?;
    let mut classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
    if choice == PackChoice::CaptureKept {
        let manifest = load_manifest(profiles_dir, &profile_id)?;
        let huds: BTreeSet<String> = crate::hud::live_hud_names_checked(tf2_root)?
            .into_iter()
            .filter_map(|hud| pack_key(&format!("tf/custom/{}", hud.name)))
            .collect();
        let owned: BTreeSet<String> = manifest
            .files
            .iter()
            .filter_map(|file| pack_key(&file.path))
            .collect();
        let captured: BTreeSet<String> = manifest
            .ignored_packs
            .iter()
            .filter_map(|pack| pack_key(&format!("tf/custom/{pack}")))
            .filter(|key| {
                classified.pack_live_files.contains_key(key)
                    && !owned.contains(key)
                    && !huds.contains(key)
            })
            .collect();
        let added: Vec<String> = captured
            .iter()
            .flat_map(|key| classified.pack_live_files.get(key).into_iter().flatten())
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
        )?;
        if !captured.is_empty() {
            let mut manifest = load_manifest(profiles_dir, &profile_id)?;
            manifest.ignored_packs.retain(|pack| {
                pack_key(&format!("tf/custom/{pack}")).is_none_or(|key| !captured.contains(&key))
            });
            crate::profile::save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
        }
        return load_library_from(profiles_dir, Some(tf2_root));
    }
    if choice == PackChoice::Update {
        refuse_selected_particle_source_removal(
            profiles_dir,
            &profile_id,
            &classified.pack_live_files,
        )?;
        // Update is the user changing their mind about every pack they had
        // previously kept out, so the ignore list has to go before `classify`
        // filters those packs back out of the delta.
        let mut manifest = load_manifest(profiles_dir, &profile_id)?;
        if !manifest.ignored_packs.is_empty() {
            manifest.ignored_packs.clear();
            crate::profile::save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
            classified = classify(profiles_dir, tf2_root, &profile_id, &options)?;
        }
    }

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

/// One explicit answer for one pack from a complete reviewed snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackDecision {
    pub pack: String,
    pub choice: PackAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PackAction {
    Add,
    Remove,
    Restore,
    Keep,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackReviewRequest {
    pub profile_id: String,
    pub fingerprint: String,
    pub decisions: Vec<PackDecision>,
}

fn stale_pack_review() -> ProfileError {
    ProfileError::Io(
        "Custom files or the profile changed. Refresh the custom files review and choose again."
            .into(),
    )
}

/// Never uses the absorb metadata cache: all custom bytes and the raw manifest
/// identity participate, including currently ignored and retained library packs.
fn pack_review_fingerprint(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    options: &AbsorbOptions<'_>,
) -> Result<String, ProfileError> {
    let classified = classify(profiles_dir, tf2_root, profile_id, options)?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let raw = sha256_file(&profiles_dir.join(profile_id).join("manifest.json"))
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    let mut live = BTreeMap::new();
    for (path, source) in &classified.live {
        if pack_key(path).is_some() {
            live.insert(
                path.clone(),
                sha256_file(source).map_err(|e| ProfileError::Io(e.to_string()))?,
            );
        }
    }
    let mut saved = BTreeMap::new();
    for file in &manifest.files {
        if pack_key(&file.path).is_some() {
            let source = manifest_source_path(profiles_dir, profile_id, file)?;
            saved.insert(
                file.path.clone(),
                sha256_file(&source).map_err(|e| ProfileError::Io(e.to_string()))?,
            );
        }
    }
    let evidence = serde_json::to_vec(&(tf2_root, profile_id, raw, classified.delta, live, saved))
        .map_err(|e| ProfileError::Io(e.to_string()))?;
    Ok(sha256_hex(&evidence))
}

pub fn resolve_pack_changes(
    tf2_root: &Path,
    request: PackReviewRequest,
) -> Result<ProfileLibrary, ProfileError> {
    let cloud = find_cloud_config();
    resolve_pack_changes_to(
        &profiles_dir(),
        tf2_root,
        &request,
        live_process_names(),
        AbsorbOptions {
            cloud_config: cloud.as_deref(),
            steam_roots: None,
        },
    )
}

pub fn resolve_pack_changes_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    request: &PackReviewRequest,
    running_names: I,
    options: AbsorbOptions<'_>,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running = collect_running(running_names);
    refuse_if_running_among(&running)?;
    let check = || {
        if active_profile_id(profiles_dir, tf2_root)?.as_deref()
            != Some(request.profile_id.as_str())
            || pack_review_fingerprint(profiles_dir, tf2_root, &request.profile_id, &options)?
                != request.fingerprint
        {
            return Err(stale_pack_review());
        }
        refuse_absorb_mutation()?;
        Ok(())
    };
    check()?;
    let classified = classify(profiles_dir, tf2_root, &request.profile_id, &options)?;
    let mut expected: BTreeMap<&str, bool> = classified
        .delta
        .packs_added
        .iter()
        .map(|name| (name.as_str(), true))
        .chain(
            classified
                .delta
                .packs_removed
                .iter()
                .map(|name| (name.as_str(), false)),
        )
        .collect();
    if expected.is_empty() || request.decisions.len() != expected.len() {
        return Err(stale_pack_review());
    }
    let manifest = load_manifest(profiles_dir, &request.profile_id)?;
    let selected =
        crate::preloader::selected_profile_particle_mod_ids(profiles_dir, &request.profile_id)?;
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut restored = Vec::new();
    let mut ignored = manifest.ignored_packs.clone();
    for decision in &request.decisions {
        let is_added = expected
            .remove(decision.pack.as_str())
            .ok_or_else(stale_pack_review)?;
        let paths = if is_added {
            classified.pack_live_files.get(&decision.pack)
        } else {
            classified.pack_manifest_files.get(&decision.pack)
        }
        .ok_or_else(stale_pack_review)?;
        match decision.choice {
            PackAction::Add if is_added => added.extend(paths.iter().cloned()),
            PackAction::Remove if !is_added => {
                for record in &manifest.mods {
                    if selected.contains(&record.id)
                        && pack_key(&format!("tf/custom/{}", record.pack)).as_ref()
                            == Some(&decision.pack)
                    {
                        return Err(ProfileError::ParticleSourceSelected(record.name.clone()));
                    }
                }
                removed.extend(paths.iter().cloned());
            }
            PackAction::Restore if !is_added => restored.extend(paths.iter().cloned()),
            PackAction::Keep => ignored.push(decision.pack.clone()),
            _ => return Err(stale_pack_review()),
        }
    }
    if !added.is_empty() {
        crate::hud::require_resolved_live_huds(profiles_dir, tf2_root, &request.profile_id)?;
    }
    ignored.sort();
    ignored.dedup();
    absorb_live_files_reviewed(
        profiles_dir,
        tf2_root,
        &request.profile_id,
        &added,
        &removed,
        &classified.live,
        &running,
        Some(PackResolution {
            restore: &restored,
            ignored: &ignored,
            precommit: &check,
        }),
    )?;
    load_library_from(profiles_dir, Some(tf2_root))
}

/// Profile selections own their particle sources. An accepted external
/// removal must stop before publishing any profile mutation whenever the
/// missing pack still owns one of this profile's selected IDs. Keep and
/// Restore do not delete library sources and never call this guard.
fn refuse_selected_particle_source_removal(
    profiles_dir: &Path,
    profile_id: &str,
    live_packs: &BTreeMap<String, Vec<String>>,
) -> Result<(), ProfileError> {
    let selected = crate::preloader::selected_profile_particle_mod_ids(profiles_dir, profile_id)?;
    if selected.is_empty() {
        return Ok(());
    }
    let manifest = load_manifest(profiles_dir, profile_id)?;
    for record in &manifest.mods {
        if !selected.iter().any(|id| id == &record.id) {
            continue;
        }
        let rel = format!("tf/custom/{}", record.pack);
        if pack_key(&rel).is_some_and(|pack| !live_packs.contains_key(&pack)) {
            return Err(ProfileError::ParticleSourceSelected(record.name.clone()));
        }
    }
    Ok(())
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
    crate::hud::require_resolved_live_huds(profiles_dir, tf2_root, &profile_id)?;
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
    refuse_if_running_among(running)?;
    refuse_absorb_mutation()?;
    recover_profile_mutation_to(profiles_dir, tf2_root, profile_id)?;
    crate::hud::recover_legacy_hud_backups_to(profiles_dir, tf2_root, profile_id, running)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    let before_files = manifest.files.len();
    // Older builds could accidentally claim Valve/global/junk entries. Drop
    // those metadata records without reading or touching their live paths.
    manifest
        .files
        .retain(|file| is_profile_ownable_rel_path(&file.path));
    let mut repaired_packs = BTreeSet::new();
    let mut repaired_files = Vec::new();
    let inactive_huds = crate::hud::inactive_hud_packs(&manifest);
    for file in &manifest.files {
        if is_stock_custom_entry(&file.path)
            || pack_key(&file.path).is_some_and(|pack| inactive_huds.contains(&pack))
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
        refuse_absorb_mutation()?;
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
        let fresh_running = refuse_absorb_mutation()?;
        crate::profile::save_manifest(profiles_dir, tf2_root, &manifest, &fresh_running)?;
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
        if path.parent() == Some(tf2_root.join("tf/custom").as_path())
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(crate::surface::HUD_BACKUP_CONTAINER)
        {
            continue;
        }
        if kind.is_dir() {
            remove_stray_parts(tf2_root, &path)?;
        } else if kind.is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(PART_SUFFIX)
        {
            refuse_absorb_mutation()?;
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
    let inactive_huds = crate::hud::inactive_hud_packs(&manifest);
    for path in paths {
        let Some(file) = manifest.files.iter().find(|file| &file.path == path) else {
            continue;
        };
        if !is_profile_ownable_rel_path(path) {
            return Err(ProfileError::ForbiddenPath(path.clone()));
        }
        if pack_key(path).is_some_and(|pack| inactive_huds.contains(&pack)) {
            continue;
        }
        let source = manifest_source_path(profiles_dir, profile_id, file)?;
        refuse_absorb_mutation()?;
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
    classify_with_cache(profiles_dir, tf2_root, profile_id, options, None)
}

fn classify_with_cache(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    options: &AbsorbOptions<'_>,
    mut cache: Option<&mut DriftCache>,
) -> Result<Classified, ProfileError> {
    let cloud = resolve_inventory_cloud(options);
    let inventory = inventory_live_surface_for_absorb(tf2_root, cloud.as_deref())?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let inactive_huds = crate::hud::inactive_hud_packs(&manifest);
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
                // Configs are small and safety-sensitive. Only ordinary custom
                // payloads can use metadata hints, and only automatic absorb
                // supplies a cache. Review/resolve/switch paths hash fully.
                let hash = if let Some(cache) = cache.as_deref_mut().filter(|_| {
                    pack_key(&file.path).is_some()
                        && !file.path.to_ascii_lowercase().ends_with(".cfg")
                }) {
                    cache.hash(source)?
                } else {
                    sha256_file(source).map_err(|e| ProfileError::Io(e.to_string()))?
                };
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
                Some(pack) if live_pack_keys.contains(&pack) && !inactive_huds.contains(&pack) => {
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
        .filter(|pack| !inactive_huds.contains(*pack))
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

/// The live tree retains literal pack names. Only Windows case-only changes
/// reconcile to existing manifest spellings; a leading dash is never a rename.
fn live_by_manifest_spelling(
    entries: Vec<crate::surface::InventoryEntry>,
    _manifest_paths: &BTreeSet<String>,
) -> Result<HashMap<String, PathBuf>, ProfileError> {
    let live: HashMap<String, PathBuf> = entries
        .into_iter()
        .map(|entry| (entry.dest_rel, entry.source))
        .collect();
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
    // component so it cannot become a put
    // followed by a removal of the same portable identity. Linux keeps the
    // actual spelling; its rename is committed as one addition/removal batch.
    #[cfg(windows)]
    {
        let spellings = _manifest_paths
            .iter()
            .map(|path| Ok((portable_path_key(path)?, path)))
            .collect::<Result<HashMap<_, _>, ProfileError>>()?;
        live.into_iter()
            .map(|(path, source)| {
                let key = portable_path_key(&path)?;
                let path = spellings
                    .get(&key)
                    .map_or(path, |spelling| (*spelling).clone());
                Ok((path, source))
            })
            .collect::<Result<_, ProfileError>>()
    }
    #[cfg(not(windows))]
    Ok(live)
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
    absorb_live_files_reviewed(
        profiles_dir,
        tf2_root,
        profile_id,
        paths,
        remove_paths,
        live,
        running,
        None,
    )
}

struct PackResolution<'a> {
    restore: &'a [String],
    ignored: &'a [String],
    precommit: &'a dyn Fn() -> Result<(), ProfileError>,
}

#[allow(clippy::too_many_arguments)]
fn absorb_live_files_reviewed<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    paths: &[String],
    remove_paths: &[String],
    live: &HashMap<String, PathBuf>,
    running: I,
    resolution: Option<PackResolution<'_>>,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut batch: Vec<(String, FileSource<'_>)> = paths
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
    if batch.is_empty() && remove_paths.is_empty() && resolution.is_none() {
        return Ok(());
    }
    let before = load_manifest(profiles_dir, profile_id)?;
    // Restored paths keep their saved provenance. Their bytes are verified before
    // staging and again with the complete review immediately before publication.
    let restored_sources: Vec<(String, PathBuf)> = resolution
        .as_ref()
        .into_iter()
        .flat_map(|review| review.restore.iter())
        .map(|path| {
            let file = before
                .files
                .iter()
                .find(|file| &file.path == path)
                .ok_or(ProfileError::InvalidPath)?;
            let source = manifest_source_path(profiles_dir, profile_id, file)?;
            if sha256_file(&source).map_err(|e| ProfileError::Io(e.to_string()))? != file.sha256 {
                return Err(ProfileError::Io(format!(
                    "Saved pack changed: {path}. Review custom files again."
                )));
            }
            Ok((path.clone(), source))
        })
        .collect::<Result<_, ProfileError>>()?;
    for (path, source) in &restored_sources {
        batch.push((
            path.clone(),
            FileSource::PathExact {
                path: source,
                expected_len: source_file_len(source)?,
            },
        ));
    }
    let selected_hud = crate::hud::selected_hud_pack(&before);
    let selected_was_validated = selected_hud.is_some();
    // An older explicit record may outlive invalid/opaque HUD metadata. It
    // still needs clearing when the user accepts removal of its whole pack;
    // that does not make arbitrary info.vdf files into validated HUD roots.
    let selected_hud_key = selected_hud
        .as_deref()
        .or_else(|| before.hud.as_ref().map(|record| record.id.as_str()))
        .and_then(|pack| pack_key(&format!("tf/custom/{pack}")));
    let mut hud_roots = crate::hud::manifest_hud_packs(&before);
    for (path, source) in &batch {
        let Some(rest) = path.strip_prefix("tf/custom/") else {
            continue;
        };
        let Some((folder, rel)) = rest.split_once('/') else {
            continue;
        };
        if !rel.eq_ignore_ascii_case("info.vdf") {
            continue;
        }
        if let FileSource::PathExact { path: source, .. } = source {
            let bytes = crate::archive::read_regular_file_bounded(source, 1024 * 1024)?
                .ok_or_else(|| {
                    ProfileError::Io("HUD info.vdf exceeds the inspection limit.".into())
                })?;
            hud_roots.retain(|root| !root.eq_ignore_ascii_case(folder));
            if crate::hud::is_current_hud_info(&bytes) {
                hud_roots.push(folder.to_string());
            }
        }
    }
    let previous_files: HashMap<&str, &ProfileFile> = before
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let touched: BTreeSet<String> = paths
        .iter()
        .chain(remove_paths)
        .filter_map(|path| pack_key(path))
        .collect();
    let lengths: HashMap<&str, u64> = batch
        .iter()
        .filter_map(|(path, source)| match source {
            FileSource::PathExact { expected_len, .. } => Some((path.as_str(), *expected_len)),
            _ => None,
        })
        .collect();
    let accepted_pack_names: BTreeMap<String, String> = paths
        .iter()
        .filter_map(|path| {
            let key = pack_key(path)?;
            let name = path.get("tf/custom/".len()..)?.split('/').next()?;
            Some((key, name.to_string()))
        })
        .collect();
    let accepted_paths: Vec<&str> = paths
        .iter()
        .chain(remove_paths)
        .map(String::as_str)
        .collect();
    let crosshair_pack_changed = accepted_paths.iter().any(|path| {
        path.to_ascii_lowercase()
            .starts_with("tf/custom/execs-crosshairs/")
    });
    let mut crosshair_cfg_changed = false;
    for path in paths.iter().chain(remove_paths) {
        if !path.eq_ignore_ascii_case("tf/cfg/overrides/execs_gameplay.cfg")
            && !path.eq_ignore_ascii_case("tf/cfg/execs_gameplay.cfg")
        {
            continue;
        }
        let old = match before
            .files
            .iter()
            .find(|file| file.path.eq_ignore_ascii_case(path))
        {
            Some(file) => read_small_file_bounded(
                &manifest_source_path(profiles_dir, profile_id, file)?,
                MAX_CFG_FILE_BYTES,
            )
            .map_err(|error| ProfileError::Io(error.to_string()))?,
            None => Vec::new(),
        };
        let new = match live.get(path) {
            Some(source) => read_small_file_bounded(source, MAX_CFG_FILE_BYTES)
                .map_err(|error| ProfileError::Io(error.to_string()))?,
            None => Vec::new(),
        };
        crosshair_cfg_changed |= crate::apply::gameplay_crosshair_values_changed(&old, &new);
    }
    let crosshair_source_changed = crosshair_pack_changed || crosshair_cfg_changed;
    let viewmodel_source_changed = accepted_paths
        .iter()
        .any(|path| path.eq_ignore_ascii_case(crate::viewmodel::EXECS_VIEWMODELS_VPK));
    let hitsound_source_changed = accepted_paths.iter().any(|path| {
        path.eq_ignore_ascii_case(crate::hitsound::HITSOUND_REL)
            || path.eq_ignore_ascii_case(crate::hitsound::KILLSOUND_REL)
    });
    refuse_absorb_mutation()?;
    crate::profile::mutate_profile_files_checked_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &batch,
        remove_paths,
        if resolution.is_some() {
            ProfileLiveProjection::MirrorIfActive
        } else {
            ProfileLiveProjection::LibraryOnly
        },
        running,
        |manifest| {
            if let Some(review) = &resolution {
                manifest.ignored_packs = review.ignored.to_vec();
            }

            hud_roots.retain(|root| {
                manifest.files.iter().any(|file| {
                    pack_key(&file.path).is_some_and(|pack| pack.eq_ignore_ascii_case(root))
                })
            });
            manifest.hud_roots = Some(hud_roots.clone());
            // Reconcile only accepted changes, against the planned manifest, not
            // the live tree. Kept/Restored packs and inactive HUDs still belong
            // to the library even when absent from the live inventory.
            let groups = group_by_pack(manifest.files.iter().map(|file| &file.path));
            let pack_bytes = |files: &[String]| -> Result<u64, ProfileError> {
                files.iter().try_fold(0u64, |total, path| {
                    let len = match lengths.get(path.as_str()) {
                        Some(len) => *len,
                        None => {
                            let file = previous_files
                                .get(path.as_str())
                                .ok_or(ProfileError::InvalidPath)?;
                            source_file_len(&manifest_source_path(profiles_dir, profile_id, file)?)?
                        }
                    };
                    total.checked_add(len).ok_or_else(|| {
                        ProfileError::Io("Mod size exceeds the supported limit".into())
                    })
                })
            };
            let mut records = Vec::with_capacity(manifest.mods.len());
            for mut record in manifest.mods.iter().cloned() {
                let key = pack_key(&format!("tf/custom/{}", record.pack));
                if let Some(key) = key.filter(|key| touched.contains(key)) {
                    let Some(files) = groups.get(&key) else {
                        continue;
                    };
                    record.files = files.len();
                    record.bytes = pack_bytes(files)?;
                }
                records.push(record);
            }
            let hud_packs: BTreeSet<String> = crate::hud::manifest_hud_packs(manifest)
                .into_iter()
                .filter_map(|name| pack_key(&format!("tf/custom/{name}")))
                .collect();
            for (key, pack) in &accepted_pack_names {
                if pack.to_ascii_lowercase().starts_with(APP_PACK_PREFIX)
                    || pack.to_ascii_lowercase().starts_with("mastercomfig")
                    || hud_packs.contains(key)
                    || records.iter().any(|record| {
                        pack_key(&format!("tf/custom/{}", record.pack)).as_ref() == Some(key)
                    })
                {
                    continue;
                }
                let Some(files) = groups.get(key) else {
                    continue;
                };
                let digest = sha256_hex(key.as_bytes());
                let id = [24, 32, 64]
                    .into_iter()
                    .map(|len| format!("external-{}", &digest[..len]))
                    .find(|id| records.iter().all(|record| record.id != *id))
                    .ok_or_else(|| ProfileError::Io("External pack identity collision".into()))?;
                records.push(ModRecord {
                    id,
                    name: pack.clone(),
                    source: ModSource::External,
                    pack: pack.clone(),
                    files: files.len(),
                    bytes: pack_bytes(files)?,
                    installed_at: crate::profile::utc_rfc3339(),
                    inactive_pack: None,
                });
            }
            manifest.mods = records;
            if crosshair_source_changed {
                if let Some(record) = manifest.crosshair.as_mut() {
                    record.source_changed = true;
                }
            }
            if viewmodel_source_changed {
                if let Some(record) = manifest.viewmodel.as_mut() {
                    record.source_changed = true;
                }
            }
            if hitsound_source_changed {
                if let Some(record) = manifest.hitsound.as_mut() {
                    record.source_changed = true;
                }
            }
            if selected_hud_key.as_ref().is_some_and(|pack| {
                touched.contains(pack)
                    && (!groups.contains_key(pack)
                        || (selected_was_validated
                            && !crate::hud::manifest_hud_packs(manifest)
                                .iter()
                                .any(|root| root.eq_ignore_ascii_case(pack))))
            }) {
                manifest.hud = None;
                manifest.hud_selected_root = None;
                manifest.hud_review_pending = !crate::hud::manifest_hud_packs(manifest).is_empty();
            }
            Ok(())
        },
        resolution.as_ref().map(|review| review.precommit),
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

/// Binds TF2 changed between the profile's config.cfg and the live one it
/// just wrote. A key is listed only when its final bind differs.
fn read_config_bind_changes(
    profiles_dir: &Path,
    profile_id: &str,
    classified: &Classified,
) -> Result<BTreeMap<String, Option<String>>, ProfileError> {
    let read = |path: &Path| {
        read_small_file_bounded(path, MAX_CFG_FILE_BYTES)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .map_err(|e| ProfileError::Io(e.to_string()))
    };
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let previous = match manifest.files.iter().find(|file| file.path == CONFIG_CFG) {
        Some(file) => read(&manifest_source_path(profiles_dir, profile_id, file)?)?,
        None => String::new(),
    };
    let current = match classified.live.get(CONFIG_CFG) {
        Some(path) => read(path)?,
        None => String::new(),
    };
    Ok(diff_binds(
        &config_binds(&previous),
        &config_binds(&current),
    ))
}

/// Final `bind` table of one config.cfg, keys lowercased.
fn config_binds(text: &str) -> BTreeMap<String, String> {
    let mut binds = BTreeMap::new();
    for line in text.lines() {
        let parts = crate::profile_compare::tokens(line);
        match parts
            .first()
            .map(|name| name.to_ascii_lowercase())
            .as_deref()
        {
            Some("bind") if parts.len() >= 3 => {
                binds.insert(parts[1].to_ascii_lowercase(), parts[2..].join(" "));
            }
            Some("unbind") if parts.len() >= 2 => {
                binds.remove(&parts[1].to_ascii_lowercase());
            }
            Some("unbindall") => binds.clear(),
            _ => {}
        }
    }
    binds
}

fn diff_binds(
    previous: &BTreeMap<String, String>,
    current: &BTreeMap<String, String>,
) -> BTreeMap<String, Option<String>> {
    let mut changes = BTreeMap::new();
    for (key, command) in current {
        if previous.get(key) != Some(command) {
            changes.insert(key.clone(), Some(command.clone()));
        }
    }
    for key in previous.keys() {
        if !current.contains_key(key) {
            changes.insert(key.clone(), None);
        }
    }
    changes
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
    refuse_if_running_among(running)?;
    let fresh_running = refuse_absorb_mutation()?;
    crate::profile::save_manifest(profiles_dir, tf2_root, &manifest, &fresh_running)
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

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
    fn pack_key_preserves_leading_dash() {
        assert_eq!(pack_key("tf/custom/hud/resource/ui/x"), Some("hud".into()));
        assert_eq!(pack_key("tf/custom/-hud/info.vdf"), Some("-hud".into()));
        assert_eq!(
            pack_key("tf/custom/-workshop/a.txt"),
            Some("-workshop".into())
        );
        assert_eq!(pack_key("tf/custom/-"), Some("-".into()));
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
        assert_ne!(
            pack_key("tf/custom/-Hud/info.vdf"),
            pack_key("tf/custom/Hud/info.vdf")
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_pack_keys_fold_case_but_preserve_dashes() {
        assert_eq!(
            pack_key("tf/custom/Hud/info.vdf"),
            pack_key("tf/custom/hud/info.vdf")
        );
        assert_ne!(
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
    #[ignore = "reads a disposable 5 GiB payload; run for the large-absorb benchmark"]
    fn large_absorb_benchmark() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Team Fortress 2");
        let profiles = dir.path().join("profiles");
        let payload = root.join("tf/custom/large/textures.bin");
        write_file(&payload, "");
        let id = save_main(&profiles, &root);
        fs::File::options()
            .write(true)
            .open(&payload)
            .unwrap()
            .set_len(5 * 1024 * 1024 * 1024)
            .unwrap();
        for pass in 1..=2 {
            let start = std::time::Instant::now();
            let delta = classify(&profiles, &root, &id, &opts(None)).unwrap().delta;
            assert_eq!(delta.owned_changed, ["tf/custom/large/textures.bin"]);
            eprintln!("Full 5 GiB classify pass {pass}: {:?}", start.elapsed());
        }
        let mut cache = DriftCache::default();
        for pass in 1..=2 {
            let start = std::time::Instant::now();
            let delta = classify_with_cache(&profiles, &root, &id, &opts(None), Some(&mut cache))
                .unwrap()
                .delta;
            assert_eq!(delta.owned_changed, ["tf/custom/large/textures.bin"]);
            eprintln!(
                "Cached 5 GiB classify pass {pass}: {:?}; cumulative full hashes {}",
                start.elapsed(),
                cache.hashes
            );
        }
        assert_eq!(cache.hashes, 1);
        // Complete a consistent saved fixture without copying a 5 GiB buffer:
        // both files consist of the same zero-filled extended file bytes.
        let mut manifest = load_manifest(&profiles, &id).unwrap();
        manifest.files[0].sha256 = cache.hash(&payload).unwrap();
        fs::File::options()
            .write(true)
            .open(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/large/textures.bin",
            ))
            .unwrap()
            .set_len(5 * 1024 * 1024 * 1024)
            .unwrap();
        fs::write(
            crate::profile::manifest_file(&profiles, &id),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        cache.save(&profiles, &id);
        let start = std::time::Instant::now();
        let result = absorb_owned_impl(&profiles, &root, unlocked(), opts(None), true).unwrap();
        assert_eq!(result.delta, AbsorbDelta::empty());
        assert!(result.repaired.is_empty());
        eprintln!(
            "Complete unchanged 5 GiB automatic absorb with persisted cache: {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn automatic_absorb_cache_never_authorizes_switch_or_cfg_drift() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("tf2");
        let profiles = dir.path().join("profiles");
        let payload = root.join("tf/custom/skins/texture.bin");
        let cfg = root.join("tf/cfg/autoexec.cfg");
        write_file(&payload, "old");
        write_file(&cfg, "echo old\n");
        let id = save_main(&profiles, &root);
        let original_time = fs::metadata(&payload).unwrap().modified().unwrap();
        absorb_owned_impl(&profiles, &root, unlocked(), opts(None), true).unwrap();
        let mut cache = DriftCache::load(&profiles, &id);
        cache.hash(&payload).unwrap();
        assert_eq!(
            cache.hashes, 0,
            "successful automatic absorb persisted its observation"
        );

        write_file(&payload, "new");
        fs::File::options()
            .write(true)
            .open(&payload)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(original_time))
            .unwrap();
        write_file(&cfg, "echo new\n");
        let classified =
            classify_with_cache(&profiles, &root, &id, &opts(None), Some(&mut cache)).unwrap();
        assert!(classified
            .delta
            .owned_changed
            .contains(&"tf/cfg/autoexec.cfg".into()));

        // Switch preflight always invokes the uncached entry point. Even a
        // same-size rewrite with its original mtime must be captured first.
        let other = crate::profile::create_profile_record_to(&profiles, &root, "Other", unlocked())
            .unwrap()
            .profiles
            .last()
            .unwrap()
            .id
            .clone();
        crate::switch::switch_profile_to(&profiles, &root, &other, unlocked(), opts(None), |_| {})
            .unwrap();
        crate::switch::switch_profile_to(&profiles, &root, &id, unlocked(), opts(None), |_| {})
            .unwrap();
        assert_eq!(fs::read(&payload).unwrap(), b"new");
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/skins/texture.bin"
            ))
            .unwrap(),
            b"new"
        );
    }

    #[test]
    fn legacy_stock_cfgs_are_not_projected_or_removed_by_absorb_and_switch() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("tf2");
        let profiles = dir.path().join("profiles");
        write_file(&root.join("tf/cfg/autoexec.cfg"), "echo player\n");
        write_file(&root.join("tf/cfg/server_casual.cfg"), "Valve live\n");
        let id = save_main(&profiles, &root);
        let mut manifest = load_manifest(&profiles, &id).unwrap();
        assert!(!manifest
            .files
            .iter()
            .any(|file| file.path.contains("server_casual")));
        let rel = "tf/cfg/server_casual.cfg";
        let library_copy = exclusive_file_path(&profiles, &id, rel);
        write_file(&library_copy, "old snapshot\n");
        manifest.files.push(ProfileFile {
            path: rel.into(),
            sha256: sha256_hex(b"old snapshot\n"),
            storage: crate::profile::FileStorage::Exclusive,
        });
        fs::write(
            crate::profile::manifest_file(&profiles, &id),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let other = crate::profile::create_profile_record_to(&profiles, &root, "Other", unlocked())
            .unwrap()
            .profiles
            .last()
            .unwrap()
            .id
            .clone();
        absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        crate::switch::switch_profile_to(&profiles, &root, &other, unlocked(), opts(None), |_| {})
            .unwrap();
        assert_eq!(fs::read(root.join(rel)).unwrap(), b"Valve live\n");
        crate::switch::switch_profile_to(&profiles, &root, &id, unlocked(), opts(None), |_| {})
            .unwrap();
        assert_eq!(fs::read(root.join(rel)).unwrap(), b"Valve live\n");
        crate::profile::rename_profile_to(&profiles, &root, &id, "Renamed", unlocked()).unwrap();
        let raw: serde_json::Value = serde_json::from_slice(
            &fs::read(crate::profile::manifest_file(&profiles, &id)).unwrap(),
        )
        .unwrap();
        assert!(!raw["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"] == rel));
        assert_eq!(fs::read(library_copy).unwrap(), b"old snapshot\n");
        assert_eq!(fs::read(root.join(rel)).unwrap(), b"Valve live\n");
    }

    #[test]
    fn config_bind_changes_list_only_keys_tf2_changed() {
        let previous = config_binds(
            "bind \"w\" \"+forward\"
bind \"e\" \"voicemenu 0 0\"
bind \"q\" \"lastinv\"
",
        );
        let current = config_binds(
            "bind \"W\" \"+forward\"
bind \"e\" \"+use\" // note
bind \"h\" \"voicemenu 0 0\"
",
        );
        assert_eq!(
            diff_binds(&previous, &current),
            BTreeMap::from([
                ("e".to_string(), Some("+use".to_string())),
                ("h".to_string(), Some("voicemenu 0 0".to_string())),
                ("q".to_string(), None),
            ])
        );
        assert!(diff_binds(&previous, &previous).is_empty());
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
        assert_eq!(
            result.config_bind_changes,
            BTreeMap::from([("w".to_string(), Some("+forward".to_string()))])
        );
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

    /// A manual dash rename is an addition/removal decision, never automatic
    /// attribution of another pack's bytes to the previous manifest identity.
    #[test]
    fn a_dashed_rename_waits_for_update_before_changing_library_identity() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        write_live(&root.join("tf/custom/hud/resource/ui/a.res"), "a\n");
        let id = save_main(&profiles, &root);
        fs::rename(root.join("tf/custom/hud"), root.join("tf/custom/-hud")).unwrap();
        // Edited and added after the literal pack rename.
        write_live(&root.join("tf/custom/-hud/resource/ui/a.res"), "a2\n");
        write_live(&root.join("tf/custom/-hud/resource/ui/b.res"), "b\n");

        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();

        assert!(result.delta.owned_missing.is_empty(), "{:?}", result.delta);
        assert_eq!(result.delta.packs_added, ["-hud"]);
        assert_eq!(result.delta.packs_removed, ["hud"]);
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/hud/resource/ui/a.res"
            ))
            .unwrap(),
            b"a\n"
        );
        absorb_packs_to(&profiles, &root, PackChoice::Update, unlocked(), opts(None)).unwrap();
        let manifest = load_manifest(&profiles, &id).unwrap();
        let paths: Vec<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"tf/custom/-hud/info.vdf"));
        assert!(paths.contains(&"tf/custom/-hud/resource/ui/b.res"));
        assert!(
            !paths.iter().any(|p| p.starts_with("tf/custom/hud/")),
            "{paths:?}"
        );
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/-hud/resource/ui/a.res"
            ))
            .unwrap(),
            b"a2\n"
        );
        assert!(exclusive_file_path(&profiles, &id, "tf/custom/-hud/info.vdf").is_file());
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
        crate::cfg_layer::write_test_base(&root);
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
    fn leading_dash_is_a_distinct_pack() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/hud/info.vdf"), "hud\n");
        save_main(&profiles, &root);
        fs::rename(root.join("tf/custom/hud"), root.join("tf/custom/-hud")).unwrap();
        let delta = scan_absorb_delta_to(&profiles, &root, opts(None)).unwrap();
        assert_eq!(delta.packs_added, ["-hud"]);
        assert_eq!(delta.packs_removed, ["hud"]);
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
    fn config_dual_write_stops_before_cloud_when_tf2_starts_mid_operation() {
        let dir = crate::test_temp_dir();
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
        let cloud = steam
            .join("userdata")
            .join("111")
            .join("440")
            .join("remote")
            .join("cfg")
            .join("config.cfg");
        write_live(&root.join("tf/cfg/config.cfg"), "old live\n");
        write_live(&cloud, "old cloud\n");

        let samples = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&samples);
        let result = with_absorb_process_sampler(
            move || {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    unlocked().iter().map(|name| (*name).to_string()).collect()
                } else {
                    vec![tf2_name().to_string()]
                }
            },
            || write_config_cfg_dual_to(&root, b"new config\n", std::slice::from_ref(&steam)),
        );

        assert_eq!(result.unwrap_err(), ProfileError::GameRunning);
        assert_eq!(
            fs::read(root.join("tf/cfg/config.cfg")).unwrap(),
            b"new config\n"
        );
        assert_eq!(fs::read(cloud).unwrap(), b"old cloud\n");
        assert_eq!(samples.load(Ordering::SeqCst), 2);
        cleanup(&dir);
    }

    #[test]
    fn restore_stops_between_files_when_tf2_starts() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/first.vpk"), "first\n");
        write_live(&root.join("tf/custom/second.vpk"), "second\n");
        let id = save_main(&profiles, &root);
        fs::remove_file(root.join("tf/custom/first.vpk")).unwrap();
        fs::remove_file(root.join("tf/custom/second.vpk")).unwrap();

        let samples = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&samples);
        let paths = vec![
            "tf/custom/first.vpk".to_string(),
            "tf/custom/second.vpk".to_string(),
        ];
        let result = with_absorb_process_sampler(
            move || {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    unlocked().iter().map(|name| (*name).to_string()).collect()
                } else {
                    vec![tf2_name().to_string()]
                }
            },
            || write_library_files_to_live(&profiles, &root, &id, &paths),
        );

        assert_eq!(result.unwrap_err(), ProfileError::GameRunning);
        assert_eq!(
            fs::read(root.join("tf/custom/first.vpk")).unwrap(),
            b"first\n"
        );
        assert!(!root.join("tf/custom/second.vpk").exists());
        assert_eq!(load_manifest(&profiles, &id).unwrap().files.len(), 3);

        write_library_files_to_live(&profiles, &root, &id, &paths).unwrap();
        assert_eq!(
            fs::read(root.join("tf/custom/second.vpk")).unwrap(),
            b"second\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn interrupted_write_repair_stops_and_remains_retryable_when_tf2_starts() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/custom/execs-first.vpk"), "first\n");
        write_live(&root.join("tf/custom/execs-second.vpk"), "second\n");
        let id = save_main(&profiles, &root);
        fs::remove_file(root.join("tf/custom/execs-first.vpk")).unwrap();
        fs::remove_file(root.join("tf/custom/execs-second.vpk")).unwrap();

        let samples = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&samples);
        let result = with_absorb_process_sampler(
            move || {
                if calls.fetch_add(1, Ordering::SeqCst) < 2 {
                    unlocked().iter().map(|name| (*name).to_string()).collect()
                } else {
                    vec![tf2_name().to_string()]
                }
            },
            || repair_interrupted_writes(&profiles, &root, &id, &[unlocked()[0].to_string()]),
        );

        assert_eq!(result.unwrap_err(), ProfileError::GameRunning);
        assert_eq!(
            fs::read(root.join("tf/custom/execs-first.vpk")).unwrap(),
            b"first\n"
        );
        assert!(!root.join("tf/custom/execs-second.vpk").exists());

        let repaired =
            repair_interrupted_writes(&profiles, &root, &id, &[unlocked()[0].to_string()]).unwrap();
        assert_eq!(repaired, vec!["execs-second.vpk".to_string()]);
        assert_eq!(
            fs::read(root.join("tf/custom/execs-second.vpk")).unwrap(),
            b"second\n"
        );
        cleanup(&dir);
    }

    #[test]
    fn stray_part_cleanup_stops_between_removals_when_tf2_starts() {
        let dir = crate::test_temp_dir();
        let root = dir.join("Team Fortress 2");
        let custom = root.join("tf/custom");
        write_live(&custom.join("a.vpk.execs-part"), "a\n");
        write_live(&custom.join("b.vpk.execs-part"), "b\n");

        let samples = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&samples);
        let result = with_absorb_process_sampler(
            move || {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    unlocked().iter().map(|name| (*name).to_string()).collect()
                } else {
                    vec![tf2_name().to_string()]
                }
            },
            || remove_stray_parts(&root, &custom),
        );

        assert_eq!(result.unwrap_err(), ProfileError::GameRunning);
        let remaining = fs::read_dir(&custom)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .count();
        assert_eq!(remaining, 1);
        remove_stray_parts(&root, &custom).unwrap();
        assert_eq!(fs::read_dir(&custom).unwrap().count(), 0);
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
    fn mixed_review_fixture() -> (PathBuf, PathBuf, PathBuf, PackReviewRequest) {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("Team Fortress 2");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        for pack in ["remove.vpk", "restore.vpk", "saved.vpk"] {
            write_live(&root.join("tf/custom").join(pack), pack);
        }
        let id = save_main(&profiles, &root);
        for pack in ["remove.vpk", "restore.vpk", "saved.vpk"] {
            fs::remove_file(root.join("tf/custom").join(pack)).unwrap();
        }
        for pack in ["add.vpk", "leave.vpk"] {
            write_live(&root.join("tf/custom").join(pack), pack);
        }
        let result = absorb_owned_to(&profiles, &root, unlocked(), opts(None)).unwrap();
        let request = PackReviewRequest {
            profile_id: id,
            fingerprint: result.pack_review.unwrap(),
            decisions: [
                ("add.vpk", PackAction::Add),
                ("leave.vpk", PackAction::Keep),
                ("remove.vpk", PackAction::Remove),
                ("restore.vpk", PackAction::Restore),
                ("saved.vpk", PackAction::Keep),
            ]
            .into_iter()
            .map(|(pack, choice)| PackDecision {
                pack: pack.into(),
                choice,
            })
            .collect(),
        };
        (dir, profiles, root, request)
    }

    #[test]
    fn reviewed_mixed_pack_choices_commit_together_and_cannot_replay() {
        let (dir, profiles, root, request) = mixed_review_fixture();
        resolve_pack_changes_to(&profiles, &root, &request, unlocked(), opts(None)).unwrap();
        let manifest = load_manifest(&profiles, &request.profile_id).unwrap();
        let packs = manifest_pack_keys(&manifest.files);
        for pack in ["add.vpk", "restore.vpk", "saved.vpk"] {
            assert!(packs.contains(pack));
        }
        for pack in ["leave.vpk", "remove.vpk"] {
            assert!(!packs.contains(pack));
        }
        assert_eq!(manifest.ignored_packs, vec!["leave.vpk", "saved.vpk"]);
        assert_eq!(
            fs::read(root.join("tf/custom/restore.vpk")).unwrap(),
            b"restore.vpk"
        );
        assert!(root.join("tf/custom/leave.vpk").is_file());
        assert!(!root.join("tf/custom/saved.vpk").exists());
        assert!(scan_absorb_delta_to(&profiles, &root, opts(None))
            .unwrap()
            .packs_added
            .is_empty());
        assert!(
            resolve_pack_changes_to(&profiles, &root, &request, unlocked(), opts(None)).is_err()
        );
        cleanup(&dir);
    }

    #[test]
    fn reviewed_packs_reject_changed_live_saved_and_profile_identity() {
        for change in 0..4 {
            let (dir, profiles, root, mut request) = mixed_review_fixture();
            let manifest = load_manifest(&profiles, &request.profile_id).unwrap();
            match change {
                0 => write_live(&root.join("tf/custom/add.vpk"), "different"),
                1 => {
                    let file = manifest
                        .files
                        .iter()
                        .find(|file| file.path == "tf/custom/restore.vpk")
                        .unwrap();
                    write_live(
                        &manifest_source_path(&profiles, &request.profile_id, file).unwrap(),
                        "different",
                    );
                }
                2 => request.profile_id = "another-profile".into(),
                _ => write_live(&root.join("tf/custom/new.vpk"), "new"),
            }
            assert!(
                resolve_pack_changes_to(&profiles, &root, &request, unlocked(), opts(None))
                    .is_err()
            );
            assert!(!root.join("tf/custom/restore.vpk").exists());
            assert_eq!(load_manifest(&profiles, &manifest.id).unwrap(), manifest);
            cleanup(&dir);
        }
    }

    #[test]
    fn reviewed_packs_reject_incomplete_duplicate_invalid_and_running_choices() {
        for change in 0..4 {
            let (dir, profiles, root, mut request) = mixed_review_fixture();
            let before = load_manifest(&profiles, &request.profile_id).unwrap();
            match change {
                0 => {
                    request.decisions.pop();
                }
                1 => {
                    request.decisions[1] = request.decisions[0].clone();
                }
                2 => request.decisions[0].choice = PackAction::Restore,
                _ => {}
            }
            let running = if change == 3 {
                vec![tf2_name()]
            } else {
                unlocked().to_vec()
            };
            assert!(
                resolve_pack_changes_to(&profiles, &root, &request, running, opts(None)).is_err()
            );
            assert_eq!(
                load_manifest(&profiles, &request.profile_id).unwrap(),
                before
            );
            assert!(!root.join("tf/custom/restore.vpk").exists());
            cleanup(&dir);
        }
    }

    #[test]
    fn reviewed_packs_recheck_after_staging_before_any_publication() {
        let (dir, profiles, root, request) = mixed_review_fixture();
        let before = load_manifest(&profiles, &request.profile_id).unwrap();
        let samples = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&samples);
        let changed = root.join("tf/custom/add.vpk");
        let result = with_absorb_process_sampler(
            move || {
                // Entry check then staging boundary. Change the source after the
                // reviewed classification; the checked transaction must refuse.
                if calls.fetch_add(1, Ordering::SeqCst) == 1 {
                    write_live(&changed, "changed during staging");
                }
                unlocked().iter().map(|name| (*name).to_string()).collect()
            },
            || resolve_pack_changes_to(&profiles, &root, &request, unlocked(), opts(None)),
        );
        assert!(result.is_err());
        assert_eq!(
            load_manifest(&profiles, &request.profile_id).unwrap(),
            before
        );
        assert!(!root.join("tf/custom/restore.vpk").exists());
        assert!(root.join("tf/custom/leave.vpk").is_file());
        cleanup(&dir);
    }
}
