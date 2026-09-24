//! Versioned profile zip export/import. Library only — never writes live TF2.

use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::Digest;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::archive::{
    read_regular_file_bounded, validate_exported_cfg, validate_exported_launch_options,
    validate_imported_cfg, validate_imported_launch_options, MAX_IMPORTED_CFG_BYTES,
};
use crate::blob::blob_path;
use crate::hash::{
    create_dir_all_within, create_new_file_within, metadata_is_link, random_token,
    remove_tree_within, replace_file, sha256_file, sha256_hex, sha256_reader, validate_file_within,
};
use crate::launch::sanitize_launch_options;
use crate::mods::{ModRecord, ModSource};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    create_populated_profile_to, exclusive_file_path, is_profile_ownable_rel_path,
    is_shared_rel_path, load_library_from, load_manifest, normalize_rel_path, portable_path_key,
    profiles_dir, CrosshairRecord, FileSource, FileStorage, HudRecord, ProfileError, ProfileFile,
    ProfileLibrary, ProfileManifest, ViewmodelRecord,
};
use crate::vpk::read_vpk_file_filtered_hashed;

mod creator;
pub use creator::{import_reviewed_profile, inspect_profile_import, ProfileImportReview};

pub const ZIP_SCHEMA: u32 = 1;
pub const ZIP_MANIFEST_NAME: &str = "execs-profile.json";

/// Import ceilings. A profile zip is a mastercomfig layer plus a HUD plus
/// skins; anything past these is a deflate bomb or a mistake, and reading one
/// unchecked OOM-kills the app before a single byte is validated.
const MAX_TOTAL_UNCOMPRESSED: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED: u64 = 1024 * 1024 * 1024;
/// Real game content does not deflate anywhere near this well.
const MAX_COMPRESSION_RATIO: u64 = 200;
// Small neutral textures can legitimately compress beyond 200x. Match the
// bounded floor used by HUD/mod archives; byte ceilings still apply, and the
// aggregate check below prevents many small entries from bypassing the ratio.
const COMPRESSION_RATIO_FLOOR: u64 = 8 * 1024 * 1024;
/// The manifest is the one entry we keep in memory.
const MAX_MANIFEST_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PROFILE_ZIP_ENTRIES: usize = 40_001;
const MAX_PROFILE_FILES: usize = 20_000;
const MAX_PROFILE_PATH_BYTES: usize = 8 * 1024 * 1024;
const MAX_PROFILE_PATH_DEPTH: usize = 64;
const MAX_PROFILE_NAME_CHARS: usize = 128;
const MAX_LAUNCH_OPTIONS_BYTES: usize = 64 * 1024;
/// Streamed entries land here, next to the library, and are removed on the way
/// out whether the import succeeded or not.
const IMPORT_STAGING_DIR: &str = ".import-staging";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileZipManifest {
    schema: u32,
    name: String,
    #[serde(default)]
    launch_options: String,
    files: Vec<ProfileFile>,
    /// Accepted for schema-1 compatibility, but never emitted: neither value
    /// is meaningful on the recipient's machine.
    #[serde(default, skip_serializing)]
    id: Option<String>,
    #[serde(default, skip_serializing)]
    tf2_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hud: Option<HudRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hud_selected_root: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    hud_review_pending: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    crosshair: Option<CrosshairRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    viewmodel: Option<ViewmodelRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hitsound: Option<crate::hitsound::HitsoundRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    mods: Vec<ModRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    preloader: Option<crate::preloader::PreloaderSelection>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    ignored_packs: Vec<String>,
}

/// Entries are streamed to `staging` rather than held in RAM: a 200 MB profile
/// (mastercomfig + a HUD + skins is normal) would otherwise need ~400 MB
/// resident, and a crafted archive as much as it liked.
struct ZipPayload {
    manifest: ProfileZipManifest,
    exclusive: HashMap<String, PathBuf>,
    blobs: HashMap<String, PathBuf>,
    creator: bool,
    skipped_files: usize,
    import_notes: Vec<String>,
}

/// Removes the staging tree when the import returns, however it returns.
#[derive(Debug)]
struct StagingDir {
    root: PathBuf,
    path: PathBuf,
}

struct ExportTemp {
    path: PathBuf,
    persisted: bool,
}

impl Drop for ExportTemp {
    fn drop(&mut self) {
        if !self.persisted {
            let _ = fs::remove_file(&self.path);
        }
    }
}

impl StagingDir {
    fn create(profiles_dir: &Path) -> Result<Self, ProfileError> {
        let path = profiles_dir.join(IMPORT_STAGING_DIR);
        create_dir_all_within(profiles_dir, &path).map_err(io_err)?;
        remove_tree_within(profiles_dir, &path).map_err(io_err)?;
        create_dir_all_within(profiles_dir, &path).map_err(io_err)?;
        Ok(Self {
            root: profiles_dir.to_path_buf(),
            path,
        })
    }
}

impl Drop for StagingDir {
    fn drop(&mut self) {
        let _ = remove_tree_within(&self.root, &self.path);
    }
}

enum ZipRole {
    Manifest,
    Exclusive(String),
    Blob(String),
}

pub fn export_profile(
    tf2_root: &Path,
    profile_id: &str,
    zip_path: &Path,
) -> Result<(), ProfileError> {
    export_profile_to(&profiles_dir(), tf2_root, profile_id, zip_path)
}

/// Read-only disclosure before the user chooses an export destination. Values
/// never leave the core. Export revalidates every source when it writes the ZIP.
pub fn inspect_profile_export_credentials(
    tf2_root: &Path,
    profile_id: &str,
) -> Result<Vec<String>, ProfileError> {
    inspect_profile_export_credentials_from(&profiles_dir(), tf2_root, profile_id)
}

pub fn inspect_profile_export_credentials_from(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
) -> Result<Vec<String>, ProfileError> {
    let library = require_usable_library(profiles_dir, tf2_root)?;
    if !library
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    let manifest = load_manifest(profiles_dir, profile_id)?;
    validate_exported_launch_options(&manifest.launch_options)?;
    let mut locations = Vec::new();
    if manifest
        .launch_options
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_'))
        .any(|word| {
            matches!(
                word.to_ascii_lowercase().as_str(),
                "password" | "rcon_password" | "sv_password"
            )
        })
    {
        locations
            .push("Launch options may contain a saved password or remote-console setting.".into());
    }
    for entry in validated_export_files(&manifest)? {
        if !has_extension(&entry.path, "cfg") && !has_extension(&entry.path, "vpk") {
            continue;
        }
        let source_path = match entry.storage {
            FileStorage::Exclusive => exclusive_file_path(profiles_dir, profile_id, &entry.path),
            FileStorage::Shared => blob_path(profiles_dir, &entry.sha256),
        };
        let (mut source, len) =
            open_verified_source(profiles_dir, &source_path, &entry.sha256, &entry.path)?;
        if let Some(bytes) =
            read_validated_export_cfg_source(&entry.path, &mut source, len, &entry.sha256)?
        {
            for line in crate::archive::cfg_credential_lines(&entry.path, &bytes) {
                locations.push(format!("{}:{line}", entry.path));
            }
        } else if has_extension(&entry.path, "vpk") {
            source.rewind().map_err(io_err)?;
            let mut signature = [0u8; 4];
            if source.read_exact(&mut signature).is_ok()
                && signature == 0x55aa_1234u32.to_le_bytes()
            {
                source.rewind().map_err(io_err)?;
                let (cfgs, hash) = read_vpk_file_filtered_hashed(
                    &mut source,
                    &|path| has_extension(path, "cfg"),
                    MAX_IMPORTED_CFG_BYTES as u64,
                )
                .map_err(|err| {
                    invalid_zip(format!(
                        "invalid profile VPK {}: {}",
                        entry.path,
                        err.message()
                    ))
                })?;
                if !hash.eq_ignore_ascii_case(&entry.sha256) {
                    return Err(ProfileError::Io(format!(
                        "{} changed during export review.",
                        entry.path
                    )));
                }
                for (cfg_path, bytes) in cfgs.files {
                    let path = format!("{}/{cfg_path}", entry.path);
                    for line in crate::archive::cfg_credential_lines(&path, &bytes) {
                        locations.push(format!("{path}:{line}"));
                    }
                }
            }
        }
        if locations.len() >= 50 {
            locations.truncate(50);
            locations.push("Additional locations were omitted from this review.".into());
            break;
        }
    }
    Ok(locations)
}

pub fn import_profile(tf2_root: &Path, zip_path: &Path) -> Result<ProfileLibrary, ProfileError> {
    import_profile_from(&profiles_dir(), tf2_root, zip_path, live_process_names())
}

/// Suggested save-dialog name. Export is a library read and ignores write-lock.
pub fn safe_zip_file_name(name: &str) -> String {
    let mut out = String::new();
    for ch in name.trim().chars() {
        if ch.is_control() || "/\\:*?\"<>|".contains(ch) {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    let out = out.trim_matches(|c| c == '-' || c == ' ' || c == '.');
    if out.is_empty() {
        "profile.zip".into()
    } else {
        format!("{out}.zip")
    }
}

/// Copy a library profile into a versioned zip. Does not write live TF2, and
/// does not mutate the library, so it takes no write lock.
pub fn export_profile_to(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    zip_path: &Path,
) -> Result<(), ProfileError> {
    let library = require_usable_library(profiles_dir, tf2_root)?;
    if !library
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    if let Some(selection) = crate::preloader::selection_for_export(profiles_dir, profile_id)? {
        manifest.preloader = Some(selection);
    }
    write_profile_zip(profiles_dir, profile_id, &manifest, zip_path)
}

/// Import a versioned zip as a new library profile. Does not set `activeProfileId`
/// and does not write live TF2. Write-lock applies.
pub fn import_profile_from<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    zip_path: &Path,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    import_profile_with_review(profiles_dir, tf2_root, zip_path, running_names, None)
}

fn import_profile_with_review<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    zip_path: &Path,
    running_names: I,
    review: Option<&ProfileImportReview>,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;

    let existing = load_library_from(profiles_dir, Some(tf2_root))?;
    if existing.root_mismatch {
        return Err(root_mismatch(&existing, tf2_root));
    }

    let staging = StagingDir::create(profiles_dir)?;
    let mut payload = read_import_zip(zip_path, profiles_dir, &staging.path, review)?;
    creator::seed_default_config(&mut payload, tf2_root, profiles_dir, &staging.path)?;
    let trust_creator = payload.creator && review.is_some_and(|review| review.creator);
    validate_payload_with_trust(&mut payload, trust_creator)?;
    let hud_roots = creator::payload_huds(&payload)?;
    let selected_hud = if hud_roots.len() > 1 {
        review
            .and_then(|review| review.selected_hud.clone())
            .ok_or(ProfileError::HudReviewRequired)
            .map(Some)?
    } else {
        hud_roots.first().cloned()
    };
    if selected_hud
        .as_ref()
        .is_some_and(|selected| !hud_roots.contains(selected))
    {
        return Err(invalid_zip(
            "The selected HUD is not part of the reviewed archive.",
        ));
    }
    let hud_review_pending =
        creator::hud_options_need_review(&payload, &hud_roots, selected_hud.as_deref())?;
    if let Some(folder) = &selected_hud {
        let keep_record = payload.manifest.hud_selected_root.as_deref() == Some(folder)
            || payload
                .manifest
                .hud
                .as_ref()
                .is_some_and(|record| record.id.eq_ignore_ascii_case(folder));
        if !keep_record && !hud_review_pending {
            payload.manifest.hud = Some(HudRecord {
                id: crate::hud::hud_id_from_name(folder),
                hash: None,
                source: crate::profile::HudSource::Local,
                options: std::collections::BTreeMap::new(),
            });
        }
    }

    let mut batch: Vec<(String, FileSource<'_>)> = Vec::with_capacity(payload.manifest.files.len());
    for file in &payload.manifest.files {
        let path = normalize_rel_path(&file.path)?;
        let staged = match file.storage {
            FileStorage::Exclusive => payload.exclusive.get(&path),
            FileStorage::Shared => payload.blobs.get(&file.sha256.to_ascii_lowercase()),
        }
        .ok_or_else(|| invalid_zip(format!("missing staged payload for {path}")))?;
        let expected_len = fs::metadata(staged).map_err(io_err)?.len();
        batch.push((
            path,
            FileSource::PathExact {
                path: staged,
                expected_len,
            },
        ));
    }
    let launch = sanitize_launch_options(&payload.manifest.launch_options);
    let hud = payload.manifest.hud.clone();
    let crosshair = payload.manifest.crosshair.clone();
    let viewmodel = payload.manifest.viewmodel.clone();
    let hitsound = payload.manifest.hitsound.clone();
    let mods = payload.manifest.mods.clone();
    let preloader = payload.manifest.preloader.clone().unwrap_or_default();
    let ignored_packs = payload.manifest.ignored_packs.clone();
    create_populated_profile_to(
        profiles_dir,
        tf2_root,
        &payload.manifest.name,
        &batch,
        false,
        &running,
        move |manifest| {
            manifest.launch_options = launch;
            // An imported library has never been projected into this
            // machine's Steam config, regardless of any sender-side state.
            manifest.launch_sync_pending = true;
            manifest.hud = hud;
            manifest.hud_roots = Some(hud_roots);
            manifest.hud_selected_root = selected_hud;
            manifest.hud_review_pending = hud_review_pending;
            manifest.crosshair = crosshair;
            manifest.viewmodel = viewmodel;
            manifest.hitsound = hitsound;
            manifest.mods = mods;
            manifest.preloader = Some(preloader);
            manifest.ignored_packs = ignored_packs;
            Ok(())
        },
    )
}

fn write_profile_zip(
    profiles_dir: &Path,
    profile_id: &str,
    manifest: &ProfileManifest,
    zip_path: &Path,
) -> Result<(), ProfileError> {
    if let Some(parent) = zip_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(io_err)?;
        }
    }
    validate_export_destination(profiles_dir, zip_path)?;
    validate_exported_launch_options(&manifest.launch_options)?;
    let export_files = validated_export_files(manifest)?;

    let mut zip_manifest = ProfileZipManifest {
        schema: ZIP_SCHEMA,
        name: manifest.name.clone(),
        launch_options: manifest.launch_options.clone(),
        files: export_files.clone(),
        id: None,
        tf2_root: None,
        hud: manifest.hud.clone(),
        hud_selected_root: manifest.hud_selected_root.clone(),
        hud_review_pending: manifest.hud_review_pending,
        crosshair: manifest.crosshair.clone(),
        viewmodel: manifest.viewmodel.clone(),
        hitsound: manifest.hitsound.clone(),
        mods: manifest.mods.clone(),
        preloader: manifest.preloader.clone(),
        ignored_packs: manifest.ignored_packs.clone(),
    };
    make_metadata_portable(&mut zip_manifest);

    let parent = zip_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = zip_path
        .file_name()
        .ok_or_else(|| ProfileError::Io("Choose a file name for the export.".into()))?
        .to_string_lossy();
    let temp_path = parent.join(format!(".{file_name}.{}.execs-part", random_token()));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(io_err)?;
    let mut temp = ExportTemp {
        path: temp_path,
        persisted: false,
    };
    let mut zip = ZipWriter::new(file);
    let options = file_options();

    let json = serde_json::to_string_pretty(&zip_manifest).map_err(json_err)?;
    if json.len() as u64 + 1 > MAX_MANIFEST_BYTES {
        return Err(ProfileError::Io(
            "This profile's metadata is too large to export.".into(),
        ));
    }
    zip.start_file(ZIP_MANIFEST_NAME, options).map_err(zip_io)?;
    zip.write_all(format!("{json}\n").as_bytes())
        .map_err(io_err)?;

    let mut written_blobs = HashSet::new();
    let mut total = json.len() as u64 + 1;
    for entry in &export_files {
        match entry.storage {
            FileStorage::Exclusive => {
                let source = exclusive_file_path(profiles_dir, profile_id, &entry.path);
                let (mut source, len) =
                    open_verified_source(profiles_dir, &source, &entry.sha256, &entry.path)?;
                charge_export_bytes(&mut total, len, &entry.path)?;
                let cfg =
                    read_validated_export_cfg_source(&entry.path, &mut source, len, &entry.sha256)?;
                zip.start_file(format!("files/{}", entry.path), options)
                    .map_err(zip_io)?;
                if let Some(bytes) = cfg {
                    zip.write_all(&bytes).map_err(io_err)?;
                } else {
                    copy_into_zip_verified(&mut source, &mut zip, len, &entry.sha256, &entry.path)?;
                }
            }
            FileStorage::Shared => {
                if !written_blobs.insert(entry.sha256.clone()) {
                    continue;
                }
                let source = blob_path(profiles_dir, &entry.sha256);
                let (mut source, len) =
                    open_verified_source(profiles_dir, &source, &entry.sha256, &entry.path)?;
                charge_export_bytes(&mut total, len, &entry.path)?;
                let cfg =
                    read_validated_export_cfg_source(&entry.path, &mut source, len, &entry.sha256)?;
                zip.start_file(format!("blobs/{}", entry.sha256), options)
                    .map_err(zip_io)?;
                if let Some(bytes) = cfg {
                    zip.write_all(&bytes).map_err(io_err)?;
                } else {
                    copy_into_zip_verified(&mut source, &mut zip, len, &entry.sha256, &entry.path)?;
                }
            }
        }
    }

    let output = zip.finish().map_err(zip_io)?;
    output.sync_all().map_err(io_err)?;
    refuse_symlink_destination(zip_path)?;
    replace_file(&temp.path, zip_path).map_err(io_err)?;
    temp.persisted = true;
    Ok(())
}

