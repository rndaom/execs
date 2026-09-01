//! The apply / revert path: restore what we patched, rebuild the pack, patch
//! the particles back in, and report what was skipped.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::hash::sha256_hex;
use crate::pcf::{
    check_parents, decode_pcf, encode_pcf, extract_elements, find_root_systems,
    get_parent_elements, remove_duplicate_elements, update_materials, PcfFile,
};
use crate::process_lock::refuse_if_running_among;
use crate::vpk::{
    map_vpk_entries, patch_vpk_entry, read_vpk_entry, write_vpk_v2, VpkEntryLocation,
};

use super::catalog::zip_archive;
use super::gameinfo::{gameinfo_bypass_state, set_gameinfo_bypass};
use super::pack::{
    is_excluded_addon_file, relocate_model_materials, scrub_ignorez, stock_shadowing_paths,
    synthesize_missing_vmts,
};
use super::state::{
    adopt_orphaned_snapshots, load_state, misc_vpk_path, originals_dir, restore_patched_entries,
    save_state, snapshot_path, vpk_fingerprint, PatchedEntry, SkipNotice,
};
use super::{
    catalog::read_mods_catalog, DUPLICATE_EFFECT_FILES, DX8_TWIN_STEMS, MISC_VPK, PRELOADER_VPK,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreloaderSelection {
    #[serde(default)]
    pub addons: Vec<String>,
    #[serde(default)]
    pub particle_mods: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreloaderReport {
    pub patched_files: Vec<String>,
    pub skipped: Vec<SkipNotice>,
    pub addons_installed: Vec<String>,
    pub particle_mods_installed: Vec<String>,
    pub custom_vpk_written: bool,
    pub gameinfo_bypassed: bool,
    pub baseline_reset: bool,
    /// Materials generated for textures a mod shipped without one.
    #[serde(default)]
    pub synthesized_vmts: usize,
    /// Model materials moved under the console/ root to survive Casual.
    #[serde(default)]
    pub relocated_model_materials: usize,
}

pub(crate) struct WorkItem {
    target: String,
    mod_name: String,
    bytes: Vec<u8>,
}

pub(crate) fn decode_vanilla(
    tf2_root: &Path,
    entries: &BTreeMap<String, VpkEntryLocation>,
    rel: &str,
) -> Result<PcfFile, String> {
    let entry = entries
        .get(rel)
        .ok_or_else(|| format!("{rel} is missing from {MISC_VPK}"))?;
    let bytes = read_vpk_entry(&misc_vpk_path(tf2_root), entry).map_err(|err| err.message())?;
    decode_pcf(&bytes).map_err(|err| format!("{rel}: {}", err.0))
}

/// Root systems each rebuild file may keep: roots whose only home is that
/// file. A root shared with a non-rebuild file lives on there; one shared
/// only among rebuild files stays with the alphabetically first so it can't
pub fn rebuild_keep_lists(
    roots_by_file: &BTreeMap<String, Vec<String>>,
) -> BTreeMap<String, Vec<String>> {
    let mut homes: BTreeMap<&String, Vec<&String>> = BTreeMap::new();
    for (file, roots) in roots_by_file {
        for root in roots {
            homes.entry(root).or_default().push(file);
        }
    }
    let mut keep_lists = BTreeMap::new();
    for target in DUPLICATE_EFFECT_FILES {
        let target = target.to_string();
        let Some(roots) = roots_by_file.get(&target) else {
            continue;
        };
        let kept: Vec<String> = roots
            .iter()
            .filter(|root| {
                let owners = &homes[*root];
                owners.len() == 1
                    || (owners
                        .iter()
                        .all(|owner| DUPLICATE_EFFECT_FILES.contains(&owner.as_str()))
                        && owners.iter().min() == Some(&&target))
            })
            .cloned()
            .collect();
        keep_lists.insert(target, kept);
    }
    keep_lists
}

pub fn apply_preloader_selection(
    tf2_root: &Path,
    data_dir: &Path,
    zip_path: &Path,
    selection: &PreloaderSelection,
    running_names: &[String],
) -> Result<PreloaderReport, String> {
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    let vpk_path = misc_vpk_path(tf2_root);
    if !vpk_path.is_file() {
        return Err(format!(
            "{MISC_VPK} was not found — is the TF2 folder right?"
        ));
    }

    let mut report = PreloaderReport::default();
    let mut state = load_state(data_dir);

    // A resized VPK means a game update replaced our patches wholesale; the
    // old snapshots describe files that no longer exist, so the baseline
    // resets. Mtime drift alone is NOT an update — our own patches and a
    // partially-failed restore both touch mtime while the layout (and our
    // snapshots) stay perfectly valid, and the restore path re-validates
    // every entry by size anyway.
    let fingerprint = vpk_fingerprint(&vpk_path)?;
    if !state.patched.is_empty() && state.vpk_len != 0 && state.vpk_len != fingerprint.0 {
        state.patched.clear();
        let _ = std::fs::remove_dir_all(originals_dir(data_dir));
        report.baseline_reset = true;
    }
    // Record the current length up front so state saved mid-install already
    // carries the right baseline for a crash-recovery run.
    state.vpk_len = fingerprint.0;
    state.vpk_mtime_ms = fingerprint.1;
    save_state(data_dir, &state)?;

    let entries = map_vpk_entries(&vpk_path).map_err(|err| err.message())?;

    // Validate the selection BEFORE the destructive restore pass: a stale UI
    // selection must fail without having uninstalled the user's mods first.
    let catalog = read_mods_catalog(zip_path)?;
    for name in &selection.addons {
        if !catalog.addons.iter().any(|addon| &addon.id == name) {
            return Err(format!("Unknown addon: {name}"));
        }
    }
    for name in &selection.particle_mods {
        if !catalog
            .particle_mods
            .iter()
            .any(|particle| &particle.name == name)
        {
            return Err(format!("Unknown particle mod: {name}"));
        }
    }

    // Re-check the run lock immediately before the first write into the
    // official VPK: the caller checked before an 81 MB download.
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;

    adopt_orphaned_snapshots(data_dir, &mut state);
    for failure in restore_patched_entries(tf2_root, data_dir, &mut state, &entries)? {
        report.skipped.push(SkipNotice {
            file: failure.clone(),
            mod_name: String::new(),
            reason: "could not restore the previous patch".into(),
        });
    }
    // Nothing from the old selection is installed any more. Record that now,
    // so a failure later in this run cannot leave state.json advertising mods
    // the restore pass just removed.
    state.addons.clear();
    state.particle_mods.clear();
    state.skipped.clear();
    save_state(data_dir, &state)?;

    let mut archive = zip_archive(zip_path)?;

    // Particle worklist: selection order, later mods win a contested file.
    let mut work: BTreeMap<String, WorkItem> = BTreeMap::new();
    for mod_name in &selection.particle_mods {
        let prefix = format!("mods/particles/{mod_name}/actual_particles/");
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|err| format!("Could not read the mod library: {err}"))?;
            let path = entry.name().replace('\\', "/");
            let Some(file) = path.strip_prefix(&prefix) else {
                continue;
            };
            if file.contains('/') || !file.ends_with(".pcf") || entry.is_dir() {
                continue;
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|err| format!("Could not read {path}: {err}"))?;
            let target = if file == "blood_trail.pcf" {
                // blood_trail's own slot is too small for any mod; the same
                // systems also load from npc_fx, which has room.
                "npc_fx.pcf".to_string()
            } else {
                file.to_string()
            };
            if let Some(previous) = work.get(&target) {
                report.skipped.push(SkipNotice {
                    file: target.clone(),
                    mod_name: previous.mod_name.clone(),
                    reason: format!("overridden by {mod_name}"),
                });
            }
            work.insert(
                target.clone(),
                WorkItem {
                    target,
                    mod_name: mod_name.clone(),
                    bytes,
                },
            );
        }
    }

    // Rebuild the duplicate-carrier files whenever particle mods are in play
    // and a mod didn't already replace them outright.
    if !selection.particle_mods.is_empty() {
        let mut roots_by_file: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for rel in entries.keys() {
            let Some(name) = rel.strip_prefix("particles/") else {
                continue;
            };
            if name.contains('/') || !name.ends_with(".pcf") || name.ends_with("_dx80.pcf") {
                continue;
            }
            if let Ok(vanilla) = decode_vanilla(tf2_root, &entries, rel) {
                roots_by_file.insert(name.to_string(), find_root_systems(&vanilla));
            }
        }
        let keep_lists = rebuild_keep_lists(&roots_by_file);
        for (target, keep) in keep_lists {
            if work.contains_key(&target) {
                continue;
            }
            let rel = format!("particles/{target}");
            let vanilla = decode_vanilla(tf2_root, &entries, &rel)?;
            let rebuilt = extract_elements(&vanilla, &keep).map_err(|err| err.0)?;
            let bytes = encode_pcf(&rebuilt).map_err(|err| err.0)?;
            work.insert(
                target.clone(),
                WorkItem {
                    target,
                    mod_name: "stock rebuild".into(),
                    bytes,
                },
            );
        }
    }

    // Disguise ground truth for the parent-collision rule.
    let disguise_parents = if work.is_empty() {
        BTreeSet::new()
    } else {
        get_parent_elements(&decode_vanilla(
            tf2_root,
            &entries,
            "particles/disguise.pcf",
        )?)
    };

    for item in work.values() {
        let rel = format!("particles/{}", item.target);
        let skip = |reason: String, report: &mut PreloaderReport| {
            report.skipped.push(SkipNotice {
                file: item.target.clone(),
                mod_name: item.mod_name.clone(),
                reason,
            });
        };

        let decoded = match decode_pcf(&item.bytes) {
            Ok(decoded) => decoded,
            Err(err) => {
                skip(format!("could not parse: {}", err.0), &mut report);
                continue;
            }
        };
        let mut processed = if item.target == "disguise.pcf" {
            update_materials(
                &decode_vanilla(tf2_root, &entries, "particles/disguise.pcf")?,
                &decoded,
            )
        } else if check_parents(&decoded, &disguise_parents) {
            skip(
                "redefines spy disguise systems, which must stay stock".into(),
                &mut report,
            );
            continue;
        } else {
            decoded
        };
        remove_duplicate_elements(&mut processed);
        let encoded = match encode_pcf(&processed) {
            Ok(encoded) => encoded,
            Err(err) => {
                skip(format!("could not re-encode: {}", err.0), &mut report);
                continue;
            }
        };

        let mut targets = vec![rel.clone()];
        let stem = item.target.trim_end_matches(".pcf");
        if DX8_TWIN_STEMS.contains(&stem) {
            let twin = format!("particles/{stem}_dx80.pcf");
            if entries.contains_key(&twin) {
                targets.push(twin);
            }
        }

        for target_rel in targets {
            let Some(entry) = entries.get(&target_rel) else {
                skip(
                    format!("{target_rel} is not part of the stock game"),
                    &mut report,
                );
                continue;
            };
            if entry.preload_len != 0 {
                skip(
                    format!("{target_rel} uses an unsupported layout"),
                    &mut report,
                );
                continue;
            }
            if encoded.len() > entry.length as usize {
                skip(
                    format!(
                        "{} is {} bytes over the stock budget even after shrinking",
                        target_rel,
                        encoded.len() - entry.length as usize
                    ),
                    &mut report,
                );
                continue;
            }
            let mut padded = encoded.clone();
            padded.resize(entry.length as usize, b' ');

            if !state.patched.contains_key(&target_rel) {
                std::fs::create_dir_all(originals_dir(data_dir))
                    .map_err(|err| format!("Could not prepare snapshots: {err}"))?;
                let snapshot = snapshot_path(data_dir, &target_rel);
                // A snapshot left behind by an interrupted run holds the
                // pristine bytes while the entry itself may already carry a
                // patch — an existing snapshot of the right size is the
                // truth and must never be overwritten.
                let original = match std::fs::read(&snapshot) {
                    Ok(existing) if existing.len() == entry.length as usize => existing,
                    _ => {
                        let current =
                            read_vpk_entry(&vpk_path, entry).map_err(|err| err.message())?;
                        std::fs::write(&snapshot, &current)
                            .map_err(|err| format!("Could not snapshot {target_rel}: {err}"))?;
                        current
                    }
                };
                state.patched.insert(
                    target_rel.clone(),
                    PatchedEntry {
                        owner: item.mod_name.clone(),
                        original_sha256: sha256_hex(&original),
                    },
                );
            } else if let Some(patched) = state.patched.get_mut(&target_rel) {
                patched.owner = item.mod_name.clone();
            }
            // Track before writing: a crash mid-patch must leave the entry
            // marked patched so the next run restores it from the snapshot.
            save_state(data_dir, &state)?;
            patch_vpk_entry(&vpk_path, entry, &padded).map_err(|err| err.message())?;
            report.patched_files.push(target_rel);
        }
    }

    // Custom content: particle-mod support files plus the selected addons.
    // Inner paths keep their game-relative shape (materials/…, scripts/…).
    let mut custom: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let copy_zip_tree = |archive: &mut zip::ZipArchive<std::fs::File>,
                         prefix: &str,
                         custom: &mut BTreeMap<String, Vec<u8>>,
                         allow: &dyn Fn(&str) -> bool|
     -> Result<(), String> {
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|err| format!("Could not read the mod library: {err}"))?;
            if entry.is_dir() {
                continue;
            }
            let path = entry.name().replace('\\', "/");
            let Some(inner) = path.strip_prefix(prefix) else {
                continue;
            };
            if inner.is_empty() || inner.contains("..") || !allow(inner) {
                continue;
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|err| format!("Could not read {path}: {err}"))?;
            scrub_ignorez(inner, &mut bytes);
            custom.insert(inner.to_string(), bytes);
        }
        Ok(())
    };

    for mod_name in &selection.particle_mods {
        copy_zip_tree(
            &mut archive,
            &format!("mods/particles/{mod_name}/"),
            &mut custom,
            &|inner| inner.starts_with("materials/") || inner.starts_with("scripts/"),
        )?;
    }
    let mut addon_owner: BTreeMap<String, String> = BTreeMap::new();
    for mod_name in &selection.addons {
        let before: BTreeSet<String> = custom.keys().cloned().collect();
        copy_zip_tree(
            &mut archive,
            &format!("mods/addons/{mod_name}/"),
            &mut custom,
            &|inner| !is_excluded_addon_file(inner),
        )?;
        for rel in custom.keys() {
            if !before.contains(rel) {
                addon_owner.insert(rel.clone(), mod_name.clone());
            }
        }
    }

    // Files that duplicate an asset handled by another route (particles are
    // patched in place; sound has no relocation path) would be dead weight or
    // actively conflict, so drop those and say so. Materials and models stay:
    // the preloader exists to carry exactly those into Casual.
    let mut dropped: BTreeMap<String, usize> = BTreeMap::new();
    let shadowing = stock_shadowing_paths(tf2_root, &custom);
    for rel in shadowing {
        custom.remove(&rel);
        let owner = addon_owner.get(&rel).cloned().unwrap_or_default();
        *dropped.entry(owner).or_default() += 1;
    }
    for (mod_name, count) in dropped {
        report.skipped.push(SkipNotice {
            file: format!("{count} file{}", if count == 1 { "" } else { "s" }),
            mod_name,
            reason: "duplicates a stock asset execs handles outside tf/custom".into(),
        });
    }

    // Model materials cannot serve from their stock paths, so move them under
    // the console/ root and repoint the models that reference them.
    let relocated = relocate_model_materials(&mut custom);
    if relocated > 0 {
        report.relocated_model_materials = relocated;
    }

    // A texture with no material beside it is a checkerboard in game, so give
    // every orphan one before the pack is sealed.
    let synthesized = synthesize_missing_vmts(tf2_root, &mut custom);
    if synthesized > 0 {
        report.synthesized_vmts = synthesized;
    }

    let custom_vpk = tf2_root.join("tf").join("custom").join(PRELOADER_VPK);
    if custom.is_empty() {
        let _ = std::fs::remove_file(&custom_vpk);
    } else {
        std::fs::create_dir_all(custom_vpk.parent().expect("custom dir"))
            .map_err(|err| format!("Could not prepare tf/custom: {err}"))?;
        std::fs::write(&custom_vpk, write_vpk_v2(&custom))
            .map_err(|err| format!("Could not write {PRELOADER_VPK}: {err}"))?;
        report.custom_vpk_written = true;
    }

    set_gameinfo_bypass(tf2_root, data_dir, true, running_names)?;
    // Report what actually happened: a gameinfo.txt without the expected
    // line means the bypass is not in effect.
    report.gameinfo_bypassed = gameinfo_bypass_state(tf2_root)?.enabled;

    let fingerprint = vpk_fingerprint(&vpk_path)?;
    state.schema = 1;
    state.vpk_len = fingerprint.0;
    state.vpk_mtime_ms = fingerprint.1;
    state.addons = selection.addons.clone();
    state.particle_mods = selection.particle_mods.clone();
    state.skipped = report.skipped.clone();
    save_state(data_dir, &state)?;

    report.addons_installed = selection.addons.clone();
    report.particle_mods_installed = selection.particle_mods.clone();
    Ok(report)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RevertReport {
    pub restored_files: Vec<String>,
    pub failures: Vec<String>,
    pub gameinfo_restored: bool,
    pub custom_vpk_removed: bool,
}

