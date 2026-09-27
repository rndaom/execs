//! Uninstall handoff. Leaving TF2 as it is stays the default; app-data removal
//! is a separate opt-in that waits until no Casual snapshot is still needed.

use serde::Serialize;
use tauri::AppHandle;

use execs_core::uninstall::{delete_app_data, detect_install, InstallKind};

use super::shared::blocking;
use crate::error::CommandError;
use crate::WriteGate;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CasualChanges {
    patched_files: usize,
    gameinfo_bypassed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallInfo {
    install: InstallKind,
    data_directory: String,
    /// None when the Casual state could not be read.
    casual: Option<CasualChanges>,
}

fn current_install() -> Result<InstallKind, CommandError> {
    let exe = std::env::current_exe().map_err(|err| CommandError::unknown(err.to_string()))?;
    Ok(detect_install(&exe))
}

/// Particle snapshots and the gameinfo.txt backup live in app data. While TF2
/// still carries those changes, deleting app data would lose the only way back.
fn casual_changes(data_dir: &std::path::Path) -> Option<CasualChanges> {
    match execs_core::remembered_tf2_root() {
        Some(root) => execs_core::preloader::preloader_status(&root, data_dir)
            .ok()
            .map(|status| CasualChanges {
                patched_files: status.patched_files.len(),
                gameinfo_bypassed: status.gameinfo_bypassed,
            }),
        None => {
            let originals = data_dir.join("preloader").join("originals");
            let holds_snapshots = std::fs::read_dir(&originals)
                .map(|mut entries| entries.next().is_some())
                .unwrap_or(false);
            (!holds_snapshots).then_some(CasualChanges {
                patched_files: 0,
                gameinfo_bypassed: false,
            })
        }
    }
}

#[tauri::command]
pub async fn get_uninstall_info() -> Result<UninstallInfo, CommandError> {
    blocking(|| {
        let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
        Ok(UninstallInfo {
            install: current_install()?,
            data_directory: execs_core::finder::user_path_string(&data_dir),
            casual: casual_changes(&data_dir),
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallOutcome {
    /// execs closes itself shortly after this returns.
    closing: bool,
}

/// Optionally delete app data, then start the platform removal and close.
/// Deb removal needs the system package manager, so execs only closes.
#[tauri::command]
pub async fn uninstall_execs(
    app: AppHandle,
    gate: tauri::State<'_, WriteGate>,
    delete_data: bool,
) -> Result<UninstallOutcome, CommandError> {
    let _guard = gate.lock_for_write().await?;
    blocking(move || {
        execs_core::refuse_if_running()?;
        let install = current_install()?;
        if install == InstallKind::Unmanaged {
            return Err(CommandError::new(
                "UninstallUnavailable",
                "This copy of execs was not installed by an execs installer, so there is nothing to uninstall here.",
            ));
        }
        if delete_data {
            let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
            match casual_changes(&data_dir) {
                Some(changes) if changes.patched_files == 0 && !changes.gameinfo_bypassed => {}
                Some(_) => {
                    return Err(CommandError::new(
                        "CasualChangesInstalled",
                        "Restore stock files first. execs keeps the original game files it needs to undo Casual setup in its data.",
                    ))
                }
                None => {
                    return Err(CommandError::new(
                        "CasualChangesUnknown",
                        "Could not check Casual setup changes, so execs data was kept. Try again, or uninstall without deleting data.",
                    ))
                }
            }
            let failed = delete_app_data(&data_dir)
                .map_err(|err| CommandError::new("AppDataDelete", err.to_string()))?;
            if !failed.is_empty() {
                return Err(CommandError::new(
                    "AppDataDelete",
                    format!(
                        "Some execs data could not be deleted ({}). Close programs that may use it and try again. execs was not uninstalled.",
                        failed.join(", ")
                    ),
                ));
            }
        }
        match &install {
            InstallKind::WindowsInstaller { uninstaller } => {
                std::process::Command::new(uninstaller)
                    .spawn()
                    .map_err(|err| CommandError::new("UninstallStart", err.to_string()))?;
            }
            InstallKind::AppImage { path } => {
                std::fs::remove_file(path)
                    .map_err(|err| CommandError::new("UninstallStart", err.to_string()))?;
            }
            InstallKind::Deb { .. } | InstallKind::Unmanaged => {}
        }
        Ok(())
    })
    .await?;
    // Let this response reach the webview before the process exits.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        app.exit(0);
    });
    Ok(UninstallOutcome { closing: true })
}
