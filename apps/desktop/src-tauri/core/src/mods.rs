//! Mods the user brings in themselves: skins, effects, sound packs — anything
//! that lives as one top-level `tf/custom` pack.
//!
//! A mod's files are ordinary profile files, so switching, export/import and
//! absorb already carry them with no special case. What this module adds is the
//! way in (an archive, a folder, a bare VPK), the record that names the pack,
//! the way back out, and the list of particle files a mod offers the preloader.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::absorb::pack_key;
use crate::apply::{detail_from_manifest, ProfileDetail};
use crate::archive::{
    extract_archive, read_dir_entries, read_regular_file_bounded, read_regular_file_bounded_within,
    validate_imported_cfg, ArchiveLimits,
};
use crate::content_index::normalize_virtual_path;
use crate::pcf::MAX_PCF_BYTES;
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, is_profile_ownable_rel_path, load_library_from, load_manifest,
    mutate_profile_files_to, portable_path_key, profiles_dir, utc_rfc3339, FileSource,
    ProfileError, ProfileLiveProjection, ProfileManifest,
};
use crate::switch::{live_path, prune_empty_parents};
use crate::vpk::{
    map_vpk_entries, read_vpk_dir_bytes_filtered, read_vpk_dir_file_filtered_bounded,
    validate_vpk_dir_bytes, validate_vpk_dir_bytes_with_paths, VpkError,
};

/// One pack's ceiling, and the ceiling on a whole archive: a mod is held in
/// memory while it is read and copied, and nothing legitimate on GameBanana
/// comes close.
pub const MAX_MOD_BYTES: u64 = 512 * 1024 * 1024;

/// What to tell a player whose mod is over [`MAX_MOD_BYTES`]: its size, the
/// limit, and the manual route that still works.
pub fn oversized_mod_message(size: Option<u64>) -> String {
    let limit = MAX_MOD_BYTES / (1024 * 1024);
    let what = match size {
        Some(size) => format!("This file is {}", crate::disk_space::readable_size(size)),
        None => "This file is larger than that".to_string(),
    };
    format!(
        "{what}; execs installs mods up to {limit} MB. To use it anyway, close TF2, extract the mod into tf/custom yourself, then choose Update profile when execs asks."
    )
}

const MAX_MOD_ENTRIES: usize = 20_000;

const MOD_LIMITS: ArchiveLimits = ArchiveLimits::new(MAX_MOD_ENTRIES, MAX_MOD_BYTES, MAX_MOD_BYTES);

/// Longest `tf/custom` folder name this app will mint for a mod.
const MAX_MOD_ID: usize = 48;

/// Top-level folders that make a directory a TF2 content root. `cfg` and
/// `resource` are here too: a pack that is really a HUD or a config still
/// installs, it is just named after the archive rather than after its content.
/// `media` holds TF2's startup videos, which intro-replacement mods ship.
pub const MOD_CONTENT_ROOTS: [&str; 9] = [
    "materials",
    "models",
    "sound",
    "particles",
    "scripts",
    "resource",
    "cfg",
    "maps",
    "media",
];

/// Names this app owns for itself, plus mastercomfig's. A mod may never take
/// one, so a candidate id that starts with one gets a `mod-` prefix instead of
/// a numeric suffix — bumping `execs-preloader` to `execs-preloader-2` would
/// still be squatting in our namespace.
const RESERVED_PACK_PREFIXES: [&str; 2] = ["execs-", "mastercomfig"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ModSource {
    /// A file or folder the user picked on their own disk.
    Local,
    /// A pack found in tf/custom and accepted through profile absorb.
    External,
    /// Installed from GameBanana; `url` is the mod's profile page, so the UI
    /// can always send the user back to the author.
    Gamebanana { id: u64, url: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRecord {
    /// Stable id, unique within the profile. Imports also use it as the pack name.
    pub id: String,
    /// What the user called it — the archive, folder or GameBanana title.
    pub name: String,
    pub source: ModSource,
    /// The top-level `tf/custom` entry: `"<id>"` for a folder pack,
    /// `"<id>.vpk"` for a packed one.
    pub pack: String,
    pub files: usize,
    pub bytes: u64,
    pub installed_at: String,
    /// Original mounted pack name while bytes live below an inactive container.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inactive_pack: Option<String>,
}

/// A mod's payload, already separated from whatever container it arrived in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModContent {
    /// A single VPK, installed as `tf/custom/<id>.vpk`.
    Vpk(Vec<u8>),
    /// Loose files relative to the pack root, forward-slashed.
    Tree(Vec<(String, Vec<u8>)>),
}

/// Incremental aggregate guard for a multi-select before the caller retains
/// another prepared pack in memory. Commands should call `add` immediately
/// after parsing each individually bounded selection and before pushing it
/// into their batch.
#[derive(Debug, Default, Clone, Copy)]
pub struct ModBatchBudget {
    files: usize,
    bytes: u64,
}

impl ModBatchBudget {
    pub fn add(&mut self, content: &ModContent) -> Result<(), ProfileError> {
        let files = content.file_count();
        if files == 0 {
            return Err(ProfileError::Io("That mod has no files.".into()));
        }
        self.files = self
            .files
            .checked_add(files)
            .ok_or_else(|| ProfileError::Io("Too many mod files were selected.".into()))?;
        if self.files > MAX_MOD_ENTRIES {
            return Err(ProfileError::Io(format!(
                "The selected mods contain more than {MAX_MOD_ENTRIES} files; refusing to install them."
            )));
        }
        let bytes = content.byte_len()?;
        self.bytes = self.bytes.checked_add(bytes).ok_or_else(|| {
            ProfileError::Io("The selected mods are too large to install.".into())
        })?;
        if self.bytes > MAX_MOD_BYTES {
            return Err(ProfileError::Io(format!(
                "The selected mods are larger than {} MiB in total; refusing to install them.",
                MAX_MOD_BYTES / (1024 * 1024)
            )));
        }
        Ok(())
    }
}

impl ModContent {
    fn file_count(&self) -> usize {
        match self {
            Self::Vpk(_) => 1,
            Self::Tree(entries) => entries.len(),
        }
    }

    fn byte_len(&self) -> Result<u64, ProfileError> {
        match self {
            Self::Vpk(bytes) => Ok(bytes.len() as u64),
            Self::Tree(entries) => entries.iter().try_fold(0u64, |total, (_, bytes)| {
                total.checked_add(bytes.len() as u64).ok_or_else(|| {
                    ProfileError::Io("The selected mods are too large to install.".into())
                })
            }),
        }
    }
}

/// The particle files one installed mod offers the preloader.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticleSource {
    pub mod_id: String,
    pub name: String,
    /// Bare `*.pcf` file names at the pack's `particles/` root.
    pub pcf_files: Vec<String>,
    /// A read-only plan refused this source on the current TF2 install.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

// ---------------------------------------------------------------------------
// Reading a mod out of what the user handed over
// ---------------------------------------------------------------------------

/// The unambiguous pack an archive holds. A single VPK is one pack; several
/// VPKs may be mutually exclusive variants, so the user must extract and pick
/// the intended files instead of letting filesystem order choose a winner.
/// Anything else is one loose-file pack rooted at its shallowest content
/// folder.
pub fn mod_content_from_archive(
    name: &str,
    bytes: &[u8],
) -> Result<Vec<(String, ModContent)>, ProfileError> {
    let entries = extract_archive(bytes, MOD_LIMITS)?;
    if entries.is_empty() {
        return Err(ProfileError::Io("That archive is empty.".into()));
    }

    let vpk_names: Vec<&str> = entries
        .iter()
        .filter(|(rel, _)| has_extension(rel, "vpk"))
        .map(|(rel, _)| rel.as_str())
        .collect();
    if !vpk_names.is_empty() {
        refuse_multi_part(vpk_names.iter().copied())?;
        if vpk_names.len() > 1 {
            return Err(ProfileError::Io(MULTIPLE_VPK_CHOICES.into()));
        }
        if entries
            .iter()
            .filter(|(rel, _)| !has_extension(rel, "vpk"))
            .any(|(rel, _)| path_has_content_root(rel))
        {
            return Err(ProfileError::Io(MIXED_VPK_AND_LOOSE_CONTENT.into()));
        }
        let (rel, bytes) = entries
            .into_iter()
            .find(|(rel, _)| has_extension(rel, "vpk"))
            .expect("the validated VPK entry is present");
        return Ok(vec![(vpk_pack_name(&rel), ModContent::Vpk(bytes))]);
    }

    let Some(root) = content_root(&entries, usize::MAX)? else {
        return Err(ProfileError::Io(NO_TF2_CONTENT.into()));
    };
    Ok(vec![(
        display_name(name),
        ModContent::Tree(under_root(entries, &root)),
    )])
}

/// A mod the user points at as a folder. The pack is named after the folder;
/// one wrapper level is stripped, the same as an archive's.
pub fn mod_content_from_dir(dir: &Path) -> Result<(String, ModContent), ProfileError> {
    let entries = read_dir_entries(dir, MOD_LIMITS)?;
    if entries.is_empty() {
        return Err(ProfileError::Io("That folder is empty.".into()));
    }
    let name = dir
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let Some(root) = content_root(&entries, 1)? else {
        return Err(ProfileError::Io(NO_TF2_CONTENT.into()));
    };
    Ok((
        display_name(&name),
        ModContent::Tree(under_root(entries, &root)),
    ))
}

/// A `.vpk` the user points at directly. A multi-part set is refused: only the
/// `_dir.vpk` was picked, and installing it without its `_000.vpk` siblings
/// gives the game a directory pointing at data that is not there.
pub fn mod_content_from_vpk_file(path: &Path) -> Result<(String, ModContent), ProfileError> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let lower = name.to_ascii_lowercase();
    let parent = path.parent().unwrap_or(Path::new("."));
    if let Some(prefix) = lower.strip_suffix("_dir.vpk") {
        if parent.join(format!("{prefix}_000.vpk")).is_file() {
            return Err(ProfileError::Io(MULTI_PART_VPK.into()));
        }
    }
    // The other half of a split set: `skin_001.vpk` picked beside its
    // `skin_dir.vpk`. On its own, that name is an ordinary pack.
    if let Some(prefix) = split_part_prefix(&lower) {
        if parent.join(format!("{prefix}_dir.vpk")).is_file() {
            return Err(ProfileError::Io(MULTI_PART_VPK.into()));
        }
    }
    let Some(bytes) = read_regular_file_bounded(path, MAX_MOD_BYTES)? else {
        let size = std::fs::metadata(path).ok().map(|meta| meta.len());
        return Err(ProfileError::Io(oversized_mod_message(size)));
    };
    // Bounds-check the tree without materializing a body: a crafted directory
    // can make a full read allocate many times the file.
    validate_vpk_dir_bytes(&bytes).map_err(|err| ProfileError::Io(err.message()))?;
    Ok((vpk_pack_name(&name), ModContent::Vpk(bytes)))
}

const NO_TF2_CONTENT: &str =
    "That archive has no TF2 content (no materials, models, sound, particles or scripts folder).";

const MULTI_PART_VPK: &str =
    "That is a multi-part VPK (a _dir.vpk with _000.vpk siblings), which this app cannot install as one pack. Unpack it first, or install the folder version.";

const MULTIPLE_VPK_CHOICES: &str =
    "That archive contains several VPKs that may be install choices. Open the author's page, extract the archive, then add only the VPKs you want.";

const MIXED_VPK_AND_LOOSE_CONTENT: &str =
    "That archive contains both a VPK and loose TF2 files. They may be alternatives or required together; follow the author's instructions, then add the intended VPK or extracted folder.";

fn path_has_content_root(rel: &str) -> bool {
    rel.rsplit_once('/').is_some_and(|(parent, _)| {
        parent
            .split('/')
            .any(|part| MOD_CONTENT_ROOTS.contains(&part.to_ascii_lowercase().as_str()))
    })
}

/// The shallowest folder that directly holds a content root, as a prefix
/// (`""` when the archive is already rooted there). `max_depth` bounds how many
/// wrapper folders may sit above it.
fn content_root(
    entries: &[(String, Vec<u8>)],
    max_depth: usize,
) -> Result<Option<String>, ProfileError> {
    let mut best_depth = None;
    let mut candidates = BTreeSet::new();
    let mut selected = None;
    for (rel, _) in entries {
        let parts: Vec<&str> = rel.split('/').collect();
        // The last segment is the file name, so a content root can only be one
        // of the segments before it.
        for depth in 0..parts.len().saturating_sub(1) {
            if depth > max_depth {
                break;
            }
            let segment = parts[depth].to_ascii_lowercase();
            if !MOD_CONTENT_ROOTS.contains(&segment.as_str()) {
                continue;
            }
            let candidate = parts[..depth].join("/");
            match best_depth {
                Some(current) if current < depth => {}
                Some(current) if current == depth => {
                    let key = candidate.to_ascii_lowercase();
                    if !candidates.insert(key)
                        && selected
                            .as_deref()
                            .is_some_and(|selected| selected != candidate)
                    {
                        return Err(ProfileError::Io(
                            "That archive contains wrapper folders whose names collide on Windows."
                                .into(),
                        ));
                    }
                }
                _ => {
                    best_depth = Some(depth);
                    candidates.clear();
                    candidates.insert(candidate.to_ascii_lowercase());
                    selected = Some(candidate);
                }
            }
            break;
        }
    }
    // A deeper alternative is still a choice. Selecting only the shallowest
    // candidate could silently discard, for example, alternate/red/materials
    // beside default/materials.
    let outside_selected = selected.as_ref().is_some_and(|selected| {
        entries.iter().any(|(rel, _)| {
            let parts: Vec<&str> = rel.split('/').collect();
            (0..parts.len().saturating_sub(1))
                .take_while(|depth| *depth <= max_depth)
                .find(|depth| {
                    MOD_CONTENT_ROOTS.contains(&parts[*depth].to_ascii_lowercase().as_str())
                })
                .is_some_and(|depth| parts[..depth].join("/") != *selected)
        })
    });
    if candidates.len() > 1 || outside_selected {
        return Err(ProfileError::Io(
            "That archive contains multiple peer TF2 content roots; split it into one mod per folder before importing it."
                .into(),
        ));
    }
    Ok(selected)
}

fn under_root(entries: Vec<(String, Vec<u8>)>, root: &str) -> Vec<(String, Vec<u8>)> {
    if root.is_empty() {
        return entries;
    }
    let prefix = format!("{root}/");
    entries
        .into_iter()
        .filter_map(|(rel, bytes)| {
            rel.strip_prefix(&prefix)
                .map(|rest| (rest.to_string(), bytes))
        })
        .collect()
}

/// A split set is only a split set when both halves are there: `big_000.vpk`
/// beside `big_dir.vpk`. A lone `skin_001.vpk` is just a pack whose author
/// numbered it, and installs like any other.
fn refuse_multi_part<'a>(names: impl Iterator<Item = &'a str>) -> Result<(), ProfileError> {
    let names: BTreeSet<String> = names
        .map(|name| name.replace('\\', "/").to_ascii_lowercase())
        .collect();
    for name in &names {
        let (dir, file) = name.rsplit_once('/').unwrap_or(("", name));
        let Some(prefix) = split_part_prefix(file) else {
            continue;
        };
        let dir_file = if dir.is_empty() {
            format!("{prefix}_dir.vpk")
        } else {
            format!("{dir}/{prefix}_dir.vpk")
        };
        if names.contains(&dir_file) {
            return Err(ProfileError::Io(MULTI_PART_VPK.into()));
        }
    }
    Ok(())
}

