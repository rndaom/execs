//! Versioned profile zip export/import. Library only — never writes live TF2.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::blob::blob_path;
use crate::hash::sha256_hex;
use crate::launch::sanitize_launch_options;
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    create_profile_record_to, exclusive_file_path, is_forbidden_rel_path, is_shared_rel_path,
    load_library_from, load_manifest, manifest_file, normalize_rel_path, profiles_dir,
    put_exclusive_file_to, put_shared_blob_to, remove_profile_record_to, FileStorage, ProfileError,
    HudRecord, ProfileFile, ProfileLibrary, ProfileManifest,
};

pub const ZIP_SCHEMA: u32 = 1;
pub const ZIP_MANIFEST_NAME: &str = "execs-profile.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileZipManifest {
    schema: u32,
    name: String,
    #[serde(default)]
    launch_options: String,
    files: Vec<ProfileFile>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    tf2_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hud: Option<HudRecord>,
}

struct ZipPayload {
    manifest: ProfileZipManifest,
    exclusive: HashMap<String, Vec<u8>>,
    blobs: HashMap<String, Vec<u8>>,
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
    export_profile_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        zip_path,
        live_process_names(),
    )
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

/// Copy a library profile into a versioned zip. Does not write live TF2.
/// `running_names` is accepted for API symmetry; export is not a library mutation.
pub fn export_profile_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    zip_path: &Path,
    running_names: I,
) -> Result<(), ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let _running_names = running_names;
    let library = require_usable_library(profiles_dir, tf2_root)?;
    if !library
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    let manifest = load_manifest(profiles_dir, profile_id)?;
    match write_profile_zip(profiles_dir, profile_id, &manifest, zip_path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = fs::remove_file(zip_path);
            Err(err)
        }
    }
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
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running).map_err(ProfileError::from)?;

    let existing = load_library_from(profiles_dir, Some(tf2_root))?;
    if existing.root_mismatch {
        return Err(root_mismatch(&existing, tf2_root));
    }

    let payload = read_profile_zip(zip_path)?;
    validate_payload(&payload)?;

    let library =
        create_profile_record_to(profiles_dir, tf2_root, &payload.manifest.name, &running)?;
    let new_id = library
        .profiles
        .last()
        .ok_or_else(|| ProfileError::Io("imported profile missing from library".into()))?
        .id
        .clone();

    if let Err(err) = apply_payload(profiles_dir, tf2_root, &new_id, &payload, &running) {
        let _ = remove_profile_record_to(profiles_dir, tf2_root, &new_id, &running);
        return Err(err);
    }

    load_library_from(profiles_dir, Some(tf2_root))
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

    let zip_manifest = ProfileZipManifest {
        schema: ZIP_SCHEMA,
        name: manifest.name.clone(),
        launch_options: manifest.launch_options.clone(),
        files: manifest.files.clone(),
        id: Some(manifest.id.clone()),
        tf2_root: Some(manifest.tf2_root.clone()),
        hud: manifest.hud.clone(),
    };

    let file = fs::File::create(zip_path).map_err(io_err)?;
    let mut zip = ZipWriter::new(file);
    let options = file_options();

    let json = serde_json::to_string_pretty(&zip_manifest).map_err(json_err)?;
    zip.start_file(ZIP_MANIFEST_NAME, options).map_err(zip_io)?;
    zip.write_all(format!("{json}\n").as_bytes())
        .map_err(io_err)?;

    let mut written_blobs = HashSet::new();
    for entry in &manifest.files {
        match entry.storage {
            FileStorage::Exclusive => {
                let bytes = read_hashed_file(
                    &exclusive_file_path(profiles_dir, profile_id, &entry.path),
                    &entry.sha256,
                    &entry.path,
                )?;
                zip.start_file(format!("files/{}", entry.path), options)
                    .map_err(zip_io)?;
                zip.write_all(&bytes).map_err(io_err)?;
            }
            FileStorage::Shared => {
                if !written_blobs.insert(entry.sha256.clone()) {
                    continue;
                }
                let bytes = read_hashed_file(
                    &blob_path(profiles_dir, &entry.sha256),
                    &entry.sha256,
                    &entry.path,
                )?;
                zip.start_file(format!("blobs/{}", entry.sha256), options)
                    .map_err(zip_io)?;
                zip.write_all(&bytes).map_err(io_err)?;
            }
        }
    }

    zip.finish().map_err(zip_io)?;
    Ok(())
}

