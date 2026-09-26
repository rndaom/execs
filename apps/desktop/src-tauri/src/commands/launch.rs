//! Launch options: the recommended set, and the active profile's own.

use execs_core::SetLaunchResult;

use super::shared::{confirmed_root, refuse_pending_switch, with_profile};
use crate::error::CommandError;
use crate::{
    complete_durable_operation, finish_durable_operation, handoff_durable_operation,
    spawn_launch_monitor, ExclusiveOperation, WriteGate,
};

#[tauri::command]
pub fn recommended_launch_options() -> String {
    execs_core::recommended_launch_options()
}

#[tauri::command]
pub async fn get_profile_launch_options() -> Result<String, CommandError> {
    with_profile(|root, profile_id| Ok(execs_core::get_profile_launch_options(&root, &profile_id)?))
        .await
}

#[tauri::command]
pub async fn set_profile_launch_options(
    gate: tauri::State<'_, WriteGate>,
    options: String,
) -> Result<SetLaunchResult, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        Ok(execs_core::set_profile_launch_options(
            &root,
            &profile_id,
            &options,
        )?)
    })
    .await
}

/// Compare the active profile's launch options with Steam's saved copy.
#[tauri::command]
pub async fn get_launch_sync_status() -> Result<execs_core::LaunchSyncStatus, CommandError> {
    with_profile(|root, profile_id| Ok(execs_core::launch_sync_status(&root, &profile_id)?)).await
}

