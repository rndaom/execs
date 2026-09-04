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

/// Start TF2 through Steam after every in-flight write has finished. Keep the
/// lifecycle lease until the process is visible so a queued writer cannot run
/// in Steam's launch delay and race the game startup.
#[tauri::command]
pub async fn launch_tf2(gate: tauri::State<'_, WriteGate>) -> Result<(), CommandError> {
    let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
    let operation = gate
        .begin_operation(ExclusiveOperation::LaunchingTf2)
        .await?;
    let already_running = match super::shared::blocking(|| {
        let root = confirmed_root()?;
        refuse_pending_switch(&root)?;
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