fn read_profile_zip(
    zip_path: &Path,
    staging_root: &Path,
    staging: &Path,
) -> Result<ZipPayload, ProfileError> {
    read_import_zip(zip_path, staging_root, staging, None)
}

fn read_import_zip(
    zip_path: &Path,
    staging_root: &Path,
    staging: &Path,
    review: Option<&ProfileImportReview>,
) -> Result<ZipPayload, ProfileError> {
    let file = fs::File::open(zip_path).map_err(io_err)?;
    let archive_bytes = file.metadata().map_err(io_err)?.len();
    let mut file = file;
    if let Some(review) = review {
        if sha256_reader(&mut file).map_err(io_err)? != review.sha256 {
            return Err(invalid_zip(
                "The ZIP changed after review. Choose it again.",
            ));
        }
        file.rewind().map_err(io_err)?;
    }
    let mut verification = file.try_clone().map_err(io_err)?;
    let archive = ZipArchive::new(file).map_err(zip_invalid)?;
    let payload = read_zip_payload(archive, zip_path, staging_root, staging, archive_bytes)?;
    if let Some(review) = review {
        verification.rewind().map_err(io_err)?;
        if sha256_reader(&mut verification).map_err(io_err)? != review.sha256 {
            return Err(invalid_zip(
                "The ZIP changed during import. Choose it again.",
            ));
        }
    }
    Ok(payload)
}

fn read_zip_payload(
    mut archive: ZipArchive<fs::File>,
    zip_path: &Path,
    staging_root: &Path,
    staging: &Path,
    archive_bytes: u64,
) -> Result<ZipPayload, ProfileError> {
    if archive.len() > MAX_PROFILE_ZIP_ENTRIES {
        return Err(invalid_zip(format!(
            "profile zip has more than {MAX_PROFILE_ZIP_ENTRIES} entries"
        )));
    }

    // A native export always keeps its strict schema and validation, including
    // when malformed. Never reinterpret it as a creator archive on failure.
    if !archive
        .file_names()
        .any(|name| name.replace('\\', "/").trim_start_matches("./") == ZIP_MANIFEST_NAME)
    {
        return creator::read_creator_zip(archive, zip_path, staging_root, staging);
    }

    let mut manifest = None;
    let mut exclusive = HashMap::new();
    let mut exclusive_keys = HashSet::new();
    let mut blobs = HashMap::new();
    let mut total: u64 = 0;
    let mut declared_total: u64 = 0;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_invalid)?;
        let raw_name = entry.name().to_string();
        if entry.is_dir() {
            classify_zip_entry(&raw_name)?;
            continue;
        }
        let Some(role) = classify_zip_entry(&raw_name)? else {
            continue;
        };
        check_entry_budget(entry.size(), entry.compressed_size(), &raw_name, total)?;
        declared_total = declared_total
            .checked_add(entry.size())
            .ok_or_else(|| invalid_zip("this profile zip is too large"))?;
        check_total_compression_ratio(declared_total, archive_bytes)?;

        match role {
            ZipRole::Manifest => {
                if manifest.is_some() {
                    return Err(invalid_zip("duplicate execs-profile.json"));
                }
                if entry.size() > MAX_MANIFEST_BYTES {
                    return Err(invalid_zip("execs-profile.json is implausibly large"));
                }
                let mut bytes = Vec::new();
                entry
                    .by_ref()
                    .take(MAX_MANIFEST_BYTES.saturating_add(1))
                    .read_to_end(&mut bytes)
                    .map_err(io_err)?;
                let actual = bytes.len() as u64;
                if actual > MAX_MANIFEST_BYTES {
                    return Err(invalid_zip("execs-profile.json is implausibly large"));
                }
                check_actual_entry_budget(
                    actual,
                    entry.size(),
                    entry.compressed_size(),
                    &raw_name,
                    total,
                )?;
                total = total
                    .checked_add(actual)
                    .ok_or_else(|| invalid_zip("this profile zip is too large"))?;
                check_total_compression_ratio(total, archive_bytes)?;
                let parsed: ProfileZipManifest =
                    serde_json::from_slice(&bytes).map_err(zip_invalid)?;
                if parsed.schema != ZIP_SCHEMA {
                    return Err(invalid_zip("unsupported profile zip schema"));
                }
                manifest = Some(parsed);
            }
            ZipRole::Exclusive(dest) => {
                let key = portable_path_key(&dest)?;
                if !exclusive_keys.insert(key) {
                    return Err(invalid_zip(format!(
                        "colliding file paths in profile zip: {dest}"
                    )));
                }
                let staged = staging.join(format!("e{index}"));
                let declared = entry.size();
                let compressed = entry.compressed_size();
                let written = stream_entry(
                    staging_root,
                    &mut entry,
                    &staged,
                    &raw_name,
                    total,
                    declared,
                    compressed,
                )?;
                total = total
                    .checked_add(written)
                    .ok_or_else(|| invalid_zip("this profile zip is too large"))?;
                check_total_compression_ratio(total, archive_bytes)?;
                if exclusive.insert(dest.clone(), staged).is_some() {
                    return Err(invalid_zip(format!("duplicate file: {dest}")));
                }
            }
            ZipRole::Blob(hash) => {
                let staged = staging.join(format!("b{index}"));
                let declared = entry.size();
                let compressed = entry.compressed_size();
                let written = stream_entry(
                    staging_root,
                    &mut entry,
                    &staged,
                    &raw_name,
                    total,
                    declared,
                    compressed,
                )?;
                total = total
                    .checked_add(written)
                    .ok_or_else(|| invalid_zip("this profile zip is too large"))?;
                check_total_compression_ratio(total, archive_bytes)?;
                if sha256_file(&staged).map_err(io_err)? != hash {
                    return Err(invalid_zip("blob hash mismatch"));
                }
                if blobs.insert(hash.clone(), staged).is_some() {
                    return Err(invalid_zip(format!("duplicate blob: {hash}")));
                }
            }
        }
    }

    let manifest = manifest.ok_or_else(|| invalid_zip("missing execs-profile.json"))?;
    Ok(ZipPayload {
        manifest,
        exclusive,
        blobs,
        creator: false,
        skipped_files: 0,
        import_notes: Vec::new(),
    })
}

/// Refuse an entry on its declared size and compression ratio, before a byte of
/// it is decompressed.
fn check_entry_budget(
    size: u64,
    compressed: u64,
    name: &str,
    total_so_far: u64,
) -> Result<(), ProfileError> {
    if size > MAX_ENTRY_UNCOMPRESSED {
        return Err(invalid_zip(format!("{name} is larger than 1 GiB")));
    }
    if total_so_far.saturating_add(size) > MAX_TOTAL_UNCOMPRESSED {
        return Err(invalid_zip("this profile zip unpacks to more than 2 GiB"));
    }
    if compression_ratio_exceeded(size, compressed) {
        return Err(invalid_zip(format!(
            "{name} decompresses more than {MAX_COMPRESSION_RATIO}x; refusing to unpack it"
        )));
    }
    Ok(())
}

fn compression_ratio_exceeded(uncompressed: u64, compressed: u64) -> bool {
    (compressed == 0 && uncompressed > 0)
        || (compressed > 0
            && uncompressed > COMPRESSION_RATIO_FLOOR
            && uncompressed > compressed.saturating_mul(MAX_COMPRESSION_RATIO))
}

fn check_total_compression_ratio(expanded: u64, archive_bytes: u64) -> Result<(), ProfileError> {
    if compression_ratio_exceeded(expanded, archive_bytes) {
        return Err(invalid_zip(format!(
            "this profile zip decompresses more than {MAX_COMPRESSION_RATIO}x; refusing to unpack it"
        )));
    }
    Ok(())
}

/// Copy one entry to `dest`, stopping if the stream turns out to be longer than
/// its header claimed.
fn stream_entry(
    staging_root: &Path,
    entry: &mut impl Read,
    dest: &Path,
    name: &str,
    total_so_far: u64,
    declared_size: u64,
    compressed_size: u64,
) -> Result<u64, ProfileError> {
    let remaining = MAX_TOTAL_UNCOMPRESSED
        .saturating_sub(total_so_far)
        .min(MAX_ENTRY_UNCOMPRESSED);
    let mut out = create_new_file_within(staging_root, dest).map_err(io_err)?;
    let mut limited = entry.take(remaining.saturating_add(1));
    let written = std::io::copy(&mut limited, &mut out).map_err(io_err)?;
    out.flush().map_err(io_err)?;
    check_actual_entry_budget(written, declared_size, compressed_size, name, total_so_far)?;
    Ok(written)
}

fn check_actual_entry_budget(
    actual: u64,
    declared: u64,
    compressed: u64,
    name: &str,
    total_so_far: u64,
) -> Result<(), ProfileError> {
    if actual > MAX_ENTRY_UNCOMPRESSED {
        return Err(invalid_zip(format!("{name} is larger than 1 GiB")));
    }
    if actual != declared {
        return Err(invalid_zip(format!(
            "{name} does not match the size in its zip header"
        )));
    }
    if total_so_far
        .checked_add(actual)
        .is_none_or(|total| total > MAX_TOTAL_UNCOMPRESSED)
    {
        return Err(invalid_zip("this profile zip unpacks to more than 2 GiB"));
    }
    if compression_ratio_exceeded(actual, compressed) {
        return Err(invalid_zip(format!(
            "{name} decompresses more than {MAX_COMPRESSION_RATIO}x; refusing to unpack it"
        )));
    }
    Ok(())
}

fn classify_zip_entry(raw: &str) -> Result<Option<ZipRole>, ProfileError> {
    if raw.contains('\0') {
        return Err(ProfileError::InvalidPath);
    }
    let name = raw.replace('\\', "/");
    let name = name.trim_start_matches("./");
    let trimmed = name.trim_end_matches('/');
    if trimmed.starts_with('/') {
        return Err(ProfileError::InvalidPath);
    }
    let mut chars = trimmed.chars();
    if let (Some(drive), Some(':')) = (chars.next(), chars.next()) {
        if drive.is_ascii_alphabetic() {
            return Err(ProfileError::InvalidPath);
        }
    }
    let parts: Vec<&str> = trimmed.split('/').filter(|part| !part.is_empty()).collect();
    if parts.iter().any(|part| *part == "." || *part == "..") {
        return Err(ProfileError::InvalidPath);
    }
    if name.ends_with('/') || parts.is_empty() {
        return Ok(None);
    }

    let normalized = parts.join("/");
    if is_zip_file_name(&normalized) {
        return Err(invalid_zip("nested zips are not allowed"));
    }
    if normalized == ZIP_MANIFEST_NAME {
        return Ok(Some(ZipRole::Manifest));
    }
    if let Some(rest) = normalized.strip_prefix("files/") {
        if rest.is_empty() {
            return Ok(None);
        }
        let dest = normalize_rel_path(rest)?;
        // Zip-slip out of the root is handled above; this is the gate on what
        // an imported entry may land on *inside* the game folder.
        if !is_profile_ownable_rel_path(&dest) {
            return Err(ProfileError::ForbiddenPath(dest));
        }
        if is_zip_file_name(&dest) {
            return Err(invalid_zip("nested zips are not allowed"));
        }
        return Ok(Some(ZipRole::Exclusive(dest)));
    }
    if let Some(hash) = normalized.strip_prefix("blobs/") {
        if hash.contains('/') || !is_sha256_hex(hash) {
            return Err(ProfileError::InvalidPath);
        }
        return Ok(Some(ZipRole::Blob(hash.to_ascii_lowercase())));
    }
    Err(invalid_zip(format!("unexpected zip entry: {normalized}")))
}

fn validate_payload(payload: &mut ZipPayload) -> Result<(), ProfileError> {
    validate_payload_with_trust(payload, false)
}

fn validate_payload_with_trust(
    payload: &mut ZipPayload,
    trust_creator: bool,
) -> Result<(), ProfileError> {
    if payload.manifest.name.trim().is_empty()
        || payload.manifest.name.chars().count() > MAX_PROFILE_NAME_CHARS
        || payload.manifest.name.chars().any(char::is_control)
    {
        return Err(invalid_zip("invalid profile name"));
    }
    if payload.manifest.files.len() > MAX_PROFILE_FILES {
        return Err(invalid_zip(format!(
            "profile manifest has more than {MAX_PROFILE_FILES} files"
        )));
    }
    if payload.manifest.launch_options.len() > MAX_LAUNCH_OPTIONS_BYTES {
        return Err(invalid_zip("launch options are implausibly large"));
    }
    validate_imported_launch_options(&payload.manifest.launch_options)?;

    let mut seen = HashSet::new();
    let mut required_exclusive = HashSet::new();
    let mut required_blobs = HashSet::new();
    let mut path_bytes = 0usize;

    for file in &payload.manifest.files {
        // Report the archive budget violation before the shared path helper's
        // generic InvalidPath result. Either way this is still checked before
        // consulting a staged payload map.
        let normalized_separators = file.path.replace('\\', "/");
        if normalized_separators.split('/').count() > MAX_PROFILE_PATH_DEPTH {
            return Err(invalid_zip(format!(
                "profile path is too deeply nested: {}",
                file.path
            )));
        }
        let path = normalize_rel_path(&file.path)?;
        if !is_profile_ownable_rel_path(&path) {
            return Err(ProfileError::ForbiddenPath(path));
        }
        path_bytes = path_bytes
            .checked_add(path.len())
            .ok_or_else(|| invalid_zip("profile paths are too large"))?;
        if path_bytes > MAX_PROFILE_PATH_BYTES {
            return Err(invalid_zip("profile paths exceed the metadata budget"));
        }
        let portable_key = portable_path_key(&path)?;
        if !seen.insert(portable_key) {
            return Err(invalid_zip(format!("duplicate path: {path}")));
        }
        if is_shared_rel_path(&path) {
            if file.storage != FileStorage::Shared {
                return Err(ProfileError::MustBeShared(path));
            }
            let hash = file.sha256.to_ascii_lowercase();
            if !is_sha256_hex(&hash) {
                return Err(invalid_zip("invalid sha256"));
            }
            let staged = payload
                .blobs
                .get(&hash)
                .ok_or_else(|| invalid_zip(format!("missing blob for {path}")))?;
            if sha256_file(staged).map_err(io_err)? != hash {
                return Err(invalid_zip(format!("hash mismatch for {path}")));
            }
            validate_imported_profile_file(&path, staged, &hash, trust_creator)?;
            required_blobs.insert(hash);
        } else {
            if file.storage != FileStorage::Exclusive {
                return Err(ProfileError::NotShareable(path.clone()));
            }
            let staged = payload
                .exclusive
                .get(&path)
                .ok_or_else(|| invalid_zip(format!("missing file: {path}")))?;
            if sha256_file(staged).map_err(io_err)? != file.sha256.to_ascii_lowercase() {
                return Err(invalid_zip(format!("hash mismatch for {path}")));
            }
            validate_imported_profile_file(&path, staged, &file.sha256, trust_creator)?;
            required_exclusive.insert(path);
        }
    }

    for path in payload.exclusive.keys() {
        if !required_exclusive.contains(path) {
            return Err(invalid_zip(format!("unexpected file: {path}")));
        }
    }
    for hash in payload.blobs.keys() {
        if !required_blobs.contains(hash) {
            return Err(invalid_zip("unexpected blob"));
        }
    }
    validate_imported_metadata(&mut payload.manifest, &payload.exclusive, &payload.blobs)?;
    Ok(())
}

