//! The plumbing every command body sits on.
//!
//! Before this, each command hand-wrote the same five-line tail — resolve the
//! confirmed root, `spawn_blocking`, await, map the join error, map the core
//! error — about thirty times over. `with_root` / `with_profile` collapse it
//! so a command body is the work it actually does.

use std::path::{Path, PathBuf};

use execs_core::ProfileError;

use crate::error::CommandError;

/// Tauri v2 runs non-`async` commands on the MAIN thread. Every core write
/// helper enumerates the whole OS process table for the write lock, and most
/// of them walk the live file surface on top — none of that belongs on the UI
/// thread. This is the one-liner that keeps the bodies off it.
pub async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| CommandError::unknown(err.to_string()))?
}

pub fn confirmed_root() -> Result<PathBuf, CommandError> {
    execs_core::remembered_tf2_root().ok_or_else(|| ProfileError::NoConfirmedRoot.into())
}

/// The active profile. No command takes a caller-supplied id: the frontend
/// never populates one, and an `id: Option<String>` threaded through sixteen
/// commands inconsistently (the HUD commands hardcoding `None` while their
/// siblings pass it on) is a trap rather than a feature.
pub fn active_profile_id(root: &Path) -> Result<String, CommandError> {
    let library = execs_core::load_library(Some(root))?;
    library
        .active_profile_id
        .ok_or_else(|| CommandError::unknown("Save or switch to a profile first."))
}

/// Run `work` off the main thread with the confirmed TF2 root.
pub async fn with_root<T: Send + 'static>(
    work: impl FnOnce(PathBuf) -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    blocking(move || work(confirmed_root()?)).await
}

/// Run `work` off the main thread with the confirmed root and active profile.
pub async fn with_profile<T: Send + 'static>(
    work: impl FnOnce(PathBuf, String) -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    blocking(move || {
        let root = confirmed_root()?;
        let profile_id = active_profile_id(&root)?;
        work(root, profile_id)
    })
    .await
}

/// Refuse a user-picked file by its size on disk before it is read whole.
/// The archive and VPK readers in core cap what they unpack, but only once
/// the bytes are already in memory; a 4 GB pick would be loaded first and
/// refused second. `too_large` is the sentence the later check would use.
pub fn refuse_oversize_file(
    path: &Path,
    max_bytes: u64,
    too_large: impl Into<String>,
) -> Result<(), CommandError> {
    let len = std::fs::metadata(path)
        .map_err(|err| CommandError::unknown(err.to_string()))?
        .len();
    if len > max_bytes {
        return Err(CommandError::unknown(too_large));
    }
    Ok(())
}

/// Core's wording for an archive past its unpack ceiling.
pub fn archive_too_large(max_bytes: u64) -> String {
    format!(
        "That archive unpacks to more than {} MiB; refusing to unpack it.",
        max_bytes / (1024 * 1024)
    )
}

/// Core's wording for a VPK past the pack ceiling.
pub fn vpk_too_large(max_bytes: u64) -> String {
    format!(
        "That VPK is larger than {} MiB; refusing to install it.",
        max_bytes / (1024 * 1024)
    )
}

/// The active profile's manifest — five commands open with exactly this.
pub fn active_manifest(
    profile_id: &str,
) -> Result<execs_core::profile::ProfileManifest, CommandError> {
    Ok(execs_core::load_manifest(
        &execs_core::profiles_dir(),
        profile_id,
    )?)
}
