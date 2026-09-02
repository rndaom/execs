//! Mods the user brings in themselves: skins, effects, sound packs — anything
//! that lives as one top-level `tf/custom` pack.
//!
//! A mod's files are ordinary profile files, so switching, export/import and
//! absorb already carry them with no special case. What this module adds is the
//! way in (an archive, a folder, a bare VPK), the record that names the pack,
//! the way back out, and the list of particle files a mod offers the preloader.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::absorb::pack_key;
use crate::apply::{detail_from_manifest, ProfileDetail};
use crate::archive::{extract_archive, read_dir_entries, ArchiveLimits};
use crate::hash::{sha256_file, write_atomic};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, is_file_safe_rel_path, load_library_from, load_manifest, profiles_dir,
    put_profile_files_to, remove_manifest_files_to, save_manifest, utc_rfc3339, FileSource,
    ProfileError, ProfileFile, ProfileManifest,
};
use crate::switch::{only_game_caches, prune_empty_parents};
use crate::vpk::{read_vpk_dir_bytes, read_vpk_dir_file_filtered};

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

impl ModContent {
    fn file_count(&self) -> usize {
        match self {
            Self::Vpk(_) => 1,
            Self::Tree(entries) => entries.len(),
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

    let vpks: Vec<&(String, Vec<u8>)> = entries
        .iter()
        .filter(|(rel, _)| has_extension(rel, "vpk"))
        .collect();
    if !vpks.is_empty() {
        refuse_multi_part(vpks.iter().map(|(rel, _)| rel.as_str()))?;
        return Ok(vpks
            .into_iter()
            .map(|(rel, bytes)| (vpk_pack_name(rel), ModContent::Vpk(bytes.clone())))
            .collect());
    }

    let Some(root) = content_root(&entries, usize::MAX) else {
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
    let Some(root) = content_root(&entries, 1) else {
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
    let meta = path
        .metadata()
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    if meta.len() > MAX_MOD_BYTES {
        return Err(ProfileError::Io(format!(
            "That VPK is larger than {} MiB; refusing to install it.",
            MAX_MOD_BYTES / (1024 * 1024)
        )));
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if let Some(prefix) = name
        .to_ascii_lowercase()
        .strip_suffix("_dir.vpk")
        .map(str::to_string)
    {
        let parent = path.parent().unwrap_or(Path::new("."));
        if parent.join(format!("{prefix}_000.vpk")).is_file() {
            return Err(ProfileError::Io(MULTI_PART_VPK.into()));
        }
    }
    let bytes = fs::read(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    read_vpk_dir_bytes(&bytes).map_err(|err| ProfileError::Io(err.message()))?;
    Ok((vpk_pack_name(&name), ModContent::Vpk(bytes)))
}

const NO_TF2_CONTENT: &str =
    "That archive has no TF2 content (no materials, models, sound, particles or scripts folder).";

const MULTI_PART_VPK: &str =
    "That is a multi-part VPK (a _dir.vpk with _000.vpk siblings), which this app cannot install as one pack. Unpack it first, or install the folder version.";

/// The shallowest folder that directly holds a content root, as a prefix
/// (`""` when the archive is already rooted there). `max_depth` bounds how many
/// wrapper folders may sit above it.
fn content_root(entries: &[(String, Vec<u8>)], max_depth: usize) -> Option<String> {
    let mut best: Option<(usize, String)> = None;
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
            let candidate = (depth, parts[..depth].join("/"));
            match &best {
                Some(current) if *current <= candidate => {}
                _ => best = Some(candidate),
            }
            break;
        }
    }
    best.map(|(_, prefix)| prefix)
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

fn refuse_multi_part<'a>(names: impl Iterator<Item = &'a str>) -> Result<(), ProfileError> {
    for name in names {
        let file = name.rsplit('/').next().unwrap_or(name).to_ascii_lowercase();
        let Some(stem) = file.strip_suffix(".vpk") else {
            continue;
        };
        let Some((_, tail)) = stem.rsplit_once('_') else {
            continue;
        };
        if tail.len() == 3 && tail.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(ProfileError::Io(MULTI_PART_VPK.into()));
        }
    }
    Ok(())
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
    install_mod_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        name,
        content,
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
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    if content.file_count() == 0 {
        return Err(ProfileError::Io("That mod has no files.".into()));
    }

    let manifest = load_manifest(profiles_dir, profile_id)?;
    let display = display_name(name);
    let id = unique_mod_id(
        &mod_id_from_name(&display),
        &taken_pack_identities(tf2_root, &manifest),
    );

    let (pack, files) = match content {
        ModContent::Vpk(bytes) => {
            read_vpk_dir_bytes(&bytes).map_err(|err| ProfileError::Io(err.message()))?;
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

    let bytes_total: u64 = files.iter().map(|(_, bytes)| bytes.len() as u64).sum();
    if bytes_total > MAX_MOD_BYTES {
        return Err(ProfileError::Io(format!(
            "That mod is larger than {} MiB; refusing to install it.",
            MAX_MOD_BYTES / (1024 * 1024)
        )));
    }
    for (rel, _) in &files {
        if !is_file_safe_rel_path(rel) {
            return Err(ProfileError::ForbiddenPath(rel.clone()));
        }
    }

    // One batched manifest/index write for the whole pack instead of one per
    // file; the record below is a second, small write.
    let batch: Vec<(String, FileSource<'_>)> = files
        .iter()
        .map(|(rel, bytes)| (rel.clone(), FileSource::Bytes(bytes.as_slice())))
        .collect();
    put_profile_files_to(profiles_dir, tf2_root, profile_id, &batch, &running)?;
    copy_to_live_if_active(profiles_dir, tf2_root, profile_id, &files)?;

    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.mods.push(ModRecord {
        name: if display.is_empty() {
            id.clone()
        } else {
            display
        },
        id,
        source,
        pack,
        files: files.len(),
        bytes: bytes_total,
        installed_at: utc_rfc3339(),
    });
    save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
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

    let files = pack_files(&manifest, &record.pack);
    remove_live_pack_files(profiles_dir, tf2_root, profile_id, &record.pack, &files)?;
    let paths: Vec<String> = files.iter().map(|file| file.path.clone()).collect();
    if !paths.is_empty() {
        remove_manifest_files_to(profiles_dir, tf2_root, profile_id, &paths, &running)?;
    }

    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.mods.retain(|entry| entry.id != id);
    save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
}

fn pack_files(manifest: &ProfileManifest, pack: &str) -> Vec<ProfileFile> {
    let exact = format!("tf/custom/{pack}");
    let prefix = format!("tf/custom/{pack}/");
    manifest
        .files
        .iter()
        .filter(|file| file.path == exact || file.path.starts_with(&prefix))
        .cloned()
        .collect()
}

fn live_path(tf2_root: &Path, rel: &str) -> PathBuf {
    let mut path = tf2_root.to_path_buf();
    for part in rel.split('/') {
        path.push(part);
    }
    path
}

fn copy_to_live_if_active(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    files: &[(String, Vec<u8>)],
) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() != Some(profile_id) {
        return Ok(());
    }
    for (rel, bytes) in files {
        let dest = live_path(tf2_root, rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|err| ProfileError::Io(err.to_string()))?;
        }
        write_atomic(&dest, bytes).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

/// Take the pack out of the live folder the way a profile switch does: only
/// files whose bytes still hash to what the profile recorded, so a file the
/// user edited by hand is left where it is rather than silently discarded.
fn remove_live_pack_files(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    pack: &str,
    files: &[ProfileFile],
) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() != Some(profile_id) {
        return Ok(());
    }
    for file in files {
        for candidate in live_candidates(tf2_root, &file.path) {
            if !candidate.is_file() {
                continue;
            }
            let hash = sha256_file(&candidate).map_err(|err| ProfileError::Io(err.to_string()))?;
            if hash != file.sha256 {
                continue;
            }
            fs::remove_file(&candidate).map_err(|err| ProfileError::Io(err.to_string()))?;
            prune_empty_parents(&candidate, tf2_root);
        }
    }
    // TF2 drops a `sound.cache` into every folder it scans, so an emptied pack
    // folder is a husk holding one regenerable file.
    for name in [pack.to_string(), format!("-{pack}")] {
        let dir = tf2_root.join("tf").join("custom").join(name);
        if dir.is_dir() && only_game_caches(&dir) {
            let _ = fs::remove_dir_all(&dir);
        }
    }
    Ok(())
}

fn live_candidates(tf2_root: &Path, rel: &str) -> Vec<PathBuf> {
    let mut out = vec![live_path(tf2_root, rel)];
    if let Some(rest) = rel.strip_prefix("tf/custom/") {
        if !rest.starts_with('-') {
            out.push(live_path(tf2_root, &format!("tf/custom/-{rest}")));
        }
    }
    out
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
    let archive = read_vpk_dir_file_filtered(&source, &|entry| is_root_particle(entry))
        .map_err(|err| ProfileError::Io(err.message()))?;
    let mut names: Vec<String> = archive
        .files
        .keys()
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
        return match fs::read(&source) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(_) => Ok(None),
        };
    }
    let source = exclusive_file_path(
        profiles_dir,
        profile_id,
        &format!("tf/custom/{}", record.pack),
    );
    if !source.is_file() {
        return Ok(None);
    }
    let wanted = format!("particles/{pcf}");
    let archive = read_vpk_dir_file_filtered(&source, &|entry| entry == wanted)
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