fn validate_imported_profile_file(
    path: &str,
    staged: &Path,
    expected_hash: &str,
    trust_creator: bool,
) -> Result<(), ProfileError> {
    let validate_cfg = if trust_creator {
        crate::archive::validate_trusted_cfg
    } else {
        validate_imported_cfg
    };
    if has_extension(path, "cfg") {
        let bytes = read_cfg_for_scan(staged, path)?;
        validate_cfg(path, &bytes)?;
    } else if has_extension(path, "vpk") {
        let mut source = fs::File::open(staged).map_err(io_err)?;
        inspect_profile_vpk(path, &mut source, expected_hash, validate_cfg)?;
    }
    Ok(())
}

fn validate_imported_metadata(
    manifest: &mut ProfileZipManifest,
    exclusive: &HashMap<String, PathBuf>,
    blobs: &HashMap<String, PathBuf>,
) -> Result<(), ProfileError> {
    if let Some(selection) = &manifest.preloader {
        selection.validate()?;
    }
    if let Some(hud) = &manifest.hud {
        let sanitized = crate::hud::sanitize_stored_hud_id(&hud.id)?;
        if sanitized != hud.id {
            return Err(invalid_zip("invalid HUD id in profile metadata"));
        }
    }
    if manifest.mods.len() > MAX_PROFILE_FILES {
        return Err(invalid_zip("too many mod records in profile metadata"));
    }

    let mut mod_ids = HashSet::new();
    let mut mod_packs = HashSet::new();
    for record in &mut manifest.mods {
        if record.id.is_empty()
            || record.id.len() > 48
            || record.id.bytes().any(|byte| {
                !(byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || byte == b'-'
                    || byte == b'_')
            })
            || record.name.chars().count() > 256
            || record.name.chars().any(char::is_control)
        {
            return Err(invalid_zip("invalid mod record in profile metadata"));
        }
        let expected_folder = record.id.as_str();
        let expected_vpk = format!("{}.vpk", record.id);
        let external_pack = !record.pack.is_empty()
            && record.pack.len() <= 255
            && !record.pack.contains(['/', '\\'])
            && is_profile_ownable_rel_path(&format!("tf/custom/{}", record.pack));
        let pack_owned = match record.source {
            ModSource::External => external_pack,
            _ => record.pack == expected_folder || record.pack == expected_vpk,
        };
        if !pack_owned {
            return Err(invalid_zip(format!(
                "mod {} does not own its recorded pack",
                record.id
            )));
        }
        if !mod_ids.insert(record.id.clone()) || !mod_packs.insert(portable_path_key(&record.pack)?)
        {
            return Err(invalid_zip("duplicate mod record in profile metadata"));
        }

        let exact = format!("tf/custom/{}", record.pack);
        let prefix = format!("{exact}/");
        let owned: Vec<&ProfileFile> = manifest
            .files
            .iter()
            .filter(|file| file.path == exact || file.path.starts_with(&prefix))
            .collect();
        if owned.is_empty() {
            return Err(invalid_zip(format!(
                "mod {} has no matching profile files",
                record.id
            )));
        }
        let mut bytes = 0u64;
        for file in &owned {
            let staged = match file.storage {
                FileStorage::Exclusive => exclusive.get(&normalize_rel_path(&file.path)?),
                FileStorage::Shared => blobs.get(&file.sha256.to_ascii_lowercase()),
            }
            .ok_or_else(|| invalid_zip("mod record references a missing file"))?;
            bytes = bytes
                .checked_add(fs::metadata(staged).map_err(io_err)?.len())
                .ok_or_else(|| invalid_zip("mod record size overflows"))?;
        }
        // Counts are derived from verified payloads, never trusted metadata.
        record.files = owned.len();
        record.bytes = bytes;
    }

    // The file loop above has already checked every listed payload against its
    // manifest hash. Feature metadata may only claim those verified files.
    validate_feature_payloads(manifest)?;

    if manifest.ignored_packs.len() > MAX_PROFILE_FILES {
        return Err(invalid_zip("too many ignored packs in profile metadata"));
    }
    let mut ignored = HashSet::new();
    for pack in &manifest.ignored_packs {
        if pack.is_empty()
            || pack.len() > 255
            || pack.contains(['/', '\\'])
            || !is_profile_ownable_rel_path(&format!("tf/custom/{pack}"))
        {
            return Err(invalid_zip("invalid ignored pack in profile metadata"));
        }
        if !ignored.insert(pack.to_ascii_lowercase()) {
            return Err(invalid_zip("duplicate ignored pack in profile metadata"));
        }
    }
    make_metadata_portable(manifest);
    Ok(())
}

fn validate_feature_payloads(manifest: &ProfileZipManifest) -> Result<(), ProfileError> {
    let paths: HashSet<&str> = manifest
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    if let Some(record) = &manifest.crosshair {
        if record.id != crate::crosshair::EXECS_CROSSHAIRS_PACK {
            return Err(invalid_zip("crosshair record names an unknown pack"));
        }
        let prefix = if record.inactive {
            "tf/custom/execs-crosshairs/inactive/"
        } else {
            "tf/custom/execs-crosshairs/"
        };
        let material = |name: &str, extension: &str| {
            paths.contains(
                format!("{prefix}materials/vgui/replay/thumbnails/{name}.{extension}").as_str(),
            )
        };
        // Old schema-1 records may omit `shape`; retain readability when the
        // pack still has a verified material pair.
        if record.shape.is_empty() {
            let material_root = format!("{prefix}materials/vgui/replay/thumbnails/");
            if !paths.iter().any(|path| {
                path.strip_prefix(&material_root)
                    .and_then(|name| name.strip_suffix(".vtf"))
                    .is_some_and(|name| material(name, "vmt"))
            }) {
                return Err(invalid_zip(
                    "crosshair record has no verified material pair",
                ));
            }
        }
        let names = (!record.shape.is_empty())
            .then_some(record.shape.as_str())
            .into_iter()
            .chain(record.library.keys().map(String::as_str));
        for name in names {
            if !crate::crosshair::valid_crosshair_name(name)
                || !material(name, "vtf")
                || !material(name, "vmt")
            {
                return Err(invalid_zip(format!(
                    "crosshair record has no verified material pair for {name}"
                )));
            }
        }
        if !paths.iter().any(|path| {
            path.starts_with(&format!("{prefix}scripts/tf_weapon_")) && path.ends_with(".txt")
        }) {
            return Err(invalid_zip(
                "crosshair record has no verified weapon scripts",
            ));
        }
        for stem in record.assignments.keys() {
            if !paths.contains(format!("{prefix}scripts/{stem}.txt").as_str()) {
                return Err(invalid_zip(format!(
                    "crosshair record has no verified weapon script for {stem}"
                )));
            }
        }
    }
    if let Some(record) = &manifest.viewmodel {
        if record.id != crate::viewmodel::EXECS_VIEWMODELS_PACK
            || !paths.contains(crate::viewmodel::EXECS_VIEWMODELS_VPK)
        {
            return Err(invalid_zip("viewmodel record has no verified VPK"));
        }
    }
    if let Some(record) = &manifest.hitsound {
        if record.hit.is_none() && record.kill.is_none() {
            return Err(invalid_zip("hitsound record has no sound slots"));
        }
        for (entry, path) in [
            (&record.hit, crate::hitsound::HITSOUND_REL),
            (&record.kill, crate::hitsound::KILLSOUND_REL),
        ] {
            if entry.is_some() && !paths.contains(path) {
                return Err(invalid_zip(format!(
                    "hitsound record has no verified {path}"
                )));
            }
        }
    }
    Ok(())
}

/// Remove identifiers that are meaningful only in the sender's local app-data
/// directory. In particular, a picked-hit-sound token names a private stash
/// file and must neither leak into an export nor be allowed to reference an
/// unrelated stash file on the recipient's machine. GameBanana links are
/// reconstructed from their numeric id so archive metadata cannot smuggle a
/// unsafe navigation URL into another library.
fn make_metadata_portable(manifest: &mut ProfileZipManifest) {
    if let Some(record) = &mut manifest.hitsound {
        for entry in [&mut record.hit, &mut record.kill].into_iter().flatten() {
            entry.token = None;
        }
    }
    for record in &mut manifest.mods {
        if let ModSource::Gamebanana { id, url } = &mut record.source {
            *url = format!("https://gamebanana.com/mods/{id}");
        }
    }
}

fn has_extension(path: &str, extension: &str) -> bool {
    path.rsplit_once('.')
        .is_some_and(|(_, found)| found.eq_ignore_ascii_case(extension))
}

fn read_cfg_for_scan(path: &Path, label: &str) -> Result<Vec<u8>, ProfileError> {
    read_regular_file_bounded(path, MAX_IMPORTED_CFG_BYTES as u64)?
        .ok_or_else(|| invalid_zip(format!("{label} is too large to inspect as cfg text")))
}

fn validated_export_files(manifest: &ProfileManifest) -> Result<Vec<ProfileFile>, ProfileError> {
    if manifest.files.len() > MAX_PROFILE_FILES {
        return Err(ProfileError::Io(format!(
            "This profile has more than {MAX_PROFILE_FILES} files and cannot be exported."
        )));
    }
    let mut seen = HashSet::new();
    let mut path_bytes = 0usize;
    let mut files = Vec::with_capacity(manifest.files.len());
    for file in &manifest.files {
        let path = normalize_rel_path(&file.path)?;
        if !is_profile_ownable_rel_path(&path) {
            return Err(ProfileError::ForbiddenPath(path));
        }
        if path.split('/').count() > MAX_PROFILE_PATH_DEPTH {
            return Err(ProfileError::Io(format!(
                "Profile path is too deeply nested to export: {path}"
            )));
        }
        path_bytes = path_bytes
            .checked_add(path.len())
            .ok_or_else(|| ProfileError::Io("Profile paths are too large to export.".into()))?;
        if path_bytes > MAX_PROFILE_PATH_BYTES {
            return Err(ProfileError::Io(
                "Profile paths exceed the export metadata budget.".into(),
            ));
        }
        if !seen.insert(portable_path_key(&path)?) {
            return Err(ProfileError::Io(format!(
                "Profile contains colliding paths and cannot be exported: {path}"
            )));
        }
        if !is_sha256_hex(&file.sha256) {
            return Err(ProfileError::Io(format!(
                "Profile contains an invalid hash for {path}."
            )));
        }
        let mut normalized = file.clone();
        normalized.path = path;
        normalized.sha256.make_ascii_lowercase();
        files.push(normalized);
    }
    Ok(files)
}

fn validate_export_destination(profiles_dir: &Path, zip_path: &Path) -> Result<(), ProfileError> {
    let parent = zip_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let library = fs::canonicalize(profiles_dir).map_err(io_err)?;
    let destination_parent = fs::canonicalize(parent).map_err(io_err)?;
    if destination_parent.starts_with(&library) {
        return Err(ProfileError::Io(
            "Choose an export location outside the execs profile library.".into(),
        ));
    }
    refuse_symlink_destination(zip_path)
}

fn refuse_symlink_destination(zip_path: &Path) -> Result<(), ProfileError> {
    match fs::symlink_metadata(zip_path) {
        Ok(meta) if metadata_is_link(&meta) => Err(ProfileError::Io(
            "Refusing to export through a symbolic link or junction.".into(),
        )),
        Ok(meta) if meta.is_dir() => Err(ProfileError::Io(
            "Choose a file, not a folder, for the profile export.".into(),
        )),
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(io_err(err)),
    }
}