/// Put every stock byte back: restore patched entries from snapshots,
/// uncomment gameinfo.txt, and remove the custom VPK.
pub fn revert_preloader(
    tf2_root: &Path,
    data_dir: &Path,
    running_names: &[String],
) -> Result<RevertReport, String> {
    refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
    let mut report = RevertReport::default();
    let mut state = load_state(data_dir);
    let vpk_path = misc_vpk_path(tf2_root);

    adopt_orphaned_snapshots(data_dir, &mut state);
    if !state.patched.is_empty() {
        let fingerprint = vpk_fingerprint(&vpk_path)?;
        // Only a resized VPK proves a game update (mtime drifts from our own
        // writes and from partially-failed restores; those snapshots are
        // still exactly right).
        if state.vpk_len != 0 && state.vpk_len != fingerprint.0 {
            state.patched.clear();
            let _ = std::fs::remove_dir_all(originals_dir(data_dir));
            report.failures.push(
                "The game updated since the last install; stock files are already fresh.".into(),
            );
        } else {
            // Re-check right before the first write into the official VPK.
            refuse_if_running_among(running_names).map_err(|err| err.message().to_string())?;
            let entries = map_vpk_entries(&vpk_path).map_err(|err| err.message())?;
            let tracked: Vec<String> = state.patched.keys().cloned().collect();
            let failures = restore_patched_entries(tf2_root, data_dir, &mut state, &entries)?;
            for rel in tracked {
                if !failures.iter().any(|failure| failure.starts_with(&rel)) {
                    report.restored_files.push(rel);
                }
            }
            report.failures.extend(failures);
        }
    }

    report.gameinfo_restored = set_gameinfo_bypass(tf2_root, data_dir, false, running_names)?;

    let custom_vpk = tf2_root.join("tf").join("custom").join(PRELOADER_VPK);
    if custom_vpk.exists() {
        std::fs::remove_file(&custom_vpk)
            .map_err(|err| format!("Could not remove {PRELOADER_VPK}: {err}"))?;
        report.custom_vpk_removed = true;
    }

    // Snapshots for entries that failed to restore stay on disk so the next
    // attempt can finish; only a fully-clean revert clears everything.
    if state.patched.is_empty() {
        let _ = std::fs::remove_dir_all(originals_dir(data_dir));
        state.vpk_len = 0;
        state.vpk_mtime_ms = 0;
    } else {
        let fingerprint = vpk_fingerprint(&vpk_path)?;
        state.vpk_len = fingerprint.0;
        state.vpk_mtime_ms = fingerprint.1;
    }
    state.addons.clear();
    state.particle_mods.clear();
    state.skipped.clear();
    save_state(data_dir, &state)?;
    Ok(report)
}

