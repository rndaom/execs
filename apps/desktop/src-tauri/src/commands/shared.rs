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

/// The active profile. There is no caller-supplied id any more: the
/// `id: Option<String>` parameter that used to ride along on sixteen commands
/// was never populated by the frontend and was threaded through
/// inconsistently (the HUD commands hardcoded `None` while their siblings
/// passed it on), which made it a trap rather than a feature.
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

/// The active profile's manifest — five commands open with exactly this.
pub fn active_manifest(
    profile_id: &str,
) -> Result<execs_core::profile::ProfileManifest, CommandError> {
    Ok(execs_core::load_manifest(
        &execs_core::profiles_dir(),
        profile_id,
    )?)
}