/// Open a regular library file once, hash that same handle, then rewind it for
/// streaming. A symlink is refused before open and the path is never reopened,
/// closing the ordinary check-then-copy swap window.
fn open_verified_source(
    root: &Path,
    path: &Path,
    expected: &str,
    label: &str,
) -> Result<(fs::File, u64), ProfileError> {
    validate_file_within(root, path).map_err(io_err)?;
    let meta = fs::symlink_metadata(path).map_err(io_err)?;
    if metadata_is_link(&meta) || !meta.is_file() {
        return Err(ProfileError::Io(format!(
            "Refusing non-regular export source: {label}"
        )));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Linux O_NOFOLLOW closes the check/open swap window for a library
        // path that an external process replaces during export.
        options.custom_flags(0x0002_0000);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options.open(path).map_err(io_err)?;
    let opened_meta = file.metadata().map_err(io_err)?;
    if metadata_is_link(&opened_meta) || !opened_meta.is_file() {
        return Err(ProfileError::Io(format!(
            "Refusing non-regular export source: {label}"
        )));
    }
    let len = opened_meta.len();
    if len > MAX_ENTRY_UNCOMPRESSED {
        return Err(ProfileError::Io(format!(
            "{label} is larger than 1 GiB and cannot be exported."
        )));
    }
    let mut limited =
        std::io::Read::by_ref(&mut file).take(MAX_ENTRY_UNCOMPRESSED.saturating_add(1));
    if sha256_reader(&mut limited).map_err(io_err)? != expected.to_ascii_lowercase()
        || file.stream_position().map_err(io_err)? != len
        || file.metadata().map_err(io_err)?.len() != len
    {
        return Err(ProfileError::Io(format!("hash mismatch for {label}")));
    }
    file.seek(SeekFrom::Start(0)).map_err(io_err)?;
    Ok((file, len))
}

fn read_validated_export_cfg_source(
    path: &str,
    source: &mut fs::File,
    expected_len: u64,
    expected_hash: &str,
) -> Result<Option<Vec<u8>>, ProfileError> {
    if has_extension(path, "vpk") {
        inspect_profile_vpk(path, source, expected_hash, validate_exported_cfg)?;
        source.seek(SeekFrom::Start(0)).map_err(io_err)?;
        return Ok(None);
    }
    if !has_extension(path, "cfg") {
        return Ok(None);
    }
    if expected_len > MAX_IMPORTED_CFG_BYTES as u64 {
        return Err(ProfileError::Io(format!(
            "{path} is too large to inspect as cfg text before export."
        )));
    }
    let mut bytes = Vec::with_capacity(expected_len as usize);
    std::io::Read::by_ref(source)
        .take((MAX_IMPORTED_CFG_BYTES as u64).saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(io_err)?;
    if bytes.len() as u64 != expected_len || !sha256_hex(&bytes).eq_ignore_ascii_case(expected_hash)
    {
        return Err(ProfileError::Io(format!(
            "{path} changed while it was being exported."
        )));
    }
    validate_exported_cfg(path, &bytes)?;
    Ok(Some(bytes))
}

fn inspect_profile_vpk(
    path: &str,
    source: &mut fs::File,
    expected_hash: &str,
    validate_cfg: fn(&str, &[u8]) -> Result<(), ProfileError>,
) -> Result<(), ProfileError> {
    // Narrow legacy compatibility: only files without Source's four-byte
    // magic remain opaque. A signed VPK must satisfy every parser and member
    // budget; malformed archives never turn into permission to skip scanning.
    let mut signature = Vec::with_capacity(4);
    std::io::Read::by_ref(source)
        .take(4)
        .read_to_end(&mut signature)
        .map_err(io_err)?;
    let signed_vpk = signature.as_slice() == 0x55aa_1234u32.to_le_bytes();
    if !signed_vpk {
        // Hash the bytes that decided the opaque exception, together with the
        // rest of this read. A second independent signature read would allow
        // a changing source to hide its magic only during inspection.
        let mut observed = std::io::Cursor::new(&signature)
            .chain(std::io::Read::by_ref(source).take(MAX_ENTRY_UNCOMPRESSED + 1));
        if !sha256_reader(&mut observed)
            .map_err(io_err)?
            .eq_ignore_ascii_case(expected_hash)
        {
            return Err(ProfileError::Io(format!(
                "{path} changed while it was being inspected."
            )));
        }
        return Ok(());
    }
    let (cfgs, actual_hash) = read_vpk_file_filtered_hashed(
        source,
        &|entry| has_extension(entry, "cfg"),
        MAX_IMPORTED_CFG_BYTES as u64,
    )
    .map_err(|err| invalid_zip(format!("invalid profile VPK {path}: {}", err.message())))?;
    if !actual_hash.eq_ignore_ascii_case(expected_hash) {
        return Err(ProfileError::Io(format!(
            "{path} changed while it was being inspected."
        )));
    }
    for (entry, bytes) in cfgs.files {
        validate_cfg(&format!("{path}/{entry}"), &bytes)?;
    }
    Ok(())
}

fn charge_export_bytes(total: &mut u64, len: u64, label: &str) -> Result<(), ProfileError> {
    *total = total
        .checked_add(len)
        .ok_or_else(|| ProfileError::Io("This profile is too large to export.".into()))?;
    if *total > MAX_TOTAL_UNCOMPRESSED {
        return Err(ProfileError::Io(format!(
            "This profile is larger than 2 GiB and cannot be exported ({label})."
        )));
    }
    Ok(())
}

fn copy_into_zip_verified(
    source: &mut fs::File,
    zip: &mut ZipWriter<fs::File>,
    expected_len: u64,
    expected_hash: &str,
    label: &str,
) -> Result<(), ProfileError> {
    let mut hasher = sha2::Sha256::new();
    let mut written = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let remaining = expected_len.saturating_add(1).saturating_sub(written);
        if remaining == 0 {
            return Err(ProfileError::Io(format!(
                "{label} changed while it was being exported."
            )));
        }
        let read_len = buffer.len().min(remaining as usize);
        let read = source.read(&mut buffer[..read_len]).map_err(io_err)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        zip.write_all(&buffer[..read]).map_err(io_err)?;
        written += read as u64;
    }
    let actual_hash = format!("{:x}", hasher.finalize());
    if written != expected_len || !actual_hash.eq_ignore_ascii_case(expected_hash) {
        return Err(ProfileError::Io(format!(
            "{label} changed while it was being exported."
        )));
    }
    Ok(())
}

fn require_usable_library(
    profiles_dir: &Path,
    tf2_root: &Path,
) -> Result<ProfileLibrary, ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.root_mismatch {
        return Err(root_mismatch(&library, tf2_root));
    }
    if !library.initialized || !library.usable {
        return Err(ProfileError::NotInitialized);
    }
    Ok(library)
}

fn root_mismatch(library: &ProfileLibrary, tf2_root: &Path) -> ProfileError {
    ProfileError::RootMismatch {
        library_root: library.tf2_root.clone().unwrap_or_default(),
        confirmed_root: tf2_root.to_string_lossy().into_owned(),
    }
}

fn file_options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

fn is_zip_file_name(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .to_ascii_lowercase()
        .ends_with(".zip")
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte: u8| byte.is_ascii_hexdigit())
}

fn invalid_zip(message: impl Into<String>) -> ProfileError {
    ProfileError::Io(message.into())
}

fn io_err(err: impl ToString) -> ProfileError {
    ProfileError::Io(err.to_string())
}

fn json_err(err: serde_json::Error) -> ProfileError {
    ProfileError::Io(err.to_string())
}

fn zip_io(err: zip::result::ZipError) -> ProfileError {
    ProfileError::Io(err.to_string())
}