/// `big` for a lowercased `big_000.vpk`; `None` for any other file name.
fn split_part_prefix(file: &str) -> Option<&str> {
    let stem = file.strip_suffix(".vpk")?;
    let (prefix, tail) = stem.rsplit_once('_')?;
    (!prefix.is_empty() && tail.len() == 3 && tail.bytes().all(|byte| byte.is_ascii_digit()))
        .then_some(prefix)
}

fn has_extension(rel: &str, ext: &str) -> bool {
    rel.rsplit('.')
        .next()
        .is_some_and(|found| found.eq_ignore_ascii_case(ext))
        && rel.contains('.')
}

/// A VPK's pack name is its stem, with the `_dir` half of a directory file's
/// name dropped so `mymod_dir.vpk` installs as `mymod.vpk`.
fn vpk_pack_name(rel: &str) -> String {
    let file = rel.rsplit('/').next().unwrap_or(rel);
    let stem = file
        .get(..file.len().saturating_sub(4))
        .filter(|_| has_extension(file, "vpk"))
        .unwrap_or(file);
    match stem.to_ascii_lowercase().strip_suffix("_dir") {
        Some(trimmed) => stem[..trimmed.len()].to_string(),
        None => stem.to_string(),
    }
}

/// What the UI shows: the name the user already knows, minus the container
/// extension.
fn display_name(name: &str) -> String {
    let trimmed = name.trim();
    let lower = trimmed.to_ascii_lowercase();
    for ext in [".zip", ".7z", ".vpk", ".rar"] {
        let Some(stem) = lower.strip_suffix(ext) else {
            continue;
        };
        // `mymod_dir.vpk` is one half of a VPK's on-disk name, not part of
        // what the mod is called.
        let stem = if ext == ".vpk" {
            stem.strip_suffix("_dir").unwrap_or(stem)
        } else {
            stem
        };
        return trimmed[..stem.len()].trim().to_string();
    }
    trimmed.to_string()
}

/// A `tf/custom` folder name from a display name: lowercased, anything that is
/// not `a-z0-9_` folded to a dash, never empty, never longer than [`MAX_MOD_ID`].
pub fn mod_id_from_name(name: &str) -> String {
    let mut id = String::new();
    let mut last_dash = true;
    for ch in display_name(name).chars() {
        let ch = ch.to_ascii_lowercase();
        if ch.is_ascii_alphanumeric() || ch == '_' {
            id.push(ch);
            last_dash = false;
        } else if !last_dash {
            id.push('-');
            last_dash = true;
        }
    }
    let id = clamp_id(id.trim_matches('-'), MAX_MOD_ID);
    if id.is_empty() {
        "mod".to_string()
    } else {
        id
    }
}

fn clamp_id(id: &str, max: usize) -> String {
    let mut clamped: String = id.chars().take(max).collect();
    while clamped.ends_with('-') {
        clamped.pop();
    }
    clamped
}

/// The pack identity two names share when the game would treat them as the
/// same pack: case-folded, disable prefix off, `.vpk` off.
fn pack_identity(name: &str) -> String {
    let lower = name.trim().to_ascii_lowercase();
    let undashed = lower.strip_prefix('-').unwrap_or(&lower);
    undashed
        .strip_suffix(".vpk")
        .unwrap_or(undashed)
        .to_string()
}

/// Every pack name a new mod must not collide with: what the profile already
/// carries (the HUD folder, the viewmodel/crosshair/hitsound packs, the
/// mastercomfig VPKs, other mods) and what is sitting in the live folder.
fn taken_pack_identities(tf2_root: &Path, manifest: &ProfileManifest) -> BTreeSet<String> {
    let mut taken: BTreeSet<String> = manifest
        .files
        .iter()
        .filter_map(|file| pack_key(&file.path))
        .map(|pack| pack_identity(&pack))
        .collect();
    if let Some(hud) = &manifest.hud {
        taken.insert(pack_identity(&hud.id));
    }
    for record in &manifest.mods {
        taken.insert(pack_identity(&record.pack));
        taken.insert(pack_identity(&record.id));
    }
    if let Ok(entries) = fs::read_dir(tf2_root.join("tf").join("custom")) {
        for entry in entries.flatten() {
            taken.insert(pack_identity(&entry.file_name().to_string_lossy()));
        }
    }
    taken
}

fn unique_mod_id(base: &str, taken: &BTreeSet<String>) -> String {
    let base = if RESERVED_PACK_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
        || base == "execs"
    {
        clamp_id(&format!("mod-{base}"), MAX_MOD_ID)
    } else {
        base.to_string()
    };
    if !taken.contains(&pack_identity(&base)) {
        return base;
    }
    for suffix in 2..1000u32 {
        let tail = format!("-{suffix}");
        let candidate = format!("{}{tail}", clamp_id(&base, MAX_MOD_ID - tail.len()));
        if !taken.contains(&pack_identity(&candidate)) {
            return candidate;
        }
    }
    // 998 packs of the same name is not a real profile; fall back to something
    // that cannot collide rather than overwriting one of them.
    format!("{}-{}", clamp_id(&base, 30), uuid_tail())
}

fn uuid_tail() -> String {
    uuid::Uuid::new_v4().to_string()[..8].to_string()
}

// ---------------------------------------------------------------------------
// Install / remove
// ---------------------------------------------------------------------------

pub fn install_mod(
    tf2_root: &Path,
    profile_id: &str,
    name: &str,
    content: ModContent,
    source: ModSource,
) -> Result<ProfileDetail, ProfileError> {
    install_mods(
        tf2_root,
        profile_id,
        vec![(name.to_string(), content)],
        source,
    )
}

/// Install every pack selected in one operation. All VPKs, paths and aggregate
/// budgets are validated before the first profile or live file is written, so
/// a bad later pack cannot leave earlier selections half-installed.
pub fn install_mods(
    tf2_root: &Path,
    profile_id: &str,
    packs: Vec<(String, ModContent)>,
    source: ModSource,
) -> Result<ProfileDetail, ProfileError> {
    install_mods_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        packs,
        source,
        live_process_names(),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn install_mod_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    name: &str,
    content: ModContent,
    source: ModSource,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    install_mods_to(
        profiles_dir,
        tf2_root,
        profile_id,
        vec![(name.to_string(), content)],
        source,
        running_names,
    )
}

#[derive(Debug)]
struct PlannedMod {
    record: ModRecord,
    files: Vec<(String, Vec<u8>)>,
}

fn active_crosshair_script_targets(manifest: &ProfileManifest) -> BTreeSet<String> {
    if manifest
        .crosshair
        .as_ref()
        .is_none_or(|record| record.inactive)
    {
        return BTreeSet::new();
    }
    manifest
        .files
        .iter()
        .filter_map(|file| {
            let key = normalize_virtual_path(&file.path);
            let member = key.strip_prefix("tf/custom/execs-crosshairs/")?;
            (member.starts_with("scripts/tf_weapon_") && member.ends_with(".txt"))
                .then(|| member.to_string())
        })
        .collect()
}

fn refuse_crosshair_script_collision(
    content: &ModContent,
    targets: &BTreeSet<String>,
) -> Result<(), ProfileError> {
    let conflict = |member: &str| {
        let key = normalize_virtual_path(member);
        targets.contains(&key).then_some(key)
    };
    match content {
        ModContent::Vpk(bytes) => {
            validate_vpk_dir_bytes_with_paths(bytes, &mut |member| {
                if let Some(path) = conflict(member) {
                    return Err(VpkError(format!(
                        "This mod supplies {path}, which is also in the active execs-crosshairs pack. Remove or deactivate that pack before importing this mod."
                    )));
                }
                Ok(())
            })
            .map_err(|err| ProfileError::Io(err.message()))?;
        }
        ModContent::Tree(entries) => {
            if let Some(path) = entries.iter().find_map(|(member, _)| conflict(member)) {
                return Err(ProfileError::Io(format!(
                    "This mod supplies {path}, which is also in the active execs-crosshairs pack. Remove or deactivate that pack before importing this mod."
                )));
            }
        }
    }
    Ok(())
}

