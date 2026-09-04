//! App lifecycle operations that must not overlap profile or live-file writes.

use crate::commands::shared::{blocking, refuse_pending_switch};
use crate::error::CommandError;
use crate::{ExclusiveOperation, OperationToken, WriteGate};
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

const UPDATE_CHECK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const MAX_UPDATE_VERSION_BYTES: usize = 64;
const UPDATE_PROGRESS_EVENT: &str = "app-update-progress";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleStatus {
    launching_tf2: bool,
    steam_verification: bool,
    installing_update: bool,
}

#[tauri::command]
pub fn get_lifecycle_status(gate: tauri::State<'_, WriteGate>) -> LifecycleStatus {
    LifecycleStatus {
        launching_tf2: gate.operation_is(ExclusiveOperation::LaunchingTf2),
        steam_verification: gate.operation_is(ExclusiveOperation::SteamVerification),
        installing_update: gate.operation_is(ExclusiveOperation::InstallingUpdate),
    }
}

/// Releases an update lease on every error/cancellation path. A successful
/// install disarms it immediately before requesting process restart, leaving
/// the gate closed during the handoff.
struct UpdateLease(Option<OperationToken>);

impl UpdateLease {
    fn new(operation: OperationToken) -> Self {
        Self(Some(operation))
    }

    fn keep_until_exit(&mut self) {
        self.0.take();
    }
}

impl Drop for UpdateLease {
    fn drop(&mut self) {
        if let Some(operation) = self.0.take() {
            operation.finish();
        }
    }
}

fn validate_expected_update_version(version: &str) -> Result<(), CommandError> {
    if version.is_empty()
        || version.len() > MAX_UPDATE_VERSION_BYTES
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
    {
        return Err(CommandError::new(
            "InvalidUpdateVersion",
            "The requested update version is invalid. Check for updates again.",
        ));
    }
    Ok(())
}

fn updater_error(action: &str) -> CommandError {
    CommandError::new(
        "UpdateFailed",
        format!("Could not {action} the signed app update."),
    )
}

/// Own the entire updater handoff behind the process-wide gate. The renderer
/// can still perform the read-only update check, but has no capability for a
/// raw plugin install or process restart.
#[tauri::command]
pub async fn install_app_update(
    gate: tauri::State<'_, WriteGate>,
    app: tauri::AppHandle,
    expected_version: String,
) -> Result<(), CommandError> {
    validate_expected_update_version(&expected_version)?;
    let operation = gate
        .begin_operation(ExclusiveOperation::InstallingUpdate)
        .await?;
    let mut lease = UpdateLease::new(operation);

    blocking(|| {
        if let Some(root) = execs_core::remembered_tf2_root() {
            refuse_pending_switch(&root)?;
        }
        Ok(())
    })
    .await?;

    // Re-check server state in the trusted process and require the exact
    // version advertised by the read-only renderer check. A feed change never
    // silently installs a different release than the button named.
    let updater = app
        .updater_builder()
        .timeout(UPDATE_CHECK_TIMEOUT)
        .build()
        .map_err(|_| updater_error("prepare"))?;
    let update = updater
        .check()
        .await
        .map_err(|_| updater_error("check for"))?
        .ok_or_else(|| CommandError::new("NoUpdate", "No app update is available."))?;
    if update.version != expected_version {
        return Err(CommandError::new(
            "UpdateChanged",
            "The available update changed. Check for updates again before installing.",
        ));
    }

    let _ = app.emit(UPDATE_PROGRESS_EVENT, "downloading");
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|_| updater_error("download or verify"))?;
    let _ = app.emit(UPDATE_PROGRESS_EVENT, "installing");
    blocking(move || update.install(bytes).map_err(|_| updater_error("install"))).await?;

    let _ = app.emit(UPDATE_PROGRESS_EVENT, "restarting");
    lease.keep_until_exit();
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_expected_update_version, UpdateLease, MAX_UPDATE_VERSION_BYTES};
    use crate::{ExclusiveOperation, WriteGate};

    #[test]
    fn failed_or_cancelled_update_releases_only_its_exact_lease() {
        let value = 0x500 | ExclusiveOperation::InstallingUpdate as u64;
        let gate = WriteGate::from_operation_value(value);
        let operation = gate
            .current_token(ExclusiveOperation::InstallingUpdate)
            .unwrap();
        drop(UpdateLease::new(operation));
        assert!(!gate.operation_is(ExclusiveOperation::InstallingUpdate));
    }

    #[test]
    fn update_version_input_is_small_and_semver_shaped() {
        for valid in ["0.2.0", "1.0.0-rc.1", "1.0.0+linux"] {
            assert!(validate_expected_update_version(valid).is_ok());
        }
        for invalid in ["", "0.2.0\nanything", "0.2.0/../../x"] {
            assert!(validate_expected_update_version(invalid).is_err());
        }
        assert!(
            validate_expected_update_version(&"1".repeat(MAX_UPDATE_VERSION_BYTES + 1)).is_err()
        );
    }

    #[test]
    fn renderer_has_no_raw_install_or_restart_capability() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
        let permissions = capability["permissions"].as_array().unwrap();
        let named: Vec<_> = permissions
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect();
        assert!(named.contains(&"core:resources:allow-close"));
        assert!(named.contains(&"updater:allow-check"));
        assert!(!named.contains(&"updater:allow-download-and-install"));
        assert!(!named.contains(&"process:allow-restart"));

        let setup = include_str!("../lib.rs");
        assert!(!setup.contains("tauri_plugin_process::init()"));
        assert!(setup.contains("commands::lifecycle::install_app_update"));
        assert!(!setup.contains("commands::lifecycle::begin_app_update"));
        assert!(!setup.contains("commands::lifecycle::cancel_app_update"));

        let bridge = include_str!("../../../src/lib/bridge.ts");
        assert!(bridge.contains("call<void>(\"install_app_update\""));
        assert!(!bridge.contains(".downloadAndInstall("));
        assert!(!bridge.contains("@tauri-apps/plugin-process"));

        let cargo_manifest = include_str!("../../Cargo.toml");
        let package_manifest = include_str!("../../../package.json");
        assert!(!cargo_manifest.contains("tauri-plugin-process"));
        assert!(!package_manifest.contains("@tauri-apps/plugin-process"));
    }
}