/// Start TF2 through Steam after every in-flight write has finished. Keep the
/// lifecycle lease until the process is visible so a queued writer cannot run
/// in Steam's launch delay and race the game startup.
///
/// With `sync_steam`, the player has agreed to close Steam: execs asks Steam
/// to exit, writes the profile's launch options once it has, and the launch
/// below starts Steam again.
#[tauri::command]
pub async fn launch_tf2(
    gate: tauri::State<'_, WriteGate>,
    sync_steam: bool,
) -> Result<(), CommandError> {
    let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
    let operation = gate
        .begin_operation(ExclusiveOperation::LaunchingTf2)
        .await?;
    let already_running = match super::shared::blocking(|| {
        let root = confirmed_root()?;
        refuse_pending_switch(&root)?;
        let library = execs_core::load_library(Some(&root))?;
        if let Some(id) = library.active_profile_id {
            let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), &id)?;
            execs_core::custom_folders::validate_custom_mounts(&manifest.files)?;
        }
        Ok(execs_core::is_tf2_running())
    })
    .await
    {
        Ok(running) => running,
        Err(error) => {
            operation.finish();
            return Err(error);
        }
    };
    if already_running {
        operation.finish();
        return Ok(());
    }
    if sync_steam {
        if let Err(error) = super::shared::blocking(write_steam_launch_options).await {
            operation.finish();
            return Err(error);
        }
    }
    let handoff_token = operation.clone();
    let handoff_data_dir = data_dir.clone();
    let launch = super::shared::blocking(move || {
        handoff_durable_operation(&handoff_data_dir, &handoff_token, || {
            tauri_plugin_opener::open_url("steam://rungameid/440", None::<&str>).map_err(|err| {
                CommandError::unknown(format!("Could not ask Steam to launch TF2 ({err})"))
            })
        })
    })
    .await;
    if let Err(error) = launch {
        // Shell hand-off failures are ambiguous on some platforms. Keep the
        // lease and watcher; the user can safely cancel after closing Steam.
        spawn_launch_monitor(operation, data_dir);
        return Err(error);
    }

    let started = super::shared::blocking(|| {
        for _ in 0..120 {
            if execs_core::is_tf2_running() {
                return Ok(true);
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        Ok(false)
    })
    .await?;
    if started {
        finish_durable_operation(&data_dir, &operation)?;
        return Ok(());
    }

    // Steam can legitimately take longer while updating. Keep the durable
    // lease and hand the low-rate watch to a background thread; returning only
    // stops the one-minute UI wait, it does not make writes safe.
    spawn_launch_monitor(operation, data_dir);
    Err(CommandError::new(
        "LaunchPending",
        "Steam has not started TF2 yet. Changes stay locked while execs keeps waiting.",
    ))
}

/// Steam keeps launch options in memory and rewrites `localconfig.vdf` on
/// exit, so it must be fully closed before the profile's options are written.
fn write_steam_launch_options() -> Result<(), CommandError> {
    let root = confirmed_root()?;
    let Some(profile_id) = execs_core::load_library(Some(&root))?.active_profile_id else {
        return Ok(());
    };
    if steam_running() {
        tauri_plugin_opener::open_url("steam://exit", None::<&str>).map_err(|err| {
            CommandError::unknown(format!("Could not ask Steam to close ({err})"))
        })?;
        if !wait_until(|| !steam_running(), 120) {
            return Err(CommandError::new(
                "SteamRunning",
                "Steam did not close within a minute. Close Steam yourself, then launch again.",
            ));
        }
    }
    match execs_core::sync_profile_launch_options(&root, &profile_id)? {
        execs_core::LaunchWriteReason::Written | execs_core::LaunchWriteReason::NoAccount => Ok(()),
        execs_core::LaunchWriteReason::SteamOpen => Err(CommandError::new(
            "SteamRunning",
            "Steam opened again before its launch options were written. Launch again.",
        )),
        execs_core::LaunchWriteReason::WriteFailed => Err(CommandError::new(
            "LaunchOptionsNotWritten",
            "Could not write Steam's launch options, so TF2 was not started. Steam is closed; launch again to retry.",
        )),
    }
}

fn steam_running() -> bool {
    execs_core::process_lock::steam_running_among(execs_core::process_lock::live_process_names())
}

/// Poll every half second, up to `attempts` times.
fn wait_until(mut done: impl FnMut() -> bool, attempts: u32) -> bool {
    for _ in 0..attempts {
        if done() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    done()
}

/// Explicit recovery for a Steam launch the user cancelled in Steam. The UI
/// asks for confirmation first; the exact token keeps a delayed request from
/// clearing a newer launch lease.
#[tauri::command]
pub async fn cancel_tf2_launch(gate: tauri::State<'_, WriteGate>) -> Result<bool, CommandError> {
    let Some(operation) = gate.current_token(ExclusiveOperation::LaunchingTf2) else {
        return Ok(false);
    };
    let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
    super::shared::blocking(move || {
        complete_durable_operation(&data_dir, &operation, || {
            let first = execs_core::process_lock::live_process_names();
            refuse_launch_cancel_while_processes_run(&first)?;
            std::thread::sleep(std::time::Duration::from_secs(2));
            let second = execs_core::process_lock::live_process_names();
            refuse_launch_cancel_while_processes_run(&second)?;
            Ok(true)
        })
    })
    .await
}

fn refuse_launch_cancel_while_processes_run(names: &[String]) -> Result<(), CommandError> {
    execs_core::refuse_if_running_among(names)?;
    if execs_core::process_lock::steam_running_among(names) {
        return Err(CommandError::new(
            "SteamRunning",
            "Close Steam completely before cancelling the launch lock.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::refuse_launch_cancel_while_processes_run;

    #[test]
    fn launch_cancel_requires_steam_and_tf2_to_be_closed() {
        assert!(refuse_launch_cancel_while_processes_run(&[]).is_ok());
        let steam = vec![if cfg!(windows) {
            "steam.exe".to_string()
        } else {
            "steam".to_string()
        }];
        assert_eq!(
            refuse_launch_cancel_while_processes_run(&steam)
                .unwrap_err()
                .code,
            "SteamRunning"
        );
        let game = vec![if cfg!(windows) {
            "tf_win64.exe".to_string()
        } else {
            "tf_linux64".to_string()
        }];
        assert_eq!(
            refuse_launch_cancel_while_processes_run(&game)
                .unwrap_err()
                .code,
            "GameRunning"
        );
    }
}
