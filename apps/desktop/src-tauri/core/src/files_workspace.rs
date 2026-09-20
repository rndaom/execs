//! Optimistic, source-bound Files edits. Callers hold WriteGate across reads
//! and the existing recoverable profile transaction; there is no force save.
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apply::{manifest_source_path, ProfileDetail, WriteOwnedOptions};
use crate::hash::{read_small_file_bounded, sha256_hex};
use crate::profile::{load_library_from, load_manifest, normalize_rel_path, ProfileError};
use crate::surface::CfgLayer;

const MAX_EDITOR_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesContext {
    pub profile_id: String,
    pub root: String,
    pub layer: CfgLayer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesSource {
    #[serde(flatten)]
    pub context: FilesContext,
    pub sha256: Option<String>,
    pub library_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesContent {
    pub path: String,
    pub text: Option<String>,
    pub sha256: String,
    pub binary: bool,
    pub source: FilesSource,
}

pub fn context_from(profiles: &Path, root: &Path) -> Result<FilesContext, ProfileError> {
    let library = load_library_from(profiles, Some(root))?;
    let profile_id = library
        .active_profile_id
        .ok_or(ProfileError::UnknownProfile)?;
    let manifest = load_manifest(profiles, &profile_id)?;
    Ok(FilesContext {
        profile_id,
        root: root.to_string_lossy().into_owned(),
        layer: crate::apply::cfg_layer_from_manifest(profiles, &manifest)?,
    })
}

fn optional_bytes(root: &Path, path: &Path) -> Result<Option<Vec<u8>>, ProfileError> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => {
            crate::hash::validate_file_within(root, path)
                .map_err(|error| ProfileError::Io(error.to_string()))?;
            read_small_file_bounded(path, MAX_EDITOR_BYTES)
                .map(Some)
                .map_err(|error| ProfileError::Io(error.to_string()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ProfileError::Io(error.to_string())),
    }
}

pub fn read_from(profiles: &Path, root: &Path, path: &str) -> Result<FilesContent, ProfileError> {
    let path = normalize_rel_path(path)?;
    let context = context_from(profiles, root)?;
    let manifest = load_manifest(profiles, &context.profile_id)?;
    let file = manifest
        .files
        .iter()
        .find(|file| file.path == path)
        .ok_or(ProfileError::InvalidPath)?;
    let library_path = manifest_source_path(profiles, &context.profile_id, file)?;
    let library = optional_bytes(profiles, &library_path)?.ok_or(ProfileError::FileConflict)?;
    if sha256_hex(&library) != file.sha256 {
        return Err(ProfileError::FileConflict);
    }
    // Provided pack files are inspected from the library. Only cfg-layer files
    // can be edited, and their current live bytes are authoritative.
    let current = if path.starts_with("tf/cfg/") {
        optional_bytes(root, &root.join(&path))?
    } else {
        Some(library.clone())
    };
    let hash = current.as_ref().map(|bytes| sha256_hex(bytes));
    let text = current
        .as_ref()
        .and_then(|bytes| String::from_utf8(bytes.clone()).ok());
    Ok(FilesContent {
        path,
        binary: current.is_some() && text.is_none(),
        text,
        sha256: hash.clone().unwrap_or_default(),
        source: FilesSource {
            context,
            sha256: hash,
            library_sha256: Some(sha256_hex(&library)),
        },
    })
}

fn new_path_allowed(path: &str, layer: CfgLayer) -> bool {
    let prefix = match layer {
        CfgLayer::Comfig => "tf/cfg/overrides/",
        CfgLayer::Vanilla => "tf/cfg/",
    };
    let Some(inner) = path.strip_prefix(prefix) else {
        return false;
    };
    let name = inner
        .rsplit('/')
        .next()
        .unwrap_or(inner)
        .to_ascii_lowercase();
    !matches!(
        inner
            .split('/')
            .next()
            .unwrap_or(inner)
            .to_ascii_lowercase()
            .as_str(),
        "user" | "app" | "overrides" | "comfig"
    ) && !inner.split('/').any(|part| part.starts_with('.'))
        && !matches!(
            name.as_str(),
            "config.cfg"
                | "execs_binds.cfg"
                | "execs_gameplay.cfg"
                | "execs_preload.cfg"
                | "modules.cfg"
                | "setup_hook.cfg"
        )
}

// Walk each existing component to catch portable collisions on Linux too.
// Never traverse a link, even when the final destination is absent.
fn check_destination(root: &Path, path: &str) -> Result<(), ProfileError> {
    let mut parent = root.to_path_buf();
    for part in path.split('/') {
        if !parent.exists() {
            break;
        }
        crate::hash::validate_dir_within(root, &parent)
            .map_err(|error| ProfileError::Io(error.to_string()))?;
        for (count, entry) in std::fs::read_dir(&parent)
            .map_err(|error| ProfileError::Io(error.to_string()))?
            .enumerate()
        {
            if count >= 40_000 {
                return Err(ProfileError::Io(
                    "Too many entries to check the cfg destination.".into(),
                ));
            }
            let entry = entry.map_err(|error| ProfileError::Io(error.to_string()))?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.to_lowercase() == part.to_lowercase() && name != part {
                return Err(ProfileError::FileConflict);
            }
        }
        parent.push(part);
    }
    Ok(())
}

pub fn save_to<I, S>(
    profiles: &Path,
    root: &Path,
    path: &str,
    bytes: &[u8],
    expected: &FilesSource,
    running: I,
    options: WriteOwnedOptions<'_>,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running
        .into_iter()
        .map(|name| name.as_ref().to_owned())
        .collect();
    crate::process_lock::refuse_if_running_among(&running)?;
    let context = context_from(profiles, root)?;
    if context.root != expected.context.root {
        return Err(ProfileError::FilesRootChanged);
    }
    if context.profile_id != expected.context.profile_id {
        return Err(ProfileError::FilesProfileChanged);
    }
    if context.layer != expected.context.layer
        || crate::cfg_layer::cfg_layer_from_live(root)? != context.layer
    {
        return Err(ProfileError::CfgLayerChanged);
    }
    let normalized = normalize_rel_path(path)?;
    if normalized != path
        || path.len() > 1024
        || !path.starts_with("tf/cfg/")
        || !path.to_ascii_lowercase().ends_with(".cfg")
        || !crate::profile::is_profile_ownable_rel_path(path)
    {
        return Err(ProfileError::ForbiddenPath(path.to_owned()));
    }
    if bytes.len() > MAX_EDITOR_BYTES {
        return Err(ProfileError::Io(
            "That cfg exceeds the 1 MiB editor limit.".into(),
        ));
    }
    let manifest = load_manifest(profiles, &context.profile_id)?;
    check_destination(root, path)?;
    if manifest
        .files
        .iter()
        .any(|file| file.path.to_lowercase() == path.to_lowercase() && file.path != path)
    {
        return Err(ProfileError::FileConflict);
    }
    let file = manifest.files.iter().find(|file| file.path == path);
    let library_path = if let Some(file) = file {
        manifest_source_path(profiles, &context.profile_id, file)?
    } else {
        crate::profile::exclusive_file_path(profiles, &context.profile_id, path)
    };
    let library_rel = library_path
        .strip_prefix(profiles)
        .map_err(|_| ProfileError::InvalidPath)?
        .to_string_lossy()
        .replace('\\', "/");
    check_destination(profiles, &library_rel)?;
    let library = optional_bytes(profiles, &library_path)?;
    let live = optional_bytes(root, &root.join(path))?;
    if file.is_some_and(|file| {
        library
            .as_ref()
            .is_none_or(|bytes| sha256_hex(bytes) != file.sha256)
    }) {
        return Err(ProfileError::FileConflict);
    }
    if library.as_ref().map(|bytes| sha256_hex(bytes)) != expected.library_sha256
        || live.as_ref().map(|bytes| sha256_hex(bytes)) != expected.sha256
    {
        return Err(ProfileError::FileConflict);
    }
    if [library.as_deref(), live.as_deref()]
        .into_iter()
        .flatten()
        .any(|bytes| std::str::from_utf8(bytes).is_err())
    {
        return Err(ProfileError::Io(
            "This cfg contains non-UTF-8 bytes and is read-only in Files.".into(),
        ));
    }
    if file.is_none()
        && (!new_path_allowed(path, context.layer) || live.is_some() || library.is_some())
    {
        return Err(ProfileError::ForbiddenPath(path.to_owned()));
    }
    let precommit = || {
        // Snapshotting can take time and external editors do not hold our
        // gate. Do not adopt newer live bytes as an authorized rollback base.
        let current_library = optional_bytes(profiles, &library_path)?;
        let current_live = optional_bytes(root, &root.join(path))?;
        if current_library.as_ref().map(|bytes| sha256_hex(bytes)) != expected.library_sha256
            || current_live.as_ref().map(|bytes| sha256_hex(bytes)) != expected.sha256
        {
            return Err(ProfileError::FileConflict);
        }
        check_destination(root, path)?;
        check_destination(profiles, &library_rel)?;
        if context_from(profiles, root)? != expected.context
            || crate::cfg_layer::cfg_layer_from_live(root)? != context.layer
        {
            return Err(ProfileError::CfgLayerChanged);
        }
        Ok(())
    };
    crate::apply::write_owned_file_checked_to(
        profiles,
        root,
        &context.profile_id,
        path,
        bytes,
        &running,
        options,
        Some(&precommit),
    )
}

#[cfg(test)]
#[path = "files_workspace_tests.rs"]
mod tests;