/// Testable/custom-library form of [`install_mods`]. The aggregate ceiling is
/// deliberately the same as one archive: the command holds all selected packs
/// in memory at once, so applying the limit independently to each file picker
/// would make a multi-select an easy memory-exhaustion path.
#[allow(clippy::too_many_arguments)]
pub fn install_mods_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    packs: Vec<(String, ModContent)>,
    source: ModSource,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    if packs.is_empty() {
        return Err(ProfileError::Io("No mods were selected.".into()));
    }
    if packs.len() > MAX_MOD_ENTRIES {
        return Err(ProfileError::Io(
            "Too many mod packs were selected at once.".into(),
        ));
    }

    let manifest = load_manifest(profiles_dir, profile_id)?;
    let crosshair_scripts = active_crosshair_script_targets(&manifest);
    let mut taken = taken_pack_identities(tf2_root, &manifest);
    let mut planned = Vec::with_capacity(packs.len());
    let mut selection_budget = ModBatchBudget::default();
    let mut aggregate_paths = BTreeSet::new();

    for (name, content) in packs {
        selection_budget.add(&content)?;
        refuse_hud_mod(&content)?;
        refuse_crosshair_script_collision(&content, &crosshair_scripts)?;

        let display = display_name(&name);
        let mut base = mod_id_from_name(&display);
        if matches!(&content, ModContent::Tree(_))
            && crate::custom_folders::is_reserved_source_folder(&base)
        {
            base = format!("mod-{base}");
        }
        let id = unique_mod_id(&base, &taken);
        taken.insert(pack_identity(&id));

        let (pack, files) = match content {
            ModContent::Vpk(bytes) => {
                let cfgs = read_vpk_dir_bytes_filtered(&bytes, &|path| has_extension(path, "cfg"))
                    .map_err(|err| ProfileError::Io(err.message()))?;
                for (path, cfg) in cfgs.files {
                    validate_imported_cfg(&format!("tf/custom/{id}.vpk/{path}"), &cfg)?;
                }
                (
                    format!("{id}.vpk"),
                    vec![(format!("tf/custom/{id}.vpk"), bytes)],
                )
            }
            ModContent::Tree(entries) => (
                id.clone(),
                entries
                    .into_iter()
                    .map(|(rel, bytes)| (format!("tf/custom/{id}/{rel}"), bytes))
                    .collect::<Vec<_>>(),
            ),
        };

        let bytes_total = files.iter().try_fold(0u64, |total, (_, bytes)| {
            total.checked_add(bytes.len() as u64).ok_or_else(|| {
                ProfileError::Io("The selected mods are too large to install.".into())
            })
        })?;
        for (rel, _) in &files {
            if !is_profile_ownable_rel_path(rel) {
                return Err(ProfileError::ForbiddenPath(rel.clone()));
            }
            let key = portable_path_key(rel)?;
            if !aggregate_paths.insert(key) {
                return Err(ProfileError::Io(format!(
                    "The selected mods contain colliding file paths: {rel}"
                )));
            }
        }
        for (rel, bytes) in &files {
            if has_extension(rel, "cfg") {
                validate_imported_cfg(rel, bytes)?;
            }
        }

        planned.push(PlannedMod {
            record: ModRecord {
                name: if display.is_empty() {
                    id.clone()
                } else {
                    display
                },
                id,
                source: source.clone(),
                pack,
                files: files.len(),
                bytes: bytes_total,
                installed_at: utc_rfc3339(),
                inactive_pack: None,
            },
            files,
        });
    }

    // One recoverable transaction commits payload, records, and (for the
    // active profile) exact live bytes together. Because every plan above is
    // complete, this is the first write.
    let batch: Vec<(String, FileSource<'_>)> = planned
        .iter()
        .flat_map(|plan| plan.files.iter())
        .map(|(rel, bytes)| (rel.clone(), FileSource::Bytes(bytes.as_slice())))
        .collect();
    let records: Vec<ModRecord> = planned.iter().map(|plan| plan.record.clone()).collect();
    let manifest = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &batch,
        &[],
        ProfileLiveProjection::MirrorIfActive,
        &running,
        move |manifest| {
            manifest.mods.extend(records);
            Ok(())
        },
    )?;
    detail_from_manifest(profiles_dir, &manifest)
}

/// HUDs need the one-HUD replacement review, including when a mod picker or
/// GameBanana supplied their bytes. Detection requires real compatibility data.
fn refuse_hud_mod(content: &ModContent) -> Result<(), ProfileError> {
    let hud = match content {
        ModContent::Tree(entries) => entries.iter().any(|(path, bytes)| {
            path.rsplit('/')
                .next()
                .is_some_and(|name| name.eq_ignore_ascii_case("info.vdf"))
                && crate::hud::is_current_hud_info(bytes)
        }),
        ModContent::Vpk(bytes) => {
            let info =
                read_vpk_dir_bytes_filtered(bytes, &|path| path.eq_ignore_ascii_case("info.vdf"))
                    .map_err(|err| ProfileError::Io(err.message()))?;
            info.files
                .values()
                .any(|bytes| crate::hud::is_current_hud_info(bytes))
        }
    };
    if !hud {
        return Ok(());
    }
    let instruction = if matches!(content, ModContent::Vpk(_)) {
        "Extract this HUD VPK, then choose its extracted folder in HUD → Import HUD. The HUD importer accepts ZIP, 7z, and folders; it cannot import a VPK directly."
    } else {
        "Choose this archive or folder again in HUD → Import HUD to review replacing the current HUD."
    };
    Err(ProfileError::HudImportRequired(format!(
        "This selection contains a HUD. No selected files were installed. {instruction}"
    )))
}

pub fn remove_mod(
    tf2_root: &Path,
    profile_id: &str,
    id: &str,
) -> Result<ProfileDetail, ProfileError> {
    remove_mod_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        id,
        live_process_names(),
    )
}

pub fn remove_mod_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    id: &str,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let record = manifest
        .mods
        .iter()
        .find(|record| record.id == id)
        .cloned()
        .ok_or_else(|| ProfileError::Io("That mod is not installed on this profile.".into()))?;

    let selected = crate::preloader::selected_profile_particle_mod_ids(profiles_dir, profile_id)?;
    if selected.iter().any(|selected| selected == &record.id) {
        return Err(ProfileError::ParticleSourceSelected(record.name));
    }

    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    let paths: Vec<String> = pack_files(&manifest, &record.pack)
        .into_iter()
        .map(|file| file.path)
        .collect();
    let removes_selected_hud = crate::hud::selected_hud_pack(&manifest)
        .is_some_and(|pack| pack.eq_ignore_ascii_case(&record.pack));
    let needs_hud_review = removes_selected_hud
        && crate::hud::manifest_hud_packs(&manifest)
            .iter()
            .any(|pack| !pack.eq_ignore_ascii_case(&record.pack));
    let id = id.to_string();
    let manifest = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &[],
        &paths,
        ProfileLiveProjection::MirrorIfActive,
        &running,
        move |manifest| {
            manifest.mods.retain(|entry| entry.id != id);
            if removes_selected_hud {
                manifest.hud = None;
                manifest.hud_selected_root = None;
                // A retained original must not become the sole-root fallback
                // and silently mount after the selected HUD is removed.
                manifest.hud_review_pending = needs_hud_review;
            }
            Ok(())
        },
    )?;
    if library.active_profile_id.as_deref() == Some(profile_id) {
        for path in &paths {
            prune_empty_parents(&live_path(tf2_root, path), tf2_root);
        }
    }
    detail_from_manifest(profiles_dir, &manifest)
}

fn pack_files(manifest: &ProfileManifest, pack: &str) -> Vec<crate::profile::ProfileFile> {
    let exact = format!("tf/custom/{pack}");
    let prefix = format!("tf/custom/{pack}/");
    manifest
        .files
        .iter()
        .filter(|file| file.path == exact || file.path.starts_with(&prefix))
        .cloned()
        .collect()
}

pub(crate) fn inactive_container(id: &str) -> String {
    format!("execs-inactive-{id}")
}

/// Missing/malformed dates stay unknown. Site metadata edits are deliberately
/// not considered releases; the caller supplies only `_tsDateUpdated`.
pub fn mod_update_available(installed: &str, updated: i64) -> Option<bool> {
    if updated <= 0 || updated > 253_402_300_799 {
        return None;
    }
    let b = installed.as_bytes();
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
        || b.iter()
            .enumerate()
            .any(|(i, c)| ![4, 7, 10, 13, 16, 19].contains(&i) && !c.is_ascii_digit())
    {
        return None;
    }
    let year = installed[0..4].parse::<u32>().ok()?;
    let month = installed[5..7].parse::<usize>().ok()?;
    let day = installed[8..10].parse::<u32>().ok()?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if year < 1970
        || !(1..=12).contains(&month)
        || day == 0
        || day > days[month - 1]
        || installed[11..13].parse::<u32>().ok()? > 23
        || installed[14..16].parse::<u32>().ok()? > 59
        || installed[17..19].parse::<u32>().ok()? > 59
    {
        return None;
    }
    let (y, m, d, h, min, s) = crate::profile::unix_to_ymd_hms(updated as u64);
    Some(format!("{y:04}-{m:02}-{d:02}T{h:02}:{min:02}:{s:02}Z").as_str() > installed)
}

/// Validate the complete shape so imported metadata cannot turn an arbitrary
/// nested path into a mounted file when a pack is enabled.
pub(crate) fn mod_payload_root(record: &ModRecord) -> Result<String, ProfileError> {
    let original = record.inactive_pack.as_deref().unwrap_or(&record.pack);
    if original.is_empty()
        || original.contains(['/', '\\'])
        || portable_path_key(original).is_err()
        || !is_profile_ownable_rel_path(&format!("tf/custom/{original}"))
        || RESERVED_PACK_PREFIXES
            .iter()
            .any(|prefix| original.to_ascii_lowercase().starts_with(prefix))
    {
        return Err(ProfileError::InvalidPath);
    }
    if record.inactive_pack.is_some() {
        if record.pack != inactive_container(&record.id) {
            return Err(ProfileError::InvalidPath);
        }
        Ok(format!("tf/custom/{}/content/{original}", record.pack))
    } else {
        Ok(format!("tf/custom/{original}"))
    }
}

fn saved_mod_bytes(
    profiles: &Path,
    manifest: &ProfileManifest,
    record: &ModRecord,
) -> Result<Vec<(String, Vec<u8>)>, ProfileError> {
    let root = mod_payload_root(record)?;
    let prefix = format!("{root}/");
    let files = pack_files(manifest, &record.pack);
    if files.is_empty() || files.len() > MAX_MOD_ENTRIES {
        return Err(ProfileError::Io(
            "The saved mod has no files or exceeds the file limit.".into(),
        ));
    }
    let mut total = 0u64;
    let original = record.inactive_pack.as_deref().unwrap_or(&record.pack);
    let vpk = original.to_ascii_lowercase().ends_with(".vpk");
    if vpk && files.len() != 1 {
        return Err(ProfileError::InvalidPath);
    }
    files.into_iter().map(|file| {
        if (vpk && file.path != root) || (!vpk && !file.path.starts_with(&prefix)) {
            return Err(ProfileError::InvalidPath);
        }
        let source = crate::apply::manifest_source_path(profiles, &manifest.id, &file)?;
        let bytes = read_regular_file_bounded_within(profiles, &source, MAX_MOD_BYTES)?
            .ok_or_else(|| ProfileError::Io("The saved mod exceeds the size limit.".into()))?;
        total = total.checked_add(bytes.len() as u64).ok_or(ProfileError::InvalidPath)?;
        if total > MAX_MOD_BYTES || !crate::hash::sha256_hex(&bytes).eq_ignore_ascii_case(&file.sha256) {
            return Err(ProfileError::Io("The saved mod changed or exceeds the size limit. Refresh the profile before retrying.".into()));
        }
        Ok((file.path, bytes))
    }).collect()
}