fn read_profile_zip(zip_path: &Path) -> Result<ZipPayload, ProfileError> {
    let file = fs::File::open(zip_path).map_err(io_err)?;
    let mut archive = ZipArchive::new(file).map_err(zip_invalid)?;

    let mut manifest = None;
    let mut exclusive = HashMap::new();
    let mut blobs = HashMap::new();

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
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(io_err)?;
        match role {
            ZipRole::Manifest => {
                if manifest.is_some() {
                    return Err(invalid_zip("duplicate execs-profile.json"));
                }
                let parsed: ProfileZipManifest =
                    serde_json::from_slice(&bytes).map_err(zip_invalid)?;
                if parsed.schema != ZIP_SCHEMA {
                    return Err(invalid_zip("unsupported profile zip schema"));
                }
                manifest = Some(parsed);
            }
            ZipRole::Exclusive(dest) => {
                if exclusive.insert(dest.clone(), bytes).is_some() {
                    return Err(invalid_zip(format!("duplicate file: {dest}")));
                }
            }
            ZipRole::Blob(hash) => {
                if sha256_hex(&bytes) != hash {
                    return Err(invalid_zip("blob hash mismatch"));
                }
                if blobs.insert(hash.clone(), bytes).is_some() {
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
    })
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
        if is_forbidden_rel_path(&dest) {
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

fn validate_payload(payload: &ZipPayload) -> Result<(), ProfileError> {
    let mut seen = HashSet::new();
    let mut required_exclusive = HashSet::new();
    let mut required_blobs = HashSet::new();

    for file in &payload.manifest.files {
        let path = normalize_rel_path(&file.path)?;
        if is_forbidden_rel_path(&path) {
            return Err(ProfileError::ForbiddenPath(path));
        }
        if !seen.insert(path.clone()) {
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
            let bytes = payload
                .blobs
                .get(&hash)
                .ok_or_else(|| invalid_zip(format!("missing blob for {path}")))?;
            if sha256_hex(bytes) != hash {
                return Err(invalid_zip(format!("hash mismatch for {path}")));
            }
            required_blobs.insert(hash);
        } else {
            if file.storage != FileStorage::Exclusive {
                return Err(ProfileError::NotShareable(path.clone()));
            }
            let bytes = payload
                .exclusive
                .get(&path)
                .ok_or_else(|| invalid_zip(format!("missing file: {path}")))?;
            if sha256_hex(bytes) != file.sha256.to_ascii_lowercase() {
                return Err(invalid_zip(format!("hash mismatch for {path}")));
            }
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
    Ok(())
}

fn apply_payload(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    payload: &ZipPayload,
    running: &[String],
) -> Result<(), ProfileError> {
    for file in &payload.manifest.files {
        let path = normalize_rel_path(&file.path)?;
        match file.storage {
            FileStorage::Exclusive => {
                let bytes = &payload.exclusive[&path];
                put_exclusive_file_to(profiles_dir, tf2_root, profile_id, &path, bytes, running)?;
            }
            FileStorage::Shared => {
                let hash = file.sha256.to_ascii_lowercase();
                let bytes = &payload.blobs[&hash];
                put_shared_blob_to(profiles_dir, tf2_root, profile_id, &path, bytes, running)?;
            }
        }
    }
    write_imported_launch_and_hud(
        profiles_dir,
        profile_id,
        &payload.manifest.launch_options,
        payload.manifest.hud.clone(),
    )
}

fn write_imported_launch_and_hud(
    profiles_dir: &Path,
    profile_id: &str,
    launch: &str,
    hud: Option<HudRecord>,
) -> Result<(), ProfileError> {
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.launch_options = sanitize_launch_options(launch);
    manifest.hud = hud;
    let json = serde_json::to_string_pretty(&manifest).map_err(json_err)?;
    fs::write(manifest_file(profiles_dir, profile_id), format!("{json}\n")).map_err(io_err)
}

fn read_hashed_file(path: &Path, expected: &str, label: &str) -> Result<Vec<u8>, ProfileError> {
    let bytes = fs::read(path).map_err(io_err)?;
    if sha256_hex(&bytes) != expected.to_ascii_lowercase() {
        return Err(ProfileError::Io(format!("hash mismatch for {label}")));
    }
    Ok(bytes)
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
    value.len() == 64
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F'))
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
    use crate::profile::{
        exclusive_file_path, init_library_to, load_library_from, load_manifest, save_current_as_to,
        FileStorage, ProfileError, SaveCurrentOptions,
    };
    use std::collections::BTreeMap;
    use std::io::Write;
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
        let options = SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn seed_live(root: &Path) {
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
        export_profile_to(&profiles, &root, &src_id, &zip_path, [tf2_name()]).unwrap();

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
        export_profile_to(
            &profiles,
            &root,
            &saved.profiles[0].id,
            &zip_path,
            unlocked(),
        )
        .unwrap();

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
  "launchOptions": "-novid -autoconfig -dxlevel 90 +quit -console",
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
        export_profile_to(
            &profiles,
            &root,
            &saved.profiles[0].id,
            &zip_path,
            unlocked(),
        )
        .unwrap();

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
        export_profile_to(
            &profiles,
            &root,
            &saved.profiles[0].id,
            &zip_path,
            unlocked(),
        )
        .unwrap();

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
        export_profile_to(
            &profiles,
            &root,
            &saved.profiles[0].id,
            &zip_path,
            unlocked(),
        )
        .unwrap();
        import_profile_from(&profiles, &root, &zip_path, unlocked()).unwrap();
        assert_eq!(snapshot_tree(&root), before);
        assert!(!root.join("tf/cfg/user").exists());
        cleanup(&dir);
    }
}
