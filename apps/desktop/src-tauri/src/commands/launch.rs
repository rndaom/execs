//! Launch options: the recommended set, and the active profile's own.

use execs_core::SetLaunchResult;

use super::shared::{confirmed_root, refuse_pending_switch, with_profile};
use crate::error::CommandError;
use crate::{
    finish_durable_operation, handoff_durable_operation, release_pending_launch_wait,
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
    review_token: Option<String>,
    adopt_steam: Option<bool>,
) -> Result<SetLaunchResult, CommandError> {
    let _guard = gate.lock_for_write().await?;
    if adopt_steam.unwrap_or(false) && review_token.is_none() {
        return Err(CommandError::new(
            "LaunchReviewRequired",
            "Review Steam options before adopting them.",
        ));
    }
    with_profile(move |root, profile_id| {
        if let Some(token) = review_token {
            let review = execs_core::launch::validate_launch_review(&root, &profile_id, &token)?;
            if review.profile_options != options {
                return Err(CommandError::new(
                    "LaunchReviewChanged",
                    "Save the profile options before reviewing Steam.",
                ));
            }
            execs_core::launch::apply_launch_review(
                &root,
                &profile_id,
                &token,
                adopt_steam.unwrap_or(false),
            )?;
            return Ok(SetLaunchResult {
                launch_options: execs_core::get_profile_launch_options(&root, &profile_id)?,
                steam_write: execs_core::LaunchWriteReason::Written,
            });
        }
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
    review_token: Option<String>,
    adopt_steam: Option<bool>,
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
    if sync_steam || adopt_steam.unwrap_or(false) {
        if let Err(error) = super::shared::blocking(move || {
            let token = review_token.ok_or_else(|| {
                CommandError::new(
                    "LaunchReviewRequired",
                    "Review Steam’s launch options first.",
                )
            })?;
            if adopt_steam.unwrap_or(false) {
                let root = confirmed_root()?;
                let id = execs_core::load_library(Some(&root))?
                    .active_profile_id
                    .ok_or_else(|| CommandError::new("NoProfile", "Choose a profile first."))?;
                execs_core::launch::apply_launch_review(&root, &id, &token, true)?;
                Ok(())
            } else {
                write_steam_launch_options(&token)
            }
        })
        .await
        {
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
        // lease and watcher; the user can explicitly release the wait after cancelling in Steam.
        spawn_launch_monitor(operation, data_dir);
        return Err(error);
    }

    let waiting_token = operation.clone();
    let started = super::shared::blocking(move || {
        for _ in 0..120 {
            if !waiting_token.is_current() {
                return Ok(false);
            }
            if execs_core::is_tf2_running() {
                return Ok(true);
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        Ok(false)
    })
    .await?;
    if !operation.is_current() {
        return Ok(());
    }
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
        "Steam has not started TF2 yet. Release the launch wait if you cancelled in Steam. Waiting ends after ten minutes; this does not cancel Steam’s launch.",
    ))
}

/// Steam keeps launch options in memory and rewrites `localconfig.vdf` on
/// exit, so it must be fully closed before the profile's options are written.
fn write_steam_launch_options(token: &str) -> Result<(), CommandError> {
    let root = confirmed_root()?;
    let Some(profile_id) = execs_core::load_library(Some(&root))?.active_profile_id else {
        return Ok(());
    };
    execs_core::launch::validate_launch_review(&root, &profile_id, token)?;
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
    execs_core::launch::apply_launch_review(&root, &profile_id, token, false)?;
    Ok(())
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
/// exposes release directly; the exact token keeps a delayed request from
/// clearing a newer launch lease.
#[tauri::command]
pub async fn cancel_tf2_launch(gate: tauri::State<'_, WriteGate>) -> Result<bool, CommandError> {
    let Some(operation) = gate.current_token(ExclusiveOperation::LaunchingTf2) else {
        return Ok(false);
    };
    let data_dir = execs_core::try_execs_data_dir().map_err(CommandError::unknown)?;
    super::shared::blocking(move || {
        release_pending_launch_wait(
            &data_dir,
            &operation,
            execs_core::process_lock::live_process_names,
            || std::thread::sleep(std::time::Duration::from_secs(2)),
        )
    })
    .await
}

pub(crate) fn verify_tf2_absent(
    mut processes: impl FnMut() -> Vec<String>,
    wait: impl FnOnce(),
) -> Result<(), CommandError> {
    refuse_launch_cancel_while_processes_run(&processes())?;
    wait();
    refuse_launch_cancel_while_processes_run(&processes())
}

fn refuse_launch_cancel_while_processes_run(names: &[String]) -> Result<(), CommandError> {
    execs_core::refuse_if_running_among(names)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{refuse_launch_cancel_while_processes_run, verify_tf2_absent};

    #[test]
    fn launch_cancel_permits_steam_but_requires_tf2_closed() {
        assert!(refuse_launch_cancel_while_processes_run(&[]).is_ok());
        let steam = vec![if cfg!(windows) {
            "steam.exe".to_string()
        } else {
            "steam".to_string()
        }];
        assert!(refuse_launch_cancel_while_processes_run(&steam).is_ok());
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
    #[test]
    fn launch_release_rechecks_after_the_quiet_interval() {
        let mut calls = 0;
        let result = verify_tf2_absent(
            || {
                calls += 1;
                if calls == 1 {
                    vec!["steam".into()]
                } else {
                    vec!["tf.exe".into()]
                }
            },
            || {},
        );
        assert_eq!(calls, 2);
        assert_eq!(result.unwrap_err().code, "GameRunning");
    }
}