/// Remember which profile the shared preload cfg was enabled on, so a later
/// revert can clean it off that profile even if another one is active then.
pub fn record_preload_profile(data_dir: &Path, profile_id: &str) -> Result<(), String> {
    let mut state = load_state(data_dir);
    if !state.preload_profiles.iter().any(|id| id == profile_id) {
        state.preload_profiles.push(profile_id.to_string());
        save_state(data_dir, &state)?;
    }
    Ok(())
}

/// The recorded preload profiles, cleared from state.
pub fn take_preload_profiles(data_dir: &Path) -> Vec<String> {
    let mut state = load_state(data_dir);
    let taken = std::mem::take(&mut state.preload_profiles);
    if !taken.is_empty() {
        let _ = save_state(data_dir, &state);
    }
    taken
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreloaderStatus {
    pub gameinfo_found: bool,
    pub gameinfo_bypassed: bool,
    pub patched_files: Vec<String>,
    pub addons: Vec<String>,
    pub particle_mods: Vec<String>,
    pub skipped: Vec<SkipNotice>,
    pub stale: bool,
    pub custom_vpk_present: bool,
}

pub fn preloader_status(tf2_root: &Path, data_dir: &Path) -> Result<PreloaderStatus, String> {
    let state = load_state(data_dir);
    let gameinfo = gameinfo_bypass_state(tf2_root)?;
    let vpk_path = misc_vpk_path(tf2_root);
    // Only a resized VPK signals a game update; mtime drifts from our own
    // patch writes.
    let stale = !state.patched.is_empty()
        && vpk_fingerprint(&vpk_path)
            .map(|fingerprint| state.vpk_len != 0 && state.vpk_len != fingerprint.0)
            .unwrap_or(true);
    Ok(PreloaderStatus {
        gameinfo_found: gameinfo.found,
        gameinfo_bypassed: gameinfo.enabled,
        patched_files: state.patched.keys().cloned().collect(),
        addons: state.addons,
        particle_mods: state.particle_mods,
        skipped: state.skipped,
        stale,
        custom_vpk_present: tf2_root
            .join("tf")
            .join("custom")
            .join(PRELOADER_VPK)
            .is_file(),
    })
}