fn refuse_mod_move_drift(
    profiles: &Path,
    root: &Path,
    manifest: &ProfileManifest,
    record: &ModRecord,
    destination_pack: &str,
    active: bool,
) -> Result<(), ProfileError> {
    // Re-read hashes after staging, before transaction publication as well.
    if load_manifest(profiles, &manifest.id)? != *manifest {
        return Err(ProfileError::Io(
            "The profile changed while this action was prepared. Refresh and retry.".into(),
        ));
    }
    saved_mod_bytes(profiles, manifest, record)?;
    if !active {
        return Ok(());
    }
    for file in pack_files(manifest, &record.pack) {
        let live = live_path(root, &file.path);
        crate::hash::validate_file_within(root, &live)
            .map_err(|e| ProfileError::Io(e.to_string()))?;
        if !crate::hash::sha256_file(&live)
            .map_err(|e| ProfileError::Io(e.to_string()))?
            .eq_ignore_ascii_case(&file.sha256)
        {
            return Err(ProfileError::Io(
                "This pack changed in TF2. Update the profile before turning it on or off.".into(),
            ));
        }
    }
    if !record.pack.to_ascii_lowercase().ends_with(".vpk") {
        let entries = crate::archive::read_dir_entries(
            &root.join("tf/custom").join(&record.pack),
            MOD_LIMITS,
        )?;
        if entries.len() != pack_files(manifest, &record.pack).len() {
            return Err(ProfileError::Io(
                "This pack has new files in TF2. Update the profile before turning it on or off."
                    .into(),
            ));
        }
    }
    for entry in
        fs::read_dir(root.join("tf/custom")).map_err(|e| ProfileError::Io(e.to_string()))?
    {
        let entry = entry.map_err(|e| ProfileError::Io(e.to_string()))?;
        if entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case(destination_pack)
        {
            return Err(ProfileError::Io(
                "The destination pack already exists in TF2; it was left unchanged.".into(),
            ));
        }
    }
    Ok(())
}

pub fn set_mod_enabled(
    root: &Path,
    profile_id: &str,
    id: &str,
    enabled: bool,
) -> Result<ProfileDetail, ProfileError> {
    set_mod_enabled_to(
        &profiles_dir(),
        root,
        profile_id,
        id,
        enabled,
        live_process_names(),
    )
}

pub fn set_mod_enabled_to<I, S>(
    profiles: &Path,
    root: &Path,
    profile_id: &str,
    id: &str,
    enabled: bool,
    running: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running
        .into_iter()
        .map(|s| s.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running)?;
    let manifest = load_manifest(profiles, profile_id)?;
    let record = manifest
        .mods
        .iter()
        .find(|r| r.id == id)
        .cloned()
        .ok_or(ProfileError::InvalidPath)?;
    if enabled == record.inactive_pack.is_none() {
        return detail_from_manifest(profiles, &manifest);
    }
    if crate::preloader::selected_profile_particle_mod_ids(profiles, profile_id)?
        .contains(&record.id)
    {
        return Err(ProfileError::ParticleSourceSelected(record.name));
    }
    if crate::hud::manifest_hud_packs(&manifest)
        .iter()
        .any(|p| p.eq_ignore_ascii_case(&record.pack))
    {
        return Err(ProfileError::Io(
            "Manage this HUD from the HUD pane.".into(),
        ));
    }
    let bytes = saved_mod_bytes(profiles, &manifest, &record)?;
    let mut next = record.clone();
    if enabled {
        next.pack = next.inactive_pack.take().ok_or(ProfileError::InvalidPath)?;
    } else {
        next.inactive_pack = Some(next.pack.clone());
        next.pack = inactive_container(id);
    }
    if manifest
        .files
        .iter()
        .any(|f| pack_key(&f.path).is_some_and(|p| p.eq_ignore_ascii_case(&next.pack)))
    {
        return Err(ProfileError::Io(
            "This profile already owns the destination pack.".into(),
        ));
    }
    let old_root = mod_payload_root(&record)?;
    let new_root = mod_payload_root(&next)?;
    let active = load_library_from(profiles, Some(root))?
        .active_profile_id
        .as_deref()
        == Some(profile_id);
    let preflight =
        || refuse_mod_move_drift(profiles, root, &manifest, &record, &next.pack, active);
    preflight()?;
    if enabled {
        let content = if next.pack.to_ascii_lowercase().ends_with(".vpk") {
            ModContent::Vpk(bytes[0].1.clone())
        } else {
            ModContent::Tree(
                bytes
                    .iter()
                    .map(|(p, b)| (p[old_root.len() + 1..].to_string(), b.clone()))
                    .collect(),
            )
        };
        refuse_crosshair_script_collision(&content, &active_crosshair_script_targets(&manifest))?;
    }
    let puts: Vec<_> = bytes
        .iter()
        .map(|(p, b)| {
            (
                format!("{new_root}{}", &p[old_root.len()..]),
                FileSource::Bytes(b),
            )
        })
        .collect();
    let removes: Vec<_> = bytes.iter().map(|(p, _)| p.clone()).collect();
    let new_record = next.clone();
    let result = crate::profile::mutate_profile_files_checked_to(
        profiles,
        root,
        profile_id,
        &puts,
        &removes,
        ProfileLiveProjection::MirrorIfActive,
        &running,
        |m| {
            *m.mods
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(ProfileError::InvalidPath)? = new_record;
            Ok(())
        },
        Some(&preflight),
    )?;
    if active {
        for p in &removes {
            prune_empty_parents(&live_path(root, p), root);
        }
    }
    detail_from_manifest(profiles, &result)
}

pub fn copy_mod_to_profile(
    root: &Path,
    source_id: &str,
    id: &str,
    target_id: &str,
) -> Result<ProfileDetail, ProfileError> {
    copy_mod_to_profile_to(
        &profiles_dir(),
        root,
        source_id,
        id,
        target_id,
        live_process_names(),
    )
}

pub fn copy_mod_to_profile_to<I, S>(
    profiles: &Path,
    root: &Path,
    source_id: &str,
    id: &str,
    target_id: &str,
    running: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running
        .into_iter()
        .map(|s| s.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running)?;
    let library = load_library_from(profiles, Some(root))?;
    if source_id == target_id || library.active_profile_id.as_deref() == Some(target_id) {
        return Err(ProfileError::Io(
            "Choose a different, inactive profile.".into(),
        ));
    }
    let source = load_manifest(profiles, source_id)?;
    let target = load_manifest(profiles, target_id)?;
    let record = source
        .mods
        .iter()
        .find(|r| r.id == id)
        .ok_or(ProfileError::InvalidPath)?;
    if crate::hud::manifest_hud_packs(&source)
        .iter()
        .any(|p| p.eq_ignore_ascii_case(&record.pack))
    {
        return Err(ProfileError::Io(
            "Manage this HUD from the HUD pane.".into(),
        ));
    }
    let bytes = saved_mod_bytes(profiles, &source, record)?;
    let mut next = record.clone();
    next.id = unique_mod_id(
        &mod_id_from_name(&record.name),
        &taken_pack_identities(root, &target),
    );
    let original = record.inactive_pack.as_deref().unwrap_or(&record.pack);
    let target_pack = if original.to_ascii_lowercase().ends_with(".vpk") {
        format!("{}.vpk", next.id)
    } else {
        next.id.clone()
    };
    next.pack = if record.inactive_pack.is_some() {
        inactive_container(&next.id)
    } else {
        target_pack.clone()
    };
    next.inactive_pack = record.inactive_pack.as_ref().map(|_| target_pack);
    let from = mod_payload_root(record)?;
    let to = mod_payload_root(&next)?;
    if target
        .files
        .iter()
        .any(|f| pack_key(&f.path).is_some_and(|p| p.eq_ignore_ascii_case(&next.pack)))
    {
        return Err(ProfileError::Io(
            "The destination profile already owns that inactive container.".into(),
        ));
    }
    let content = if original.to_ascii_lowercase().ends_with(".vpk") {
        ModContent::Vpk(bytes[0].1.clone())
    } else {
        ModContent::Tree(
            bytes
                .iter()
                .map(|(p, b)| (p[from.len() + 1..].to_string(), b.clone()))
                .collect(),
        )
    };
    refuse_hud_mod(&content)?;
    if next.inactive_pack.is_none() {
        refuse_crosshair_script_collision(&content, &active_crosshair_script_targets(&target))?;
    }
    let puts: Vec<_> = bytes
        .iter()
        .map(|(p, b)| (format!("{to}{}", &p[from.len()..]), FileSource::Bytes(b)))
        .collect();
    let preflight = || {
        if load_manifest(profiles, source_id)? != source
            || load_manifest(profiles, target_id)? != target
        {
            return Err(ProfileError::Io(
                "A profile changed while the copy was prepared. Refresh and retry.".into(),
            ));
        }
        saved_mod_bytes(profiles, &source, record)?;
        Ok(())
    };
    let result = crate::profile::mutate_profile_files_checked_to(
        profiles,
        root,
        target_id,
        &puts,
        &[],
        ProfileLiveProjection::LibraryOnly,
        &running,
        |m| {
            m.mods.push(next);
            Ok(())
        },
        Some(&preflight),
    )?;
    detail_from_manifest(profiles, &result)
}

// ---------------------------------------------------------------------------
// Particles a profile's mods can lend the preloader
// ---------------------------------------------------------------------------

pub fn profile_particle_sources(
    tf2_root: &Path,
    profile_id: &str,
) -> Result<Vec<ParticleSource>, ProfileError> {
    let _ = load_library_from(&profiles_dir(), Some(tf2_root))?;
    profile_particle_sources_from(&profiles_dir(), profile_id)
}

/// Mods on the profile whose pack carries `particles/*.pcf` at its root.
///
/// The bytes are read from the profile's own copy rather than the live folder:
/// they are the same bytes (drift absorbs back into the profile), and this way
/// the list is correct for a profile that is not the active one.
pub fn profile_particle_sources_from(
    profiles_dir: &Path,
    profile_id: &str,
) -> Result<Vec<ParticleSource>, ProfileError> {
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let mut sources = Vec::new();
    for record in &manifest.mods {
        let pcf_files = pack_pcf_files(profiles_dir, &manifest, record)?;
        if pcf_files.is_empty() {
            continue;
        }
        sources.push(ParticleSource {
            mod_id: record.id.clone(),
            name: record.name.clone(),
            pcf_files,
            unavailable_reason: None,
        });
    }
    Ok(sources)
}

fn pack_pcf_files(
    profiles_dir: &Path,
    manifest: &ProfileManifest,
    record: &ModRecord,
) -> Result<Vec<String>, ProfileError> {
    if !record.pack.to_ascii_lowercase().ends_with(".vpk") {
        let prefix = format!("tf/custom/{}/particles/", record.pack);
        let mut names: Vec<String> = manifest
            .files
            .iter()
            .filter_map(|file| file.path.strip_prefix(&prefix))
            .filter(|rest| !rest.contains('/') && is_pcf(rest))
            .map(str::to_string)
            .collect();
        names.sort();
        names.dedup();
        return Ok(names);
    }
    let rel = format!("tf/custom/{}", record.pack);
    let source = exclusive_file_path(profiles_dir, &manifest.id, &rel);
    if !source.is_file() {
        return Ok(Vec::new());
    }
    crate::hash::validate_file_within(profiles_dir, &source)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let entries = map_vpk_entries(&source).map_err(|err| ProfileError::Io(err.message()))?;
    let mut names: Vec<String> = entries
        .keys()
        .filter(|entry| is_root_particle(entry))
        .filter_map(|entry| entry.strip_prefix("particles/"))
        .map(str::to_string)
        .collect();
    names.sort();
    Ok(names)
}

fn is_root_particle(entry: &str) -> bool {
    entry
        .strip_prefix("particles/")
        .is_some_and(|rest| !rest.contains('/') && is_pcf(rest))
}

fn is_pcf(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".pcf")
}

