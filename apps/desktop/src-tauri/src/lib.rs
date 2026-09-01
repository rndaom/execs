mod comfig_fetch;
mod commands;
mod crosshair_fetch;
mod hud_fetch;
mod mods_fetch;
mod viewmodel_fetch;

use std::io::Write;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// Serializes every command that writes the profile library or the live
/// surface. Without it the auto-absorb path (fired from an effect when TF2
/// quits) races the settings panes: both read `profiles/index.json`, both
/// mutate it, and the last writer silently drops the other's changes.
///
/// `tokio::sync::Mutex`, not `std`: the guard is held across `.await`.
pub struct WriteGate(pub tokio::sync::Mutex<()>);

/// Log panics to %AppData%\execs\logs\panic.log (or the Linux data dir) so a
/// crash leaves a trace even when no console is attached.
fn install_panic_logger() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let settings = execs_core::settings_file();
        if let Some(dir) = settings.parent() {
            let logs = dir.join("logs");
            let _ = std::fs::create_dir_all(&logs);
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(logs.join("panic.log"))
            {
                let location = info
                    .location()
                    .map(|loc| format!("{}:{}", loc.file(), loc.line()))
                    .unwrap_or_else(|| "unknown".into());
                let _ = writeln!(file, "[{}] panic at {location}: {info}", timestamp());
            }
        }
        previous(info);
    }));
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::scan_tf2_installs,
            commands::validate_tf2_root,
            commands::browse_tf2_root,
            commands::confirm_tf2_root,
            commands::get_tf2_root,
            commands::tf2_write_lock,
            commands::get_profile_library,
            commands::init_profile_library,
            commands::create_profile_record,
            commands::save_current_as,
            commands::scan_absorb_delta,
            commands::absorb_owned,
            commands::absorb_packs,
            commands::switch_profile,
            commands::export_profile,
            commands::import_profile,
            commands::classify_first_run,
            commands::apply_unused_wizard,
            commands::get_inherit_binds,
            commands::set_inherit_binds,
            commands::create_fresh_profile,
            commands::get_active_profile_detail,
            commands::list_profile_files,
            commands::read_profile_file,
            commands::write_owned_file,
            commands::get_comfig_state,
            commands::set_comfig_preset,
            commands::set_comfig_modules,
            commands::set_comfig_addons,
            commands::update_comfig_vpks,
            commands::import_comfig_custom,
            commands::recommended_launch_options,
            commands::get_profile_launch_options,
            commands::set_profile_launch_options,
            commands::get_hud_catalog,
            commands::get_hud_state,
            commands::install_hud,
            commands::match_hud_catalog,
            commands::update_hud,
            commands::get_hud_schema,
            commands::apply_hud_options,
            commands::apply_crosshairs,
            commands::fetch_community_crosshair,
            commands::get_pack_crosshair_previews,
            commands::get_stock_crosshair_sprites,
            commands::remove_crosshairs,
            commands::build_viewmodel_pack,
            commands::import_viewmodels,
            commands::remove_viewmodels,
            commands::set_viewmodel_preload,
            commands::viewmodel_build_available,
            commands::open_embedded_page,
            commands::get_preloader_status,
            commands::get_default_mods,
            commands::download_default_mods,
            commands::apply_preloader_mods,
            commands::set_gameinfo_bypass,
            commands::revert_preloader,
        ])
        .setup(|app| {
            app.manage(WriteGate(tokio::sync::Mutex::new(())));
            spawn_lock_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running execs");
}

fn spawn_lock_poller(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = None;
        loop {
            // A failed poll must never take the app down; skip the tick instead.
            let running = std::panic::catch_unwind(execs_core::is_tf2_running);
            if let Ok(running) = running {
                if last != Some(running) {
                    let _ = app.emit("tf2-running", running);
                    last = Some(running);
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
