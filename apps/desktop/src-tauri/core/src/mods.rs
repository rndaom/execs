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
    validate_vpk_dir_bytes,
};

/// One pack's ceiling, and the ceiling on a whole archive: a mod is held in
/// memory while it is read and copied, and nothing legitimate on GameBanana
/// comes close.
pub const MAX_MOD_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MOD_ENTRIES: usize = 20_000;

const MOD_LIMITS: ArchiveLimits = ArchiveLimits::new(MAX_MOD_ENTRIES, MAX_MOD_BYTES, MAX_MOD_BYTES);

/// Longest `tf/custom` folder name this app will mint for a mod.
const MAX_MOD_ID: usize = 48;

/// Top-level folders that make a directory a TF2 content root. `cfg` and
/// `resource` are here too: a pack that is really a HUD or a config still
/// installs, it is just named after the archive rather than after its content.
pub const MOD_CONTENT_ROOTS: [&str; 8] = [
    "materials",
    "models",
    "sound",
    "particles",
    "scripts",
    "resource",
    "cfg",
    "maps",
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
    /// Installed from GameBanana; `url` is the mod's profile page, so the UI
    /// can always send the user back to the author.
    Gamebanana { id: u64, url: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRecord {
    /// Sanitized id, unique within the profile; also the pack's folder name.
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
}

// ---------------------------------------------------------------------------
// Reading a mod out of what the user handed over
// ---------------------------------------------------------------------------

/// Every pack an archive holds. An archive carrying VPKs yields one pack per
/// VPK (a "pack of packs" is how most GameBanana skin bundles ship); anything
/// else is one loose-file pack rooted at its shallowest content folder.
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
        refuse_multi_part(vpk_names.into_iter())?;
        return Ok(entries
            .into_iter()
            .filter(|(rel, _)| has_extension(rel, "vpk"))
            .map(|(rel, bytes)| (vpk_pack_name(&rel), ModContent::Vpk(bytes)))
            .collect());
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
        return Err(ProfileError::Io(format!(
            "That VPK is larger than {} MiB; refusing to install it.",
            MAX_MOD_BYTES / (1024 * 1024)
        )));
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
    if candidates.len() > 1 {
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
    let mut taken = taken_pack_identities(tf2_root, &manifest);
    let mut planned = Vec::with_capacity(packs.len());
    let mut selection_budget = ModBatchBudget::default();
    let mut aggregate_paths = BTreeSet::new();

    for (name, content) in packs {
        selection_budget.add(&content)?;

        let display = display_name(&name);
        let id = unique_mod_id(&mod_id_from_name(&display), &taken);
        taken.insert(pack_identity(&id));

        let (pack, files) = match content {
            ModContent::Vpk(bytes) => {
                validate_vpk_dir_bytes(&bytes).map_err(|err| ProfileError::Io(err.message()))?;
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
    Ok(detail_from_manifest(&manifest))
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

    let paths: Vec<String> = pack_files(&manifest, &record.pack)
        .into_iter()
        .map(|file| file.path)
        .collect();
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
            Ok(())
        },
    )?;
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() == Some(profile_id) {
        for path in &paths {
            prune_empty_parents(&live_path(tf2_root, path), tf2_root);
        }
    }
    Ok(detail_from_manifest(&manifest))
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

    fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
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
    fn an_archive_of_vpks_becomes_one_pack_per_vpk() {
        let mut files = BTreeMap::new();
        files.insert("materials/a.vmt".to_string(), b"vmt".to_vec());
        let vpk = write_vpk_v1(&files);
        let bytes = zip_bytes(&[
            ("pack/Red Scout.vpk", &vpk),
            ("pack/Blue Scout_dir.vpk", &vpk),
            ("pack/readme.txt", b"hi"),
        ]);
        let packs = mod_content_from_archive("scouts.zip", &bytes).unwrap();
        let names: Vec<&str> = packs.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, vec!["Red Scout", "Blue Scout"]);
        assert!(packs
            .iter()
            .all(|(_, content)| matches!(content, ModContent::Vpk(_))));

        // A split set is refused rather than half-installed.
        let split = zip_bytes(&[("pack/big_dir.vpk", &vpk), ("pack/big_000.vpk", &vpk)]);
        let err = mod_content_from_archive("big.zip", &split).unwrap_err();
        assert!(err.message().contains("multi-part"), "{}", err.message());

        // A numbered name with no `_dir.vpk` beside it is an ordinary pack.
        let numbered = zip_bytes(&[("pack/skin_001.vpk", &vpk), ("pack/skin_002.vpk", &vpk)]);
        let packs = mod_content_from_archive("skins.zip", &numbered).unwrap();
        let names: Vec<&str> = packs.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, vec!["skin_001", "skin_002"]);
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

        remove_mod_to(&profiles, &tf2, &id, "flames", unlocked()).unwrap();
        assert!(!tf2.join("tf/custom/flames.vpk").exists());
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
        };
        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["installedAt"], "2026-09-02T00:00:00Z");
    }
}
