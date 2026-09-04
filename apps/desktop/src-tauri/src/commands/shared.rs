//! The plumbing every command body sits on.
//!
//! Before this, each command hand-wrote the same five-line tail — resolve the
//! confirmed root, `spawn_blocking`, await, map the join error, map the core
//! error — about thirty times over. `with_root` / `with_profile` collapse it
//! so a command body is the work it actually does.

use std::io::Read as _;
use std::path::{Path, PathBuf};

use execs_core::ProfileError;

use crate::error::CommandError;

#[derive(Debug, Clone)]
pub struct RootContext(PathBuf);

impl RootContext {
    pub fn capture(root: &Path) -> Self {
        Self(root.to_path_buf())
    }

    pub fn ensure_current(&self, root: &Path) -> Result<(), CommandError> {
        if self.0 == root {
            Ok(())
        } else {
            Err(CommandError::new(
                "RootChanged",
                "The TF2 folder changed while that download was running. Try again.",
            ))
        }
    }
}

#[derive(Debug, Clone)]
pub struct ActiveContext {
    root: RootContext,
    profile_id: String,
}

#[derive(Debug, Clone)]
pub struct ProfileSelectionContext {
    root: RootContext,
    profile_id: Option<String>,
}

impl ProfileSelectionContext {
    pub fn capture(root: &Path) -> Result<Self, CommandError> {
        let library = execs_core::load_library(Some(root))?;
        Ok(Self {
            root: RootContext::capture(root),
            profile_id: library.active_profile_id,
        })
    }

    pub fn ensure_current(&self, root: &Path) -> Result<(), CommandError> {
        self.root.ensure_current(root)?;
        let active = execs_core::load_library(Some(root))?.active_profile_id;
        if active == self.profile_id {
            Ok(())
        } else {
            Err(CommandError::new(
                "ProfileChanged",
                "The active profile changed while that download was running. Try again.",
            ))
        }
    }
}

impl ActiveContext {
    pub fn capture(root: &Path, profile_id: &str) -> Self {
        Self {
            root: RootContext::capture(root),
            profile_id: profile_id.to_string(),
        }
    }

    pub fn ensure_current(&self, root: &Path, profile_id: &str) -> Result<(), CommandError> {
        self.root.ensure_current(root)?;
        if self.profile_id == profile_id {
            Ok(())
        } else {
            Err(CommandError::new(
                "ProfileChanged",
                "The active profile changed while that download was running. Try again.",
            ))
        }
    }
}

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

/// Launching or starting external maintenance over a half-rebuilt live tree
/// would hide the only safe recovery window. Only a profile switch may run
/// while the durable switch journal is present.
pub fn refuse_pending_switch(root: &Path) -> Result<(), CommandError> {
    let library = execs_core::load_library(Some(root))?;
    if library.pending_switch_profile_id.is_some() {
        Err(CommandError::new(
            "RecoveryRequired",
            "A profile switch was interrupted. Re-apply the pending profile before continuing.",
        ))
    } else {
        Ok(())
    }
}

/// Inspect the durable preloader transaction without mutating it. Ordinary
/// writers must fail closed on both rollback-required and cleanup-only state;
/// only the dedicated recovery path may remove either marker.
pub fn preloader_recovery_required(root: &Path) -> Result<bool, CommandError> {
    let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
    Ok(!matches!(
        execs_core::preloader::preloader_transaction_status(root, &data_dir)
            .map_err(CommandError::preloader)?,
        execs_core::preloader::PreloaderTransactionStatus::None
    ))
}

pub fn refuse_pending_preloader(root: &Path) -> Result<(), CommandError> {
    if preloader_recovery_required(root)? {
        Err(CommandError::new(
            "RecoveryRequired",
            "An interrupted Casual-preloader change must be recovered before continuing.",
        ))
    } else {
        Ok(())
    }
}

pub fn profile_recovery_required(root: &Path) -> Result<bool, CommandError> {
    Ok(
        execs_core::profile_mutation_status_to(&execs_core::profiles_dir(), root)?
            != execs_core::ProfileMutationRecoveryState::Clean,
    )
}

pub fn recover_pending_profile_mutations(root: &Path) -> Result<(), CommandError> {
    if !profile_recovery_required(root)? {
        return Ok(());
    }
    if execs_core::load_library(Some(root))?
        .pending_switch_profile_id
        .is_some()
    {
        return Err(CommandError::new(
            "RecoveryRequired",
            "A profile switch and profile update are both interrupted. No files were changed.",
        ));
    }
    execs_core::refuse_if_running()?;
    execs_core::recover_all_profile_mutations_to(
        &execs_core::profiles_dir(),
        root,
        std::iter::empty::<&str>(),
    )?;
    Ok(())
}

/// Ordinary writes may automatically finish a valid profile transaction, but
/// never while an unrelated preloader transaction is also pending. Treating
/// the two independent journals as one recovery would otherwise permit a
/// partial cross-domain rollback.
pub fn prepare_normal_write(root: &Path) -> Result<(), CommandError> {
    refuse_pending_preloader(root)?;
    recover_pending_profile_mutations(root)
}

/// Dedicated preloader recovery may pass its own marker. A simultaneous
/// profile journal is an invalid mixed state and fails closed; when no
/// preloader marker exists this boundary can still clean up a profile journal.
pub fn prepare_preloader_recovery(root: &Path) -> Result<(), CommandError> {
    let preloader = preloader_recovery_required(root)?;
    let profile = profile_recovery_required(root)?;
    if preloader && profile {
        return Err(CommandError::new(
            "RecoveryRequired",
            "Profile and Casual-preloader recoveries are both pending. No files were changed.",
        ));
    }
    if profile {
        recover_pending_profile_mutations(root)?;
    }
    Ok(())
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

/// Read one user-picked file through one handle and a hard byte ceiling.
/// Checking a path and reopening it lets another process replace or grow the
/// file between those two operations; `take(max + 1)` keeps the allocation
/// bounded even when a file changes after the handle is opened.
pub fn read_bounded_file(
    path: &Path,
    max_bytes: u64,
    too_large: impl Into<String>,
) -> Result<Vec<u8>, CommandError> {
    let too_large = too_large.into();
    let mut file =
        std::fs::File::open(path).map_err(|err| CommandError::unknown(err.to_string()))?;
    let len = file
        .metadata()
        .map_err(|err| CommandError::unknown(err.to_string()))?
        .len();
    if len > max_bytes {
        return Err(CommandError::unknown(too_large));
    }
    let mut bytes = Vec::with_capacity(len.min(max_bytes) as usize);
    (&mut file)
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    if bytes.len() as u64 > max_bytes {
        return Err(CommandError::unknown(too_large));
    }
    Ok(bytes)
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

/// A switch may leave its own preloader projection journal before publishing
/// the target id. Recover that projection first, then retry the pending switch.
pub fn prepare_profile_switch(root: &Path) -> Result<(), CommandError> {
    if execs_core::load_library(Some(root))?
        .pending_switch_profile_id
        .is_none()
    {
        return prepare_normal_write(root);
    }
    prepare_preloader_recovery(root)?;
    if preloader_recovery_required(root)? {
        execs_core::refuse_if_running()?;
        execs_core::preloader::recover_pending_preloader(
            root,
            &execs_core::execs_data_dir(),
            &execs_core::process_lock::live_process_names(),
        )
        .map_err(CommandError::preloader)?;
    }
    Ok(())
}
