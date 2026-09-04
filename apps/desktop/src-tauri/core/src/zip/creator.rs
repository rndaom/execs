//! Creator archives contain cfg/ and custom/, optionally under tf/ or a wrapper.
//! Reuse the native import transaction, limits and ownership rules after mapping.

use super::*;

#[derive(Debug)]
pub struct ProfileImportReview {
    pub name: String,
    pub files: usize,
    pub skipped_files: usize,
    pub creator: bool,
    pub warnings: Vec<String>,
    // Approval belongs to these exact bytes, never just to a mutable pathname.
    pub(super) sha256: String,
}

pub fn inspect_profile_import(
    tf2_root: &Path,
    zip_path: &Path,
) -> Result<ProfileImportReview, ProfileError> {
    inspect_profile_import_from(&profiles_dir(), tf2_root, zip_path, live_process_names())
}

pub(super) fn inspect_profile_import_from<I, S>(
    profiles: &Path,
    tf2_root: &Path,
    zip_path: &Path,
    running: I,
) -> Result<ProfileImportReview, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_if_running_among(running).map_err(ProfileError::from)?;
    let existing = load_library_from(profiles, Some(tf2_root))?;
    if existing.root_mismatch {
        return Err(root_mismatch(&existing, tf2_root));
    }
    let sha256 = sha256_file(zip_path).map_err(io_err)?;
    let staging = StagingDir::create(profiles)?;
    let mut payload = read_profile_zip(zip_path, profiles, &staging.path)?;
    // Trust can waive command-policy findings, never paths, parser
    // limits or corrupt archives. Native exports retain strict validation.
    if payload.creator {
        validate_payload_with_trust(&mut payload, true)?;
    } else {
        validate_payload(&mut payload)?;
    }
    let mut warnings = Vec::new();
    if payload.creator {
        for file in &payload.manifest.files {
            let staged = match file.storage {
                FileStorage::Exclusive => &payload.exclusive[&file.path],
                FileStorage::Shared => &payload.blobs[&file.sha256],
            };
            if let Err(err) = validate_imported_profile_file(&file.path, staged, false) {
                let message = match err {
                    ProfileError::Io(message) => message,
                    other => other.message(),
                };
                warnings.push(
                    message
                        .replace(" contains blocked command ", " contains ")
                        .replace(" and cannot be imported.", "."),
                );
            }
        }
    }
    // Also catch replacement while inspection was in progress.
    if sha256_file(zip_path).map_err(io_err)? != sha256 {
        return Err(invalid_zip(
            "The ZIP changed during review. Choose it again.",
        ));
    }
    Ok(ProfileImportReview {
        name: payload.manifest.name,
        files: payload.manifest.files.len(),
        skipped_files: payload.skipped_files,
        creator: payload.creator,
        warnings,
        sha256,
    })
}

/// The caller shows the review and obtains explicit trust before calling this
/// for a creator archive. The command does not expose a trust boolean over IPC.
pub fn import_reviewed_profile(
    tf2_root: &Path,
    zip_path: &Path,
    review: &ProfileImportReview,
) -> Result<ProfileLibrary, ProfileError> {
    import_profile_with_review(
        &profiles_dir(),
        tf2_root,
        zip_path,
        live_process_names(),
        Some(review),
    )
}