/// The bytes of one `particles/<file>` inside a profile mod's pack, for the
/// preloader to patch into the official archive.
pub fn read_mod_pcf(
    profiles_dir: &Path,
    profile_id: &str,
    mod_id: &str,
    pcf: &str,
) -> Result<Option<Vec<u8>>, ProfileError> {
    if pcf.contains(['/', '\\']) || !is_pcf(pcf) {
        return Ok(None);
    }
    let manifest = load_manifest(profiles_dir, profile_id)?;
    let Some(record) = manifest.mods.iter().find(|record| record.id == mod_id) else {
        return Ok(None);
    };
    if !record.pack.to_ascii_lowercase().ends_with(".vpk") {
        let rel = format!("tf/custom/{}/particles/{pcf}", record.pack);
        if !manifest.files.iter().any(|file| file.path == rel) {
            return Ok(None);
        }
        let source = exclusive_file_path(profiles_dir, profile_id, &rel);
        match fs::symlink_metadata(&source) {
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(ProfileError::Io(err.to_string())),
            Ok(_) => {}
        }
        return read_regular_file_bounded_within(profiles_dir, &source, MAX_PCF_BYTES as u64)?
            .map_or_else(
                || {
                    Err(ProfileError::Io(format!(
                        "{rel} is larger than {} MiB and cannot be used as a particle source.",
                        MAX_PCF_BYTES / (1024 * 1024)
                    )))
                },
                |bytes| Ok(Some(bytes)),
            );
    }
    let source = exclusive_file_path(
        profiles_dir,
        profile_id,
        &format!("tf/custom/{}", record.pack),
    );
    if !source.is_file() {
        return Ok(None);
    }
    crate::hash::validate_file_within(profiles_dir, &source)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let wanted = format!("particles/{pcf}");
    let archive = read_vpk_dir_file_filtered_bounded(
        &source,
        &|entry| entry == wanted,
        MAX_PCF_BYTES as u64,
        MAX_PCF_BYTES as u64,
    )
    .map_err(|err| ProfileError::Io(err.message()))?;
    Ok(archive.files.into_values().next())
}

#[cfg(test)]
mod tests {
    #[test]
    fn oversized_mods_name_their_size_the_limit_and_the_manual_route() {
        let message = oversized_mod_message(Some(1_503_238_554));
        assert!(message.starts_with("This file is 1.4 GB; execs installs mods up to 512 MB."));
        assert!(message.contains("extract the mod into tf/custom"));
        assert!(oversized_mod_message(Some(600 * 1024 * 1024)).contains("600 MB"));
        assert!(oversized_mod_message(None).contains("larger than that"));
    }

