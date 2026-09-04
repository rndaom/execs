mod comfig_fetch;
mod commands;
mod crosshair_fetch;
mod error;
mod gamebanana;
mod hitsound_fetch;
mod hud_fetch;
mod hud_stats;
mod mods_fetch;
mod net;
mod viewmodel_fetch;

use std::io::Read as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// Serializes every command that writes the profile library or the live
/// surface. Without it the auto-absorb path (fired from an effect when TF2
/// quits) races the settings panes: both read `profiles/index.json`, both
/// mutate it, and the last writer silently drops the other's changes.
///
/// `tokio::sync::Mutex`, not `std`: the guard is held across `.await`.
///
/// Lifecycle operations that continue outside this process's immediate write
/// call (launching TF2, Steam verification, and installing an app update) use
/// the generation-tagged state beside the mutex. Every writer re-checks that
/// state after it acquires the mutex, so a writer queued before maintenance
/// began cannot slip through afterwards.
pub struct WriteGate {
    writes: tokio::sync::Mutex<()>,
    operation: Arc<AtomicU64>,
    lifecycle: Arc<std::sync::Mutex<()>>,
}

/// Serializes reads and garbage collection of the user-picked hitsound cache.
/// It is deliberately separate from `WriteGate`: downloading or decoding a
/// sound may be slow, but only cache GC must wait for that source to become a
/// durable manifest reference.
#[derive(Default)]
pub struct HitsoundCacheGate(tokio::sync::Mutex<()>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ExclusiveOperation {
    LaunchingTf2 = 1,
    SteamVerification = 2,
    InstallingUpdate = 3,
}

#[derive(Clone)]
pub struct OperationToken {
    state: Arc<AtomicU64>,
    lifecycle: Arc<std::sync::Mutex<()>>,
    value: u64,
}

impl OperationToken {
    pub fn id(&self) -> u64 {
        self.value
    }

    pub fn operation(&self) -> ExclusiveOperation {
        operation_from_value(self.value).expect("operation tokens always contain an operation")
    }

    pub fn is_current(&self) -> bool {
        self.state.load(Ordering::Acquire) == self.value
    }

    pub fn finish(&self) {
        let _lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let idle = self.value & !0xff;
        let _ = self
            .state
            .compare_exchange(self.value, idle, Ordering::AcqRel, Ordering::Acquire);
    }
}

impl Default for WriteGate {
    fn default() -> Self {
        Self::new()
    }
}

impl WriteGate {
    pub fn new() -> Self {
        Self::from_operation_value(0)
    }

    fn from_operation_value(value: u64) -> Self {
        Self {
            writes: tokio::sync::Mutex::new(()),
            operation: Arc::new(AtomicU64::new(value)),
            lifecycle: Arc::new(std::sync::Mutex::new(())),
        }
    }

    pub async fn lock_for_write(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, ()>, error::CommandError> {
        let guard = self.lock_for_switch().await?;
        // A failed switch leaves the live tree deliberately unowned until the
        // recorded target is re-applied. UI disabling is not an authority
        // boundary: every IPC writer must refuse that state too. The switch
        // command alone uses `lock_for_switch` directly so it can recover.
        tauri::async_runtime::spawn_blocking(|| {
            if let Some(root) = execs_core::remembered_tf2_root() {
                commands::shared::refuse_pending_switch(&root)?;
            }
            Ok::<(), error::CommandError>(())
        })
        .await
        .map_err(|err| error::CommandError::unknown(err.to_string()))??;
        Ok(guard)
    }

    pub async fn lock_for_switch(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, ()>, error::CommandError> {
        let guard = self.lock_for_interrupted_recovery().await?;
        // Unlike a pending profile switch, a half-finished preloader
        // transaction may have already changed an official VPK. Switching
        // profiles cannot repair that state and must stay closed. Valid
        // generic profile journals are recovered under this same serializer.
        tauri::async_runtime::spawn_blocking(|| {
            if let Some(root) = execs_core::remembered_tf2_root() {
                commands::shared::prepare_normal_write(&root)?;
            }
            Ok::<(), error::CommandError>(())
        })
        .await
        .map_err(|err| error::CommandError::unknown(err.to_string()))??;
        Ok(guard)
    }

    /// Acquire the serializer for a command whose sole purpose is recovering
    /// an interrupted durable transaction. No lifecycle operation may be in
    /// progress, but the recovery marker itself is intentionally allowed.
    pub async fn lock_for_interrupted_recovery(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, ()>, error::CommandError> {
        let guard = self.writes.lock().await;
        if let Some(operation) = self.active_operation() {
            return Err(operation.busy_error());
        }
        Ok(guard)
    }

    /// Preloader mutations are recovery-capable, but they may not bypass an
    /// interrupted profile switch or a simultaneous generic profile journal.
    pub async fn lock_for_preloader_recovery(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, ()>, error::CommandError> {
        let guard = self.lock_for_interrupted_recovery().await?;
        tauri::async_runtime::spawn_blocking(|| {
            if let Some(root) = execs_core::remembered_tf2_root() {
                commands::shared::prepare_preloader_recovery(&root)?;
                commands::shared::refuse_pending_switch(&root)?;
            }
            Ok::<(), error::CommandError>(())
        })
        .await
        .map_err(|err| error::CommandError::unknown(err.to_string()))??;
        Ok(guard)
    }

    /// Library loading is the restart recovery entry point. It may observe a
    /// lone preloader marker so the UI can offer that dedicated repair, while
    /// still recovering a lone generic profile journal before exposing state.
    /// An already-active lifecycle operation owns the live surface, so reads
    /// remain available but must not attempt transaction recovery.
    pub async fn lock_for_library_read(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, ()>, error::CommandError> {
        let guard = self.writes.lock().await;
        if self.active_operation().is_some() {
            return Ok(guard);
        }
        tauri::async_runtime::spawn_blocking(|| {
            if let Some(root) = execs_core::remembered_tf2_root() {
                commands::shared::prepare_preloader_recovery(&root)?;
            }
            Ok::<(), error::CommandError>(())
        })
        .await
        .map_err(|err| error::CommandError::unknown(err.to_string()))??;
        Ok(guard)
    }

    pub async fn begin_operation(
        &self,
        operation: ExclusiveOperation,
    ) -> Result<OperationToken, error::CommandError> {
        let _guard = self.writes.lock().await;
        if let Some(active) = self.active_operation() {
            return Err(active.busy_error());
        }
        tauri::async_runtime::spawn_blocking(|| {
            if let Some(root) = execs_core::remembered_tf2_root() {
                commands::shared::prepare_normal_write(&root)?;
                commands::shared::refuse_pending_switch(&root)?;
            }
            Ok::<(), error::CommandError>(())
        })
        .await
        .map_err(|err| error::CommandError::unknown(err.to_string()))??;
        self.begin_operation_unlocked(operation)
    }

    /// Steam verification is the only external operation allowed to inspect a
    /// Prepared preloader journal. Its command validates and retains that
    /// journal before opening Steam, then reconciles it before unlocking.
    pub async fn begin_preloader_repair(&self) -> Result<OperationToken, error::CommandError> {
        let _guard = self.writes.lock().await;
        if let Some(active) = self.active_operation() {
            return Err(active.busy_error());
        }
        tauri::async_runtime::spawn_blocking(|| {
            if let Some(root) = execs_core::remembered_tf2_root() {
                commands::shared::prepare_preloader_recovery(&root)?;
                commands::shared::refuse_pending_switch(&root)?;
            }
            Ok::<(), error::CommandError>(())
        })
        .await
        .map_err(|err| error::CommandError::unknown(err.to_string()))??;
        self.begin_operation_unlocked(ExclusiveOperation::SteamVerification)
    }

    fn begin_operation_unlocked(
        &self,
        operation: ExclusiveOperation,
    ) -> Result<OperationToken, error::CommandError> {
        let _lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(active) = self.active_operation() {
            return Err(active.busy_error());
        }
        let previous = self.operation.load(Ordering::Acquire);
        let generation = (previous & !0xff).wrapping_add(0x100);
        let value = generation | operation as u64;
        self.operation.store(value, Ordering::Release);
        Ok(OperationToken {
            state: Arc::clone(&self.operation),
            lifecycle: Arc::clone(&self.lifecycle),
            value,
        })
    }

    pub fn operation_is(&self, operation: ExclusiveOperation) -> bool {
        self.operation.load(Ordering::Acquire) & 0xff == operation as u64
    }

    pub fn current_token(&self, operation: ExclusiveOperation) -> Option<OperationToken> {
        let value = self.operation.load(Ordering::Acquire);
        (operation_from_value(value) == Some(operation)).then(|| OperationToken {
            state: Arc::clone(&self.operation),
            lifecycle: Arc::clone(&self.lifecycle),
            value,
        })
    }

    fn active_operation(&self) -> Option<ExclusiveOperation> {
        operation_from_value(self.operation.load(Ordering::Acquire))
    }
}

fn operation_from_value(value: u64) -> Option<ExclusiveOperation> {
    match value & 0xff {
        value if value == ExclusiveOperation::LaunchingTf2 as u64 => {
            Some(ExclusiveOperation::LaunchingTf2)
        }
        value if value == ExclusiveOperation::SteamVerification as u64 => {
            Some(ExclusiveOperation::SteamVerification)
        }
        value if value == ExclusiveOperation::InstallingUpdate as u64 => {
            Some(ExclusiveOperation::InstallingUpdate)
        }
        _ => None,
    }
}

const DURABLE_OPERATION_DIR: &str = "maintenance";
const DURABLE_OPERATION_MAX_BYTES: u64 = 64;

/// Maintenance markers contain one decimal u64 and a newline. Read only the
/// tiny format we accept: a corrupted app-data file must fail closed without
/// allocating its attacker-controlled length or bricking every retry with an
/// unbounded `read_to_string`.
fn read_durable_operation_marker(
    data_dir: &std::path::Path,
    path: &std::path::Path,
) -> std::io::Result<String> {
    execs_core::hash::validate_file_within(data_dir, path)?;
    let mut file = std::fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(DURABLE_OPERATION_MAX_BYTES as usize);
    (&mut file)
        .take(DURABLE_OPERATION_MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > DURABLE_OPERATION_MAX_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "maintenance marker is too large",
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "maintenance marker is not UTF-8",
        )
    })
}

fn durable_operation_file_name(operation: ExclusiveOperation) -> Option<&'static str> {
    match operation {
        ExclusiveOperation::LaunchingTf2 => Some("launching-tf2"),
        ExclusiveOperation::SteamVerification => Some("steam-verification"),
        ExclusiveOperation::InstallingUpdate => None,
    }
}

fn durable_operation_path(
    data_dir: &std::path::Path,
    operation: ExclusiveOperation,
) -> Option<std::path::PathBuf> {
    durable_operation_file_name(operation)
        .map(|name| data_dir.join(DURABLE_OPERATION_DIR).join(name))
}

/// Persist a lifecycle lease before handing control to an external process.
/// The exact generation is stored so a delayed completion cannot clear a
/// newer operation of the same kind (the classic ABA race).
#[cfg(test)]
pub(crate) fn persist_durable_operation(
    data_dir: &std::path::Path,
    token: &OperationToken,
) -> Result<(), error::CommandError> {
    let _lifecycle = token
        .lifecycle
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !token.is_current() {
        return Err(error::CommandError::new(
            "OperationExpired",
            "That operation is no longer active.",
        ));
    }
    persist_durable_operation_unlocked(data_dir, token)
}

fn persist_durable_operation_unlocked(
    data_dir: &std::path::Path,
    token: &OperationToken,
) -> Result<(), error::CommandError> {
    let Some(path) = durable_operation_path(data_dir, token.operation()) else {
        return Err(error::CommandError::new(
            "InvalidOperation",
            "That operation cannot be persisted.",
        ));
    };
    execs_core::hash::write_atomic_within(data_dir, &path, format!("{}\n", token.id()).as_bytes())
        .map_err(|err| {
            error::CommandError::new(
                "Io",
                format!("Could not save the maintenance state ({err})"),
            )
        })
}

/// Persist the exact lease and perform the external hand-off under the same
/// lifecycle lock. Completion/cancellation cannot clear the marker between
/// validation and `open_url`, then let Steam start after writes were unlocked.
pub(crate) fn handoff_durable_operation<T>(
    data_dir: &std::path::Path,
    token: &OperationToken,
    handoff: impl FnOnce() -> Result<T, error::CommandError>,
) -> Result<T, error::CommandError> {
    let _lifecycle = token
        .lifecycle
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !token.is_current() {
        return Err(error::CommandError::new(
            "OperationExpired",
            "That operation is no longer active.",
        ));
    }
    if let Err(error) = persist_durable_operation_unlocked(data_dir, token) {
        let idle = token.id() & !0xff;
        let _ = token
            .state
            .compare_exchange(token.id(), idle, Ordering::AcqRel, Ordering::Acquire);
        return Err(error);
    }
    handoff()
}

/// Clear the durable marker and the matching in-memory generation as one
/// lifecycle critical section. A stale caller cannot remove a newer marker.
pub(crate) fn finish_durable_operation(
    data_dir: &std::path::Path,
    token: &OperationToken,
) -> Result<bool, error::CommandError> {
    complete_durable_operation(data_dir, token, || Ok(true))
}

/// Evaluate the safety predicate and clear the exact durable lease under one
/// lifecycle critical section. External hand-offs use the same lock, so a
/// pre-handoff observation can never unlock a post-handoff operation.
pub(crate) fn complete_durable_operation(
    data_dir: &std::path::Path,
    token: &OperationToken,
    safe_to_finish: impl FnOnce() -> Result<bool, error::CommandError>,
) -> Result<bool, error::CommandError> {
    let Some(path) = durable_operation_path(data_dir, token.operation()) else {
        return Ok(false);
    };
    let _lifecycle = token
        .lifecycle
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !token.is_current() {
        return Ok(false);
    }
    if !safe_to_finish()? {
        return Ok(false);
    }
    let stored = read_durable_operation_marker(data_dir, &path).map_err(|err| {
        error::CommandError::new(
            "MaintenanceState",
            format!("Could not read the maintenance state ({err})"),
        )
    })?;
    if stored.trim() != token.id().to_string() {
        return Ok(false);
    }
    execs_core::hash::remove_file_force_within(data_dir, &path).map_err(|err| {
        error::CommandError::new(
            "MaintenanceState",
            format!("Could not clear the maintenance state ({err})"),
        )
    })?;
    let idle = token.id() & !0xff;
    Ok(token
        .state
        .compare_exchange(token.id(), idle, Ordering::AcqRel, Ordering::Acquire)
        .is_ok())
}

fn restored_operation(data_dir: &std::path::Path) -> Result<Option<u64>, String> {
    let mut restored = None;
    for operation in [
        ExclusiveOperation::LaunchingTf2,
        ExclusiveOperation::SteamVerification,
    ] {
        let path = durable_operation_path(data_dir, operation).expect("durable operation");
        let text = match read_durable_operation_marker(data_dir, &path) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                return Err(format!(
                    "could not read the maintenance state at {} ({err})",
                    path.display()
                ));
            }
        };
        let value = text
            .trim()
            .parse::<u64>()
            .map_err(|_| format!("found invalid maintenance state at {}", path.display()))?;
        if value == 0 || operation_from_value(value) != Some(operation) {
            return Err(format!(
                "found mismatched maintenance state at {}",
                path.display()
            ));
        }
        if restored.replace(value).is_some() {
            return Err("found more than one active maintenance operation".into());
        }
    }
    Ok(restored)
}

fn spawn_launch_monitor(token: OperationToken, data_dir: std::path::PathBuf) {
    std::thread::spawn(move || loop {
        if let Ok(true) = observe_pending_launch(&data_dir, &token, execs_core::is_tf2_running()) {
            return;
        }
        std::thread::sleep(Duration::from_secs(5));
    });
}

fn observe_pending_launch(
    data_dir: &std::path::Path,
    token: &OperationToken,
    tf2_running: bool,
) -> Result<bool, error::CommandError> {
    if !token.is_current() {
        return Ok(true);
    }
    if !tf2_running {
        return Ok(false);
    }
    finish_durable_operation(data_dir, token)
}

impl ExclusiveOperation {
    fn busy_error(self) -> error::CommandError {
        let message = match self {
            Self::LaunchingTf2 => "TF2 is starting. Wait for it to open before changing files.",
            Self::SteamVerification => {
                "Steam is verifying TF2. Wait for the repair to finish before changing files."
            }
            Self::InstallingUpdate => {
                "execs is installing an update. Wait for it to restart before changing files."
            }
        };
        error::CommandError::new("OperationBusy", message)
    }
}

/// Past this, `panic.log` is rotated to `panic.log.1`. A panic that repeats
/// on a timer (see the lock poller) would otherwise grow it without bound.
const PANIC_LOG_MAX_BYTES: u64 = 1024 * 1024;
static PANIC_LOG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Log panics to %AppData%\execs\logs\panic.log (or the Linux data dir) so a
/// crash leaves a trace even when no console is attached.
fn install_panic_logger() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Fallible on purpose: a panic inside a panic hook aborts the process
        // with no log at all, and an unset %APPDATA% is exactly the kind of
        // machine where that log would matter.
        if let Ok(dir) = execs_core::try_execs_data_dir() {
            let _log_guard = PANIC_LOG_LOCK
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let logs = dir.join("logs");
            if execs_core::hash::create_dir_all_within(&dir, &logs).is_err() {
                previous(info);
                return;
            }
            let path = logs.join("panic.log");
            rotate_if_large(&dir, &path);
            let location = info
                .location()
                .map(|loc| format!("{}:{}", loc.file(), loc.line()))
                .unwrap_or_else(|| "unknown".into());
            let record = format!("[{}] panic at {location}: {info}\n", timestamp());
            let existing = match std::fs::symlink_metadata(&path) {
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => Some(Vec::new()),
                Err(_) => None,
                Ok(_) => execs_core::archive::read_regular_file_bounded_within(
                    &dir,
                    &path,
                    PANIC_LOG_MAX_BYTES,
                )
                .ok()
                .flatten(),
            };
            if let Some(mut contents) = existing {
                contents.extend_from_slice(record.as_bytes());
                // Replacement breaks any hard link instead of modifying its
                // other name in place.
                let _ = execs_core::hash::write_atomic_within(&dir, &path, &contents);
            }
        }
        previous(info);
    }));
}