fn zip_invalid(err: impl ToString) -> ProfileError {
    ProfileError::Io(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob::{blob_path, blobs_dir};
    use crate::hash::{part_path, sha256_hex};
    use crate::mods::{ModRecord, ModSource};
    use crate::profile::{
        exclusive_file_path, index_file, init_library_to, load_library_from, load_manifest,
        save_current_as_to, save_manifest, FileStorage, ProfileError, SaveCurrentOptions,
    };
    use std::collections::BTreeMap;
    use std::io::{Cursor, Write};
    use std::path::Path;

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

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/j"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "could not create test junction");
    }

    #[cfg(unix)]
    fn unlink_dir(link: &Path) {
        fs::remove_file(link).unwrap();
    }

    #[cfg(windows)]
    fn unlink_dir(link: &Path) {
        fs::remove_dir(link).unwrap();
    }

    fn write_live(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn snapshot_tree(root: &Path) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        fn walk(dir: &Path, root: &Path, out: &mut BTreeMap<String, String>) {
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, root, out);
                    continue;
                }
                if path.is_file() {
                    let rel = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    out.insert(rel, sha256_hex(&fs::read(&path).unwrap()));
                }
            }
        }
        if root.exists() {
            walk(root, root, &mut out);
        }
        out
    }

    fn count_blob_files(profiles_dir: &Path) -> usize {
        fn walk(dir: &Path) -> usize {
            let Ok(entries) = fs::read_dir(dir) else {
                return 0;
            };
            let mut n = 0;
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    n += walk(&path);
                } else if path.is_file() {
                    n += 1;
                }
            }
            n
        }
        walk(&blobs_dir(profiles_dir))
    }

    fn write_raw_zip(path: &Path, entries: &[(&str, &[u8])]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let file = fs::File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = file_options();
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    const RAW_MANIFEST: &[u8] = br#"{
  "schema": 1,
  "name": "Bomb",
  "launchOptions": "",
  "files": []
}
"#;

    #[test]
    fn creator_zip_import_preserves_files_and_switches_only_when_requested() {
        for prefix in ["", "tf/", "Creator config/tf/", "Creator config/"] {
            let dir = crate::test_temp_dir();
            let profiles = dir.join("execs/profiles");
            let root = dir.join("Team Fortress 2");
            seed_live(&root);
            let saved = save_current_as_to(
                &profiles,
                &root,
                "Main",
                unlocked(),
                SaveCurrentOptions::default(),
            )
            .unwrap();
            let before_live = snapshot_tree(&root);
            let before_library = snapshot_tree(&profiles);
            let zip_path = dir.join("Creator config.zip");
            let entries: Vec<_> = [
                // The public native-only reader rejected this first entry before
                // reaching any of the creator's actual cfg/custom content.
                (
                    "cfg/user.scr",
                    b"VERSION 1.0\nDESCRIPTION INFO_OPTIONS\n{\n\"cl_autoreload\" { \"Auto reload\" { BOOL } { \"1\" } }\n}\n".as_slice(),
                ),
                (
                    "cfg/config.cfg",
                    b"unbindall\nbind w +forward\npassword 0\n".as_slice(),
                ),
                (
                    "cfg/overrides/autoexec.cfg",
                    b"sensitivity 2.5\nexec overrides/binds\n".as_slice(),
                ),
                ("cfg/overrides/binds.cfg", b"bind space +jump\n".as_slice()),
                ("custom/hud/info.vdf", b"hud\n".as_slice()),
                ("custom/hud/resource/ui/test.res", b"layout\n".as_slice()),
                (
                    "custom/damage/sound/ui/hitsound.wav",
                    b"creator audio".as_slice(),
                ),
                (
                    "custom/mastercomfig-base.vpk",
                    b"opaque legacy vpk".as_slice(),
                ),
                ("custom/low.vpk.sound.cache", b"cache".as_slice()),
                ("custom/execs-preloader.vpk", b"global".as_slice()),
                ("custom/workshop/stock.vpk", b"stock".as_slice()),
                ("cfg/settings.scr", b"engine".as_slice()),
            ]
            .into_iter()
            .map(|(path, bytes)| (format!("{prefix}{path}"), bytes))
            .collect();
            let borrowed: Vec<_> = entries
                .iter()
                .map(|(path, bytes)| (path.as_str(), *bytes))
                .collect();
            write_raw_zip(&zip_path, &borrowed);
            let review =
                creator::inspect_profile_import_from(&profiles, &root, &zip_path, unlocked())
                    .unwrap();
            assert!(review.creator);
            assert_eq!(review.name, "Creator config");
            assert_eq!(review.files, 8);
            assert_eq!(review.skipped_files, 4);
            assert!(review.warnings.is_empty());
            // Inspection/cancel leaves both the library and live files intact.
            assert_eq!(snapshot_tree(&profiles), before_library);
            assert_eq!(snapshot_tree(&root), before_live);
            let imported =
                import_profile_with_review(&profiles, &root, &zip_path, unlocked(), Some(&review))
                    .unwrap();
            assert_eq!(imported.profiles.len(), 2);
            assert_eq!(imported.active_profile_id, saved.active_profile_id);
            assert_eq!(snapshot_tree(&root), before_live);
            let id = &imported
                .profiles
                .iter()
                .find(|p| Some(&p.id) != saved.active_profile_id.as_ref())
                .unwrap()
                .id;
            let manifest = load_manifest(&profiles, id).unwrap();
            assert_eq!(manifest.files.len(), 8);
            assert!(manifest
                .files
                .iter()
                .any(|file| file.path == "tf/cfg/user.scr"));
            assert!(manifest.launch_options.is_empty());
            assert!(manifest
                .files
                .iter()
                .any(|f| f.storage == FileStorage::Shared));
            let no_steam = Vec::new();
            crate::switch::switch_profile_to(
                &profiles,
                &root,
                id,
                unlocked(),
                crate::absorb::AbsorbOptions {
                    steam_roots: Some(&no_steam),
                    ..Default::default()
                },
                |_| {},
            )
            .unwrap();
            for file in &manifest.files {
                assert_eq!(sha256_file(&root.join(&file.path)).unwrap(), file.sha256);
            }
            cleanup(&dir);
        }
    }

    #[test]
    fn split_creator_bundle_combines_custom_trees_and_seeds_clean_settings() {
        let dir = crate::test_temp_dir().join(random_token());
        let profiles = dir.join("profiles");
        let root = dir.join("tf2");
        seed_live(&root);
        let zip = dir.join("split.zip");
        write_raw_zip(
            &zip,
            &[
                ("Scripts/cfg/autoexec.cfg", b"sensitivity 2.5\n"),
                ("Mods/Sound/tf/custom/stuff/UI/hitsound.wav", b"audio"),
                (
                    "Mods/Surface/tf/custom/stuff/scripts/surfaceproperties.txt",
                    b"surface",
                ),
                ("Mods/stock/tf/custom/workshop/UI/hitsound.wav", b"stock"),
                ("Mods/Launch Options.txt", b"-w [your width] -dxlevel 98"),
                ("Mods/Alternatives/poke/models/model.mdl", b"optional"),
                ("Mods/Transparent/transparent.zip", b"nested optional zip"),
            ],
        );
        let before = snapshot_tree(&root);
        let review =
            creator::inspect_profile_import_from(&profiles, &root, &zip, unlocked()).unwrap();
        assert_eq!(review.files, 4);
        assert_eq!(review.skipped_files, 4);
        assert_eq!(review.notes.len(), 2);
        let library =
            import_profile_with_review(&profiles, &root, &zip, unlocked(), Some(&review)).unwrap();
        let id = &library.profiles[0].id;
        let manifest = load_manifest(&profiles, id).unwrap();
        assert!(manifest.launch_options.is_empty());
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, id, "tf/cfg/config.cfg")).unwrap(),
            fs::read(root.join("tf/cfg/config_default.cfg")).unwrap()
        );
        assert_ne!(
            fs::read(exclusive_file_path(&profiles, id, "tf/cfg/config.cfg")).unwrap(),
            fs::read(root.join("tf/cfg/config.cfg")).unwrap()
        );
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/execs-hitsounds/sound/ui/hitsound.wav"));
        assert!(manifest
            .files
            .iter()
            .any(|file| file.path == "tf/custom/stuff/scripts/surfaceproperties.txt"));
        assert_eq!(snapshot_tree(&root), before);
        assert!(library.active_profile_id.is_none());

        for entries in [
            vec![
                ("One/custom/pack/file.txt", b"one".as_slice()),
                ("Two/custom/pack/FILE.txt", b"two".as_slice()),
            ],
            vec![
                ("One/custom/stuff/UI/hitsound.wav", b"one".as_slice()),
                (
                    "Two/custom/execs-hitsounds/sound/ui/hitsound.wav",
                    b"two".as_slice(),
                ),
            ],
            vec![
                ("One/cfg/autoexec.cfg", b"one".as_slice()),
                ("Two/cfg/other.cfg", b"two".as_slice()),
            ],
        ] {
            write_raw_zip(&zip, &entries);
            assert!(
                creator::inspect_profile_import_from(&profiles, &root, &zip, unlocked()).is_err()
            );
            assert_eq!(
                load_library_from(&profiles, Some(&root))
                    .unwrap()
                    .profiles
                    .len(),
                1
            );
        }
        cleanup(&dir);
    }

    #[test]
    fn creator_without_config_requires_readable_defaults_before_publication() {
        let dir = crate::test_temp_dir().join(random_token());
        let profiles = dir.join("profiles");
        let root = dir.join("tf2");
        let zip = dir.join("scripts.zip");
        write_raw_zip(&zip, &[("Scripts/cfg/autoexec.cfg", b"echo hi")]);
        let err =
            creator::inspect_profile_import_from(&profiles, &root, &zip, unlocked()).unwrap_err();
        assert!(err.message().contains("config_default.cfg"));
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .is_empty());
        cleanup(&dir);
    }

    #[test]
    fn creator_commands_require_review_and_approval_is_bound_to_zip_bytes() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("tf2");
        let path = dir.join("creator.zip");
        write_live(
            &root.join("tf/cfg/config_default.cfg"),
            "unbindall\nbind w +forward\n",
        );
        let cfg =
            b"sv_Cheats 1\nfov_desired 90\npassword saved-server-password\nconnect bad.example\n";
        write_raw_zip(&path, &[("/", b""), ("cfg/overrides/autoexec.cfg", cfg)]);
        let refused = import_profile_from(&profiles, &root, &path, unlocked()).unwrap_err();
        assert!(refused.message().contains("connect"), "{refused:?}");
        let review =
            creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).unwrap();
        assert_eq!(review.warnings.len(), 2);
        assert!(review
            .warnings
            .iter()
            .any(|warning| warning.contains("password")));
        let imported =
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review)).unwrap();
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &imported.profiles[0].id,
                "tf/cfg/overrides/autoexec.cfg"
            ))
            .unwrap(),
            cfg
        );
        export_profile_to(
            &profiles,
            &root,
            &imported.profiles[0].id,
            &dir.join("export.zip"),
        )
        .unwrap();
        let mut exported =
            ZipArchive::new(fs::File::open(dir.join("export.zip")).unwrap()).unwrap();
        let mut contents = Vec::new();
        exported
            .by_name("files/tf/cfg/overrides/autoexec.cfg")
            .unwrap()
            .read_to_end(&mut contents)
            .unwrap();
        assert_eq!(contents, cfg);
        let before = snapshot_tree(&profiles);
        write_raw_zip(&path, &[("cfg/autoexec.cfg", b"sensitivity 4\n")]);
        assert!(
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review))
                .unwrap_err()
                .message()
                .contains("changed after review")
        );
        assert_eq!(snapshot_tree(&profiles), before);
        cleanup(&dir);
    }

    #[test]
    fn creator_confirmation_rechecks_game_lock_and_library_root() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("tf2");
        let other_root = dir.join("other-tf2");
        seed_live(&root);
        seed_live(&other_root);
        save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let path = dir.join("creator.zip");
        write_raw_zip(&path, &[("cfg/autoexec.cfg", b"echo creator\n")]);
        let review =
            creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).unwrap();
        let before_library = snapshot_tree(&profiles);
        let before_live = snapshot_tree(&root);
        let before_other = snapshot_tree(&other_root);

        let locked =
            import_profile_with_review(&profiles, &root, &path, [tf2_name()], Some(&review))
                .unwrap_err();
        assert_eq!(locked, ProfileError::GameRunning);
        assert_eq!(snapshot_tree(&profiles), before_library);

        let moved =
            import_profile_with_review(&profiles, &other_root, &path, unlocked(), Some(&review))
                .unwrap_err();
        assert!(matches!(moved, ProfileError::RootMismatch { .. }));
        assert_eq!(snapshot_tree(&profiles), before_library);
        assert_eq!(snapshot_tree(&root), before_live);
        assert_eq!(snapshot_tree(&other_root), before_other);
        assert!(!profiles.join(IMPORT_STAGING_DIR).exists());
        cleanup(&dir);
    }

    #[test]
    fn creator_and_native_multiple_huds_require_choice_and_preserve_inactive_originals() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let root = dir.join("tf2");
        seed_live(&root);
        let path = dir.join("two-huds.zip");
        let first = b"\"HUD\" { \"ui_version\" \"3\" } // first\n";
        let second = b"\"HUD\" { \"ui_version\" \"3\" } // second\n";
        write_raw_zip(
            &path,
            &[
                ("custom/Alpha/info.vdf", first),
                ("custom/Zeta/info.vdf", second),
            ],
        );
        let before = snapshot_tree(&root);
        let mut review =
            creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).unwrap();
        assert_eq!(review.huds, ["Alpha", "Zeta"]);
        assert!(review.selected_hud.is_none());
        assert_eq!(
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review))
                .unwrap_err(),
            ProfileError::HudReviewRequired
        );
        assert!(review.select_hud(Some("forged".into())).is_err());
        review.select_hud(Some("Zeta".into())).unwrap();
        let library =
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review)).unwrap();
        assert!(library.active_profile_id.is_none());
        assert_eq!(snapshot_tree(&root), before);
        let id = library.profiles[0].id.clone();
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert_eq!(manifest.hud_selected_root.as_deref(), Some("Zeta"));
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &id,
                "tf/custom/Alpha/info.vdf"
            ))
            .unwrap(),
            first
        );
        let opts = || crate::absorb::AbsorbOptions {
            cloud_config: None,
            steam_roots: Some(&[]),
        };
        crate::switch::switch_profile_to(&profiles, &root, &id, unlocked(), opts(), |_| {})
            .unwrap();
        assert_eq!(
            crate::hud::live_hud_names(&root)
                .iter()
                .map(|hud| hud.name.as_str())
                .collect::<Vec<_>>(),
            ["Zeta"]
        );
        let native = dir.join("native.zip");
        export_profile_to(&profiles, &root, &id, &native).unwrap();
        let mut native_review =
            creator::inspect_profile_import_from(&profiles, &root, &native, unlocked()).unwrap();
        assert_eq!(native_review.huds, ["Alpha", "Zeta"]);
        native_review.select_hud(Some("Alpha".into())).unwrap();
        let imported =
            import_profile_with_review(&profiles, &root, &native, unlocked(), Some(&native_review))
                .unwrap();
        let second_id = &imported
            .profiles
            .iter()
            .find(|profile| profile.id != id)
            .unwrap()
            .id;
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                second_id,
                "tf/custom/Zeta/info.vdf"
            ))
            .unwrap(),
            second
        );
        crate::switch::switch_profile_to(&profiles, &root, second_id, unlocked(), opts(), |_| {})
            .unwrap();
        assert_eq!(
            crate::hud::live_hud_names(&root)
                .iter()
                .map(|hud| hud.name.as_str())
                .collect::<Vec<_>>(),
            ["Alpha"]
        );
        cleanup(&dir);
    }

    #[test]
    fn profile_import_refuses_real_hud_vpks_but_keeps_ordinary_and_opaque_vpks() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let root = dir.join("tf2");
        seed_live(&root);
        let path = dir.join("vpk.zip");
        let hud = crate::vpk::write_vpk_v1(&BTreeMap::from([(
            "info.vdf".into(),
            b"\"HUD\" { \"ui_version\" \"3\" }".to_vec(),
        )]));
        write_raw_zip(&path, &[("custom/hud.vpk", &hud)]);
        let before = snapshot_tree(&root);
        let original = sha256_file(&path).unwrap();
        assert_eq!(
            creator::inspect_profile_import_from(&profiles, &root, &path, unlocked())
                .unwrap_err()
                .code(),
            "HudImportRequired"
        );
        assert_eq!(snapshot_tree(&root), before);
        assert_eq!(sha256_file(&path).unwrap(), original);
        let ordinary = crate::vpk::write_vpk_v1(&BTreeMap::from([(
            "info.vdf".into(),
            b"\"Addon\" { \"version\" \"3\" }".to_vec(),
        )]));
        write_raw_zip(
            &path,
            &[
                ("custom/ordinary.vpk", &ordinary),
                ("custom/opaque.vpk", b"legacy opaque bytes"),
            ],
        );
        let review =
            creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).unwrap();
        let imported =
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review)).unwrap();
        let id = &imported.profiles[0].id;
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, id, "tf/custom/ordinary.vpk")).unwrap(),
            ordinary
        );
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, id, "tf/custom/opaque.vpk")).unwrap(),
            b"legacy opaque bytes"
        );
        assert_eq!(snapshot_tree(&root), before);
        cleanup(&dir);
    }

    #[test]
    fn changing_imported_hud_preserves_approved_cfg_until_separate_option_reset_review() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let root = dir.join("tf2");
        seed_live(&root);
        let path = dir.join("options.zip");
        let info = b"\"HUD\" { \"ui_version\" \"3\" }\n";
        let autoexec = b"echo retained\nexec execs_hud_minmode // execs:managed\n";
        let options = b"cl_hud_minmode 1\n";
        write_raw_zip(
            &path,
            &[
                ("custom/Alpha/info.vdf", info),
                ("custom/Beta/info.vdf", info),
                ("cfg/autoexec.cfg", autoexec),
                ("cfg/execs_hud_minmode.cfg", options),
            ],
        );
        let original_zip = sha256_file(&path).unwrap();
        let mut review =
            creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).unwrap();
        review.select_hud(Some("Beta".into())).unwrap();
        let library =
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review)).unwrap();
        let id = &library.profiles[0].id;
        assert!(load_manifest(&profiles, id).unwrap().hud_review_pending);
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, id, "tf/cfg/autoexec.cfg")).unwrap(),
            autoexec
        );
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                id,
                "tf/cfg/execs_hud_minmode.cfg"
            ))
            .unwrap(),
            options
        );
        assert_eq!(
            crate::switch::validate_profile_switch_target(&profiles, &root, id).unwrap_err(),
            ProfileError::HudReviewRequired
        );
        let ownership = crate::hud::get_hud_ownership_to(&profiles, &root, id).unwrap();
        assert!(ownership.reset_options);
        assert_eq!(
            ownership.managed_option_files,
            ["tf/cfg/execs_hud_minmode.cfg"]
        );
        crate::hud::select_profile_hud_to(
            &profiles,
            &root,
            id,
            "Beta",
            &ownership.fingerprint,
            unlocked(),
        )
        .unwrap();
        let after = load_manifest(&profiles, id).unwrap();
        assert!(!after.hud_review_pending);
        assert!(!after
            .files
            .iter()
            .any(|file| file.path == "tf/cfg/execs_hud_minmode.cfg"));
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, id, "tf/cfg/autoexec.cfg")).unwrap(),
            b"echo retained\n"
        );
        let backup = fs::read_dir(profiles.join(id).join("hud-backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read(backup.join("files/tf/cfg/autoexec.cfg")).unwrap(),
            autoexec
        );
        assert_eq!(
            fs::read(backup.join("files/tf/cfg/execs_hud_minmode.cfg")).unwrap(),
            options
        );
        assert_eq!(sha256_file(&path).unwrap(), original_zip);
        crate::switch::validate_profile_switch_target(&profiles, &root, id).unwrap();
        cleanup(&dir);
    }

    #[test]
    fn creator_vpk_review_preserves_approved_bytes_through_export() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("tf2");
        write_live(&root.join("tf/cfg/config_default.cfg"), "password \"0\"\n");
        let path = dir.join("creator.zip");
        let pack = crate::vpk::write_vpk_v2(&BTreeMap::from([(
            "cfg/autoexec.cfg".into(),
            b"password saved-server-password\nsv_cheats 1\n".to_vec(),
        )]));
        write_raw_zip(&path, &[("custom/creator.vpk", &pack)]);
        let review =
            creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).unwrap();
        assert!(review
            .warnings
            .iter()
            .any(|warning| warning.contains("creator.vpk/cfg/autoexec.cfg:1")
                && warning.contains("password")));
        let imported =
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review)).unwrap();
        let id = &imported.profiles[0].id;
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, id, "tf/custom/creator.vpk")).unwrap(),
            pack
        );
        let destination = dir.join("export.zip");
        fs::write(&destination, b"keep existing export").unwrap();
        export_profile_to(&profiles, &root, id, &destination).unwrap();
        let mut exported = ZipArchive::new(fs::File::open(&destination).unwrap()).unwrap();
        let mut contents = Vec::new();
        exported
            .by_name("files/tf/custom/creator.vpk")
            .unwrap()
            .read_to_end(&mut contents)
            .unwrap();
        assert_eq!(contents, pack);

        let before = snapshot_tree(&profiles);
        write_raw_zip(
            &path,
            &[("custom/creator.vpk", &0x55aa_1234u32.to_le_bytes())],
        );
        assert!(creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).is_err());
        assert!(
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review)).is_err()
        );
        assert_eq!(snapshot_tree(&profiles), before);
        cleanup(&dir);
    }

    #[test]
    fn creator_review_never_waives_archive_integrity() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("tf2");
        let path = dir.join("creator.zip");
        let cases: Vec<Vec<(&str, &[u8])>> = vec![
            vec![("../cfg/autoexec.cfg", b"echo bad")],
            vec![("/cfg/autoexec.cfg", b"echo bad")],
            vec![("cfg/../autoexec.cfg", b"echo bad")],
            vec![
                ("cfg/autoexec.cfg", b"echo one"),
                ("cfg/AUTOEXEC.cfg", b"echo two"),
            ],
            vec![
                ("one/cfg/autoexec.cfg", b"echo one"),
                ("two/cfg/other.cfg", b"echo two"),
            ],
            vec![("custom/mod.zip", b"nested")],
            vec![("README.txt", b"no profile files")],
            vec![("cfg/autoexec.cfg", b"echo\0bad")],
            vec![
                ("execs-profile.json", b"broken native manifest"),
                ("cfg/autoexec.cfg", b"echo hi"),
            ],
        ];
        for entries in cases {
            write_raw_zip(&path, &entries);
            assert!(
                creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).is_err(),
                "{entries:?}"
            );
            assert!(load_library_from(&profiles, Some(&root))
                .unwrap()
                .profiles
                .is_empty());
            assert!(!profiles.join(IMPORT_STAGING_DIR).exists());
        }
        write_raw_zip(&path, &[("cfg/autoexec.cfg", b"echo hi")]);
        assert_eq!(
            creator::inspect_profile_import_from(&profiles, &root, &path, [tf2_name()])
                .unwrap_err()
                .code(),
            "GameRunning"
        );
        cleanup(&dir);
    }

    /// Run against a user's archive without redistributing their content or
    /// touching their real installation/library. Set EXECS_CREATOR_ZIP explicitly.
    #[test]
    #[ignore = "requires a local creator ZIP via EXECS_CREATOR_ZIP"]
    fn local_creator_zip_import_and_switch() {
        let path =
            PathBuf::from(std::env::var_os("EXECS_CREATOR_ZIP").expect("set EXECS_CREATOR_ZIP"));
        // A fresh, short root avoids stale PID reuse and the Win32 path limit
        // of the test executable (which has no desktop longPathAware manifest).
        let dir = std::env::temp_dir().join(format!("execs-{}", &random_token()[..12]));
        fs::create_dir(&dir).unwrap();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("tf2");
        seed_live(&root);
        let saved = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let before = snapshot_tree(&root);
        let review =
            creator::inspect_profile_import_from(&profiles, &root, &path, unlocked()).unwrap();
        eprintln!("Review: {review:?}");
        assert!(review.creator);
        let imported =
            import_profile_with_review(&profiles, &root, &path, unlocked(), Some(&review)).unwrap();
        assert_eq!(imported.profiles.len(), 2);
        assert_eq!(imported.active_profile_id, saved.active_profile_id);
        assert_eq!(snapshot_tree(&root), before);
        let id = &imported
            .profiles
            .iter()
            .find(|p| Some(&p.id) != saved.active_profile_id.as_ref())
            .unwrap()
            .id;
        let manifest = load_manifest(&profiles, id).unwrap();
        assert_eq!(manifest.files.len(), review.files);
        let no_steam = Vec::new();
        crate::switch::switch_profile_to(
            &profiles,
            &root,
            id,
            unlocked(),
            crate::absorb::AbsorbOptions {
                steam_roots: Some(&no_steam),
                ..Default::default()
            },
            |_| {},
        )
        .unwrap();
        for file in &manifest.files {
            assert_eq!(
                sha256_file(&root.join(&file.path)).unwrap(),
                file.sha256,
                "{}",
                file.path
            );
        }
        // Returning to the original profile restores its cfg and custom files.
        crate::switch::switch_profile_to(
            &profiles,
            &root,
            saved.active_profile_id.as_ref().unwrap(),
            unlocked(),
            crate::absorb::AbsorbOptions {
                steam_roots: Some(&no_steam),
                ..Default::default()
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(snapshot_tree(&root), before);
        cleanup(&dir);
    }

    /// The importer must not `read_to_end` every entry into RAM before a single
    /// byte is validated: a deflate bomb OOM-kills the app.
    #[test]
    fn import_refuses_an_absurd_compression_ratio() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();
        let zip_path = dir.join("bomb.zip");
        // Anything above the bounded floor still trips the ratio guard before
        // the stream can consume an attacker-controlled amount of disk.
        let zeros = vec![0u8; COMPRESSION_RATIO_FLOOR as usize + 1];
        write_raw_zip(
            &zip_path,
            &[
                ("execs-profile.json", RAW_MANIFEST),
                ("files/tf/cfg/bomb.cfg", &zeros),
            ],
        );

        let err = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap_err();
        assert!(
            matches!(err, ProfileError::Io(ref msg) if msg.contains("decompresses more than")),
            "{err:?}"
        );
        // The staging tree is removed however the import returns.
        assert!(!profiles.join(IMPORT_STAGING_DIR).exists());
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .is_empty());
        cleanup(&dir);
    }

    #[test]
    fn entry_budget_refuses_oversized_and_over_total() {
        // Bigger than the per-entry cap.
        assert!(
            check_entry_budget(MAX_ENTRY_UNCOMPRESSED + 1, MAX_ENTRY_UNCOMPRESSED, "x", 0).is_err()
        );
        // Would push the archive past the total cap.
        assert!(check_entry_budget(1024, 1024, "x", MAX_TOTAL_UNCOMPRESSED).is_err());
        // Ordinary, incompressible-ish content is fine.
        assert!(check_entry_budget(1024 * 1024, 900 * 1024, "x", 0).is_ok());
        // A stored (uncompressed) entry has a ratio of 1.
        assert!(check_entry_budget(4096, 4096, "x", 0).is_ok());
        // Small repetitive assets are allowed, but the exemption is bounded.
        assert!(check_entry_budget(COMPRESSION_RATIO_FLOOR, 1, "x", 0).is_ok());
        assert!(check_entry_budget(COMPRESSION_RATIO_FLOOR + 1, 1, "x", 0).is_err());
        assert!(check_entry_budget(1, 0, "x", 0).is_err());
        assert!(check_total_compression_ratio(COMPRESSION_RATIO_FLOOR, 1).is_ok());
        assert!(check_total_compression_ratio(COMPRESSION_RATIO_FLOOR + 1, 1).is_err());
    }

    #[test]
    fn streamed_entry_is_checked_against_actual_size_and_ratio() {
        let dir = crate::test_temp_dir();
        let dest = dir.join("entry");
        let mut understated = Cursor::new(b"12345".as_slice());
        let err = stream_entry(&dir, &mut understated, &dest, "entry", 0, 4, 4).unwrap_err();
        assert!(err.message().contains("zip header"), "{err:?}");

        let expanded = COMPRESSION_RATIO_FLOOR + 1;
        let err = check_actual_entry_budget(expanded, expanded, 1, "entry", 0).unwrap_err();
        assert!(err.message().contains("decompresses more"), "{err:?}");
        let err = check_actual_entry_budget(
            MAX_ENTRY_UNCOMPRESSED + 1,
            MAX_ENTRY_UNCOMPRESSED + 1,
            MAX_ENTRY_UNCOMPRESSED + 1,
            "entry",
            0,
        )
        .unwrap_err();
        assert!(err.message().contains("larger than 1 GiB"), "{err:?}");
        let err = check_actual_entry_budget(1, 1, 1, "entry", MAX_TOTAL_UNCOMPRESSED).unwrap_err();
        assert!(err.message().contains("more than 2 GiB"), "{err:?}");
        cleanup(&dir);
    }

    #[test]
    fn linked_import_staging_cannot_redirect_recursive_cleanup() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let victim = dir.join("victim");
        fs::create_dir_all(&profiles).unwrap();
        fs::create_dir_all(&victim).unwrap();
        let victim_file = victim.join("keep.bin");
        fs::write(&victim_file, b"outside must survive").unwrap();
        let staging = profiles.join(IMPORT_STAGING_DIR);
        link_dir(&victim, &staging);

        let error = StagingDir::create(&profiles).unwrap_err();

        assert!(error.message().contains("link"), "{error:?}");
        assert_eq!(fs::read(&victim_file).unwrap(), b"outside must survive");
        unlink_dir(&staging);
        cleanup(&dir);
    }

    fn seed_live(root: &Path) {
        write_live(
            &root.join("tf/cfg/config_default.cfg"),
            "unbindall\nbind w +forward\n",
        );
        write_live(
            &root.join("tf/cfg/overrides/autoexec.cfg"),
            "fov_desired 90\n",
        );
        write_live(&root.join("tf/custom/mastercomfig-base.vpk"), "shared-vpk");
        write_live(&root.join("tf/cfg/config.cfg"), "unbindall\n");
        write_live(&root.join("tf/steam.inf"), "appID=440\n");
    }

    #[test]
    fn safe_name_strips_path_chars() {
        assert_eq!(safe_zip_file_name("Main"), "Main.zip");
        assert_eq!(safe_zip_file_name("a/b\\c:d"), "a-b-c-d.zip");
        assert_eq!(safe_zip_file_name("   "), "profile.zip");
    }

    #[test]
    fn round_trip_export_import() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);
        let before = snapshot_tree(&root);

        let saved = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-novid -console"),
                cloud_config: None,
            },
        )
        .unwrap();
        let src_id = saved.profiles[0].id.clone();
        assert_eq!(saved.active_profile_id.as_deref(), Some(src_id.as_str()));

        let zip_path = dir.join("main.zip");
        export_profile_to(&profiles, &root, &src_id, &zip_path).unwrap();

        let imported = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        assert_eq!(imported.profiles.len(), 2);
        assert_eq!(imported.active_profile_id.as_deref(), Some(src_id.as_str()));
        let new_id = imported
            .profiles
            .iter()
            .find(|profile| profile.id != src_id)
            .unwrap()
            .id
            .clone();
        assert_ne!(new_id, src_id);
        assert_eq!(
            imported
                .profiles
                .iter()
                .find(|p| p.id == new_id)
                .unwrap()
                .name,
            "Main"
        );

        let src = load_manifest(&profiles, &src_id).unwrap();
        let dst = load_manifest(&profiles, &new_id).unwrap();
        assert_eq!(dst.name, "Main");
        assert_eq!(dst.launch_options, "-novid -console");
        assert!(dst.launch_sync_pending);
        assert_eq!(dst.tf2_root, root.to_string_lossy());
        assert_eq!(src.files.len(), dst.files.len());
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                &new_id,
                "tf/cfg/overrides/autoexec.cfg"
            ))
            .unwrap(),
            b"fov_desired 90\n"
        );
        let shared = dst
            .files
            .iter()
            .find(|file| file.storage == FileStorage::Shared)
            .unwrap();
        assert_eq!(shared.sha256, sha256_hex(b"shared-vpk"));
        assert!(blob_path(&profiles, &shared.sha256).is_file());
        assert_eq!(snapshot_tree(&root), before);
        cleanup(&dir);
    }

    #[test]
    fn highly_compressible_texture_round_trips_through_profile_export() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);

        let rel = "tf/custom/repetitive/materials/vgui/refract.vtf";
        let source = root.join(rel);
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        let mut texture = vec![0u8; 262_352];
        texture[..4].copy_from_slice(b"VTF\0");
        fs::write(&source, &texture).unwrap();

        let saved = save_current_as_to(
            &profiles,
            &root,
            "Repetitive texture",
            unlocked(),
            SaveCurrentOptions {
                launch_options: None,
                cloud_config: None,
            },
        )
        .unwrap();
        let source_id = saved.profiles[0].id.clone();
        let zip_path = dir.join("repetitive-texture.zip");
        export_profile_to(&profiles, &root, &source_id, &zip_path).unwrap();

        let mut archive = ZipArchive::new(fs::File::open(&zip_path).unwrap()).unwrap();
        let entry = archive.by_name(&format!("files/{rel}")).unwrap();
        assert!(entry.size() > entry.compressed_size() * MAX_COMPRESSION_RATIO);
        assert!(entry.size() <= COMPRESSION_RATIO_FLOOR);
        drop(entry);
        drop(archive);

        let library = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        let imported_id = library
            .profiles
            .iter()
            .find(|profile| profile.id != source_id)
            .unwrap()
            .id
            .clone();
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &imported_id, rel)).unwrap(),
            texture
        );
        cleanup(&dir);
    }

    #[test]
    fn import_never_trusts_sender_launch_projection_state() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();
        let zip_path = dir.join("pending.zip");
        write_raw_zip(
            &zip_path,
            &[(
                "execs-profile.json",
                br#"{
                    "schema": 1,
                    "name": "Imported",
                    "launchOptions": "-novid",
                    "launchSyncPending": false,
                    "files": []
                }"#,
            )],
        );
        let library = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        let manifest = load_manifest(&profiles, &library.profiles[0].id).unwrap();
        assert!(manifest.launch_sync_pending);
        cleanup(&dir);
    }

    #[test]
    fn failed_publication_is_invisible_and_a_retry_creates_one_complete_profile() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();
        let rel = "tf/custom/imported/materials/a.vmt";
        let body = b"material";
        let manifest = ProfileZipManifest {
            schema: ZIP_SCHEMA,
            name: "Atomic import".into(),
            launch_options: String::new(),
            files: vec![ProfileFile {
                path: rel.into(),
                sha256: sha256_hex(body),
                storage: FileStorage::Exclusive,
            }],
            id: None,
            tf2_root: None,
            hud: None,
            hud_selected_root: None,
            hud_review_pending: false,
            crosshair: None,
            viewmodel: None,
            hitsound: None,
            mods: Vec::new(),
            preloader: None,
            ignored_packs: Vec::new(),
        };
        let json = serde_json::to_vec(&manifest).unwrap();
        let zip_path = dir.join("atomic.zip");
        write_raw_zip(
            &zip_path,
            &[
                ("execs-profile.json", &json),
                (&format!("files/{rel}"), body),
            ],
        );

        // Force the durable index publication to fail after the complete
        // profile directory has already been moved out of hidden staging.
        let blocked_part = part_path(&index_file(&profiles));
        fs::create_dir_all(&blocked_part).unwrap();
        assert!(import_profile_from(&profiles, &root, &zip_path, unlocked()).is_err());
        assert!(
            load_library_from(&profiles, Some(&root))
                .unwrap()
                .profiles
                .is_empty(),
            "a failed publication must not expose an empty or partial profile"
        );
        assert!(!profiles.join(IMPORT_STAGING_DIR).exists());
        assert!(!profiles.join(".create-data").exists());

        fs::remove_dir(&blocked_part).unwrap();
        let library = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        assert_eq!(library.profiles.len(), 1);
        let imported = load_manifest(&profiles, &library.profiles[0].id).unwrap();
        assert_eq!(imported.files.len(), 1);
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &imported.id, rel)).unwrap(),
            body
        );
        cleanup(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn export_cleans_legacy_verbatim_root_without_mutating_library() {
        use crate::profile::{index_file, manifest_file};
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);
        let saved = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let id = saved.profiles[0].id.clone();
        let legacy = format!(r"\\?\{}", root.display());

        for path in [index_file(&profiles), manifest_file(&profiles, &id)] {
            let mut json: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            json["tf2Root"] = serde_json::Value::String(legacy.clone());
            fs::write(
                &path,
                format!("{}\n", serde_json::to_string_pretty(&json).unwrap()),
            )
            .unwrap();
        }
        let index_before = fs::read(index_file(&profiles)).unwrap();
        let manifest_before = fs::read(manifest_file(&profiles, &id)).unwrap();

        let zip_path = dir.join("main.zip");
        export_profile_to(&profiles, &root, &id, &zip_path).unwrap();
        let staging = StagingDir::create(&profiles).unwrap();
        let exported = read_profile_zip(&zip_path, &profiles, &staging.path).unwrap();
        assert_eq!(exported.manifest.tf2_root, None);
        assert_eq!(exported.manifest.id, None);
        assert_eq!(fs::read(index_file(&profiles)).unwrap(), index_before);
        assert_eq!(
            fs::read(manifest_file(&profiles, &id)).unwrap(),
            manifest_before
        );
        cleanup(&dir);
    }

    #[test]
    fn shared_blob_dedup_on_import() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);

        let saved = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap();
        let zip_path = dir.join("main.zip");
        export_profile_to(&profiles, &root, &saved.profiles[0].id, &zip_path).unwrap();

        import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        assert_eq!(count_blob_files(&profiles), 1);
        assert_eq!(
            load_library_from(&profiles, Some(&root))
                .unwrap()
                .profiles
                .len(),
            3
        );
        cleanup(&dir);
    }

    #[test]
    fn zip_slip_rejected() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();
        let zip_path = dir.join("slip.zip");
        write_raw_zip(
            &zip_path,
            &[
                (
                    "execs-profile.json",
                    br#"{
  "schema": 1,
  "name": "Slip",
  "launchOptions": "",
  "files": []
}
"#,
                ),
                ("../escape.cfg", b"pwn"),
            ],
        );

        let err = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap_err();
        assert_eq!(err, ProfileError::InvalidPath);
        assert!(!dir.join("escape.cfg").is_file());
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .is_empty());
        cleanup(&dir);
    }

    #[test]
    fn forbidden_paths_rejected() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();

        for (entry, bytes) in [
            ("files/tf/steam.inf", b"appID=440\n".as_slice()),
            ("files/tf/gameinfo.txt", b"game\n".as_slice()),
            ("files/tf/cfg/video.txt", b"video\n".as_slice()),
            ("files/tf/tf2_misc_dir.vpk", b"official\n".as_slice()),
            ("files/tf/cfg/config_default.cfg", b"stock\n".as_slice()),
            ("files/tf/cfg/valve.rc", b"stock\n".as_slice()),
            (
                "files/tf/custom/execs-preloader.vpk",
                b"global\n".as_slice(),
            ),
            ("files/tf/custom/readme.txt", b"stock\n".as_slice()),
        ] {
            let zip_path = dir.join("forbidden.zip");
            write_raw_zip(
                &zip_path,
                &[
                    (
                        "execs-profile.json",
                        br#"{
  "schema": 1,
  "name": "Bad",
  "launchOptions": "",
  "files": []
}
"#,
                    ),
                    (entry, bytes),
                ],
            );
            let err = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap_err();
            assert!(
                matches!(err, ProfileError::ForbiddenPath(_)),
                "{entry} => {err:?}"
            );
        }

        let nested = dir.join("nested.zip");
        write_raw_zip(
            &nested,
            &[
                (
                    "execs-profile.json",
                    br#"{
  "schema": 1,
  "name": "Nested",
  "launchOptions": "",
  "files": []
}
"#,
                ),
                ("files/tf/custom/pack.zip", b"inner"),
            ],
        );
        let err = import_profile_from(&profiles, &root, &nested, unlocked()).unwrap_err();
        assert_eq!(err.code(), "Io");
        assert!(err.message().contains("nested"));
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .is_empty());
        cleanup(&dir);
    }

    #[test]
    fn profile_zip_paths_use_portable_collision_rules() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();

        let one = sha256_hex(b"one");
        let two = sha256_hex(b"two");
        let manifest = format!(
            r#"{{
  "schema": 1,
  "name": "Collision",
  "files": [
    {{"path":"tf/cfg/overrides/Foo.cfg","sha256":"{one}","storage":"exclusive"}},
    {{"path":"tf/cfg/overrides/foo.cfg","sha256":"{two}","storage":"exclusive"}}
  ]
}}"#
        );
        let zip_path = dir.join("collision.zip");
        write_raw_zip(
            &zip_path,
            &[
                ("execs-profile.json", manifest.as_bytes()),
                ("files/tf/cfg/overrides/Foo.cfg", b"one"),
                ("files/tf/cfg/overrides/foo.cfg", b"two"),
            ],
        );
        let err = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap_err();
        assert!(err.message().contains("colliding"), "{}", err.message());

        let trailing = dir.join("trailing.zip");
        write_raw_zip(
            &trailing,
            &[
                ("execs-profile.json", RAW_MANIFEST),
                ("files/tf/cfg/overrides/trailing.cfg.", b"x"),
            ],
        );
        assert!(import_profile_from(&profiles, &root, &trailing, unlocked()).is_err());
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .is_empty());
        cleanup(&dir);
    }

    #[test]
    fn tf2_root_rewritten_and_launch_sanitized() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        fs::create_dir_all(root.join("tf/custom")).unwrap();

        let cfg = b"fov_desired 90\n";
        let hash = sha256_hex(cfg);
        let json = format!(
            r#"{{
  "schema": 1,
  "name": "FromOtherBox",
  "launchOptions": "-novid -autoconfig -dxlevel 90 -console",
  "tf2Root": "/old/machine/Team Fortress 2",
  "id": "old-id",
  "files": [{{"path": "tf/cfg/overrides/autoexec.cfg", "sha256": "{hash}", "storage": "exclusive"}}]
}}
"#
        );
        let zip_path = dir.join("other.zip");
        write_raw_zip(
            &zip_path,
            &[
                ("execs-profile.json", json.as_bytes()),
                ("files/tf/cfg/overrides/autoexec.cfg", cfg),
            ],
        );

        let imported = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        assert_eq!(imported.profiles.len(), 1);
        assert!(imported.active_profile_id.is_none());
        let id = &imported.profiles[0].id;
        assert_ne!(id, "old-id");
        let manifest = load_manifest(&profiles, id).unwrap();
        assert_eq!(manifest.tf2_root, root.to_string_lossy());
        assert_ne!(manifest.tf2_root, "/old/machine/Team Fortress 2");
        assert_eq!(manifest.launch_options, "-novid -console");
        cleanup(&dir);
    }

    #[test]
    fn import_rejects_entries_outside_the_file_safe_surface() {
        // The old denylist accepted both of these: the game binary and the
        // `tf/cfg/user/` folder AGENTS.md forbids twice. A manifest file is
        // copied straight into the live tree by the next switch.
        for (entry, storage_path) in [
            ("files/bin/x64/client.dll", "bin/x64/client.dll"),
            ("files/tf/cfg/user/autoexec.cfg", "tf/cfg/user/autoexec.cfg"),
        ] {
            let dir = crate::test_temp_dir();
            let profiles = dir.join("execs").join("profiles");
            let root = dir.join("Team Fortress 2");
            fs::create_dir_all(root.join("tf/custom")).unwrap();

            let payload = b"pwned";
            let hash = sha256_hex(payload);
            let json = format!(
                r#"{{
  "schema": 1,
  "name": "Evil",
  "launchOptions": "",
  "files": [{{"path": "{storage_path}", "sha256": "{hash}", "storage": "exclusive"}}]
}}
"#
            );
            let zip_path = dir.join("evil.zip");
            write_raw_zip(
                &zip_path,
                &[("execs-profile.json", json.as_bytes()), (entry, payload)],
            );

            let err = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap_err();
            assert_eq!(err.code(), "ForbiddenPath", "{entry}");
            assert!(
                load_library_from(&profiles, Some(&root))
                    .unwrap()
                    .profiles
                    .is_empty(),
                "a rejected import must leave no profile record"
            );
            assert!(!root.join(storage_path).exists());
            cleanup(&dir);
        }
    }

    #[test]
    fn import_does_not_set_active_profile_id() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);

        let saved = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap();
        let active = saved.active_profile_id.clone();
        let zip_path = dir.join("main.zip");
        export_profile_to(&profiles, &root, &saved.profiles[0].id, &zip_path).unwrap();

        let imported = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        assert_eq!(imported.active_profile_id, active);
        cleanup(&dir);
    }

    #[test]
    fn import_refuses_while_tf2_running() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);
        let saved = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some(""),
                cloud_config: None,
            },
        )
        .unwrap();
        let zip_path = dir.join("main.zip");
        export_profile_to(&profiles, &root, &saved.profiles[0].id, &zip_path).unwrap();

        let err = import_profile_from(&profiles, &root, &zip_path, [tf2_name()]).unwrap_err();
        assert_eq!(err, ProfileError::GameRunning);
        assert_eq!(
            load_library_from(&profiles, Some(&root))
                .unwrap()
                .profiles
                .len(),
            1
        );
        cleanup(&dir);
    }

    #[test]
    fn hostile_cfg_and_launch_payloads_are_rejected_before_profile_creation() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();

        let cfg = b"bind mouse1 \"echo ready; connect bad.example\"\n";
        let hash = sha256_hex(cfg);
        let manifest = format!(
            r#"{{"schema":1,"name":"Hostile","files":[{{"path":"tf/cfg/overrides/autoexec.cfg","sha256":"{hash}","storage":"exclusive"}}]}}"#
        );
        let cfg_zip = dir.join("hostile-cfg.zip");
        write_raw_zip(
            &cfg_zip,
            &[
                ("execs-profile.json", manifest.as_bytes()),
                ("files/tf/cfg/overrides/autoexec.cfg", cfg),
            ],
        );
        let err = import_profile_from(&profiles, &root, &cfg_zip, unlocked()).unwrap_err();
        assert!(err.message().contains("connect"), "{}", err.message());

        let launch_zip = dir.join("hostile-launch.zip");
        let launch_manifest = br#"{
  "schema": 1,
  "name": "Hostile launch",
  "launchOptions": "+bind f \"connect bad.example\"",
  "files": []
}"#;
        write_raw_zip(
            &launch_zip,
            &[("execs-profile.json", launch_manifest.as_slice())],
        );
        let err = import_profile_from(&profiles, &root, &launch_zip, unlocked()).unwrap_err();
        assert!(err.message().contains("connect"), "{}", err.message());
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .is_empty());
        cleanup(&dir);
    }

    #[test]
    fn signed_vpk_that_exceeds_parser_limits_fails_closed() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();

        // Source can mount a directory this large, but our untrusted VPK
        // reader deliberately caps it at 20,000 entries. A parser-limit error
        // must not turn into permission to skip inspection of the executable
        // cfg carried alongside those entries.
        let mut files = BTreeMap::new();
        files.insert(
            "cfg/autoexec.cfg".to_string(),
            b"connect attacker.example\n".to_vec(),
        );
        for index in 0..20_000 {
            files.insert(format!("materials/empty-{index}.vmt"), Vec::new());
        }
        let vpk = crate::vpk::write_vpk_v1(&files);
        let hash = sha256_hex(&vpk);
        let manifest = format!(
            r#"{{
  "schema": 1,
  "name": "Oversized VPK",
  "files": [{{"path":"tf/custom/hostile.vpk","sha256":"{hash}","storage":"exclusive"}}]
}}"#
        );
        let zip_path = dir.join("oversized-vpk.zip");
        write_raw_zip(
            &zip_path,
            &[
                ("execs-profile.json", manifest.as_bytes()),
                ("files/tf/custom/hostile.vpk", &vpk),
            ],
        );

        let err = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap_err();
        assert!(err.message().contains("invalid profile VPK"), "{err:?}");
        assert!(load_library_from(&profiles, Some(&root))
            .unwrap()
            .profiles
            .is_empty());
        cleanup(&dir);
    }

    #[test]
    fn export_replaces_destination_and_preserves_credentials() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);
        write_live(&root.join("tf/cfg/config.cfg"), "password hunter2\n");
        let saved = save_current_as_to(
            &profiles,
            &root,
            "Private",
            unlocked(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let destination = dir.join("existing.zip");
        fs::write(&destination, b"previous export").unwrap();
        let locations =
            inspect_profile_export_credentials_from(&profiles, &root, &saved.profiles[0].id)
                .unwrap();
        assert_eq!(locations, ["tf/cfg/config.cfg:1"]);
        assert!(!format!("{locations:?}").contains("hunter2"));
        export_profile_to(&profiles, &root, &saved.profiles[0].id, &destination).unwrap();
        assert_ne!(fs::read(&destination).unwrap(), b"previous export");
        let imported = import_profile_from(&profiles, &root, &destination, unlocked()).unwrap();
        assert_eq!(imported.profiles.len(), 2);
        let imported_id = &imported.profiles[1].id;
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                imported_id,
                "tf/cfg/config.cfg"
            ))
            .unwrap(),
            b"password hunter2\n"
        );
        assert!(!fs::read_dir(&dir).unwrap().flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".existing.zip.")
        }));
        cleanup(&dir);
    }

    #[test]
    fn export_preserves_exclusive_and_shared_vpk_cfgs() {
        for pack in ["private-config.vpk", "mastercomfig-base.vpk"] {
            let dir = crate::test_temp_dir();
            let profiles = dir.join("profiles");
            let root = dir.join("tf2");
            seed_live(&root);
            let private = crate::vpk::write_vpk_v2(&BTreeMap::from([(
                "cfg/private-server.cfg".into(),
                b"rcon_password audit_dummy_never_a_real_secret\n".to_vec(),
            )]));
            fs::write(root.join("tf/custom").join(pack), &private).unwrap();
            let saved = save_current_as_to(
                &profiles,
                &root,
                "Private",
                unlocked(),
                SaveCurrentOptions::default(),
            )
            .unwrap();
            let before = snapshot_tree(&profiles);
            let destination = dir.join("existing.zip");
            fs::write(&destination, b"previous export").unwrap();
            let locations =
                inspect_profile_export_credentials_from(&profiles, &root, &saved.profiles[0].id)
                    .unwrap();
            assert!(locations.iter().any(|location| {
                location == &format!("tf/custom/{pack}/cfg/private-server.cfg:1")
            }));
            assert!(!format!("{locations:?}").contains("audit_dummy_never_a_real_secret"));
            export_profile_to(&profiles, &root, &saved.profiles[0].id, &destination).unwrap();
            assert_ne!(fs::read(&destination).unwrap(), b"previous export");
            assert_eq!(snapshot_tree(&profiles), before);
            let imported = import_profile_from(&profiles, &root, &destination, unlocked()).unwrap();
            assert_eq!(imported.profiles.len(), 2);
            assert!(!fs::read_dir(&dir)
                .unwrap()
                .flatten()
                .any(|entry| entry.file_name().to_string_lossy().contains("execs-part")));
            cleanup(&dir);
        }
    }

    #[test]
    fn malformed_signed_vpk_export_fails_but_opaque_legacy_packs_roundtrip() {
        for bytes in [
            vec![0x34, 0x12, 0xaa, 0x55],
            b"legacy opaque placeholder".to_vec(),
        ] {
            let dir = crate::test_temp_dir();
            let profiles = dir.join("profiles");
            let root = dir.join("tf2");
            seed_live(&root);
            write_live(&root.join("tf/cfg/config.cfg"), "password \"0\"\n");
            // New captures already reject malformed signed VPKs while reading
            // the cfg loader. Seed the old opaque format first, then model a
            // historical library record to exercise export's independent guard.
            fs::write(
                root.join("tf/custom/legacy.vpk"),
                b"legacy opaque placeholder",
            )
            .unwrap();
            let saved = save_current_as_to(
                &profiles,
                &root,
                "Legacy",
                unlocked(),
                SaveCurrentOptions::default(),
            )
            .unwrap();
            let id = &saved.profiles[0].id;
            let rel = "tf/custom/legacy.vpk";
            fs::write(exclusive_file_path(&profiles, id, rel), &bytes).unwrap();
            let mut manifest = load_manifest(&profiles, id).unwrap();
            manifest
                .files
                .iter_mut()
                .find(|file| file.path == rel)
                .unwrap()
                .sha256 = sha256_hex(&bytes);
            fs::write(
                crate::profile::manifest_file(&profiles, id),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
            let destination = dir.join("existing.zip");
            fs::write(&destination, b"previous export").unwrap();
            let result = export_profile_to(&profiles, &root, &saved.profiles[0].id, &destination);
            if bytes.len() == 4 {
                assert!(result
                    .unwrap_err()
                    .message()
                    .contains("invalid profile VPK"));
                assert_eq!(fs::read(&destination).unwrap(), b"previous export");
            } else {
                result.unwrap();
                let imported =
                    import_profile_from(&profiles, &root, &destination, unlocked()).unwrap();
                assert_eq!(imported.profiles.len(), 2);
            }
            cleanup(&dir);
        }
    }

    #[test]
    fn valid_vpk_export_roundtrips_exact_members_and_engine_unset_password() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let root = dir.join("tf2");
        seed_live(&root);
        write_live(&root.join("tf/cfg/config.cfg"), "password \"0\"\n");
        let pack = crate::vpk::write_vpk_v2(&BTreeMap::from([
            ("cfg/settings.cfg".into(), b"sensitivity 2\n".to_vec()),
            (
                "materials/private.txt".into(),
                b"rcon_password not_a_cfg\n".to_vec(),
            ),
        ]));
        fs::write(root.join("tf/custom/materials.vpk"), &pack).unwrap();
        let saved = save_current_as_to(
            &profiles,
            &root,
            "Safe",
            unlocked(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let destination = dir.join("safe.zip");
        export_profile_to(&profiles, &root, &saved.profiles[0].id, &destination).unwrap();
        let imported = import_profile_from(&profiles, &root, &destination, unlocked()).unwrap();
        let id = &imported
            .profiles
            .iter()
            .find(|profile| profile.id != saved.profiles[0].id)
            .unwrap()
            .id;
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                id,
                "tf/custom/materials.vpk"
            ))
            .unwrap(),
            pack
        );
        cleanup(&dir);
    }

    #[test]
    fn vpk_inspection_and_copy_both_refuse_changed_sources() {
        let dir = crate::test_temp_dir();
        let path = dir.join("source.vpk");
        let original = crate::vpk::write_vpk_v2(&BTreeMap::from([(
            "cfg/settings.cfg".into(),
            b"sensitivity 2\n".to_vec(),
        )]));
        let changed = crate::vpk::write_vpk_v2(&BTreeMap::from([(
            "cfg/settings.cfg".into(),
            b"sensitivity 3\n".to_vec(),
        )]));
        fs::write(&path, &original).unwrap();
        let hash = sha256_hex(&original);
        let (mut source, len) = open_verified_source(&dir, &path, &hash, "source.vpk").unwrap();
        fs::write(&path, &changed).unwrap();
        let err =
            read_validated_export_cfg_source("source.vpk", &mut source, len, &hash).unwrap_err();
        assert!(err.message().contains("changed"), "{err:?}");
        fs::write(&path, &original).unwrap();
        source.seek(SeekFrom::Start(0)).unwrap();
        read_validated_export_cfg_source("source.vpk", &mut source, len, &hash).unwrap();
        fs::write(&path, &changed).unwrap();
        let mut zip = ZipWriter::new(fs::File::create(dir.join("temporary.zip")).unwrap());
        zip.start_file("pack.vpk", file_options()).unwrap();
        assert!(
            copy_into_zip_verified(&mut source, &mut zip, len, &hash, "source.vpk")
                .unwrap_err()
                .message()
                .contains("changed")
        );
        drop(zip);
        cleanup(&dir);
    }

    #[test]
    fn public_schema_one_zip_without_new_fields_can_be_repaired_and_roundtripped() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("profiles");
        let root = dir.join("tf2");
        seed_live(&root);
        init_library_to(&profiles, &root, unlocked()).unwrap();
        let before_live = snapshot_tree(&root);
        let cfg = b"password \"0\"\nsensitivity 2\n";
        let info = b"\"Legacy HUD\" { \"ui_version\" \"3\" }\n";
        // Literal public schema-1 format: no new diagnostic/recovery fields,
        // no metadata inferred from the current Rust struct serializer.
        let manifest = format!(
            r#"{{
          "schema": 1, "name": "Previous public profile",
          "files": [
            {{"path":"tf/cfg/config.cfg","sha256":"{}","storage":"exclusive"}},
            {{"path":"tf/custom/resource/info.vdf","sha256":"{}","storage":"exclusive"}}
          ],
          "hud": {{"id":"resource","source":"local"}}
        }}"#,
            sha256_hex(cfg),
            sha256_hex(info)
        );
        let original = dir.join("previous-public.zip");
        write_raw_zip(
            &original,
            &[
                (ZIP_MANIFEST_NAME, manifest.as_bytes()),
                ("files/tf/cfg/config.cfg", cfg),
                ("files/tf/custom/resource/info.vdf", info),
            ],
        );
        let original_hash = sha256_file(&original).unwrap();
        let imported = import_profile_from(&profiles, &root, &original, unlocked()).unwrap();
        assert!(imported.active_profile_id.is_none());
        assert_eq!(imported.profiles[0].unsafe_custom_folders, ["resource"]);
        let id = &imported.profiles[0].id;
        let before = load_manifest(&profiles, id).unwrap();
        assert_eq!(before.hud.as_ref().unwrap().id, "resource");
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                id,
                "tf/custom/resource/info.vdf"
            ))
            .unwrap(),
            info
        );
        assert!(crate::switch::validate_profile_switch_target(&profiles, &root, id).is_err());
        let plan =
            crate::custom_folders::plan_custom_folder_repair_to(&profiles, &root, id).unwrap();
        crate::custom_folders::repair_custom_folders_to(&profiles, &root, id, &plan, unlocked())
            .unwrap();
        let repaired = load_manifest(&profiles, id).unwrap();
        assert_eq!(repaired.schema, before.schema);
        assert_eq!(repaired.hud.as_ref().unwrap().id, "custom-resource");
        assert_eq!(snapshot_tree(&root), before_live);
        assert_eq!(sha256_file(&original).unwrap(), original_hash);
        let exported = dir.join("repaired.zip");
        export_profile_to(&profiles, &root, id, &exported).unwrap();
        let again = import_profile_from(&profiles, &root, &exported, unlocked()).unwrap();
        let second = &again
            .profiles
            .iter()
            .find(|profile| &profile.id != id)
            .unwrap()
            .id;
        assert_eq!(
            fs::read(exclusive_file_path(
                &profiles,
                second,
                "tf/custom/custom-resource/info.vdf"
            ))
            .unwrap(),
            info
        );
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, second, "tf/cfg/config.cfg")).unwrap(),
            cfg
        );
        crate::switch::validate_profile_switch_target(&profiles, &root, second).unwrap();
        cleanup(&dir);
    }

    #[test]
    fn mod_records_and_ignored_packs_survive_export_import() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);
        write_live(&root.join("tf/custom/my-mod/materials/a.vmt"), "vmt");
        write_live(
            &root.join(crate::hitsound::HITSOUND_REL),
            "RIFF\u{0000}\u{0000}\u{0000}\u{0000}WAVE",
        );
        let saved = save_current_as_to(
            &profiles,
            &root,
            "With metadata",
            unlocked(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let source_id = saved.profiles[0].id.clone();
        let mut manifest = load_manifest(&profiles, &source_id).unwrap();
        manifest.mods.push(ModRecord {
            id: "my-mod".into(),
            name: "My mod".into(),
            source: ModSource::Gamebanana {
                id: 123,
                url: "https://secret@example.invalid/mod?token=hunter2".into(),
            },
            pack: "my-mod".into(),
            files: 999,
            bytes: 999,
            installed_at: "2026-09-04T00:00:00Z".into(),
        });
        manifest.ignored_packs = vec!["kept-pack".into()];
        manifest.preloader = Some(crate::preloader::PreloaderSelection {
            addons: vec!["Flat Textures v1".into()],
            particle_mods: vec!["Blue Water".into()],
            profile_particle_mods: vec!["my-mod".into()],
        });
        manifest.hitsound = Some(crate::hitsound::HitsoundRecord {
            source_changed: false,
            hit: Some(crate::hitsound::HitsoundEntry {
                name: "My picked sound".into(),
                source: crate::hitsound::HitsoundSource::File,
                boost: 0,
                token: Some("private-local-stash-token".into()),
                hash: None,
            }),
            kill: None,
        });
        save_manifest(&profiles, &root, &manifest, Vec::<String>::new()).unwrap();

        let destination = dir.join("metadata.zip");
        export_profile_to(&profiles, &root, &source_id, &destination).unwrap();
        let library = import_profile_from(&profiles, &root, &destination, unlocked()).unwrap();
        let imported_id = library
            .profiles
            .iter()
            .find(|profile| profile.id != source_id)
            .unwrap()
            .id
            .clone();
        let imported = load_manifest(&profiles, &imported_id).unwrap();
        assert_eq!(imported.preloader, manifest.preloader);
        assert_eq!(imported.mods.len(), 1);
        assert_eq!(imported.mods[0].id, "my-mod");
        assert_eq!(imported.mods[0].files, 1);
        assert_eq!(imported.mods[0].bytes, 3);
        assert_eq!(
            imported.mods[0].source,
            ModSource::Gamebanana {
                id: 123,
                url: "https://gamebanana.com/mods/123".into()
            }
        );
        assert_eq!(imported.ignored_packs, vec!["kept-pack"]);
        assert_eq!(
            imported
                .hitsound
                .as_ref()
                .and_then(|record| record.hit.as_ref())
                .and_then(|entry| entry.token.as_deref()),
            None
        );
        cleanup(&dir);
    }

    #[test]
    fn saved_catalog_wavs_survive_export_import_and_profile_switch() {
        use crate::hitsound::{
            apply_hitsounds_to, stored_hitsound, HitsoundChange, HitsoundEntry, HitsoundKind,
            HitsoundSource, HITSOUND_REL, KILLSOUND_REL,
        };

        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);
        let saved = save_current_as_to(
            &profiles,
            &root,
            "Saved catalog sounds",
            unlocked(),
            SaveCurrentOptions::default(),
        )
        .unwrap();
        let source_id = saved.active_profile_id.unwrap();

        // A valid 10 ms, 44.1 kHz mono PCM WAV stands in for already saved
        // profile bytes. This path must never need the retired remote fetches.
        let wav = |sample: u8| {
            let samples = vec![sample; 882];
            let mut wav = Vec::new();
            wav.extend_from_slice(b"RIFF");
            wav.extend_from_slice(&(36 + samples.len() as u32).to_le_bytes());
            wav.extend_from_slice(b"WAVEfmt ");
            wav.extend_from_slice(&16u32.to_le_bytes());
            wav.extend_from_slice(&1u16.to_le_bytes());
            wav.extend_from_slice(&1u16.to_le_bytes());
            wav.extend_from_slice(&44_100u32.to_le_bytes());
            wav.extend_from_slice(&88_200u32.to_le_bytes());
            wav.extend_from_slice(&2u16.to_le_bytes());
            wav.extend_from_slice(&16u16.to_le_bytes());
            wav.extend_from_slice(b"data");
            wav.extend_from_slice(&(samples.len() as u32).to_le_bytes());
            wav.extend_from_slice(&samples);
            wav
        };
        let hit_wav = wav(0x40);
        let kill_wav = wav(0x20);

        let mut community = HitsoundEntry::new("quack".into(), HitsoundSource::Community);
        community.boost = 6;
        let mut comfig = HitsoundEntry::new("Saved upload".into(), HitsoundSource::Comfig);
        comfig.boost = 12;
        comfig.hash = Some("a".repeat(128));
        apply_hitsounds_to(
            &profiles,
            &root,
            &source_id,
            HitsoundChange::Install {
                entry: community,
                wav: hit_wav.clone(),
            },
            HitsoundChange::Install {
                entry: comfig,
                wav: kill_wav.clone(),
            },
            unlocked(),
        )
        .unwrap();
        let source_record = load_manifest(&profiles, &source_id).unwrap().hitsound;

        let archive = dir.join("saved-catalog-sounds.zip");
        export_profile_to(&profiles, &root, &source_id, &archive).unwrap();
        let imported = import_profile_from(&profiles, &root, &archive, unlocked()).unwrap();
        let imported_id = imported
            .profiles
            .iter()
            .find(|profile| profile.id != source_id)
            .unwrap()
            .id
            .clone();
        assert_eq!(
            imported.active_profile_id.as_deref(),
            Some(source_id.as_str())
        );
        assert_eq!(
            load_manifest(&profiles, &imported_id).unwrap().hitsound,
            source_record
        );
        assert_eq!(
            stored_hitsound(&profiles, &imported_id, HitsoundKind::Hit),
            Some(hit_wav.clone())
        );
        assert_eq!(
            stored_hitsound(&profiles, &imported_id, HitsoundKind::Kill),
            Some(kill_wav.clone())
        );

        // Clear the original active profile first, so the imported copy must
        // restore both canonical WAVs from its own verified library files.
        apply_hitsounds_to(
            &profiles,
            &root,
            &source_id,
            HitsoundChange::Clear,
            HitsoundChange::Clear,
            unlocked(),
        )
        .unwrap();
        assert!(!root.join(HITSOUND_REL).exists());
        assert!(!root.join(KILLSOUND_REL).exists());
        let no_steam = Vec::new();
        crate::switch::switch_profile_to(
            &profiles,
            &root,
            &imported_id,
            unlocked(),
            crate::absorb::AbsorbOptions {
                steam_roots: Some(&no_steam),
                ..Default::default()
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(root.join(HITSOUND_REL)).unwrap(), hit_wav);
        assert_eq!(fs::read(root.join(KILLSOUND_REL)).unwrap(), kill_wav);
        assert_eq!(
            load_manifest(&profiles, &imported_id).unwrap().hitsound,
            source_record
        );
        cleanup(&dir);
    }

    #[test]
    fn feature_records_without_verified_payloads_refuse_import() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();
        for (name, feature) in [
            (
                "crosshair",
                serde_json::json!({
                    "crosshair": {"id": "execs-crosshairs", "shape": "dot"}
                }),
            ),
            (
                "viewmodel",
                serde_json::json!({
                    "viewmodel": {"id": "execs-viewmodels", "source": "imported"}
                }),
            ),
            (
                "hitsound",
                serde_json::json!({
                    "hitsound": {"hit": {"name": "claimed", "source": "file"}}
                }),
            ),
        ] {
            let mut manifest = serde_json::json!({
                "schema": ZIP_SCHEMA,
                "name": "Missing feature payload",
                "files": []
            });
            manifest
                .as_object_mut()
                .unwrap()
                .extend(feature.as_object().unwrap().clone());
            let json = serde_json::to_vec(&manifest).unwrap();
            let zip_path = dir.join(format!("{name}.zip"));
            write_raw_zip(&zip_path, &[("execs-profile.json", &json)]);
            let error = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap_err();
            assert!(
                matches!(&error, ProfileError::Io(message) if message.contains("record")),
                "{name} had unexpected error: {error:?}"
            );
            assert!(load_library_from(&profiles, Some(&root))
                .unwrap()
                .profiles
                .is_empty());
        }
        cleanup(&dir);
    }

    #[test]
    fn legacy_crosshair_record_without_shape_keeps_readable_verified_pack() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs/profiles");
        let root = dir.join("Team Fortress 2");
        init_library_to(&profiles, &root, unlocked()).unwrap();
        let files = [
            (
                "tf/custom/execs-crosshairs/materials/vgui/replay/thumbnails/dot.vtf",
                b"vtf".as_slice(),
            ),
            (
                "tf/custom/execs-crosshairs/materials/vgui/replay/thumbnails/dot.vmt",
                b"vmt".as_slice(),
            ),
            (
                "tf/custom/execs-crosshairs/scripts/tf_weapon_scattergun.txt",
                b"script".as_slice(),
            ),
        ];
        let manifest = serde_json::json!({
            "schema": ZIP_SCHEMA,
            "name": "Legacy crosshair",
            "files": files.iter().map(|(path, bytes)| serde_json::json!({
                "path": path,
                "sha256": sha256_hex(bytes),
                "storage": "exclusive"
            })).collect::<Vec<_>>(),
            "crosshair": {"id": "execs-crosshairs"}
        });
        let json = serde_json::to_vec(&manifest).unwrap();
        let zip_path = dir.join("legacy-crosshair.zip");
        let mut entries: Vec<(String, &[u8])> = vec![("execs-profile.json".into(), &json)];
        entries.extend(
            files
                .iter()
                .map(|(path, bytes)| (format!("files/{path}"), *bytes)),
        );
        let borrowed: Vec<(&str, &[u8])> = entries
            .iter()
            .map(|(path, bytes)| (path.as_str(), *bytes))
            .collect();
        write_raw_zip(&zip_path, &borrowed);
        let library = import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        let imported = load_manifest(&profiles, &library.profiles[0].id).unwrap();
        assert_eq!(imported.crosshair.unwrap().shape, "");
        cleanup(&dir);
    }

    #[test]
    fn manifest_file_and_path_budgets_are_checked_before_payload_lookup() {
        let file = ProfileFile {
            path: "tf/cfg/overrides/a.cfg".into(),
            sha256: "0".repeat(64),
            storage: FileStorage::Exclusive,
        };
        let mut payload = ZipPayload {
            creator: false,
            skipped_files: 0,
            import_notes: Vec::new(),
            manifest: ProfileZipManifest {
                schema: ZIP_SCHEMA,
                name: "Too many".into(),
                launch_options: String::new(),
                files: vec![file.clone(); MAX_PROFILE_FILES + 1],
                id: None,
                tf2_root: None,
                hud: None,
                hud_selected_root: None,
                hud_review_pending: false,
                crosshair: None,
                viewmodel: None,
                hitsound: None,
                mods: Vec::new(),
                preloader: None,
                ignored_packs: Vec::new(),
            },
            exclusive: HashMap::new(),
            blobs: HashMap::new(),
        };
        let err = validate_payload(&mut payload).unwrap_err();
        assert!(err.message().contains("more than"), "{}", err.message());

        payload.manifest.files = vec![ProfileFile {
            path: format!(
                "tf/cfg/overrides/{}/a.cfg",
                (0..MAX_PROFILE_PATH_DEPTH)
                    .map(|_| "nested")
                    .collect::<Vec<_>>()
                    .join("/")
            ),
            ..file
        }];
        let err = validate_payload(&mut payload).unwrap_err();
        assert!(err.message().contains("deeply nested"), "{}", err.message());
    }

    #[test]
    fn live_tf_tree_untouched() {
        let dir = crate::test_temp_dir();
        let profiles = dir.join("execs").join("profiles");
        let root = dir.join("Team Fortress 2");
        seed_live(&root);
        write_live(
            &root.join("tf/custom/hud/resource/ui/hudlayout.res"),
            "hud\n",
        );
        let before = snapshot_tree(&root);

        let saved = save_current_as_to(
            &profiles,
            &root,
            "Main",
            unlocked(),
            SaveCurrentOptions {
                launch_options: Some("-novid"),
                cloud_config: None,
            },
        )
        .unwrap();
        let zip_path = dir.join("out").join("main.zip");
        export_profile_to(&profiles, &root, &saved.profiles[0].id, &zip_path).unwrap();
        import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        assert_eq!(snapshot_tree(&root), before);
        assert!(!root.join("tf/cfg/user").exists());
        cleanup(&dir);
    }
}