    use super::*;
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::test_temp_dir;
    use crate::vpk::write_vpk_v1;
    use std::collections::BTreeMap;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn unlocked() -> Vec<String> {
        Vec::new()
    }

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            for (name, bytes) in entries {
                zip.start_file(*name, options).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.finish().unwrap();
        }
        cursor.into_inner()
    }

    fn setup() -> (PathBuf, PathBuf, PathBuf, String) {
        let root = test_temp_dir();
        let tf2 = root.join("tf2");
        fs::create_dir_all(tf2.join("tf/cfg")).unwrap();
        fs::create_dir_all(tf2.join("tf/custom")).unwrap();
        fs::write(tf2.join("tf/steam.inf"), "appID=440\n").unwrap();
        let profiles = root.join("profiles");
        create_profile_record_to(&profiles, &tf2, "Main", unlocked()).unwrap();
        let id = load_library_from(&profiles, Some(&tf2)).unwrap().profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &tf2, &id, unlocked()).unwrap();
        (root, profiles, tf2, id)
    }

    #[test]
    fn importing_a_weapon_script_cannot_collide_with_active_crosshair_pack() {
        let (root, profiles, tf2, id) = setup();
        let crosshair_path = "tf/custom/execs-crosshairs/scripts/tf_weapon_scattergun.txt";
        mutate_profile_files_to(
            &profiles,
            &tf2,
            &id,
            &[(
                crosshair_path.into(),
                FileSource::Bytes(b"generated script"),
            )],
            &[],
            ProfileLiveProjection::MirrorIfActive,
            unlocked(),
            |manifest| {
                manifest.crosshair = Some(crate::profile::CrosshairRecord {
                    id: "execs-crosshairs".into(),
                    inactive: false,
                    source_changed: false,
                    source_scripts_sha256: None,
                    scale: None,
                    stock: None,
                    shape: "cross".into(),
                    assignments: BTreeMap::new(),
                    color: None,
                    library: BTreeMap::new(),
                    design: None,
                });
                Ok(())
            },
        )
        .unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let member = "SCRIPTS/TF_WEAPON_SCATTERGUN.TXT";
        for (name, content) in [
            (
                "loose",
                ModContent::Tree(vec![(member.into(), b"other script".to_vec())]),
            ),
            (
                "packed",
                ModContent::Vpk(write_vpk_v1(&BTreeMap::from([(
                    member.into(),
                    b"other script".to_vec(),
                )]))),
            ),
        ] {
            let err = install_mod_to(
                &profiles,
                &tf2,
                &id,
                name,
                content,
                ModSource::Local,
                unlocked(),
            )
            .unwrap_err();
            assert!(err.message().contains("scripts/tf_weapon_scattergun.txt"));
            assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
            assert!(!tf2.join(format!("tf/custom/{name}")).exists());
            assert!(!tf2.join(format!("tf/custom/{name}.vpk")).exists());
            assert_eq!(
                fs::read(tf2.join(crosshair_path)).unwrap(),
                b"generated script"
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    fn save_selected_profile_mods(profiles: &Path, tf2: &Path, profile_id: &str, ids: &[&str]) {
        mutate_profile_files_to(
            profiles,
            tf2,
            profile_id,
            &[],
            &[],
            ProfileLiveProjection::LibraryOnly,
            unlocked(),
            |manifest| {
                manifest.preloader = Some(crate::preloader::PreloaderSelection {
                    profile_particle_mods: ids.iter().map(|id| (*id).to_string()).collect(),
                    ..crate::preloader::PreloaderSelection::default()
                });
                Ok(())
            },
        )
        .unwrap();
    }

    fn save_legacy_selected_profile_mods(data_dir: &Path, profile_id: &str, ids: &[&str]) {
        let state = crate::preloader::PreloaderState {
            profile_particle_mods: ids.iter().map(|id| (*id).to_string()).collect(),
            selection_profile: Some(profile_id.to_string()),
            ..crate::preloader::PreloaderState::default()
        };
        fs::create_dir_all(data_dir.join("preloader")).unwrap();
        fs::write(
            data_dir.join("preloader/state.json"),
            serde_json::to_vec_pretty(&state).unwrap(),
        )
        .unwrap();
    }

    fn install_particle_mod(
        profiles: &Path,
        tf2: &Path,
        profile_id: &str,
        name: &str,
        pcf: &str,
    ) -> ModRecord {
        install_mod_to(
            profiles,
            tf2,
            profile_id,
            name,
            ModContent::Tree(vec![(format!("particles/{pcf}"), b"pcf".to_vec())]),
            ModSource::Local,
            unlocked(),
        )
        .unwrap()
        .mods
        .into_iter()
        .find(|record| record.name == name)
        .unwrap()
    }

    fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn disabled_tree_and_vpk_roundtrip_through_absorb_export_switch_and_copy() {
        for packed in [false, true] {
            let (area, profiles, root, id) = setup();
            let content = if packed {
                ModContent::Vpk(write_vpk_v1(&BTreeMap::from([(
                    "materials/test.vmt".into(),
                    b"exact payload".to_vec(),
                )])))
            } else {
                ModContent::Tree(vec![
                    ("materials/test.vmt".into(), b"exact payload".to_vec()),
                    ("cfg/test.cfg".into(), b"echo hello\r\n".to_vec()),
                ])
            };
            let installed = install_mod_to(
                &profiles,
                &root,
                &id,
                "My pack",
                content,
                ModSource::Gamebanana {
                    id: 123,
                    url: "https://gamebanana.com/mods/123".into(),
                },
                unlocked(),
            )
            .unwrap();
            let record = installed.mods[0].clone();
            let before = load_manifest(&profiles, &id).unwrap();
            let original = saved_mod_bytes(&profiles, &before, &record).unwrap();
            let disabled =
                set_mod_enabled_to(&profiles, &root, &id, &record.id, false, unlocked()).unwrap();
            let off = disabled.mods[0].clone();
            assert_eq!(off.inactive_pack.as_deref(), Some(record.pack.as_str()));
            assert_eq!(off.installed_at, record.installed_at);
            assert!(!root.join(format!("tf/custom/{}", record.pack)).exists());
            assert!(profile_particle_sources_from(&profiles, &id)
                .unwrap()
                .is_empty());
            let after = load_manifest(&profiles, &id).unwrap();
            for (path, bytes) in saved_mod_bytes(&profiles, &after, &off).unwrap() {
                assert!(path.starts_with(&format!("tf/custom/{}/content/", off.pack)));
                assert_eq!(fs::read(root.join(path)).unwrap(), bytes);
            }
            let opts = || crate::absorb::AbsorbOptions {
                cloud_config: None,
                steam_roots: Some(&[]),
            };
            let absorbed =
                crate::absorb::absorb_owned_to(&profiles, &root, unlocked(), opts()).unwrap();
            assert!(absorbed.delta.packs_added.is_empty());
            assert!(absorbed.delta.packs_removed.is_empty());
            assert_eq!(load_manifest(&profiles, &id).unwrap().mods[0], off);
            let export = area.join("disabled.zip");
            crate::zip::export_profile_to(&profiles, &root, &id, &export).unwrap();
            let library =
                crate::zip::import_profile_from(&profiles, &root, &export, unlocked()).unwrap();
            let imported = library
                .profiles
                .iter()
                .find(|p| p.id != id)
                .unwrap()
                .id
                .clone();
            assert_eq!(load_manifest(&profiles, &imported).unwrap().mods[0], off);
            crate::switch::switch_profile_to(
                &profiles,
                &root,
                &imported,
                unlocked(),
                opts(),
                |_| {},
            )
            .unwrap();
            assert!(!root.join(format!("tf/custom/{}", record.pack)).exists());
            assert_eq!(load_manifest(&profiles, &imported).unwrap().mods[0], off);
            set_mod_enabled_to(&profiles, &root, &imported, &record.id, true, unlocked()).unwrap();
            for (path, bytes) in &original {
                assert_eq!(fs::read(root.join(path)).unwrap(), *bytes);
            }
            // The original profile remains disabled and is a safe library-only target.
            let copied =
                copy_mod_to_profile_to(&profiles, &root, &imported, &record.id, &id, unlocked())
                    .unwrap();
            assert_eq!(copied.mods.len(), 2);
            let copy = copied.mods.iter().find(|r| r.id != record.id).unwrap();
            assert_eq!(copy.source, record.source);
            assert_eq!(copy.installed_at, record.installed_at);
            assert!(!root.join(format!("tf/custom/{}", copy.pack)).exists());
            // Copy a disabled source too; its destination remains disabled.
            let library =
                crate::profile::create_profile_record_to(&profiles, &root, "Third", unlocked())
                    .unwrap();
            let third = library
                .profiles
                .iter()
                .find(|p| p.id != id && p.id != imported)
                .unwrap()
                .id
                .clone();
            let copied =
                copy_mod_to_profile_to(&profiles, &root, &id, &record.id, &third, unlocked())
                    .unwrap();
            assert!(copied.mods[0].inactive_pack.is_some());
            assert_eq!(copied.mods[0].source, record.source);
            cleanup(&area);
        }
    }

    #[test]
    fn mod_toggle_refuses_particle_selection_drift_and_collisions_without_changes() {
        let (area, profiles, root, id) = setup();
        let record = install_particle_mod(&profiles, &root, &id, "Particles", "water.pcf");
        save_selected_profile_mods(&profiles, &root, &id, &[&record.id]);
        let selected = load_manifest(&profiles, &id).unwrap();
        assert!(matches!(
            set_mod_enabled_to(&profiles, &root, &id, &record.id, false, unlocked()),
            Err(ProfileError::ParticleSourceSelected(_))
        ));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), selected);
        save_selected_profile_mods(&profiles, &root, &id, &[]);
        let before = load_manifest(&profiles, &id).unwrap();
        let live = root.join(format!("tf/custom/{}/particles/water.pcf", record.pack));
        fs::write(&live, b"external edit").unwrap();
        assert!(set_mod_enabled_to(&profiles, &root, &id, &record.id, false, unlocked()).is_err());
        assert_eq!(fs::read(&live).unwrap(), b"external edit");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        fs::write(&live, b"pcf").unwrap();
        let collision = root.join(format!("tf/custom/{}", inactive_container(&record.id)));
        fs::create_dir_all(&collision).unwrap();
        fs::write(collision.join("keep"), b"unowned").unwrap();
        assert!(set_mod_enabled_to(&profiles, &root, &id, &record.id, false, unlocked()).is_err());
        assert_eq!(fs::read(collision.join("keep")).unwrap(), b"unowned");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert!(set_mod_enabled_to(&profiles, &root, &id, &record.id, false, ["tf.exe"]).is_err());
        cleanup(&area);
    }

    #[test]
    fn mod_copy_refuses_corrupt_saved_bytes_and_active_destination() {
        let (area, profiles, root, id) = setup();
        let record = install_particle_mod(&profiles, &root, &id, "Particles", "water.pcf");
        let library = create_profile_record_to(&profiles, &root, "Other", unlocked()).unwrap();
        let target = library
            .profiles
            .iter()
            .find(|p| p.id != id)
            .unwrap()
            .id
            .clone();
        assert!(
            copy_mod_to_profile_to(&profiles, &root, &id, &record.id, &id, unlocked()).is_err()
        );
        let before = load_manifest(&profiles, &target).unwrap();
        let path = format!("tf/custom/{}/particles/water.pcf", record.pack);
        fs::write(exclusive_file_path(&profiles, &id, &path), b"corrupt").unwrap();
        assert!(
            copy_mod_to_profile_to(&profiles, &root, &id, &record.id, &target, unlocked()).is_err()
        );
        assert_eq!(load_manifest(&profiles, &target).unwrap(), before);
        assert_eq!(fs::read(root.join(path)).unwrap(), b"pcf");
        cleanup(&area);
    }

    #[test]
    fn mod_updates_compare_only_valid_known_install_and_update_dates() {
        assert_eq!(mod_update_available("1970-01-01T00:00:01Z", 2), Some(true));
        assert_eq!(mod_update_available("1970-01-01T00:00:02Z", 2), Some(false));
        for date in [
            "",
            "not a date",
            "2026-02-30T00:00:00Z",
            "2026-13-01T00:00:00Z",
        ] {
            assert_eq!(mod_update_available(date, 1_800_000_000), None);
        }
        assert_eq!(mod_update_available("2026-09-28T00:00:00Z", 0), None);
    }

    #[test]
    fn a_wrapper_folder_is_stripped_and_the_pack_is_named_from_the_archive() {
        let bytes = zip_bytes(&[
            ("MyMod-v2/materials/models/a.vmt", b"vmt"),
            ("MyMod-v2/models/a.mdl", b"mdl"),
            ("MyMod-v2/readme.txt", b"hi"),
        ]);
        let packs = mod_content_from_archive("MyMod v2.zip", &bytes).unwrap();
        assert_eq!(packs.len(), 1);
        assert_eq!(packs[0].0, "MyMod v2");
        let ModContent::Tree(entries) = &packs[0].1 else {
            panic!("expected loose files");
        };
        let mut rels: Vec<&str> = entries.iter().map(|(rel, _)| rel.as_str()).collect();
        rels.sort();
        assert_eq!(
            rels,
            vec!["materials/models/a.vmt", "models/a.mdl", "readme.txt"]
        );
    }

    #[test]
    fn loose_mods_avoid_source_reserved_names_and_collisions_but_vpks_keep_their_name() {
        let (area, profiles, root, id) = setup();
        fs::create_dir_all(root.join("tf/custom/mod-materials")).unwrap();
        fs::write(root.join("tf/custom/mod-materials/keep.txt"), b"keep").unwrap();
        for name in [
            "MATERIALS",
            "Maps",
            "resource",
            "Scripts",
            "SOUND",
            "models",
        ] {
            let detail = install_mod_to(
                &profiles,
                &root,
                &id,
                &format!("{name}.zip"),
                ModContent::Tree(vec![(
                    "materials/audit/sample.vmt".into(),
                    b"dummy".to_vec(),
                )]),
                ModSource::Local,
                unlocked(),
            )
            .unwrap();
            let record = detail.mods.last().unwrap();
            assert!(!crate::custom_folders::is_reserved_source_folder(
                &record.pack
            ));
            assert!(!root.join("tf/custom").join(name).exists());
            assert_eq!(
                fs::read(root.join(format!(
                    "tf/custom/{}/materials/audit/sample.vmt",
                    record.pack
                )))
                .unwrap(),
                b"dummy"
            );
        }
        assert_eq!(
            fs::read(root.join("tf/custom/mod-materials/keep.txt")).unwrap(),
            b"keep"
        );
        assert!(root
            .join("tf/custom/mod-materials-2/materials/audit/sample.vmt")
            .exists());
        let vpk = write_vpk_v1(&BTreeMap::from([(
            "materials/a.vmt".into(),
            b"vmt".to_vec(),
        )]));
        let detail = install_mod_to(
            &profiles,
            &root,
            &id,
            "materials.vpk",
            ModContent::Vpk(vpk),
            ModSource::Local,
            unlocked(),
        )
        .unwrap();
        assert!(detail
            .mods
            .iter()
            .any(|record| record.pack == "materials.vpk"));
        cleanup(&area);
    }

    #[test]
    fn pre_and_post_steampipe_wrappers_become_a_custom_pack() {
        for (archive_name, source, expected) in [
            (
                "legacy-skin.zip",
                "Steam/steamapps/player/team fortress 2/tf/materials/models/player/scout.vtf",
                "materials/models/player/scout.vtf",
            ),
            (
                "current-skin.zip",
                "Team Fortress 2/tf/custom/author-skin/materials/models/player/scout.vtf",
                "materials/models/player/scout.vtf",
            ),
        ] {
            let bytes = zip_bytes(&[(source, b"vtf")]);
            let packs = mod_content_from_archive(archive_name, &bytes).unwrap();
            assert_eq!(packs.len(), 1);
            let ModContent::Tree(entries) = &packs[0].1 else {
                panic!("expected loose files");
            };
            assert_eq!(entries, &vec![(expected.to_string(), b"vtf".to_vec())]);
        }
    }

    #[test]
    fn one_archived_vpk_installs_but_several_require_a_choice() {
        let mut files = BTreeMap::new();
        files.insert("materials/a.vmt".to_string(), b"vmt".to_vec());
        let vpk = write_vpk_v1(&files);
        let one = zip_bytes(&[("pack/Red Scout.vpk", &vpk), ("pack/readme.txt", b"hi")]);
        let packs = mod_content_from_archive("scout.zip", &one).unwrap();
        assert_eq!(packs.len(), 1);
        assert_eq!(packs[0].0, "Red Scout");
        assert!(matches!(packs[0].1, ModContent::Vpk(_)));

        let choices = zip_bytes(&[
            ("options/regular-fists.vpk", &vpk),
            ("options/team-colored-fists.vpk", &vpk),
        ]);
        let err = mod_content_from_archive("heavy-options.zip", &choices).unwrap_err();
        assert!(
            err.message().contains("install choices"),
            "{}",
            err.message()
        );

        // A split set is refused rather than half-installed.
        let split = zip_bytes(&[("pack/big_dir.vpk", &vpk), ("pack/big_000.vpk", &vpk)]);
        let err = mod_content_from_archive("big.zip", &split).unwrap_err();
        assert!(err.message().contains("multi-part"), "{}", err.message());

        // Numbered names without a `_dir.vpk` are ordinary VPKs, but several
        // ordinary VPKs in one archive are still an ambiguous selection.
        let numbered = zip_bytes(&[("pack/skin_001.vpk", &vpk), ("pack/skin_002.vpk", &vpk)]);
        let err = mod_content_from_archive("skins.zip", &numbered).unwrap_err();
        assert!(
            err.message().contains("install choices"),
            "{}",
            err.message()
        );
    }

    #[test]
    fn an_archive_cannot_silently_drop_loose_content_beside_a_vpk() {
        let mut files = BTreeMap::new();
        files.insert("materials/a.vmt".to_string(), b"packed".to_vec());
        let vpk = write_vpk_v1(&files);
        let bytes = zip_bytes(&[
            ("mod.vpk", &vpk),
            ("folder/materials/supplement.vmt", b"loose"),
        ]);
        let err = mod_content_from_archive("mixed.zip", &bytes).unwrap_err();
        assert!(
            err.message().contains("both a VPK and loose TF2 files"),
            "{}",
            err.message()
        );
    }

    #[test]
    fn loose_alternatives_at_different_depths_require_a_choice() {
        let bytes = zip_bytes(&[
            ("default/materials/skin.vmt", b"default"),
            ("alternatives/red/materials/skin.vmt", b"red"),
        ]);
        let err = mod_content_from_archive("choices.zip", &bytes).unwrap_err();
        assert!(err.message().contains("multiple peer TF2 content roots"));
    }

    /// The same rule for a picked file: `skin_000.vpk` alone installs, the
    /// same file beside its `skin_dir.vpk` is half of a split set.
    #[test]
    fn a_picked_numbered_vpk_is_refused_only_beside_its_directory_file() {
        let root = test_temp_dir();
        let mut files = BTreeMap::new();
        files.insert("materials/a.vmt".to_string(), b"vmt".to_vec());
        let vpk = write_vpk_v1(&files);
        let numbered = root.join("skin_000.vpk");
        fs::write(&numbered, &vpk).unwrap();
        let (name, content) = mod_content_from_vpk_file(&numbered).unwrap();
        assert_eq!(name, "skin_000");
        assert!(matches!(content, ModContent::Vpk(_)));

        fs::write(root.join("skin_dir.vpk"), &vpk).unwrap();
        let err = mod_content_from_vpk_file(&numbered).unwrap_err();
        assert!(err.message().contains("multi-part"), "{}", err.message());
        let err = mod_content_from_vpk_file(&root.join("skin_dir.vpk")).unwrap_err();
        assert!(err.message().contains("multi-part"), "{}", err.message());
        cleanup(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_picked_vpk_symlink_is_never_followed() {
        use std::os::unix::fs::symlink;

        let root = test_temp_dir();
        let mut files = BTreeMap::new();
        files.insert("materials/a.vmt".to_string(), b"vmt".to_vec());
        let target = root.join("outside.vpk");
        fs::write(&target, write_vpk_v1(&files)).unwrap();
        let picked = root.join("picked.vpk");
        symlink(&target, &picked).unwrap();
        let err = mod_content_from_vpk_file(&picked).unwrap_err();
        assert!(err.message().contains("linked"), "{err:?}");
        cleanup(&root);
    }

    /// Import validation walks the directory tree without copying a body, so
    /// a crafted VPK whose entries overlap into gigabytes is refused with a
    /// message instead of aborting the process on allocation.
    #[test]
    fn a_vpk_whose_entries_overlap_into_gigabytes_is_refused_on_import() {
        let root = test_temp_dir();
        let body = vec![0x11u8; 256 * 1024];
        let mut tree = Vec::new();
        let cstr = |tree: &mut Vec<u8>, s: &str| {
            tree.extend_from_slice(s.as_bytes());
            tree.push(0);
        };
        cstr(&mut tree, "vtf");
        cstr(&mut tree, "materials");
        for index in 0..64 {
            cstr(&mut tree, &format!("t{index}"));
            tree.extend_from_slice(&crate::vpk::crc32(&body).to_le_bytes());
            tree.extend_from_slice(&0u16.to_le_bytes());
            tree.extend_from_slice(&0x7fffu16.to_le_bytes());
            tree.extend_from_slice(&0u32.to_le_bytes());
            tree.extend_from_slice(&(body.len() as u32).to_le_bytes());
            tree.extend_from_slice(&0xffffu16.to_le_bytes());
        }
        tree.extend_from_slice(&[0, 0, 0]);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x55aa_1234u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&(tree.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&tree);
        bytes.extend_from_slice(&body);

        let picked = root.join("crafted.vpk");
        fs::write(&picked, &bytes).unwrap();
        let err = mod_content_from_vpk_file(&picked).unwrap_err();
        assert!(err.message().contains("overlap"), "{}", err.message());

        let (profile_root, profiles, tf2, id) = setup();
        let err = install_mod_to(
            &profiles,
            &tf2,
            &id,
            "crafted.vpk",
            ModContent::Vpk(bytes),
            ModSource::Local,
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("overlap"), "{}", err.message());
        assert!(!tf2.join("tf/custom/crafted.vpk").exists());
        cleanup(&profile_root);
        cleanup(&root);
    }

    #[test]
    fn an_archive_with_no_tf2_content_is_refused() {
        let bytes = zip_bytes(&[("shots/preview.png", b"png"), ("readme.txt", b"hi")]);
        let err = mod_content_from_archive("pictures.zip", &bytes).unwrap_err();
        assert!(
            err.message().contains("no TF2 content"),
            "{}",
            err.message()
        );

        // cfg-only and resource-only packs are HUDs or configs, and still install.
        let cfg_only = zip_bytes(&[("wrapper/cfg/autoexec.cfg", b"echo hi\n")]);
        assert!(mod_content_from_archive("cfgs.zip", &cfg_only).is_ok());
    }

    #[test]
    fn archives_with_peer_content_roots_are_refused_instead_of_dropping_one() {
        let bytes = zip_bytes(&[
            ("Red/materials/a.vmt", b"red"),
            ("Blue/models/a.mdl", b"blue"),
        ]);
        let err = mod_content_from_archive("bundle.zip", &bytes).unwrap_err();
        assert!(
            err.message().contains("multiple peer TF2 content roots"),
            "{}",
            err.message()
        );
    }

    #[test]
    fn ids_avoid_our_own_packs_and_bump_on_collision() {
        let mut taken = BTreeSet::new();
        taken.insert("rayshud".to_string());
        assert_eq!(mod_id_from_name("My Mod (v2).zip"), "my-mod-v2");
        assert_eq!(mod_id_from_name("!!!"), "mod");
        assert_eq!(mod_id_from_name(&"x".repeat(80)).len(), MAX_MOD_ID);

        assert_eq!(unique_mod_id("rayshud", &taken), "rayshud-2");
        taken.insert("rayshud-2".to_string());
        assert_eq!(unique_mod_id("rayshud", &taken), "rayshud-3");
        // Our own namespace and mastercomfig's are never taken over.
        assert_eq!(
            unique_mod_id("execs-preloader", &BTreeSet::new()),
            "mod-execs-preloader"
        );
        assert_eq!(
            unique_mod_id("mastercomfig-base", &BTreeSet::new()),
            "mod-mastercomfig-base"
        );
    }

    #[test]
    fn installing_a_folder_pack_lands_in_the_profile_and_the_live_tree() {
        let (root, profiles, tf2, id) = setup();
        let content = ModContent::Tree(vec![
            ("materials/models/a.vmt".into(), b"vmt".to_vec()),
            ("particles/explosion.pcf".into(), b"pcf".to_vec()),
        ]);
        let detail = install_mod_to(
            &profiles,
            &tf2,
            &id,
            "Cool Effects.zip",
            content,
            ModSource::Local,
            unlocked(),
        )
        .unwrap();
        assert_eq!(detail.mods.len(), 1);
        let record = &detail.mods[0];
        assert_eq!(record.id, "cool-effects");
        assert_eq!(record.name, "Cool Effects");
        assert_eq!(record.pack, "cool-effects");
        assert_eq!(record.files, 2);
        assert_eq!(record.source, ModSource::Local);
        assert!(tf2
            .join("tf/custom/cool-effects/materials/models/a.vmt")
            .is_file());

        // The particles are offered to the preloader.
        let sources = profile_particle_sources_from(&profiles, &id).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].mod_id, "cool-effects");
        assert_eq!(sources[0].pcf_files, vec!["explosion.pcf".to_string()]);
        assert_eq!(
            read_mod_pcf(&profiles, &id, "cool-effects", "explosion.pcf")
                .unwrap()
                .as_deref(),
            Some(b"pcf".as_slice())
        );

        let detail = remove_mod_to(&profiles, &tf2, &id, "cool-effects", unlocked()).unwrap();
        assert!(detail.mods.is_empty());
        assert!(detail
            .files
            .iter()
            .all(|file| !file.path.starts_with("tf/custom/cool-effects")));
        assert!(!tf2.join("tf/custom/cool-effects").exists());
        cleanup(&root);
    }

    #[test]
    fn legacy_hud_mod_removal_clears_its_record_without_promoting_an_inactive_original() {
        const INFO: &[u8] = b"\"HUD\" { \"ui_version\" \"3\" }\n";
        for keep_original in [false, true] {
            let (root, profiles, tf2, id) = setup();
            let hud_record = crate::profile::HudRecord {
                id: "legacy-hud".into(),
                hash: None,
                source: crate::profile::HudSource::Local,
                options: BTreeMap::new(),
            };
            mutate_profile_files_to(
                &profiles,
                &tf2,
                &id,
                &[(
                    "tf/custom/legacy-hud/info.vdf".into(),
                    FileSource::Bytes(INFO),
                )],
                &[],
                ProfileLiveProjection::MirrorIfActive,
                unlocked(),
                |manifest| {
                    manifest.hud = Some(hud_record);
                    manifest.hud_selected_root = Some("legacy-hud".into());
                    manifest.mods.push(ModRecord {
                        id: "legacy-hud".into(),
                        name: "Legacy HUD".into(),
                        source: ModSource::Local,
                        pack: "legacy-hud".into(),
                        files: 1,
                        bytes: INFO.len() as u64,
                        installed_at: String::new(),
                        inactive_pack: None,
                    });
                    Ok(())
                },
            )
            .unwrap();
            if keep_original {
                mutate_profile_files_to(
                    &profiles,
                    &tf2,
                    &id,
                    &[(
                        "tf/custom/original-hud/info.vdf".into(),
                        FileSource::Bytes(INFO),
                    )],
                    &[],
                    ProfileLiveProjection::LibraryOnly,
                    unlocked(),
                    |_| Ok(()),
                )
                .unwrap();
            }
            let before = load_manifest(&profiles, &id).unwrap();
            assert_eq!(
                remove_mod_to(&profiles, &tf2, &id, "legacy-hud", ["tf_win64.exe"]).unwrap_err(),
                ProfileError::GameRunning
            );
            assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
            remove_mod_to(&profiles, &tf2, &id, "legacy-hud", unlocked()).unwrap();
            let after = load_manifest(&profiles, &id).unwrap();
            assert!(after.hud.is_none());
            assert!(after.hud_selected_root.is_none());
            assert!(after.mods.is_empty());
            assert_eq!(after.hud_review_pending, keep_original);
            assert!(!tf2.join("tf/custom/legacy-hud/info.vdf").exists());
            assert!(!tf2.join("tf/custom/original-hud/info.vdf").exists());
            if keep_original {
                assert_eq!(
                    fs::read(exclusive_file_path(
                        &profiles,
                        &id,
                        "tf/custom/original-hud/info.vdf"
                    ))
                    .unwrap(),
                    INFO
                );
                assert_eq!(
                    crate::hud::require_resolved_hud(&after).unwrap_err(),
                    ProfileError::HudReviewRequired
                );
            } else {
                crate::hud::require_resolved_hud(&after).unwrap();
            }
            cleanup(&root);
        }
    }

    #[test]
    fn selected_active_particle_source_is_not_removed_until_selection_changes() {
        let (root, profiles, tf2, id) = setup();
        let first = install_particle_mod(&profiles, &tf2, &id, "Particle source A", "a.pcf");
        let second = install_particle_mod(&profiles, &tf2, &id, "Particle source B", "b.pcf");
        save_selected_profile_mods(&profiles, &tf2, &id, &[&first.id, &second.id]);
        let snapshot = root.join("preloader/originals/sentinel");
        fs::create_dir_all(snapshot.parent().unwrap()).unwrap();
        fs::write(&snapshot, b"pristine snapshot").unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let first_live = tf2.join("tf/custom").join(&first.pack);
        let second_live = tf2.join("tf/custom").join(&second.pack);

        let err = remove_mod_to(&profiles, &tf2, &id, &first.id, unlocked()).unwrap_err();
        assert!(matches!(
            &err,
            ProfileError::ParticleSourceSelected(name) if name == "Particle source A"
        ));
        assert_eq!(err.code(), "ParticleSourceSelected");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(fs::read(&snapshot).unwrap(), b"pristine snapshot");
        assert!(first_live.exists());
        assert!(second_live.exists());

        save_selected_profile_mods(&profiles, &tf2, &id, &[&second.id]);
        let detail = remove_mod_to(&profiles, &tf2, &id, &first.id, unlocked()).unwrap();
        assert_eq!(detail.mods.len(), 1);
        assert_eq!(detail.mods[0].id, second.id);
        assert!(!first_live.exists());
        assert!(second_live.exists());
        assert_eq!(
            load_manifest(&profiles, &id)
                .unwrap()
                .preloader
                .unwrap()
                .profile_particle_mods,
            vec![second.id]
        );
        assert_eq!(fs::read(&snapshot).unwrap(), b"pristine snapshot");
        cleanup(&root);
    }

    #[test]
    fn running_game_precedes_selected_particle_source_removal_guard() {
        let (root, profiles, tf2, id) = setup();
        let record =
            install_particle_mod(&profiles, &tf2, &id, "Locked particle source", "lock.pcf");
        save_selected_profile_mods(&profiles, &tf2, &id, &[&record.id]);
        let before = load_manifest(&profiles, &id).unwrap();

        let err = remove_mod_to(&profiles, &tf2, &id, &record.id, ["tf_win64.exe"]).unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert!(tf2.join("tf/custom").join(record.pack).exists());
        cleanup(&root);
    }

    #[test]
    fn legacy_owner_marker_is_guarded_until_the_profile_selection_migrates() {
        let (root, profiles, tf2, id) = setup();
        let record =
            install_particle_mod(&profiles, &tf2, &id, "Legacy particle source", "legacy.pcf");
        assert!(load_manifest(&profiles, &id).unwrap().preloader.is_none());
        save_legacy_selected_profile_mods(&root, &id, &[&record.id]);
        let before = load_manifest(&profiles, &id).unwrap();

        let err = remove_mod_to(&profiles, &tf2, &id, &record.id, unlocked()).unwrap_err();
        assert!(matches!(
            err,
            ProfileError::ParticleSourceSelected(name) if name == "Legacy particle source"
        ));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert!(tf2.join("tf/custom").join(record.pack).exists());
        cleanup(&root);
    }

    #[test]
    fn installed_owner_selection_is_guarded_when_manifest_capture_is_stale() {
        let (root, profiles, tf2, id) = setup();
        let record = install_particle_mod(
            &profiles,
            &tf2,
            &id,
            "Interrupted capture source",
            "interrupted.pcf",
        );
        // The installed transaction committed the new selection and owner,
        // but its following profile-manifest capture did not.
        save_selected_profile_mods(&profiles, &tf2, &id, &[]);
        save_legacy_selected_profile_mods(&root, &id, &[&record.id]);
        let before = load_manifest(&profiles, &id).unwrap();
        assert!(before
            .preloader
            .as_ref()
            .unwrap()
            .profile_particle_mods
            .is_empty());

        let err = remove_mod_to(&profiles, &tf2, &id, &record.id, unlocked()).unwrap_err();
        assert!(matches!(
            err,
            ProfileError::ParticleSourceSelected(name) if name == "Interrupted capture source"
        ));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert!(tf2.join("tf/custom").join(record.pack).exists());
        cleanup(&root);
    }

    #[test]
    fn another_profiles_selected_particle_source_id_does_not_block_inactive_removal() {
        let (root, profiles, tf2, active_id) = setup();
        let inactive_id = create_profile_record_to(&profiles, &tf2, "Inactive", unlocked())
            .unwrap()
            .profiles
            .into_iter()
            .find(|profile| profile.id != active_id)
            .unwrap()
            .id;
        let inactive = install_particle_mod(
            &profiles,
            &tf2,
            &inactive_id,
            "Shared particle source",
            "inactive.pcf",
        );
        let active = install_particle_mod(
            &profiles,
            &tf2,
            &active_id,
            "Shared particle source",
            "active.pcf",
        );
        assert_eq!(inactive.id, active.id);
        save_selected_profile_mods(&profiles, &tf2, &active_id, &[&active.id]);
        let active_live = tf2.join("tf/custom").join(&active.pack);

        let detail =
            remove_mod_to(&profiles, &tf2, &inactive_id, &inactive.id, unlocked()).unwrap();
        assert!(detail.mods.is_empty());
        assert!(load_manifest(&profiles, &inactive_id)
            .unwrap()
            .mods
            .is_empty());
        assert_eq!(
            load_manifest(&profiles, &active_id).unwrap().mods,
            vec![active.clone()]
        );
        assert!(active_live.exists());
        assert_eq!(
            load_manifest(&profiles, &active_id)
                .unwrap()
                .preloader
                .unwrap()
                .profile_particle_mods,
            vec![active.id]
        );
        cleanup(&root);
    }

    #[test]
    fn inactive_profiles_own_selected_particle_source_is_not_removed() {
        let (root, profiles, tf2, active_id) = setup();
        let inactive_id = create_profile_record_to(&profiles, &tf2, "Inactive", unlocked())
            .unwrap()
            .profiles
            .into_iter()
            .find(|profile| profile.id != active_id)
            .unwrap()
            .id;
        let inactive = install_particle_mod(
            &profiles,
            &tf2,
            &inactive_id,
            "Inactive particle source",
            "inactive.pcf",
        );
        save_selected_profile_mods(&profiles, &tf2, &inactive_id, &[&inactive.id]);
        let before = load_manifest(&profiles, &inactive_id).unwrap();

        let err =
            remove_mod_to(&profiles, &tf2, &inactive_id, &inactive.id, unlocked()).unwrap_err();
        assert!(matches!(
            err,
            ProfileError::ParticleSourceSelected(name) if name == "Inactive particle source"
        ));
        assert_eq!(load_manifest(&profiles, &inactive_id).unwrap(), before);
        cleanup(&root);
    }

    #[test]
    fn loose_particle_sources_stop_at_the_pcf_limit() {
        let (root, profiles, tf2, id) = setup();
        install_mod_to(
            &profiles,
            &tf2,
            &id,
            "Bounded particles",
            ModContent::Tree(vec![("particles/test.pcf".into(), b"pcf".to_vec())]),
            ModSource::Local,
            unlocked(),
        )
        .unwrap();
        let source = exclusive_file_path(
            &profiles,
            &id,
            "tf/custom/bounded-particles/particles/test.pcf",
        );
        let file = fs::OpenOptions::new().write(true).open(&source).unwrap();
        file.set_len(MAX_PCF_BYTES as u64).unwrap();
        drop(file);
        assert_eq!(
            read_mod_pcf(&profiles, &id, "bounded-particles", "test.pcf")
                .unwrap()
                .unwrap()
                .len(),
            MAX_PCF_BYTES
        );

        let file = fs::OpenOptions::new().write(true).open(&source).unwrap();
        file.set_len(MAX_PCF_BYTES as u64 + 1).unwrap();
        drop(file);
        let err = read_mod_pcf(&profiles, &id, "bounded-particles", "test.pcf").unwrap_err();
        assert!(err.message().contains("larger"), "{}", err.message());
        cleanup(&root);
    }

    #[test]
    fn a_multi_pack_selection_is_prevalidated_before_any_write() {
        let (root, profiles, tf2, id) = setup();
        let packs = vec![
            (
                "Good".into(),
                ModContent::Tree(vec![("materials/a.vmt".into(), b"vmt".to_vec())]),
            ),
            (
                "Hostile".into(),
                ModContent::Tree(vec![(
                    "cfg/autoexec.cfg".into(),
                    b"bind mouse1 \"connect bad.example\"\n".to_vec(),
                )]),
            ),
        ];
        let err =
            install_mods_to(&profiles, &tf2, &id, packs, ModSource::Local, unlocked()).unwrap_err();
        assert!(err.message().contains("connect"), "{}", err.message());
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest.mods.is_empty());
        assert!(manifest.files.is_empty());
        assert!(!tf2.join("tf/custom/good").exists());
        cleanup(&root);
    }

    #[test]
    fn a_valid_multi_pack_selection_is_recorded_together() {
        let (root, profiles, tf2, id) = setup();
        let detail = install_mods_to(
            &profiles,
            &tf2,
            &id,
            vec![
                (
                    "Same".into(),
                    ModContent::Tree(vec![("materials/a.vmt".into(), b"a".to_vec())]),
                ),
                (
                    "Same".into(),
                    ModContent::Tree(vec![("models/b.mdl".into(), b"b".to_vec())]),
                ),
            ],
            ModSource::Local,
            unlocked(),
        )
        .unwrap();
        assert_eq!(detail.mods.len(), 2);
        assert_eq!(detail.mods[0].pack, "same");
        assert_eq!(detail.mods[1].pack, "same-2");
        assert!(tf2.join("tf/custom/same/materials/a.vmt").is_file());
        assert!(tf2.join("tf/custom/same-2/models/b.mdl").is_file());
        cleanup(&root);
    }

    #[test]
    fn a_vpk_pack_installs_as_one_file_and_lists_its_particles() {
        let (root, profiles, tf2, id) = setup();
        let mut files = BTreeMap::new();
        files.insert("particles/burningplayer.pcf".to_string(), b"pcf".to_vec());
        files.insert("materials/a.vmt".to_string(), b"vmt".to_vec());
        let detail = install_mod_to(
            &profiles,
            &tf2,
            &id,
            "Flames_dir.vpk",
            ModContent::Vpk(write_vpk_v1(&files)),
            ModSource::Gamebanana {
                id: 12345,
                url: "https://gamebanana.com/mods/12345".into(),
            },
            unlocked(),
        )
        .unwrap();
        let record = &detail.mods[0];
        assert_eq!(record.pack, "flames.vpk");
        assert_eq!(record.id, "flames");
        assert!(tf2.join("tf/custom/flames.vpk").is_file());
        let sources = profile_particle_sources_from(&profiles, &id).unwrap();
        assert_eq!(sources[0].pcf_files, vec!["burningplayer.pcf".to_string()]);
        assert_eq!(
            read_mod_pcf(&profiles, &id, "flames", "burningplayer.pcf")
                .unwrap()
                .as_deref(),
            Some(b"pcf".as_slice())
        );

        let cache = tf2.join("tf/custom/flames.vpk.sound.cache");
        fs::write(&cache, b"game cache").unwrap();
        remove_mod_to(&profiles, &tf2, &id, "flames", unlocked()).unwrap();
        assert!(!tf2.join("tf/custom/flames.vpk").exists());
        assert!(!cache.exists());
        cleanup(&root);
    }

    /// A file the user edited by hand is theirs, not ours to delete.
    #[test]
    fn remove_leaves_a_drifted_live_file_alone() {
        let (root, profiles, tf2, id) = setup();
        install_mod_to(
            &profiles,
            &tf2,
            &id,
            "Drifty",
            ModContent::Tree(vec![("materials/a.vmt".into(), b"vmt".to_vec())]),
            ModSource::Local,
            unlocked(),
        )
        .unwrap();
        let live = tf2.join("tf/custom/drifty/materials/a.vmt");
        fs::write(&live, b"user drift").unwrap();
        remove_mod_to(&profiles, &tf2, &id, "drifty", unlocked()).unwrap();
        assert_eq!(fs::read(&live).unwrap(), b"user drift");
        cleanup(&root);
    }

    #[cfg(unix)]
    #[test]
    fn live_mod_writes_and_removals_refuse_linked_parents() {
        use std::os::unix::fs::symlink;

        let (root, profiles, tf2, id) = setup();
        let before_install = load_manifest(&profiles, &id).unwrap();
        let custom = tf2.join("tf/custom");
        let outside_write = root.join("outside-write");
        fs::create_dir_all(&outside_write).unwrap();
        fs::remove_dir(&custom).unwrap();
        symlink(&outside_write, &custom).unwrap();

        let err = install_mod_to(
            &profiles,
            &tf2,
            &id,
            "Linked",
            ModContent::Tree(vec![("materials/a.vmt".into(), b"new".to_vec())]),
            ModSource::Local,
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("link"), "{err:?}");
        assert!(!outside_write.join("linked/materials/a.vmt").exists());
        let after_install = load_manifest(&profiles, &id).unwrap();
        assert_eq!(after_install.files, before_install.files);
        assert_eq!(after_install.mods, before_install.mods);

        fs::remove_file(&custom).unwrap();
        fs::create_dir_all(&custom).unwrap();
        install_mod_to(
            &profiles,
            &tf2,
            &id,
            "Linked removal",
            ModContent::Tree(vec![("materials/a.vmt".into(), b"owned".to_vec())]),
            ModSource::Local,
            unlocked(),
        )
        .unwrap();
        let live_pack = custom.join("linked-removal");
        fs::remove_dir_all(&live_pack).unwrap();
        let outside_remove = root.join("outside-remove");
        fs::create_dir_all(outside_remove.join("materials")).unwrap();
        fs::write(outside_remove.join("materials/a.vmt"), b"owned").unwrap();
        symlink(&outside_remove, &live_pack).unwrap();

        let before_remove = load_manifest(&profiles, &id).unwrap();
        let err = remove_mod_to(&profiles, &tf2, &id, "linked-removal", unlocked()).unwrap_err();
        assert!(err.message().contains("link"), "{err:?}");
        assert_eq!(
            fs::read(outside_remove.join("materials/a.vmt")).unwrap(),
            b"owned"
        );
        let after_remove = load_manifest(&profiles, &id).unwrap();
        assert_eq!(after_remove.files, before_remove.files);
        assert_eq!(after_remove.mods, before_remove.mods);
        cleanup(&root);
    }

    #[test]
    fn a_second_mod_of_the_same_name_gets_its_own_pack() {
        let (root, profiles, tf2, id) = setup();
        for _ in 0..2 {
            install_mod_to(
                &profiles,
                &tf2,
                &id,
                "Twins",
                ModContent::Tree(vec![("materials/a.vmt".into(), b"vmt".to_vec())]),
                ModSource::Local,
                unlocked(),
            )
            .unwrap();
        }
        let manifest = load_manifest(&profiles, &id).unwrap();
        let packs: Vec<&str> = manifest
            .mods
            .iter()
            .map(|record| record.pack.as_str())
            .collect();
        assert_eq!(packs, vec!["twins", "twins-2"]);
        cleanup(&root);
    }

    #[test]
    fn install_refuses_while_tf2_is_running() {
        let (root, profiles, tf2, id) = setup();
        let running = if cfg!(windows) {
            "tf_win64.exe"
        } else {
            "tf_linux64"
        };
        let err = install_mod_to(
            &profiles,
            &tf2,
            &id,
            "Nope",
            ModContent::Tree(vec![("materials/a.vmt".into(), b"vmt".to_vec())]),
            ModSource::Local,
            [running],
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        cleanup(&root);
    }

    #[test]
    fn the_source_is_tagged_json_the_frontend_can_switch_on() {
        let json = serde_json::to_value(ModSource::Local).unwrap();
        assert_eq!(json["kind"], "local");
        let json = serde_json::to_value(ModSource::Gamebanana {
            id: 7,
            url: "https://gamebanana.com/mods/7".into(),
        })
        .unwrap();
        assert_eq!(json["kind"], "gamebanana");
        assert_eq!(json["id"], 7);
        assert_eq!(json["url"], "https://gamebanana.com/mods/7");

        let record = ModRecord {
            id: "a".into(),
            name: "A".into(),
            source: ModSource::Local,
            pack: "a".into(),
            files: 1,
            bytes: 2,
            installed_at: "2026-09-02T00:00:00Z".into(),
            inactive_pack: None,
        };
        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["installedAt"], "2026-09-02T00:00:00Z");
    }
}