fn rotate_if_large(root: &std::path::Path, path: &std::path::Path) {
    let Ok(()) = execs_core::hash::validate_file_within(root, path) else {
        return;
    };
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return;
    };
    if meta.len() < PANIC_LOG_MAX_BYTES {
        return;
    }
    // One generation is enough: the newest panics are the ones worth reading.
    let previous = path.with_extension("log.1");
    match std::fs::symlink_metadata(&previous) {
        Ok(_) => {
            if execs_core::hash::remove_file_force_within(root, &previous).is_err() {
                return;
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return,
    }
    let _ = execs_core::hash::move_file_within(root, path, &previous);
}

fn timestamp() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(elapsed) => format!("unix {}", elapsed.as_secs()),
        Err(_) => "unknown time".into(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    let data_dir = match startup_data_dir_preflight(execs_core::try_execs_data_dir()) {
        Ok(data_dir) => data_dir,
        Err(error) => {
            // This happens before any command, background poller, or core
            // helper can reach the legacy infallible accessor. Keep it a clean
            // startup failure instead of a delayed panic on the first profile
            // operation.
            eprintln!("{error}");
            return;
        }
    };
    let restored = match restored_operation(&data_dir) {
        Ok(restored) => restored,
        Err(error) => {
            // Failing closed is safer than accepting writes while Steam may
            // still be replacing official archives.
            eprintln!("execs could not start: {error}");
            return;
        }
    };
    let write_gate = WriteGate::from_operation_value(restored.unwrap_or(0));
    let restored_launch = write_gate.current_token(ExclusiveOperation::LaunchingTf2);
    tauri::Builder::default()
        // Registered first, as the plugin requires. Two instances share one
        // profile library and one live tree with no cross-process lock; the
        // second one's boot absorb would delete the first one's in-flight
        // `.execs-part` files mid-switch. A second launch focuses the window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::finder::scan_tf2_installs,
            commands::finder::browse_tf2_root,
            commands::finder::confirm_tf2_root,
            commands::finder::get_tf2_root,
            commands::finder::tf2_write_lock,
            commands::library::get_profile_library,
            commands::library::init_profile_library,
            commands::library::save_current_as,
            commands::library::switch_profile,
            commands::library::export_profile,
            commands::library::import_profile,
            commands::library::confirm_profile_import,
            commands::library::cancel_profile_import,
            commands::absorb::absorb_owned,
            commands::absorb::absorb_packs,
            commands::first_run::classify_first_run,
            commands::first_run::apply_unused_wizard,
            commands::first_run::create_fresh_profile,
            commands::files::get_active_profile_detail,
            commands::files::read_profile_file,
            commands::files::write_owned_file,
            commands::comfig::get_comfig_state,
            commands::comfig::set_comfig_preset,
            commands::comfig::set_comfig_modules,
            commands::comfig::set_comfig_addons,
            commands::comfig::update_comfig_vpks,
            commands::comfig::import_comfig_custom,
            commands::launch::recommended_launch_options,
            commands::launch::launch_tf2,
            commands::launch::cancel_tf2_launch,
            commands::launch::get_profile_launch_options,
            commands::launch::set_profile_launch_options,
            commands::lifecycle::get_lifecycle_status,
            commands::lifecycle::install_app_update,
            commands::hud::get_hud_catalog,
            commands::hud::get_hud_state,
            commands::hud::get_hud_album,
            commands::hud::get_hud_stats,
            commands::hud::install_hud,
            commands::hud::match_hud_catalog,
            commands::hud::update_hud,
            commands::hud::get_hud_schema,
            commands::hud::apply_hud_options,
            commands::crosshair::apply_crosshairs,
            commands::crosshair::fetch_community_crosshair,
            commands::crosshair::fetch_community_crosshair_previews,
            commands::crosshair::get_pack_crosshair_previews,
            commands::crosshair::get_stock_crosshair_sprites,
            commands::crosshair::remove_crosshairs,
            commands::viewmodel::build_viewmodel_pack,
            commands::viewmodel::import_viewmodels,
            commands::viewmodel::remove_viewmodels,
            commands::viewmodel::set_viewmodel_preload,
            commands::viewmodel::viewmodel_build_available,
            commands::viewmodel::viewmodel_preview_image,
            commands::hitsound::hitsound_bytes,
            commands::hitsound::list_stock_hitsounds,
            commands::hitsound::comfig_hitsound_index,
            commands::hitsound::pick_hitsound_file,
            commands::hitsound::apply_hitsounds,
            commands::hitsound::remove_hitsounds,
            commands::open_embedded_page,
            commands::diagnostics::get_diagnostics,
            commands::preloader::get_preloader_status,
            commands::preloader::recover_preloader,
            commands::preloader::get_default_mods,
            commands::preloader::download_default_mods,
            commands::preloader::apply_preloader_mods,
            commands::preloader::set_gameinfo_bypass,
            commands::preloader::revert_preloader,
            commands::preloader::repair_game_files,
            commands::preloader::complete_game_file_repair,
            commands::preloader::cancel_game_file_repair,
            commands::preloader::set_profile_preload,
            commands::hud::import_hud_archive,
            commands::hud::import_hud_folder,
            commands::mods::import_mod_archive,
            commands::mods::import_mod_folder,
            commands::mods::remove_mod,
            commands::mods::search_gamebanana_mods,
            commands::mods::gamebanana_mod_categories,
            commands::mods::install_gamebanana_mod,
        ])
        .setup(move |app| {
            app.manage(write_gate);
            app.manage(commands::library::PendingProfileImport::default());
            app.manage(HitsoundCacheGate::default());
            if let Some(token) = restored_launch {
                spawn_launch_monitor(token, data_dir);
            }
            spawn_lock_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running execs");
}

fn startup_data_dir_preflight(
    result: Result<std::path::PathBuf, String>,
) -> Result<std::path::PathBuf, String> {
    result.map_err(|error| format!("execs could not start: {error}"))
}

/// How many ticks in a row may panic before the poller gives up. A sysinfo
/// bug that panics deterministically would otherwise panic once a second
/// forever, filling the panic log and never telling the UI anything.
const MAX_CONSECUTIVE_PANICS: u32 = 10;

fn spawn_lock_poller(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = None;
        let mut panics = 0u32;
        loop {
            // The whole tick, emit included: an emit panic would otherwise
            // kill the poller thread silently and freeze the write-lock UI at
            // its last value forever.
            let app = app.clone();
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let running = execs_core::is_tf2_running();
                // Unconditionally on the first tick: the webview subscribes
                // after `setup` runs, and a change-only emit would drop the
                // opening state.
                if last != Some(running) {
                    let _ = app.emit("tf2-running", running);
                }
                running
            }));
            match outcome {
                Ok(running) => {
                    last = Some(running);
                    panics = 0;
                }
                Err(_) => {
                    panics += 1;
                    if panics >= MAX_CONSECUTIVE_PANICS {
                        // Say so once, then stop. A stuck lock indicator the
                        // UI knows about beats one it does not.
                        let _ = app.emit("tf2-lock-unavailable", true);
                        return;
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg(test)]
mod startup_tests {
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::{
        complete_durable_operation, finish_durable_operation, handoff_durable_operation,
        observe_pending_launch, persist_durable_operation, restored_operation,
        startup_data_dir_preflight, ExclusiveOperation, OperationToken, WriteGate,
        DURABLE_OPERATION_MAX_BYTES,
    };

    fn temp_dir(label: &str) -> std::path::PathBuf {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "execs-lifecycle-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn missing_platform_data_directory_is_a_clear_startup_error() {
        let error = startup_data_dir_preflight(Err("APPDATA is unset".into())).unwrap_err();
        assert_eq!(error, "execs could not start: APPDATA is unset");
    }

    #[test]
    fn stale_lifecycle_token_cannot_clear_a_new_operation() {
        let state = Arc::new(std::sync::atomic::AtomicU64::new(
            0x100 | ExclusiveOperation::LaunchingTf2 as u64,
        ));
        let stale = OperationToken {
            state: Arc::clone(&state),
            lifecycle: Arc::new(Mutex::new(())),
            value: 0x100 | ExclusiveOperation::LaunchingTf2 as u64,
        };
        state.store(
            0x200 | ExclusiveOperation::InstallingUpdate as u64,
            Ordering::Release,
        );

        stale.finish();

        assert_eq!(
            state.load(Ordering::Acquire),
            0x200 | ExclusiveOperation::InstallingUpdate as u64
        );
    }

    #[test]
    fn a_repair_marker_restores_the_write_gate_after_restart() {
        let dir = temp_dir("restore");
        let value = 0x500 | ExclusiveOperation::SteamVerification as u64;
        let first = WriteGate::from_operation_value(value);
        let token = first
            .current_token(ExclusiveOperation::SteamVerification)
            .unwrap();
        persist_durable_operation(&dir, &token).unwrap();

        let restored = WriteGate::from_operation_value(restored_operation(&dir).unwrap().unwrap());
        assert!(restored.operation_is(ExclusiveOperation::SteamVerification));

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restored_steam_verification_does_not_block_library_loading() {
        let dir = temp_dir("restore-library-read");
        let value = 0x800 | ExclusiveOperation::SteamVerification as u64;
        let first = WriteGate::from_operation_value(value);
        let token = first
            .current_token(ExclusiveOperation::SteamVerification)
            .unwrap();
        persist_durable_operation(&dir, &token).unwrap();

        let restored = WriteGate::from_operation_value(restored_operation(&dir).unwrap().unwrap());
        let read_guard = tauri::async_runtime::block_on(restored.lock_for_library_read()).unwrap();
        assert!(restored.operation_is(ExclusiveOperation::SteamVerification));
        drop(read_guard);

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_oversized_marker_fails_startup_closed_after_a_bounded_read() {
        let dir = temp_dir("oversized-startup-marker");
        let maintenance = dir.join("maintenance");
        std::fs::create_dir_all(&maintenance).unwrap();
        std::fs::write(
            maintenance.join("launching-tf2"),
            vec![b'7'; DURABLE_OPERATION_MAX_BYTES as usize + 1],
        )
        .unwrap();

        let error = restored_operation(&dir).unwrap_err();
        assert!(error.contains("too large"), "{error}");

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_oversized_marker_cannot_unlock_an_active_operation() {
        let dir = temp_dir("oversized-completion-marker");
        let value = 0x600 | ExclusiveOperation::SteamVerification as u64;
        let gate = WriteGate::from_operation_value(value);
        let token = gate
            .current_token(ExclusiveOperation::SteamVerification)
            .unwrap();
        let maintenance = dir.join("maintenance");
        std::fs::create_dir_all(&maintenance).unwrap();
        let marker = maintenance.join("steam-verification");
        std::fs::write(
            &marker,
            vec![b'8'; DURABLE_OPERATION_MAX_BYTES as usize + 1],
        )
        .unwrap();

        let error = complete_durable_operation(&dir, &token, || Ok(true)).unwrap_err();
        assert_eq!(error.code, "MaintenanceState");
        assert!(error.message.contains("too large"));
        assert!(token.is_current());
        assert!(marker.exists());

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_linked_maintenance_directory_cannot_redirect_a_lease_write() {
        let dir = temp_dir("linked-maintenance");
        let victim = temp_dir("linked-maintenance-victim");
        let victim_marker = victim.join("launching-tf2");
        std::fs::write(&victim_marker, b"victim bytes").unwrap();
        let maintenance = dir.join("maintenance");
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/d", "/c", "mklink", "/j"])
                .arg(&maintenance)
                .arg(&victim)
                .status()
                .unwrap();
            assert!(status.success(), "could not create test junction");
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&victim, &maintenance).unwrap();

        let value = 0x700 | ExclusiveOperation::LaunchingTf2 as u64;
        let gate = WriteGate::from_operation_value(value);
        let token = gate
            .current_token(ExclusiveOperation::LaunchingTf2)
            .unwrap();
        let error = persist_durable_operation(&dir, &token).unwrap_err();
        assert_eq!(error.code, "Io");
        assert_eq!(std::fs::read(&victim_marker).unwrap(), b"victim bytes");

        #[cfg(windows)]
        std::fs::remove_dir(&maintenance).unwrap();
        #[cfg(unix)]
        std::fs::remove_file(&maintenance).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
        std::fs::remove_dir_all(victim).unwrap();
    }

    #[test]
    fn stale_same_kind_completion_preserves_the_new_marker_and_generation() {
        let dir = temp_dir("aba");
        let old_value = 0x100 | ExclusiveOperation::SteamVerification as u64;
        let gate = WriteGate::from_operation_value(old_value);
        let stale = gate
            .current_token(ExclusiveOperation::SteamVerification)
            .unwrap();
        persist_durable_operation(&dir, &stale).unwrap();

        let new_value = 0x200 | ExclusiveOperation::SteamVerification as u64;
        gate.operation.store(new_value, Ordering::Release);
        let current = gate
            .current_token(ExclusiveOperation::SteamVerification)
            .unwrap();
        persist_durable_operation(&dir, &current).unwrap();

        assert!(!finish_durable_operation(&dir, &stale).unwrap());
        assert_eq!(restored_operation(&dir).unwrap(), Some(new_value));
        assert!(gate.operation_is(ExclusiveOperation::SteamVerification));

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_delayed_launch_keeps_its_lease_until_the_process_appears() {
        let dir = temp_dir("delayed-launch");
        let value = 0x300 | ExclusiveOperation::LaunchingTf2 as u64;
        let gate = WriteGate::from_operation_value(value);
        let token = gate
            .current_token(ExclusiveOperation::LaunchingTf2)
            .unwrap();
        persist_durable_operation(&dir, &token).unwrap();

        assert!(!observe_pending_launch(&dir, &token, false).unwrap());
        assert_eq!(restored_operation(&dir).unwrap(), Some(value));
        assert!(gate.operation_is(ExclusiveOperation::LaunchingTf2));

        assert!(observe_pending_launch(&dir, &token, true).unwrap());
        assert_eq!(restored_operation(&dir).unwrap(), None);
        assert!(!gate.operation_is(ExclusiveOperation::LaunchingTf2));

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn completion_cannot_pass_an_external_handoff_in_progress() {
        let dir = temp_dir("handoff-race");
        let value = 0x400 | ExclusiveOperation::SteamVerification as u64;
        let gate = WriteGate::from_operation_value(value);
        let handoff_token = gate
            .current_token(ExclusiveOperation::SteamVerification)
            .unwrap();
        let completion_token = handoff_token.clone();
        let handoff_dir = dir.clone();
        let completion_dir = dir.clone();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let (completion_started_tx, completion_started_rx) = std::sync::mpsc::channel();
        let (completed_tx, completed_rx) = std::sync::mpsc::channel();

        let handoff = std::thread::spawn(move || {
            handoff_durable_operation(&handoff_dir, &handoff_token, || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
            .unwrap();
        });
        entered_rx.recv().unwrap();
        let completion = std::thread::spawn(move || {
            completion_started_tx.send(()).unwrap();
            let result =
                complete_durable_operation(&completion_dir, &completion_token, || Ok(true));
            completed_tx.send(result).unwrap();
        });
        completion_started_rx.recv().unwrap();

        // Completion is waiting on the lifecycle critical section, not
        // clearing the lease from observations taken before Steam is opened.
        assert!(matches!(
            completed_rx.recv_timeout(Duration::from_millis(50)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        release_tx.send(()).unwrap();
        handoff.join().unwrap();
        assert!(completed_rx.recv().unwrap().unwrap());
        completion.join().unwrap();
        assert_eq!(restored_operation(&dir).unwrap(), None);

        std::fs::remove_dir_all(dir).unwrap();
    }
}