pub(super) fn read_creator_zip(
    mut archive: ZipArchive<fs::File>,
    zip_path: &Path,
    staging_root: &Path,
    staging: &Path,
) -> Result<ZipPayload, ProfileError> {
    let mut entries = Vec::new();
    let mut roots = HashSet::new();
    let mut path_bytes = 0usize;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(zip_invalid)?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(invalid_zip(
                "Symbolic links are not allowed in config ZIPs.",
            ));
        }
        let raw = entry.name().replace('\\', "/");
        // Some Windows zippers emit a synthetic '/' root directory (including
        // bunstiecfgcustom.zip). It has no destination and is never extracted.
        if entry.is_dir() && matches!(raw.as_str(), "/" | "./" | "") {
            continue;
        }
        let raw = raw.strip_prefix("./").unwrap_or(&raw).trim_end_matches('/');
        let name = normalize_rel_path(raw)?;
        path_bytes = path_bytes.saturating_add(name.len());
        if path_bytes > MAX_PROFILE_PATH_BYTES {
            return Err(invalid_zip("profile paths exceed the metadata budget"));
        }
        if entry.is_dir() {
            continue;
        }
        let parts: Vec<_> = name.split('/').collect();
        if parts.iter().any(|part| crate::archive::is_junk_name(part)) {
            entries.push((index, name, None));
            continue;
        }
        let surface = parts.iter().position(|part| {
            part.eq_ignore_ascii_case("cfg") || part.eq_ignore_ascii_case("custom")
        });
        let mapped = surface
            .filter(|position| *position + 1 < parts.len())
            .map(|position| {
                let root = parts[..position].join("/");
                let dest = format!("tf/{}", parts[position..].join("/"));
                roots.insert(root);
                dest
            });
        entries.push((index, name, mapped));
    }
    if roots.len() != 1 {
        return Err(invalid_zip(if roots.is_empty() {
            "Choose an execs profile ZIP or a creator ZIP containing cfg/ or custom/."
        } else {
            "This ZIP contains multiple config folders. Zip just one creator's cfg/ and custom/ together."
        }));
    }

    let mut payload = ZipPayload {
        manifest: ProfileZipManifest {
            schema: ZIP_SCHEMA,
            name: zip_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .chars()
                .filter(|ch| !ch.is_control())
                .take(MAX_PROFILE_NAME_CHARS)
                .collect(),
            launch_options: String::new(),
            files: Vec::new(),
            id: None,
            tf2_root: None,
            hud: None,
            crosshair: None,
            viewmodel: None,
            hitsound: None,
            mods: Vec::new(),
            ignored_packs: Vec::new(),
        },
        exclusive: HashMap::new(),
        blobs: HashMap::new(),
        creator: true,
        skipped_files: 0,
    };
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for (index, name, mapped) in entries {
        let Some(mapped) = mapped else {
            payload.skipped_files += 1;
            continue;
        };
        let dest = normalize_rel_path(&mapped)?;
        // Creator downloads often contain engine .scr/.txt files and caches.
        // Only the profile-owned cfg layer and custom content are imported.
        if !is_profile_ownable_rel_path(&dest)
            || (dest.starts_with("tf/cfg/") && !has_extension(&dest, "cfg"))
        {
            payload.skipped_files += 1;
            continue;
        }
        if is_zip_file_name(&dest) {
            return Err(invalid_zip("nested zips are not allowed"));
        }
        if !seen.insert(portable_path_key(&dest)?) {
            return Err(invalid_zip(format!(
                "colliding file paths in config ZIP: {dest}"
            )));
        }
        if seen.len() > MAX_PROFILE_FILES {
            return Err(invalid_zip("Too many files in this config ZIP."));
        }
        let mut entry = archive.by_index(index).map_err(zip_invalid)?;
        let declared = entry.size();
        let compressed = entry.compressed_size();
        check_entry_budget(declared, compressed, &name, total)?;
        let staged = staging.join(format!("c{index}"));
        total += stream_entry(
            staging_root,
            &mut entry,
            &staged,
            &name,
            total,
            declared,
            compressed,
        )?;
        let sha256 = sha256_file(&staged).map_err(io_err)?;
        let storage = if is_shared_rel_path(&dest) {
            payload.blobs.insert(sha256.clone(), staged);
            FileStorage::Shared
        } else {
            payload.exclusive.insert(dest.clone(), staged);
            FileStorage::Exclusive
        };
        payload.manifest.files.push(ProfileFile {
            path: dest,
            sha256,
            storage,
        });
    }
    if payload.manifest.files.is_empty() {
        return Err(invalid_zip(
            "This ZIP contains no profile cfg files or custom content.",
        ));
    }
    Ok(payload)
}
